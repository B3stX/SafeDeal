/**
 * Pure, dependency-free price math shared by the UI and the contract test suite
 * (contracts/tests imports this file directly). Keep it free of imports.
 */

export type Currency = 'SOL' | 'USDC';

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const USDC_DECIMALS = 6;
export const USDC_UNITS = 10 ** USDC_DECIMALS;
export const PLATFORM_FEE_BPS = 200;

/** Price older than this is treated as stale (Pyth sponsored feed heartbeat is ~55s) */
export const MAX_PRICE_AGE_SEC = 120;
/** Reject prices whose confidence interval is wider than 2% of the price */
export const MAX_CONF_RATIO = 0.02;

export const decimalsOf = (c: Currency) => (c === 'SOL' ? 9 : USDC_DECIMALS);
export const unitsPerToken = (c: Currency) => (c === 'SOL' ? LAMPORTS_PER_SOL : USDC_UNITS);

export interface PythPrice {
    /** Price as a float in USD */
    price: number;
    /** Confidence interval as a float in USD */
    conf: number;
    expo: number;
    /** unix seconds */
    publishTime: number;
    /** 64-char lowercase hex, no 0x */
    feedIdHex: string;
}

/**
 * Decode a Pyth `PriceUpdateV2` account (pyth-solana-receiver).
 * Layout: disc[8] | write_authority[32] | verification_level (enum: Partial{u8}=2 bytes, Full=1 byte)
 *         | feed_id[32] | price i64 | conf u64 | exponent i32 | publish_time i64 | ...
 */
export function decodePriceUpdateV2(data: Uint8Array): PythPrice {
    if (data.length < 8 + 32 + 1 + 32 + 8 + 8 + 4 + 8) throw new Error('Price account too small');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const tag = data[40];
    if (tag !== 0 && tag !== 1) throw new Error('Unknown Pyth verification level');
    let o = tag === 0 ? 42 : 41;

    let feedIdHex = '';
    for (let i = 0; i < 32; i++) feedIdHex += data[o + i].toString(16).padStart(2, '0');
    o += 32;

    const rawPrice = view.getBigInt64(o, true);
    const rawConf = view.getBigUint64(o + 8, true);
    const expo = view.getInt32(o + 16, true);
    const publishTime = Number(view.getBigInt64(o + 20, true));

    return {
        price: scaleByExpo(rawPrice, expo),
        conf: scaleByExpo(rawConf, expo),
        expo,
        publishTime,
        feedIdHex,
    };
}

export function scaleByExpo(raw: bigint, expo: number): number {
    return Number(raw) * Math.pow(10, expo);
}

/** True if the price is fresh, positive and has a tight confidence interval */
export function isPriceUsable(
    p: Pick<PythPrice, 'price' | 'conf' | 'publishTime'>,
    nowSec: number,
    maxAgeSec = MAX_PRICE_AGE_SEC,
    maxConfRatio = MAX_CONF_RATIO,
): boolean {
    if (!Number.isFinite(p.price) || p.price <= 0) return false;
    if (nowSec - p.publishTime > maxAgeSec) return false;
    if (p.conf / p.price > maxConfRatio) return false;
    return true;
}

/** USD → lamports at a given SOL/USD price (rounded to nearest lamport) */
export function usdToLamports(usd: number, solUsd: number): bigint {
    if (!Number.isFinite(usd) || usd <= 0) throw new Error('USD amount must be positive');
    if (!Number.isFinite(solUsd) || solUsd <= 0) throw new Error('SOL price unavailable');
    return BigInt(Math.round((usd / solUsd) * LAMPORTS_PER_SOL));
}

/** USD → USDC base units (1:1, 6 decimals) */
export function usdToUsdcUnits(usd: number): bigint {
    if (!Number.isFinite(usd) || usd <= 0) throw new Error('USD amount must be positive');
    return BigInt(Math.round(usd * USDC_UNITS));
}

/** USD → base units for either currency */
export function usdToBaseUnits(usd: number, currency: Currency, solUsd: number | null): bigint {
    if (currency === 'USDC') return usdToUsdcUnits(usd);
    if (solUsd === null) throw new Error('SOL price unavailable');
    return usdToLamports(usd, solUsd);
}

/** Base units → USD value. Returns null for SOL when no price is available. */
export function baseUnitsToUsd(units: bigint | number, currency: Currency, solUsd: number | null): number | null {
    const n = Number(units);
    if (currency === 'USDC') return n / USDC_UNITS;
    if (solUsd === null || !(solUsd > 0)) return null;
    return (n / LAMPORTS_PER_SOL) * solUsd;
}

/** Base units → token float (display only) */
export function baseUnitsToToken(units: bigint | number, currency: Currency): number {
    return Number(units) / unitsPerToken(currency);
}

/** Mirrors the on-chain fee split: fee = floor(amount * 200 / 10000) */
export function computeFeeSplit(amount: bigint): { fee: bigint; worker: bigint } {
    const fee = (amount * BigInt(PLATFORM_FEE_BPS)) / 10_000n;
    return { fee, worker: amount - fee };
}
