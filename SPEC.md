# x402 for Bitcoin USDT (RGB)

Pay-per-request HTTP APIs, paid in **USDT on Bitcoin**. This is a binding of the
[x402 protocol (v2)](https://github.com/coinbase/x402) to [RGB](https://rgb.tech), the
client-side-validated asset layer on Bitcoin. Existing x402 servers and clients keep working: our
payment options are two more entries in a 402's `accepts` list, and clients that don't know them
skip them.

- **`exact` / `rgb-invoice`**: pay each request with an RGB transfer. Settles in seconds (accepted
  at 0-conf up to a cap).
- **`batch-settlement` / `rgb-prepaid`**: deposit once, then pay each request with a signed voucher.
  Sub-second, no on-chain transaction per call: built for agents making many calls.

This repository holds the [`x402-rgb`](#the-x402-rgb-package) package (client wrapper, server paywall,
request binding, vouchers) and this specification. A hosted facilitator runs at
`rgb.tollylabs.com`; a standalone, self-hostable facilitator is being extracted for this repository.

| | |
|---|---|
| Facilitator (signet) | `https://rgb.tollylabs.com/api/x402` |
| Live demo | `GET https://rgb.tollylabs.com/api/x402/demo/fortune` (0.01 USDT) |
| Network (signet) | `bip122:00000008819873e925422c1ff0f99f7c` (UTEXO signet) |
| Asset | the facilitator's USDT RGB contract: `GET /api/x402/supported` |

> Signet is a test network: coins have no value. Get test BTC and USDT from the faucet in the
> wallet at `https://rgb.tollylabs.com`.

---

## Contents

1. [How it works](#how-it-works)
2. [Quick start: sell an API](#quick-start-sell-an-api)
3. [Quick start: pay for an API](#quick-start-pay-for-an-api)
4. [Scheme: `exact` on RGB (`rgb-invoice`)](#scheme-exact-on-rgb-rgb-invoice)
5. [Scheme: `batch-settlement` on RGB (`rgb-prepaid`)](#scheme-batch-settlement-on-rgb-rgb-prepaid)
6. [Request binding](#request-binding)
7. [Facilitator API](#facilitator-api)
8. [The `x402-rgb` package](#the-x402-rgb-package)
9. [Security and trust](#security-and-trust)
10. [Errors](#errors)
11. [Networks](#networks)

---

## How it works

x402 uses HTTP `402 Payment Required`:

1. A client requests a paid resource.
2. The **resource server** (you) answers `402` with a `PAYMENT-REQUIRED` header: base64 JSON listing
   the payment options it accepts.
3. The client pays one option and retries with a `PAYMENT-SIGNATURE` header holding the proof.
4. The resource server asks the **facilitator** to check (`/verify`) and record (`/settle`) the
   payment, serves the request, and returns a `PAYMENT-RESPONSE` header with the settlement result.

The facilitator does the RGB work so your API doesn't have to: it issues RGB invoices, receives
and validates RGB transfers, tracks prepaid balances, and pays your earnings out to your RGB wallet.

```
client                         your API                         facilitator
  │  GET /resource               │                                    │
  │─────────────────────────────▶│  POST /challenge (RGB invoice)    │
  │                              │───────────────────────────────────▶│
  │  402 PAYMENT-REQUIRED        │◀───────────────────────────────────│
  │◀─────────────────────────────│                                    │
  │  pay invoice (RGB) or sign voucher                                │
  │  GET /resource + PAYMENT-SIGNATURE                                │
  │─────────────────────────────▶│  POST /settle (or /verify+/settle) │
  │                              │───────────────────────────────────▶│
  │  200 + PAYMENT-RESPONSE      │◀───────────────────────────────────│
  │◀─────────────────────────────│                                    │
```

**Amounts** are strings in atomic units of the asset. USDT has 6 decimals: `"10000"` = 0.01 USDT.

---

## Quick start: sell an API

1. **Create a merchant** (once). You get a merchant id (your `payTo`) and an API key, shown once:

   ```bash
   curl -X POST https://rgb.tollylabs.com/api/x402/merchants \
     -H 'content-type: application/json' -d '{"name":"My weather API"}'
   # {"merchant":"m_…","apiKey":"x402_sk_…","network":"bip122:…","asset":"rgb:…"}
   ```

   Or use the form at `https://rgb.tollylabs.com/x402`.

2. **Protect a route** with the paywall (any Node HTTP framework; this is plain `node:http`):

   ```js
   import http from 'node:http';
   import { createPaywall } from 'x402-rgb';

   const paywall = createPaywall({
     facilitator: 'https://rgb.tollylabs.com/api/x402',
     apiKey: process.env.X402_API_KEY,          // x402_sk_…
     publicUrl: 'https://api.example.com',       // your public origin (request binding)
   });

   http.createServer(async (req, res) => {
     if (req.url !== '/weather') return res.writeHead(404).end();
     const raw = '';                              // the raw body for POSTs (needed for binding)
     const r = await paywall.require(req, raw, { amount: '10000', description: 'Weather now' });
     if (!r.paid) return res.writeHead(r.status, { 'content-type': 'application/json', ...r.headers }).end(JSON.stringify(r.body));
     const data = { tempC: 21 };                  // your work
     const done = await r.finalize();             // settles prepaid vouchers (exact is already settled)
     res.writeHead(200, { 'content-type': 'application/json', ...done.headers }).end(JSON.stringify(data));
   }).listen(3000);
   ```

   Behind a proxy, make sure `publicUrl` is the origin clients actually call: the request URL is
   part of what a payment is bound to.

3. **Get paid out.** Earnings show in `GET /merchant`. Confirmed earnings can be paid to any RGB
   invoice from your wallet:

   ```bash
   curl https://rgb.tollylabs.com/api/x402/merchant -H "authorization: Bearer $X402_API_KEY"
   curl -X POST https://rgb.tollylabs.com/api/x402/payout -H "authorization: Bearer $X402_API_KEY" \
     -H 'content-type: application/json' -d '{"amount":"5000000","invoice":"rgb:…"}'
   ```

   Or connect your wallet at `https://rgb.tollylabs.com/x402` and press **Pay out**.

---

## Quick start: pay for an API

`wrapFetch` turns any `fetch` into one that answers 402s.

**Prepaid** (fast, many calls): deposit once, then every call is a signed voucher.

```js
import { wrapFetch, accountOf } from 'x402-rgb';

const secretKey = process.env.X402_PREPAID_KEY;   // 32-byte hex secp256k1 key; keep it secret
const account = accountOf(secretKey);              // your prepaid account id

// Deposit once: ask for an invoice, pay it from your RGB wallet.
const dep = await (await fetch('https://rgb.tollylabs.com/api/x402/deposit', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ account, amount: '1000000' }),   // 1 USDT
})).json();
await wallet.send({ invoice: dep.invoice, assetId: dep.asset, amount: 1_000_000 });

const paidFetch = wrapFetch(fetch, { prepaid: { secretKey } });
const res = await paidFetch('https://rgb.tollylabs.com/api/x402/demo/fortune');
console.log(await res.json());
```

**Exact** (pay per call with an RGB transfer): give `wrapFetch` a function that pays an RGB
invoice and returns the Bitcoin transaction id once the transfer is broadcast.

```js
import { WalletManager } from '@utexo/rgb-sdk';          // or your own RGB wallet
const paidFetch = wrapFetch(fetch, {
  payInvoice: async ({ invoice, amount, asset }) => {
    const r = await wallet.send({ invoice, assetId: asset, amount: Number(amount) });
    // RGB broadcasts once the receiver acknowledges: refresh until the tx is out.
    while (!(await fetch(`${indexerUrl}/tx/${r.txid}`)).ok) { await wallet.refreshWallet(); await sleep(1000); }
    return r.txid;
  },
});
```

`wrapFetch` checks the request binding before paying: it never pays for a request other than the
one it is making. Set `maxAmount` to cap what it will pay per call.

> One on-chain RGB payment spends a whole USDT allocation and returns change that is unconfirmed
> until the next block. Back-to-back `exact` payments from one allocation must wait for a block
> (about 30 s on UTEXO signet). For frequent calls use prepaid, or hold USDT in several allocations.

---

## Scheme: `exact` on RGB (`rgb-invoice`)

Modelled on the x402 `exact` Lightning binding (`lnbtc`).

- `scheme`: `"exact"`
- `network`: CAIP-2 Bitcoin network, see [Networks](#networks)
- `asset`: the RGB contract id of the token (USDT), e.g. `"rgb:YeWo…"`
- `amount`: atomic units, decimal string
- `payTo`: the facilitator merchant id (`m_…`)
- `extra.assetTransferMethod`: `"rgb-invoice"` (required)
- `extra.paymentFlow`: `"upfront"` (required): the payment settles before the resource runs
- `extra.invoice`: a fresh RGB invoice for exactly `amount` of `asset`, issued for this challenge
- `extra.requestHash`, `extra.requestBindingProfile` (`"http:1"`), `extra.requestBindingParams`:
  see [Request binding](#request-binding)
- `extra.facilitator`: facilitator base URL (informational)

**Flow.**

1. The resource server computes the request hash and asks the facilitator for an invoice bound
   to it (`POST /challenge`). The facilitator records invoice → (merchant, amount, request hash).
2. The client checks the binding, pays the RGB invoice and waits until the transfer is broadcast
   (RGB transfers broadcast once the receiver acknowledges the consignment).
3. The client retries with `PAYMENT-SIGNATURE` whose `payload` is:

   ```json
   { "invoice": "rgb:~/~/…", "txid": "<64-hex Bitcoin txid>" }
   ```

4. The resource server recomputes the request hash from the request it will execute (never from
   the client's echo) and calls `POST /settle`. It does not call `/verify` for this flow.
5. The facilitator checks: the invoice is its own, for this merchant, amount and request hash, and
   unused; its wallet has received and validated the RGB transfer to that invoice (status
   `WaitingConfirmations` or `Settled`) for at least `amount`; the txid matches and is broadcast.
   It then marks the invoice used, atomically. A second settle of the same proof fails with
   `duplicate_settlement`.

**0-conf.** Up to the facilitator's `zeroconfMax` (default 5 USDT, see `GET /merchant`) a payment
settles as soon as the consignment is valid and its transaction is broadcast. Above it, `/settle`
returns `settlement_pending` with the txid until the transaction confirms; retry the request then.
0-conf earnings are credited to the merchant as `pending` and move to `balance` when the transfer
confirms.

**Expiry.** The invoice expires after `maxTimeoutSeconds` (60–3600).

---

## Scheme: `batch-settlement` on RGB (`rgb-prepaid`)

A capital-backed [`batch-settlement`](https://github.com/coinbase/x402/tree/main/specs/schemes/batch-settlement)
binding: the client's commitment is backed by USDT it deposited with the facilitator.

- `scheme`: `"batch-settlement"`
- `network`, `asset`, `payTo`: as above
- `amount`: the maximum charge for this request (the server may settle less)
- `extra.assetTransferMethod`: `"rgb-prepaid"` (required)
- `extra.requestHash`, `extra.requestBindingProfile`, `extra.requestBindingParams`: as above
- `extra.facilitator`: where the client's prepaid balance lives

Payment flow: `authorization` (verify → resource → settle).

**Account.** A prepaid account is a secp256k1 key; its id is the 32-byte x-only public key (hex).
Deposits: `POST /deposit` returns an RGB invoice; the balance is credited when the transfer confirms.

**Voucher** (`payload`):

```json
{
  "account": "<x-only pubkey hex>",
  "network": "bip122:…", "asset": "rgb:…", "payTo": "m_…",
  "maxAmount": "10000",
  "requestHash": "<64 hex>",
  "nonce": "<32 random bytes, hex>",
  "expiry": 1793300000,
  "signature": "<BIP-340 Schnorr signature, 64 bytes hex>"
}
```

The signature is over `SHA-256(UTF8(JCS(v)))` where `v` is an object with every field above except
`signature`, each value as a string, plus `"domain": "x402:batch-settlement:rgb:rgb-prepaid:voucher:1"`.

**Verify** checks the signature, that `payTo`/`network`/`asset` match the requirements, that
`requestHash` equals the server's recomputed hash, `expiry` is in the future, `amount ≤ maxAmount`,
the nonce is unused, and the balance covers `amount`. **Settle** repeats the checks and, atomically,
debits the account, credits the merchant and records the nonce (replay key). The commitment
identifier (`v_…`) is returned in `transaction`.

**Redemption.** Value reaches the merchant through payouts (`POST /payout`) over RGB, from
confirmed deposits.

**Withdrawal.** The account owner withdraws unspent balance with a signed action:

```json
{ "account": "…", "action": "withdraw", "amount": "970000", "invoice": "rgb:…", "expiry": 1793300000, "signature": "…" }
```

signed like a voucher, with domain `"x402:rgb-prepaid:action:1"` (`signAction` in the package).

---

## Request binding

Profile `http:1`, as in the x402 `lnbtc` binding. A payment is bound to one request:

```
binding = {
  "domain":   "x402:<scheme>:rgb:<assetTransferMethod>:http:1",
  "method":   "GET",
  "url":      "https://api.example.com/weather?city=Lisbon",
  "bodyHash": hex(SHA-256(raw body bytes)),            // empty body → SHA-256 of nothing
  "headers":  [ { "name": "<bound header>", "valueHash": hex(SHA-256(0x01 || value)) or hex(SHA-256(0x00)) if absent } ]
}
requestHash = hex(SHA-256(UTF8(JCS(binding))))
```

`extra.requestBindingParams.headers` lists the headers the server binds (lowercase, sorted; empty
when none affect the response). The client computes the same hash and refuses to pay when it
differs from `extra.requestHash`. The server recomputes it on the paid retry; the facilitator
compares it with the invoice's (exact) or the voucher's (prepaid).

---

## Facilitator API

Base URL: `https://rgb.tollylabs.com/api/x402`. JSON in and out. Merchant endpoints need
`Authorization: Bearer <apiKey>`.

| Method | Path | Auth | What |
|---|---|---|---|
| GET | `/supported` | – | x402 `SupportedResponse`: kinds (scheme, network, extra) |
| POST | `/merchants` | – | Sign up: `{ name }` → `{ merchant, apiKey, network, asset }` (key shown once) |
| GET | `/merchant` | merchant | `{ merchant, name, network, asset, balance, pending, earned, paidOut, zeroconfMax }` |
| POST | `/challenge` | merchant | `{ amount, requestHash, maxTimeoutSeconds? }` → `{ invoice, expiresAt, payTo, network, asset }` |
| POST | `/verify` | merchant | x402 verify: `{ x402Version, paymentPayload, paymentRequirements }` → `VerifyResponse` |
| POST | `/settle` | merchant | x402 settle: same body → `SettlementResponse` |
| POST | `/payout` | merchant | `{ amount, invoice }`: pay confirmed earnings to an RGB invoice |
| POST | `/deposit` | – | `{ account, amount }` → `{ invoice, amount, asset, network }` |
| GET | `/accounts/:account` | – | `{ balance, spent, depositsPending }` |
| POST | `/withdraw` | signed | signed withdraw action (above) |
| GET | `/stats` | – | public totals |
| GET | `/demo/fortune` | x402 | the demo paid API (0.01 USDT) |

`/verify` and `/settle` answer `200` with `isValid: false` / `success: false` and a reason for a
payment that doesn't check out, as in the x402 spec; `4xx` is reserved for malformed requests and
auth.

---

## The `x402-rgb` package

Plain ESM JavaScript with TypeScript types; depends only on `@noble/curves` and `@noble/hashes`.
Works in Node 18+ and browsers.

| Export | |
|---|---|
| `createPaywall({ facilitator, apiKey, publicUrl, boundHeaders?, timeoutSeconds? })` | Server: `.require(req, rawBody, { amount, description })` → a 402 to send, or `{ paid, finalize }` |
| `wrapFetch(fetch, { prepaid?: { secretKey }, payInvoice?, maxAmount?, onPayment? })` | Client: a `fetch` that pays 402s |
| `paymentResponse(res)` | Decode a response's `PAYMENT-RESPONSE` |
| `requestHash({ scheme, atm, method, url, body?, headerNames?, headerValues? })` | The `http:1` binding |
| `signVoucher`, `verifyVoucher`, `accountOf`, `newNonce` | Prepaid vouchers |
| `signAction`, `verifyAction` | Signed account actions (withdraw) |
| `encodeHeader`, `decodeHeader`, `jcs`, `sha256hex` | Wire helpers |
| `CAIP2`, `ATM`, `X402_VERSION` | Constants |

---

## Security and trust

- **Custody.** The hosted facilitator receives payments into its own RGB wallet and holds merchant
  and prepaid balances as ledger entries until payout/withdrawal. That is a trust relationship; a
  self-hosted facilitator removes it (standalone facilitator coming to this repository).
- **0-conf.** Accepting before a block risks a double-spend; the facilitator caps 0-conf per
  payment (`zeroconfMax`). Price accordingly, or require confirmations above the cap.
- **Replay.** Exact: each invoice settles once. Prepaid: each voucher nonce settles once; vouchers
  expire.
- **Request binding.** A proof only pays for the request it was bound to; servers recompute the
  hash, never trust the client's echo; clients refuse a mismatched binding.
- **Keys.** The merchant API key can settle and pay out: keep it server-side. The prepaid secret
  key spends the prepaid balance: keep it like a wallet key.
- **Privacy.** RGB transfers are client-side validated: amounts and assets aren't visible on chain.

---

## Errors

`errorReason` / `invalidReason` values:

| Reason | Meaning |
|---|---|
| `invalid_x402_version`, `invalid_payload` | malformed request |
| `invalid_network`, `invalid_asset`, `invalid_pay_to`, `scheme_mismatch` | requirements don't match this facilitator/merchant |
| `invalid_asset_transfer_method`, `unsupported_scheme`, `unsupported_flow` | not an RGB option (or `/verify` on `exact`) |
| `invalid_request_binding` | request hash mismatch |
| `invalid_invoice`, `amount_mismatch` | exact: not this merchant's invoice/amount |
| `payment_not_received`, `payment_not_broadcast`, `payment_failed`, `insufficient_funds` | exact: the RGB transfer isn't there (yet) or is short |
| `settlement_pending` | exact: above the 0-conf cap and not yet confirmed; `transaction` holds the txid |
| `duplicate_settlement` | proof or voucher already used |
| `invalid_signature`, `invalid_voucher_terms`, `voucher_expired`, `amount_exceeds_voucher` | prepaid voucher problems |

---

## Networks

| Network | CAIP-2 |
|---|---|
| Bitcoin mainnet | `bip122:000000000019d6689c085ae165831e93` |
| Signet (incl. UTEXO signet) | `bip122:00000008819873e925422c1ff0f99f7c` |
| Regtest | `bip122:0f9188f13cb7b2c71f2a335e3a4fc328` |

All signets share the signet genesis block, so CAIP-2 can't tell them apart; the `asset` (RGB
contract) and the facilitator do.
