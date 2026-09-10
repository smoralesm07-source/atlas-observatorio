import { useMemo, useState, type ReactNode } from 'react';
import type { CohortRequest } from '../../components/CohortDrawer';
import { SubjectDirectory, type DirectorySelection } from '../../components/SubjectDirectory';
import type { UafPotential, UafPotentialCandidate, UafPulse } from '../../lib/contracts';
import { useRpc } from '../../lib/rpc';
import { hrefFor } from '../../lib/router';
import { n, n1, titleCase } from '../../lib/format';
import { QuienSostieneReportabilidad } from '../pulso/Reportabilidad';
import '../../styles/universo-so-v2.css';

export type WorkFocus = { kind: 'POTENCIAL' | 'TERMINO'; sector?: string | null };

type RegistryTrendPoint = { year: number; subjects: number };
type RegistryTrend = {
  sector: string;
  delta: number;
  first_value: number;
  last_value: number;
  points: RegistryTrendPoint[];
};
type RegistryEvolution = {
  increases: RegistryTrend[];
  decreases: RegistryTrend[];
  note: string;
};
type PotentialIndustryRow = { industry: string; n: number; ivo_medio: number | null };
type TermMode = 'sector' | 'region' | 'industry';
type PotentialMode = 'sector' | 'region' | 'industry' | 'activity';
type EdgeRow = { key: string; label: string; value: number; sub?: string };

const ALL: CohortRequest = { cohort: 'TODOS', title: 'Padrón completo de sujetos obligados' };

