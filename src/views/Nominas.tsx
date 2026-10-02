import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useRpc } from '../lib/rpc';
import { downloadExcel, exportDate, filtersAsMetadata } from '../lib/excelExport';
import type { SourceStatusRow } from '../lib/contracts';
import '../styles/nominas.css';

type NominaCode = 'osfl' | 'fintech' | 'sanciones' | 'so' | 'sii' | 'e1d' | 'prensa' | 'estado';

type OsflDashboard = {
  national: {
    official_total: number;
    official_snapshot_date: string | null;
    observed: number;
    coverage_pct: number;
    refreshed_at: string | null;
  };
  filters: { regions: string[]; activities: string[]; types: string[] };
};

type FintechDashboard = {
  national: {
    reference_total: number;
    reference_date: string | null;
    sector_observed: number;
    refreshed_at: string | null;
  };
  filters: { regions: string[]; verticals: string[] };
};

type Filters = {
  region: string;
  activity: string;
  type: string;
  sanctions: boolean;
  publicFunds: boolean;
  uaf: boolean;
};

const EMPTY: Filters = { region: '', activity: '', type: '', sanctions: false, publicFunds: false, uaf: false };

const NOMINAS: Array<{ code: NominaCode; label: string; detail: string; source: string; enabled: boolean }> = [
  { code: 'osfl', label: 'OSFL', detail: 'Organizaciones sin fines de lucro', source: 'Registro Civil + cruces Atlas', enabled: true },
  { code: 'fintech', label: 'Fintech', detail: 'Ecosistema Fintech y PSAV', source: 'Atlas Fintech', enabled: true },
  { code: 'sanciones', label: 'Sanciones', detail: 'Entidades con antecedentes sancionatorios', source: 'Radar sancionatorio Atlas', enabled: true },
  { code: 'so', label: 'Sujetos Obligados', detail: 'Padrón UAF y gestión registral', source: 'Universo SO', enabled: false },
  { code: 'sii', label: 'SII', detail: 'Inicio, actividad y término de giro', source: 'Perfiles tributarios', enabled: false },
  { code: 'e1d', label: 'Empresas en un día', detail: 'Constituciones y vigencia', source: 'Registro de Empresas y Sociedades', enabled: false },
  { code: 'prensa', label: 'Prensa', detail: 'Entidades con coincidencias de prensa', source: 'Monitor de prensa', enabled: false },
  { code: 'estado', label: 'Huella pública', detail: 'Proveedores y receptores de fondos públicos', source: 'Mercado Público + Presupuesto Abierto', enabled: false },
];

