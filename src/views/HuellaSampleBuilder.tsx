import { useMemo, useState } from 'react';
import { useRpc } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import { downloadExcel, exportDate, type ExcelColumn } from '../lib/excelExport';
import '../styles/state-relations.css';
import '../styles/state-relations-compact.css';
import '../styles/huella-publica-export-progress.css';

type Relation = 'ANY' | 'STATE_INTERACTION' | 'STATE_SUPPLIER' | 'PUBLIC_FUNDS' | 'PUBLIC_FUNDS_RECIPIENT' | 'PUBLIC_FUNDS_SUPPLIER';
type MarkCode = 'OSFL' | 'SO' | 'POTENTIAL_SO' | 'RES_NEW' | 'SII' | 'SII_TG' | 'SII_NO_EMPLOYEES' | 'PRESS' | 'SANCTIONS' | 'FINTECH';
type ExportKind = 'RUT' | 'FULL';

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
  is_state_supplier?: boolean;
  market_amount_12m?: number | null;
  market_order_count_12m?: number | null;
  market_buyer_count?: number | null;
  top_buyer_label?: string | null;
  public_funds_amount?: number | null;
  public_funds_recipient_amount?: number | null;
  public_funds_supplier_amount?: number | null;
  public_funds_payer_count?: number | null;
  top_payer_name?: string | null;
  top_payer_amount?: number | null;
  sii_status?: string | null;
  sii_workers?: number | null;
  sii_main_activity?: string | null;
  res_event_date?: string | null;
};

type SampleResponse = {
  ok?: boolean;
  total?: number;
  rows?: SampleRow[];
  period?: { from_year?: number; to_year?: number };
};

type SampleFilterPayload = {
  q: string;
  from_year: number;
  to_year: number;
  relation: Relation;
  marks: MarkCode[];
  mark_mode: 'ALL' | 'ANY';
  region: string;
  payer: string;
  min_public_funds_amount: string | null;
  min_market_amount: string | null;
  sort: string;
};

const PAGE = 100;
const EXPORT_MAX_ROWS = 100000;
const EXPORT_CHUNK = 1000;

const MARKS: { code: MarkCode; label: string }[] = [
  { code: 'OSFL', label: 'OSFL' },
  { code: 'SO', label: 'Sujeto obligado' },
  { code: 'POTENTIAL_SO', label: 'Potencial SO' },
  { code: 'RES_NEW', label: 'RES nueva' },
  { code: 'SII', label: 'Presencia SII' },
  { code: 'SII_TG', label: 'Término de giro' },
  { code: 'SII_NO_EMPLOYEES', label: 'Sin empleados' },
  { code: 'PRESS', label: 'Prensa resuelta' },
  { code: 'SANCTIONS', label: 'Sanciones' },
  { code: 'FINTECH', label: 'Fintech' },
];

const RELATIONS: { value: Relation; label: string; hint: string }[] = [
  { value: 'ANY', label: 'Seleccionar relación…', hint: 'Escoge una relación o utiliza otra condición para ejecutar la consulta.' },
  { value: 'STATE_INTERACTION', label: 'Alguna interacción con el Estado', hint: 'Mercado Público o Presupuesto Abierto' },
  { value: 'PUBLIC_FUNDS_RECIPIENT', label: 'Receptor de recursos / traspasos', hint: 'Presupuesto Abierto · rol receptor' },
  { value: 'PUBLIC_FUNDS_SUPPLIER', label: 'Pagos como proveedor', hint: 'Presupuesto Abierto · rol proveedor' },
  { value: 'PUBLIC_FUNDS', label: 'Cualquier pago observado', hint: 'Presupuesto Abierto' },
  { value: 'STATE_SUPPLIER', label: 'Proveedor del Estado', hint: 'Mercado Público · directorio vigente' },
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

const DEFAULT_EXPORT = new Set([
  'rut', 'name', 'entity_type', 'region', 'marks', 'osfl_confirmation_level', 'public_funds_amount',
  'public_funds_recipient_amount', 'public_funds_supplier_amount', 'public_funds_payer_count', 'top_payer_name',
  'market_amount_12m', 'market_order_count_12m',
]);

function normRut(value: string) { return value.toUpperCase().replace(/[^0-9K]/g, ''); }
function rutBody(value: string) { const normalized = normRut(value); return normalized.length > 1 ? normalized.slice(0, -1) : normalized; }
function clp(value: number | null | undefined) { return value == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(value)); }
function num(value: number | null | undefined) { return value == null ? '—' : Number(value).toLocaleString('es-CL'); }

