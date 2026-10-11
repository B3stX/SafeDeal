import { Currency, baseUnitsToToken, baseUnitsToUsd, computeFeeSplit } from './priceMath';

export type { Currency } from './priceMath';
export type DealStatus = 'created' | 'funded' | 'submitted' | 'completed' | 'cancelled';
export type DealRole = 'creator' | 'worker' | 'viewer';

export interface Deal {
    address: string;
    dealId: string;
    creator: string;
    worker: string | null;
    /** Escrowed amount in base units (lamports for SOL, 1e-6 for USDC) */
    amount: number;
    currency: Currency;
    /** SPL mint for token deals, null for native SOL */
    mint: string | null;
    status: DealStatus;
    /** ms timestamp */
    deadline: number;
    /** ms timestamp */
    createdAt: number;
    title: string;
    description: string;
    submission: string;
}

export const DEFAULT_DEADLINE_DAYS = 7;
export const MAX_TITLE_LEN = 64;
export const MAX_DESCRIPTION_LEN = 256;
export const MAX_SUBMISSION_LEN = 200;
export { PLATFORM_FEE_BPS } from './priceMath';

const CLUSTER = 'devnet';

export const solscanTx = (sig: string) => `https://solscan.io/tx/${sig}?cluster=${CLUSTER}`;
export const solscanAccount = (addr: string) => `https://solscan.io/account/${addr}?cluster=${CLUSTER}`;

export const shortAddress = (addr: string, chars = 4) => `${addr.slice(0, chars)}…${addr.slice(-chars)}`;

/** Format a token amount (base units) for display */
export const formatToken = (units: number, currency: Currency) => {
    const n = baseUnitsToToken(units, currency);
    if (n === 0) return '0';
    const maxDigits = currency === 'SOL' ? 4 : 2;
    if (n < Math.pow(10, -maxDigits)) return `<${Math.pow(10, -maxDigits)}`;
    return n.toLocaleString('en-US', { maximumFractionDigits: maxDigits });
};

export const formatUsd = (usd: number) => {
    if (usd > 0 && usd < 0.01) return '<$0.01';
    return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
};

/** USD value of a deal, or null when the SOL price is unknown */
export const dealUsd = (deal: Pick<Deal, 'amount' | 'currency'>, solUsd: number | null) =>
    baseUnitsToUsd(deal.amount, deal.currency, solUsd);

/** Mirrors the on-chain 2% fee split (floor) */
export const computePayout = (units: number) => {
    const { fee, worker } = computeFeeSplit(BigInt(Math.round(units)));
    return { fee: Number(fee), worker: Number(worker) };
};

export const formatDate = (ms: number) =>
    new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export const formatRelative = (ms: number) => {
    const diff = ms - Date.now();
    const abs = Math.abs(diff);
    const mins = Math.round(abs / 60_000);
    const hours = Math.round(abs / 3_600_000);
    const days = Math.round(abs / 86_400_000);
    const unit = mins < 60 ? `${mins}m` : hours < 48 ? `${hours}h` : `${days}d`;
    return diff >= 0 ? `in ${unit}` : `${unit} ago`;
};

export const isDeadlinePassed = (deal: Deal) => Date.now() > deal.deadline;

export const statusLabel = (s: DealStatus) =>
    ({
        created: 'Unfunded',
        funded: 'Active',
        submitted: 'Submitted',
        completed: 'Completed',
        cancelled: 'Cancelled',
    })[s];

export const getRole = (deal: Deal, wallet: string | null): DealRole => {
    if (!wallet) return 'viewer';
    if (deal.creator === wallet) return 'creator';
    if (deal.worker === wallet) return 'worker';
    return 'viewer';
};

/** Mirrors the on-chain rules so users only see buttons that will succeed */
export const getAvailableActions = (deal: Deal, wallet: string | null) => {
    const none = { canFund: false, canSubmit: false, canApprove: false, canCancel: false };
    if (!wallet) return none;
    const isCreator = deal.creator === wallet;
    const expired = isDeadlinePassed(deal);
    return {
        canFund: isCreator && deal.status === 'created',
        canSubmit:
            !isCreator &&
            deal.status === 'funded' &&
            !expired &&
            (deal.worker === null || deal.worker === wallet),
        canApprove: isCreator && deal.status === 'submitted',
        canCancel: isCreator && (deal.status === 'created' || (deal.status === 'funded' && expired)),
    };
};
