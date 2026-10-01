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
  amount_clp?: number | null;
  order_count?: number | null;
};

export type ProviderHistoryResponse = {
  ok?: boolean;
  schema?: string;
  rut?: string;
  period?: { from_year?: number; to_year?: number };
  summary?: ProviderHistorySummary | null;
  years?: ProviderHistoryYear[];
  buyers?: ProviderHistoryBuyer[];
  semantics?: Record<string, unknown>;
};

const PROVIDER_HISTORY_ENDPOINT = 'https://bzqxvidggykkdouotylg.supabase.co/functions/v1/provider-entity-history';

export async function fetchProviderHistory(rut: string, fromYear: number, toYear: number): Promise<ProviderHistoryResponse> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.access_token) throw new Error('Sesión Atlas no disponible para consultar el histórico de Mercado Público.');

  const response = await fetch(PROVIDER_HISTORY_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rut, from_year: fromYear, to_year: toYear }),
  });

  let payload: ProviderHistoryResponse & { error?: string };
  try {
    payload = await response.json() as ProviderHistoryResponse & { error?: string };
  } catch {
    throw new Error('El histórico de Mercado Público devolvió una respuesta no válida.');
  }

  if (!response.ok || payload.ok === false) {
    if (response.status === 401 || response.status === 403) throw new Error('La sesión no está habilitada para consultar el histórico de Mercado Público.');
    throw new Error(payload.error || `No fue posible consultar el histórico de Mercado Público (${response.status}).`);
  }

  return payload;
}
