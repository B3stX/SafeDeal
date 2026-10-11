import { useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Plus, RefreshCw, Lock, ShieldCheck, Coins, AlertTriangle } from 'lucide-react';
import Header from '@/components/Header';
import DealCard, { DealActionKind } from '@/components/DealCard';
import SubmitWorkDialog from '@/components/SubmitWorkDialog';
import DealFilters, { ScopeFilter, StatusFilter } from '@/components/DealFilters';
import CreateDealModal from '@/components/CreateDealModal';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { useSafeDeal } from '@/hooks/useSafeDeal';
import { useSolPrice } from '@/hooks/useSolPrice';
import { Deal, dealUsd, formatToken, formatUsd } from '@/lib/deals';
import { cn } from '@/lib/utils';

const Index = () => {
    const { publicKey } = useWallet();
    const { setVisible } = useWalletModal();
    const wallet = publicKey?.toBase58() ?? null;

    const {
        deals,
        loading,
        error,
        refresh,
        balanceSol,
        balanceUsdc,
        createDeal,
        runAction,
        pending,
        ready,
        programDeployed,
    } = useSafeDeal();
    const { quote: solQuote, solUsd, error: priceError } = useSolPrice();

    const [createOpen, setCreateOpen] = useState(false);
    const [submitDeal, setSubmitDeal] = useState<Deal | null>(null);

    /** Submit needs a delivery note first; every other action goes straight to the wallet */
    const handleAction = (kind: DealActionKind, deal: Deal) => {
        if (kind === 'submit') {
            setSubmitDeal(deal);
            return;
        }
        runAction(kind, deal);
    };
    const [scope, setScope] = useState<ScopeFilter>('all');
    const [status, setStatus] = useState<StatusFilter>('all');

    const scoped = useMemo(
        () =>
            scope === 'mine' && wallet
                ? deals.filter((d) => d.creator === wallet || d.worker === wallet)
                : deals,
        [deals, scope, wallet],
    );

    const counts = useMemo(() => {
        const c: Record<StatusFilter, number> = {
            all: scoped.length,
            created: 0,
            funded: 0,
            submitted: 0,
            completed: 0,
            cancelled: 0,
        };
        scoped.forEach((d) => (c[d.status] += 1));
        return c;
    }, [scoped]);

    const visible = useMemo(
        () => (status === 'all' ? scoped : scoped.filter((d) => d.status === status)),
        [scoped, status],
    );

    /** Totals in USD; falls back to a per-currency breakdown while the SOL price loads */
    const stats = useMemo(() => {
        const total = (list: Deal[]) => {
            const sol = list.filter((d) => d.currency === 'SOL').reduce((s, d) => s + d.amount, 0);
            const usdc = list.filter((d) => d.currency === 'USDC').reduce((s, d) => s + d.amount, 0);
            if (solUsd !== null || sol === 0) {
                return formatUsd(list.reduce((s, d) => s + (dealUsd(d, solUsd) ?? 0), 0));
            }
            return usdc > 0
                ? `${formatToken(sol, 'SOL')} SOL + ${formatToken(usdc, 'USDC')} USDC`
                : `${formatToken(sol, 'SOL')} SOL`;
        };
        const active = deals.filter((d) => d.status === 'funded' || d.status === 'submitted');
        return {
            locked: total(active),
            released: total(deals.filter((d) => d.status === 'completed')),
            active: active.length,
        };
    }, [deals, solUsd]);

    const openCreate = () => {
        if (!wallet) {
            setVisible(true);
            return;
        }
        setCreateOpen(true);
    };

    const renderList = () => {
        if (loading && deals.length === 0) return <EmptyState variant="loading" />;
        if (error && deals.length === 0) return <EmptyState variant="error" message={error} onRetry={refresh} />;
        if (deals.length === 0) return <EmptyState variant="no-deals" onCreate={openCreate} />;
        if (visible.length === 0) return <EmptyState variant="no-match" />;
        return (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visible.map((deal: Deal, i) => (
                    <DealCard
                        key={deal.address}
                        deal={deal}
                        wallet={wallet}
                        index={i}
                        pendingAction={pending?.address === deal.address ? pending.kind : null}
                        onAction={handleAction}
                        solUsd={solUsd}
                    />
                ))}
            </div>
        );
    };

    return (
        <div className="min-h-screen">
            <Header />

            {/* Hero */}
            <section className="relative overflow-hidden">
                <div className="grid-texture pointer-events-none absolute inset-0" />
                <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-12 sm:px-6 sm:pt-16">
                    <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
                        <div className="max-w-2xl">
                            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                                <ShieldCheck className="h-3.5 w-3.5" /> Trustless SOL &amp; USDC escrow · 2% fee on success
                            </p>
                            <h1 className="text-4xl font-semibold leading-[1.05] sm:text-5xl lg:text-6xl">
                                Pay for work.
                                <br />
                                <span className="text-primary">Release on approval.</span>
                            </h1>
                            <p className="mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
                                Price a deal in USD and lock SOL or USDC in a program-owned escrow. The worker submits, you
                                approve, funds move — or you refund yourself after the deadline. No middleman.
                            </p>
                            <div className="mt-6 flex flex-wrap gap-3">
                                <Button
                                    onClick={openCreate}
                                    size="lg"
                                    className="h-11 rounded-lg bg-primary px-5 text-primary-foreground hover:bg-primary/90 glow-ring"
                                >
                                    <Plus className="mr-2 h-4 w-4" /> New deal
                                </Button>
                                <Button
                                    onClick={refresh}
                                    size="lg"
                                    variant="outline"
                                    disabled={loading}
                                    className="h-11 rounded-lg border-border bg-transparent px-4 hover:bg-secondary"
                                >
                                    <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} /> Refresh
                                </Button>
                            </div>
                        </div>

                        {/* Stats */}
                        <dl className="grid grid-cols-3 gap-3 lg:w-[420px]">
                            <Stat icon={Lock} label="Locked" value={stats.locked} />
                            <Stat icon={Coins} label="Released" value={stats.released} />
                            <Stat icon={ShieldCheck} label="Active" value={String(stats.active)} />
                        </dl>
                    </div>
                </div>
            </section>

            {/* Dashboard */}
            <main className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
                {programDeployed === false && (
                    <div className="mb-6 flex items-start gap-3 rounded-xl border border-status-submitted/40 bg-status-submitted/10 p-4 text-sm">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-submitted" />
                        <p className="text-foreground">
                            The SafeDeal program isn&apos;t live on Devnet yet. Transactions will fail until it is
                            deployed.
                        </p>
                    </div>
                )}
                <div className="mb-5 flex items-center justify-between">
                    <h2 className="text-xl font-semibold">Deals</h2>
                    {!ready && wallet && (
                        <span className="text-xs text-muted-foreground">Connecting to program…</span>
                    )}
                </div>
                <div className="mb-6">
                    <DealFilters
                        scope={scope}
                        onScopeChange={setScope}
                        status={status}
                        onStatusChange={setStatus}
                        counts={counts}
                        walletConnected={!!wallet}
                    />
                </div>
                {renderList()}
            </main>

            <CreateDealModal
                open={createOpen}
                onOpenChange={setCreateOpen}
                onCreate={createDeal}
                walletBalanceSol={balanceSol}
                walletBalanceUsdc={balanceUsdc}
                solQuote={solQuote}
                priceError={priceError}
            />

            <SubmitWorkDialog
                deal={submitDeal}
                onOpenChange={(o) => !o && setSubmitDeal(null)}
                onSubmit={(deal, text) => runAction('submit', deal, text)}
            />
        </div>
    );
};

const Stat = ({ icon: Icon, label, value }: { icon: typeof Lock; label: string; value: string }) => (
    <div className="card-surface rounded-xl p-3.5 sm:p-4">
        <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Icon className="h-3.5 w-3.5" /> {label}
        </dt>
        <dd className="mt-1.5 truncate font-display text-lg font-semibold tabular-nums sm:text-xl">{value}</dd>
    </div>
);

export default Index;
