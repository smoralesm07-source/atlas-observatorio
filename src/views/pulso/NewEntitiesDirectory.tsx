import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRpc } from '../../lib/rpc';
import { hrefFor } from '../../lib/router';
import './NewEntitiesDirectory.css';

type NewEntityRow = {
  rut: string;
  name: string;
  event_date: string;
  constitution_date: string | null;
  activity_start_date: string | null;
  sources: string[];
  region: string | null;
  commune: string | null;
  activity: string | null;
  sii_status: string | null;
  entity_id: string | null;
  visible_in_atlas: boolean;
  is_uaf_observed: boolean;
  uaf_sector: string | null;
  is_potential_so: boolean;
  potential_sector: string | null;
  ivo_score: number | null;
  ivo_band: string | null;
};

type DirectoryResponse = {
  contract: 'ATLAS_OBS_NEW_ENTITIES_DIRECTORY_V1';
  reference_date: string | null;
  from_date: string | null;
  to_date: string | null;
  total: number;
  limit: number;
  offset: number;
  rows: NewEntityRow[];
  semantics: string;
};

const PAGE_SIZE = 50;
const REGIONS = [
  'Arica y Parinacota',
  'Tarapacá',
  'Antofagasta',
  'Atacama',
  'Coquimbo',
  'Valparaíso',
  'Metropolitana de Santiago',
  "Libertador General Bernardo O'Higgins",
  'Maule',
  'Ñuble',
  'Biobío',
  'La Araucanía',
  'Los Ríos',
  'Los Lagos',
  'Aysén del General Carlos Ibáñez del Campo',
  'Magallanes y de la Antártica Chilena',
];

