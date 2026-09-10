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

/**
 * Errores que pueden aparecer durante un reinicio, failover o recuperación
 * breve de Postgres/PostgREST. No significan que el contrato esté roto y, para
 * una consulta exacta por entity_id, es seguro reintentar con backoff.
 */
function isTransientRpcError(e: unknown): boolean {
  const err = e as RpcError;
  const code = err?.code ?? '';
  const msg = err?.message ?? (e instanceof Error ? e.message : '');

  return Boolean(
    isStatementTimeout(e)
    || ['57P03', '53300', '08000', '08001', '08003', '08004', '08006', 'PGRST000', 'PGRST001', 'PGRST002'].includes(code)
    || /database system is (starting up|not accepting connections)|connection (?:reset|refused|terminated)|failed to fetch|networkerror|fetch failed|temporarily unavailable|upstream.*timeout/i.test(msg)
  );
}

function message(e: unknown, fn?: string): string {
  const err = e as RpcError;
  if (!err) return 'Error desconocido.';
  if (err.code === 'PGRST301' || err.code === '42501') {
    return 'Tu cuenta no está habilitada en la lista de acceso del Observatorio.';
  }
  if (fn === 'obs_entity_detail' && isTransientRpcError(err)) {
    return 'Atlas no recibió una respuesta estable de la base de datos después de varios intentos automáticos. La entidad sigue seleccionada; puedes reintentar sin volver a buscarla.';
  }
  if (isStatementTimeout(err)) {
    return 'La consulta excedió el tiempo máximo. Atlas detuvo ese intento para proteger el servicio; reintenta o completa más caracteres del nombre.';
  }
  return err.message ?? 'Error desconocido.';
}

/** Calls an obs_* contract and tracks its lifecycle. Late responses from a
 *  superseded call are dropped, and data from the superseded request is also
 *  cleared immediately. This is important for search screens: the query shown
 *  in the input must never coexist with rows returned for a previous query.
 *
 *  Entity 360 is different from a broad search: it is an exact entity-id
 *  lookup. Por eso puede absorber una ventana breve de recuperación de
 *  Supabase sin duplicar trabajo ambiguo. Se hacen hasta tres intentos con
 *  backoff creciente y también se consideran transitorios los errores de
 *  conexión/failover, no sólo statement_timeout. */
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
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    const my = ++seq.current;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const parsedArgs = JSON.parse(argKey) as Record<string, unknown>;
    const resilientEntityDetail = fn === 'obs_entity_detail';
    const maxAttempts = resilientEntityDetail ? 3 : 1;
    // El primer reintento deja pasar un microcorte; el segundo cubre una
    // recuperación algo más larga sin martillar la base de datos.
    const retryDelays = [1400, 3600];

    // No conservar resultados de los argumentos anteriores mientras llega la
    // nueva respuesta. De lo contrario una búsqueda nueva puede rotular como
    // propios resultados que en realidad pertenecen a la consulta anterior.
    setData(null);
    setError(null);
    setLoading(true);

    const scheduleRetry = (attempt: number, cause: unknown): boolean => {
      if (!resilientEntityDetail || !isTransientRpcError(cause) || attempt + 1 >= maxAttempts) {
        return false;
      }

      const delay = retryDelays[attempt] ?? retryDelays[retryDelays.length - 1];
      retryTimer = setTimeout(() => {
        if (my === seq.current) void run(attempt + 1);
      }, delay);
      return true;
    };

    const run = async (attempt: number): Promise<void> => {
      try {
        const { data: d, error: e } = await supabase.rpc(fn, parsedArgs);
        if (my !== seq.current) return;

        if (e && scheduleRetry(attempt, e)) return;

        if (e) {
          setError(message(e, fn));
          setData(null);
        } else {
          setError(null);
          setData(d as T);
        }
        setLoading(false);
      } catch (e) {
        if (my !== seq.current) return;
        if (scheduleRetry(attempt, e)) return;
        setError(message(e, fn));
        setData(null);
        setLoading(false);
      }
    };

    void run(0);

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      if (seq.current === my) ++seq.current;
    };
  }, [fn, argKey, opts.skip, nonce]);

  const reload = useCallback(() => setNonce((v) => v + 1), []);
  return { data, error, loading, reload };
}