function nf(v: number | null | undefined) { return Number(v ?? 0).toLocaleString('es-CL'); }
function pct(v: number | null | undefined) { return `${Number(v ?? 0).toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`; }
function dateLabel(v: string | null | undefined) {
  if (!v) return 'Sin fecha';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00` : v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('es-CL');
}

export function Nominas() {
  const [selected, setSelected] = useState<NominaCode>('osfl');
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [exporting, setExporting] = useState(false);
  const osfl = useRpc<OsflDashboard>('obs_osfl_dashboard', {});
  const fintech = useRpc<FintechDashboard>('obs_fintech_dashboard_v2', {});
  const sources = useRpc<SourceStatusRow[]>('obs_source_status', {});

  const config = NOMINAS.find((n) => n.code === selected)!;
  const sourceHealth = useMemo(() => {
    const rows = sources.data ?? [];
    const needle = selected === 'osfl' ? 'osfl' : selected === 'fintech' ? 'fintech' : selected === 'sanciones' ? 'sanc' : selected;
    return rows.find((r) => `${r.source_code} ${r.source_name}`.toLowerCase().includes(needle));
  }, [sources.data, selected]);

  const stats = useMemo(() => {
    if (selected === 'osfl' && osfl.data) {
      return {
        official: osfl.data.national.official_total,
        atlas: osfl.data.national.observed,
        coverage: osfl.data.national.coverage_pct,
        cut: osfl.data.national.official_snapshot_date,
        refreshed: osfl.data.national.refreshed_at,
        authority: 'Registro Civil',
        measurable: true,
      };
    }
    if (selected === 'fintech' && fintech.data) {
      const official = fintech.data.national.reference_total;
      const atlas = fintech.data.national.sector_observed;
      return {
        official,
        atlas,
        coverage: official > 0 ? atlas / official * 100 : 0,
        cut: fintech.data.national.reference_date,
        refreshed: fintech.data.national.refreshed_at,
        authority: 'Referencia sectorial Fintech',
        measurable: true,
      };
    }
    return {
      official: null,
      atlas: null,
      coverage: null,
      cut: null,
      refreshed: sourceHealth?.last_successful_ingest_at ?? sourceHealth?.last_source_record_at ?? null,
      authority: sourceHealth?.authoritative_source || config.source,
      measurable: false,
    };
  }, [selected, osfl.data, fintech.data, sourceHealth, config.source]);

  const regions = selected === 'osfl' ? (osfl.data?.filters.regions ?? []) : selected === 'fintech' ? (fintech.data?.filters.regions ?? []) : [];
  const activities = selected === 'osfl' ? (osfl.data?.filters.activities ?? []) : selected === 'fintech' ? (fintech.data?.filters.verticals ?? []) : [];
  const types = selected === 'osfl' ? (osfl.data?.filters.types ?? []) : [];

  function reset() { setFilters(EMPTY); }

  async function exportSelected() {
    if (!config.enabled) return;
    setExporting(true);
    try {
      if (selected === 'osfl') await exportOsfl(filters);
      else if (selected === 'fintech') await exportFintech(filters);
      else if (selected === 'sanciones') await exportSanciones(filters);
    } catch (error) {
      window.alert(`No fue posible generar la nómina: ${(error as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="nominas-page fade-in">
      <header className="nominas-head">
        <div>
          <span className="nominas-kicker">UNIVERSOS EXPORTABLES</span>
          <h1>Nóminas</h1>
          <p>Construye universos de trabajo sin exponer registros en pantalla. Filtra, revisa cobertura y descarga el resultado con trazabilidad.</p>
        </div>
      </header>

      <section className="nominas-catalog">
        {NOMINAS.map((item) => (
          <button key={item.code} className={`nominas-card ${selected === item.code ? 'active' : ''}`} onClick={() => { setSelected(item.code); reset(); }}>
            <span className="nominas-card-icon">{glyph(item.code)}</span>
            <strong>{item.label}</strong>
            <small>{item.detail}</small>
            {!item.enabled && <em>Conector pendiente</em>}
          </button>
        ))}
      </section>

      <div className="nominas-workspace">
        <section className="nominas-panel nominas-filters">
          <div className="nominas-panel-head"><div><span>CONFIGURACIÓN</span><h2>Filtros de la nómina</h2></div><button onClick={reset}>Limpiar filtros</button></div>

          <div className="nominas-field-grid">
            <label><span>Región</span><select value={filters.region} onChange={(e) => setFilters((f) => ({ ...f, region: e.target.value }))}><option value="">Todas las regiones</option>{regions.map((r) => <option key={r}>{r}</option>)}</select></label>
            <label><span>Actividad / sector</span><select value={filters.activity} onChange={(e) => setFilters((f) => ({ ...f, activity: e.target.value }))}><option value="">Todas las actividades</option>{activities.map((r) => <option key={r}>{r}</option>)}</select></label>
            {types.length > 0 && <label><span>Categoría</span><select value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}><option value="">Todas las categorías</option>{types.map((r) => <option key={r}>{r}</option>)}</select></label>}
          </div>

          <div className="nominas-marks">
            <span>Marcas Atlas</span>
            <label><input type="checkbox" checked={filters.sanctions} onChange={(e) => setFilters((f) => ({ ...f, sanctions: e.target.checked }))} /> Sanciones</label>
            <label><input type="checkbox" checked={filters.publicFunds} onChange={(e) => setFilters((f) => ({ ...f, publicFunds: e.target.checked }))} /> Fondos públicos</label>
            <label><input type="checkbox" checked={filters.uaf} onChange={(e) => setFilters((f) => ({ ...f, uaf: e.target.checked }))} /> Vínculo UAF</label>
          </div>

          {!config.enabled && <div className="nominas-notice warning"><strong>Exportación aún no habilitada para esta familia.</strong><span>La sección ya queda incorporada al catálogo; falta conectar su endpoint de exportación para evitar consultas improvisadas o costosas sobre las tablas productivas.</span></div>}
        </section>

        <aside className="nominas-panel nominas-health">
          <div className="nominas-panel-head"><div><span>CONTROL DE COBERTURA</span><h2>Completitud y actualización</h2></div><i className={sourceHealth?.data_status === 'silent' ? 'bad' : 'ok'}>{sourceHealth?.data_status === 'silent' ? 'Fuente en silencio' : 'Fuente activa'}</i></div>

          <div className="nominas-source"><strong>{config.label}</strong><span>{config.source}</span><small>Autoridad / referencia: {stats.authority}</small></div>

          {stats.measurable ? (
            <div className="nominas-coverage">
              <div className="nominas-ring" style={{ ['--coverage' as string]: `${Math.min(100, Number(stats.coverage ?? 0)) * 3.6}deg` }}><strong>{pct(stats.coverage)}</strong></div>
              <div><span>Universo de referencia <b>{nf(stats.official)}</b></span><span>Disponible en Atlas <b>{nf(stats.atlas)}</b></span><span>Fecha de corte <b>{dateLabel(stats.cut)}</b></span><span>Última actualización <b>{dateLabel(stats.refreshed)}</b></span></div>
            </div>
          ) : (
            <div className="nominas-notice"><strong>Cobertura no estimable.</strong><span>No se mostrará un porcentaje mientras no exista un denominador oficial comparable. Esto evita presentar como “incompleta” una fuente que por definición es parcial.</span></div>
          )}

          <div className="nominas-health-foot"><span>Último registro</span><strong>{dateLabel(sourceHealth?.last_source_record_at)}</strong><span>Última ingesta exitosa</span><strong>{dateLabel(sourceHealth?.last_successful_ingest_at)}</strong></div>
        </aside>
      </div>

      <section className="nominas-exportbar">
        <div><span>DESCARGA</span><strong>{config.label}</strong><small>El Excel incluye una hoja de metadatos con filtros, fuente y fecha de extracción.</small></div>
        <button disabled={!config.enabled || exporting} onClick={() => void exportSelected()}>{exporting ? 'Generando…' : '⇩ Descargar nómina en Excel'}</button>
      </section>
    </div>
  );
}

