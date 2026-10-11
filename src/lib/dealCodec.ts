/**
 * Hand-written Borsh decoder for the on-chain `Deal` account.
 * Zero imports so the contract test suite can import it directly.
 *
 * Layout (672 bytes incl. zero padding):
 *   disc[8] | deal_id u64 | creator [32] | worker Option<[32]> | amount u64 | status u8
 *   | deadline i64 | created_at i64 | title str | description str | submission str
 *   | bump u8 | mint Option<[32]>
 */

export const DEAL_DISCRIMINATOR = [125, 223, 160, 234, 71, 162, 182, 219] as const;
export const DEAL_ACCOUNT_SIZE = 672;
/** Accounts created before the USDC upgrade lack the trailing `mint` option (33 bytes) */
export const LEGACY_DEAL_ACCOUNT_SIZE = 639;

export const DEAL_STATUSES = ['created', 'funded', 'submitted', 'completed', 'cancelled'] as const;
export type DecodedDealStatus = (typeof DEAL_STATUSES)[number];

export interface DecodedDeal {
    dealId: bigint;
    creator: Uint8Array;
    worker: Uint8Array | null;
    amount: bigint;
    status: DecodedDealStatus;
    deadline: bigint;
    createdAt: bigint;
    title: string;
    description: string;
    submission: string;
    bump: number;
    mint: Uint8Array | null;
}

export function decodeDealAccount(data: Uint8Array): DecodedDeal {
    if (data.length < 8) throw new Error(`Deal account too small: ${data.length} bytes`);
    for (let i = 0; i < 8; i++) {
        if (data[i] !== DEAL_DISCRIMINATOR[i]) throw new Error('Invalid Deal discriminator');
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const utf8 = new TextDecoder();
    let o = 8;

    const need = (n: number) => {
        if (o + n > data.length) throw new Error(`Deal account truncated at offset ${o} (need ${n})`);
    };
    const u8 = () => (need(1), data[o++]);
    const u64 = () => (need(8), ((v) => ((o += 8), v))(view.getBigUint64(o, true)));
    const i64 = () => (need(8), ((v) => ((o += 8), v))(view.getBigInt64(o, true)));
    const bytes32 = () => (need(32), data.slice(o, (o += 32)));
    const opt32 = () => {
        const tag = u8();
        if (tag === 0) return null;
        if (tag === 1) return bytes32();
        throw new Error(`Invalid option tag ${tag} at offset ${o - 1}`);
    };
    const str = () => {
        need(4);
        const len = view.getUint32(o, true);
        o += 4;
        need(len);
        return utf8.decode(data.subarray(o, (o += len)));
    };

    const dealId = u64();
    const creator = bytes32();
    const worker = opt32();
    const amount = u64();
    const statusIdx = u8();
    if (statusIdx >= DEAL_STATUSES.length) throw new Error(`Invalid DealStatus ${statusIdx}`);
    const deadline = i64();
    const createdAt = i64();
    const title = str();
    const description = str();
    const submission = str();
    const bump = u8();
    // Legacy accounts end here (remaining bytes are zero padding → mint = None)
    const mint = o < data.length ? opt32() : null;

    return {
        dealId,
        creator,
        worker,
        amount,
        status: DEAL_STATUSES[statusIdx],
        deadline,
        createdAt,
        title,
        description,
        submission,
        bump,
        mint,
    };
}
