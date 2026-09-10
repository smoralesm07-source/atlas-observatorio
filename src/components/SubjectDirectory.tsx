import { useMemo, useState } from 'react';
import type { CohortRequest } from './CohortDrawer';
import type { UafPotential, UafPotentialCandidate, UafSubjectRow } from '../lib/contracts';
import { useRpc } from '../lib/rpc';
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
  const [sort, setSort] = useState<SortMode>('relevance');
  const request = selection.kind === 'registered' ? selection.request : DEFAULT_REQUEST;
  const cohort = useRpc<UafSubjectRow[]>('obs_uaf_cohort', {
    p_cohort: request.cohort,
    p_value: request.value ?? null,
    p_limit: 500,
    p_offset: 0,
  }, { skip: selection.kind !== 'registered' });

  const registeredRows = useMemo(() => {
    if (selection.kind !== 'registered') return [];
    const q = query.trim().toLowerCase();
    const rows = (cohort.data ?? []).filter((row) => {
      if (selection.clientSector && row.uaf_sector !== selection.clientSector) return false;
      if (selection.clientRegion && row.region !== selection.clientRegion) return false;
      if (selection.clientIndustry && row.economic_sector !== selection.clientIndustry) return false;
      if (!q) return true;
      return [row.name, row.rut, row.uaf_sector, row.region, row.commune, row.main_activity, row.economic_sector]
        .some((value) => (value ?? '').toLowerCase().includes(q));
    });
    return sortRegistered(rows, sort);
  }, [selection, cohort.data, query, sort]);

  const potentialRows = useMemo(() => {
    if (selection.kind !== 'potential') return [];
    const q = query.trim().toLowerCase();
    const rows = (potential?.candidatos ?? []).filter((row) => {
      if (selection.sector && row.implied_sector !== selection.sector) return false;
      if (selection.region && row.region !== selection.region) return false;
      if (selection.activity && row.matched_activity !== selection.activity) return false;
      if (!q) return true;
      return [row.name, row.rut, row.implied_sector, row.region, row.commune, row.matched_activity]
        .some((value) => (value ?? '').toLowerCase().includes(q));
    });
    return sortPotential(rows, sort);
  }, [selection, potential, query, sort]);

  const baseTotal = selection.kind === 'registered'
    ? cohort.data?.[0]?.total_count ?? 0
    : potentialRows.length;
  const visibleTotal = selection.kind === 'registered' ? registeredRows.length : potentialRows.length;
  const title = selection.kind === 'registered' ? selection.request.title : selection.title;
  const hint = selection.kind === 'registered' ? selection.request.hint : selection.hint;
  const clientFilter = selection.kind === 'registered'
    ? [selection.clientSector, selection.clientRegion, selection.clientIndustry].filter(Boolean).join(' · ')
    : [selection.sector, selection.region, selection.activity].filter(Boolean).join(' · ');

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
          <small>{selection.kind === 'registered' ? `en pantalla · corte ${n(baseTotal)}` : 'candidatos coincidentes'}</small>
        </div>
      </header>

      <div className="subject-directory-context">
        <span>{selection.kind === 'registered' ? 'Padrón inscrito' : 'Potenciales SO'}</span>
        <span>{title}</span>
        {clientFilter && <span>{clientFilter}</span>}
        {onReset && <button className="subject-directory-reset" onClick={onReset}>Restablecer directorio</button>}
      </div>

      <div className="subject-directory-tools">
        <label className="subject-directory-search">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filtrar lo cargado por nombre, RUT, sector, actividad o territorio…"
            aria-label="Filtrar directorio"
          />
          {query && <button onClick={() => setQuery('')} aria-label="Limpiar búsqueda">×</button>}
        </label>
        <div className="subject-directory-sort" aria-label="Orden del directorio">
          <button data-on={sort === 'relevance'} onClick={() => setSort('relevance')}>Relevancia</button>
          <button data-on={sort === 'score'} onClick={() => setSort('score')}>{selection.kind === 'registered' ? 'IPF' : 'IVO'}</button>
          <button data-on={sort === 'signals'} onClick={() => setSort('signals')}>Señales</button>
          <button data-on={sort === 'name'} onClick={() => setSort('name')}>Nombre</button>
        </div>
      </div>

      {selection.kind === 'registered' ? (
        cohort.error ? (
          <div className="subject-directory-statebar">
            <div>El directorio no pudo cargar esta cohorte. <button className="btn btn-sm" onClick={cohort.reload}>Reintentar</button></div>
          </div>
        ) : cohort.loading && !cohort.data ? (
          <div className="subject-directory-statebar">Leyendo sujetos del padrón…</div>
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
            ? <><b>{n(visibleTotal)}</b> filas visibles. El RPC entrega hasta 500 para esta vista; afina con los gráficos para cohortes más precisas.</>
            : <><b>{n(visibleTotal)}</b> candidatos del corte de conciliación SII ↔ UAF.</>}
        </span>
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

function sortRegistered(rows: UafSubjectRow[], sort: SortMode) {
  const copy = rows.slice();
  if (sort === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (sort === 'score') return copy.sort((a, b) => (b.ipf_score ?? -1) - (a.ipf_score ?? -1));
  if (sort === 'signals') return copy.sort((a, b) => registeredSignalCount(b) - registeredSignalCount(a));
  return copy;
}

function sortPotential(rows: UafPotentialCandidate[], sort: SortMode) {
  const copy = rows.slice();
  if (sort === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (sort === 'score') return copy.sort((a, b) => (b.ivo_score ?? -1) - (a.ivo_score ?? -1));
  if (sort === 'signals') return copy.sort((a, b) => potentialSignalCount(b) - potentialSignalCount(a));
  return copy;
}

function registeredSignalCount(row: UafSubjectRow) {
  return row.sanction_evidence_count + row.press_evidence_count + row.alert_count + (row.is_osfl ? 1 : 0) + (row.attention_motive ? 1 : 0);
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
