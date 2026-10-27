// Prepaid vouchers (batch-settlement / rgb-prepaid): a BIP-340 Schnorr signature by the payer's
// account key over the JCS of the voucher fields. The account id is the x-only public key (hex).
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { jcs, sha256hex } from './binding.js';

export const VOUCHER_DOMAIN = 'x402:batch-settlement:rgb:rgb-prepaid:voucher:1';
const FIELDS = ['account', 'network', 'asset', 'payTo', 'maxAmount', 'requestHash', 'nonce', 'expiry'];

export const accountOf = (secretHex) => bytesToHex(schnorr.getPublicKey(hexToBytes(secretHex)));
export const newNonce = () => bytesToHex(crypto.getRandomValues(new Uint8Array(32)));

function digest(v) {
  const body = { domain: VOUCHER_DOMAIN };
  for (const f of FIELDS) {
    if (v[f] === undefined || v[f] === null || v[f] === '') throw new Error(`voucher: ${f} missing`);
    body[f] = String(v[f]);
  }
  return hexToBytes(sha256hex(jcs(body)));
}

/** Sign a voucher: { network, asset, payTo, maxAmount, requestHash, expiry } → with account, nonce, signature. */
export function signVoucher(fields, secretHex) {
  const v = { ...fields, account: accountOf(secretHex), nonce: fields.nonce ?? newNonce() };
  return { ...v, signature: bytesToHex(schnorr.sign(digest(v), hexToBytes(secretHex))) };
}

export function verifyVoucher(v) {
  try {
    return schnorr.verify(hexToBytes(v.signature), digest(v), hexToBytes(v.account));
  } catch {
    return false;
  }
}

/** Signed account action (prepaid withdraw): { account, action, amount, invoice, expiry, signature }. */
export function signAction(fields, secretHex) {
  const v = { ...fields, account: accountOf(secretHex) };
  const d = hexToBytes(sha256hex(jcs({ domain: 'x402:rgb-prepaid:action:1', ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)])) })));
  return { ...v, signature: bytesToHex(schnorr.sign(d, hexToBytes(secretHex))) };
}
export function verifyAction(v) {
  const { signature, ...rest } = v;
  try {
    const d = hexToBytes(sha256hex(jcs({ domain: 'x402:rgb-prepaid:action:1', ...Object.fromEntries(Object.entries(rest).map(([k, x]) => [k, String(x)])) })));
    return schnorr.verify(hexToBytes(signature), d, hexToBytes(v.account));
  } catch {
    return false;
  }
}