export function PadronAxisV2({
  pulse,
  potential,
  onNavigate,
  onWork,
}: {
  pulse: UafPulse;
  potential: UafPotential | null;
  onNavigate: (hash: string) => void;
  onWork: (focus: WorkFocus) => void;
}) {
  const [directory, setDirectory] = useState<DirectorySelection>({ kind: 'registered', request: ALL });
  const [termMode, setTermMode] = useState<TermMode>('sector');
  const [potentialMode, setPotentialMode] = useState<PotentialMode>('sector');
  const evolution = useRpc<RegistryEvolution>('obs_uaf_registry_evolution', {});
  const potentialIndustry = useRpc<PotentialIndustryRow[]>('obs_uaf_potential_industry_mix', {});

  const u = pulse.universe;
  const cross = pulse.crosscuts;
  if (!u) return null;

  const topSectors = pulse.by_sector.slice().sort((a, b) => b.sujetos - a.sujetos).slice(0, 10);
  const regions = pulse.by_region.slice().sort((a, b) => b.sujetos - a.sujetos);
  const maxSector = Math.max(1, ...topSectors.map((row) => row.sujetos));
  const maxRegion = Math.max(1, ...regions.map((row) => row.sujetos));
  const potentialDetected = potential?.totales?.detectados ?? potential?.totales?.observadas ?? 0;
  const potentialSample = potential?.totales?.muestra_gestion ?? potential?.totales?.accionables ?? 0;

  const termRows = useMemo<EdgeRow[]>(() => {
    if (termMode === 'region') {
      return pulse.by_region
        .filter((row) => row.terminados > 0)
        .sort((a, b) => b.terminados - a.terminados)
        .map((row) => ({ key: row.region, label: titleCase(row.region), value: row.terminados, sub: `${n(row.sujetos)} SO inscritos` }))
        .slice(0, 8);
    }
    if (termMode === 'industry') {
      return pulse.by_industry
        .filter((row) => row.terminados > 0)
        .sort((a, b) => b.terminados - a.terminados)
        .map((row) => ({ key: row.industria, label: titleCase(row.industria), value: row.terminados, sub: `${n(row.sujetos)} SO en la industria` }))
        .slice(0, 8);
    }
    return pulse.by_sector
      .filter((row) => row.terminados > 0)
      .sort((a, b) => b.terminados - a.terminados)
      .map((row) => ({ key: row.sector, label: titleCase(row.sector), value: row.terminados, sub: `${n1(percent(row.terminados, row.sujetos))}% del sector` }))
      .slice(0, 8);
  }, [pulse.by_industry, pulse.by_region, pulse.by_sector, termMode]);

  const activityMix = useMemo(() => aggregatePotentialActivities(potential?.candidatos ?? []), [potential]);
  const potentialRows = useMemo<EdgeRow[]>(() => {
    if (potentialMode === 'region') {
      return (potential?.mix.region ?? [])
        .slice()
        .sort((a, b) => b.n - a.n)
        .map((row) => ({ key: row.region, label: titleCase(row.region), value: row.n, sub: row.ivo_medio == null ? undefined : `IVO medio ${n1(row.ivo_medio)}` }))
        .slice(0, 8);
    }
    if (potentialMode === 'industry') {
      return (potentialIndustry.data ?? [])
        .slice()
        .sort((a, b) => b.n - a.n)
        .map((row) => ({ key: row.industry, label: titleCase(row.industry), value: row.n, sub: row.ivo_medio == null ? undefined : `IVO medio ${n1(row.ivo_medio)}` }))
        .slice(0, 8);
    }
    if (potentialMode === 'activity') return activityMix.slice(0, 8);
    return (potential?.sectores ?? [])
      .slice()
      .sort((a, b) => b.accionables - a.accionables)
      .map((row) => ({ key: row.sector, label: titleCase(row.sector), value: row.accionables, sub: row.ivo_medio == null ? undefined : `IVO medio ${n1(row.ivo_medio)}` }))
      .slice(0, 8);
  }, [activityMix, potential, potentialIndustry.data, potentialMode]);

  const reportingRows = pulse.reporting?.sectores ?? [];
  const withoutRepresentatives = reportingRows.filter((row) => row.sector_canonical == null);
  const silentSectors = reportingRows.filter((row) => row.sector_canonical && row.silence_5y === true);
  const lowIntensity = reportingRows
    .filter((row) => row.sector_canonical && row.ros_per_100_so_2025 != null)
    .slice()
    .sort((a, b) => (a.ros_per_100_so_2025 ?? Infinity) - (b.ros_per_100_so_2025 ?? Infinity))
    .slice(0, 7);

  const focusDirectory = (selection: DirectorySelection) => {
    setDirectory(selection);
    window.setTimeout(() => document.getElementById('universo-directorio')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20);
  };

  const selectRegistered = (
    request: CohortRequest,
    client?: Pick<Extract<DirectorySelection, { kind: 'registered' }>, 'clientSector' | 'clientRegion' | 'clientIndustry'>,
  ) => focusDirectory({ kind: 'registered', request, ...client });

  const termPick = (row: EdgeRow) => {
    const request: CohortRequest = { cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro', hint: row.label };
    if (termMode === 'sector') selectRegistered(request, { clientSector: row.key });
    else if (termMode === 'region') selectRegistered(request, { clientRegion: row.key });
    else selectRegistered(request, { clientIndustry: row.key });
  };

  const potentialPick = (row: EdgeRow) => {
    if (potentialMode === 'sector') focusDirectory({ kind: 'potential', title: `Potenciales SO · ${row.label}`, sector: row.key });
    else if (potentialMode === 'region') focusDirectory({ kind: 'potential', title: `Potenciales SO · ${row.label}`, region: row.key });
    else if (potentialMode === 'industry') focusDirectory({ kind: 'potential', title: `Potenciales SO · ${row.label}`, industry: row.key });
    else focusDirectory({ kind: 'potential', title: `Potenciales SO · ${row.label}`, activity: row.key });
  };

  return (
    <div className="uso2 fade-in">
      <section className="uso2-kpis" aria-label="Cifras ancla de Universo SO">
        <Kpi label="Padrón inscrito" value={u.total} hint={`${n(u.sectores_uaf)} sectores · ${n(u.regiones)} regiones`} tone="var(--accent)" onClick={() => selectRegistered(ALL)} />
        <Kpi label="Activos ante el SII" value={u.activos} hint={`${n1(percent(u.activos, u.total))}% del padrón`} tone="var(--present)" onClick={() => selectRegistered({ cohort: 'ACTIVO', title: 'Sujetos activos ante el SII' })} />
        <Kpi label="Término de giro" value={u.terminados} hint="siguen inscritos y requieren conciliación registral" tone="var(--sig-high)" onClick={() => selectRegistered({ cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro' })} />
        <Kpi label="Potenciales detectados" value={potentialDetected} hint={`Gestión SO prioriza ${n(potentialSample)} casos`} tone="var(--unknown)" onClick={() => focusDirectory({ kind: 'potential', title: 'Muestra priorizada de potenciales SO', hint: `${n(potentialSample)} casos seleccionados desde ${n(potentialDetected)} RUT detectados` })} />
        <Kpi label="Piden revisión" value={u.en_atencion} hint={`${n(dataMotiveCount(pulse))} motivos de precedencia`} tone="var(--sig-critical)" onClick={() => selectRegistered({ cohort: 'ATENCION', title: 'Sujetos que piden revisión' })} />
      </section>

      <section className="uso2-overview">
        <Block title="Principales sectores que conforman el padrón" hint="Top 10 por número de sujetos. Cada barra filtra el directorio final.">
          <div className="uso2-ranks">
            {topSectors.map((row) => (
              <Rank key={row.sector} label={titleCase(row.sector)} value={row.sujetos} max={maxSector}
                onClick={() => selectRegistered({ cohort: 'SECTOR', value: row.sector, title: titleCase(row.sector) })}
                sub={`${n(row.terminados)} término · ${n(row.sancionados)} con sanción · ${n(row.en_atencion)} revisión`} />
            ))}
          </div>
        </Block>

        <Block title="Distribución territorial del padrón" hint="Todas las regiones observadas. El IGR sigue siendo contexto territorial, no atributo de riesgo del sujeto."
          action={<button className="btn btn-sm" onClick={() => onNavigate(hrefFor({ view: 'territorio' }))}>Territorio →</button>}>
          <div className="uso2-region-list">
            <div className="uso2-ranks">
              {regions.map((row) => (
                <Rank key={row.region} label={titleCase(row.region)} value={row.sujetos} max={maxRegion}
                  onClick={() => selectRegistered({ cohort: 'REGION', value: row.region, title: `Sujetos obligados en ${titleCase(row.region)}` })}
                  sub={`${n(row.terminados)} término · ${n(row.sancionados)} sanción · ${n(row.en_atencion)} revisión`} />
              ))}
            </div>
          </div>
        </Block>

        <Block title="Cruces que ayudan a caracterizar" hint="Preguntas de una sola selección sobre el padrón vigente.">
          <div className="uso2-mark-grid">
            <Mark label="También OSFL" value={cross?.osfl ?? 0} tone="var(--unknown)" hint={`${n1(percent(cross?.osfl ?? 0, u.total))}% del padrón`} onClick={() => selectRegistered({ cohort: 'OSFL', title: 'Sujetos obligados que además son OSFL' })} />
            <Mark label="Con sanción" value={cross?.sancionados_con_antecedente ?? 0} tone="var(--sig-critical)" hint={`${n(cross?.antecedentes_sancion)} antecedentes`} onClick={() => selectRegistered({ cohort: 'SANCIONADO', title: 'Sujetos con antecedente sancionatorio' })} />
            <Mark label="Con prensa" value={cross?.prensa ?? 0} tone="var(--sig-watch)" hint={`${n(cross?.antecedentes_prensa)} menciones`} onClick={() => selectRegistered({ cohort: 'PRENSA', title: 'Sujetos que figuran en prensa' })} />
            <Mark label="Sin territorio" value={Math.max(0, u.total - u.con_territorio)} tone="var(--ink-3)" hint="requieren completar ubicación" onClick={() => selectRegistered({ cohort: 'SIN_TERRITORIO', title: 'Sujetos sin territorio observado' })} />
          </div>
          <div className="uso2-questions">
            <button onClick={() => selectRegistered({ cohort: 'SECTOR_SIN_ROS', title: 'Sujetos en sectores sin ROS 2021-2025' })}>¿Quiénes están en sectores sin ROS?</button>
            <button onClick={() => selectRegistered({ cohort: 'IPF_ALTO', title: 'Sujetos con IPF alta o muy alta' })}>¿Quiénes concentran prioridad?</button>
            <button onClick={() => selectRegistered({ cohort: 'GIRO_ATIPICO', title: 'Sujetos con giro atípico en su sector' })}>¿Qué giros son atípicos?</button>
          </div>
        </Block>
      </section>

      <section className="uso2-edge-grid">
        <Block title="Términos de giro: dónde se concentran" hint="Mira el mismo grupo por sector obligado, región o industria SII. La selección baja al directorio de términos de giro."
          action={<ModeButtons<TermMode> value={termMode} onChange={setTermMode} options={[['sector', 'Sector'], ['region', 'Región'], ['industry', 'Industria']]} />}>
          <EdgeList rows={termRows} tone="var(--sig-high)" onPick={termPick} />
          <p className="uso2-edge-note">Hay {n(u.terminados)} inscritos con término de giro. El término tributario no equivale por sí solo a baja del padrón UAF.</p>
          <div className="uso2-questions"><button onClick={() => onWork({ kind: 'TERMINO' })}>Gestionar términos de giro →</button></div>
        </Block>

        <Block title="Potenciales SO: composición de la brecha" hint="Explora candidatos por sector sugerido, región, industria tributaria o actividad gatillante publicada en el SII."
          action={<ModeButtons<PotentialMode> value={potentialMode} onChange={setPotentialMode} options={[['sector', 'Sector'], ['region', 'Región'], ['industry', 'Industria'], ['activity', 'Actividad']]} />}>
          {potentialMode === 'industry' && potentialIndustry.loading && !potentialIndustry.data
            ? <div className="uso2-edge-note">Leyendo industrias tributarias…</div>
            : <EdgeList rows={potentialRows} tone="var(--unknown)" onPick={potentialPick} />}
          <p className="uso2-edge-note">{n(potentialDetected)} RUT detectados por screening. Gestión SO trabaja una muestra operativa de {n(potentialSample)} casos; la selección no acredita obligación ni incumplimiento.</p>
          <div className="uso2-questions"><button onClick={() => onWork({ kind: 'POTENCIAL' })}>Gestionar muestra priorizada →</button></div>
        </Block>
      </section>

      <section className="uso2-report-grid">
        <QuienSostieneReportabilidad data={pulse} onCohort={(request) => selectRegistered(request)} compact />
        <Block title="Brechas estructurales de cobertura y reportabilidad" hint="Sectores sin representantes y sectores de menor intensidad reportante. La intensidad usa ROS 2025 por cada 100 inscritos del corte estadístico.">
          <div className="uso2-structural-summary">
            <div><b>{n(withoutRepresentatives.length)}</b><span>sectores sin representantes inscritos</span></div>
            <div><b>{n(silentSectors.length)}</b><span>sectores con inscritos y cero ROS en 5 años</span></div>
            <div><b>{n(pulse.reporting?.totales?.sujetos_en_silencio)}</b><span>SO ubicados en sectores silenciosos</span></div>
          </div>
          <div className="uso2-gap-list">
            {lowIntensity.map((row) => (
              <button className="uso2-gap-row" key={row.sector_official} onClick={() => row.sector_canonical && selectRegistered({ cohort: 'SECTOR', value: row.sector_canonical, title: titleCase(row.etiqueta) })}>
                <span>{titleCase(row.etiqueta)}</span><b>{row.ros_per_100_so_2025 == null ? '—' : `${n1(row.ros_per_100_so_2025)} ROS/100`}</b>
              </button>
            ))}
            {withoutRepresentatives.slice(0, 4).map((row) => (
              <button className="uso2-gap-row" key={`empty-${row.sector_official}`} disabled>
                <span>{titleCase(row.etiqueta)}</span><b>sin inscritos</b>
              </button>
            ))}
          </div>
        </Block>
      </section>

      <section className="uso2-trend-grid">
        <TrendBlock title="Sectores que más aumentaron" hint="Variación neta en los últimos cinco cortes anuales publicados, 2022–2026" rows={evolution.data?.increases ?? []} loading={evolution.loading} tone="var(--present)" onPick={(row) => selectRegistered({ cohort: 'SECTOR', value: row.sector, title: titleCase(row.sector) })} />
        <TrendBlock title="Sectores con mayor contracción" hint="Menor stock inscrito entre los últimos cinco cortes comparables, 2022–2026" rows={evolution.data?.decreases ?? []} loading={evolution.loading} tone="var(--sig-high)" note={evolution.data?.note} onPick={(row) => selectRegistered({ cohort: 'SECTOR', value: row.sector, title: titleCase(row.sector) })} />
      </section>

      <div className="uso2-directory-anchor">
        <SubjectDirectory
          id="universo-directorio"
          selection={directory}
          onReset={() => setDirectory({ kind: 'registered', request: ALL })}
        />
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, tone, onClick }: { label: string; value: number; hint: string; tone: string; onClick: () => void }) {
  return <button className="uso2-kpi" style={{ ['--uso2-tone' as string]: tone }} onClick={onClick}><span>{label}</span><b>{n(value)}</b><em>{hint}</em></button>;
}

function Block({ title, hint, action, children }: { title: string; hint: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="uso2-section">
      <header className="uso2-section-head"><div><h3>{title}</h3><p>{hint}</p></div>{action}</header>
      <div className="uso2-body">{children}</div>
    </section>
  );
}

function Rank({ label, value, max, sub, onClick }: { label: string; value: number; max: number; sub?: string; onClick: () => void }) {
  return (
    <button className="uso2-rank" onClick={onClick} title={label}>
      <span className="uso2-rank-name">{label}</span><span className="uso2-rank-track"><i style={{ width: `${(value / Math.max(1, max)) * 100}%` }} /></span><span className="uso2-rank-value">{n(value)}</span>
      {sub && <small>{sub}</small>}
    </button>
  );
}

function Mark({ label, value, hint, tone, onClick }: { label: string; value: number; hint: string; tone: string; onClick: () => void }) {
  return <button className="uso2-mark" style={{ ['--mark-tone' as string]: tone }} onClick={onClick}><b>{n(value)}</b><span>{label}</span><em>{hint}</em></button>;
}

function ModeButtons<T extends string>({ value, onChange, options }: { value: T; onChange: (value: T) => void; options: [T, string][] }) {
  return <div className="seg seg-sm">{options.map(([key, label]) => <button key={key} data-on={value === key} onClick={() => onChange(key)}>{label}</button>)}</div>;
}

function EdgeList({ rows, tone, onPick }: { rows: EdgeRow[]; tone: string; onPick: (row: EdgeRow) => void }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) return <div className="uso2-edge-note">Sin datos suficientes para esta lectura.</div>;
  return (
    <div className="uso2-edge-list">
      {rows.map((row) => (
        <button className="uso2-edge-row" key={row.key} style={{ ['--edge-tone' as string]: tone }} onClick={() => onPick(row)} title={row.sub}>
          <b>{row.label}</b><span className="uso2-edge-track"><i style={{ width: `${(row.value / max) * 100}%` }} /></span><span>{n(row.value)}</span>
        </button>
      ))}
    </div>
  );
}

function TrendBlock({ title, hint, rows, loading, tone, onPick, note }: { title: string; hint: string; rows: RegistryTrend[]; loading: boolean; tone: string; onPick: (row: RegistryTrend) => void; note?: string }) {
  return (
    <Block title={title} hint={hint}>
      {loading && !rows.length ? <div className="uso2-edge-note">Calculando variación sectorial…</div> : (
        <div className="uso2-trend-list">
          {rows.slice(0, 5).map((row) => (
            <button className="uso2-trend-row" key={row.sector} style={{ ['--trend-tone' as string]: tone }} onClick={() => onPick(row)}>
              <span className="uso2-trend-name"><b>{titleCase(row.sector)}</b><span>{n(row.first_value)} → {n(row.last_value)} SO</span></span>
              <Sparkline points={row.points} />
              <span className="uso2-trend-delta">{row.delta > 0 ? '+' : ''}{n(row.delta)}<small>SO netos</small></span>
            </button>
          ))}
        </div>
      )}
      <p className="uso2-edge-note">{note ?? 'Comparación sobre sectores con serie publicada comparable. La variación es cambio de stock, no identificación individual de altas o bajas.'}</p>
    </Block>
  );
}

function Sparkline({ points }: { points: RegistryTrendPoint[] }) {
  const width = 150;
  const height = 28;
  const pad = 2;
  const values = points.map((point) => point.subjects);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const x = (index: number) => pad + index * ((width - pad * 2) / Math.max(1, points.length - 1));
  const y = (value: number) => pad + (height - pad * 2) * (1 - (value - min) / span);
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(point.subjects).toFixed(1)}`).join(' ');
  return <svg className="uso2-spark" viewBox={`0 0 ${width} ${height}`} aria-hidden><path d={path} />{points.map((point, index) => <circle key={point.year} cx={x(index)} cy={y(point.subjects)} r={index === points.length - 1 ? 2.1 : 1.3} />)}</svg>;
}

function aggregatePotentialActivities(rows: UafPotentialCandidate[]): EdgeRow[] {
  const counts = new Map<string, { n: number; ivo: number; ivoN: number }>();
  for (const row of rows) {
    const key = row.matched_activity?.trim();
    if (!key) continue;
    const current = counts.get(key) ?? { n: 0, ivo: 0, ivoN: 0 };
    current.n += 1;
    if (row.ivo_score != null) { current.ivo += row.ivo_score; current.ivoN += 1; }
    counts.set(key, current);
  }
  return [...counts.entries()]
    .map(([key, value]) => ({ key, label: titleCase(key), value: value.n, sub: value.ivoN ? `IVO medio ${n1(value.ivo / value.ivoN)}` : undefined }))
    .sort((a, b) => b.value - a.value);
}

function dataMotiveCount(pulse: UafPulse) {
  return pulse.attention.motivos.filter((row) => row.sujetos > 0).length;
}

function percent(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0;
}
