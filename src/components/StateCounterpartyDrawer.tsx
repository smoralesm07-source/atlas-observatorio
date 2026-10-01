import { useEffect, useMemo, useState } from 'react';
import { fetchProviderCounterpartyHistory } from '../lib/providerHistory';
import { supabase } from '../lib/supabase';
import '../styles/state-counterparty-drawer.css';

// Las consultas de identidad e histórico se ejecutan sólo al abrir la ficha:
// no agregan costo al render inicial de Huella pública.
export type StateCounterpartySelection = {
  kind: 'buyer' | 'payer';
  label: string;
  identifier?: string | null;
  amount?: number | null;
  count?: number | null;
  firstYear?: number | null;
  lastYear?: number | null;
  supplierRole?: boolean | null;
  recipientRole?: boolean | null;
  entityRut?: string | null;
};

type Candidate = {
  entity_id: string;
  rut?: string | null;
  name: string;
  entity_type?: string | null;
  region?: string | null;
  commune?: string | null;
  source_count?: number | null;
  identity_assertion?: boolean;
  match_type?: string | null;
  match_score?: number | null;
  openable?: boolean;
};

type SearchResponse = { items?: Candidate[] };

type ResolutionState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  candidates: Candidate[];
  error?: string;
};

type HistorySummary = {
  first_year?: number | null;
  last_year?: number | null;
  active_years?: number | null;
  amount_clp?: number | null;
  amount_paid?: number | null;
  order_count?: number | null;
  transaction_count?: number | null;
  share_pct?: number | null;
  rank?: number | null;
  buyer_count?: number | null;
  payer_count?: number | null;
  first_seen?: string | null;
  last_seen?: string | null;
  amount_as_supplier?: number | null;
  amount_as_recipient?: number | null;
  supplier_role?: boolean | null;
  recipient_role?: boolean | null;
  buyer_amount_clp?: number | null;
  buyer_share_pct?: number | null;
  buyer_supplier_rank?: number | null;
  buyer_supplier_count?: number | null;
};

type HistoryYear = {
  year: number;
  amount_clp?: number | null;
  amount_paid?: number | null;
  order_count?: number | null;
  transaction_count?: number | null;
  share_pct?: number | null;
  amount_as_supplier?: number | null;
  amount_as_recipient?: number | null;
  first_seen?: string | null;
  last_seen?: string | null;
  supplier_role?: boolean | null;
  recipient_role?: boolean | null;
  buyer_amount_clp?: number | null;
  buyer_share_pct?: number | null;
  buyer_supplier_rank?: number | null;
  buyer_supplier_count?: number | null;
};

type HistoryResponse = {
  ok?: boolean;
  summary?: HistorySummary | null;
  years?: HistoryYear[];
};

type HistoryState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  summary: HistorySummary | null;
  years: HistoryYear[];
  error?: string;
};

function normRut(value: string | null | undefined) {
  return String(value ?? '').toUpperCase().replace(/[^0-9K]/g, '');
}

function normName(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clp(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('es-CL', {
    style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
  }).format(Number(value));
}

function count(value: number | null | undefined) {
  return value == null ? '—' : Number(value).toLocaleString('es-CL');
}

function pct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  const abs = Math.abs(n);
  const digits = abs > 0 && abs < 0.1 ? 3 : abs < 1 ? 2 : 1;
  return `${n.toLocaleString('es-CL', { maximumFractionDigits: digits })}%`;
}