function glyph(code: NominaCode) {
  return ({ osfl: '◇', fintech: '◫', sanciones: '⚖', so: '◎', sii: '▦', e1d: '▤', prensa: '◌', estado: '⌁' } as Record<NominaCode, string>)[code];
}

async function exportOsfl(filters: Filters) {
  type Row = { entity_id: string; rut: string | null; name: string; type: string; region: string | null; commune: string | null; main_activity: string | null; status: string | null; sources: Record<string, boolean> };
  type Page = { rows: Row[]; next_cursor: string | null; has_more: boolean };
  const rows: Row[] = [];
  let cursor: string | null = null;
  let more = true;
  while (more) {
    const { data, error } = await supabase.rpc('obs_osfl_export_page', {
      p_q: null, p_region: filters.region || null, p_type: filters.type || null, p_activity: filters.activity || null,
      p_source: null, p_uaf: filters.uaf ? 'SI' : 'TODAS', p_public_funds: filters.publicFunds ? 'SI' : 'TODOS', p_sanctions: filters.sanctions ? 'SI' : 'TODAS',
      p_after_entity_id: cursor, p_limit: 10000,
    });
    if (error) throw error;
    const page = data as Page | null;
    rows.push(...(page?.rows ?? []));
    cursor = page?.next_cursor ?? null;
    more = Boolean(page?.has_more && cursor);
    if (!(page?.rows?.length)) break;
  }
  downloadExcel({ filename: `ATLAS_Nomina_OSFL_${exportDate()}.xls`, sheetName: 'Nomina', rows, columns: [
    { header: 'Nombre / Razón social', value: (r) => r.name }, { header: 'RUT', value: (r) => r.rut ?? 'Sin RUT' }, { header: 'Categoría', value: (r) => r.type },
    { header: 'Región', value: (r) => r.region ?? '' }, { header: 'Comuna', value: (r) => r.commune ?? '' }, { header: 'Actividad', value: (r) => r.main_activity ?? '' },
    { header: 'Estado', value: (r) => r.status ?? '' }, { header: 'Cruces Atlas', value: (r) => Object.entries(r.sources ?? {}).filter(([, yes]) => yes).map(([k]) => k).join(' · ') },
  ], metadata: [{ label: 'Nómina', value: 'OSFL' }, { label: 'Fecha de extracción', value: exportDate() }, { label: 'Registros exportados', value: rows.length }, ...filtersAsMetadata(filters)] });
}

