import { useMemo, useState } from 'react';
import { useDebounced, useRpc } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import { downloadExcel, exportDate, type ExcelColumn } from '../lib/excelExport';
import '../styles/state-relations.css';
import '../styles/agency-beneficiaries.css';

type SourceMode = 'ALL' | 'PUBLIC_FUNDS' | 'MARKET';
type FlowMode = 'ALL' | 'SUPPLIER' | 'RECIPIENT';

type AgencyCandidate = {
  norm_name: string;
  label: string;
  funds_payer_key?: string | null;
  market_buyer_rut?: string | null;
  has_public_funds?: boolean;
  has_market?: boolean;
  first_year?: number | null;
  last_year?: number | null;
};

type AgencySearchResponse = {
  ok?: boolean;
  rows?: AgencyCandidate[];
};

type BeneficiaryRow = {
  rut: string;
  name: string;
  entity_id?: string | null;
  entity_type?: string | null;
  region?: string | null;
  public_funds_amount?: number | null;
  public_funds_supplier_amount?: number | null;
  public_funds_recipient_amount?: number | null;
  public_funds_transaction_count?: number | null;
  market_amount?: number | null;
  market_order_count?: number | null;
  first_seen?: string | null;
  last_seen?: string | null;
  first_year?: number | null;
  last_year?: number | null;
  has_public_funds?: boolean;
  has_market?: boolean;
  is_resolved?: boolean;
};

type BeneficiarySummary = {
  beneficiary_count?: number;
  resolved_count?: number;
  public_funds_amount?: number;
  public_funds_transactions?: number;
  market_amount?: number;
  market_orders?: number;
  top10_public_funds_share?: number | null;
  top10_market_share?: number | null;
};

type BeneficiaryResponse = {
  ok?: boolean;
  total?: number;
  rows?: BeneficiaryRow[];
  summary?: BeneficiarySummary;
  semantics?: Record<string, string>;
};

const CURRENT_YEAR = new Date().getFullYear();
const PAGE = 100;
const EXPORT_MAX_ROWS = 100000;

function clp(value: number | null | undefined) {
  if (value == null) return '—';
  return new Intl.NumberFormat('es-CL', {
    style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
  }).format(Number(value));
}

function num(value: number | null | undefined) {
  if (value == null) return '—';
  return Number(value).toLocaleString('es-CL');
}

function pct(value: number | null | undefined) {
  if (value == null) return '—';
  return `${Number(value).toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`;
}

function yearRange(first?: number | null, last?: number | null) {
  if (!first && !last) return '—';
  return first === last ? String(first ?? last) : `${first ?? '…'}–${last ?? '…'}`;
}

function hasResolvedIdentity(row: BeneficiaryRow) {
  const name = String(row.name ?? '').trim().toUpperCase();
  const rut = String(row.rut ?? '').trim().toUpperCase();
  return Boolean(row.entity_id && name && name !== rut);
}

