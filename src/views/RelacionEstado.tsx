import { useEffect, useMemo, useState } from 'react';
import { useDebounced, useRpc } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import { fetchProviderHistory, type ProviderHistoryResponse } from '../lib/providerHistory';
import { downloadExcel, exportDate, type ExcelColumn } from '../lib/excelExport';
import { HuellaPublicaTrends, type PublicFundsTrendYear } from '../components/HuellaPublicaTrends';
import '../styles/state-relations.css';

type Mode = 'entity' | 'sample';
type Relation = 'ANY' | 'STATE_INTERACTION' | 'STATE_SUPPLIER' | 'PUBLIC_FUNDS' | 'PUBLIC_FUNDS_RECIPIENT' | 'PUBLIC_FUNDS_SUPPLIER';
type MarkCode = 'OSFL' | 'SO' | 'POTENTIAL_SO' | 'RES_NEW' | 'SII' | 'SII_TG' | 'SII_NO_EMPLOYEES' | 'PRESS' | 'SANCTIONS' | 'FINTECH';

type SearchRow = {
  rut: string;
  label?: string | null;
  entity_id?: string | null;
  amount_clp?: number | null;
  amount_paid?: number | null;
  order_count?: number | null;
  transaction_count?: number | null;
  buyer_count?: number | null;
  payer_count?: number | null;
  first_seen?: string | null;
  last_seen?: string | null;
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
  top_buyer_id?: string | null;
  top_buyer_label?: string | null;
  top_buyer_amount_clp?: number | null;
};

type FundsSummary = {
  rut?: string;
  entity_id?: string | null;
  label?: string | null;
  has_public_payments?: boolean;
  first_year?: number;
  last_year?: number;
  amount_paid?: number | null;
  amount_as_supplier?: number | null;
  amount_as_recipient?: number | null;
  transaction_count?: number | null;
  payer_count?: number | null;
  top_payer_name?: string | null;
  top_payer_amount?: number | null;
};

type SummaryResponse<T> = { ok?: boolean; summary?: T | null; supplier?: T | null; rows?: any[]; requested_period?: { from_year?: number; to_year?: number } };
type RowsResponse<T> = { ok?: boolean; rows?: T[]; requested_period?: { from_year?: number; to_year?: number } };

type SampleRow = {
  entity_id: string;
  rut: string;
  name: string;
  entity_type?: string | null;
  region?: string | null;
  commune?: string | null;
  marks?: string[];
  is_osfl?: boolean;
  osfl_confirmation_level?: string | null;
  is_so?: boolean;
  is_potential_so?: boolean;
  is_res_new?: boolean;
  res_event_date?: string | null;
  has_sii?: boolean;
  sii_tg?: boolean;
  sii_no_employees?: boolean;
  sii_workers?: number | null;
  sii_status?: string | null;
  sii_main_activity?: string | null;
  has_press?: boolean;
  has_sanctions?: boolean;
  is_fintech?: boolean;
  is_state_supplier?: boolean;
  market_amount_12m?: number | null;
  market_order_count_12m?: number | null;
  market_buyer_count?: number | null;
  top_buyer_label?: string | null;
  public_funds_amount?: number | null;
  public_funds_recipient_amount?: number | null;
  public_funds_supplier_amount?: number | null;
  public_funds_transaction_count?: number | null;
  public_funds_payer_count?: number | null;
  public_funds_first_year?: number | null;
  public_funds_last_year?: number | null;
  top_payer_name?: string | null;
  top_payer_amount?: number | null;
};

type SampleResponse = {
  ok?: boolean;
  total?: number;
  rows?: SampleRow[];
  period?: { from_year?: number; to_year?: number };
  semantics?: Record<string, unknown>;
};

const CURRENT_YEAR = new Date().getFullYear();
const PAGE = 100;
const EXPORT_MAX_ROWS = 100000;
const MARKS: { code: MarkCode; label: string; group: string }[] = [
  { code: 'OSFL', label: 'OSFL', group: 'Tipo / universo' },
  { code: 'SO', label: 'Sujeto obligado', group: 'Tipo / universo' },
  { code: 'POTENTIAL_SO', label: 'Potencial SO', group: 'Tipo / universo' },
  { code: 'RES_NEW', label: 'RES nueva en el período', group: 'Tipo / universo' },
  { code: 'SII', label: 'Presencia SII', group: 'SII' },
  { code: 'SII_TG', label: 'Término de giro', group: 'SII' },
  { code: 'SII_NO_EMPLOYEES', label: 'Sin empleados', group: 'SII' },
  { code: 'PRESS', label: 'Presencia en prensa', group: 'Contexto' },
  { code: 'SANCTIONS', label: 'Sanciones', group: 'Contexto' },
  { code: 'FINTECH', label: 'Fintech', group: 'Contexto' },
];

