import { cn } from '@/lib/utils';
import { DealStatus, statusLabel } from '@/lib/deals';

const styles: Record<DealStatus, string> = {
    created: 'bg-status-unfunded/15 text-status-unfunded ring-status-unfunded/30',
    funded: 'bg-status-active/15 text-status-active ring-status-active/30',
    submitted: 'bg-status-submitted/15 text-status-submitted ring-status-submitted/30',
    completed: 'bg-status-completed/15 text-status-completed ring-status-completed/30',
    cancelled: 'bg-status-cancelled/15 text-status-cancelled ring-status-cancelled/30',
};

const dot: Record<DealStatus, string> = {
    created: 'bg-status-unfunded',
    funded: 'bg-status-active animate-pulse-soft',
    submitted: 'bg-status-submitted',
    completed: 'bg-status-completed',
    cancelled: 'bg-status-cancelled',
};

const StatusBadge = ({ status, className }: { status: DealStatus; className?: string }) => (
    <span
        className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1',
            styles[status],
            className,
        )}
    >
        <span className={cn('h-1.5 w-1.5 rounded-full', dot[status])} />
        {statusLabel(status)}
    </span>
);

export default StatusBadge;
