// Types for x402-rgb (the implementation is plain ESM JavaScript).
export declare const CAIP2: { mainnet: string; signet: string; regtest: string };
export declare const X402_VERSION: 2;
export declare const ATM: { invoice: 'rgb-invoice'; prepaid: 'rgb-prepaid' };

export interface PaymentRequirements {
  scheme: 'exact' | 'batch-settlement' | string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, any>;
}
export interface PaymentRequired { x402Version: 2; error?: string; resource: { url: string; description?: string; mimeType?: string }; accepts: PaymentRequirements[]; extensions?: object }
export interface SettlementResponse { success: boolean; errorReason?: string; transaction: string; network: string; payer?: string; amount?: string }

export declare function sha256hex(data: string | Uint8Array): string;
export declare function jcs(v: unknown): string;
export declare function requestHash(p: { scheme: string; atm: string; method: string; url: string; body?: string | Uint8Array; headerNames?: string[]; headerValues?: Record<string, string | undefined> }): string;
export declare function encodeHeader(obj: unknown): string;
export declare function decodeHeader<T = any>(value: string): T;

export interface Voucher { account: string; network: string; asset: string; payTo: string; maxAmount: string; requestHash: string; nonce: string; expiry: number | string; signature: string }
export declare const VOUCHER_DOMAIN: string;
export declare function accountOf(secretKeyHex: string): string;
export declare function newNonce(): string;
export declare function signVoucher(fields: Omit<Voucher, 'account' | 'nonce' | 'signature'> & { nonce?: string }, secretKeyHex: string): Voucher;
export declare function verifyVoucher(v: Voucher): boolean;
export declare function signAction<T extends Record<string, unknown>>(fields: T, secretKeyHex: string): T & { account: string; signature: string };
export declare function verifyAction(v: Record<string, unknown>): boolean;

export interface WrapOptions {
  prepaid?: { secretKey: string };
  payInvoice?: (p: { invoice: string; amount: bigint; asset: string; network: string }) => Promise<string>;
  maxAmount?: bigint | number | string;
  onPayment?: (p: { requirements: PaymentRequirements; payload: unknown }) => void;
}
export declare function wrapFetch(fetchFn: typeof fetch, opts?: WrapOptions): typeof fetch;
export declare function paymentResponse(res: Response): SettlementResponse | null;

export interface Paywall {
  facilitatorInfo(): Promise<{ merchant: string; name: string; network: string; asset: string }>;
  require(req: { method: string; url: string; headers: Record<string, string | string[] | undefined> }, rawBody: string | Uint8Array, price: { amount: string; description?: string }):
    Promise<{ paid: false; status: number; headers: Record<string, string>; body: unknown } | { paid: true; settlement?: SettlementResponse; finalize: (actualAmount?: string) => Promise<{ headers: Record<string, string>; settlement: SettlementResponse }> }>;
}
export declare function createPaywall(o: { facilitator: string; apiKey: string; publicUrl: string; boundHeaders?: string[]; timeoutSeconds?: number; fetchFn?: typeof fetch }): Paywall;
