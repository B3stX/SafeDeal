import { useMemo, useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { PublicKey } from '@solana/web3.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DEFAULT_DEADLINE_DAYS, MAX_DESCRIPTION_LEN, MAX_TITLE_LEN, computePayout, formatToken } from '@/lib/deals';
import { Currency, LAMPORTS_PER_SOL, baseUnitsToToken, usdToBaseUnits } from '@/lib/priceMath';
import type { SolUsdQuote } from '@/lib/pyth';
import { cn } from '@/lib/utils';

export interface CreateDealInput {
    title: string;
    description: string;
    currency: Currency;
    /** base units computed from the USD input at submit time */
    amountBase: bigint;
    usdAmount: number;
    deadlineDays: number;
    worker: string | null;
}

interface CreateDealModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreate: (input: CreateDealInput) => Promise<boolean>;
    walletBalanceSol: number | null;
    walletBalanceUsdc: number | null;
    solQuote: SolUsdQuote | null;
    priceError: string | null;
}

const CURRENCIES: Currency[] = ['SOL', 'USDC'];
const MIN_SOL_LAMPORTS = 0.001 * LAMPORTS_PER_SOL;
/** Rent for the deal account (+ vault ATA for USDC) plus tx fees */
const SOL_RESERVE = 0.01;

