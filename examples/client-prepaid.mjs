// Pay for an x402 API with prepaid vouchers: deposit once, then each call is a signed voucher.
//   node examples/client-prepaid.mjs                    → prints your account id + a deposit invoice
//   X402_PREPAID_KEY=<64 hex> node examples/client-prepaid.mjs <url>
// Pay the deposit invoice from any RGB wallet holding the facilitator's USDT (e.g. the wallet at
// https://rgb.tollylabs.com, Receive/Send). The balance counts once the transfer confirms.
import crypto from 'node:crypto';
import { wrapFetch, paymentResponse, accountOf } from '../src/index.js';

const FACILITATOR = process.env.X402_FACILITATOR ?? 'https://rgb.tollylabs.com/api/x402';
const secretKey = process.env.X402_PREPAID_KEY ?? crypto.randomBytes(32).toString('hex');
const account = accountOf(secretKey);
const url = process.argv[2] ?? 'https://rgb.tollylabs.com/api/x402/demo/fortune';

const bal = await (await fetch(`${FACILITATOR}/accounts/${account}`)).json();
console.log(`account ${account}\nbalance ${bal.balance} (pending deposits ${bal.depositsPending})`);
if (BigInt(bal.balance) === 0n) {
  if (!process.env.X402_PREPAID_KEY) console.log(`\nnew key (save it): X402_PREPAID_KEY=${secretKey}`);
  const dep = await (await fetch(`${FACILITATOR}/deposit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, amount: '1000000' }) })).json();
  console.log(`\npay this RGB invoice (1 USDT) to fund the account:\n${dep.invoice}`);
  process.exit(0);
}
const paidFetch = wrapFetch(fetch, { prepaid: { secretKey }, maxAmount: 100_000n });
const t = Date.now();
const res = await paidFetch(url);
console.log(res.status, await res.json(), paymentResponse(res), `${Date.now() - t} ms`);
