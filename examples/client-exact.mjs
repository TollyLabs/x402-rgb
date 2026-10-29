// Pay for an x402 API per call with an RGB transfer (scheme exact / rgb-invoice), from a Node RGB
// wallet built with UTEXO's SDK:   npm install @utexo/rgb-sdk   (Linux x64; see its README)
//   RGB_MNEMONIC="…" node examples/client-exact.mjs <url>
import { WalletManager, restoreKeys } from '@utexo/rgb-sdk';
import { wrapFetch, paymentResponse } from '../src/index.js';

const INDEXER = process.env.INDEXER_URL ?? 'https://dev.esplora-01.mint.utexo.com';
const TRANSPORT = process.env.TRANSPORT_ENDPOINT ?? 'rpcs://rgb.tollylabs.com/rgb-proxy/json-rpc'; // an RGB proxy speaking protocol 0.2 (what the current kits speak)
const keys = await restoreKeys('signet', process.env.RGB_MNEMONIC);
const wallet = new WalletManager({
  xpubVan: keys.accountXpubVanilla, xpubCol: keys.accountXpubColored, masterFingerprint: keys.masterFingerprint,
  mnemonic: process.env.RGB_MNEMONIC, network: 'signet', indexerUrl: INDEXER, transportEndpoint: TRANSPORT, dataDir: './.rgb-wallet',
});
await wallet.initialize();
await wallet.syncWallet();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const paidFetch = wrapFetch(fetch, {
  maxAmount: 100_000n, // never pay more than 0.10 USDT per call
  payInvoice: async ({ invoice, amount, asset }) => {
    const r = await wallet.send({ invoice, assetId: asset, amount: Number(amount) });
    // RGB broadcasts once the receiver has acknowledged the transfer: refresh until it's out.
    for (let i = 0; i < 60 && !(await fetch(`${INDEXER}/tx/${r.txid}`)).ok; i++) await (wallet.refreshWallet(), sleep(1000));
    return r.txid;
  },
});
const res = await paidFetch(process.argv[2] ?? 'https://rgb.tollylabs.com/api/x402/demo/fortune');
console.log(res.status, await res.json(), paymentResponse(res));