async function exportFintech(filters: Filters) {
  type Row = { brand: string | null; legal_name: string; rut: string | null; vertical: string | null; business_model: string | null; operating_status: string; psav_status: string; region: string | null; commune: string | null; sii_main_activity: string | null; has_cmf_public: boolean; has_uaf_public: boolean; source_codes: string[] };
  type Payload = { total: number; rows: Row[] };
  const rows: Row[] = [];
  let offset = 0;
  let total = 0;
  do {
    const { data, error } = await supabase.rpc('obs_fintech_search_v2', { p_q: null, p_region: filters.region || null, p_vertical: filters.activity || null, p_model: null, p_source: null, p_regulator: 'TODOS', p_psav: 'TODOS', p_operating: 'TODOS', p_limit: 500, p_offset: offset });
    if (error) throw error;
    const payload = data as Payload | null;
    const batch = payload?.rows ?? [];
    total = Number(payload?.total ?? 0);
    rows.push(...batch);
    offset += batch.length;
    if (!batch.length) break;
  } while (offset < total);
  downloadExcel({ filename: `ATLAS_Nomina_Fintech_${exportDate()}.xls`, sheetName: 'Nomina', rows, columns: [
    { header: 'Nombre / Razón social', value: (r) => r.brand || r.legal_name }, { header: 'Razón social legal', value: (r) => r.legal_name }, { header: 'RUT', value: (r) => r.rut ?? 'Sin RUT chileno' },
    { header: 'Categoría Fintech', value: (r) => r.vertical ?? '' }, { header: 'Modelo de negocio', value: (r) => r.business_model ?? '' }, { header: 'Estado operativo', value: (r) => r.operating_status },
    { header: 'PSAV', value: (r) => r.psav_status }, { header: 'Región', value: (r) => r.region ?? '' }, { header: 'Comuna', value: (r) => r.commune ?? '' }, { header: 'Actividad SII', value: (r) => r.sii_main_activity ?? '' },
    { header: 'Huella CMF', value: (r) => r.has_cmf_public }, { header: 'Huella UAF', value: (r) => r.has_uaf_public }, { header: 'Fuentes', value: (r) => (r.source_codes ?? []).join(' · ') },
  ], metadata: [{ label: 'Nómina', value: 'Fintech' }, { label: 'Fecha de extracción', value: exportDate() }, { label: 'Registros exportados', value: rows.length }, ...filtersAsMetadata(filters)] });
}

async function exportSanciones(filters: Filters) {
  type Row = { canonical_name?: string | null; source_entity_name?: string | null; rut?: string | null; regulator?: string | null; region?: string | null; event_date?: string | null; amount_clp?: number | string | null; amount_uf?: number | string | null; reason?: string | null; resolution_ref?: string | null; event_kind?: string | null };
  type Payload = { page?: { total?: number | string }; items?: Row[] };
  const rows: Row[] = [];
  let offset = 0;
  let total = 0;
  do {
    const request = { kind: 'events', q: '', universe: '', regulator: '', region: filters.region, event_kind: '', year: '', amount_band: '', limit: 500, offset };
    const { data, error } = await supabase.rpc('atlas_v2_sanctions_query', { p_request: request });
    if (error) throw error;
    const payload = data as Payload | null;
    const batch = payload?.items ?? [];
    total = Number(payload?.page?.total ?? 0);
    rows.push(...batch);
    offset += batch.length;
    if (!batch.length) break;
  } while (offset < total);
  downloadExcel({ filename: `ATLAS_Nomina_Sanciones_${exportDate()}.xls`, sheetName: 'Nomina', rows, columns: [
    { header: 'Nombre / Razón social', value: (r) => r.canonical_name || r.source_entity_name || 'Entidad no resuelta' }, { header: 'RUT', value: (r) => r.rut ?? 'Sin RUT' },
    { header: 'Organismo sancionador', value: (r) => r.regulator ?? '' }, { header: 'Región', value: (r) => r.region ?? '' }, { header: 'Fecha', value: (r) => r.event_date ?? '' },
    { header: 'Monto CLP', value: (r) => Number(r.amount_clp ?? 0) || '' }, { header: 'Monto UF', value: (r) => Number(r.amount_uf ?? 0) || '' }, { header: 'Tipo', value: (r) => r.event_kind ?? '' },
    { header: 'Materia / infracción', value: (r) => r.reason ?? '' }, { header: 'Resolución', value: (r) => r.resolution_ref ?? '' },
  ], metadata: [{ label: 'Nómina', value: 'Sanciones' }, { label: 'Fecha de extracción', value: exportDate() }, { label: 'Registros exportados', value: rows.length }, ...filtersAsMetadata(filters)] });
}
