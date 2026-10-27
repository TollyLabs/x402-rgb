// Request binding (profile http:1, as in the x402 lnbtc binding): the payment is tied to one exact
// request, so a proof can't be replayed for another URL, method, body or bound header.
//   requestHash = SHA-256(UTF8(JCS(binding)))
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export const sha256hex = (bytes) => bytesToHex(sha256(typeof bytes === 'string' ? utf8ToBytes(bytes) : bytes));

/** JSON Canonicalization (RFC 8785) for the shapes used here: strings, safe integers, arrays, objects. */
export function jcs(v) {
  if (v === null || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new Error('jcs: only safe integers');
    return String(v);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jcs).join(',')}]`;
  if (typeof v === 'object') {
    const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); // UTF-16 code unit order
    return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(',')}}`;
  }
  throw new Error(`jcs: unsupported ${typeof v}`);
}

/**
 * Request hash for profile http:1. `headers`: the bound header names (lowercase, sorted), with the
 * request's values (absent → hash of 0x00). `body`: the raw content bytes (Uint8Array or string).
 */
export function requestHash({ scheme, atm, method, url, body = '', headerNames = [], headerValues = {} }) {
  const bodyBytes = typeof body === 'string' ? utf8ToBytes(body) : body;
  const headers = headerNames.map((name) => {
    const v = headerValues[name];
    const bytes = v === undefined || v === null ? new Uint8Array([0]) : new Uint8Array([1, ...utf8ToBytes(String(v))]);
    return { name, valueHash: sha256hex(bytes) };
  });
  const binding = { domain: `x402:${scheme}:rgb:${atm}:http:1`, method: method.toUpperCase(), url, bodyHash: sha256hex(bodyBytes), headers };
  return sha256hex(jcs(binding));
}

// Base64 of UTF-8 JSON, for the PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE headers.
export function encodeHeader(obj) {
  const bytes = utf8ToBytes(JSON.stringify(obj));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function decodeHeader(value) {
  const s = atob(String(value));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(s, (c) => c.charCodeAt(0))));
}
