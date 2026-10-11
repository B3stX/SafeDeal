import { AnchorProvider, BN, Idl, Program, utils } from '@coral-xyz/anchor';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import {
    Connection,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    VersionedTransaction,
} from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import idl from '@/idl/safeDealIDL.json';
import { PROGRAM_ID, TREASURY, USDC_MINT } from './configAddress';
import { decodeDealAccount } from './dealCodec';
import type { Currency } from './priceMath';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SDKResult<T> {
    success: boolean;
    data?: T;
    error?: string;
}

export type OnChainDealStatus = 'created' | 'funded' | 'submitted' | 'completed' | 'cancelled';

export interface OnChainDeal {
    address: PublicKey;
    dealId: BN;
    creator: PublicKey;
    worker: PublicKey | null;
    amount: BN;
    status: OnChainDealStatus;
    /** unix seconds */
    deadline: number;
    /** unix seconds */
    createdAt: number;
    title: string;
    description: string;
    submission: string;
    bump: number;
    /** null = native SOL deal */
    mint: PublicKey | null;
}

export interface CreateDealParams {
    dealId: number | string;
    title: string;
    description: string;
    currency: Currency;
    /** base units: lamports (SOL) or 1e-6 (USDC) */
    amountBase: bigint;
    /** unix seconds */
    deadline: number;
    worker: string | null;
}

export interface TxData {
    signature: string;
}

export const LIMITS = { title: 64, description: 256, submission: 200 } as const;

/** Used for read-only access when no wallet is connected */
const READONLY_WALLET: AnchorWallet = {
    publicKey: PublicKey.default,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => tx,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => txs,
};

const byteLen = (s: string) => new TextEncoder().encode(s).length;

export const currencyOfMint = (mint: PublicKey | string | null): Currency | null => {
    if (!mint) return 'SOL';
    return new PublicKey(mint).equals(USDC_MINT) ? 'USDC' : null;
};