export function AgencyBeneficiaryUniverse({
  onNavigate,
  fromYear: controlledFromYear,
  toYear: controlledToYear,
  compactShell = false,
}: {
  onNavigate: (hash: string) => void;
  fromYear?: number;
  toYear?: number;
  compactShell?: boolean;
}) {
  const [internalFromYear, setInternalFromYear] = useState(2020);
  const [internalToYear, setInternalToYear] = useState(CURRENT_YEAR);
  const fromYear = controlledFromYear ?? internalFromYear;
  const toYear = controlledToYear ?? internalToYear;
  const [source, setSource] = useState<SourceMode>('ALL');
  const [flow, setFlow] = useState<FlowMode>('ALL');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<AgencyCandidate | null>(null);
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const debounced = useDebounced(q, 260).trim();
  const searchEnabled = debounced.length >= 2 && !selected;

  const search = useRpc<AgencySearchResponse>('obs_state_agency_beneficiaries', {
    p_request: {
      action: 'search', query: debounced, from_year: fromYear, to_year: toYear,
      source, limit: 20,
    },
  }, { skip: !searchEnabled });

  const request = useMemo(() => ({
    action: 'rows',
    agency_name: selected?.label ?? '',
    funds_payer_key: selected?.funds_payer_key ?? null,
    market_buyer_rut: selected?.market_buyer_rut ?? null,
    from_year: fromYear,
    to_year: toYear,
    source,
    flow: source === 'MARKET' ? 'ALL' : flow,
    limit: PAGE,
    offset: page * PAGE,
  }), [selected, fromYear, toYear, source, flow, page]);

  const result = useRpc<BeneficiaryResponse>('obs_state_agency_beneficiaries', {
    p_request: request,
  }, { skip: !selected });

  const rows = result.data?.rows ?? [];
  const summary = result.data?.summary ?? {};
  const total = Number(result.data?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const exportTooLarge = total > EXPORT_MAX_ROWS;

  function resetAgencySearch(value = '') {
    setQ(value);
    setSelected(null);
    setPage(0);
  }

  function chooseAgency(row: AgencyCandidate) {
    setSelected(row);
    setQ(row.label);
    setPage(0);
  }

  async function fetchAllRows() {
    if (!selected) return [] as BeneficiaryRow[];
    if (exportTooLarge) throw new Error(`El universo contiene ${total.toLocaleString('es-CL')} beneficiarios. Acota el período o la fuente a ${EXPORT_MAX_ROWS.toLocaleString('es-CL')} o menos antes de exportar.`);

    const all: BeneficiaryRow[] = [];
    const chunk = 1000;
    for (let offset = 0; offset < total; offset += chunk) {
      const { data, error } = await supabase.rpc('obs_state_agency_beneficiaries', {
        p_request: { ...request, limit: chunk, offset },
      });
      if (error) throw error;
      const batch = ((data as BeneficiaryResponse)?.rows ?? []) as BeneficiaryRow[];
      all.push(...batch);
      if (batch.length < chunk) break;
    }
    return all;
  }

  async function exportUniverse() {
    if (!selected || !total || exporting || exportTooLarge) return;
    setExportError(null);
    setExporting(true);
    try {
      const all = await fetchAllRows();
      const columns: ExcelColumn<BeneficiaryRow>[] = [
        { header: 'Beneficiario', value: (r) => r.name },
        { header: 'RUT', value: (r) => r.rut },
        { header: 'Identidad Atlas', value: (r) => hasResolvedIdentity(r) ? 'Resuelta' : 'Parcial / sólo RUT' },
        { header: 'Tipo entidad', value: (r) => r.entity_type },
        { header: 'Región', value: (r) => r.region },
        { header: 'Presupuesto Abierto - total', value: (r) => r.public_funds_amount },
        { header: 'Presupuesto Abierto - proveedor', value: (r) => r.public_funds_supplier_amount },
        { header: 'Presupuesto Abierto - receptor/traspaso', value: (r) => r.public_funds_recipient_amount },
        { header: 'Registros Presupuesto Abierto', value: (r) => r.public_funds_transaction_count },
        { header: 'Mercado Público - monto', value: (r) => r.market_amount },
        { header: 'Órdenes de compra', value: (r) => r.market_order_count },
        { header: 'Primer año', value: (r) => r.first_year },
        { header: 'Último año', value: (r) => r.last_year },
        { header: 'Fuente Presupuesto Abierto', value: (r) => r.has_public_funds ? 'Sí' : 'No' },
        { header: 'Fuente Mercado Público', value: (r) => r.has_market ? 'Sí' : 'No' },
      ];

      downloadExcel({
        filename: `atlas_beneficiarios_${exportDate()}.xls`,
        sheetName: 'Beneficiarios',
        rows: all,
        columns,
        metadata: [
          { label: 'Organismo', value: selected.label },
          { label: 'Período consultado', value: `${fromYear}-${toYear}` },
          { label: 'Fuente', value: source },
          { label: 'Rol Presupuesto Abierto', value: source === 'MARKET' ? 'No aplica' : flow },
          { label: 'Beneficiarios únicos exportados', value: total },
          { label: 'Criterio', value: 'La nómina incluye todas las entidades que cumplen los filtros activos, no sólo la página visible.' },
          { label: 'Monto Presupuesto Abierto', value: summary.public_funds_amount ?? 0 },
          { label: 'Monto Mercado Público', value: summary.market_amount ?? 0 },
          { label: 'Nota', value: 'Los montos de Presupuesto Abierto y Mercado Público se mantienen separados para evitar doble contabilización.' },
        ],
      });
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'No fue posible preparar la exportación.');
    } finally {
      setExporting(false);
    }
  }

  const top10Label = source === 'PUBLIC_FUNDS'
    ? pct(summary.top10_public_funds_share)
    : source === 'MARKET'
      ? pct(summary.top10_market_share)
      : `PA ${pct(summary.top10_public_funds_share)} · MP ${pct(summary.top10_market_share)}`;

  return (
    <div className="state-page agency-beneficiary-page fade-in">
      {!compactShell && <div className="state-head agency-head">
        <div className="state-head-copy">
          <div className="eyebrow">ATLAS · Estado → entidades</div>
          <h1>Beneficiarios de organismos públicos</h1>
          <p>Parte desde un servicio público y reconstruye el universo observado de entidades a las que compró, pagó o transfirió recursos durante el período consultado.</p>
          <div className="state-capabilities" aria-label="Cobertura de la consulta">
            <span><i data-tone="funds" /><b>Presupuesto Abierto</b><small>Pagos · proveedores · receptores</small></span>
            <span><i data-tone="market" /><b>Mercado Público</b><small>Comprador → proveedor</small></span>
            <span><i data-tone="atlas" /><b>Identidad Atlas</b><small>Entidad 360 cuando está resuelta</small></span>
          </div>
        </div>
      </div>}

      <div className="agency-querybar state-card">
        <div className="agency-search-block">
          <div className="huella-sidebar-title"><strong>Buscar servicio público</strong><span>Selecciona el organismo desde el cual reconstruir beneficiarios y proveedores.</span></div>
          <label className="state-label" htmlFor="agency-search">Organismo público</label>
          <div className="agency-search-row">
            <input
              id="agency-search"
              className="state-search-input"
              value={q}
              onChange={(e) => resetAgencySearch(e.target.value)}
              placeholder="Ej. UAF, SII, municipalidad…"
            />
            {selected && <button className="state-clear" onClick={() => resetAgencySearch('')}>Cambiar</button>}
          </div>
          {!selected && <small className="filter-hint">Selecciona una coincidencia normalizada; Atlas cruza el identificador disponible en cada fuente.</small>}
          {search.loading && <div className="state-muted">Buscando organismos…</div>}
          {searchEnabled && !search.loading && !search.error && (search.data?.rows ?? []).length === 0 && <div className="state-muted">Sin organismos coincidentes en el período y fuente seleccionados.</div>}
          {!selected && (search.data?.rows ?? []).length > 0 && (
            <div className="agency-search-results">
              {(search.data?.rows ?? []).map((row) => (
                <button key={row.norm_name} className="agency-agency-result" onClick={() => chooseAgency(row)}>
                  <span><strong>{row.label}</strong><small>{yearRange(row.first_year, row.last_year)}</small></span>
                  <span className="state-source-pills">{row.has_public_funds && <em>Presupuesto</em>}{row.has_market && <em>Mercado Público</em>}</span>
                </button>
              ))}
            </div>
          )}
          {search.error && <div className="state-error">{search.error}</div>}
        </div>

        {!compactShell && <div className="agency-filter-block">
          <label className="state-label">Período</label>
          <div className="agency-period">
            <input type="number" min={2016} max={CURRENT_YEAR} value={fromYear} onChange={(e) => { setInternalFromYear(Math.min(toYear, Number(e.target.value) || 2020)); setPage(0); }} />
            <b>→</b>
            <input type="number" min={fromYear} max={CURRENT_YEAR} value={toYear} onChange={(e) => { setInternalToYear(Math.max(fromYear, Number(e.target.value) || CURRENT_YEAR)); setPage(0); }} />
          </div>
        </div>}

        <div className="agency-filter-block">
          <label className="state-label">Fuente</label>
          <select value={source} onChange={(e) => { setSource(e.target.value as SourceMode); setPage(0); }}>
            <option value="ALL">Ambas fuentes</option>
            <option value="PUBLIC_FUNDS">Presupuesto Abierto</option>
            <option value="MARKET">Mercado Público</option>
          </select>
        </div>

        <div className="agency-filter-block">
          <label className="state-label">Tipo de flujo</label>
          <select disabled={source === 'MARKET'} value={source === 'MARKET' ? 'ALL' : flow} onChange={(e) => { setFlow(e.target.value as FlowMode); setPage(0); }}>
            <option value="ALL">Todos los pagos</option>
            <option value="SUPPLIER">Pagos como proveedor</option>
            <option value="RECIPIENT">Transferencias / receptor</option>
          </select>
        </div>
      </div>

      {!selected ? (
        <div className="state-card state-empty state-empty-large agency-empty">
          <div className="state-empty-icon">⌁</div>
          <strong>Selecciona un organismo público</strong>
          <span>Atlas partirá desde el pagador/comprador y construirá a la derecha el universo de contrapartes del período.</span>
        </div>
      ) : (
        <section className="state-card agency-result-card">
          <div className="agency-result-head">
            <div>
              <span>Organismo consultado</span>
              <h2>{selected.label}</h2>
              <small>{fromYear}–{toYear} · {source === 'ALL' ? 'ambas fuentes' : source === 'PUBLIC_FUNDS' ? 'Presupuesto Abierto' : 'Mercado Público'}</small>
            </div>
            <div className="agency-export-actions"><small>Exporta las {total.toLocaleString('es-CL')} entidades que cumplen los filtros activos.</small><button className="state-primary" disabled={!total || exporting || exportTooLarge} onClick={() => void exportUniverse()}>{exporting ? 'Preparando…' : '⇩ Exportar nómina filtrada'}</button></div>
          </div>

          {exportTooLarge && <div className="state-error">El universo supera {EXPORT_MAX_ROWS.toLocaleString('es-CL')} filas. Acota la consulta antes de exportar.</div>}
          {exportError && <div className="state-error">{exportError}</div>}
          {result.error && <div className="state-error">{result.error}</div>}

          <div className="state-kpis agency-kpis">
            <div className="state-kpi"><span>Beneficiarios únicos</span><strong>{result.loading ? '…' : num(summary.beneficiary_count)}</strong><small>Unión por RUT · sin ocultar no resueltos</small></div>
            <div className="state-kpi"><span>Presupuesto Abierto</span><strong>{result.loading ? '…' : clp(summary.public_funds_amount)}</strong><small>{num(summary.public_funds_transactions)} registros observados</small></div>
            <div className="state-kpi"><span>Mercado Público</span><strong>{result.loading ? '…' : clp(summary.market_amount)}</strong><small>{num(summary.market_orders)} órdenes observadas</small></div>
            <div className="state-kpi"><span>Concentración top 10</span><strong>{result.loading ? '…' : top10Label}</strong><small>Participación de los 10 principales receptores</small></div>
          </div>

          <div className="agency-semantics">
            <b>Lectura:</b> los montos de Presupuesto Abierto y Mercado Público se muestran por separado y no se suman. La ausencia en una fuente no elimina al beneficiario del universo si existe en la otra.
          </div>

          {!result.loading && !result.error && rows.length === 0 ? (
            <div className="state-empty state-empty-large"><strong>Sin beneficiarios observados</strong><span>Prueba ampliar el período, cambiar la fuente o revisar el tipo de flujo.</span></div>
          ) : (
            <div className="agency-table-wrap">
              <table className="agency-table">
                <thead><tr><th>Beneficiario</th><th>Presupuesto Abierto</th><th>Mercado Público</th><th>Operaciones</th><th>Período</th><th>Fuente</th><th></th></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.rut}>
                      <td>
                        <strong>{row.name || row.rut}</strong>
                        <small>{row.rut}{row.region ? ` · ${row.region}` : ''}</small>
                        <span className={hasResolvedIdentity(row) ? 'identity-tag resolved' : 'identity-tag partial'}>{hasResolvedIdentity(row) ? 'Identidad Atlas' : 'Identidad parcial'}</span>
                      </td>
                      <td><b>{clp(row.public_funds_amount)}</b><small>Proveedor {clp(row.public_funds_supplier_amount)} · receptor {clp(row.public_funds_recipient_amount)}</small></td>
                      <td><b>{clp(row.market_amount)}</b><small>{num(row.market_order_count)} OC</small></td>
                      <td><b>{num((row.public_funds_transaction_count ?? 0) + (row.market_order_count ?? 0))}</b><small>{num(row.public_funds_transaction_count)} PA · {num(row.market_order_count)} OC</small></td>
                      <td><b>{yearRange(row.first_year, row.last_year)}</b><small>{row.first_seen ?? '—'} → {row.last_seen ?? '—'}</small></td>
                      <td><div className="state-source-pills agency-row-sources">{row.has_public_funds && <em>Presupuesto</em>}{row.has_market && <em>Mercado</em>}</div></td>
                      <td>{row.entity_id ? <button className="row-open" onClick={() => onNavigate(`#/entidad/${encodeURIComponent(row.entity_id as string)}`)}>Entidad 360 →</button> : <span className="agency-no-profile">Sin ficha</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {total > PAGE && <div className="sample-pagination"><button disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Anterior</button><span>{page + 1} / {pages} · {total.toLocaleString('es-CL')} beneficiarios</span><button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Siguiente →</button></div>}
        </section>
      )}
    </div>
  );
}
