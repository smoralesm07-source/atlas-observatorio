import { useEffect, useState } from 'react';
import type { CohortRequest } from './CohortDrawer';
import type { UafSubjectRow } from '../lib/contracts';
import { useDebounced, useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import { n, n1, rutFormat, titleCase } from '../lib/format';
import '../styles/subject-directory.css';

export type DirectorySelection =
  | {
      kind: 'registered';
      request: CohortRequest;
      clientSector?: string | null;
      clientRegion?: string | null;
      clientIndustry?: string | null;
    }
  | {
      kind: 'potential';
      title: string;
      hint?: string;
      sector?: string | null;
      region?: string | null;
      activity?: string | null;
      industry?: string | null;
    };

type SortMode = 'relevance' | 'name' | 'score' | 'signals';
type PotentialDirectoryRow = {
  rut: string;
  entity_id: string | null;
  name: string;
  implied_sector: string | null;
  matched_activity: string | null;
  economic_sector: string | null;
  region: string | null;
  commune: string | null;
  sales_band_size: string | null;
  sales_band_uf: string | null;
  detection_tier: string | null;
  evidence_class: string | null;
  ivo_score: number | null;
  ivo_band: string | null;
  res_available: boolean;
  uaf_sanction_events: number;
  flags: string[] | null;
  total_count: number;
};

const PAGE = 80;
const DEFAULT_REQUEST: CohortRequest = {
  cohort: 'TODOS',
  title: 'Padrón completo de sujetos obligados',
};

export function SubjectDirectory({
  id,
  selection,
  onReset,
}: {
  id?: string;
  selection: DirectorySelection;
  onReset?: () => void;
}) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 220);
  const [sort, setSort] = useState<SortMode>('relevance');
  const [page, setPage] = useState(0);
  const request = selection.kind === 'registered' ? selection.request : DEFAULT_REQUEST;
  const selectionKey = selection.kind === 'registered'
    ? `r|${selection.request.cohort}|${selection.request.value ?? ''}|${selection.clientSector ?? ''}|${selection.clientRegion ?? ''}|${selection.clientIndustry ?? ''}`
    : `p|${selection.sector ?? ''}|${selection.region ?? ''}|${selection.activity ?? ''}|${selection.industry ?? ''}`;

  useEffect(() => setPage(0), [selectionKey]);

  const registered = useRpc<UafSubjectRow[]>('obs_uaf_subject_directory_v2', {
    p_cohort: request.cohort,
    p_value: request.value ?? null,
    p_q: debouncedQuery.trim() || null,
    p_sector: selection.kind === 'registered' ? selection.clientSector ?? null : null,
    p_region: selection.kind === 'registered' ? selection.clientRegion ?? null : null,
    p_industry: selection.kind === 'registered' ? selection.clientIndustry ?? null : null,
    p_order: sort === 'name' ? 'nombre' : sort === 'score' ? 'ipf' : sort === 'signals' ? 'senales' : 'relevancia',
    p_limit: PAGE,
    p_offset: page * PAGE,
  }, { skip: selection.kind !== 'registered' });

  const potentials = useRpc<PotentialDirectoryRow[]>('obs_uaf_potential_directory_v2', {
    p_q: debouncedQuery.trim() || null,
    p_sector: selection.kind === 'potential' ? selection.sector ?? null : null,
    p_region: selection.kind === 'potential' ? selection.region ?? null : null,
    p_activity: selection.kind === 'potential' ? selection.activity ?? null : null,
    p_industry: selection.kind === 'potential' ? selection.industry ?? null : null,
    p_order: sort === 'name' ? 'nombre' : sort === 'score' ? 'ivo' : sort === 'signals' ? 'senales' : 'relevancia',
    p_limit: PAGE,
    p_offset: page * PAGE,
  }, { skip: selection.kind !== 'potential' });

  const rows = selection.kind === 'registered' ? registered.data ?? [] : potentials.data ?? [];
  const total = rows[0]?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const start = total > 0 ? page * PAGE + 1 : 0;
  const end = Math.min(total, (page + 1) * PAGE);
  const title = selection.kind === 'registered' ? selection.request.title : selection.title;
  const hint = selection.kind === 'registered' ? selection.request.hint : selection.hint;
  const clientFilter = selection.kind === 'registered'
    ? [selection.clientSector, selection.clientRegion, selection.clientIndustry].filter(Boolean).join(' · ')
    : [selection.sector, selection.region, selection.industry, selection.activity].filter(Boolean).join(' · ');
  const activeRpc = selection.kind === 'registered' ? registered : potentials;

  const changeQuery = (value: string) => {
    setQuery(value);
    setPage(0);
  };
  const changeSort = (value: SortMode) => {
    setSort(value);
    setPage(0);
  };
  const resetAll = () => {
    setQuery('');
    setSort('relevance');
    setPage(0);
    onReset?.();
  };

  return (
    <section className="subject-directory" id={id} aria-label="Directorio analítico">
      <header className="subject-directory-head">
        <div>
          <h3>{selection.kind === 'registered' ? 'Directorio de sujetos obligados' : 'Directorio de potenciales SO'}</h3>
          <p>
            {title}{hint ? ` · ${hint}` : ''}. El directorio responde a los gráficos y conserva el contexto del corte seleccionado.
          </p>
        </div>
        <div className="subject-directory-count">
          {activeRpc.loading && !activeRpc.data ? '…' : n(total)}
          <small>{selection.kind === 'registered' ? 'sujetos en la cohorte exacta' : 'candidatos en la cohorte exacta'}</small>
        </div>
      </header>

      <div className="subject-directory-context">
        <span>{selection.kind === 'registered' ? 'Padrón inscrito' : 'Potenciales SO'}</span>
        <span>{title}</span>
        {clientFilter && <span>{clientFilter}</span>}
        {onReset && <button className="subject-directory-reset" onClick={resetAll}>Restablecer directorio</button>}
      </div>

      <div className="subject-directory-tools">
        <label className="subject-directory-search">
          <input
            type="search"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            placeholder="Buscar por nombre, RUT, sector, actividad, industria o territorio…"
            aria-label="Filtrar directorio"
          />
          {query && <button onClick={() => changeQuery('')} aria-label="Limpiar búsqueda">×</button>}
        </label>
        <div className="subject-directory-sort" aria-label="Orden del directorio">
          <button data-on={sort === 'relevance'} onClick={() => changeSort('relevance')}>Relevancia</button>
          <button data-on={sort === 'score'} onClick={() => changeSort('score')}>{selection.kind === 'registered' ? 'IPF' : 'IVO'}</button>
          <button data-on={sort === 'signals'} onClick={() => changeSort('signals')}>Señales</button>
          <button data-on={sort === 'name'} onClick={() => changeSort('name')}>Nombre</button>
        </div>
      </div>

      {activeRpc.error ? (
        <div className="subject-directory-statebar">
          <div>El directorio no pudo cargar esta cohorte. <button className="btn btn-sm" onClick={activeRpc.reload}>Reintentar</button></div>
        </div>
      ) : activeRpc.loading && !activeRpc.data ? (
        <div className="subject-directory-statebar">Leyendo la cohorte exacta…</div>
      ) : !rows.length ? (
        <div className="subject-directory-statebar">No hay entidades que coincidan con esta selección.</div>
      ) : selection.kind === 'registered' ? (
        <RegisteredTable rows={registered.data ?? []} />
      ) : (
        <PotentialTable rows={potentials.data ?? []} />
      )}

      <footer className="subject-directory-foot">
        <span><b>{n(start)}–{n(end)}</b> de <b>{n(total)}</b> entidades del corte seleccionado.</span>
        <div className="subject-directory-pages">
          <button disabled={page === 0 || activeRpc.loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>← Anterior</button>
          <span>{page + 1} / {totalPages}</span>
          <button disabled={page + 1 >= totalPages || activeRpc.loading} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>Siguiente →</button>
        </div>
        <span>{selection.kind === 'registered' ? 'IPF ordena revisión; no mide riesgo LA/FT.' : 'IVO ordena revisión registral; no acredita obligación ni incumplimiento.'}</span>
      </footer>
    </section>
  );
}

