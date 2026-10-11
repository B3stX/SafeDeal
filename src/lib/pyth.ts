import { Connection } from '@solana/web3.js';
import { PYTH_SOL_USD_ACCOUNT, PYTH_SOL_USD_FEED_ID } from './configAddress';
import { decodePriceUpdateV2, isPriceUsable, scaleByExpo } from './priceMath';

export type PriceSource = 'pyth-devnet' | 'pyth-hermes';

export interface SolUsdQuote {
    price: number;
    conf: number;
    /** unix seconds */
    publishTime: number;
    source: PriceSource;
}

const HERMES_URL = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=0x${PYTH_SOL_USD_FEED_ID}&parsed=true`;

/** Read the sponsored SOL/USD PriceUpdateV2 account directly from the devnet RPC */
async function fromDevnetAccount(connection: Connection): Promise<SolUsdQuote> {
    const info = await connection.getAccountInfo(PYTH_SOL_USD_ACCOUNT, 'confirmed');
    if (!info) throw new Error('Pyth SOL/USD account not found on devnet');
    const p = decodePriceUpdateV2(info.data);
    if (p.feedIdHex !== PYTH_SOL_USD_FEED_ID) throw new Error('Unexpected Pyth feed id');
    if (!isPriceUsable(p, Math.floor(Date.now() / 1000))) throw new Error('Devnet Pyth price is stale');
    return { price: p.price, conf: p.conf, publishTime: p.publishTime, source: 'pyth-devnet' };
}

/** Fallback: Pyth's Hermes API (same feed id, signed off-chain updates) */
async function fromHermes(): Promise<SolUsdQuote> {
    const res = await fetch(HERMES_URL);
    if (!res.ok) throw new Error(`Hermes HTTP ${res.status}`);
    const json = await res.json();
    const raw = json?.parsed?.[0]?.price;
    if (!raw) throw new Error('Hermes returned no price');
    const q: SolUsdQuote = {
        price: scaleByExpo(BigInt(raw.price), raw.expo),
        conf: scaleByExpo(BigInt(raw.conf), raw.expo),
        publishTime: Number(raw.publish_time),
        source: 'pyth-hermes',
    };
    if (!isPriceUsable(q, Math.floor(Date.now() / 1000))) throw new Error('Hermes price is stale');
    return q;
}

export async function fetchSolUsd(connection: Connection): Promise<SolUsdQuote> {
    try {
        return await fromDevnetAccount(connection);
    } catch {
        return await fromHermes();
    }
}
