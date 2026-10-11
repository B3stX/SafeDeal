import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAnchorWallet, useConnection } from '@solana/wallet-adapter-react';
import { SafeDealSDK, OnChainDeal, currencyOfMint } from '@/lib/safeDeal';
import { Deal, formatToken } from '@/lib/deals';
import { txErrorToast, txSuccessToast } from '@/lib/txToast';
import type { DealActionKind } from '@/components/DealCard';
import type { CreateDealInput } from '@/components/CreateDealModal';

export type PendingAction = { address: string; kind: DealActionKind } | null;

const toDeal = (d: OnChainDeal): Deal | null => {
    const currency = currencyOfMint(d.mint);
    if (!currency) {
        console.error(`[SafeDeal] Deal ${d.address.toBase58()} has unsupported mint ${d.mint?.toBase58()}`);
        return null;
    }
    return {
        address: d.address.toBase58(),
        dealId: d.dealId.toString(),
        creator: d.creator.toBase58(),
        worker: d.worker ? d.worker.toBase58() : null,
        amount: d.amount.toNumber(),
        currency,
        mint: d.mint ? d.mint.toBase58() : null,
        status: d.status,
        deadline: d.deadline * 1000,
        createdAt: d.createdAt * 1000,
        title: d.title,
        description: d.description,
        submission: d.submission,
    };
};

const REFRESH_MS = 30_000;

export const useSafeDeal = () => {
    const { connection } = useConnection();
    const wallet = useAnchorWallet();

    const sdk = useMemo(() => new SafeDealSDK(connection, wallet), [connection, wallet]);

    const [deals, setDeals] = useState<Deal[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [balanceSol, setBalanceSol] = useState<number | null>(null);
    const [balanceUsdc, setBalanceUsdc] = useState<number | null>(null);
    const [pending, setPending] = useState<PendingAction>(null);
    const [programDeployed, setProgramDeployed] = useState<boolean | null>(null);
    const inFlight = useRef(false);

    const refresh = useCallback(async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setLoading(true);
        try {
            const [dealsRes, deployedRes, solRes, usdcRes] = await Promise.all([
                sdk.getAllDeals(),
                sdk.isProgramDeployed(),
                wallet ? sdk.fetchSolBalance(wallet.publicKey) : Promise.resolve(null),
                wallet ? sdk.fetchUsdcBalance(wallet.publicKey) : Promise.resolve(null),
            ]);
            if (deployedRes.success) setProgramDeployed(deployedRes.data ?? false);
            if (dealsRes.success) {
                setDeals(
                    (dealsRes.data ?? [])
                        .map(toDeal)
                        .filter((d): d is Deal => d !== null)
                        .sort((a, b) => b.createdAt - a.createdAt),
                );
                setError(null);
            } else {
                setError(dealsRes.error ?? 'Failed to load deals.');
            }
            setBalanceSol(solRes?.success ? (solRes.data ?? null) : null);
            setBalanceUsdc(usdcRes?.success ? (usdcRes.data ?? null) : null);
        } finally {
            inFlight.current = false;
            setLoading(false);
        }
    }, [sdk, wallet]);

    useEffect(() => {
        refresh();
        const id = setInterval(refresh, REFRESH_MS);
        return () => clearInterval(id);
    }, [refresh]);

    const createDeal = useCallback(
        async (input: CreateDealInput): Promise<boolean> => {
            if (!wallet) {
                txErrorToast('Wallet not connected', 'Connect Phantom or Solflare to create a deal.');
                return false;
            }
            const res = await sdk.createAndFundDeal({
                dealId: Date.now(),
                title: input.title,
                description: input.description,
                currency: input.currency,
                amountBase: input.amountBase,
                deadline: Math.floor(Date.now() / 1000) + input.deadlineDays * 86_400,
                worker: input.worker,
            });
            if (!res.success || !res.data) {
                txErrorToast('Could not create deal', res.error);
                return false;
            }
            txSuccessToast(
                `Deal created · ${formatToken(Number(input.amountBase), input.currency)} ${input.currency} locked`,
                res.data.signature,
            );
            await refresh();
            return true;
        },
        [sdk, wallet, refresh],
    );

    /** Runs fund / submit / approve / cancel for a deal. `submission` is used for submit only. */
    const runAction = useCallback(
        async (kind: DealActionKind, deal: Deal, submission = ''): Promise<boolean> => {
            if (!wallet) {
                txErrorToast('Wallet not connected', 'Connect your wallet first.');
                return false;
            }
            setPending({ address: deal.address, kind });
            try {
                const res =
                    kind === 'fund'
                        ? await sdk.fundDeal(deal.address, deal.mint)
                        : kind === 'submit'
                          ? await sdk.submitWork(deal.address, submission)
                          : kind === 'approve'
                            ? deal.worker
                                ? await sdk.approveDeal(deal.address, deal.worker, deal.mint)
                                : { success: false, error: 'This deal has no worker yet.' }
                            : await sdk.cancelDeal(deal.address, deal.mint);

                const labels: Record<DealActionKind, string> = {
                    fund: 'Funds locked in escrow',
                    submit: 'Work submitted',
                    approve: 'Payment released to worker',
                    cancel:
                        deal.status === 'funded' ? `Deal cancelled · ${deal.currency} refunded` : 'Deal cancelled',
                };

                if (!res.success || !('data' in res) || !res.data) {
                    txErrorToast('Transaction failed', res.error);
                    return false;
                }
                txSuccessToast(labels[kind], res.data.signature);
                await refresh();
                return true;
            } finally {
                setPending(null);
            }
        },
        [sdk, wallet, refresh],
    );

    return {
        deals,
        loading,
        error,
        refresh,
        balanceSol,
        balanceUsdc,
        createDeal,
        runAction,
        pending,
        ready: !!wallet,
        programDeployed,
    };
};