const RELATIONS: { value: Relation; label: string; hint: string }[] = [
  { value: 'STATE_INTERACTION', label: 'Alguna interacción con el Estado', hint: 'Mercado Público o Presupuesto Abierto' },
  { value: 'PUBLIC_FUNDS_RECIPIENT', label: 'Receptor de recursos / traspasos', hint: 'Presupuesto Abierto · rol receptor' },
  { value: 'PUBLIC_FUNDS_SUPPLIER', label: 'Pagos como proveedor', hint: 'Presupuesto Abierto · rol proveedor' },
  { value: 'PUBLIC_FUNDS', label: 'Cualquier pago observado', hint: 'Presupuesto Abierto' },
  { value: 'STATE_SUPPLIER', label: 'Proveedor del Estado', hint: 'Mercado Público · directorio vigente' },
  { value: 'ANY', label: 'Sin exigir interacción estatal', hint: 'Permite construir muestras sólo por marcas' },
];

const EXPORT_OPTIONS: { key: string; label: string }[] = [
  ['rut', 'RUT'], ['rut_body', 'Cuerpo RUT'], ['name', 'Nombre'], ['entity_type', 'Tipo entidad'],
  ['region', 'Región'], ['commune', 'Comuna'], ['marks', 'Marcas'], ['osfl_confirmation_level', 'Calidad marca OSFL'],
  ['public_funds_amount', 'Pagos Estado período'], ['public_funds_recipient_amount', 'Traspasos / receptor'],
  ['public_funds_supplier_amount', 'Pagos como proveedor'], ['public_funds_payer_count', 'N° pagadores'],
  ['top_payer_name', 'Principal pagador'], ['top_payer_amount', 'Monto principal pagador'],
  ['market_amount_12m', 'Mercado Público 12m'], ['market_order_count_12m', 'N° OC 12m'],
  ['market_buyer_count', 'N° compradores 12m'], ['top_buyer_label', 'Principal comprador'],
  ['sii_status', 'Estado SII'], ['sii_workers', 'Trabajadores'], ['sii_main_activity', 'Actividad principal SII'],
  ['res_event_date', 'Fecha RES nueva'],
].map(([key, label]) => ({ key, label }));

const DEFAULT_EXPORT = new Set(['rut', 'name', 'entity_type', 'region', 'marks', 'osfl_confirmation_level', 'public_funds_amount', 'public_funds_recipient_amount', 'public_funds_supplier_amount', 'public_funds_payer_count', 'top_payer_name', 'market_amount_12m', 'market_order_count_12m']);

function normRut(v: string) { return v.toUpperCase().replace(/[^0-9K]/g, ''); }
function rutBody(v: string) { const n = normRut(v); return n.length > 1 ? n.slice(0, -1) : n; }
function clp(v: number | null | undefined) { return v == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(v)); }
function num(v: number | null | undefined) { return v == null ? '—' : Number(v).toLocaleString('es-CL'); }
function yearRange(a?: number | null, b?: number | null) { if (!a && !b) return '—'; return a === b ? String(a ?? b) : `${a ?? '…'}–${b ?? '…'}`; }

