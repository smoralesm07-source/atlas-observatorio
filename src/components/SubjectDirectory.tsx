import { useEffect, useMemo, useState } from 'react';
import type { CohortRequest } from './CohortDrawer';
import type { UafPotential, UafPotentialCandidate, UafSubjectRow } from '../lib/contracts';
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
    };

type SortMode = 'relevance' | 'name' | 'score' | 'signals';

const PAGE = 80;
const DEFAULT_REQUEST: CohortRequest = {
  cohort: 'TODOS',
  title: 'Padrón completo de sujetos obligados',
};

export function SubjectDirectory({
  id,
  selection,
  potential,
  onReset,
}: {
  id?: string;
  selection: DirectorySelection;
  potential?: UafPotential | null;
  onReset?: () => void;
}) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 220);
  const [sort, setSort] = useState<SortMode>('relevance');
  const [page, setPage] = useState(0);
  const request = selection.kind === 'registered' ? selection.request : DEFAULT_REQUEST;
  const registeredSelectionKey = selection.kind === 'registered'
    ? `${selection.request.cohort}|${selection.request.value ?? ''}|${selection.clientSector ?? ''}|${selection.clientRegion ?? ''}|${selection.clientIndustry ?? ''}`
    : 'potential';

  useEffect(() => setPage(0), [registeredSelectionKey]);

  const cohort = useRpc<UafSubjectRow[]>('obs_uaf_subject_directory_v2', {
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

  const potentialRows = useMemo(() => {
    if (selection.kind !== 'potential') return [];
    const q = debouncedQuery.trim().toLowerCase();
    const rows = (potential?.candidatos ?? []).filter((row) => {
      if (selection.sector && row.implied_sector !== selection.sector) return false;
      if (selection.region && row.region !== selection.region) return false;
      if (selection.activity && row.matched_activity !== selection.activity) return false;
      if (!q) return true;
      return [row.name, row.rut, row.implied_sector, row.region, row.commune, row.matched_activity]
        .some((value) => (value ?? '').toLowerCase().includes(q));
    });
    return sortPotential(rows, sort);
  }, [selection, potential, debouncedQuery, sort]);

  const registeredRows = selection.kind === 'registered' ? cohort.data ?? [] : [];
  const registeredTotal = registeredRows[0]?.total_count ?? 0;
  const visibleTotal = selection.kind === 'registered' ? registeredTotal : potentialRows.length;
  const totalPages = selection.kind === 'registered' ? Math.max(1, Math.ceil(registeredTotal / PAGE)) : 1;
  const start = selection.kind === 'registered' && registeredTotal > 0 ? page * PAGE + 1 : potentialRows.length ? 1 : 0;
  const end = selection.kind === 'registered' ? Math.min(registeredTotal, (page + 1) * PAGE) : potentialRows.length;
  const title = selection.kind === 'registered' ? selection.request.title : selection.title;
  const hint = selection.kind === 'registered' ? selection.request.hint : selection.hint;
  const clientFilter = selection.kind === 'registered'
    ? [selection.clientSector, selection.clientRegion, selection.clientIndustry].filter(Boolean).join(' · ')
    : [selection.sector, selection.region, selection.activity].filter(Boolean).join(' · ');

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
          {selection.kind === 'registered' && cohort.loading && !cohort.data ? '…' : n(visibleTotal)}
          <small>{selection.kind === 'registered' ? 'sujetos en la cohorte exacta' : 'candidatos coincidentes'}</small>
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
            placeholder="Buscar por nombre, RUT, sector, actividad o territorio…"
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

      {selection.kind === 'registered' ? (
        cohort.error ? (
          <div className="subject-directory-statebar">
            <div>El directorio no pudo cargar esta cohorte. <button className="btn btn-sm" onClick={cohort.reload}>Reintentar</button></div>
          </div>
        ) : cohort.loading && !cohort.data ? (
          <div className="subject-directory-statebar">Leyendo la cohorte exacta del padrón…</div>
        ) : !registeredRows.length ? (
          <div className="subject-directory-statebar">No hay sujetos que coincidan con esta selección.</div>
        ) : (
          <RegisteredTable rows={registeredRows} />
        )
      ) : !potentialRows.length ? (
        <div className="subject-directory-statebar">No hay potenciales sujetos obligados que coincidan con esta selección.</div>
      ) : (
        <PotentialTable rows={potentialRows} />
      )}

      <footer className="subject-directory-foot">
        <span>
          {selection.kind === 'registered'
            ? <><b>{n(start)}–{n(end)}</b> de <b>{n(registeredTotal)}</b> sujetos del corte seleccionado.</>
            : <><b>{n(potentialRows.length)}</b> candidatos del corte de conciliación SII ↔ UAF.</>}
        </span>
        {selection.kind === 'registered' ? (
          <div className="subject-directory-pages">
            <button disabled={page === 0 || cohort.loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>← Anterior</button>
            <span>{page + 1} / {totalPages}</span>
            <button disabled={page + 1 >= totalPages || cohort.loading} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>Siguiente →</button>
          </div>
        ) : <span>IVO ordena revisión registral; no acredita obligación ni incumplimiento.</span>}
      </footer>
    </section>
  );
}

function RegisteredTable({ rows }: { rows: UafSubjectRow[] }) {
  return (
    <div className="subject-directory-scroll">
      <table className="subject-directory-table">
        <thead><tr>
          <th>Entidad</th><th>Sector UAF</th><th>Situación / territorio</th><th>Marcas</th><th>IPF</th><th />
        </tr></thead>
        <tbody>
          {rows.map((row) => (
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
                <span className="subject-directory-secondary">{row.commune ? `${titleCase(row.commune)} · ${titleCase(row.region)}` : row.region ? titleCase(row.region) : 'sin territorio observado'}</span>
              </td>
              <td><RegisteredSignals row={row} /></td>
              <td className="subject-directory-score">
                <b>{row.ipf_score == null ? '—' : n1(row.ipf_score)}</b>
                <small>{row.ipf_band ? titleCase(row.ipf_band.replace(/_/g, ' ')) : 'sin banda'}</small>
              </td>
              <td>{row.entity_id && <a className="subject-directory-open" href={hrefFor({ view: 'ficha', entityId: row.entity_id })}>360 →</a>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PotentialTable({ rows }: { rows: UafPotentialCandidate[] }) {
  return (
    <div className="subject-directory-scroll">
      <table className="subject-directory-table">
        <thead><tr>
          <th>Entidad</th><th>Sector sugerido</th><th>Evidencia / territorio</th><th>Caracterización</th><th>IVO</th><th />
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
                <div className="subject-directory-main">{row.matched_activity ? titleCase(row.matched_activity) : 'sin actividad gatillante'}</div>
                <span className="subject-directory-secondary">{row.commune ? `${titleCase(row.commune)} · ${titleCase(row.region)}` : row.region ? titleCase(row.region) : 'sin territorio observado'}</span>
              </td>
              <td><PotentialSignals row={row} /></td>
              <td className="subject-directory-score">
                <b>{row.ivo_score == null ? '—' : n1(row.ivo_score)}</b>
                <small>{row.ivo_band ? titleCase(row.ivo_band.replace(/_/g, ' ')) : 'sin banda'}</small>
              </td>
              <td>{row.entity_id && <a className="subject-directory-open" href={hrefFor({ view: 'ficha', entityId: row.entity_id })}>360 →</a>}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
      {row.attention_motive && <span className="subject-directory-signal" data-kind="attention">Revisión</span>}
    </div>
  );
}

function PotentialSignals({ row }: { row: UafPotentialCandidate }) {
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

function sortPotential(rows: UafPotentialCandidate[], sort: SortMode) {
  const copy = rows.slice();
  if (sort === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (sort === 'score') return copy.sort((a, b) => (b.ivo_score ?? -1) - (a.ivo_score ?? -1));
  if (sort === 'signals') return copy.sort((a, b) => potentialSignalCount(b) - potentialSignalCount(a));
  return copy;
}

function potentialSignalCount(row: UafPotentialCandidate) {
  return row.uaf_sanction_events + (row.flags?.length ?? 0) + (row.res_available ? 1 : 0);
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
