import { useCallback, useState } from 'react';
import { useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import type { CoverageRow, EntityDetail } from '../lib/contracts';
import { AlertCard } from '../components/AlertCard';
import { Meter } from '../components/charts';
import { WatchlistResults } from '../components/Watchlists';
import { IdentidadDigital } from '../components/IdentidadDigital';
import { looksLikePersonName, screenWatchlists, type WatchlistResult } from '../lib/connectors';
import {
  Badge, Empty, ErrorBox, Loading, Panel, Semantics, SourceStatusBadge,
} from '../components/primitives';
import {
  bandLabel, desde, eventLabel, fecha, findingLabel, identityLabel, n, n1, pct,
  rutFormat, sourceClassLabel, sourceClassVar, titleCase,
} from '../lib/format';

type Tab = 'panorama' | 'fuentes' | 'senales' | 'marcas' | 'economia' | 'screening' | 'digital';

const TABS: { id: Tab; label: string }[] = [
  { id: 'panorama', label: 'Panorama' },
  { id: 'fuentes', label: 'Fuentes' },
  { id: 'senales', label: 'Señales y hallazgos' },
  { id: 'marcas', label: 'Marcas' },
  { id: 'economia', label: 'Economía y padrón' },
  { id: 'screening', label: 'Screening internacional' },
  { id: 'digital', label: 'Identidad digital' },
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
            {e.rut ? (
              <span className="mono" style={{ color: 'var(--ink)' }}>{rutFormat(e.rut)}</span>
            ) : (
              <span style={{ color: 'var(--ink-3)' }}>sin RUT</span>
            )}
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
            {!e.rut && (
              <Badge
                tone="unknown"
                title="Aparece en una fuente pero su identidad no se resolvió a un RUT."
              >
                Identidad sin resolver
              </Badge>
            )}
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
      {tab === 'screening' && <Screening entity={e} />}
      {tab === 'digital' && <Digital entity={e} />}

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
  const p = data.priority;

  return (
    <div className="grid grid-main">
      <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
        <LineaDeTiempo data={data} />

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
                  <th>Documento</th>
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
                    <td><EnlaceResolucion sancion={s} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.sanctions.some((s) => s.document_quality === 'PARTIAL') && (
              <p style={{ margin: 0, padding: '10px 14px 14px', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
                {data.lifecycle_notes?.sanction_document_note}
              </p>
            )}
          </Panel>
        )}
      </div>

      <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
        <PerfilTributario data={data} />

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
        {row.detail?.roles?.length ? (
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
            {row.detail.roles.join(' · ')}
          </div>
        ) : null}
        {row.detail?.alcance && (
          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>
            {row.detail.alcance}
          </div>
        )}
        <div style={{ marginTop: 7, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <SourceStatusBadge status={row.status} />
          {row.record_count != null && row.record_count > 0 && (
            <span className="num" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              {n(row.record_count)} {row.detail?.unidad ?? 'eventos'}
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

/* ─────────────────────────────────────────── screening internacional */

/** Desde la ficha el screening es mejor que desde el buscador: aquí hay RUT y
 *  tipo de entidad, así que OpenSanctions puede cruzar por número tributario y
 *  no sólo por nombre. */
function Screening({ entity }: { entity: EntityDetail['entity'] }) {
  const [state, setState] = useState<
    { status: 'idle' } | { status: 'loading' } | { status: 'done'; result: WatchlistResult } | { status: 'error'; error: string }
  >({ status: 'idle' });

  const run = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const result = await screenWatchlists({
        name: entity.name,
        rut: entity.rut,
        entityType: entity.entity_type,
      });
      setState({ status: 'done', result });
    } catch (e) {
      setState({ status: 'error', error: (e as Error).message });
    }
  }, [entity.name, entity.rut, entity.entity_type]);

  if (state.status === 'loading') {
    return <Loading label="Consultando sanciones, debarment y bases offshore…" />;
  }
  if (state.status === 'error') {
    return <ErrorBox error={state.error} onRetry={() => void run()} />;
  }
  if (state.status === 'done') {
    return <WatchlistResults result={state.result} query={entity.name} />;
  }

  return (
    <Panel title="Screening internacional bajo demanda">
      <p style={{ marginTop: 0, color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.65 }}>
        Las listas internacionales no se ingestan por lote: se consultan por entidad, en el
        momento. Hasta que alguien pregunte, el Observatorio no afirma ni presencia ni
        ausencia en OFAC, ONU, Unión Europea, Reino Unido, Banco Mundial, BID, OpenSanctions
        ni ICIJ Offshore Leaks.
      </p>
      <dl className="kv" style={{ marginTop: 14 }}>
        <dt>Se consultará por</dt>
        <dd>
          {titleCase(entity.name)}
          {entity.rut ? ` · ${rutFormat(entity.rut)}` : ' · sin RUT'}
          {entity.entity_type ? ` · ${entity.entity_type}` : ''}
        </dd>
      </dl>
      <button className="btn btn-primary" style={{ maxWidth: 280 }} onClick={() => void run()}>
        Consultar listas internacionales
      </button>
    </Panel>
  );
}

/* ──────────────────────────────────────────────── identidad digital */

function Digital({ entity }: { entity: EntityDetail['entity'] }) {
  const [started, setStarted] = useState(false);
  const person = looksLikePersonName(entity.name);

  if (started) return <IdentidadDigital query={entity.name} />;

  return (
    <Panel title="Identidad digital bajo demanda">
      <p style={{ marginTop: 0, color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.65 }}>
        Atlas genera variantes de username a partir del nombre y busca evidencia pública en
        plataformas. Es útil sobre personas naturales; sobre una razón social los aliases
        derivados suelen ser ruido.
      </p>
      {!person && (
        <div className="note" style={{ marginTop: 12 }}>
          «{titleCase(entity.name)}» no tiene forma de nombre de persona. Puedes ejecutarlo
          igualmente, pero interpreta el resultado con cuidado.
        </div>
      )}
      <button
        className="btn btn-primary"
        style={{ maxWidth: 280 }}
        onClick={() => setStarted(true)}
      >
        Resolver identidad digital
      </button>
    </Panel>
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

/* ─────────────────────────────────────────────── línea de tiempo

   Un ciclo de vida se lee mejor cuando los hitos estructurales enmarcan a los
   hechos puntuales: constituida en tal año, inicia actividades, y en medio las
   sanciones y las menciones en prensa. Antes eran dos listas separadas y el
   analista tenía que reconstruir el orden en su cabeza. */

/* Los productores entregan estados en clave (CONSTITUCION_Y_MODIFICACIONES) y
   actividades en mayúscula sostenida. Ninguna de las dos formas se lee bien
   dentro de una frase. */
function legible(v: string): string {
  return titleCase(v.replace(/_/g, ' '));
}

type FilaTiempo = {
  fecha: string | null;
  titulo: string;
  fuente: string | null;
  detalle: string | null;
  clase: 'hito' | 'sancion' | 'prensa' | 'evento';
  url?: string | null;
  monto?: number | null;
};

function LineaDeTiempo({ data }: { data: EntityDetail }) {
  const filas: FilaTiempo[] = [];

  for (const m of data.lifecycle ?? []) {
    filas.push({
      fecha: m.fecha,
      titulo: m.etiqueta,
      fuente: m.fuente,
      detalle: m.detalle,
      clase: 'hito',
    });
  }

  for (const s of data.sanctions ?? []) {
    filas.push({
      fecha: s.event_date,
      titulo: s.subject || 'Sanción registrada',
      fuente: s.regulator,
      detalle: s.laft_direct ? 'Materia vinculada a LA/FT según la fuente' : null,
      clase: 'sancion',
      monto: s.amount_uf,
    });
  }

  // Los eventos del perfil ya incluyen la sanción como tipo, de modo que las
  // que la ficha muestra con su regulador no se repiten aquí.
  for (const ev of data.events ?? []) {
    if (ev.productor === 'RADAR_SANCIONES') continue;
    filas.push({
      fecha: ev.fecha,
      titulo: eventLabel(ev.tipo, ev.tipo_es),
      fuente: ev.productor ? titleCase(ev.productor.replace(/_/g, ' ')) : null,
      detalle: ev.titulo && ev.titulo !== ev.tipo ? ev.titulo : null,
      clase: ev.productor === 'RADAR_PRENSA' ? 'prensa' : 'evento',
    });
  }

  const fechadas = filas
    .filter((f) => f.fecha)
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const sinFecha = filas.filter((f) => !f.fecha);
  const hitos = data.lifecycle?.length ?? 0;

  return (
    <Panel
      title="Línea de tiempo"
      meta={hitos ? `${n(hitos)} hitos · ${n(fechadas.length - hitos)} hechos` : `${n(fechadas.length)} registros`}
    >
      {fechadas.length === 0 && sinFecha.length === 0 ? (
        <Empty
          title="Sin ciclo de vida observado"
          hint="Ninguna fuente aporta fechas para esta entidad en este corte."
        />
      ) : (
        <div className="timeline">
          {fechadas.map((f, i) => (
            <div className="tl-item" data-clase={f.clase} key={i}>
              <div className="tl-when">{fecha(f.fecha)}</div>
              <div className="tl-what">
                {f.titulo}
                {f.monto != null && (
                  <span className="num" style={{ color: 'var(--sig-critical)', marginLeft: 8, fontWeight: 600 }}>
                    {n(f.monto)} UF
                  </span>
                )}
              </div>
              {(f.fuente || f.detalle) && (
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.5 }}>
                  {[f.fuente, f.detalle && legible(f.detalle)].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* El padrón UAF no publica fecha de inscripción. Ponerla en la línea de
          tiempo con la fecha del scrape sería inventar un hito. */}
      {data.entity.is_uaf_observed && (
        <p style={{ margin: '14px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
          Inscrita en el registro de sujetos obligados de la UAF.{' '}
          {data.lifecycle_notes?.uaf_registration_note}
        </p>
      )}
      {sinFecha.length > 0 && (
        <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--ink-4)' }}>
          {n(sinFecha.length)} registro{sinFecha.length === 1 ? '' : 's'} sin fecha en origen, fuera de la secuencia.
        </p>
      )}
    </Panel>
  );
}

/* ─────────────────────────────────────────── perfil tributario

   Lo primero que se pregunta un analista frente a una entidad: desde cuándo
   existe, a qué se dedica, dónde tributa, de qué tamaño es y si sigue
   operando. El corte tributario alcanza a 45.433 de las 50.516 entidades: para
   el resto se dice que la fuente no la cubre, nunca que la entidad no opera. */

function PerfilTributario({ data }: { data: EntityDetail }) {
  const t = data.tax;
  const r = data.res;

  if (!t && !r) {
    return (
      <Panel title="Perfil tributario">
        <Empty
          title="Sin perfil tributario en el corte"
          hint="El Servicio de Impuestos Internos no publica un perfil para esta entidad. La ausencia es de la fuente, no una afirmación sobre su actividad."
        />
      </Panel>
    );
  }

  const terminada = Boolean(t?.termination_date);

  return (
    <Panel
      title="Perfil tributario"
      meta={t?.commercial_year ? `año comercial ${t.commercial_year}` : undefined}
    >
      {t && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {t.size_label && <Badge tone="neutral">{t.size_label}</Badge>}
            {terminada
              ? <Badge tone="critical" dot>Con término de giro</Badge>
              : t.current_status && <Badge tone="present">Activa ante el SII</Badge>}
          </div>

          <dl className="kv">
            <dt>Inicio de actividades</dt>
            <dd>{t.activity_start_date ? fecha(t.activity_start_date) : '—'}</dd>
            {terminada && (
              <>
                <dt>Término de giro</dt>
                <dd style={{ color: 'var(--sig-critical)' }}>{fecha(t.termination_date)}</dd>
              </>
            )}
            <dt>Actividad principal</dt>
            <dd>{t.main_activity ? titleCase(t.main_activity) : '—'}</dd>
            {t.economic_sector && (
              <>
                <dt>Rubro económico</dt>
                <dd>{titleCase(t.economic_sector)}</dd>
              </>
            )}
            <dt>Región</dt>
            <dd>{t.region ? titleCase(t.region) : '—'}{t.commune ? ` · ${titleCase(t.commune)}` : ''}</dd>
            <dt>Ventas anuales</dt>
            <dd>{t.sales_band_uf ?? '—'}</dd>
            <dt>Trabajadores</dt>
            <dd className="num">{t.workers_numeric == null ? '—' : n(t.workers_numeric)}</dd>
            {t.society_type && (
              <>
                <dt>Tipo de sociedad</dt>
                <dd>{titleCase(t.society_type)}</dd>
              </>
            )}
          </dl>
        </>
      )}

      {r?.constitution_date && (
        <dl className="kv" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line-soft)' }}>
          <dt>Constitución</dt>
          <dd>{fecha(r.constitution_date)}</dd>
          {r.capital != null && (
            <>
              <dt>Capital declarado</dt>
              <dd className="num">${n(r.capital)}</dd>
            </>
          )}
          {r.relationship_count != null && r.relationship_count > 0 && (
            <>
              <dt>Vínculos societarios</dt>
              <dd className="num">{n(r.relationship_count)}</dd>
            </>
          )}
        </dl>
      )}

      {/* El tramo más bajo del SII significa "sin información", no ventas cero.
          Sin esta nota, una entidad sin datos parecería una entidad sin ventas. */}
      {t?.sales_band_rank === 1 && (
        <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
          {data.lifecycle_notes?.sales_band_note}
        </p>
      )}
    </Panel>
  );
}

/* El enlace a la resolución evita que el analista tenga que buscarla a mano en
   el sitio del regulador. Se rotula con el número de resolución cuando existe,
   porque "Ver documento" repetido doce veces no distingue una fila de otra. */
function EnlaceResolucion({
  sancion: s,
}: {
  sancion: EntityDetail['sanctions'][number];
}) {
  if (!s.document_url) {
    return <span style={{ color: 'var(--ink-4)', fontSize: 11.5 }}>sin documento</span>;
  }
  const parcial = s.document_quality === 'PARTIAL';
  return (
    <a
      href={s.document_url}
      target="_blank"
      rel="noreferrer"
      title={parcial
        ? 'El documento puede cubrir más de un acto sancionatorio.'
        : s.document_excerpt ?? 'Resolución publicada por el regulador'}
      style={{ fontSize: 12, color: 'var(--accent)', whiteSpace: 'nowrap' }}
    >
      {s.resolution_ref ? `N° ${s.resolution_ref}` : 'Resolución'}
      {parcial && <span style={{ color: 'var(--ink-4)' }}> · parcial</span>} ↗
    </a>
  );
}