export function NewEntitiesDirectory({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (hash: string) => void;
}) {
  const [q, setQ] = useState('');
  const [source, setSource] = useState('TODAS');
  const [visibility, setVisibility] = useState('TODAS');
  const [region, setRegion] = useState('');
  const [activity, setActivity] = useState('');
  const [potentialOnly, setPotentialOnly] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(0);

  const deferredQ = useDeferredValue(q.trim());
  const deferredActivity = useDeferredValue(activity.trim());

  useEffect(() => {
    setPage(0);
  }, [deferredQ, source, visibility, region, deferredActivity, potentialOnly, fromDate, toDate]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const args = useMemo(() => ({
    p_q: deferredQ || null,
    p_source: source,
    p_visibility: visibility,
    p_region: region || null,
    p_activity: deferredActivity || null,
    p_potential_only: potentialOnly,
    p_from: fromDate || null,
    p_to: toDate || null,
    p_limit: PAGE_SIZE,
    p_offset: page * PAGE_SIZE,
  }), [deferredQ, source, visibility, region, deferredActivity, potentialOnly, fromDate, toDate, page]);

  const { data, error, loading, reload } = useRpc<DirectoryResponse>(
    'obs_new_entities_directory',
    args,
    { skip: !open },
  );

  if (!open) return null;

  const total = data?.total ?? 0;
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const last = Math.min(total, (page + 1) * PAGE_SIZE);
  const hasNext = (page + 1) * PAGE_SIZE < total;
  const lagDays = sourceLagDays(data?.reference_date);

  const resetFilters = () => {
    setQ('');
    setSource('TODAS');
    setVisibility('TODAS');
    setRegion('');
    setActivity('');
    setPotentialOnly(false);
    setFromDate('');
    setToDate('');
    setPage(0);
  };

  const openEntity = (row: NewEntityRow) => {
    onClose();
    if (row.entity_id) {
      onNavigate(hrefFor({ view: 'ficha', entityId: row.entity_id }));
      return;
    }
    onNavigate(hrefFor({ view: 'entidades', q: row.rut }));
  };

  return createPortal(
    <div className="ned-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="ned-shell" role="dialog" aria-modal="true" aria-labelledby="ned-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="ned-head">
          <div>
            <span className="ned-kicker">Radar de altas · RES + SII</span>
            <h2 id="ned-title">Nuevas entidades detectadas</h2>
            <p>Directorio de constituciones RES e inicios de actividades SII, separado del universo analítico priorizado de Atlas.</p>
          </div>
          <div className="ned-head-actions">
            <button type="button" onClick={() => reload()} disabled={loading} title="Actualizar consulta">{loading ? '…' : '↻'}</button>
            <button type="button" className="ned-close" onClick={onClose} aria-label="Cerrar directorio">×</button>
          </div>
        </header>

        <div className="ned-filters">
          <label className="ned-search ned-span-2">
            <span>Entidad o RUT</span>
            <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Ej. 78.512.589-4 o Letelier" />
          </label>
          <label>
            <span>Fuente de alta</span>
            <select value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="TODAS">RES o SII</option>
              <option value="RES">Constitución RES</option>
              <option value="SII">Inicio SII</option>
              <option value="AMBAS">Presente en ambas</option>
            </select>
          </label>
          <label>
            <span>Estado Atlas</span>
            <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
              <option value="TODAS">Todas</option>
              <option value="EN_ATLAS">Ya en Atlas</option>
              <option value="FUERA_ATLAS">Fuera del universo visible</option>
            </select>
          </label>
          <label>
            <span>Región</span>
            <select value={region} onChange={(event) => setRegion(event.target.value)}>
              <option value="">Todas</option>
              {REGIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>Actividad / sector</span>
            <input value={activity} onChange={(event) => setActivity(event.target.value)} placeholder="Actividad observada" />
          </label>
          <label>
            <span>Desde</span>
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} max={data?.reference_date ?? undefined} />
          </label>
          <label>
            <span>Hasta</span>
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} max={data?.reference_date ?? undefined} />
          </label>
          <label className="ned-check">
            <input type="checkbox" checked={potentialOnly} onChange={(event) => setPotentialOnly(event.target.checked)} />
            <span>Solo potenciales SO</span>
          </label>
          <button type="button" className="ned-reset" onClick={resetFilters}>Limpiar filtros</button>
        </div>

        <div className="ned-statusbar">
          <div>
            <b>{formatNumber(total)}</b>
            <span>entidades en la selección</span>
          </div>
          <div className="ned-status-meta">
            <span>Cobertura fuente: <b>{displayDate(data?.reference_date)}</b></span>
            {data?.from_date && data?.to_date && <span>Ventana: {displayDate(data.from_date)} – {displayDate(data.to_date)}</span>}
          </div>
        </div>

        {lagDays != null && lagDays >= 14 && (
          <div className="ned-freshness">
            <b>Cobertura masiva con rezago de {lagDays} días.</b>
            <span>El portal RES en línea puede contener actuaciones posteriores que todavía no han sido publicadas en el archivo masivo de Datos.gob.cl ni en el snapshot SII usado por Atlas.</span>
          </div>
        )}

        <div className="ned-table-wrap">
          {loading && !data ? (
            <div className="ned-state">Leyendo altas recientes…</div>
          ) : error && !data ? (
            <div className="ned-state is-error"><b>No fue posible cargar el directorio.</b><button type="button" onClick={() => reload()}>Reintentar</button></div>
          ) : (data?.rows.length ?? 0) === 0 ? (
            <div className="ned-state">No hay entidades para los filtros seleccionados.</div>
          ) : (
            <table className="ned-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Fuente</th>
                  <th>Entidad</th>
                  <th>Territorio</th>
                  <th>Actividad / lectura</th>
                  <th>Atlas</th>
                  <th aria-label="Acción" />
                </tr>
              </thead>
              <tbody>
                {data?.rows.map((row) => (
                  <tr key={`${row.rut}-${row.event_date}`}>
                    <td className="ned-mono">
                      <b>{displayDate(row.event_date)}</b>
                      <small>{row.constitution_date ? `RES ${displayDate(row.constitution_date)}` : row.activity_start_date ? `SII ${displayDate(row.activity_start_date)}` : ''}</small>
                    </td>
                    <td><div className="ned-source-chips">{row.sources.map((item) => <span key={item} data-source={item}>{item}</span>)}</div></td>
                    <td className="ned-entity"><b>{row.name}</b><small>RUT {formatRut(row.rut)}</small></td>
                    <td><b>{row.region ?? '—'}</b><small>{row.commune ?? ''}</small></td>
                    <td>
                      <b>{row.activity ?? row.potential_sector ?? 'Sin actividad detallada'}</b>
                      <small>{row.sii_status ? humanStatus(row.sii_status) : ''}</small>
                    </td>
                    <td>
                      <div className="ned-badges">
                        {row.visible_in_atlas ? <span data-tone="atlas">En Atlas</span> : <span data-tone="muted">No promovida</span>}
                        {row.is_uaf_observed && <span data-tone="uaf">SO UAF</span>}
                        {row.is_potential_so && <span data-tone="potential">Potencial SO</span>}
                      </div>
                    </td>
                    <td><button type="button" className="ned-open" onClick={() => openEntity(row)}>{row.entity_id ? 'Abrir ficha' : 'Buscar'} →</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="ned-foot">
          <p>{data?.semantics ?? 'RES representa constitución; SII representa inicio de actividades y no necesariamente creación jurídica.'}</p>
          <div className="ned-pagination">
            <span>{first}–{last} de {formatNumber(total)}</span>
            <button type="button" disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>← Anterior</button>
            <button type="button" disabled={!hasNext || loading} onClick={() => setPage((value) => value + 1)}>Siguiente →</button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function displayDate(value: string | null | undefined) {
  if (!value) return '—';
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('es-CL').format(value || 0);
}

function formatRut(value: string) {
  const cleaned = value.replace(/[^0-9kK]/g, '').toUpperCase();
  if (cleaned.length < 2) return value;
  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  return `${new Intl.NumberFormat('es-CL').format(Number(body))}-${dv}`;
}

function humanStatus(value: string) {
  if (/ACTIVE|ACTIVO|VIGENTE/i.test(value)) return 'Activo según fuente SII';
  if (/TERMIN|CERR/i.test(value)) return 'Término de giro';
  return value.replaceAll('_', ' ').toLowerCase();
}

function sourceLagDays(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const diff = Date.now() - date.getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}
