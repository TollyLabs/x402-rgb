// Resource server helper: protect a route with x402 Bitcoin-USDT payments through a facilitator.
//
//   const x402 = createPaywall({ facilitator: 'https://rgb.tollylabs.com/api/x402', apiKey, publicUrl })
//   const r = await x402.require(req, rawBody, { amount: '10000', description: 'One fortune' })
//   if (!r.paid) return send(r.status, r.headers, r.body)        // 402 (or 400/502)
//   const result = makeResponse(); const done = await r.finalize() // settle (prepaid) / no-op (exact)
//   send(200, { ...done.headers }, result)
import { ATM, X402_VERSION } from './networks.js';
import { decodeHeader, encodeHeader, requestHash } from './binding.js';

export function createPaywall({ facilitator, apiKey, publicUrl, boundHeaders = [], timeoutSeconds = 300, fetchFn = fetch }) {
  const call = async (path, body) => {
    const r = await fetchFn(`${facilitator}${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({ error: `facilitator HTTP ${r.status}` }));
    if (!r.ok && j.error) throw Object.assign(new Error(j.error), { status: r.status });
    return j;
  };
  let info = null;
  const facilitatorInfo = async () => (info ??= await call('/merchant'));
  const headerValues = (req) => Object.fromEntries(boundHeaders.map((n) => [n, req.headers[n] ?? undefined]));
  const urlOf = (req) => new URL(req.url, publicUrl).href;
  const hashFor = (req, rawBody, scheme, atm) => requestHash({ scheme, atm, method: req.method, url: urlOf(req), body: rawBody ?? '', headerNames: boundHeaders, headerValues: headerValues(req) });

  async function challenge(req, rawBody, { amount, description }) {
    const m = await facilitatorInfo();
    const base = { network: m.network, amount: String(amount), asset: m.asset, payTo: m.merchant, maxTimeoutSeconds: timeoutSeconds };
    const binding = { requestBindingProfile: 'http:1', requestBindingParams: { headers: boundHeaders } };
    const exactHash = hashFor(req, rawBody, 'exact', ATM.invoice);
    const inv = await call('/challenge', { amount: String(amount), requestHash: exactHash, maxTimeoutSeconds: timeoutSeconds });
    const accepts = [
      { scheme: 'batch-settlement', ...base, extra: { assetTransferMethod: ATM.prepaid, ...binding, requestHash: hashFor(req, rawBody, 'batch-settlement', ATM.prepaid), facilitator } },
      { scheme: 'exact', ...base, extra: { assetTransferMethod: ATM.invoice, paymentFlow: 'upfront', ...binding, requestHash: exactHash, invoice: inv.invoice, facilitator } },
    ];
    const pr = { x402Version: X402_VERSION, error: 'PAYMENT-SIGNATURE header is required', resource: { url: urlOf(req), description, mimeType: 'application/json' }, accepts };
    return { paid: false, status: 402, headers: { 'payment-required': encodeHeader(pr) }, body: pr };
  }

  return {
    facilitatorInfo,
    /** Check the request's payment. Returns { paid: true, finalize } or a response to send. */
    async require(req, rawBody, price) {
      const sig = req.headers['payment-signature'];
      if (!sig) return challenge(req, rawBody, price);
      let payload;
      try {
        payload = decodeHeader(sig);
      } catch {
        return { paid: false, status: 400, headers: {}, body: { error: 'malformed PAYMENT-SIGNATURE' } };
      }
      const a = payload.accepted ?? {};
      const m = await facilitatorInfo();
      // The server's own terms: never the client's echo (amount, payTo, asset, network, request hash).
      const requirements = { ...a, network: m.network, asset: m.asset, payTo: m.merchant, amount: String(price.amount), maxTimeoutSeconds: timeoutSeconds,
        extra: { ...a.extra, requestBindingProfile: 'http:1', requestBindingParams: { headers: boundHeaders }, requestHash: hashFor(req, rawBody, a.scheme, a.extra?.assetTransferMethod) } };
      const reqBody = { x402Version: X402_VERSION, paymentPayload: payload, paymentRequirements: requirements };
      if (a.scheme === 'exact') {
        const s = await call('/settle', reqBody); // upfront: settle before the resource runs
        if (!s.success) return { paid: false, status: 402, headers: { 'payment-response': encodeHeader(s) }, body: s };
        return { paid: true, settlement: s, finalize: async () => ({ headers: { 'payment-response': encodeHeader(s) }, settlement: s }) };
      }
      if (a.scheme === 'batch-settlement') {
        const v = await call('/verify', reqBody); // authorization: verify → resource → settle
        if (!v.isValid) return { paid: false, status: 402, headers: {}, body: v };
        return {
          paid: true,
          finalize: async (actualAmount) => {
            const s = await call('/settle', { ...reqBody, paymentRequirements: { ...requirements, amount: String(actualAmount ?? price.amount) } });
            return { headers: { 'payment-response': encodeHeader(s) }, settlement: s };
          },
        };
      }
      return { paid: false, status: 400, headers: {}, body: { error: `unsupported scheme ${a.scheme}` } };
    },
  };
}
