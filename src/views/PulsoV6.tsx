import { useMemo, useState } from 'react';
import { useRpc } from '../lib/rpc';
import type { UafPulse } from '../lib/contracts';
import type { CohortRequest } from '../components/CohortDrawer';
import { SubjectDirectory, type DirectorySelection } from '../components/SubjectDirectory';
import { Empty, ErrorBox, Loading, Semantics } from '../components/primitives';
import { NovedadesObservatorio } from './pulso/Novedades';
import { fecha, n, n1, titleCase } from '../lib/format';
import { hrefFor } from '../lib/router';
import '../styles/pulso-v6.css';

const ALL: CohortRequest = { cohort: 'TODOS', title: 'Padrón completo de sujetos obligados' };

export function PulsoV6({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const { data, error, loading, reload } = useRpc<UafPulse>('obs_uaf_pulse', {});
  const [directory, setDirectory] = useState<DirectorySelection>({ kind: 'registered', request: ALL });

  if (loading && !data) return <Loading label="Leyendo el padrón de sujetos obligados…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.universe) return <Empty title="Sin padrón publicado" hint="El corte vigente no devolvió el universo UAF." />;

  const u = data.universe;
  const c = data.crosscuts;
  const scr = data.screening;
  const trend = (data.reporting?.nacional?.entidades_reportantes_total?.puntos ?? [])
    .filter((point) => /^\d{4}$/.test(point.periodo) && point.valor != null)
    .map((point) => ({ label: point.periodo, value: Number(point.valor) }))
    .slice(-5);
  const topSectors = data.by_sector.slice().sort((a, b) => b.sujetos - a.sujetos).slice(0, 5);
  const topRegions = data.by_region.slice().sort((a, b) => b.sujetos - a.sujetos).slice(0, 5);
  const maxSector = Math.max(1, ...topSectors.map((row) => row.sujetos));
  const maxRegion = Math.max(1, ...topRegions.map((row) => row.sujetos));

  const setCohort = (request: CohortRequest, client?: Pick<Extract<DirectorySelection, { kind: 'registered' }>, 'clientSector' | 'clientRegion' | 'clientIndustry'>) => {
    setDirectory({ kind: 'registered', request, ...client });
    window.setTimeout(() => document.getElementById('pulso-directorio')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20);
  };

  const status = [
    { key: 'active', label: 'Activos', value: u.activos, tone: 'var(--present)', request: { cohort: 'ACTIVO', title: 'Sujetos activos ante el SII' } as CohortRequest },
    { key: 'term', label: 'Término de giro', value: u.terminados, tone: 'var(--sig-high)', request: { cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro' } as CohortRequest },
    { key: 'unknown', label: 'Sin perfil SII', value: u.sin_perfil, tone: 'var(--unknown)', request: { cohort: 'SIN_PERFIL_SII', title: 'Sujetos sin perfil SII' } as CohortRequest },
  ];

  return (
    <div className="pulse-v6 fade-in">
      <header className="p6-head">
        <div>
          <span className="p6-kicker">Padrón UAF · Ley 19.913 · Chile</span>
          <h1>Pulso del universo obligado</h1>
          <p>
            Síntesis operativa del padrón: estado, territorio, evolución, sectores y novedades. Los análisis de reportabilidad,
            revisión y ciclo migran a Universo SO; aquí cada gráfico filtra el directorio final sin sacar al analista de la pantalla.
          </p>
        </div>
        <div className="p6-meta">
          <span><b>Padrón</b> {n(u.total)}</span>
          <span><b>Reportabilidad</b> {data.reporting?.corte.periodo ?? '—'}</span>
          {data.snapshot && <span><b>Corte</b> {fecha(data.snapshot.published_at ?? data.snapshot.generated_at)}</span>}
        </div>
      </header>

      <section className="p6-kpis" aria-label="Cifras principales">
        <Kpi label="Padrón inscrito" value={u.total} share={`${n(u.sectores_uaf)} sectores Ley 19.913`} foot={`${n(u.juridicas)} jurídicas · ${n(u.naturales)} naturales`} tone="var(--accent)" onClick={() => setCohort(ALL)} />
        <Kpi label="Activos ante el SII" value={u.activos} share={`${n1(percent(u.activos, u.total))}% del padrón`} foot={`${n1(u.antiguedad_media)} años de actividad promedio`} tone="var(--present)" onClick={() => setCohort({ cohort: 'ACTIVO', title: 'Sujetos activos ante el SII' })} />
        <Kpi label="Con término de giro" value={u.terminados} share={`${n1(percent(u.terminados, u.total))}% del padrón`} foot="cerraron giro y siguen inscritos" tone="var(--sig-high)" onClick={() => setCohort({ cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro' })} />
        <Kpi label="Sin perfil SII" value={u.sin_perfil} share={`${n1(percent(u.sin_perfil, u.total))}% del padrón`} foot="principalmente personas naturales" tone="var(--unknown)" onClick={() => setCohort({ cohort: 'SIN_PERFIL_SII', title: 'Sujetos sin perfil SII' })} />
        <Kpi label="Piden revisión" value={u.en_atencion} share={`${n1(percent(u.en_atencion, u.total))}% con motivo`} foot={`${n(data.attention.motivos.length)} motivos de precedencia`} tone="var(--sig-critical)" onClick={() => setCohort({ cohort: 'ATENCION', title: 'Sujetos que piden revisión' })} />
      </section>

      <section className="p6-row-one">
        <div className="p6-panel">
          <div className="p6-insight">
            <strong>{n(scr?.corte?.universo_declarado)}</strong>
            <b>Universo observable fuera del padrón</b>
            <p>
              Equivale a {n1((scr?.corte?.universo_declarado ?? 0) / Math.max(1, u.total))} veces el padrón. La coincidencia por giro orienta conciliación y no prueba obligación de inscripción.
            </p>
            <button onClick={() => onNavigate(hrefFor({ view: 'universo', mode: 'casos', cola: 'potenciales' }))}>Abrir potenciales SO →</button>
          </div>
        </div>

        <MiniPanel title="Distribución por estado" action="Universo SO →" onAction={() => onNavigate(hrefFor({ view: 'universo' }))}>
          <div className="p6-status-total">{n(u.total)}</div>
          <div className="p6-status-track">
            {status.map((row) => <button key={row.key} data-s={row.key} style={{ width: `${percent(row.value, u.total)}%` }} title={`${row.label}: ${n(row.value)}`} onClick={() => setCohort(row.request)} />)}
          </div>
          <div className="p6-status-legend">
            {status.map((row) => (
              <button key={row.key} onClick={() => setCohort(row.request)}>
                <i style={{ background: row.tone }} /><span>{row.label}</span><b>{n(row.value)}</b>
              </button>
            ))}
          </div>
        </MiniPanel>

        <MiniPanel title="Distribución territorial" action="Territorio →" onAction={() => onNavigate(hrefFor({ view: 'territorio' }))}>
          <div className="p6-ranks">
            {topRegions.map((row) => (
              <RankRow key={row.region} label={titleCase(row.region)} value={row.sujetos} max={maxRegion}
                onClick={() => setCohort({ cohort: 'REGION', value: row.region, title: `Sujetos obligados en ${titleCase(row.region)}` })} />
            ))}
          </div>
          <p className="p6-note">{n(u.con_territorio)} sujetos con territorio observado.</p>
        </MiniPanel>
      </section>

      <section className="p6-row-two" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <MiniPanel title="Evolución publicada del padrón" action="Universo SO →" onAction={() => onNavigate(hrefFor({ view: 'universo' }))}>
          {trend.length > 1 ? <MiniLine points={trend} /> : <div className="p6-note">Sin serie histórica suficiente.</div>}
        </MiniPanel>

        <MiniPanel title="Principales sectores" action="Universo SO →" onAction={() => onNavigate(hrefFor({ view: 'universo' }))}>
          <div className="p6-ranks">
            {topSectors.map((row) => (
              <RankRow key={row.sector} label={titleCase(row.sector)} value={row.sujetos} max={maxSector}
                onClick={() => setCohort({ cohort: 'SECTOR', value: row.sector, title: titleCase(row.sector) })} />
            ))}
          </div>
          <p className="p6-note">Selecciona un sector para filtrar el directorio.</p>
        </MiniPanel>
      </section>

      <NovedadesObservatorio />

      <section className="p6-crosscuts" aria-label="Cruces de caracterización">
        <Crosscut label="Antecedentes sancionatorios" detail={`${n(c?.antecedentes_sancion)} resoluciones observadas`} value={c?.sancionados_con_antecedente ?? 0} tone="var(--sig-critical)" onClick={() => setCohort({ cohort: 'SANCIONADO', title: 'Sujetos con antecedente sancionatorio' })} />
        <Crosscut label="Figuran en prensa" detail={`${n(c?.antecedentes_prensa)} menciones asociadas`} value={c?.prensa ?? 0} tone="var(--sig-watch)" onClick={() => setCohort({ cohort: 'PRENSA', title: 'Sujetos que figuran en prensa' })} />
        <Crosscut label="Cruce con OSFL" detail={`${n1(percent(c?.osfl ?? 0, u.total))}% del padrón`} value={c?.osfl ?? 0} tone="var(--unknown)" onClick={() => setCohort({ cohort: 'OSFL', title: 'Sujetos obligados que además son OSFL' })} />
        <Crosscut label="Señales de patrón" detail={`${n(c?.senales_totales)} señales activas`} value={c?.con_senal ?? 0} tone="var(--sig-medium)" onClick={() => setCohort({ cohort: 'CON_SENAL', title: 'Sujetos con señales observadas' })} />
      </section>

      <div className="p6-directory-anchor">
        <SubjectDirectory
          id="pulso-directorio"
          selection={directory}
          onReset={() => setDirectory({ kind: 'registered', request: ALL })}
        />
      </div>

      <Semantics>
        <strong>Lectura de Pulso.</strong> Esta pantalla queda deliberadamente como síntesis y puerta de entrada. La reportabilidad sectorial,
        los motivos de revisión, los cambios del stock y los bordes registrales se analizan en Universo SO. Las marcas ordenan revisión y no concluyen incumplimiento ni riesgo LA/FT.
      </Semantics>
    </div>
  );
}

function Kpi({ label, value, share, foot, tone, onClick }: { label: string; value: number; share: string; foot: string; tone: string; onClick: () => void }) {
  return (
    <button className="p6-kpi" style={{ ['--p6-tone' as string]: tone }} onClick={onClick}>
      <span className="p6-kpi-label">{label}</span>
      <span className="p6-kpi-value">{n(value)}</span>
      <span className="p6-kpi-share">{share}</span>
      <span className="p6-kpi-foot">{foot}</span>
    </button>
  );
}

function MiniPanel({ title, action, onAction, children }: { title: string; action: string; onAction: () => void; children: React.ReactNode }) {
  return (
    <section className="p6-panel">
      <header className="p6-panel-head"><h3>{title}</h3><button onClick={onAction}>{action}</button></header>
      <div className="p6-panel-body">{children}</div>
    </section>
  );
}

function RankRow({ label, value, max, onClick }: { label: string; value: number; max: number; onClick: () => void }) {
  return (
    <button className="p6-rank" onClick={onClick} title={label}>
      <span className="p6-rank-name">{label}</span>
      <span className="p6-rank-track"><i style={{ width: `${(value / Math.max(1, max)) * 100}%` }} /></span>
      <span className="p6-rank-value">{n(value)}</span>
    </button>
  );
}

function Crosscut({ label, detail, value, tone, onClick }: { label: string; detail: string; value: number; tone: string; onClick: () => void }) {
  return (
    <button className="p6-crosscut" style={{ ['--p6-tone' as string]: tone }} onClick={onClick}>
      <span>{label}<small>{detail}</small></span><b>{n(value)}</b>
    </button>
  );
}

function MiniLine({ points }: { points: { label: string; value: number }[] }) {
  const geometry = useMemo(() => {
    const width = 420;
    const height = 160;
    const padX = 28;
    const padY = 24;
    const values = points.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(1, max - min);
    const x = (index: number) => padX + index * ((width - padX * 2) / Math.max(1, points.length - 1));
    const y = (value: number) => padY + (height - padY * 2) * (1 - (value - min) / span);
    const line = points.map((point, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ');
    const area = `${line} L ${x(points.length - 1).toFixed(1)} ${height - padY} L ${x(0).toFixed(1)} ${height - padY} Z`;
    return { width, height, x, y, line, area };
  }, [points]);

  return (
    <svg className="p6-trend" viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-label="Evolución publicada del padrón">
      <path data-area d={geometry.area} /><path data-line d={geometry.line} />
      {points.map((point, index) => (
        <g key={point.label}>
          <circle cx={geometry.x(index)} cy={geometry.y(point.value)} r="3" />
          <text x={geometry.x(index)} y={geometry.y(point.value) - 9}>{n(point.value)}</text>
          <text className="p6-year" x={geometry.x(index)} y={geometry.height - 6}>{point.label}</text>
        </g>
      ))}
    </svg>
  );
}

function percent(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0;
}
