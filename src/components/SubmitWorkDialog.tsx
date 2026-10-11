import { useEffect, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Deal, MAX_SUBMISSION_LEN, computePayout, formatToken } from '@/lib/deals';

interface SubmitWorkDialogProps {
    deal: Deal | null;
    onOpenChange: (open: boolean) => void;
    onSubmit: (deal: Deal, submission: string) => Promise<boolean>;
}

const SubmitWorkDialog = ({ deal, onOpenChange, onSubmit }: SubmitWorkDialogProps) => {
    const [text, setText] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (deal) {
            setText('');
            setError(null);
        }
    }, [deal]);

    const handle = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!deal) return;
        const value = text.trim();
        if (!value) {
            setError('Add a link or short note describing your delivery.');
            return;
        }
        if (new TextEncoder().encode(value).length > MAX_SUBMISSION_LEN) {
            setError(`Keep it under ${MAX_SUBMISSION_LEN} bytes.`);
            return;
        }
        setSubmitting(true);
        const ok = await onSubmit(deal, value);
        setSubmitting(false);
        if (ok) onOpenChange(false);
    };

    return (
        <Dialog open={!!deal} onOpenChange={(o) => !submitting && onOpenChange(o)}>
            <DialogContent className="border-border bg-card sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="font-display text-xl">
                        {deal?.worker ? 'Submit work' : 'Claim & submit work'}
                    </DialogTitle>
                    <DialogDescription>
                        {deal?.worker
                            ? 'The creator will review your delivery and release payment.'
                            : 'Submitting assigns this open deal to your wallet.'}
                        {deal && (
                            <span className="mt-1 block text-foreground">
                                You receive {formatToken(computePayout(deal.amount).worker, deal.currency)}{' '}
                                {deal.currency} on approval.
                            </span>
                        )}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handle} className="space-y-4">
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="submission">Delivery link or note</Label>
                            <span className="text-[11px] text-muted-foreground">
                                {text.length}/{MAX_SUBMISSION_LEN}
                            </span>
                        </div>
                        <Textarea
                            id="submission"
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            maxLength={MAX_SUBMISSION_LEN}
                            rows={3}
                            placeholder="https://github.com/… or a short summary of what you delivered"
                            className="resize-none bg-background"
                        />
                    </div>

                    {error && (
                        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            {error}
                        </p>
                    )}

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button type="button" variant="ghost" disabled={submitting} onClick={() => onOpenChange(false)}>
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
                                <Send className="mr-2 h-4 w-4" />
                            )}
                            {submitting ? 'Confirm in wallet…' : 'Submit on-chain'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

export default SubmitWorkDialog;