const ata = (owner: PublicKey, allowOwnerOffCurve = false) =>
    getAssociatedTokenAddressSync(USDC_MINT, owner, allowOwnerOffCurve, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

// ---------------------------------------------------------------------------
// SDK
// ---------------------------------------------------------------------------

export class SafeDealSDK {
    readonly connection: Connection;
    readonly program: Program<Idl>;
    readonly provider: AnchorProvider;
    private readonly wallet: AnchorWallet | undefined;

    constructor(connection: Connection, wallet?: AnchorWallet) {
        this.connection = connection;
        this.wallet = wallet;
        this.provider = new AnchorProvider(connection, wallet ?? READONLY_WALLET, {
            commitment: 'confirmed',
            preflightCommitment: 'confirmed',
        });
        this.program = new Program(idl as Idl, this.provider);
    }

    // ---------------- helpers ----------------

    private safeBN(value: number | string | bigint | BN | undefined | null, fallback = 0): BN {
        try {
            if (value === undefined || value === null || value === '') return new BN(fallback);
            if (BN.isBN(value)) return value as BN;
            if (typeof value === 'bigint') return new BN(value.toString());
            if (typeof value === 'number') {
                if (!Number.isFinite(value)) return new BN(fallback);
                return new BN(Math.floor(value).toString());
            }
            return new BN(value.toString().split('.')[0]);
        } catch {
            return new BN(fallback);
        }
    }

    private safeBNToNumber(value: unknown, fallback = 0): number {
        try {
            if (BN.isBN(value)) return (value as BN).toNumber();
            if (typeof value === 'number') return value;
            if (typeof value === 'string') return Number(value);
            return fallback;
        } catch {
            return fallback;
        }
    }

    private bnToSeedBuffer(bn: BN, length = 8): Buffer {
        return bn.toArrayLike(Buffer, 'le', length);
    }

    getDealPDA(creator: PublicKey, dealId: BN): PublicKey {
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from('deal'), creator.toBuffer(), this.bnToSeedBuffer(dealId, 8)],
            PROGRAM_ID,
        );
        return pda;
    }

    /** The deal PDA's USDC ATA that holds escrowed tokens */
    getEscrowVault(deal: PublicKey): PublicKey {
        return ata(deal, true);
    }

    private requireWallet(): PublicKey {
        if (!this.wallet) throw new Error('Please connect your wallet.');
        return this.wallet.publicKey;
    }

    private async testConnection(): Promise<void> {
        try {
            await this.connection.getLatestBlockhash('confirmed');
        } catch {
            throw new Error('Cannot reach Solana Devnet RPC. Please try again.');
        }
    }

    /** Turn raw wallet/RPC/Anchor errors into a readable sentence */
    parseError(e: unknown): string {
        const msg = e instanceof Error ? e.message : String(e);
        const logs = ((e as { logs?: string[] })?.logs ?? []).join('\n');
        const all = `${msg}\n${logs}`;

        if (/user rejected|rejected the request|declined/i.test(all)) return 'Transaction rejected in wallet.';

        const anchorCode = all.match(/Error Number: (\d+)/);
        const hexCode = all.match(/custom program error: 0x([0-9a-f]+)/i);
        const code = anchorCode ? parseInt(anchorCode[1], 10) : hexCode ? parseInt(hexCode[1], 16) : null;
        if (code !== null) {
            const found = idl.errors.find((x) => x.code === code);
            if (found) return found.msg + '.';
            if (code === 3012) return 'You have no devnet USDC token account yet. Get test USDC from faucet.circle.com.';
        }

        if (/Attempt to load a program that does not exist|program that does not exist/i.test(all))
            return 'The SafeDeal program is not deployed on Devnet yet.';
        if (/insufficient funds for rent/i.test(all))
            return 'A recipient account would fall below rent-exemption. Try a larger amount.';
        if (/Program log: Error: insufficient funds/i.test(all)) return 'Insufficient USDC balance for this deal.';
        if (/insufficient (funds|lamports)|0x1\b/i.test(all)) return 'Insufficient balance for this transaction.';
        if (/blockhash not found|block height exceeded/i.test(all))
            return 'Transaction expired before confirming. Please try again.';

        return msg.length > 180 ? msg.slice(0, 180) + '…' : msg;
    }

    private decodeDeal(address: PublicKey, data: Buffer): OnChainDeal | null {
        // Hand-written Borsh decoder: independent of the Anchor coder / IDL version in the bundle.
        try {
            const d = decodeDealAccount(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            return {
                address,
                dealId: new BN(d.dealId.toString()),
                creator: new PublicKey(d.creator),
                worker: d.worker ? new PublicKey(d.worker) : null,
                amount: new BN(d.amount.toString()),
                status: d.status,
                deadline: Number(d.deadline),
                createdAt: Number(d.createdAt),
                title: d.title,
                description: d.description,
                submission: d.submission,
                bump: d.bump,
                mint: d.mint ? new PublicKey(d.mint) : null,
            };
        } catch (e) {
            console.error(`[SafeDeal] Failed to decode Deal ${address.toBase58()} (${data.length} bytes):`, e);
            return null;
        }
    }

    // ---------------- reads ----------------

    async isProgramDeployed(): Promise<SDKResult<boolean>> {
        try {
            const info = await this.connection.getAccountInfo(PROGRAM_ID);
            return { success: true, data: !!info?.executable };
        } catch (e) {
            return { success: false, error: this.parseError(e) };
        }
    }

    async getAllDeals(): Promise<SDKResult<OnChainDeal[]>> {
        try {
            const disc = idl.accounts.find((a) => a.name === 'Deal')!.discriminator;
            const fetchPromise = this.connection.getProgramAccounts(PROGRAM_ID, {
                commitment: 'confirmed',
                filters: [{ memcmp: { offset: 0, bytes: utils.bytes.bs58.encode(Buffer.from(disc)) } }],
            });
            const timeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Devnet RPC timed out while loading deals.')), 15000),
            );
            const accounts = await Promise.race([fetchPromise, timeout]);
            if (!accounts || accounts.length === 0) return { success: true, data: [] };
            const deals = accounts
                .map((a) => this.decodeDeal(a.pubkey, a.account.data as Buffer))
                .filter((d): d is OnChainDeal => d !== null);
            return { success: true, data: deals };
        } catch (e) {
            const msg = e instanceof Error ? e.message : '';
            if (msg.includes('Account does not exist')) return { success: true, data: [] };
            return { success: false, error: this.parseError(e) };
        }
    }

    async getDeal(address: PublicKey): Promise<SDKResult<OnChainDeal | null>> {
        try {
            const info = await this.connection.getAccountInfo(address, 'confirmed');
            if (!info) return { success: true, data: null };
            return { success: true, data: this.decodeDeal(address, info.data) };
        } catch (e) {
            return { success: false, error: this.parseError(e) };
        }
    }

    async fetchSolBalance(owner: PublicKey): Promise<SDKResult<number>> {
        try {
            const lamports = await this.connection.getBalance(owner, 'confirmed');
            return { success: true, data: lamports / LAMPORTS_PER_SOL };
        } catch (e) {
            return { success: false, error: this.parseError(e) };
        }
    }

    /** Devnet USDC balance (UI units). Returns 0 when the wallet has no USDC account. */
    async fetchUsdcBalance(owner: PublicKey): Promise<SDKResult<number>> {
        try {
            const info = await this.connection.getAccountInfo(ata(owner), 'confirmed');
            if (!info) return { success: true, data: 0 };
            const bal = await this.connection.getTokenAccountBalance(ata(owner), 'confirmed');
            return { success: true, data: bal.value.uiAmount ?? 0 };
        } catch (e) {
            return { success: false, error: this.parseError(e) };
        }
    }

    // ---------------- instructions ----------------

    /**
     * initialize + fund in a single transaction so funds are locked in escrow
     * the moment the deal exists. Routes to the SOL or USDC instructions.
     */
    async createAndFundDeal(params: CreateDealParams): Promise<SDKResult<TxData & { deal: string }>> {
        try {
            await this.testConnection();
            const creator = this.requireWallet();

            const title = params.title.trim();
            const description = params.description.trim();
            if (!title) throw new Error('Title is required.');
            if (byteLen(title) > LIMITS.title) throw new Error(`Title exceeds ${LIMITS.title} bytes.`);
            if (!description) throw new Error('Description is required.');
            if (byteLen(description) > LIMITS.description)
                throw new Error(`Description exceeds ${LIMITS.description} bytes.`);
            if (params.amountBase <= 0n) throw new Error('Amount must be greater than zero.');

            let worker: PublicKey | null = null;
            if (params.worker) {
                worker = new PublicKey(params.worker);
                if (worker.equals(creator)) throw new Error('You cannot assign yourself as the worker.');
            }

            const dealId = this.safeBN(params.dealId);
            const amount = this.safeBN(params.amountBase);
            const deadline = this.safeBN(params.deadline);
            const deal = this.getDealPDA(creator, dealId);
            const tx = new Transaction();

            if (params.currency === 'SOL') {
                tx.add(
                    await this.program.methods
                        .initializeDeal(dealId, title, description, amount, deadline, worker)
                        .accountsStrict({ creator, deal, systemProgram: SystemProgram.programId })
                        .instruction(),
                    await this.program.methods
                        .fundDeal()
                        .accountsStrict({ creator, deal, systemProgram: SystemProgram.programId })
                        .instruction(),
                );
            } else {
                const creatorAta = ata(creator);
                if (!(await this.connection.getAccountInfo(creatorAta, 'confirmed')))
                    throw new Error('You have no devnet USDC yet. Get test USDC from faucet.circle.com.');
                const escrowVault = this.getEscrowVault(deal);
                tx.add(
                    await this.program.methods
                        .initializeTokenDeal(dealId, title, description, amount, deadline, worker)
                        .accountsStrict({
                            creator,
                            deal,
                            mint: USDC_MINT,
                            escrowVault,
                            tokenProgram: TOKEN_PROGRAM_ID,
                            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                            systemProgram: SystemProgram.programId,
                        })
                        .instruction(),
                    await this.program.methods
                        .fundTokenDeal()
                        .accountsStrict({
                            creator,
                            deal,
                            mint: USDC_MINT,
                            creatorTokenAccount: creatorAta,
                            escrowVault,
                            tokenProgram: TOKEN_PROGRAM_ID,
                        })
                        .instruction(),
                );
            }

            const signature = await this.provider.sendAndConfirm(tx, [], {
                skipPreflight: false,
                commitment: 'confirmed',
            });
            return { success: true, data: { signature, deal: deal.toBase58() } };
        } catch (e) {
            return { success: false, error: this.parseError(e) };
        }
    }

    /** Fund a deal that was initialized but never funded (status Created) */
    async fundDeal(dealAddress: string, mint: string | null): Promise<SDKResult<TxData>> {
        try {
            await this.testConnection();
            const creator = this.requireWallet();
            const deal = new PublicKey(dealAddress);
            const signature = mint
                ? await this.program.methods
                      .fundTokenDeal()
                      .accountsStrict({
                          creator,
                          deal,
                          mint: USDC_MINT,
                          creatorTokenAccount: ata(creator),
                          escrowVault: this.getEscrowVault(deal),
                          tokenProgram: TOKEN_PROGRAM_ID,
                      })
                      .rpc({ commitment: 'confirmed' })
                : await this.program.methods
                      .fundDeal()
                      .accountsStrict({ creator, deal, systemProgram: SystemProgram.programId })
                      .rpc({ commitment: 'confirmed' });
            return { success: true, data: { signature } };
        } catch (e) {
            return { success: false, error: this.parseError(e) };
        }
    }

    async submitWork(dealAddress: string, submission: string): Promise<SDKResult<TxData>> {
        try {
            await this.testConnection();
            const worker = this.requireWallet();
            const text = submission.trim();
            if (byteLen(text) > LIMITS.submission) throw new Error(`Submission exceeds ${LIMITS.submission} bytes.`);
            const signature = await this.program.methods
                .submitWork(text)
                .accountsStrict({ worker, deal: new PublicKey(dealAddress) })
                .rpc({ commitment: 'confirmed' });
            return { success: true, data: { signature } };
        } catch (e) {
            return { success: false, error: this.parseError(e) };
        }
    }

    /** Release escrow: 98% to worker, 2% to treasury (SOL or USDC ATAs, created if missing) */
    async approveDeal(dealAddress: string, workerAddress: string, mint: string | null): Promise<SDKResult<TxData>> {
        try {
            await this.testConnection();
            const creator = this.requireWallet();
            const deal = new PublicKey(dealAddress);
            const worker = new PublicKey(workerAddress);
            const signature = mint
                ? await this.program.methods
                      .approveTokenDeal()
                      .accountsStrict({
                          creator,
                          deal,
                          mint: USDC_MINT,
                          escrowVault: this.getEscrowVault(deal),
                          worker,
                          workerTokenAccount: ata(worker),
                          treasury: TREASURY,
                          treasuryTokenAccount: ata(TREASURY),
                          tokenProgram: TOKEN_PROGRAM_ID,
                          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                          systemProgram: SystemProgram.programId,
                      })
                      .rpc({ commitment: 'confirmed' })
                : await this.program.methods
                      .approveDeal()
                      .accountsStrict({
                          creator,
                          deal,
                          worker,
                          treasury: TREASURY,
                          systemProgram: SystemProgram.programId,
                      })
                      .rpc({ commitment: 'confirmed' });
            return { success: true, data: { signature } };
        } catch (e) {
            return { success: false, error: this.parseError(e) };
        }
    }

    async cancelDeal(dealAddress: string, mint: string | null): Promise<SDKResult<TxData>> {
        try {
            await this.testConnection();
            const creator = this.requireWallet();
            const deal = new PublicKey(dealAddress);
            const signature = mint
                ? await this.program.methods
                      .cancelTokenDeal()
                      .accountsStrict({
                          creator,
                          deal,
                          mint: USDC_MINT,
                          escrowVault: this.getEscrowVault(deal),
                          creatorTokenAccount: ata(creator),
                          tokenProgram: TOKEN_PROGRAM_ID,
                          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                          systemProgram: SystemProgram.programId,
                      })
                      .rpc({ commitment: 'confirmed' })
                : await this.program.methods
                      .cancelDeal()
                      .accountsStrict({ creator, deal, systemProgram: SystemProgram.programId })
                      .rpc({ commitment: 'confirmed' });
            return { success: true, data: { signature } };
        } catch (e) {
            return { success: false, error: this.parseError(e) };
        }
    }
}