export function RelacionEstado({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const [mode, setMode] = useState<Mode>('entity');
  const [fromYear, setFromYear] = useState(2020);
  const [toYear, setToYear] = useState(CURRENT_YEAR);

  return (
    <div className="state-page fade-in">
      <div className="state-head">
        <div className="state-head-copy">
          <div className="eyebrow">ATLAS · vínculo con organismos públicos</div>
          <h1>Huella pública</h1>
          <p>Reconstruye la relación económica observada de una entidad con el Estado y combina compras, pagos, traspasos y marcas Atlas en una lectura única.</p>
          <div className="state-capabilities" aria-label="Cobertura de la sección">
            <span><i data-tone="market" /><b>Mercado Público</b><small>OC · compradores · historia</small></span>
            <span><i data-tone="funds" /><b>Presupuesto Abierto</b><small>Pagos · pagadores · roles</small></span>
            <span><i data-tone="atlas" /><b>Contexto Atlas</b><small>OSFL · SO · SII · prensa · sanciones</small></span>
          </div>
        </div>
        <div className="state-period">
          <span>Período de análisis</span>
          <div><input type="number" min={2016} max={CURRENT_YEAR} value={fromYear} onChange={(e) => setFromYear(Math.min(toYear, Number(e.target.value) || 2020))} /><b>→</b><input type="number" min={fromYear} max={CURRENT_YEAR} value={toYear} onChange={(e) => setToYear(Math.max(fromYear, Number(e.target.value) || CURRENT_YEAR))} /></div>
          <small>La historia detallada se carga sólo al seleccionar una entidad.</small>
        </div>
      </div>

      <div className="state-tabs">
        <button data-active={mode === 'entity'} onClick={() => setMode('entity')}>Explorar entidad</button>
        <button data-active={mode === 'sample'} onClick={() => setMode('sample')}>Construir muestra</button>
      </div>

      {mode === 'entity'
        ? <EntityRelationSearch fromYear={fromYear} toYear={toYear} onNavigate={onNavigate} />
        : <SampleBuilder fromYear={fromYear} toYear={toYear} onNavigate={onNavigate} />}
    </div>
  );
}

function EntityRelationSearch({ fromYear, toYear, onNavigate }: { fromYear: number; toYear: number; onNavigate: (hash: string) => void }) {
  const [q, setQ] = useState('');
  const [selectedRut, setSelectedRut] = useState<string | null>(null);
  const [marketHistory, setMarketHistory] = useState<ProviderHistoryResponse | null>(null);
  const [marketHistoryState, setMarketHistoryState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
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
      const k = normRut(row.rut); map.set(k, { rut: row.rut, label: row.label || row.rut, market: row });
    }
    for (const row of fundsSearch.data?.rows ?? []) {
      const k = normRut(row.rut); const prev = map.get(k);
      map.set(k, { rut: row.rut, label: row.label || prev?.label || row.rut, market: prev?.market, funds: row });
    }
    if (directRutCandidate && !map.has(directRut)) {
      map.set(directRut, { rut: directRut, label: `Consultar RUT ${directRut}` });
    }
    return [...map.values()].slice(0, 30);
  }, [marketSearch.data, fundsSearch.data, directRutCandidate, directRut]);

  const marketSummary = useRpc<SummaryResponse<MarketSummary>>('obs_state_interaction_entity', {
    p_action: 'summary', p_rut: selectedRut, p_query: null, p_from_year: fromYear, p_to_year: toYear, p_limit: 100, p_offset: 0,
  }, { skip: !selectedRut });
  const marketBuyers = useRpc<SummaryResponse<any>>('obs_state_interaction_entity', {
    p_action: 'buyers', p_rut: selectedRut, p_query: null, p_from_year: fromYear, p_to_year: toYear, p_limit: 50, p_offset: 0,
  }, { skip: !selectedRut });
  const fundsSummary = useRpc<SummaryResponse<FundsSummary>>('obs_state_public_funds_entity', {
    p_action: 'summary', p_rut: selectedRut, p_query: null, p_from_year: fromYear, p_to_year: toYear, p_limit: 100, p_offset: 0,
  }, { skip: !selectedRut });
  const fundPayers = useRpc<SummaryResponse<any>>('obs_state_public_funds_entity', {
    p_action: 'payers', p_rut: selectedRut, p_query: null, p_from_year: fromYear, p_to_year: toYear, p_limit: 50, p_offset: 0,
  }, { skip: !selectedRut });
  const fundsTimeline = useRpc<RowsResponse<PublicFundsTrendYear>>('obs_state_public_funds_entity', {
    p_action: 'timeline', p_rut: selectedRut, p_query: null, p_from_year: fromYear, p_to_year: toYear, p_limit: 100, p_offset: 0,
  }, { skip: !selectedRut });

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

  const fallbackMs = marketSummary.data?.supplier ?? null;
  const historySummary = marketHistory?.summary ?? null;
  const ms: MarketSummary | null = historySummary ? {
    ...(fallbackMs ?? {}),
    rut: selectedRut ?? fallbackMs?.rut,
    is_state_supplier: true,
    first_year: historySummary.first_year ?? undefined,
    last_year: historySummary.last_year ?? undefined,
    first_seen: historySummary.first_seen ?? undefined,
    last_seen: historySummary.last_seen ?? undefined,
    amount_clp: historySummary.amount_clp ?? undefined,
    order_count: historySummary.order_count ?? undefined,
    buyer_count: historySummary.buyer_count ?? undefined,
  } : fallbackMs;
  const fs = fundsSummary.data?.summary ?? null;
  const currentBuyerRows = (marketBuyers.data?.rows ?? []) as any[];
  const buyerLabels = new Map<string, string>();
  for (const row of currentBuyerRows) {
    const key = normRut(String(row.buyer_id ?? ''));
    if (key && row.buyer_label) buyerLabels.set(key, String(row.buyer_label));
  }
  const marketBuyerRows = historySummary
    ? (marketHistory?.buyers ?? []).map((row) => ({
        ...row,
        buyer_label: buyerLabels.get(normRut(row.buyer_id)) || row.buyer_id,
        first_year: historySummary.first_year,
        last_year: historySummary.last_year,
      }))
    : currentBuyerRows;
  const fundPayerRows = (fundPayers.data?.rows ?? []) as any[];
  const topBuyer = marketBuyerRows[0] ?? null;
  const topPayer = fundPayerRows[0] ?? null;
  const footprintReading = ms && fs
    ? 'Compras y pagos públicos observados'
    : ms
      ? 'Compras públicas observadas'
      : fs
        ? 'Pagos públicos observados'
        : 'Sin huella observada en el período';
  const marketSource = historySummary
    ? `Mercado Público · histórico ${fromYear}–${toYear}`
    : marketHistoryState === 'loading'
      ? 'Mercado Público · cargando histórico'
      : 'Mercado Público · resumen vigente 12m';

  return <div className="state-entity-layout">
    <section className="state-card state-search-card">
      <div className="state-card-kicker">Explorador de entidades</div>
      <label className="state-label" htmlFor="state-entity-search">RUT o nombre</label>
      <input id="state-entity-search" className="state-search-input" value={q} onChange={(e) => { setQ(e.target.value); setSelectedRut(null); }} placeholder="Ej. 76.123.456-7 o nombre de la entidad" />
      <div className="state-search-help">La búsqueda admite RUT con o sin puntos, guion o DV. Un RUT histórico puede consultarse aunque no tenga actividad reciente.</div>
      {(marketSearch.loading || fundsSearch.loading) && <div className="state-muted">Buscando en ambas fuentes…</div>}
      {enabled && !marketSearch.loading && !fundsSearch.loading && merged.length === 0 && <div className="state-empty">Sin coincidencias en Mercado Público o Presupuesto Abierto.</div>}
      <div className="state-search-results">
        {merged.map((row) => <button key={normRut(row.rut)} className="state-search-result" data-active={selectedRut === row.rut} onClick={() => setSelectedRut(row.rut)}>
          <span><strong>{row.label}</strong><small>{row.rut}</small></span>
          <span className="state-source-pills">{row.market && <em>Proveedor</em>}{row.funds && <em>Pagos Estado</em>}{!row.market && !row.funds && <em>Histórico por RUT</em>}</span>
        </button>)}
      </div>
    </section>

    <section className="state-card state-detail-card">
      {!selectedRut ? <div className="state-empty state-empty-large"><div className="state-empty-icon">⌁</div><strong>Selecciona una entidad</strong><span>Atlas reconstruirá su huella pública con compras, pagos y principales contrapartes.</span><small>El detalle histórico se solicita sólo para la entidad seleccionada.</small></div> : <>
        <div className="state-detail-title"><div><span>Huella pública observada</span><h2>{ms?.label || fs?.label || selectedRut}</h2><small>{selectedRut} · {fromYear}–{toYear}</small></div>{fs?.entity_id && <button className="state-secondary" onClick={() => onNavigate(`#/entidad/${encodeURIComponent(fs.entity_id as string)}`)}>Abrir Entidad 360</button>}</div>
        <div className="state-kpis">
          <Kpi label="Proveedor del Estado" value={ms ? 'Sí' : 'No observado'} sub={ms ? `${yearRange(ms.first_year, ms.last_year)} · ${num(ms.order_count)} OC` : 'Mercado Público'} />
          <Kpi label="Ventas observadas" value={clp(ms?.amount_clp)} sub={ms ? `${num(ms.buyer_count)} organismos compradores` : '—'} />
          <Kpi label="Pagos del Estado" value={clp(fs?.amount_paid)} sub={fs ? `${num(fs.payer_count)} pagadores · ${yearRange(fs.first_year, fs.last_year)}` : 'Presupuesto Abierto'} />
          <Kpi label="Traspasos / receptor" value={clp(fs?.amount_as_recipient)} sub="Presupuesto Abierto · rol receptor" />
        </div>
        <div className="state-insight-grid">
          <Insight label="Principal comprador" value={topBuyer ? (topBuyer.buyer_label || topBuyer.buyer_id || '—') : '—'} sub={topBuyer ? `${clp(topBuyer.amount_clp)} · Mercado Público` : 'Sin comprador observado'} />
          <Insight label="Principal pagador" value={topPayer ? (topPayer.payer_name || topPayer.payer_key || '—') : '—'} sub={topPayer ? `${clp(topPayer.amount_paid)} · Presupuesto Abierto` : 'Sin pagador observado'} />
          <Insight label="Lectura rápida" value={footprintReading} sub="Síntesis descriptiva · no es un indicador de riesgo" />
        </div>
        <div className="state-muted state-data-note">{historySummary
          ? `Mercado Público calculado sobre historia compacta ChileCompra para ${fromYear}–${toYear}.`
          : marketHistoryState === 'loading'
            ? 'Cargando historia de Mercado Público; mientras tanto se conserva el resumen vigente.'
            : marketHistoryState === 'error'
              ? 'Histórico de Mercado Público no disponible en esta consulta; se muestra el resumen vigente de 12 meses.'
              : 'Mercado Público: resumen vigente.'}</div>
        <HuellaPublicaTrends
          marketYears={marketHistory?.years ?? []}
          fundsYears={fundsTimeline.data?.rows ?? []}
          fundsLoading={fundsTimeline.loading}
        />
        <div className="state-dual-detail">
          <DetailTable title="¿A quién ha vendido?" source={marketSource} rows={marketBuyerRows.slice(0, 10)} nameKey="buyer_label" fallbackKey="buyer_id" amountKey="amount_clp" countKey="order_count" />
          <DetailTable title="¿Quién le ha pagado?" source="Presupuesto Abierto" rows={fundPayerRows.slice(0, 10)} nameKey="payer_name" fallbackKey="payer_key" amountKey="amount_paid" countKey="transaction_count" />
        </div>
      </>}
    </section>
  </div>;
}

