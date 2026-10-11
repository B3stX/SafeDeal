import { useCallback, useEffect, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { fetchSolUsd, SolUsdQuote } from '@/lib/pyth';

const POLL_MS = 20_000;

/** Live SOL/USD from Pyth (devnet push feed, Hermes fallback) */
export const useSolPrice = () => {
    const { connection } = useConnection();
    const [quote, setQuote] = useState<SolUsdQuote | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const q = await fetchSolUsd(connection);
            setQuote(q);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Price unavailable');
        }
    }, [connection]);

    useEffect(() => {
        load();
        const id = setInterval(load, POLL_MS);
        return () => clearInterval(id);
    }, [load]);

    return { quote, solUsd: quote?.price ?? null, error, reload: load };
};
