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
  if (err.code === '57014' || /statement timeout|canceling statement due to statement timeout/i.test(err.message ?? '')) {
    return 'La consulta excedió el tiempo máximo. Atlas detuvo ese intento para proteger el servicio; reintenta o completa más caracteres del nombre.';
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
      // Invalida cualquier respuesta tardía de una consulta que dejó de ser
      // pertinente (p. ej. porque el analista borró o cambió el texto).
      ++seq.current;
      setError(null);
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