function SampleBuilder({ fromYear, toYear, onNavigate }: { fromYear: number; toYear: number; onNavigate: (hash: string) => void }) {
  const [relation, setRelation] = useState<Relation>('PUBLIC_FUNDS_RECIPIENT');
  const [marks, setMarks] = useState<MarkCode[]>(['OSFL']);
  const [markMode, setMarkMode] = useState<'ALL' | 'ANY'>('ALL');
  const [region, setRegion] = useState('');
  const [payer, setPayer] = useState('');
  const [minFunds, setMinFunds] = useState('');
  const [minMarket, setMinMarket] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportColumns, setExportColumns] = useState<Set<string>>(() => new Set(DEFAULT_EXPORT));

  const request = useMemo(() => ({
    q: q.trim(), from_year: fromYear, to_year: toYear, relation, marks, mark_mode: markMode,
    region, payer: payer.trim(), min_public_funds_amount: minFunds || null, min_market_amount: minMarket || null,
    sort: relation === 'STATE_SUPPLIER' ? 'MARKET' : relation.startsWith('PUBLIC_FUNDS') ? 'PUBLIC_FUNDS' : 'STATE_AMOUNT',
    limit: PAGE, offset: page * PAGE,
  }), [q, fromYear, toYear, relation, marks, markMode, region, payer, minFunds, minMarket, page]);

  const sample = useRpc<SampleResponse>('obs_state_sample_query', { p_request: request });
  const rows = sample.data?.rows ?? [];
  const total = Number(sample.data?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const exportTooLarge = total > EXPORT_MAX_ROWS;

  function toggleMark(code: MarkCode) { setPage(0); setMarks((current) => current.includes(code) ? current.filter((m) => m !== code) : [...current, code]); }
  function toggleColumn(key: string) { setExportColumns((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; }); }

  async function fetchAllRows(): Promise<SampleRow[]> {
    if (exportTooLarge) throw new Error(`La muestra contiene ${total.toLocaleString('es-CL')} entidades. Acótala a ${EXPORT_MAX_ROWS.toLocaleString('es-CL')} o menos antes de exportar.`);
    const all: SampleRow[] = [];
    const chunk = 1000;
    for (let offset = 0; offset < total; offset += chunk) {
      const { data, error } = await supabase.rpc('obs_state_sample_query', { p_request: { ...request, limit: chunk, offset } });
      if (error) throw error;
      const batch = ((data as SampleResponse)?.rows ?? []) as SampleRow[];
      all.push(...batch);
      if (batch.length < chunk) break;
    }
    return all;
  }

  async function exportRows(rutOnly = false) {
    if (!total || exporting || exportTooLarge) return;
    setExportError(null);
    setExporting(true);
    try {
      const all = await fetchAllRows();
      const selected = rutOnly ? new Set(['rut', 'rut_body']) : exportColumns;
      const columns = exportColumnsFor(selected);
      downloadExcel({
        filename: `atlas_huella_publica_${exportDate()}${rutOnly ? '_ruts' : ''}.xls`,
        sheetName: rutOnly ? 'RUT muestra' : 'Muestra', rows: all, columns,
        metadata: [
          { label: 'Período', value: `${fromYear}-${toYear}` }, { label: 'Relación', value: RELATIONS.find((r) => r.value === relation)?.label ?? relation },
          { label: 'Marcas', value: marks.length ? `${markMode}: ${marks.join(', ')}` : 'Sin filtro de marcas' },
          { label: 'Región', value: region || 'Todas' }, { label: 'Pagador contiene', value: payer || 'Todos' },
          { label: 'Total muestra', value: total }, { label: 'Nota Mercado Público', value: 'La muestra masiva usa el directorio vigente resumido de 12 meses; el histórico detallado se consulta por entidad.' },
          { label: 'Nota OSFL', value: 'La capa de muestras excluye entidades públicas evidentes cuando la clasificación OSFL depende sólo de SII/core. La calidad de confirmación queda disponible como columna.' },
        ],
      });
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'No fue posible preparar la exportación.');
    } finally { setExporting(false); }
  }

  return <div className="sample-layout">
    <aside className="state-card sample-filters">
      <div className="sample-filter-head"><div><span>Definir muestra</span><strong>{total.toLocaleString('es-CL')} entidades</strong></div><button className="state-clear" onClick={() => { setMarks([]); setRegion(''); setPayer(''); setMinFunds(''); setMinMarket(''); setQ(''); setRelation('ANY'); setPage(0); }}>Limpiar</button></div>
      <label className="state-label">Huella pública requerida</label>
      <select value={relation} onChange={(e) => { setRelation(e.target.value as Relation); setPage(0); }}>{RELATIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
      <small className="filter-hint">{RELATIONS.find((r) => r.value === relation)?.hint}</small>

      <div className="filter-rule"><span>Marcas Atlas</span><div className="segmented"><button data-active={markMode === 'ALL'} onClick={() => { setMarkMode('ALL'); setPage(0); }}>Todas</button><button data-active={markMode === 'ANY'} onClick={() => { setMarkMode('ANY'); setPage(0); }}>Cualquiera</button></div></div>
      <div className="mark-grid">{MARKS.map((mark) => <button key={mark.code} data-active={marks.includes(mark.code)} onClick={() => toggleMark(mark.code)}><span>{marks.includes(mark.code) ? '✓' : '+'}</span>{mark.label}</button>)}</div>

      <label className="state-label">Texto / RUT</label><input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Acotar por nombre o RUT" />
      <label className="state-label">Región</label><input value={region} onChange={(e) => { setRegion(e.target.value); setPage(0); }} placeholder="Todas" />
      <label className="state-label">Pagador contiene</label><input value={payer} onChange={(e) => { setPayer(e.target.value); setPage(0); }} placeholder="Ej. Educación, Municipalidad…" />
      <div className="filter-amounts"><label><span>Mín. pagos Estado</span><input type="number" min="0" value={minFunds} onChange={(e) => { setMinFunds(e.target.value); setPage(0); }} placeholder="CLP" /></label><label><span>Mín. Mercado Público</span><input type="number" min="0" value={minMarket} onChange={(e) => { setMinMarket(e.target.value); setPage(0); }} placeholder="CLP · 12m" /></label></div>
    </aside>

    <section className="state-card sample-results">
      <div className="sample-toolbar"><div><span>Resultado de la muestra</span><strong>{sample.loading ? 'Calculando…' : `${total.toLocaleString('es-CL')} entidades`}</strong></div><div className="sample-actions"><button className="state-secondary" disabled={!total || exporting || exportTooLarge} onClick={() => void exportRows(true)}>⇩ Solo RUT</button><button className="state-primary" disabled={!total || exporting || exportTooLarge} onClick={() => setExportOpen((v) => !v)}>{exporting ? 'Preparando…' : '⇩ Exportar muestra'}</button></div></div>
      {exportTooLarge && <div className="state-error">La muestra supera {EXPORT_MAX_ROWS.toLocaleString('es-CL')} entidades. Acota período, relación o marcas antes de exportar para evitar una nómina parcial.</div>}
      {exportError && <div className="state-error">{exportError}</div>}
      {exportOpen && !exportTooLarge && <div className="export-config"><div><strong>Columnas del archivo</strong><span>Selecciona sólo lo que necesites para la consulta posterior.</span></div><div className="export-columns">{EXPORT_OPTIONS.map((c) => <label key={c.key}><input type="checkbox" checked={exportColumns.has(c.key)} onChange={() => toggleColumn(c.key)} />{c.label}</label>)}</div><button className="state-primary" disabled={!exportColumns.size || exporting} onClick={() => void exportRows(false)}>Generar Excel ({total.toLocaleString('es-CL')})</button></div>}
      {sample.error && <div className="state-error">{sample.error}</div>}
      {!sample.loading && !sample.error && rows.length === 0 && <div className="state-empty state-empty-large"><div className="state-empty-icon">⌁</div><strong>La combinación no devuelve entidades</strong><span>Amplía el período o retira una marca para probar otra cohorte.</span></div>}
      {rows.length > 0 && <div className="sample-table-wrap"><table className="sample-table"><thead><tr><th>Entidad</th><th>Marcas</th><th>Huella pública</th><th>Principal contraparte</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.entity_id}><td><strong>{row.name}</strong><small>{row.rut} · {row.region || 'Región s/d'}</small></td><td><div className="row-marks">{(row.marks ?? []).slice(0, 5).map((m) => <span key={m}>{markLabel(m)}</span>)}</div>{row.is_osfl && <small>{row.osfl_confirmation_level || 'OSFL radar'}</small>}</td><td><div className="money-stack">{Number(row.public_funds_amount || 0) > 0 && <span><b>{clp(relevantFundsAmount(row, relation))}</b><small>Presupuesto Abierto · {fromYear}–{toYear}</small></span>}{row.is_state_supplier && <span><b>{clp(row.market_amount_12m)}</b><small>Mercado Público · 12m · {num(row.market_order_count_12m)} OC</small></span>}</div></td><td>{row.top_payer_name || row.top_buyer_label || '—'}{row.public_funds_payer_count ? <small>{num(row.public_funds_payer_count)} pagadores</small> : null}</td><td><button className="row-open" onClick={() => onNavigate(`#/entidad/${encodeURIComponent(row.entity_id)}`)}>Entidad 360 →</button></td></tr>)}</tbody></table></div>}
      {total > PAGE && <div className="sample-pagination"><button disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Anterior</button><span>{page + 1} / {pages}</span><button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Siguiente →</button></div>}
      <div className="sample-semantics"><b>Lectura:</b> Presupuesto Abierto se filtra por el período seleccionado. Mercado Público usa el directorio resumido vigente para construir muestras y carga su historia por entidad a demanda. Los montos de ambas fuentes no se suman. En OSFL, la capa de muestras excluye entidades públicas evidentes clasificadas sólo por SII/core y conserva el nivel de confirmación para trazabilidad.</div>
    </section>
  </div>;
}

