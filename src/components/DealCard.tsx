import { Clock, ExternalLink, Loader2, Lock, Send, CheckCircle2, Undo2, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import StatusBadge from './StatusBadge';
import {
    Deal,
    computePayout,
    dealUsd,
    formatDate,
    formatRelative,
    formatToken,
    formatUsd,
    getAvailableActions,
    getRole,
    isDeadlinePassed,
    shortAddress,
    solscanAccount,
} from '@/lib/deals';
import { cn } from '@/lib/utils';

export type DealActionKind = 'fund' | 'submit' | 'approve' | 'cancel';

interface DealCardProps {
    deal: Deal;
    wallet: string | null;
    /** Which action is currently in flight for this deal (if any) */
    pendingAction: DealActionKind | null;
    onAction: (kind: DealActionKind, deal: Deal) => void;
    /** Live SOL/USD for the USD equivalent (null while loading) */
    solUsd: number | null;
    index?: number;
}

const DealCard = ({ deal, wallet, pendingAction, onAction, solUsd, index = 0 }: DealCardProps) => {
    const role = getRole(deal, wallet);
    const actions = getAvailableActions(deal, wallet);
    const expired = isDeadlinePassed(deal);
    const busy = pendingAction !== null;
    const payout = computePayout(deal.amount);
    const usd = dealUsd(deal, solUsd);
    const isTerminal = deal.status === 'completed' || deal.status === 'cancelled';

    const ActionButton = ({
        kind,
        label,
        icon: Icon,
        variant = 'default',
    }: {
        kind: DealActionKind;
        label: string;
        icon: typeof Send;
        variant?: 'default' | 'outline' | 'destructive';
    }) => (
        <Button
            size="sm"
            variant={variant}
            disabled={busy}
            onClick={() => onAction(kind, deal)}
            className={cn(
                'h-9 flex-1 rounded-md font-medium sm:flex-none',
                variant === 'default' && 'bg-primary text-primary-foreground hover:bg-primary/90',
                variant === 'outline' && 'border-border bg-transparent hover:border-primary/40 hover:bg-secondary',
            )}
        >
            {pendingAction === kind ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
                <Icon className="mr-2 h-4 w-4" />
            )}
            {label}
        </Button>
    );

    return (
        <article
            className={cn(
                'card-surface flex flex-col gap-4 rounded-xl p-5 transition-all duration-300 animate-fade-up',
                isTerminal && 'opacity-80',
            )}
            style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
        >
            {/* Top row */}
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold leading-tight">{deal.title}</h3>
                    <a
                        href={solscanAccount(deal.address)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-primary"
                    >
                        Escrow {shortAddress(deal.address)} · {formatDate(deal.createdAt)}
                        <ExternalLink className="h-3 w-3" />
                    </a>
                </div>
                <StatusBadge status={deal.status} />
            </div>

            {/* Description */}
            <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{deal.description}</p>

            {/* Amount + deadline */}
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/70 bg-background/40 p-3">
                <div>
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Escrowed</p>
                    <p className="mt-0.5 font-display text-xl font-semibold tabular-nums">
                        {formatToken(deal.amount, deal.currency)}{' '}
                        <span className="text-sm text-muted-foreground">{deal.currency}</span>
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                        {usd !== null ? `≈ ${formatUsd(usd)}` : '≈ $ …'}
                        {deal.currency === 'SOL' && usd !== null && ' now'}
                    </p>
                    {!isTerminal && (
                        <p className="text-[11px] text-muted-foreground">
                            Worker receives {formatToken(payout.worker, deal.currency)} · 2% fee
                        </p>
                    )}
                </div>
                <div>
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Deadline</p>
                    <p
                        className={cn(
                            'mt-0.5 flex items-center gap-1.5 text-sm font-medium',
                            expired && !isTerminal ? 'text-status-submitted' : 'text-foreground',
                        )}
                    >
                        <Clock className="h-3.5 w-3.5" />
                        {isTerminal ? formatDate(deal.deadline) : formatRelative(deal.deadline)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(deal.deadline)}</p>
                </div>
            </div>

            {/* Worker delivery */}
            {deal.submission && (
                <div className="rounded-lg border border-status-submitted/25 bg-status-submitted/5 p-3">
                    <p className="text-[11px] uppercase tracking-wider text-status-submitted">Delivery</p>
                    {/^https?:\/\//.test(deal.submission) ? (
                        <a
                            href={deal.submission}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="mt-1 inline-flex max-w-full items-center gap-1 break-all text-sm text-foreground hover:text-primary"
                        >
                            {deal.submission}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                    ) : (
                        <p className="mt-1 break-words text-sm text-foreground">{deal.submission}</p>
                    )}
                </div>
            )}

            {/* Parties */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                <Party label="Creator" address={deal.creator} you={role === 'creator'} />
                <Party
                    label="Worker"
                    address={deal.worker}
                    you={role === 'worker'}
                    emptyLabel={deal.status === 'funded' ? 'Open to anyone' : 'Unassigned'}
                />
            </div>

            {/* Actions */}
            {(actions.canFund || actions.canSubmit || actions.canApprove || actions.canCancel) && (
                <div className="mt-auto flex flex-wrap gap-2 border-t border-border/70 pt-4">
                    {actions.canFund && <ActionButton kind="fund" label="Lock funds" icon={Lock} />}
                    {actions.canSubmit && (
                        <ActionButton
                            kind="submit"
                            label={deal.worker ? 'Submit work' : 'Claim & submit'}
                            icon={Send}
                        />
                    )}
                    {actions.canApprove && (
                        <ActionButton kind="approve" label="Approve & release" icon={CheckCircle2} />
                    )}
                    {actions.canCancel && (
                        <ActionButton
                            kind="cancel"
                            label={deal.status === 'funded' ? 'Cancel & refund' : 'Cancel'}
                            icon={Undo2}
                            variant="outline"
                        />
                    )}
                </div>
            )}

            {/* Hint when creator is waiting */}
            {role === 'creator' && deal.status === 'funded' && !expired && (
                <p className="mt-auto border-t border-border/70 pt-3 text-xs text-muted-foreground">
                    Waiting for work submission. You can refund after the deadline.
                </p>
            )}
            {role === 'worker' && deal.status === 'submitted' && (
                <p className="mt-auto border-t border-border/70 pt-3 text-xs text-muted-foreground">
                    Awaiting creator approval to release payment.
                </p>
            )}
        </article>
    );
};

const Party = ({
    label,
    address,
    you,
    emptyLabel = '—',
}: {
    label: string;
    address: string | null;
    you: boolean;
    emptyLabel?: string;
}) => (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <User className="h-3.5 w-3.5" />
        <span>{label}</span>
        {address ? (
            <a
                href={solscanAccount(address)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-foreground hover:text-primary"
            >
                {shortAddress(address)}
                <ExternalLink className="h-3 w-3" />
            </a>
        ) : (
            <span className="italic">{emptyLabel}</span>
        )}
        {you && (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                you
            </span>
        )}
    </span>
);

export default DealCard;
