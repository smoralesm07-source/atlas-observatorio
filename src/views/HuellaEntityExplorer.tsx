import { useEffect, useMemo, useState } from 'react';
import { useDebounced, useRpc } from '../lib/rpc';
import { fetchProviderHistory, type ProviderHistoryResponse } from '../lib/providerHistory';
import { HuellaPublicaFlowChart, type PublicFundsTrendYear } from '../components/HuellaPublicaFlowChart';
import { HuellaPublicaPress } from '../components/HuellaPublicaPress';
import { HuellaPublicaPayerAnalytics } from '../components/HuellaPublicaPayerAnalytics';
import { HuellaCounterpartyExplorer } from '../components/HuellaCounterpartyExplorer';
import { StateCounterpartyDrawer, type StateCounterpartySelection } from '../components/StateCounterpartyDrawer';
import '../styles/state-relations.css';
import '../styles/state-relations-compact.css';

type SourceFilter = 'ALL' | 'MARKET' | 'FUNDS';
type CounterpartyExplorerState = { kind: 'buyer' | 'payer'; excludeTop?: number } | null;

type SearchRow = {
  rut: string;
  label?: string | null;
  entity_id?: string | null;
};

type SearchResponse = { ok?: boolean; rows?: SearchRow[] };

type MarketSummary = {
  rut?: string;
  label?: string | null;
  is_state_supplier?: boolean;
  first_year?: number;
  last_year?: number;
  first_seen?: string | null;
  last_seen?: string | null;
  amount_clp?: number | null;
  order_count?: number | null;
  buyer_count?: number | null;
};

type FundsSummary = {
  rut?: string;
  entity_id?: string | null;
  label?: string | null;
  amount_paid?: number | null;
  amount_as_recipient?: number | null;
  transaction_count?: number | null;
  payer_count?: number | null;
};

type SummaryResponse<T> = { ok?: boolean; summary?: T | null; supplier?: T | null; rows?: any[] };
type RowsResponse<T> = { ok?: boolean; rows?: T[] };
type MarketNamesResponse = { ok?: boolean; rows?: { rut: string; label?: string | null }[] };

function normRut(value: string) {
  return value.toUpperCase().replace(/[^0-9K]/g, '');
}

function clp(value: number | null | undefined) {
  return value == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(value));
}

function num(value: number | null | undefined) {
  return value == null ? '—' : Number(value).toLocaleString('es-CL');
}

function yearRange(first?: number | null, last?: number | null) {
  if (!first && !last) return '—';
  return first === last ? String(first ?? last) : `${first ?? '…'}–${last ?? '…'}`;
}

function normalizeSearch(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9k]+/g, ' ')
    .trim();
}

