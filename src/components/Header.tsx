import { ShieldCheck } from 'lucide-react';
import WalletButton from './WalletButton';

const Header = () => {
    return (
        <header className="sticky top-0 z-40 border-b border-border/70 bg-background/70 backdrop-blur-md">
            <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
                <a href="/" className="flex items-center gap-2.5">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/30">
                        <ShieldCheck className="h-5 w-5" />
                    </span>
                    <span className="font-display text-lg font-semibold tracking-tight">SafeDeal</span>
                    <span className="hidden rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground sm:inline-block">
                        Devnet
                    </span>
                </a>
                <WalletButton />
            </div>
        </header>
    );
};

export default Header;
