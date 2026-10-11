import { FileSearch, Plus, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
    variant: 'no-wallet' | 'no-deals' | 'no-match' | 'loading' | 'error';
    onCreate?: () => void;
    onConnect?: () => void;
    onRetry?: () => void;
    message?: string;
}

const EmptyState = ({ variant, onCreate, onConnect, onRetry, message }: EmptyStateProps) => {
    if (variant === 'loading') {
        return (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                    <div
                        key={i}
                        className="card-surface h-64 animate-pulse-soft rounded-xl"
                        style={{ animationDelay: `${i * 100}ms` }}
                    />
                ))}
            </div>
        );
    }

    const content = {
        'no-wallet': {
            icon: Wallet,
            title: 'Connect a wallet to get started',
            body: 'Browse deals without connecting, or connect Phantom / Solflare to create and act on deals.',
            action: onConnect && (
                <Button onClick={onConnect} className="bg-primary text-primary-foreground hover:bg-primary/90">
                    <Wallet className="mr-2 h-4 w-4" /> Connect wallet
                </Button>
            ),
        },
        'no-deals': {
            icon: FileSearch,
            title: 'No deals yet',
            body: 'Create the first escrow deal. Your SOL is locked in a program-owned account until you approve the work.',
            action: onCreate && (
                <Button onClick={onCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">
                    <Plus className="mr-2 h-4 w-4" /> New deal
                </Button>
            ),
        },
        'no-match': {
            icon: FileSearch,
            title: 'Nothing matches these filters',
            body: 'Try a different status or switch back to all deals.',
            action: null,
        },
        error: {
            icon: FileSearch,
            title: 'Could not load deals',
            body: message ?? 'The Devnet RPC did not respond. Please try again.',
            action: onRetry && (
                <Button variant="outline" onClick={onRetry}>
                    Retry
                </Button>
            ),
        },
    }[variant];

    const Icon = content.icon;

    return (
        <div className="card-surface flex flex-col items-center rounded-xl px-6 py-16 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/25">
                <Icon className="h-6 w-6" />
            </span>
            <h3 className="mt-4 text-lg font-semibold">{content.title}</h3>
            <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{content.body}</p>
            {content.action && <div className="mt-6">{content.action}</div>}
        </div>
    );
};

export default EmptyState;