export function HuellaEntityExplorer({
  fromYear,
  toYear,
  onNavigate,
}: {
  fromYear: number;
  toYear: number;
  onNavigate: (hash: string) => void;
}) {
  const [q, setQ] = useState('');
  const [selectedRut, setSelectedRut] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('ALL');
  const [marketHistory, setMarketHistory] = useState<ProviderHistoryResponse | null>(null);
  const [marketHistoryState, setMarketHistoryState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [counterparty, setCounterparty] = useState<StateCounterpartySelection | null>(null);
  const [counterpartyExplorer, setCounterpartyExplorer] = useState<CounterpartyExplorerState>(null);

  const debounced = useDebounced(q, 280).trim();
  const enabled = debounced.length >= 3;
  const directRut = normRut(debounced);
  const directRutCandidate = /^[0-9]{6,8}[0-9K]$/.test(directRut);

  const marketSearch = useRpc<SearchResponse>('obs_state_interaction_entity', {
    p_action: 'search', p_query: debounced, p_rut: null, p_from_year: fromYear, p_to_year: toYear, p_limit: 20, p_offset: 0,
  }, { skip: !enabled });
  const fundsSearch = useRpc<SearchResponse>('obs_state_public_funds_entity', {
    p_action: 'search', p_query: debounced, p_rut: null, p_from_year: fromYear, p_to_year: toYear, p_limit: 20, p_offset: 0,
  }, { skip: !enabled });

  const merged = useMemo(() => {
    const map = new Map<string, { rut: string; label: string; market?: SearchRow; funds?: SearchRow }>();
    for (const row of marketSearch.data?.rows ?? []) {
      const key = normRut(row.rut);
      map.set(key, { rut: row.rut, label: row.label || row.rut, market: row });
    }
    for (const row of fundsSearch.data?.rows ?? []) {
      const key = normRut(row.rut);
      const previous = map.get(key);
      map.set(key, { rut: row.rut, label: row.label || previous?.label || row.rut, market: previous?.market, funds: row });
    }
    if (directRutCandidate && !map.has(directRut)) map.set(directRut, { rut: directRut, label: `Consultar RUT ${directRut}` });
    return [...map.values()].slice(0, 30);
  }, [marketSearch.data, fundsSearch.data, directRutCandidate, directRut]);

  const visibleRows = useMemo(() => merged.filter((row) => {
    if (sourceFilter === 'MARKET') return Boolean(row.market);
    if (sourceFilter === 'FUNDS') return Boolean(row.funds);
    return true;
  }), [merged, sourceFilter]);

  const marketSummary = useRpc<SummaryResponse<MarketSummary>>('obs_state_interaction_entity', {
    p_action: 'summary', p_rut: selectedRut, p_query: null, p_from_year: fromYear, p_to_year: toYear, p_limit: 100, p_offset: 0,
  }, { skip: !selectedRut });
  const marketBuyers = useRpc<SummaryResponse<any>>('obs_state_interaction_entity', {
    p_action: 'buyers', p_rut: selectedRut, p_query: null, p_from_year: fromYear, p_to_year: toYear, p_limit: 500, p_offset: 0,
  }, { skip: !selectedRut });
  const fundsSummary = useRpc<SummaryResponse<FundsSummary>>('obs_state_public_funds_entity', {
    p_action: 'summary', p_rut: selectedRut, p_query: null, p_from_year: fromYear, p_to_year: toYear, p_limit: 100, p_offset: 0,
  }, { skip: !selectedRut });
  const fundPayers = useRpc<SummaryResponse<any>>('obs_state_public_funds_entity', {
    p_action: 'payers', p_rut: selectedRut, p_query: null, p_from_year: fromYear, p_to_year: toYear, p_limit: 500, p_offset: 0,
  }, { skip: !selectedRut });
  const fundsTimeline = useRpc<RowsResponse<PublicFundsTrendYear>>('obs_state_public_funds_entity', {
    p_action: 'timeline', p_rut: selectedRut, p_query: null, p_from_year: fromYear, p_to_year: toYear, p_limit: 100, p_offset: 0,
  }, { skip: !selectedRut });

  const historicalBuyerRuts = useMemo(
    () => [...new Set((marketHistory?.buyers ?? []).map((row) => String(row.buyer_id ?? '')).filter(Boolean))],
    [marketHistory],
  );
  const historicalBuyerNames = useRpc<MarketNamesResponse>('obs_state_market_names', {
    p_ruts: historicalBuyerRuts,
  }, { skip: historicalBuyerRuts.length === 0 });

  useEffect(() => {
    let cancelled = false;
    if (!selectedRut) {
      setMarketHistory(null);
      setMarketHistoryState('idle');
      return () => { cancelled = true; };
    }
    setMarketHistory(null);
    setMarketHistoryState('loading');
    void fetchProviderHistory(selectedRut, fromYear, toYear)
      .then((data) => {
        if (cancelled) return;
        setMarketHistory(data);
        setMarketHistoryState('done');
      })
      .catch(() => {
        if (cancelled) return;
        setMarketHistory(null);
        setMarketHistoryState('error');
      });
    return () => { cancelled = true; };
  }, [selectedRut, fromYear, toYear]);

  const fallbackMarket = marketSummary.data?.supplier ?? null;
  const historySummary = marketHistory?.summary ?? null;
  const market: MarketSummary | null = historySummary ? {
    ...(fallbackMarket ?? {}),
    rut: selectedRut ?? fallbackMarket?.rut,
    is_state_supplier: true,
    first_year: historySummary.first_year ?? undefined,
    last_year: historySummary.last_year ?? undefined,
    first_seen: historySummary.first_seen ?? undefined,
    last_seen: historySummary.last_seen ?? undefined,
    amount_clp: historySummary.amount_clp ?? undefined,
    order_count: historySummary.order_count ?? undefined,
    buyer_count: historySummary.buyer_count ?? undefined,
  } : fallbackMarket;
  const funds = fundsSummary.data?.summary ?? null;

  const currentBuyerRows = (marketBuyers.data?.rows ?? []) as any[];
  const buyerLabels = new Map<string, string>();
  for (const row of historicalBuyerNames.data?.rows ?? []) {
    const key = normRut(String(row.rut ?? ''));
    if (key && row.label) buyerLabels.set(key, String(row.label));
  }
  for (const row of currentBuyerRows) {
    const key = normRut(String(row.buyer_id ?? ''));
    if (key && row.buyer_label && !buyerLabels.has(key)) buyerLabels.set(key, String(row.buyer_label));
  }

  const marketBuyerRows = historySummary
    ? (marketHistory?.buyers ?? []).map((row) => ({
        ...row,
        buyer_label: buyerLabels.get(normRut(row.buyer_id)) || (row as any).buyer_label || row.buyer_id,
        first_year: historySummary.first_year,
        last_year: historySummary.last_year,
      }))
    : currentBuyerRows;
  const fundPayerRows = (fundPayers.data?.rows ?? []) as any[];
  const selectedSearchRow = selectedRut ? merged.find((row) => normRut(row.rut) === normRut(selectedRut)) ?? null : null;
  const selectedEntityName = selectedSearchRow?.label || market?.label || funds?.label || selectedRut || '';
  const selectedEntityId = funds?.entity_id || selectedSearchRow?.funds?.entity_id || selectedSearchRow?.market?.entity_id || null;
  const marketSource = historySummary
    ? `Mercado Público · histórico ${fromYear}–${toYear}`
    : marketHistoryState === 'loading'
      ? 'Mercado Público · cargando histórico'
      : 'Mercado Público · resumen vigente 12m';

  const openBuyer = (row: any) => setCounterparty({
    kind: 'buyer', label: String(row.buyer_label || row.buyer_id || 'Organismo comprador'), identifier: row.buyer_id ? String(row.buyer_id) : null,
    amount: row.amount_clp == null ? null : Number(row.amount_clp), count: row.order_count == null ? null : Number(row.order_count),
    firstYear: row.first_year == null ? fromYear : Number(row.first_year), lastYear: row.last_year == null ? toYear : Number(row.last_year),
  });

  const openPayer = (row: any) => setCounterparty({
    kind: 'payer', label: String(row.payer_name || row.payer_key || 'Organismo pagador'), identifier: row.payer_key ? String(row.payer_key) : null,
    amount: row.amount_paid == null ? null : Number(row.amount_paid), count: row.transaction_count == null ? null : Number(row.transaction_count),
    firstYear: row.first_year == null ? fromYear : Number(row.first_year), lastYear: row.last_year == null ? toYear : Number(row.last_year),
    supplierRole: Boolean(row.supplier_role), recipientRole: Boolean(row.recipient_role),
  });

  return <div className="state-page fade-in"><div className="state-entity-layout">
    <section className="state-card state-search-card">
      <div className="huella-sidebar-title"><strong>Buscar entidad</strong><span>Busca una empresa, persona u organización.</span></div>
      <label className="state-label" htmlFor="state-entity-search">RUT o nombre</label>
      <input id="state-entity-search" className="state-search-input" value={q} onChange={(event) => { setQ(event.target.value); setSelectedRut(null); }} placeholder="Nombre, RUT o palabra clave" />
      <div className="state-search-help">Admite RUT con o sin puntos, guion o DV.</div>

      <div className="huella-search-filters" aria-label="Filtros rápidos de resultados">
        <button type="button" data-active={sourceFilter === 'ALL'} onClick={() => setSourceFilter('ALL')}>Todos</button>
        <button type="button" data-active={sourceFilter === 'MARKET'} onClick={() => setSourceFilter('MARKET')}>Proveedores</button>
        <button type="button" data-active={sourceFilter === 'FUNDS'} onClick={() => setSourceFilter('FUNDS')}>Pagos Estado</button>
      </div>

      <div className="huella-search-summary"><strong>{enabled ? `${visibleRows.length} resultados` : 'Resultados'}</strong><span>Más relevantes</span></div>
      {(marketSearch.loading || fundsSearch.loading) && <div className="state-muted">Buscando en las fuentes públicas…</div>}
      {enabled && !marketSearch.loading && !fundsSearch.loading && visibleRows.length === 0 && <div className="state-empty">Sin coincidencias para este filtro.</div>}
      <div className="state-search-results">
        {visibleRows.map((row) => <button key={normRut(row.rut)} className="state-search-result" data-active={selectedRut === row.rut} onClick={() => setSelectedRut(row.rut)}>
          <span className="huella-result-avatar" aria-hidden="true">▦</span>
          <span className="huella-result-copy">
            <strong>{row.label}</strong><small>{row.rut}</small>
            <span className="state-source-pills">{row.market && <em>Proveedor</em>}{row.funds && <em>Pagos Estado</em>}{!row.market && !row.funds && <em>Histórico por RUT</em>}</span>
          </span>
          <span className="huella-result-arrow" aria-hidden="true">›</span>
        </button>)}
      </div>
    </section>

    <section className="state-card state-detail-card">
      {!selectedRut ? <div className="state-empty state-empty-large"><div className="state-empty-icon">⌁</div><strong>Selecciona una entidad</strong><span>Atlas reconstruirá su huella pública con compras, pagos y principales contrapartes.</span><small>El detalle histórico se solicita sólo para la entidad seleccionada.</small></div> : <>
        <div className="state-detail-title">
          <div className="state-detail-identity">
            <span className="state-entity-avatar" aria-hidden="true">▦</span>
            <div><span>Entidad seleccionada</span><h2>{selectedEntityName}</h2><small>{selectedRut}</small><div className="state-detail-badges">{market && <em>Proveedor Estado</em>}{funds && <em>Pagos Estado</em>}{Number(funds?.amount_as_recipient || 0) > 0 && <em>Receptor / traspasos</em>}</div></div>
          </div>
          {selectedEntityId && <button className="state-secondary state-entity360-button" onClick={() => onNavigate(`#/entidad/${encodeURIComponent(selectedEntityId)}`)}>Ver en Entidad 360 →</button>}
        </div>

        <div className="state-kpis">
          <Kpi label="Ventas Mercado Público" value={clp(market?.amount_clp)} sub={market ? `${num(market.order_count)} OC · ${yearRange(market.first_year, market.last_year)}` : 'Sin compras observadas'} />
          <Kpi label="Pagos del Estado" value={clp(funds?.amount_paid)} sub={funds ? `${num(funds.transaction_count)} pagos · ${num(funds.payer_count)} pagadores` : 'Sin pagos observados'} />
          <Kpi label="Organismos compradores" value={num(market?.buyer_count)} sub={Number(funds?.amount_as_recipient || 0) > 0 ? `Traspasos: ${clp(funds?.amount_as_recipient)}` : `${num(funds?.payer_count)} pagadores observados`} />
        </div>

        <HuellaPublicaPress entityRut={selectedRut} entityName={selectedEntityName} entityId={selectedEntityId} fromYear={fromYear} toYear={toYear} onNavigate={onNavigate} />

        <HuellaPublicaFlowChart marketYears={marketHistory?.years ?? []} fundsYears={fundsTimeline.data?.rows ?? []} fundsLoading={fundsTimeline.loading} />

        <DetailTable title="Principales organismos compradores" source={marketSource} rows={marketBuyerRows} nameKey="buyer_label" fallbackKey="buyer_id" amountKey="amount_clp" countKey="order_count" totalCount={market?.buyer_count} onOpen={openBuyer} onShowAll={() => setCounterpartyExplorer({ kind: 'buyer' })} />

        <DetailTable title="¿Quién le ha pagado?" source="Presupuesto Abierto" rows={fundPayerRows} nameKey="payer_name" fallbackKey="payer_key" amountKey="amount_paid" countKey="transaction_count" totalCount={funds?.payer_count} onOpen={openPayer} onShowAll={() => setCounterpartyExplorer({ kind: 'payer' })} />

        <HuellaPublicaPayerAnalytics rows={fundPayerRows} onOpenOthers={() => setCounterpartyExplorer({ kind: 'payer', excludeTop: 5 })} />

        <div className="state-muted state-data-note">{historySummary
          ? `Mercado Público calculado sobre historia compacta ChileCompra para ${fromYear}–${toYear}.`
          : marketHistoryState === 'loading'
            ? 'Cargando historia de Mercado Público; mientras tanto se conserva el resumen vigente.'
            : marketHistoryState === 'error'
              ? 'Histórico de Mercado Público no disponible en esta consulta; se muestra el resumen vigente de 12 meses.'
              : 'Mercado Público: resumen vigente.'}</div>
      </>}
    </section>
  </div>
  <StateCounterpartyDrawer item={counterparty} onClose={() => setCounterparty(null)} onNavigate={onNavigate} />
  <HuellaCounterpartyExplorer
    open={Boolean(counterpartyExplorer)}
    kind={counterpartyExplorer?.kind ?? 'payer'}
    rows={counterpartyExplorer?.kind === 'buyer' ? marketBuyerRows : fundPayerRows}
    fromYear={fromYear}
    toYear={toYear}
    excludeTop={counterpartyExplorer?.excludeTop ?? 0}
    onClose={() => setCounterpartyExplorer(null)}
    onOpen={(row) => {
      if (counterpartyExplorer?.kind === 'buyer') openBuyer(row); else openPayer(row);
      setCounterpartyExplorer(null);
    }}
  />
  </div>;
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="state-kpi"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>;
}

function DetailTable({
  title, source, rows, nameKey, fallbackKey, amountKey, countKey, totalCount, onOpen, onShowAll,
}: {
  title: string;
  source: string;
  rows: any[];
  nameKey: string;
  fallbackKey: string;
  amountKey: string;
  countKey: string;
  totalCount?: number | null;
  onOpen: (row: any) => void;
  onShowAll: () => void;
}) {
  const [query, setQuery] = useState('');
  const needle = normalizeSearch(query);
  const filtered = needle
    ? rows.filter((row) => normalizeSearch(`${row[nameKey] || ''} ${row[fallbackKey] || ''}`).includes(needle))
    : rows;
  const visible = filtered.slice(0, 7);
  const universeCount = Number(totalCount ?? rows.length);

  return <div className="detail-list huella-detail-list">
    <div className="detail-list-head huella-detail-list-head">
      <div><strong>{title}</strong><span>{source}</span></div>
      <div className="huella-detail-actions">
        <label className="huella-detail-search">
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar organismo…" aria-label={`Buscar en ${title.toLowerCase()}`} />
        </label>
        <button type="button" className="huella-detail-show-all" onClick={onShowAll}>Ver todos ({num(universeCount)})</button>
      </div>
    </div>
    {visible.length === 0 ? <div className="state-empty">{needle ? 'Sin coincidencias en este universo.' : 'Sin detalle para el período.'}</div> : visible.map((row, index) => (
      <button type="button" className="detail-row detail-row-button" key={`${row[fallbackKey]}-${index}`} onClick={() => onOpen(row)}>
        <span><b>{row[nameKey] || row[fallbackKey]}</b><small>{yearRange(row.first_year, row.last_year)}</small></span>
        <span><b>{clp(row[amountKey])}</b><small>{num(row[countKey])} registros · ver ficha</small></span>
      </button>
    ))}
    {needle && filtered.length > visible.length && <button type="button" className="huella-detail-more-results" onClick={onShowAll}>Ver {num(filtered.length - visible.length)} coincidencias adicionales →</button>}
  </div>;
}
