import { PublicKey } from '@solana/web3.js';
import idl from '@/idl/safeDealIDL.json';

/** SafeDeal program deployed on Solana Devnet */
export const PROGRAM_ID = new PublicKey(idl.address);

/** Receives the 2% platform fee on completed deals (hardcoded in the program) */
export const TREASURY = new PublicKey('BtxpihJkeuj5MdtYoRWfRC2VJQfxTg4Fwht44mQp7Sk');

/** Circle's official devnet USDC mint (developers.circle.com/stablecoins/usdc-contract-addresses) */
export const USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

/** Pyth sponsored SOL/USD push-feed account (PriceUpdateV2), live on Solana devnet */
export const PYTH_SOL_USD_ACCOUNT = new PublicKey('7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE');
export const PYTH_SOL_USD_FEED_ID = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';

/** SafeDeal has no global config account — every deal is its own PDA. */
export const configAddress: PublicKey | null = null;