export function HuellaSampleBuilder({
  fromYear,
  toYear,
  onNavigate,
}: {
  fromYear: number;
  toYear: number;
  onNavigate: (hash: string) => void;
}) {
  const [relation, setRelation] = useState<Relation>('ANY');
  const [marks, setMarks] = useState<MarkCode[]>([]);
  const [markMode, setMarkMode] = useState<'ALL' | 'ANY'>('ALL');
  const [region, setRegion] = useState('');
  const [payer, setPayer] = useState('');
  const [minFunds, setMinFunds] = useState('');
  const [minMarket, setMinMarket] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [appliedFilters, setAppliedFilters] = useState<SampleFilterPayload | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportKind, setExportKind] = useState<ExportKind | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportColumns, setExportColumns] = useState<Set<string>>(() => new Set(DEFAULT_EXPORT));

  const draftFilters = useMemo<SampleFilterPayload>(() => ({
    q: q.trim(),
    from_year: fromYear,
    to_year: toYear,
    relation,
    marks,
    mark_mode: markMode,
    region: region.trim(),
    payer: payer.trim(),
    min_public_funds_amount: minFunds || null,
    min_market_amount: minMarket || null,
    sort: relation === 'STATE_SUPPLIER' ? 'MARKET' : relation.startsWith('PUBLIC_FUNDS') ? 'PUBLIC_FUNDS' : 'STATE_AMOUNT',
  }), [q, fromYear, toYear, relation, marks, markMode, region, payer, minFunds, minMarket]);

  const criteriaSelected = relation !== 'ANY' || marks.length > 0 || Boolean(q.trim() || region.trim() || payer.trim() || minFunds || minMarket);
  const currentSignature = JSON.stringify(draftFilters);
  const appliedSignature = appliedFilters ? JSON.stringify(appliedFilters) : '';
  const resultsActive = Boolean(appliedFilters) && currentSignature === appliedSignature;

  const request = useMemo(() => ({
    ...(appliedFilters ?? draftFilters),
    limit: PAGE,
    offset: page * PAGE,
  }), [appliedFilters, draftFilters, page]);

  const sample = useRpc<SampleResponse>('obs_state_sample_query', { p_request: request }, { skip: !resultsActive });
  const rows = resultsActive ? sample.data?.rows ?? [] : [];
  const total = resultsActive ? Number(sample.data?.total ?? 0) : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const exportTooLarge = total > EXPORT_MAX_ROWS;

  function applyFilters() {
    if (!criteriaSelected) return;
    setPage(0);
    setAppliedFilters({ ...draftFilters, marks: [...draftFilters.marks] });
    setExportOpen(false);
    setExportError(null);
  }

  function resetFilters() {
    setRelation('ANY');
    setMarks([]);
    setMarkMode('ALL');
    setRegion('');
    setPayer('');
    setMinFunds('');
    setMinMarket('');
    setQ('');
    setPage(0);
    setAppliedFilters(null);
    setExportOpen(false);
    setExportError(null);
    setExportProgress(0);
    setExportKind(null);
  }

  function toggleMark(code: MarkCode) {
    setPage(0);
    setMarks((current) => current.includes(code) ? current.filter((mark) => mark !== code) : [...current, code]);
  }

  function toggleColumn(key: string) {
    setExportColumns((current) => {
      const next = new Set(current);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function fetchAllRows(): Promise<SampleRow[]> {
    if (!appliedFilters || !resultsActive) return [];
    if (exportTooLarge) throw new Error(`La muestra contiene ${total.toLocaleString('es-CL')} entidades. Acótala a ${EXPORT_MAX_ROWS.toLocaleString('es-CL')} o menos antes de exportar.`);

    const all: SampleRow[] = [];
    for (let offset = 0; offset < total; offset += EXPORT_CHUNK) {
      const { data, error } = await supabase.rpc('obs_state_sample_query', {
        p_request: { ...appliedFilters, limit: EXPORT_CHUNK, offset },
      });
      if (error) throw error;

      const batch = ((data as SampleResponse)?.rows ?? []) as SampleRow[];
      all.push(...batch);
      const fetched = Math.min(total, all.length);
      setExportProgress(total > 0 ? Math.min(98, Math.max(1, Math.round((fetched / total) * 98))) : 0);
      if (batch.length < EXPORT_CHUNK) break;
    }
    return all;
  }

  async function exportRows(rutOnly = false) {
    if (!resultsActive || !total || exporting || exportTooLarge) return;
    setExportError(null);
    setExportKind(rutOnly ? 'RUT' : 'FULL');
    setExportProgress(1);
    setExporting(true);
    try {
      const all = await fetchAllRows();
      const selected = rutOnly ? new Set(['rut', 'rut_body']) : exportColumns;
      setExportProgress(99);
      downloadExcel({
        filename: `atlas_huella_publica_${exportDate()}${rutOnly ? '_ruts' : ''}.xls`,
        sheetName: rutOnly ? 'RUT muestra' : 'Muestra',
        rows: all,
        columns: exportColumnsFor(selected),
        metadata: [
          { label: 'Período', value: `${fromYear}-${toYear}` },
          { label: 'Relación', value: RELATIONS.find((item) => item.value === relation)?.label ?? relation },
          { label: 'Marcas', value: marks.length ? `${markMode}: ${marks.join(', ')}` : 'Sin filtro de marcas' },
          { label: 'Región', value: region || 'Todas' },
          { label: 'Pagador contiene', value: payer || 'Todos' },
          { label: 'Total exportado', value: total },
          { label: 'Criterio', value: 'La nómina exporta todas las entidades que cumplen los filtros aplicados, no sólo la página visible.' },
        ],
      });
      setExportProgress(100);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'No fue posible preparar la exportación.';
      setExportError(/timeout|57014|canceling statement/i.test(detail)
        ? 'Una página de la exportación excedió la ventana ampliada de consulta. Acota el universo y vuelve a intentarlo; las páginas ya descargadas no generan un archivo parcial.'
        : detail);
    } finally {
      setExporting(false);
      setExportKind(null);
      setExportProgress(0);
    }
  }

  return <div className="state-page fade-in"><div className="sample-layout">
    <aside className="state-card sample-filters">
      <div className="sample-filter-head">
        <div><span>Definir muestra</span><strong>{resultsActive ? `${total.toLocaleString('es-CL')} entidades` : 'Sin consulta'}</strong></div>
        <button className="state-clear" onClick={resetFilters}>Limpiar</button>
      </div>

      <label className="state-label">Huella pública requerida</label>
      <select value={relation} onChange={(event) => { setRelation(event.target.value as Relation); setPage(0); }}>
        {RELATIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
      <small className="filter-hint">{RELATIONS.find((item) => item.value === relation)?.hint}</small>

      <div className="filter-rule"><span>Marcas Atlas</span><div className="segmented"><button data-active={markMode === 'ALL'} onClick={() => { setMarkMode('ALL'); setPage(0); }}>Todas</button><button data-active={markMode === 'ANY'} onClick={() => { setMarkMode('ANY'); setPage(0); }}>Cualquiera</button></div></div>
      <div className="mark-grid">{MARKS.map((mark) => <button key={mark.code} data-active={marks.includes(mark.code)} onClick={() => toggleMark(mark.code)}><span>{marks.includes(mark.code) ? '✓' : '+'}</span>{mark.label}</button>)}</div>

      <label className="state-label">Texto / RUT</label><input value={q} onChange={(event) => { setQ(event.target.value); setPage(0); }} placeholder="Acotar por nombre o RUT" />
      <label className="state-label">Región</label><input value={region} onChange={(event) => { setRegion(event.target.value); setPage(0); }} placeholder="Todas" />
      <label className="state-label">Pagador contiene</label><input value={payer} onChange={(event) => { setPayer(event.target.value); setPage(0); }} placeholder="Ej. Educación, Municipalidad…" />
      <div className="filter-amounts"><label><span>Mín. pagos Estado</span><input type="number" min="0" value={minFunds} onChange={(event) => { setMinFunds(event.target.value); setPage(0); }} placeholder="CLP" /></label><label><span>Mín. Mercado Público</span><input type="number" min="0" value={minMarket} onChange={(event) => { setMinMarket(event.target.value); setPage(0); }} placeholder="CLP · 12m" /></label></div>

      <div className="sample-apply-zone">
        <button className="state-primary sample-apply" disabled={!criteriaSelected || sample.loading} onClick={applyFilters}>{sample.loading ? 'Calculando…' : resultsActive ? 'Reaplicar filtros' : 'Aplicar filtros'}</button>
        <small>{criteriaSelected ? 'La consulta se ejecuta sólo cuando presionas Aplicar filtros.' : 'Selecciona al menos un criterio antes de consultar el universo.'}</small>
      </div>
    </aside>

    <section className="state-card sample-results">
      {!resultsActive ? (
        <div className="sample-awaiting">
          <div className="sample-awaiting-icon">⌁</div>
          <strong>{appliedFilters ? 'Hay cambios sin aplicar' : 'Configura la muestra antes de consultar'}</strong>
          <span>{appliedFilters ? 'Los resultados anteriores se ocultaron para evitar mezclar filtros. Presiona Aplicar filtros para recalcular la nómina.' : 'Selecciona una relación con el Estado, marcas u otras condiciones y luego presiona Aplicar filtros.'}</span>
          <small>Atlas no ejecuta una consulta masiva de forma automática al abrir esta sección.</small>
        </div>
      ) : <>
        <div className="sample-toolbar"><div><span>Resultado de la muestra</span><strong>{sample.loading ? 'Calculando…' : `${total.toLocaleString('es-CL')} entidades`}</strong><small className="sample-export-note">La exportación incluye toda la nómina filtrada, no sólo las filas de esta página.</small></div><div className="sample-actions"><button className="state-secondary" disabled={!total || exporting || exportTooLarge} onClick={() => void exportRows(true)}>{exporting && exportKind === 'RUT' ? `Preparando… ${exportProgress}%` : '⇩ Solo RUT'}</button><button className="state-primary" disabled={!total || exporting || exportTooLarge} onClick={() => setExportOpen((current) => !current)}>{exporting && exportKind === 'FULL' ? `Preparando… ${exportProgress}%` : '⇩ Exportar nómina filtrada'}</button></div></div>
        {exporting && <div className="sample-export-progress" role="status" aria-live="polite">
          <div><strong>{exportKind === 'RUT' ? 'Preparando nómina de RUT' : 'Preparando nómina filtrada'}</strong><span>{exportProgress}%</span></div>
          <span className="sample-export-progress-track" aria-hidden="true"><i style={{ width: `${exportProgress}%` }} /></span>
          <small>Atlas descarga la muestra por bloques para admitir nóminas extensas sin congelar la interfaz.</small>
        </div>}
        {exportTooLarge && <div className="state-error">La muestra supera {EXPORT_MAX_ROWS.toLocaleString('es-CL')} entidades. Acota los filtros antes de exportar.</div>}
        {exportError && <div className="state-error">{exportError}</div>}
        {exportOpen && !exportTooLarge && <div className="export-config"><div><strong>Columnas del archivo</strong><span>Selecciona sólo lo necesario para la consulta posterior.</span></div><div className="export-columns">{EXPORT_OPTIONS.map((column) => <label key={column.key}><input type="checkbox" checked={exportColumns.has(column.key)} onChange={() => toggleColumn(column.key)} />{column.label}</label>)}</div><button className="state-primary" disabled={!exportColumns.size || exporting} onClick={() => void exportRows(false)}>{exporting && exportKind === 'FULL' ? `Preparando… ${exportProgress}%` : `Generar Excel (${total.toLocaleString('es-CL')} entidades)`}</button></div>}
        {sample.error && <div className="state-error">{sample.error}</div>}
        {!sample.loading && !sample.error && rows.length === 0 && <div className="state-empty state-empty-large"><div className="state-empty-icon">⌁</div><strong>La combinación no devuelve entidades</strong><span>Ajusta los filtros y vuelve a aplicarlos.</span></div>}
        {rows.length > 0 && <div className="sample-table-wrap"><table className="sample-table"><thead><tr><th>Entidad</th><th>Marcas</th><th>Huella pública</th><th>Principal contraparte</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.entity_id}><td><strong>{row.name}</strong><small>{row.rut} · {row.region || 'Región s/d'}</small></td><td><div className="row-marks">{(row.marks ?? []).slice(0, 5).map((mark) => <span key={mark}>{markLabel(mark)}</span>)}</div>{row.is_osfl && <small>{row.osfl_confirmation_level || 'OSFL radar'}</small>}</td><td><div className="money-stack">{Number(row.public_funds_amount || 0) > 0 && <span><b>{clp(relevantFundsAmount(row, relation))}</b><small>Presupuesto Abierto · {fromYear}–{toYear}</small></span>}{row.is_state_supplier && <span><b>{clp(row.market_amount_12m)}</b><small>Mercado Público · 12m · {num(row.market_order_count_12m)} OC</small></span>}</div></td><td>{row.top_payer_name || row.top_buyer_label || '—'}{row.public_funds_payer_count ? <small>{num(row.public_funds_payer_count)} pagadores</small> : null}</td><td><button className="row-open" onClick={() => onNavigate(`#/entidad/${encodeURIComponent(row.entity_id)}`)}>Entidad 360 →</button></td></tr>)}</tbody></table></div>}
        {total > PAGE && <div className="sample-pagination"><button disabled={page <= 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>← Anterior</button><span>{page + 1} / {pages}</span><button disabled={page + 1 >= pages} onClick={() => setPage((current) => current + 1)}>Siguiente →</button></div>}
        <div className="sample-semantics"><b>Lectura:</b> Presupuesto Abierto se filtra por el período seleccionado. Mercado Público usa el directorio resumido vigente para construir muestras y carga su historia por entidad a demanda. Los montos de ambas fuentes no se suman.</div>
      </>}
    </section>
  </div></div>;
}

function relevantFundsAmount(row: SampleRow, relation: Relation) {
  if (relation === 'PUBLIC_FUNDS_RECIPIENT') return row.public_funds_recipient_amount;
  if (relation === 'PUBLIC_FUNDS_SUPPLIER') return row.public_funds_supplier_amount;
  return row.public_funds_amount;
}

function exportColumnsFor(selected: Set<string>): ExcelColumn<SampleRow>[] {
  const all: Record<string, ExcelColumn<SampleRow>> = {
    rut: { header: 'RUT', value: (row) => row.rut },
    rut_body: { header: 'Cuerpo RUT', value: (row) => rutBody(row.rut) },
    name: { header: 'Nombre', value: (row) => row.name },
    entity_type: { header: 'Tipo entidad', value: (row) => row.entity_type },
    region: { header: 'Región', value: (row) => row.region },
    commune: { header: 'Comuna', value: (row) => row.commune },
    marks: { header: 'Marcas Atlas', value: (row) => (row.marks ?? []).map(markLabel).join(' | ') },
    osfl_confirmation_level: { header: 'Calidad marca OSFL', value: (row) => row.osfl_confirmation_level },
    public_funds_amount: { header: 'Pagos Estado período', value: (row) => row.public_funds_amount },
    public_funds_recipient_amount: { header: 'Traspasos / receptor', value: (row) => row.public_funds_recipient_amount },
    public_funds_supplier_amount: { header: 'Pagos como proveedor', value: (row) => row.public_funds_supplier_amount },
    public_funds_payer_count: { header: 'N° pagadores', value: (row) => row.public_funds_payer_count },
    top_payer_name: { header: 'Principal pagador', value: (row) => row.top_payer_name },
    top_payer_amount: { header: 'Monto principal pagador', value: (row) => row.top_payer_amount },
    market_amount_12m: { header: 'Mercado Público 12m', value: (row) => row.market_amount_12m },
    market_order_count_12m: { header: 'N° OC 12m', value: (row) => row.market_order_count_12m },
    market_buyer_count: { header: 'N° compradores 12m', value: (row) => row.market_buyer_count },
    top_buyer_label: { header: 'Principal comprador', value: (row) => row.top_buyer_label },
    sii_status: { header: 'Estado SII', value: (row) => row.sii_status },
    sii_workers: { header: 'Trabajadores', value: (row) => row.sii_workers },
    sii_main_activity: { header: 'Actividad principal SII', value: (row) => row.sii_main_activity },
    res_event_date: { header: 'Fecha RES nueva', value: (row) => row.res_event_date },
  };
  return EXPORT_OPTIONS.filter((option) => selected.has(option.key)).map((option) => all[option.key]).filter(Boolean);
}

function markLabel(code: string) {
  return ({ OSFL: 'OSFL', SO: 'SO', POTENTIAL_SO: 'Potencial SO', RES_NEW: 'RES nueva', SII: 'SII', SII_TG: 'TG', SII_NO_EMPLOYEES: 'Sin empleados', PRESS: 'Prensa', SANCTIONS: 'Sanciones', FINTECH: 'Fintech' } as Record<string, string>)[code] ?? code;
}