function relevantFundsAmount(row: SampleRow, relation: Relation) {
  if (relation === 'PUBLIC_FUNDS_RECIPIENT') return row.public_funds_recipient_amount;
  if (relation === 'PUBLIC_FUNDS_SUPPLIER') return row.public_funds_supplier_amount;
  return row.public_funds_amount;
}

function exportColumnsFor(selected: Set<string>): ExcelColumn<SampleRow>[] {
  const all: Record<string, ExcelColumn<SampleRow>> = {
    rut: { header: 'RUT', value: (r) => r.rut }, rut_body: { header: 'Cuerpo RUT', value: (r) => rutBody(r.rut) }, name: { header: 'Nombre', value: (r) => r.name },
    entity_type: { header: 'Tipo entidad', value: (r) => r.entity_type }, region: { header: 'Región', value: (r) => r.region }, commune: { header: 'Comuna', value: (r) => r.commune },
    marks: { header: 'Marcas Atlas', value: (r) => (r.marks ?? []).map(markLabel).join(' | ') }, osfl_confirmation_level: { header: 'Calidad marca OSFL', value: (r) => r.osfl_confirmation_level }, public_funds_amount: { header: 'Pagos Estado período', value: (r) => r.public_funds_amount },
    public_funds_recipient_amount: { header: 'Traspasos / receptor', value: (r) => r.public_funds_recipient_amount }, public_funds_supplier_amount: { header: 'Pagos como proveedor', value: (r) => r.public_funds_supplier_amount },
    public_funds_payer_count: { header: 'N° pagadores', value: (r) => r.public_funds_payer_count }, top_payer_name: { header: 'Principal pagador', value: (r) => r.top_payer_name }, top_payer_amount: { header: 'Monto principal pagador', value: (r) => r.top_payer_amount },
    market_amount_12m: { header: 'Mercado Público 12m', value: (r) => r.market_amount_12m }, market_order_count_12m: { header: 'N° OC 12m', value: (r) => r.market_order_count_12m }, market_buyer_count: { header: 'N° compradores 12m', value: (r) => r.market_buyer_count }, top_buyer_label: { header: 'Principal comprador', value: (r) => r.top_buyer_label },
    sii_status: { header: 'Estado SII', value: (r) => r.sii_status }, sii_workers: { header: 'Trabajadores', value: (r) => r.sii_workers }, sii_main_activity: { header: 'Actividad principal SII', value: (r) => r.sii_main_activity }, res_event_date: { header: 'Fecha RES nueva', value: (r) => r.res_event_date },
  };
  return EXPORT_OPTIONS.filter((o) => selected.has(o.key)).map((o) => all[o.key]).filter(Boolean);
}