function dateLabel(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function period(item: StateCounterpartySelection) {
  if (!item.firstYear && !item.lastYear) return '—';
  if (item.firstYear === item.lastYear) return String(item.firstYear ?? item.lastYear);
  return `${item.firstYear ?? '…'}–${item.lastYear ?? '…'}`;
}

function scoreLabel(candidate: Candidate) {
  const score = Number(candidate.match_score ?? 0);
  if (!Number.isFinite(score) || score <= 0) return null;
  const value = score <= 1 ? score * 100 : score;
  return `${Math.round(value)}% coincidencia`;
}

function subjectRutFromView(item: StateCounterpartySelection) {
  if (item.entityRut && normRut(item.entityRut).length >= 7) return item.entityRut;
  if (typeof document === 'undefined') return '';
  const text = document.querySelector<HTMLElement>('.state-detail-title small')?.textContent ?? '';
  return normRut(text).length >= 7 ? text.trim() : '';
}

function roleLabel(year: HistoryYear) {
  const supplier = Boolean(year.supplier_role) || Number(year.amount_as_supplier ?? 0) > 0;
  const recipient = Boolean(year.recipient_role) || Number(year.amount_as_recipient ?? 0) > 0;
  if (supplier && recipient) return 'Proveedor + receptor';
  if (supplier) return 'Proveedor';
  if (recipient) return 'Traspaso / receptor';
  return 'Pago observado';
}

export function StateCounterpartyDrawer({
  item,
  onClose,
  onNavigate,
}: {
  item: StateCounterpartySelection | null;
  onClose: () => void;
  onNavigate: (hash: string) => void;
}) {
  const [resolution, setResolution] = useState<ResolutionState>({ status: 'idle', candidates: [] });
  const [history, setHistory] = useState<HistoryState>({ status: 'idle', summary: null, years: [] });

  useEffect(() => {
    if (!item) {
      setResolution({ status: 'idle', candidates: [] });
      return;
    }

    let cancelled = false;
    const search = item.kind === 'buyer' && item.identifier ? item.identifier : item.label;
    if (!search || search.trim().length < 2) {
      setResolution({ status: 'done', candidates: [] });
      return;
    }

    setResolution({ status: 'loading', candidates: [] });
    const run = async () => {
      try {
        const { data, error } = await supabase.rpc('atlas_v2_entity_search_cascade', {
          p_request: {
            kind: 'results',
            search,
            limit: 5,
            offset: 0,
            region: '',
            entity_type: '',
            uaf: false,
            sanctioned: false,
            min_sources: 0,
          },
        });
        if (cancelled) return;
        if (error) {
          setResolution({ status: 'error', candidates: [], error: error.message });
          return;
        }
        const candidates = ((data as SearchResponse | null)?.items ?? []).slice(0, 5);
        setResolution({ status: 'done', candidates });
      } catch (error) {
        if (cancelled) return;
        setResolution({
          status: 'error', candidates: [],
          error: error instanceof Error ? error.message : 'No fue posible resolver la contraparte.',
        });
      }
    };
    void run();

    return () => { cancelled = true; };
  }, [item]);

  useEffect(() => {
    if (!item) {
      setHistory({ status: 'idle', summary: null, years: [] });
      return;
    }

    const subjectRut = subjectRutFromView(item);
    const identifier = String(item.identifier ?? '').trim();
    if (!subjectRut || !identifier) {
      setHistory({ status: 'done', summary: null, years: [] });
      return;
    }

    let cancelled = false;
    const currentYear = new Date().getFullYear();
    const fromYear = Math.max(2016, Number(item.firstYear ?? 2020) || 2020);
    const toYear = Math.min(currentYear, Math.max(fromYear, Number(item.lastYear ?? currentYear) || currentYear));
    setHistory({ status: 'loading', summary: null, years: [] });

    const run = async () => {
      try {
        let payload: HistoryResponse;
        if (item.kind === 'buyer') {
          payload = await fetchProviderCounterpartyHistory(subjectRut, identifier, fromYear, toYear) as HistoryResponse;
        } else {
          const { data, error } = await supabase.rpc('obs_state_public_funds_counterparty_history', {
            p_rut: subjectRut,
            p_payer_key: identifier,
            p_from_year: fromYear,
            p_to_year: toYear,
          });
          if (error) throw error;
          payload = (data ?? {}) as HistoryResponse;
        }
        if (cancelled) return;
        setHistory({
          status: 'done',
          summary: payload.summary ?? null,
          years: Array.isArray(payload.years) ? payload.years : [],
        });
      } catch (error) {
        if (cancelled) return;
        setHistory({
          status: 'error', summary: null, years: [],
          error: error instanceof Error ? error.message : 'No fue posible recuperar la evolución anual.',
        });
      }
    };
    void run();

    return () => { cancelled = true; };
  }, [item]);

  useEffect(() => {
    if (!item) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  const exact = useMemo(() => {
    if (!item || !resolution.candidates.length) return null;
    if (item.kind === 'buyer' && item.identifier) {
      const target = normRut(item.identifier);
      return resolution.candidates.find((candidate) => normRut(candidate.rut) === target) ?? null;
    }
    const target = normName(item.label);
    const exactNames = resolution.candidates.filter((candidate) => normName(candidate.name) === target);
    return exactNames.length === 1 ? exactNames[0] : null;
  }, [item, resolution.candidates]);

  if (!item) return null;

  const source = item.kind === 'buyer' ? 'Mercado Público' : 'Presupuesto Abierto';
  const recordLabel = item.kind === 'buyer' ? 'órdenes de compra' : 'transacciones';
  const roles = [item.supplierRole ? 'Pago como proveedor' : null, item.recipientRole ? 'Traspaso / receptor' : null].filter(Boolean);
  const historySummary = history.summary;
  const rank = historySummary?.rank == null ? null : Number(historySummary.rank);
  const universe = historySummary?.payer_count;
  const buyerSupplierRank = historySummary?.buyer_supplier_rank == null ? null : Number(historySummary.buyer_supplier_rank);
  const buyerSupplierCount = historySummary?.buyer_supplier_count == null ? null : Number(historySummary.buyer_supplier_count);
  const average = item.amount != null && item.count != null && Number(item.count) > 0 ? Number(item.amount) / Number(item.count) : null;
  const activeYears = historySummary?.active_years == null ? null : Number(historySummary.active_years);
  const representativityHint = buyerSupplierRank != null && buyerSupplierCount != null
    ? `del total comprado · #${count(buyerSupplierRank)} de ${count(buyerSupplierCount)} proveedores`
    : 'del total comprado por el organismo';

  const open = (candidate: Candidate) => {
    onClose();
    onNavigate(`#/entidad/${encodeURIComponent(candidate.entity_id)}`);
  };

  return (
    <div className="state-counterparty-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="state-counterparty-drawer" role="dialog" aria-modal="true" aria-label="Detalle de contraparte pública">
        <header className="state-counterparty-head">
          <div>
            <span>{item.kind === 'buyer' ? 'Organismo comprador' : 'Organismo pagador'}</span>
            <h3>{item.label}</h3>
            <small>{source}{item.identifier ? ` · ${item.identifier}` : ''}</small>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar detalle">×</button>
        </header>

        <section className="state-counterparty-facts">
          <div><span>Monto observado</span><strong>{clp(item.amount)}</strong></div>
          <div><span>{recordLabel}</span><strong>{count(item.count)}</strong></div>
          <div><span>Período</span><strong>{period(item)}</strong></div>
        </section>

        {history.status === 'loading' && (
          <section className="state-counterparty-context">
            <div className="state-counterparty-status">Construyendo detalle histórico de esta relación…</div>
          </section>
        )}

        {history.status === 'done' && historySummary && (
          <section className="state-counterparty-context">
            <div className="state-counterparty-section-title">
              <div><span>Lectura de la relación</span><strong>Contexto dentro de la huella pública</strong></div>
            </div>
            <div className="state-counterparty-context-grid">
              {item.kind === 'buyer'
                ? <div><span>Dependencia</span><strong>{pct(historySummary.share_pct)}</strong><small>de las ventas públicas de la entidad</small></div>
                : <div><span>Participación</span><strong>{pct(historySummary.share_pct)}</strong><small>del monto público observado en el período</small></div>}
              {item.kind === 'buyer'
                ? <div><span>Representatividad</span><strong>{pct(historySummary.buyer_share_pct)}</strong><small>{representativityHint}</small></div>
                : <div><span>Posición</span><strong>{rank != null ? `#${rank}` : '—'}</strong><small>{universe != null ? `de ${count(universe)} contrapartes` : 'según monto acumulado'}</small></div>}
              <div><span>Promedio</span><strong>{clp(average)}</strong><small>por {item.kind === 'buyer' ? 'orden de compra' : 'transacción'}</small></div>
              <div><span>Años activos</span><strong>{activeYears == null ? '—' : count(activeYears)}</strong><small>{historySummary.first_year && historySummary.last_year ? `${historySummary.first_year}–${historySummary.last_year}` : 'en el período consultado'}</small></div>
            </div>
            {item.kind === 'payer' && (historySummary.first_seen || historySummary.last_seen) && (
              <div className="state-counterparty-observed-dates">
                <span>Primera observación <b>{dateLabel(historySummary.first_seen)}</b></span>
                <span>Última observación <b>{dateLabel(historySummary.last_seen)}</b></span>
              </div>
            )}
          </section>
        )}

        {history.status === 'done' && history.years.length > 0 && (
          <section className="state-counterparty-history">
            <div className="state-counterparty-section-title">
              <div><span>Evolución anual</span><strong>Detalle de esta contraparte por año</strong></div>
              <em>{history.years.length} {history.years.length === 1 ? 'año' : 'años'}</em>
            </div>
            <div className="state-counterparty-year-head">
              <span>Año</span><span>Monto</span><span>{item.kind === 'buyer' ? 'OC' : 'Mov.'}</span><span>{item.kind === 'buyer' ? 'Rep.' : 'Rol'}</span>
            </div>
            <div className="state-counterparty-years">
              {history.years.map((year) => {
                const amount = item.kind === 'buyer' ? year.amount_clp : year.amount_paid;
                const records = item.kind === 'buyer' ? year.order_count : year.transaction_count;
                return (
                  <div className="state-counterparty-year" key={`${item.kind}-${year.year}`}>
                    <strong>{year.year}</strong>
                    <b>{clp(amount)}</b>
                    <span>{count(records)}</span>
                    <small>{item.kind === 'buyer' ? pct(year.buyer_share_pct) : roleLabel(year)}</small>
                  </div>
                );
              })}
            </div>
            <p className="state-counterparty-history-note">{item.kind === 'buyer'
              ? 'Agregado anual de Mercado Público. Rep. corresponde a la participación de este proveedor en el monto total comprado por el organismo durante ese año.'
              : 'Agregado anual de Presupuesto Abierto. Se conserva la clasificación observada entre pago como proveedor y traspaso/receptor.'}</p>
          </section>
        )}

        {history.status === 'error' && (
          <section className="state-counterparty-context">
            <div className="state-counterparty-status" data-tone="error">El detalle histórico no estuvo disponible en esta consulta. Los datos principales de la contraparte siguen siendo válidos.</div>
          </section>
        )}

        {item.kind === 'payer' && (
          <section className="state-counterparty-source-note">
            <strong>Qué representa esta contraparte</strong>
            <p>Presupuesto Abierto identifica al organismo pagador mediante una clave administrativa. Atlas conserva esa identidad de fuente y sólo la enlaza con Entidad 360 cuando encuentra una equivalencia suficientemente clara.</p>
            {roles.length > 0 && <div>{roles.map((role) => <span key={String(role)}>{role}</span>)}</div>}
          </section>
        )}

        <section className="state-counterparty-resolution">
          <div className="state-counterparty-section-title">
            <div><span>Identidad Atlas</span><strong>{item.kind === 'buyer' ? 'Resolución por RUT' : 'Resolución por nombre'}</strong></div>
            {exact && <em>resuelta</em>}
          </div>

          {resolution.status === 'loading' && <div className="state-counterparty-status">Buscando una entidad equivalente en Atlas…</div>}
          {resolution.status === 'error' && <div className="state-counterparty-status" data-tone="error">No fue posible resolver la identidad en esta consulta. La ficha de fuente sigue siendo válida.</div>}

          {resolution.status === 'done' && exact && (
            <button type="button" className="state-counterparty-exact" onClick={() => open(exact)}>
              <span><strong>{exact.name}</strong><small>{[exact.rut, exact.entity_type, exact.commune, exact.region].filter(Boolean).join(' · ')}</small></span>
              <b>Entidad 360 →</b>
            </button>
          )}

          {resolution.status === 'done' && !exact && resolution.candidates.length > 0 && (
            <div className="state-counterparty-candidates">
              <p>{item.kind === 'payer'
                ? 'El nombre del organismo no permite asumir una identidad única. Revisa los candidatos antes de abrir una ficha.'
                : 'No se obtuvo una coincidencia exacta por RUT; se muestran candidatos para revisión.'}</p>
              {resolution.candidates.map((candidate) => (
                <button type="button" key={candidate.entity_id} onClick={() => open(candidate)}>
                  <span><strong>{candidate.name}</strong><small>{[candidate.rut, candidate.entity_type, candidate.commune, candidate.region].filter(Boolean).join(' · ')}</small></span>
                  <em>{scoreLabel(candidate) ?? 'Revisar'}</em>
                </button>
              ))}
            </div>
          )}

          {resolution.status === 'done' && resolution.candidates.length === 0 && (
            <div className="state-counterparty-status">La contraparte está documentada en {source}, pero Atlas todavía no tiene una identidad equivalente para abrir en Entidad 360.</div>
          )}
        </section>

        <footer>
          {item.kind === 'payer'
            ? 'La ficha agrega historia anual y contexto de la relación. El detalle de cada pago individual aún no está materializado en el hot path de Atlas.'
            : 'La ficha agrega historia anual y contexto de la relación. El detalle de cada orden individual se mantiene fuera del hot path y se resolverá a demanda.'}
        </footer>
      </aside>
    </div>
  );
}
