import { useState } from 'react';
import { useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import type { CoverageRow, EntityDetail } from '../lib/contracts';
import { AlertCard } from '../components/AlertCard';
import { Meter } from '../components/charts';
import {
  Badge, Empty, ErrorBox, Loading, Panel, Semantics, SourceStatusBadge,
} from '../components/primitives';
import {
  bandLabel, desde, eventLabel, fecha, findingLabel, identityLabel, n, n1, pct,
  rutFormat, sourceClassLabel, sourceClassVar, titleCase,
} from '../lib/format';

type Tab = 'panorama' | 'fuentes' | 'senales' | 'marcas' | 'economia';

const TABS: { id: Tab; label: string }[] = [
  { id: 'panorama', label: 'Panorama' },
  { id: 'fuentes', label: 'Fuentes' },
  { id: 'senales', label: 'Señales y hallazgos' },
  { id: 'marcas', label: 'Marcas' },
  { id: 'economia', label: 'Economía y padrón' },
];

export function Ficha({
  entityId,
  onNavigate,
}: {
  entityId: string;
  onNavigate: (hash: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('panorama');
  const { data, error, loading, reload } = useRpc<EntityDetail | null>('obs_entity_detail', {
    p_entity_id: entityId,
  });

  if (loading) return <Loading label="Reuniendo lo que las fuentes registran…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) {
    return (
      <Empty
        title="Entidad no encontrada en este corte"
        hint={`El identificador ${entityId} no está en el universo publicado. Puede haber salido del corte o no haber sido reportado por ninguna fuente gobernada.`}
      />
    );
  }

  const e = data.entity;
  const present = data.coverage.filter((c) => c.status === 'PRESENT');
  const absent = data.coverage.filter((c) => c.status === 'ABSENT');
  const pending = data.coverage.filter((c) => c.status === 'NOT_CONSULTED');
  const consulted = present.length + absent.length;

  return (
    <div className="fade-in">
      <nav style={{ marginBottom: 14, fontSize: 12.5 }}>
        <a href={hrefFor({ view: 'entidades' })} style={{ color: 'var(--ink-3)' }}>
          ← Entidades
        </a>
      </nav>

      <header className="ficha-head">
        <div style={{ minWidth: 0, flex: '1 1 340px' }}>
          <h1 className="ficha-title">{titleCase(e.name)}</h1>
          <div className="ficha-sub">
            <span className="mono" style={{ color: 'var(--ink)' }}>{rutFormat(e.rut)}</span>
            {e.entity_type && <span>{e.entity_type}</span>}
            {e.region && <span>{e.region}{e.commune ? ` · ${e.commune}` : ''}</span>}
            {data.identity.method && (
              <span title="Cómo se resolvió la identidad de esta entidad">
                Identidad: {data.identity.method}
                {data.identity.confidence != null && ` (${n1(data.identity.confidence * 100)}%)`}
              </span>
            )}
          </div>

          <div className="ficha-flags">
            {e.is_sanctioned && <Badge tone="critical" dot>Con evento sancionatorio</Badge>}
            {e.is_uaf_observed && <Badge tone="present">Sujeto obligado UAF</Badge>}
            {e.uaf_sector && <Badge tone="neutral">{titleCase(e.uaf_sector)}</Badge>}
            {dedupeRoles(e.roles, e).map((r) => (
              <Badge key={r} tone="neutral">{titleCase(r)}</Badge>
            ))}
          </div>
        </div>

        <div className="ficha-scores">
          <ScoreTile
            value={e.ipa3_score == null ? '—' : n1(e.ipa3_score)}
            label="Prioridad analítica"
            hint={bandLabel(e.ipa3_band)}
          />
          <ScoreTile value={n(present.length)} label="Fuentes con registro" hint={`de ${n(consulted)} consultadas`} />
          <ScoreTile
            value={n(e.alert_count)}
            label="Señales"
            hint={e.finding_count ? `${n(e.finding_count)} hallazgos` : 'sin hallazgos'}
            tone={e.alert_count > 0 ? 'var(--sig-high)' : undefined}
          />
        </div>
      </header>

      <div className="filters" style={{ margin: '18px 0' }}>
        {TABS.map((t) => (
          <button key={t.id} className="chip" data-on={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'panorama' && <Panorama data={data} onNavigate={onNavigate} />}
      {tab === 'fuentes' && <Fuentes present={present} absent={absent} pending={pending} />}
      {tab === 'senales' && <SenalesTab data={data} onNavigate={onNavigate} />}
      {tab === 'marcas' && <Marcas data={data} />}
      {tab === 'economia' && <Economia data={data} />}

      <div style={{ marginTop: 24 }}>
        <Semantics>
          <strong>Alcance de esta ficha.</strong> {data.semantics} Corte{' '}
          <span className="mono">{e.snapshot_id}</span>, actualizado {desde(e.refreshed_at)}.
        </Semantics>
      </div>
    </div>
  );
}

/** "Sujeto obligado" and "Entidad sancionada" are already stated as flags; a
 *  second chip saying the same thing only crowds the header. */
function dedupeRoles(roles: string[], e: { is_uaf_observed: boolean; is_sanctioned: boolean }) {
  const drop = new Set(['sujeto obligado', 'entidad economica', 'entidad económica']);
  if (e.is_uaf_observed) drop.add('sujeto obligado');
  if (e.is_sanctioned) drop.add('entidad sancionada');
  const seen = new Set<string>();
  return roles
    .filter((r) => {
      const k = r.toLowerCase().trim();
      if (drop.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 4);
}

/* ─────────────────────────────────────────────────────── panorama */

function Panorama({ data, onNavigate }: { data: EntityDetail; onNavigate: (h: string) => void }) {
  const events = [...data.events]
    .sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))
    .slice(0, 14);
  const p = data.priority;

  return (
    <div className="grid grid-main">
      <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
        <Panel title="Línea de tiempo observada" meta={`${n(data.events.length)} eventos`}>
          {events.length === 0 ? (
            <Empty
              title="Sin eventos fechados"
              hint="Las fuentes que reportan esta entidad no aportan eventos con fecha en este corte."
            />
          ) : (
            <div className="timeline">
              {events.map((ev, i) => (
                <div className="tl-item" key={ev.event_id ?? i}>
                  <div className="tl-when">{ev.fecha ? fecha(ev.fecha) : 'sin fecha'}</div>
                  <div className="tl-what">{eventLabel(ev.tipo, ev.tipo_es)}</div>
                  {ev.productor && (
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>
                      {titleCase(ev.productor.replace(/_/g, ' '))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>

        {data.alerts.length > 0 && (
          <Panel title="Señales sobre esta entidad" pad={false}>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.alerts.map((a) => (
                <AlertCard key={a.alert_id} alert={a} onNavigate={onNavigate} />
              ))}
            </div>
          </Panel>
        )}

        {data.sanctions.length > 0 && (
          <Panel title="Eventos sancionatorios" meta={`${n(data.sanctions.length)} registrados`} pad={false}>
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th><th>Regulador</th><th>Materia</th>
                  <th>Identidad</th><th className="right">Monto UF</th>
                </tr>
              </thead>
              <tbody>
                {data.sanctions.map((s) => (
                  <tr key={s.sanction_id}>
                    <td className="num">{fecha(s.event_date)}</td>
                    <td>{s.regulator ?? '—'}</td>
                    <td style={{ maxWidth: 320 }}>{s.subject ?? '—'}</td>
                    <td>
                      {s.identity_status ? (
                        <Badge tone={s.identity_status.includes('EXACT') ? 'present' : 'unknown'}>
                          {identityLabel(s.identity_status)}
                        </Badge>
                      ) : '—'}
                    </td>
                    <td className="right num">{s.amount_uf == null ? '—' : n1(s.amount_uf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </div>

      <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
        {p && (
          <Panel title="Cómo se compone la prioridad">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <Meter value={Number(p.registry_group_score ?? 0)} label="Grupo registral" />
              <Meter value={Number(p.economic_group_score ?? 0)} label="Grupo económico" />
              <Meter value={Number(p.sanctions_group_score ?? 0)} label="Grupo sancionatorio" />
              {p.coverage_index_pct != null && (
                <Meter
                  value={Number(p.coverage_index_pct)}
                  label="Cobertura de datos"
                  hint="Cuánto de la evidencia requerida está disponible para esta entidad."
                />
              )}
              <dl className="kv" style={{ marginTop: 4 }}>
                <dt>Banda</dt>
                <dd>{bandLabel(p.priority_band_shadow)}</dd>
                <dt>Marcas incluidas</dt><dd className="num">{n(p.included_mark_count)}</dd>
                <dt>Grupos independientes</dt><dd className="num">{n(p.independent_group_count)}</dd>
                <dt>Marca dominante</dt><dd className="mono">{p.dominant_mark_id ?? '—'}</dd>
                <dt>Versión</dt><dd className="mono">{p.score_version ?? '—'}</dd>
                <dt>Corte del score</dt><dd>{fecha(p.score_as_of)}</dd>
              </dl>
            </div>
          </Panel>
        )}

        <Panel title="Cobertura de fuentes">
          <SourceStrip coverage={data.coverage} />
        </Panel>

        {data.links.length > 0 && (
          <Panel title="Vínculos de identidad" meta={`${n(data.links.length)}`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {data.links.slice(0, 8).map((l) => (
                <div key={l.relacion_id} style={{ fontSize: 12.5 }}>
                  <div style={{ fontWeight: 600 }}>{titleCase(l.tipo_relacion ?? 'Vínculo')}</div>
                  <div style={{ color: 'var(--ink-3)', marginTop: 2 }}>
                    {l.metodo_relacion} · confianza {pct((l.confianza ?? 0) * 100)}
                    {l.requiere_revision && (
                      <Badge tone="unknown" title="Un vínculo que requiere revisión sigue siendo candidato">
                        Requiere revisión
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── fuentes */

function Fuentes({
  present, absent, pending,
}: {
  present: CoverageRow[]; absent: CoverageRow[]; pending: CoverageRow[];
}) {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <Panel
        title={`Con registro · ${present.length}`}
        meta="fuentes que efectivamente reportan a esta entidad"
      >
        <div className="grid grid-3" style={{ gap: 10 }}>
          {present.map((c) => <SourceTile key={c.source_code} row={c} />)}
          {present.length === 0 && <Empty title="Ninguna fuente reporta a esta entidad" />}
        </div>
      </Panel>

      <Panel
        title={`Sin registro · ${absent.length}`}
        meta="consultadas, no la reportan"
      >
        <div className="grid grid-3" style={{ gap: 10 }}>
          {absent.map((c) => <SourceTile key={c.source_code} row={c} />)}
          {absent.length === 0 && <Empty title="Todas las fuentes ingestadas la reportan" />}
        </div>
      </Panel>

      <Panel
        title={`No consultadas · ${pending.length}`}
        meta="listas internacionales y OSINT bajo demanda"
      >
        <div className="grid grid-3" style={{ gap: 10 }}>
          {pending.map((c) => <SourceTile key={c.source_code} row={c} />)}
        </div>
        <div className="note" style={{ marginTop: 14 }}>
          Estas fuentes se consultan por entidad, no por lote. Mientras no se ejecute la
          consulta, el observatorio no afirma ni presencia ni ausencia: afirma que no
          preguntó.
        </div>
      </Panel>
    </div>
  );
}

function SourceTile({ row }: { row: CoverageRow }) {
  return (
    <div className="source-tile" data-status={row.status}>
      <i
        style={{
          width: 8, height: 8, borderRadius: 2, marginTop: 4, flexShrink: 0,
          background: row.status === 'PRESENT' ? sourceClassVar(row.source_class) : 'var(--line-strong)',
        }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="sname">{row.source_name}</div>
        <div className="sdesc">
          {sourceClassLabel(row.source_class)}
          {row.authoritative_source && !row.authoritative_source.startsWith('http') &&
            ` · ${row.authoritative_source}`}
        </div>
        <div style={{ marginTop: 7, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <SourceStatusBadge status={row.status} />
          {row.record_count != null && row.record_count > 0 && (
            <span className="num" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              {n(row.record_count)} eventos
            </span>
          )}
          {row.last_event_at && (
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{desde(row.last_event_at)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceStrip({ coverage }: { coverage: CoverageRow[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {coverage.slice(0, 14).map((c) => (
        <div key={c.source_code} style={{ display: 'grid', gridTemplateColumns: '9px minmax(0,1fr) auto', gap: 9, alignItems: 'center' }}>
          <i
            style={{
              width: 9, height: 9, borderRadius: 2,
              background: c.status === 'PRESENT' ? sourceClassVar(c.source_class) : 'transparent',
              border: c.status === 'PRESENT' ? 'none' : `1px ${c.status === 'NOT_CONSULTED' ? 'dashed' : 'solid'} var(--line-strong)`,
            }}
          />
          <span style={{ fontSize: 12, color: c.status === 'PRESENT' ? 'var(--ink-2)' : 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.source_name}
          </span>
          <span style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
            {c.status === 'PRESENT' ? 'sí' : c.status === 'ABSENT' ? 'no' : '?'}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────── señales y hallazgos */

function SenalesTab({ data, onNavigate }: { data: EntityDetail; onNavigate: (h: string) => void }) {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <Panel title={`Señales · ${data.alerts.length}`} pad={false}>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.alerts.length === 0 ? (
            <Empty
              title="Sin señales activas"
              hint="Ningún patrón gobernado se activó sobre esta entidad en el corte vigente."
            />
          ) : (
            data.alerts.map((a) => <AlertCard key={a.alert_id} alert={a} onNavigate={onNavigate} />)
          )}
        </div>
      </Panel>

      <Panel title={`Hallazgos · ${data.findings.length}`} pad={false}>
        {data.findings.length === 0 ? (
          <div style={{ padding: 16 }}>
            <Empty title="Sin hallazgos registrados" />
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Tipo</th><th>Título</th>
                <th className="right">Explorar</th>
                <th className="right">Supervisar</th>
                <th className="right">Investigar</th>
                <th className="right">Fuentes</th>
              </tr>
            </thead>
            <tbody>
              {data.findings.map((f) => (
                <tr key={f.finding_key}>
                  <td>
                    <Badge tone="neutral">{findingLabel(f.finding_type)}</Badge>
                  </td>
                  <td style={{ maxWidth: 380 }}>{f.title ?? '—'}</td>
                  <td className="right num">{n1(f.score_explore)}</td>
                  <td className="right num">{n1(f.score_supervise)}</td>
                  <td className="right num">{n1(f.score_investigate)}</td>
                  <td className="right num">{n(f.source_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── marcas */

function Marcas({ data }: { data: EntityDetail }) {
  const included = data.marks.filter((m) => m.included_in_score);
  const context = data.marks.filter((m) => !m.included_in_score);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <Semantics>
        <strong>Qué es una marca.</strong> Una marca es una observación estructurada que
        una fuente sostiene sobre la entidad. Las marcas <em>incluidas</em> aportan a la
        prioridad analítica; las de <em>contexto</em> se muestran porque informan la
        lectura, pero no suman al orden. Una marca absorbida por otra no desaparece: se
        deja de contar dos veces el mismo fenómeno.
      </Semantics>

      <Panel title={`Marcas incluidas en la prioridad · ${included.length}`} pad={false}>
        {included.length === 0 ? (
          <div style={{ padding: 16 }}><Empty title="Ninguna marca aporta a la prioridad" /></div>
        ) : (
          <MarkTable marks={included} />
        )}
      </Panel>

      {context.length > 0 && (
        <Panel title={`Marcas de contexto · ${context.length}`} pad={false}>
          <MarkTable marks={context} />
        </Panel>
      )}
    </div>
  );
}

function MarkTable({ marks }: { marks: EntityDetail['marks'] }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Marca</th><th>Dimensión</th><th>Clase</th>
          <th className="right">Intensidad</th>
          <th className="right">Aporte</th>
          <th className="right">Confianza</th>
          <th>Disponibilidad</th>
        </tr>
      </thead>
      <tbody>
        {marks.map((m) => (
          <tr key={m.mark_id}>
            <td>
              <div style={{ fontWeight: 600 }}>{m.mark_name ?? m.mark_id}</div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{m.mark_id}</div>
            </td>
            <td>{titleCase(m.primary_dimension ?? '')}</td>
            <td>{titleCase((m.semantic_class ?? '').replace(/_/g, ' '))}</td>
            <td className="right num">{n1(m.raw_intensity)}</td>
            <td className="right num" style={{ fontWeight: 650 }}>{n1(m.contribution)}</td>
            <td className="right num">{m.confidence == null ? '—' : pct(m.confidence * 100)}</td>
            <td>
              <Badge tone={m.readiness === 'READY' ? 'present' : 'unknown'}>
                {titleCase((m.readiness ?? 'desconocida').replace(/_/g, ' '))}
              </Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ────────────────────────────────────────────── economía y padrón */

function Economia({ data }: { data: EntityDetail }) {
  const uaf = data.uaf as Record<string, unknown> | null;
  const osfl = data.osfl as Record<string, unknown> | null;

  return (
    <div className="grid grid-2">
      <Panel title="Posición entre pares" meta="por año comercial">
        {data.peers.length === 0 ? (
          <Empty
            title="Sin posición de pares"
            hint="No hay años comerciales comparables para esta entidad en el corte."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            {data.peers.map((p) => (
              <div key={p.commercial_year}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
                  <strong className="num">{p.commercial_year}</strong>
                  <span style={{ color: 'var(--ink-3)' }}>
                    {p.economic_sector ?? '—'} · {n(p.peer_n)} pares
                  </span>
                </div>
                <Meter
                  value={Number(p.sales_peer_percentile ?? 0)}
                  label={`Percentil de ventas (${p.sales_band_code ?? 's/tramo'})`}
                  hint="El percentil describe posición dentro del grupo de pares del año, no desempeño ni riesgo."
                />
                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {p.sales_band_delta != null && p.sales_band_delta !== 0 && (
                    <Badge tone={p.sales_band_delta > 0 ? 'present' : 'high'}>
                      Tramo {p.sales_band_delta > 0 ? '+' : ''}{p.sales_band_delta}
                    </Badge>
                  )}
                  {p.main_activity_changed && <Badge tone="unknown">Cambió giro principal</Badge>}
                  {p.region_changed && <Badge tone="unknown">Cambió región</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
        {uaf && (
          <Panel title="Padrón UAF" meta="sujeto obligado inscrito">
            <dl className="kv">
              <Row k="Sector" v={titleCase(String(uaf.uaf_sector_canonical ?? ''))} />
              <Row k="Naturaleza" v={titleCase(String(uaf.subject_nature ?? ''))} />
              <Row k="Estado SII" v={String(uaf.sii_status ?? '—')} />
              <Row k="Giro principal" v={String(uaf.sii_main_activity ?? '—')} />
              <Row k="Tramo de ventas" v={String(uaf.sii_sales_band ?? '—')} />
              <Row k="Trabajadores" v={n(uaf.sii_workers as number)} />
              <Row k="Antigüedad" v={uaf.entity_age_years ? `${uaf.entity_age_years} años` : '—'} />
              <Row k="Sanciones (total)" v={n(uaf.sanction_event_count as number)} />
              <Row k="Sanciones (5 años)" v={n(uaf.sanction_event_count_5y as number)} />
              <Row k="Última sanción" v={fecha(uaf.sanction_last_event_date as string)} />
              <Row k="IPF" v={`${n1(uaf.ipf_score as number)} · ${String(uaf.ipf_band ?? '—')}`} />
              <Row k="Percentil IPF" v={pct(uaf.ipf_percentile as number)} />
              <Row k="Percentil en sector" v={pct(uaf.ipf_sector_percentile as number)} />
            </dl>
            {typeof uaf.semantics === 'string' && (
              <div className="note" style={{ marginTop: 14 }}>{uaf.semantics}</div>
            )}
          </Panel>
        )}

        {osfl && (
          <Panel title="Perfil OSFL" meta="organización sin fines de lucro">
            <dl className="kv">
              <Row k="Confirmación" v={titleCase(String(osfl.confirmation_level ?? ''))} />
              <Row k="Grupo de actividad" v={titleCase(String(osfl.profile_activity_group ?? ''))} />
              <Row k="Giro principal" v={String(osfl.main_activity ?? '—')} />
              <Row k="Estado" v={String(osfl.current_status ?? '—')} />
              <Row k="Tramo de ventas" v={String(osfl.sales_band ?? '—')} />
              <Row k="Trabajadores" v={n(osfl.workers_numeric as number)} />
              <Row k="Ley 21.440" v={osfl.law21440_active ? 'Sí' : 'No'} />
              <Row k="Registro 19.862" v={osfl.registro19862 ? 'Sí' : 'No'} />
              <Row k="Candidata FATF R8" v={osfl.fatf_r8_candidate ? 'Sí' : 'No'} />
              <Row k="Sanciones" v={n(osfl.sanction_count as number)} />
            </dl>
            <div className="note" style={{ marginTop: 14 }}>
              La pertenencia al Registro 19.862 no es evidencia de haber recibido
              transferencias públicas; sólo la evidencia documental de transferencia lo es.
            </div>
          </Panel>
        )}

        {!uaf && !osfl && (
          <Panel title="Padrón y perfil sectorial">
            <Empty
              title="Sin perfil sectorial"
              hint="Esta entidad no figura en el padrón UAF ni en el universo OSFL de este corte."
            />
          </Panel>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v || '—'}</dd>
    </>
  );
}

function ScoreTile({
  value, label, hint, tone,
}: {
  value: string; label: string; hint?: string; tone?: string;
}) {
  return (
    <div
      style={{
        minWidth: 118, padding: '12px 15px', borderRadius: 'var(--radius)',
        background: 'var(--bg-panel)', border: '1px solid var(--line)',
      }}
    >
      <div className="num" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.035em', color: tone }}>
        {value}
      </div>
      <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 650, marginTop: 3 }}>
        {label}
      </div>
      {hint && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}
