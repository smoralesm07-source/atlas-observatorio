import { supabase } from './supabase';

export type ProviderHistorySummary = {
  first_year?: number | null;
  last_year?: number | null;
  first_seen?: string | null;
  last_seen?: string | null;
  amount_clp?: number | null;
  order_count?: number | null;
  buyer_count?: number | null;
};

export type ProviderHistoryYear = {
  year: number;
  amount_clp?: number | null;
  order_count?: number | null;
  buyer_count?: number | null;
  active_months?: number | null;
  first_seen?: string | null;
  last_seen?: string | null;
};

export type ProviderHistoryBuyer = {
  buyer_id: string;
  buyer_label?: string | null;
  amount_clp?: number | null;
  order_count?: number | null;
};

export type ProviderHistoryResponse = {
  ok?: boolean;
  schema?: string;
  rut?: string;
  label?: string | null;
  period?: { from_year?: number; to_year?: number };
  summary?: ProviderHistorySummary | null;
  years?: ProviderHistoryYear[];
  buyers?: ProviderHistoryBuyer[];
  semantics?: Record<string, unknown>;
};

export type ProviderCounterpartyHistorySummary = {
  first_year?: number | null;
  last_year?: number | null;
  active_years?: number | null;
  amount_clp?: number | null;
  order_count?: number | null;
  supplier_amount_clp?: number | null;
  share_pct?: number | null;
  rank?: number | null;
  buyer_count?: number | null;
};

export type ProviderCounterpartyHistoryYear = {
  year: number;
  amount_clp?: number | null;
  order_count?: number | null;
  supplier_amount_clp?: number | null;
  share_pct?: number | null;
};

export type ProviderCounterpartyHistoryResponse = {
  ok?: boolean;
  schema?: string;
  rut?: string;
  buyer_id?: string;
  buyer_label?: string | null;
  period?: { from_year?: number; to_year?: number };
  summary?: ProviderCounterpartyHistorySummary | null;
  years?: ProviderCounterpartyHistoryYear[];
  semantics?: Record<string, unknown>;
};

const PROVIDER_HISTORY_ENDPOINT = 'https://bzqxvidggykkdouotylg.supabase.co/functions/v1/provider-entity-history';

async function postProviderHistory<T>(body: Record<string, unknown>): Promise<T> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.access_token) throw new Error('Sesión Atlas no disponible para consultar el histórico de Mercado Público.');

  const response = await fetch(PROVIDER_HISTORY_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  let payload: (T & { ok?: boolean; error?: string });
  try {
    payload = await response.json() as T & { ok?: boolean; error?: string };
  } catch {
    throw new Error('El histórico de Mercado Público devolvió una respuesta no válida.');
  }

  if (!response.ok || payload.ok === false) {
    if (response.status === 401 || response.status === 403) throw new Error('La sesión no está habilitada para consultar el histórico de Mercado Público.');
    throw new Error(payload.error || `No fue posible consultar el histórico de Mercado Público (${response.status}).`);
  }

  return payload;
}

export function fetchProviderHistory(rut: string, fromYear: number, toYear: number): Promise<ProviderHistoryResponse> {
  return postProviderHistory<ProviderHistoryResponse>({ rut, from_year: fromYear, to_year: toYear });
}

export function fetchProviderCounterpartyHistory(
  rut: string,
  buyerId: string,
  fromYear: number,
  toYear: number,
): Promise<ProviderCounterpartyHistoryResponse> {
  return postProviderHistory<ProviderCounterpartyHistoryResponse>({
    rut,
    buyer_id: buyerId,
    from_year: fromYear,
    to_year: toYear,
  });
}
