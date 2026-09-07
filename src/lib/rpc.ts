import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

function message(e: unknown): string {
  const err = e as { message?: string; hint?: string; code?: string } | null;
  if (!err) return 'Error desconocido.';
  if (err.code === 'PGRST301' || err.code === '42501') {
    return 'Tu cuenta no está habilitada en la lista de acceso del Observatorio.';
  }
  return err.message ?? 'Error desconocido.';
}

/** Calls an obs_* contract and tracks its lifecycle. Late responses from a
 *  superseded call are dropped, so a fast typist never sees stale results. */
export function useRpc<T>(
  fn: string,
  args: Record<string, unknown>,
  opts: { skip?: boolean } = {},
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!opts.skip);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);
  const argKey = JSON.stringify(args);

  useEffect(() => {
    if (opts.skip) {
      setLoading(false);
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    supabase
      .rpc(fn, JSON.parse(argKey))
      .then(({ data: d, error: e }) => {
        if (my !== seq.current) return;
        if (e) {
          setError(message(e));
          setData(null);
        } else {
          setError(null);
          setData(d as T);
        }
        setLoading(false);
      });
  }, [fn, argKey, opts.skip, nonce]);

  const reload = useCallback(() => setNonce((v) => v + 1), []);
  return { data, error, loading, reload };
}

export function useDebounced<T>(value: T, ms = 220): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
