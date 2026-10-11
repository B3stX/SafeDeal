import { cn } from '@/lib/utils';
import { DealStatus } from '@/lib/deals';

export type ScopeFilter = 'all' | 'mine';
export type StatusFilter = 'all' | DealStatus;

interface DealFiltersProps {
    scope: ScopeFilter;
    onScopeChange: (s: ScopeFilter) => void;
    status: StatusFilter;
    onStatusChange: (s: StatusFilter) => void;
    counts: Record<StatusFilter, number>;
    walletConnected: boolean;
}

const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'funded', label: 'Active' },
    { value: 'submitted', label: 'Submitted' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
];

const DealFilters = ({
    scope,
    onScopeChange,
    status,
    onStatusChange,
    counts,
    walletConnected,
}: DealFiltersProps) => {
    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Scope toggle */}
            <div className="inline-flex w-fit rounded-lg border border-border bg-secondary p-1">
                {(['all', 'mine'] as ScopeFilter[]).map((s) => (
                    <button
                        key={s}
                        type="button"
                        disabled={s === 'mine' && !walletConnected}
                        onClick={() => onScopeChange(s)}
                        className={cn(
                            'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                            scope === s
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {s === 'all' ? 'All deals' : 'My deals'}
                    </button>
                ))}
            </div>

            {/* Status chips */}
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:pb-0">
                {statusOptions.map((opt) => (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onStatusChange(opt.value)}
                        className={cn(
                            'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                            status === opt.value
                                ? 'border-primary/50 bg-primary/15 text-primary'
                                : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
                        )}
                    >
                        {opt.label}
                        <span className="ml-1.5 font-mono opacity-70">{counts[opt.value]}</span>
                    </button>
                ))}
            </div>
        </div>
    );
};

export default DealFilters;
