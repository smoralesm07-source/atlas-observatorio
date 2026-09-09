import { useMemo, useState } from 'react';
import type { UafPulse } from '../../lib/contracts';
import { useDebounced, useRpc } from '../../lib/rpc';
import { hrefFor } from '../../lib/router';
import { Empty, ErrorBox, Loading } from '../../components/primitives';
import { n, n1, rutFormat, titleCase } from '../../lib/format';
import type { CohortRequest } from '../../components/CohortDrawer';
import '../../styles/pulso-ciclo.css';

/* LENTE · CICLO REGISTRAL
   ───────────────────────
   Esta lente ya no mezcla el ciclo tributario, las sanciones y dos rankings de
   actividad. Responde una pregunta más precisa: cómo cambia el padrón UAF en
   el tiempo, qué sectores explican sus mayores expansiones/contracciones y qué
   sujetos componen el corte vigente.

   La UAF publica stock por corte, no la fecha individual de alta o baja. Por
   eso una caída sectorial se denomina contracción del stock inscrito y no se
   presenta como una baja individual identificada. */

const PAGE = 40;

type RegistryTotal = {
  year: number;
  total: number;
  as_of_date: string;
  source_kind: string;
  source_label: string;
  source_url: string | null;
  note: string | null;
};

type TrendPoint = { year: number; subjects: number };
type TrendRow = {
  sector: string;
  delta: number;
  first_value: number;
  last_value: number;
  points: TrendPoint[];
};

type RegistryEvolution = {
  total: RegistryTotal[];
  increases: TrendRow[];
  decreases: TrendRow[];
  note: string;
};

type SubjectRow = {
  entity_id: string;
  rut: string | null;
  name: string;
  subject_nature: string | null;
  uaf_sector: string | null;
  sii_status: string | null;
  sii_termination_date: string | null;
  region: string | null;
  commune: string | null;
  main_activity: string | null;
  sales_band: string | null;
  workers: number | null;
  ipf_score: number | null;
  ipf_band: string | null;
  sanction_evidence_count: number | null;
  press_evidence_count: number | null;
  alert_count: number | null;
  is_osfl: boolean | null;
  attention_motive: string | null;
  attention_rank: number | null;
};

type SubjectTable = { total: number; rows: SubjectRow[] };
type Order = 'relevancia' | 'ipf' | 'antecedentes' | 'nombre';

const SII_LABEL: Record<string, string> = {
  ACTIVE_AS_PUBLISHED: 'Activo ante el SII',
  TERMINATED_AS_PUBLISHED: 'Término de giro',
  SIN_PERFIL_SII: 'Sin perfil SII',
};

const MOTIVE_LABEL: Record<string, string> = {
  SANCION_RECIENTE: 'Sanción reciente',
  SANCION_HISTORICA: 'Sanción histórica',
  TERMINO_GIRO: 'Término de giro',
  IPF_ALTA: 'IPF alta',
  SECTOR_SIN_ROS: 'Sector sin ROS',
  GIRO_ATIPICO: 'Giro atípico',
  SIN_TERRITORIO: 'Sin territorio',
};

