// Client: a fetch wrapper that answers 402s.
//   const pay = wrapFetch(fetch, { prepaid: { secretKey }, payInvoice: async ({ invoice, amount, asset }) => txid })
// Picks the prepaid (batch-settlement) option when a prepaid key is given, else pays the RGB invoice
// (exact / upfront) with your wallet. Checks the request binding before paying: it never pays for a
// request other than the one it is making.
import { ATM, X402_VERSION } from './networks.js';
import { decodeHeader, encodeHeader, requestHash } from './binding.js';
import { signVoucher } from './voucher.js';

export function wrapFetch(fetchFn, { prepaid, payInvoice, maxAmount = Infinity, onPayment } = {}) {
  return async function paidFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ?? '';
    const first = await fetchFn(input, init);
    if (first.status !== 402) return first;
    const header = first.headers.get('payment-required');
    if (!header) return first;
    const pr = decodeHeader(header);
    const opts = (pr.accepts ?? []).filter((a) => BigInt(a.amount) <= BigInt(maxAmount === Infinity ? a.amount : maxAmount));
    const pre = prepaid && opts.find((a) => a.scheme === 'batch-settlement' && a.extra?.assetTransferMethod === ATM.prepaid);
    const ex = payInvoice && opts.find((a) => a.scheme === 'exact' && a.extra?.assetTransferMethod === ATM.invoice);
    const pick = pre ?? ex;
    if (!pick) return first; // nothing we can pay with
    const names = pick.extra?.requestBindingParams?.headers ?? [];
    const headerValues = Object.fromEntries(names.map((n) => [n, new Headers(init.headers).get(n) ?? undefined]));
    const ours = requestHash({ scheme: pick.scheme, atm: pick.extra.assetTransferMethod, method, url, body, headerNames: names, headerValues });
    if (ours !== pick.extra?.requestHash) throw new Error('x402-rgb: the server bound the payment to a different request; not paying');
    let payload;
    if (pick === pre) {
      payload = signVoucher({ network: pick.network, asset: pick.asset, payTo: pick.payTo, maxAmount: pick.amount, requestHash: ours, expiry: Math.floor(Date.now() / 1000) + pick.maxTimeoutSeconds }, prepaid.secretKey);
    } else {
      const txid = await payInvoice({ invoice: pick.extra.invoice, amount: BigInt(pick.amount), asset: pick.asset, network: pick.network });
      payload = { invoice: pick.extra.invoice, txid };
    }
    onPayment?.({ requirements: pick, payload });
    const headers = new Headers(init.headers);
    headers.set('payment-signature', encodeHeader({ x402Version: X402_VERSION, resource: pr.resource, accepted: pick, payload }));
    return fetchFn(input, { ...init, headers });
  };
}

/** Decode a response's PAYMENT-RESPONSE header, if any. */
export const paymentResponse = (res) => (res.headers.get('payment-response') ? decodeHeader(res.headers.get('payment-response')) : null);
