// A paid API in 30 lines: GET /weather costs 0.01 USDT, paid over x402 in Bitcoin USDT.
//   X402_API_KEY=x402_sk_… PUBLIC_URL=http://localhost:3000 node examples/server.mjs
// Get an API key: POST https://rgb.tollylabs.com/api/x402/merchants {"name":"…"} (or https://rgb.tollylabs.com/x402).
import http from 'node:http';
import { createPaywall } from '../src/index.js';

const paywall = createPaywall({
  facilitator: process.env.X402_FACILITATOR ?? 'https://rgb.tollylabs.com/api/x402',
  apiKey: process.env.X402_API_KEY,
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:3000', // the origin clients call: part of the request binding
});

http.createServer(async (req, res) => {
  const send = (status, headers, body) => res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));
  if (req.url !== '/weather') return send(404, {}, { error: 'not found' });
  let raw = '';
  for await (const chunk of req) raw += chunk; // the exact body bytes are part of the binding
  try {
    const r = await paywall.require(req, raw, { amount: '10000', description: 'Current weather (0.01 USDT)' });
    if (!r.paid) return send(r.status, r.headers, r.body); // 402 + PAYMENT-REQUIRED
    const result = { city: 'Lisbon', tempC: 21, sky: 'clear' }; // your work here
    const done = await r.finalize(); // prepaid: settle now; exact: already settled upfront
    send(200, done.headers, result);
  } catch (e) {
    send(502, {}, { error: `facilitator: ${e.message}` });
  }
}).listen(3000, () => console.log('paid API on http://localhost:3000/weather'));