const CreateDealModal = ({
    open,
    onOpenChange,
    onCreate,
    walletBalanceSol,
    walletBalanceUsdc,
    solQuote,
    priceError,
}: CreateDealModalProps) => {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [currency, setCurrency] = useState<Currency>('SOL');
    const [usd, setUsd] = useState('');
    const [days, setDays] = useState(String(DEFAULT_DEADLINE_DAYS));
    const [worker, setWorker] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reset = () => {
        setTitle('');
        setDescription('');
        setUsd('');
        setDays(String(DEFAULT_DEADLINE_DAYS));
        setWorker('');
        setError(null);
    };

    const usdNum = parseFloat(usd);
    const solUsd = solQuote?.price ?? null;

    /** Live conversion: USD → base units of the selected currency */
    const amountBase = useMemo<bigint | null>(() => {
        if (!isFinite(usdNum) || usdNum <= 0) return null;
        try {
            return usdToBaseUnits(usdNum, currency, solUsd);
        } catch {
            return null;
        }
    }, [usdNum, currency, solUsd]);

    const payout = amountBase !== null ? computePayout(Number(amountBase)) : null;
    const priceAge = solQuote ? Math.max(0, Math.round(Date.now() / 1000 - solQuote.publishTime)) : null;

    const validate = (): string | null => {
        if (!title.trim()) return 'Title is required.';
        if (title.trim().length > MAX_TITLE_LEN) return `Title must be ${MAX_TITLE_LEN} characters or fewer.`;
        if (!description.trim()) return 'Description is required.';
        if (description.trim().length > MAX_DESCRIPTION_LEN)
            return `Description must be ${MAX_DESCRIPTION_LEN} characters or fewer.`;
        if (!isFinite(usdNum) || usdNum <= 0) return 'Enter a positive USD amount.';
        if (currency === 'SOL' && solUsd === null) return 'Live SOL price unavailable — try again in a moment.';
        if (amountBase === null) return 'Could not convert this amount.';
        if (currency === 'SOL' && Number(amountBase) < MIN_SOL_LAMPORTS) return 'Minimum deal amount is 0.001 SOL.';
        if (currency === 'USDC' && usdNum < 0.01) return 'Minimum deal amount is 0.01 USDC.';

        const tokenAmount = baseUnitsToToken(amountBase, currency);
        if (currency === 'SOL' && walletBalanceSol !== null && tokenAmount + SOL_RESERVE > walletBalanceSol)
            return 'Insufficient SOL balance (keep ~0.01 SOL for fees).';
        if (currency === 'USDC') {
            if (walletBalanceUsdc !== null && tokenAmount > walletBalanceUsdc)
                return 'Insufficient devnet USDC. Get test USDC from faucet.circle.com.';
            if (walletBalanceSol !== null && walletBalanceSol < SOL_RESERVE)
                return 'You need ~0.01 SOL for account rent and fees.';
        }

        const d = parseInt(days, 10);
        if (!isFinite(d) || d < 1 || d > 365) return 'Deadline must be between 1 and 365 days.';
        if (worker.trim()) {
            try {
                new PublicKey(worker.trim());
            } catch {
                return 'Worker address is not a valid Solana public key.';
            }
        }
        return null;
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const err = validate();
        if (err || amountBase === null) {
            setError(err ?? 'Invalid amount.');
            return;
        }
        setError(null);
        setSubmitting(true);
        const ok = await onCreate({
            title: title.trim(),
            description: description.trim(),
            currency,
            amountBase,
            usdAmount: usdNum,
            deadlineDays: parseInt(days, 10),
            worker: worker.trim() || null,
        });
        setSubmitting(false);
        if (ok) {
            reset();
            onOpenChange(false);
        }
    };

    const balanceLine =
        currency === 'SOL'
            ? walletBalanceSol !== null && `Balance: ${walletBalanceSol.toFixed(3)} SOL`
            : walletBalanceUsdc !== null && `Balance: ${walletBalanceUsdc.toFixed(2)} USDC`;

    return (
        <Dialog
            open={open}
            onOpenChange={(o) => {
                if (!submitting) {
                    onOpenChange(o);
                    if (!o) reset();
                }
            }}
        >
            <DialogContent className="max-h-[92vh] overflow-y-auto border-border bg-card sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="font-display text-xl">New escrow deal</DialogTitle>
                    <DialogDescription>
                        Funds are locked in a program-owned escrow the moment the deal is created.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={submit} className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="title">Title</Label>
                        <Input
                            id="title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            maxLength={MAX_TITLE_LEN}
                            placeholder="Landing page redesign"
                            className="bg-background"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="description">Description</Label>
                            <span className="text-[11px] text-muted-foreground">
                                {description.length}/{MAX_DESCRIPTION_LEN}
                            </span>
                        </div>
                        <Textarea
                            id="description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            maxLength={MAX_DESCRIPTION_LEN}
                            rows={3}
                            placeholder="Deliverables, acceptance criteria, links…"
                            className="resize-none bg-background"
                        />
                    </div>

                    {/* Currency selector */}
                    <div className="space-y-1.5">
                        <Label>Pay in</Label>
                        <div
                            role="radiogroup"
                            aria-label="Deal currency"
                            className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-background p-1"
                        >
                            {CURRENCIES.map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    role="radio"
                                    aria-checked={currency === c}
                                    onClick={() => setCurrency(c)}
                                    className={cn(
                                        'h-9 rounded-md text-sm font-medium transition-colors',
                                        currency === c
                                            ? 'bg-primary text-primary-foreground'
                                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                                    )}
                                >
                                    {c}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="usd">Amount (USD)</Label>
                            <div className="relative">
                                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                                    $
                                </span>
                                <Input
                                    id="usd"
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01"
                                    min="0.01"
                                    value={usd}
                                    onChange={(e) => setUsd(e.target.value)}
                                    placeholder="50"
                                    className="bg-background pl-7 font-mono"
                                />
                            </div>
                            <p className="font-mono text-xs text-foreground" aria-live="polite">
                                {amountBase !== null
                                    ? `${currency === 'SOL' ? '≈' : '='} ${formatToken(Number(amountBase), currency)} ${currency}`
                                    : currency === 'SOL' && solUsd === null
                                      ? 'Loading SOL price…'
                                      : `≈ 0 ${currency}`}
                            </p>
                            {balanceLine && <p className="text-[11px] text-muted-foreground">{balanceLine}</p>}
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="days">Deadline (days)</Label>
                            <Input
                                id="days"
                                type="number"
                                inputMode="numeric"
                                min="1"
                                max="365"
                                value={days}
                                onChange={(e) => setDays(e.target.value)}
                                className="bg-background font-mono"
                            />
                            <p className="text-[11px] text-muted-foreground">Refundable after it passes</p>
                        </div>
                    </div>

                    {/* Price source */}
                    <p className="text-[11px] text-muted-foreground">
                        {currency === 'USDC'
                            ? 'USDC is converted 1:1 with USD (Circle devnet USDC).'
                            : solQuote
                              ? `1 SOL = $${solQuote.price.toFixed(2)} · Pyth ${solQuote.source === 'pyth-devnet' ? 'devnet feed' : 'Hermes'} · ${priceAge}s ago. SOL amount is fixed when you confirm.`
                              : priceError
                                ? `SOL price unavailable: ${priceError}`
                                : 'Fetching live SOL/USD from Pyth…'}
                    </p>

                    <div className="space-y-1.5">
                        <Label htmlFor="worker">
                            Worker address <span className="text-muted-foreground">(optional)</span>
                        </Label>
                        <Input
                            id="worker"
                            value={worker}
                            onChange={(e) => setWorker(e.target.value)}
                            placeholder="Leave blank to let anyone claim this deal"
                            className="bg-background font-mono text-xs"
                        />
                    </div>

                    <div className="rounded-lg border border-border/70 bg-background/50 p-3 text-xs text-muted-foreground">
                        <div className="flex justify-between">
                            <span>Locked in escrow</span>
                            <span className="font-mono text-foreground">
                                {amountBase !== null ? formatToken(Number(amountBase), currency) : '0'} {currency}
                            </span>
                        </div>
                        <div className="mt-1 flex justify-between">
                            <span>Platform fee on success (2%)</span>
                            <span className="font-mono">
                                {payout ? formatToken(payout.fee, currency) : '0'} {currency}
                            </span>
                        </div>
                        <div className="mt-1 flex justify-between">
                            <span>Worker receives</span>
                            <span className="font-mono text-foreground">
                                {payout ? formatToken(payout.worker, currency) : '0'} {currency}
                            </span>
                        </div>
                    </div>

                    {error && (
                        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            {error}
                        </p>
                    )}

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={submitting}
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={submitting}
                            className="bg-primary text-primary-foreground hover:bg-primary/90"
                        >
                            {submitting ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Lock className="mr-2 h-4 w-4" />
                            )}
                            {submitting ? 'Confirm in wallet…' : `Create & lock ${currency}`}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

export default CreateDealModal;
