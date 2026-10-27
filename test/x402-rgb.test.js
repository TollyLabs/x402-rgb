import test from 'node:test';
import assert from 'node:assert/strict';
import { jcs, requestHash, encodeHeader, decodeHeader, sha256hex } from '../src/binding.js';
import { signVoucher, verifyVoucher, accountOf, signAction, verifyAction } from '../src/voucher.js';
import { wrapFetch, paymentResponse } from '../src/client.js';
import { createPaywall } from '../src/server.js';
import { CAIP2, ATM } from '../src/networks.js';

const SK = '11'.repeat(32);

test('JCS sorts keys and keeps strings/integers exact', () => {
  assert.equal(jcs({ b: [1, 'x'], a: { d: 1, c: 'é' } }), '{"a":{"c":"é","d":1},"b":[1,"x"]}');
  assert.throws(() => jcs({ a: 1.5 }));
});

test('request hash binds method, url, body and bound headers', () => {
  const base = { scheme: 'exact', atm: ATM.invoice, method: 'GET', url: 'https://a.test/x?y=1' };
  const h = requestHash(base);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(requestHash({ ...base, method: 'get' }), h, 'method is upper-cased');
  assert.notEqual(requestHash({ ...base, url: 'https://a.test/x?y=2' }), h);
  assert.notEqual(requestHash({ ...base, body: 'x' }), h);
  assert.notEqual(requestHash({ ...base, scheme: 'batch-settlement', atm: ATM.prepaid }), h, 'domain separates schemes');
  const withHdr = requestHash({ ...base, headerNames: ['accept'], headerValues: { accept: 'application/json' } });
  const absent = requestHash({ ...base, headerNames: ['accept'], headerValues: {} });
  const empty = requestHash({ ...base, headerNames: ['accept'], headerValues: { accept: '' } });
  assert.notEqual(withHdr, absent);
  assert.notEqual(absent, empty, 'absent and empty differ');
});

test('headers round-trip base64 JSON with unicode', () => {
  assert.deepEqual(decodeHeader(encodeHeader({ a: 'é✓', n: 1 })), { a: 'é✓', n: 1 });
});

test('vouchers: valid, tamper-evident, account = x-only pubkey', () => {
  const v = signVoucher({ network: CAIP2.signet, asset: 'rgb:a', payTo: 'm_1', maxAmount: '10000', requestHash: sha256hex('r'), expiry: 2000000000 }, SK);
  assert.equal(v.account, accountOf(SK));
  assert.match(v.account, /^[0-9a-f]{64}$/);
  assert.ok(verifyVoucher(v));
  for (const k of ['maxAmount', 'payTo', 'requestHash', 'expiry', 'nonce']) assert.equal(verifyVoucher({ ...v, [k]: '9' + v[k] }), false, `${k} is signed`);
  assert.equal(verifyVoucher({ ...v, account: accountOf('22'.repeat(32)) }), false);
});

test('signed actions verify and are tamper-evident', () => {
  const a = signAction({ action: 'withdraw', amount: '5', invoice: 'rgb:x', expiry: 1 }, SK);
  assert.ok(verifyAction(a));
  assert.equal(verifyAction({ ...a, amount: '6' }), false);
});

// A tiny in-memory facilitator + resource server, wired through wrapFetch → createPaywall.
function harness({ settleOk = true } = {}) {
  const calls = [];
  const facilitator = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push(path);
    const body = init?.body ? JSON.parse(init.body) : null;
    const ok = (j) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path === '/merchant') return ok({ merchant: 'm_test', network: CAIP2.regtest, asset: 'rgb:usdt' });
    if (path === '/challenge') return ok({ invoice: `rgb:inv-${body.requestHash.slice(0, 8)}` });
    if (path === '/settle') return ok(settleOk ? { success: true, transaction: 'ab'.repeat(32), network: CAIP2.regtest, amount: body.paymentRequirements.amount } : { success: false, errorReason: 'payment_not_received', transaction: '', network: CAIP2.regtest });
    if (path === '/verify') return ok({ isValid: true, payer: body.paymentPayload.payload.account });
    return new Response('{}', { status: 404 });
  };
  const paywall = createPaywall({ facilitator: 'https://f.test', apiKey: 'k', publicUrl: 'https://api.test', fetchFn: facilitator });
  const server = async (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const r = await paywall.require({ method: init.method ?? 'GET', url: u.pathname + u.search, headers }, init.body ?? '', { amount: '10000' });
    if (!r.paid) return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers });
    const done = await r.finalize();
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: done.headers });
  };
  return { calls, server };
}

test('exact: client pays the invoice, server settles upfront', async () => {
  const { calls, server } = harness();
  let paid = null;
  const f = wrapFetch(server, { payInvoice: async (p) => ((paid = p), 'cd'.repeat(32)) });
  const res = await f('https://api.test/thing?q=1');
  assert.equal(res.status, 200);
  assert.equal(paid.amount, 10000n);
  assert.ok(paid.invoice.startsWith('rgb:inv-'));
  assert.equal(paymentResponse(res).success, true);
  assert.deepEqual(calls.filter((c) => c !== '/merchant'), ['/challenge', '/settle']);
});

test('prepaid: voucher → verify, then settle after the resource', async () => {
  const { calls, server } = harness();
  const f = wrapFetch(server, { prepaid: { secretKey: SK } });
  const res = await f('https://api.test/thing');
  assert.equal(res.status, 200);
  assert.ok(calls.includes('/verify') && calls.includes('/settle'));
  assert.ok(calls.indexOf('/verify') < calls.lastIndexOf('/settle'));
});

test('client refuses to pay for a different request than it makes', async () => {
  const { server } = harness();
  // A server that binds the payment to another URL.
  const liar = async (input, init) => {
    const r = await server('https://api.test/other', init);
    return r;
  };
  const f = wrapFetch(liar, { payInvoice: async () => assert.fail('must not pay') });
  await assert.rejects(f('https://api.test/thing'), /different request/);
});

test('settle failure returns 402 with the reason', async () => {
  const { server } = harness({ settleOk: false });
  const f = wrapFetch(server, { payInvoice: async () => 'cd'.repeat(32) });
  const res = await f('https://api.test/thing');
  assert.equal(res.status, 402);
  assert.equal(paymentResponse(res).errorReason, 'payment_not_received');
});

test('maxAmount caps what the client pays', async () => {
  const { server } = harness();
  const f = wrapFetch(server, { payInvoice: async () => assert.fail('over budget'), maxAmount: 9999n });
  const res = await f('https://api.test/thing');
  assert.equal(res.status, 402);
});