function RegisteredTable({ rows }: { rows: UafSubjectRow[] }) {
  return (
    <div className="subject-directory-scroll">
      <table className="subject-directory-table">
        <thead><tr>
          <th>Entidad</th><th>Sector UAF</th><th>Situación SII</th><th>Región</th><th>Marcas</th><th>IPF</th><th>Acciones</th>
        </tr></thead>
        <tbody>
          {rows.map((row) => {
            const manageable = needsRegisteredManagement(row);
            return (
              <tr key={row.rut}>
                <td className="subject-directory-entity">
                  <b>{titleCase(row.name)}</b>
                  <span>{rutFormat(row.rut)} · {row.main_activity ? titleCase(row.main_activity) : 'sin actividad principal observada'}</span>
                </td>
                <td>
                  <div className="subject-directory-main">{row.uaf_sector ? titleCase(row.uaf_sector) : '—'}</div>
                  {row.economic_sector && <span className="subject-directory-secondary">{titleCase(row.economic_sector)}</span>}
                </td>
                <td>
                  <span className="subject-directory-state" style={{ ['--state-tone' as string]: stateTone(row.sii_status) }}><i />{stateLabel(row.sii_status)}</span>
                  {row.sii_termination_date && <span className="subject-directory-secondary">Término {row.sii_termination_date.slice(0, 10)}</span>}
                </td>
                <td className="subject-directory-region">
                  <div className="subject-directory-main">{row.region ? titleCase(row.region) : 'Sin región observada'}</div>
                  {row.commune && <span className="subject-directory-secondary">{titleCase(row.commune)}</span>}
                </td>
                <td><RegisteredSignals row={row} /></td>
                <td className="subject-directory-score">
                  <b>{row.ipf_score == null ? '—' : n1(row.ipf_score)}</b>
                  <small>{row.ipf_band ? titleCase(row.ipf_band.replace(/_/g, ' ')) : 'sin banda'}</small>
                </td>
                <td>
                  <DirectoryActions
                    manageHref={manageable ? caseHref('termino', row.rut) : null}
                    entityHref={row.entity_id ? hrefFor({ view: 'ficha', entityId: row.entity_id }) : null}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PotentialTable({ rows }: { rows: PotentialDirectoryRow[] }) {
  return (
    <div className="subject-directory-scroll">
      <table className="subject-directory-table">
        <thead><tr>
          <th>Entidad</th><th>Sector sugerido</th><th>Industria / evidencia</th><th>Región</th><th>Caracterización</th><th>IVO</th><th>Acciones</th>
        </tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rut}>
              <td className="subject-directory-entity">
                <b>{titleCase(row.name)}</b>
                <span>{rutFormat(row.rut)} · {row.sales_band_size ?? row.sales_band_uf ?? 'escala no observada'}</span>
              </td>
              <td>
                <div className="subject-directory-main">{row.implied_sector ? titleCase(row.implied_sector) : 'sin sector sugerido'}</div>
                <span className="subject-directory-secondary">{row.detection_tier ?? row.evidence_class ?? 'conciliación por giro'}</span>
              </td>
              <td>
                <div className="subject-directory-main">{row.economic_sector ? titleCase(row.economic_sector) : 'sin industria SII observada'}</div>
                <span className="subject-directory-secondary">{row.matched_activity ? titleCase(row.matched_activity) : 'sin actividad gatillante'}</span>
              </td>
              <td className="subject-directory-region">
                <div className="subject-directory-main">{row.region ? titleCase(row.region) : 'Sin región observada'}</div>
                {row.commune && <span className="subject-directory-secondary">{titleCase(row.commune)}</span>}
              </td>
              <td><PotentialSignals row={row} /></td>
              <td className="subject-directory-score">
                <b>{row.ivo_score == null ? '—' : n1(row.ivo_score)}</b>
                <small>{row.ivo_band ? titleCase(row.ivo_band.replace(/_/g, ' ')) : 'sin banda'}</small>
              </td>
              <td>
                <DirectoryActions
                  manageHref={caseHref('potenciales', row.rut)}
                  entityHref={row.entity_id ? hrefFor({ view: 'ficha', entityId: row.entity_id }) : null}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DirectoryActions({
  manageHref,
  entityHref,
}: {
  manageHref: string | null;
  entityHref: string | null;
}) {
  if (!manageHref && !entityHref) return <span className="subject-directory-action-unavailable">—</span>;
  return (
    <div className="subject-directory-actions">
      {manageHref && <a className="subject-directory-manage" href={manageHref}>Gestionar</a>}
      {entityHref && <a className="subject-directory-open" href={entityHref}>Entidad 360 →</a>}
    </div>
  );
}

function RegisteredSignals({ row }: { row: UafSubjectRow }) {
  const signals = row.sanction_evidence_count + row.press_evidence_count + row.alert_count;
  if (!signals && !row.is_osfl && !row.attention_motive) return <span className="subject-directory-secondary">sin marca en estos cruces</span>;
  return (
    <div className="subject-directory-signals">
      {row.sanction_evidence_count > 0 && <span className="subject-directory-signal" data-kind="sanction">Sanción · {n(row.sanction_evidence_count)}</span>}
      {row.press_evidence_count > 0 && <span className="subject-directory-signal" data-kind="press">Prensa · {n(row.press_evidence_count)}</span>}
      {row.is_osfl && <span className="subject-directory-signal" data-kind="osfl">OSFL</span>}
      {row.attention_motive && (
        <span
          className="subject-directory-signal"
          data-kind="attention"
          title={`Motivo de atención: ${attentionLabel(row.attention_motive)}`}
        >
          {attentionLabel(row.attention_motive)}
        </span>
      )}
    </div>
  );
}

function attentionLabel(motive: string) {
  const labels: Record<string, string> = {
    GIRO_ATIPICO: 'Giro atípico',
    TERMINO_GIRO: 'Término de giro',
    IPF_ALTA: 'IPF alto',
    SANCION_HISTORICA: 'Sanción histórica',
    SANCION_RECIENTE: 'Sanción reciente',
    SECTOR_SIN_ROS: 'Sector sin ROS',
    SIN_TERRITORIO: 'Sin territorio',
  };
  return labels[motive] ?? titleCase(motive.replace(/_/g, ' '));
}

function PotentialSignals({ row }: { row: PotentialDirectoryRow }) {
  const flags = row.flags ?? [];
  return (
    <div className="subject-directory-signals">
      <span className="subject-directory-signal" data-kind="potential">Potencial SO</span>
      {row.res_available && <span className="subject-directory-signal">RES</span>}
      {row.uaf_sanction_events > 0 && <span className="subject-directory-signal" data-kind="sanction">Sanción · {n(row.uaf_sanction_events)}</span>}
      {flags.slice(0, 2).map((flag) => <span className="subject-directory-signal" key={flag}>{titleCase(flag.replace(/_/g, ' '))}</span>)}
    </div>
  );
}

function needsRegisteredManagement(row: UafSubjectRow) {
  return row.sii_status === 'TERMINATED_AS_PUBLISHED' || Boolean(row.sii_termination_date);
}

function caseHref(queue: 'potenciales' | 'termino', rut: string) {
  return `#/universo-so?vista=casos&cola=${queue}&q=${encodeURIComponent(rut)}`;
}

function stateLabel(status: string | null) {
  if (status === 'ACTIVE_AS_PUBLISHED') return 'Activo ante el SII';
  if (status === 'TERMINATED_AS_PUBLISHED') return 'Término de giro';
  if (status === 'SIN_PERFIL_SII') return 'Sin perfil SII';
  return 'Estado no observado';
}

function stateTone(status: string | null) {
  if (status === 'ACTIVE_AS_PUBLISHED') return 'var(--present)';
  if (status === 'TERMINATED_AS_PUBLISHED') return 'var(--sig-high)';
  return 'var(--unknown)';
}