export interface PagedState<T> {
  rows: T[];
  /** Total del corte según la propia fila, cuando el contrato lo publica. */
  total: number | null;
  loading: boolean;
  /** Verdadero mientras se traen las páginas siguientes a la primera. */
  loadingMore: boolean;
  error: string | null;
  /** No queda nada por traer: se agotó el corte. */
  complete: boolean;
  /** Se alcanzó el techo de páginas y el corte sigue teniendo filas. */
  capped: boolean;
  loadMore: () => void;
  reload: () => void;
}

/**
 * Lee un contrato paginado y acumula sus páginas.
 *
 * Una cola de trabajo se filtra y se ordena entera o no se filtra: si la
 * pantalla filtrara sobre las 200 primeras filas que devolvió el servidor,
 * diría «3 casos en Valparaíso» cuando el corte tiene diecisiete. Por eso este
 * hook trae las páginas siguientes por su cuenta hasta agotar el corte, con un
 * techo declarado para no encadenar decenas de consultas si la cohorte crece.
 * Al llegar al techo deja de pedir y lo dice, en vez de mentir por omisión.
 */
export function useRpcPaged<T>(
  fn: string,
  args: Record<string, unknown>,
  opts: {
    pageSize?: number;
    /** Páginas que se traen sin intervención. El resto se pide a mano. */
    maxPages?: number;
    totalOf?: (row: T) => number | null | undefined;
    skip?: boolean;
  } = {},
): PagedState<T> {
  const { pageSize = 200, maxPages = 8, totalOf, skip } = opts;
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(!skip);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [pageCap, setPageCap] = useState(maxPages);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);
  const argKey = JSON.stringify(args);
  // El extractor del total suele escribirse en línea en la llamada, de modo que
  // cambia de identidad en cada render. En el arreglo de dependencias eso
  // reiniciaría la paginación sin fin, así que viaja por referencia.
  const totalRef = useRef(totalOf);
  totalRef.current = totalOf;

  useEffect(() => {
    setPageCap(maxPages);
  }, [maxPages, fn, argKey, nonce]);

  useEffect(() => {
    if (skip) {
      ++seq.current;
      setRows([]);
      setTotal(null);
      setError(null);
      setLoading(false);
      setLoadingMore(false);
      setComplete(false);
      return;
    }

    const my = ++seq.current;
    const parsedArgs = JSON.parse(argKey) as Record<string, unknown>;
    setRows([]);
    setTotal(null);
    setError(null);
    setComplete(false);
    setLoading(true);
    setLoadingMore(false);

    const run = async () => {
      const acc: T[] = [];
      let declared: number | null = null;

      for (let page = 0; page < pageCap; page += 1) {
        const { data, error: e } = await supabase.rpc(fn, {
          ...parsedArgs,
          p_limit: pageSize,
          p_offset: page * pageSize,
        });
        if (my !== seq.current) return;

        if (e) {
          setError(message(e, fn));
          setLoading(false);
          setLoadingMore(false);
          return;
        }

        const batch = (data ?? []) as T[];
        acc.push(...batch);
        const extract = totalRef.current;
        if (declared == null && batch.length > 0 && extract) {
          declared = extract(batch[0]) ?? null;
          setTotal(declared);
        }
        setRows(acc.slice());
        setLoading(false);

        const exhausted = batch.length < pageSize
          || (declared != null && acc.length >= declared);
        if (exhausted) {
          setComplete(true);
          setLoadingMore(false);
          return;
        }
        setLoadingMore(true);
      }
      setLoadingMore(false);
    };

    void run();

    return () => {
      if (seq.current === my) ++seq.current;
    };
  }, [fn, argKey, skip, pageSize, pageCap, nonce]);

  const loadMore = useCallback(() => setPageCap((v) => v + maxPages), [maxPages]);
  const reload = useCallback(() => setNonce((v) => v + 1), []);

  const capped = !complete && !loading && !loadingMore && !error && rows.length > 0;
  return { rows, total, loading, loadingMore, error, complete, capped, loadMore, reload };
}

export function useDebounced<T>(value: T, ms = 220): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
