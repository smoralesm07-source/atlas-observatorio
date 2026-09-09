import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

type RpcError = { message?: string; hint?: string; code?: string } | null;

function isStatementTimeout(e: unknown): boolean {
  const err = e as RpcError;
  return Boolean(
    err && (
      err.code === '57014'
      || /statement timeout|canceling statement due to statement timeout/i.test(err.message ?? '')
    )
  );
}

function message(e: unknown, fn?: string): string {
  const err = e as RpcError;
  if (!err) return 'Error desconocido.';
  if (err.code === 'PGRST301' || err.code === '42501') {
    return 'Tu cuenta no está habilitada en la lista de acceso del Observatorio.';
  }
  if (isStatementTimeout(err)) {
    if (fn === 'obs_entity_detail') {
      return 'La ficha completa tardó más de lo esperado incluso después de un reintento automático. Puedes reintentar sin perder la entidad seleccionada.';
    }
    return 'La consulta excedió el tiempo máximo. Atlas detuvo ese intento para proteger el servicio; reintenta o completa más caracteres del nombre.';
  }
  return err.message ?? 'Error desconocido.';
}

/** Calls an obs_* contract and tracks its lifecycle. Late responses from a
 *  superseded call are dropped, so a fast typist never sees stale results.
 *  Entity 360 retries one statement-timeout automatically: its lookup is an
 *  exact entity-id request, so a second attempt is safe and absorbs transient
 *  database contention without making broad searches run twice. */
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
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const parsedArgs = JSON.parse(argKey) as Record<string, unknown>;
    const mayRetryTimeout = fn === 'obs_entity_detail';

    setError(null);
    setLoading(true);

    const run = (attempt: number) => {
      supabase
        .rpc(fn, parsedArgs)
        .then(({ data: d, error: e }) => {
          if (my !== seq.current) return;

          if (e && mayRetryTimeout && isStatementTimeout(e) && attempt === 0) {
            // Breve backoff para dejar salir la consulta cancelada y reintentar
            // el expediente exacto sin mostrar un falso fallo permanente.
            retryTimer = setTimeout(() => {
              if (my === seq.current) run(1);
            }, 450);
            return;
          }

          if (e) {
            setError(message(e, fn));
            setData(null);
          } else {
            setError(null);
            setData(d as T);
          }
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (my !== seq.current) return;
          setError(message(e, fn));
          setData(null);
          setLoading(false);
        });
    };

    run(0);

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      if (seq.current === my) ++seq.current;
    };
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
