# x402-rgb

**x402 payments in USDT on Bitcoin.** Charge for any HTTP API per request, paid in Bitcoin-native
USDT over [RGB](https://rgb.tech), using the [x402 protocol (v2)](https://github.com/coinbase/x402).

- **Pay per call** (`exact` / `rgb-invoice`): each request is paid with an RGB transfer, accepted in
  seconds (0-conf up to a cap).
- **Prepaid** (`batch-settlement` / `rgb-prepaid`): deposit once, then each request carries a
  BIP-340-signed voucher. Sub-second, no on-chain transaction per call, made for agents.
- **Standard x402 v2:** `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`, facilitator
  `/verify` `/settle` `/supported`, CAIP-2 networks. Clients that don't know these schemes skip them.
- **Bound to the request:** a payment only pays for the exact request (method, URL, body, chosen
  headers) it was made for; clients refuse to pay for anything else.

Try it live (UTEXO signet, test coins): **https://rgb.tollylabs.com/x402**

## Install

```bash
npm install github:TollyLabs/x402-rgb
```

Plain ESM JavaScript with TypeScript types. Node 20+ and browsers. Depends only on `@noble/curves`
and `@noble/hashes`.

## Sell an API

```js
import { createPaywall } from 'x402-rgb';

const paywall = createPaywall({
  facilitator: 'https://rgb.tollylabs.com/api/x402',
  apiKey: process.env.X402_API_KEY,      // from POST /api/x402/merchants {"name": "…"}
  publicUrl: 'https://api.example.com',   // the origin your clients call
});

// in a request handler (rawBody: the exact request body, '' for GET)
const r = await paywall.require(req, rawBody, { amount: '10000' }); // 0.01 USDT (6 decimals)
if (!r.paid) return send(r.status, r.headers, r.body);           // 402 + PAYMENT-REQUIRED
const done = await r.finalize();                                   // settle
send(200, done.headers, result);                                   // + PAYMENT-RESPONSE
```

Full runnable example: [examples/server.mjs](examples/server.mjs).

## Pay for an API

```js
import { wrapFetch } from 'x402-rgb';

// prepaid vouchers (deposit once to the facilitator, then call away)
const paidFetch = wrapFetch(fetch, { prepaid: { secretKey }, maxAmount: 100_000n });

// or pay each call from your RGB wallet
const payPerCall = wrapFetch(fetch, { payInvoice: async ({ invoice, amount, asset }) => txid });

const res = await paidFetch('https://rgb.tollylabs.com/api/x402/demo/fortune');
```

Examples: [prepaid](examples/client-prepaid.mjs), [pay per call with UTEXO's RGB SDK](examples/client-exact.mjs).

## Specification

[SPEC.md](SPEC.md): how it works, both scheme bindings, request binding, facilitator API, package
API, security model, error codes, networks.

## Test

```bash
pnpm install && pnpm test
```

## Status

Running on UTEXO's signet (test coins). The hosted facilitator at `rgb.tollylabs.com` is custodial
for balances between payment and payout; a standalone self-hostable facilitator is coming to this
repository.

## License

[MIT](LICENSE)
