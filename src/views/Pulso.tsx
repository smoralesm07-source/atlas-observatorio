import { useState } from 'react';
import { useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import type { Pulse } from '../lib/contracts';
import { Bars, PriorityRing, Sparkline, TerritoryStrip } from '../components/charts';
import { Empty, ErrorBox, Loading, Panel, Semantics } from '../components/primitives';
import { desde, findingLabel, n, n1, priorityTone, sourceClassLabel, sourceClassVar, titleCase } from '../lib/format';
import { AlertCard } from '../components/AlertCard';

const PRIORITY_ORDER = ['MUY ALTA', 'ALTA', 'MEDIA', 'OBSERVAR'];

export function Pulso({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const { data, error, loading, reload } = useRpc<Pulse>('obs_pulse', {});

  if (loading) return <Loading label="Leyendo el estado del observatorio…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.universe) return <Empty title="Sin corte publicado" hint="Aún no hay un snapshot READY del Observatorio." />;

  const u = data.universe;
  const snap = data.snapshot;

  const ring = PRIORITY_ORDER.map((p) => ({
    label: p,
    value: data.alerts.by_priority.find((x) => x.priority === p)?.n ?? 0,
    tone: priorityTone(p),
  })).filter((s) => s.value > 0);

  const urgent = data.alerts.by_priority
    .filter((p) => p.priority === 'MUY ALTA' || p.priority === 'ALTA')
    .reduce((a, p) => a + p.n, 0);

  const producers = data.sources.find((s) => s.source_class === 'producer');
  const silent = data.sources.reduce((a, s) => a + s.silent, 0);

  return (
    <div className="fade-in">
      <header className="view-head">
        <h1 className="view-title">Pulso del observatorio</h1>
        <p className="view-lede">
          Estado vivo de {n(u.entities)} entidades observadas a través de fuentes abiertas
          gobernadas. Lo que aparece aquí es lo que las fuentes registran hoy, no una
          conclusión sobre ninguna entidad.
        </p>
      </header>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat
          label="Universo observado"
          value={n(u.entities)}
          foot={`${n(u.multi_source)} con 3 o más fuentes`}
          spark={[3, 5, 4, 7, 6, 9, 8, 12]}
        />
        <Stat
          label="Señales activas"
          value={n(data.alerts.total)}
          foot={`${n(urgent)} en prioridad alta o superior`}
          tone={urgent > 0 ? 'var(--sig-high)' : undefined}
          spark={[6, 4, 7, 5, 9, 7, 11, 10]}
        />
        <Stat
          label="Con evento sancionatorio"
          value={n(u.sanctioned)}
          foot={`${n1((u.sanctioned / Math.max(1, u.entities)) * 100)}% del universo`}
          tone="var(--sig-critical)"
          spark={[2, 3, 3, 5, 4, 6, 6, 7]}
        />
        <Stat
          label="Padrón UAF observado"
          value={n(u.uaf_observed)}
          foot={`${n(u.regions)} regiones con presencia`}
          spark={[8, 8, 9, 9, 10, 11, 11, 12]}
        />
      </div>

      <div className="grid grid-main" style={{ marginBottom: 16 }}>
        <Panel
          title="Anticipación · señales que piden mirada"
          meta={`${n(data.alerts.top.length)} de ${n(data.alerts.total)}`}
          pad={false}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16 }}>
            {data.alerts.top.length === 0 ? (
              <Empty title="Sin señales priorizadas" />
            ) : (
              data.alerts.top.map((a) => (
                <AlertCard key={a.alert_id} alert={a} onNavigate={onNavigate} compact />
              ))
            )}
            <a
              href={hrefFor({ view: 'senales' })}
              className="btn"
              style={{ alignSelf: 'flex-start', marginTop: 4 }}
            >
              Ver todas las señales
            </a>
          </div>
        </Panel>

        <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
          <Panel title="Distribución por prioridad">
            {ring.length ? (
              <PriorityRing segments={ring} total={data.alerts.total} />
            ) : (
              <Empty title="Sin señales" />
            )}
          </Panel>

          <Panel title="Buscar una entidad" meta="nombre o RUT">
            <QuickSearch onNavigate={onNavigate} />
          </Panel>

          <Panel title="Estado de las fuentes" meta={silent ? `${silent} en silencio` : 'todas activas'}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {data.sources.map((s) => (
                <div key={s.source_class} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <i style={{ width: 8, height: 8, borderRadius: 2, background: sourceClassVar(s.source_class), flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sourceClassLabel(s.source_class)}
                    </span>
                  </span>
                  <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    {s.fresh > 0 && <Pill color="var(--present)">{s.fresh} al día</Pill>}
                    {s.silent > 0 && <Pill color="var(--sig-high)">{s.silent} en silencio</Pill>}
                    {s.unknown > 0 && <Pill color="var(--ink-4)">{s.unknown} sin señal</Pill>}
                  </span>
                </div>
              ))}
              <a href={hrefFor({ view: 'fuentes' })} style={{ fontSize: 12, color: 'var(--accent)', marginTop: 2 }}>
                Ver detalle de cobertura →
              </a>
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <Panel title="Señales por familia" meta="clic para filtrar">
          <Bars
            data={data.alerts.by_family.map((f) => ({
              label: titleCase(f.family),
              value: f.n,
              tone: f.urgent > 0 ? 'high' : 'watch',
              sub: f.urgent ? `${f.urgent} urgentes` : undefined,
            }))}
            onPick={(label) => {
              const fam = data.alerts.by_family.find((f) => titleCase(f.family) === label);
              if (fam) onNavigate(hrefFor({ view: 'senales', family: fam.family }));
            }}
          />
        </Panel>

        <Panel title="Hallazgos por tipo" meta={`${n(data.findings.total)} en total`}>
          <Bars
            data={data.findings.by_type.slice(0, 7).map((f) => ({
              label: findingLabel(f.finding_type),
              value: f.n,
              tone: 'watch',
            }))}
          />
        </Panel>

        <Panel title="Territorio" meta="entidades · franja roja = sancionadas">
          <TerritoryStrip
            rows={data.territory.slice(0, 12)}
            onPick={(region) => onNavigate(hrefFor({ view: 'entidades', region }))}
          />
        </Panel>
      </div>

      <Semantics>
        <strong>Qué significa este tablero.</strong> {data.semantics} Una fuente en silencio
        indica que no hemos recibido registros nuevos, no que no exista actividad.
        {snap && (
          <>
            {' '}Corte <span className="mono">{snap.snapshot_id}</span>, publicado {desde(snap.published_at ?? snap.generated_at)}.
          </>
        )}
        {producers && ` ${producers.n} productores gobernados alimentan el universo.`}
      </Semantics>
    </div>
  );
}

/** Entity lookup is the primary act in this tool, so it starts on the home
 *  screen instead of behind a tab. */
function QuickSearch({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const [q, setQ] = useState('');
  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        onNavigate(hrefFor({ view: 'entidades', q: q.trim() || undefined }));
      }}
    >
      <div className="searchbar-field" style={{ height: 42 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} aria-hidden>
          <circle cx="11" cy="11" r="7" stroke="var(--ink-3)" strokeWidth="1.8" />
          <path d="m16.5 16.5 4.2 4.2" stroke="var(--ink-3)" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          value={q}
          onChange={(ev) => setQ(ev.target.value)}
          placeholder="76.123.456-7 o razón social…"
          autoComplete="off"
          spellCheck={false}
          aria-label="Buscar una entidad por nombre o RUT"
        />
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
        Responde qué sabe el observatorio de esa entidad y desde qué fuente lo sabe.
        Pulsa <span className="searchbar-hint">/</span> en cualquier pantalla para volver aquí.
      </p>
    </form>
  );
}

function Stat({
  label, value, foot, tone, spark,
}: {
  label: string; value: string; foot?: string; tone?: string; spark?: number[];
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value num" style={tone ? { color: tone } : undefined}>{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
      {spark && (
        <div className="stat-spark">
          <Sparkline points={spark} color={tone ?? 'var(--accent)'} />
        </div>
      )}
    </div>
  );
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="num"
      style={{
        fontSize: 10.5, fontWeight: 650, color, padding: '2px 7px', borderRadius: 999,
        border: `1px solid color-mix(in srgb, ${color} 32%, transparent)`,
        background: `color-mix(in srgb, ${color} 10%, transparent)`, whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
