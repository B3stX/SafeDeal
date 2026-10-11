import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Wallet, LogOut, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { shortAddress } from '@/lib/deals';

/** Themed wallet connect button — replaces the default purple adapter button. */
const WalletButton = () => {
    const { publicKey, disconnect, connecting, wallet } = useWallet();
    const { setVisible } = useWalletModal();
    const [copied, setCopied] = useState(false);

    if (!publicKey) {
        return (
            <Button
                onClick={() => setVisible(true)}
                disabled={connecting}
                className="h-10 rounded-lg bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90 glow-ring"
            >
                <Wallet className="mr-2 h-4 w-4" />
                {connecting ? 'Connecting…' : 'Connect Wallet'}
            </Button>
        );
    }

    const address = publicKey.toBase58();

    const copy = async () => {
        await navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="secondary"
                    className="h-10 rounded-lg border border-border bg-secondary px-3 font-mono text-sm hover:border-primary/40"
                >
                    {wallet?.adapter.icon && (
                        <img src={wallet.adapter.icon} alt="" className="mr-2 h-4 w-4 rounded-sm" />
                    )}
                    <span className="mr-2 inline-block h-2 w-2 rounded-full bg-status-completed" />
                    {shortAddress(address)}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 border-border bg-popover">
                <DropdownMenuItem onClick={copy} className="cursor-pointer gap-2">
                    {copied ? <Check className="h-4 w-4 text-status-completed" /> : <Copy className="h-4 w-4" />}
                    {copied ? 'Copied' : 'Copy address'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => disconnect()} className="cursor-pointer gap-2 text-destructive focus:text-destructive">
                    <LogOut className="h-4 w-4" />
                    Disconnect
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

export default WalletButton;
