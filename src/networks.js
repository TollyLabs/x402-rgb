// CAIP-2 ids for Bitcoin networks (BIP-122 convention: first 32 hex chars of the genesis hash).
// RGB assets live on Bitcoin, so the x402 `network` is the Bitcoin chain; `asset` is the RGB contract.
export const CAIP2 = {
  mainnet: 'bip122:000000000019d6689c085ae165831e93',
  signet: 'bip122:00000008819873e925422c1ff0f99f7c',
  regtest: 'bip122:0f9188f13cb7b2c71f2a335e3a4fc328',
};
export const X402_VERSION = 2;
/** assetTransferMethod values this binding defines. */
export const ATM = { invoice: 'rgb-invoice', prepaid: 'rgb-prepaid' };