export function LenteCiclo({
  data,
  onCohort,
}: {
  data: UafPulse;
  onCohort: (req: CohortRequest) => void;
}) {
  const [query, setQuery] = useState('');
  const q = useDebounced(query, 240);
  const [sector, setSector] = useState('');
  const [status, setStatus] = useState('');
  const [order, setOrder] = useState<Order>('relevancia');
  const [page, setPage] = useState(0);

  const evolution = useRpc<RegistryEvolution>('obs_uaf_registry_evolution', {});
  const subjects = useRpc<SubjectTable>('obs_uaf_subjects_table', {
    p_q: q.trim() || null,
    p_sector: sector || null,
    p_status: status || null,
    p_order: order,
    p_limit: PAGE,
    p_offset: page * PAGE,
  });

  const sectorOptions = useMemo(() => {
    const values = (data.reporting?.sectores ?? [])
      .map((row) => row.sector_canonical)
      .filter((value): value is string => Boolean(value));
    return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'es'));
  }, [data.reporting?.sectores]);

  const u = data.universe;
  if (!u) return <Empty title="Sin padrón publicado" />;

  const total = subjects.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const start = total === 0 ? 0 : page * PAGE + 1;
  const end = Math.min(total, (page + 1) * PAGE);

  function changeFilter(next: () => void) {
    next();
    setPage(0);
  }

  function clearFilters() {
    setQuery('');
    setSector('');
    setStatus('');
    setOrder('relevancia');
    setPage(0);
  }

  return (
    <div className="pulse-cycle">
      <div className="pulse-cycle-summary" style={{ gridTemplateColumns: '1fr' }}>
        <section className="pulse-cycle-panel">
          <div className="pulse-cycle-head">
            <div>
              <h3>Evolución publicada del padrón UAF</h3>
              <p>Stock de sujetos obligados inscritos · 2020–2026</p>
            </div>
            <div className="pulse-cycle-meta">
              <strong>{n(evolution.data?.total.at(-1)?.total ?? u.total)}</strong>
              <span>inscritos al 30-06-2026</span>
            </div>
          </div>
          {evolution.loading && !evolution.data ? (
            <Loading label="Leyendo la serie publicada del padrón…" />
          ) : evolution.error ? (
            <ErrorBox error={evolution.error} onRetry={evolution.reload} />
          ) : evolution.data?.total.length ? (
            <RegistryChart points={evolution.data.total} />
          ) : (
            <Empty title="Sin serie de padrón disponible" />
          )}
        </section>
      </div>

      <div className="pulse-sector-trends">
        <TrendPanel
          title="Sectores que más aumentaron"
          hint="Top 5 · variación neta del stock 2020 → 2026"
          rows={evolution.data?.increases ?? []}
          loading={evolution.loading}
          tone="var(--present)"
          onPick={(row) => onCohort({ cohort: 'SECTOR', value: row.sector, title: row.sector })}
        />
        <TrendPanel
          title="Sectores con mayor contracción"
          hint="Top 5 · menor stock inscrito entre 2020 y 2026"
          rows={evolution.data?.decreases ?? []}
          loading={evolution.loading}
          tone="var(--sig-high)"
          onPick={(row) => onCohort({ cohort: 'SECTOR', value: row.sector, title: row.sector })}
          note={evolution.data?.note}
        />
      </div>

      <section className="pulse-so-panel">
        <div className="pulse-so-head">
          <div>
            <h3>Directorio de sujetos obligados</h3>
            <p>El padrón vigente, con señales útiles para orientar una revisión rápida y acceso directo a Entidad 360.</p>
          </div>
          <div className="pulse-so-total">{subjects.loading && !subjects.data ? '…' : n(total)} SO</div>
        </div>

        <div className="pulse-so-tools">
          <label className="pulse-so-search">
            <input
              type="search"
              value={query}
              onChange={(event) => changeFilter(() => setQuery(event.target.value))}
              placeholder="Buscar por razón social o RUT…"
              aria-label="Buscar sujeto obligado"
            />
          </label>
          <select value={sector} onChange={(event) => changeFilter(() => setSector(event.target.value))} aria-label="Filtrar por sector UAF">
            <option value="">Todos los sectores UAF</option>
            {sectorOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select value={status} onChange={(event) => changeFilter(() => setStatus(event.target.value))} aria-label="Filtrar por estado SII">
            <option value="">Todo estado SII</option>
            <option value="ACTIVE_AS_PUBLISHED">Activo ante el SII</option>
            <option value="TERMINATED_AS_PUBLISHED">Término de giro</option>
            <option value="SIN_PERFIL_SII">Sin perfil SII</option>
          </select>
          <select value={order} onChange={(event) => changeFilter(() => setOrder(event.target.value as Order))} aria-label="Ordenar sujetos obligados">
            <option value="relevancia">Orden: relevancia</option>
            <option value="ipf">Orden: IPF</option>
            <option value="antecedentes">Orden: antecedentes</option>
            <option value="nombre">Orden: nombre</option>
          </select>
          <button className="pulse-so-clear" onClick={clearFilters}>Limpiar</button>
        </div>

        {subjects.error ? (
          <ErrorBox error={subjects.error} onRetry={subjects.reload} />
        ) : subjects.loading && !subjects.data ? (
          <div className="pulse-so-statebar">Actualizando padrón…</div>
        ) : !(subjects.data?.rows.length) ? (
          <div className="pulse-so-statebar">No hay sujetos que coincidan con los filtros.</div>
        ) : (
          <SubjectRows rows={subjects.data.rows} />
        )}

        <div className="pulse-so-footer">
          <span className="pulse-so-range">{n(start)}–{n(end)} de {n(total)}</span>
          <div className="pulse-so-pages">
            <button disabled={page === 0 || subjects.loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>← Anterior</button>
            <button disabled={page + 1 >= pages || subjects.loading} onClick={() => setPage((value) => Math.min(pages - 1, value + 1))}>Siguiente →</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function RegistryChart({ points }: { points: RegistryTotal[] }) {
  const W = 760, H = 154, L = 38, R = 38, T = 28, B = 28;
  const values = points.map((point) => point.total);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(200, (max - min) * 0.12);
  const low = Math.max(0, min - pad);
  const high = max + pad * 0.35;
  const span = Math.max(1, high - low);
  const x = (index: number) => L + index * ((W - L - R) / Math.max(1, points.length - 1));
  const y = (value: number) => T + (H - T - B) * (1 - (value - low) / span);
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(point.total).toFixed(1)}`).join(' ');
  const baseline = H - B;
  const area = `${line} L ${x(points.length - 1).toFixed(1)} ${baseline} L ${x(0).toFixed(1)} ${baseline} Z`;
  const last = points[points.length - 1];

  return (
    <>
      <div className="pulse-registry-chart">
        <svg className="pulse-registry-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Evolución del padrón UAF entre 2020 y 2026">
          {[0.2, 0.5, 0.8].map((p) => <line key={p} className="pulse-registry-grid" x1={L} x2={W - R} y1={T + (H - T - B) * p} y2={T + (H - T - B) * p} />)}
          <path className="pulse-registry-area" d={area} />
          <path className="pulse-registry-line" d={line} />
          {points.map((point, index) => (
            <g key={point.year}>
              <circle className="pulse-registry-dot" data-current={point.year === last.year} cx={x(index)} cy={y(point.total)} r={point.year === last.year ? 4.3 : 3.2} />
              <text className={point.year === last.year ? 'pulse-registry-current' : 'pulse-registry-value'} x={x(index)} y={y(point.total) - 9}>{n(point.total)}</text>
              <text className="pulse-registry-year" x={x(index)} y={H - 7}>{point.year}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="pulse-registry-note">
        <i />
        <span>2020–2025 son cierres anuales publicados en los Informes Estadísticos UAF. El punto 2026 corresponde al padrón semestral al 30-06-2026: <b>{n(last.total)} inscritos</b>, no una proyección.</span>
      </div>
    </>
  );
}

function TrendPanel({
  title, hint, rows, loading, tone, onPick, note,
}: {
  title: string;
  hint: string;
  rows: TrendRow[];
  loading: boolean;
  tone: string;
  onPick: (row: TrendRow) => void;
  note?: string;
}) {
  return (
    <section className="pulse-cycle-panel">
      <div className="pulse-cycle-head"><div><h3>{title}</h3><p>{hint}</p></div></div>
      {loading && rows.length === 0 ? (
        <div className="pulse-so-statebar">Calculando variación sectorial…</div>
      ) : rows.length === 0 ? (
        <div className="pulse-so-statebar">Sin serie sectorial comparable.</div>
      ) : (
        <div className="pulse-trend-list">
          {rows.map((row) => (
            <button key={row.sector} className="pulse-trend-row" style={{ ['--trend-tone' as string]: tone }} onClick={() => onPick(row)} title={`Abrir sujetos de ${row.sector}`}>
              <span className="pulse-trend-name">
                <b>{titleCase(row.sector)}</b>
                <span>{n(row.first_value)} → {n(row.last_value)} SO</span>
              </span>
              <Sparkline points={row.points} />
              <span className="pulse-trend-delta">{row.delta > 0 ? '+' : ''}{n(row.delta)}<small>SO netos</small></span>
            </button>
          ))}
        </div>
      )}
      <p className="pulse-trend-foot">{note ?? 'Ranking sobre sectores comparables con observación continua en los siete cortes 2020–2026. Pincha una serie para abrir sus sujetos.'}</p>
    </section>
  );
}

function Sparkline({ points }: { points: TrendPoint[] }) {
  const W = 170, H = 30, P = 2;
  const values = points.map((point) => point.subjects);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const x = (index: number) => P + index * ((W - P * 2) / Math.max(1, points.length - 1));
  const y = (value: number) => P + (H - P * 2) * (1 - (value - min) / span);
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(point.subjects).toFixed(1)}`).join(' ');
  return (
    <svg className="pulse-trend-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <path d={path} />
      {points.map((point, index) => <circle key={point.year} cx={x(index)} cy={y(point.subjects)} r={index === points.length - 1 ? 2.2 : 1.4} />)}
    </svg>
  );
}

function SubjectRows({ rows }: { rows: SubjectRow[] }) {
  return (
    <div className="pulse-so-scroll">
      <table className="pulse-so-table">
        <thead><tr>
          <th>Sujeto obligado</th>
          <th>Sector UAF</th>
          <th>Situación / territorio</th>
          <th>Escala</th>
          <th>Elementos de interés</th>
          <th>IPF</th>
          <th />
        </tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.entity_id}>
              <td className="pulse-so-name">
                <b>{titleCase(row.name)}</b>
                <span className="pulse-so-rut">{rutFormat(row.rut)} · {row.main_activity ? titleCase(row.main_activity) : 'sin actividad principal observada'}</span>
              </td>
              <td className="pulse-so-sector">{row.uaf_sector ? titleCase(row.uaf_sector) : '—'}</td>
              <td className="pulse-so-location">
                <span className="pulse-so-state" style={{ ['--state-tone' as string]: stateTone(row.sii_status) }}>{stateLabel(row.sii_status)}</span>
                <small>{row.commune ? `${titleCase(row.commune)} · ${titleCase(row.region)}` : (row.region ? titleCase(row.region) : 'sin territorio observado')}</small>
              </td>
              <td className="pulse-so-scale">
                <span>{row.sales_band ? `Tramo ventas ${row.sales_band}` : 'Ventas s/d'}</span>
                <small>{row.workers == null ? 'trabajadores s/d' : `${n(row.workers)} trabajador${row.workers === 1 ? '' : 'es'}`}</small>
              </td>
              <td><SignalStrip row={row} /></td>
              <td className="pulse-so-ipf">
                <b>{row.ipf_score == null ? '—' : n1(row.ipf_score)}</b>
                <span>{row.ipf_band ? titleCase(row.ipf_band.replace(/_/g, ' ')) : (row.attention_motive ? MOTIVE_LABEL[row.attention_motive] ?? titleCase(row.attention_motive.replace(/_/g, ' ')) : 'sin banda')}</span>
              </td>
              <td><a className="pulse-so-360" href={hrefFor({ view: 'ficha', entityId: row.entity_id })}>Entidad 360 →</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SignalStrip({ row }: { row: SubjectRow }) {
  const sanctions = row.sanction_evidence_count ?? 0;
  const press = row.press_evidence_count ?? 0;
  const alerts = row.alert_count ?? 0;
  if (sanctions + press + alerts === 0 && !row.is_osfl) return <span style={{ color: 'var(--ink-4)', fontSize: 8.5 }}>sin marca en estos cruces</span>;
  return (
    <div className="pulse-so-signals">
      {sanctions > 0 && <span className="pulse-so-signal" data-kind="sanction">Sanción · {n(sanctions)}</span>}
      {press > 0 && <span className="pulse-so-signal" data-kind="press">Prensa · {n(press)}</span>}
      {alerts > 0 && <span className="pulse-so-signal" data-kind="alert">Señal · {n(alerts)}</span>}
      {row.is_osfl && <span className="pulse-so-signal" data-kind="osfl">OSFL</span>}
    </div>
  );
}

function stateLabel(status: string | null): string {
  return status ? (SII_LABEL[status] ?? titleCase(status.replace(/_/g, ' '))) : 'Estado SII s/d';
}

function stateTone(status: string | null): string {
  if (status === 'ACTIVE_AS_PUBLISHED') return 'var(--present)';
  if (status === 'TERMINATED_AS_PUBLISHED') return 'var(--sig-high)';
  return 'var(--unknown)';
}