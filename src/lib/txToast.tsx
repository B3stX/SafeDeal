import { ExternalLink } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { solscanTx } from './deals';

/** Success toast with a Solscan (devnet) link to the confirmed transaction */
export const txSuccessToast = (title: string, signature: string) =>
    toast({
        title,
        description: (
            <a
                href={solscanTx(signature)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-xs text-primary hover:underline"
            >
                {signature.slice(0, 10)}…{signature.slice(-6)} · View on Solscan
                <ExternalLink className="h-3 w-3" />
            </a>
        ),
    });

export const txErrorToast = (title: string, message?: string) =>
    toast({ title, description: message, variant: 'destructive' });