function markLabel(code: string) {
  return ({ OSFL: 'OSFL', SO: 'SO', POTENTIAL_SO: 'Potencial SO', RES_NEW: 'RES nueva', SII: 'SII', SII_TG: 'TG', SII_NO_EMPLOYEES: 'Sin empleados', PRESS: 'Prensa', SANCTIONS: 'Sanciones', FINTECH: 'Fintech' } as Record<string, string>)[code] ?? code;
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) { return <div className="state-kpi"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>; }
function Insight({ label, value, sub }: { label: string; value: string; sub: string }) { return <div className="state-insight"><span>{label}</span><strong title={value}>{value}</strong><small>{sub}</small></div>; }
function DetailTable({ title, source, rows, nameKey, fallbackKey, amountKey, countKey }: { title: string; source: string; rows: any[]; nameKey: string; fallbackKey: string; amountKey: string; countKey: string }) {
  return <div className="detail-list"><div className="detail-list-head"><strong>{title}</strong><span>{source}</span></div>{rows.length === 0 ? <div className="state-empty">Sin detalle para el período.</div> : rows.map((r, i) => <div className="detail-row" key={`${r[fallbackKey]}-${i}`}><span><b>{r[nameKey] || r[fallbackKey]}</b><small>{yearRange(r.first_year, r.last_year)}</small></span><span><b>{clp(r[amountKey])}</b><small>{num(r[countKey])} registros</small></span></div>)}</div>;
}
