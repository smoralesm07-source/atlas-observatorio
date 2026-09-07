import { useMemo, useState } from 'react';
import { useRpc } from '../lib/rpc';
import type { SpendActorDetail, SpendFinding, SpendOverview } from '../lib/contracts';
import { Bars, Meter } from '../components/charts';
import { Badge, Empty, ErrorBox, Loading, Panel, Semantics } from '../components/primitives';
import { hrefFor } from '../lib/router';
import { fecha, n, n1, rutFormat, titleCase, type Tone } from '../lib/format';

/* Gasto público y compras.
 *
 * La regla que ordena toda la pantalla: compras públicas y ejecución
 * presupuestaria son universos distintos y NO se suman. Van en bloques
 * separados, con su propio encabezado y su propio recuento, porque un total
 * combinado no describiría ninguna población real. */

const FAMILIA_LABEL: Record<string, string> = {
  CONCENTRACION: 'Concentración',
  TRAYECTORIA: 'Trayectoria',
  CONVERGENCIA: 'Convergencia',
  PRECIOS: 'Precios',
  COMPETENCIA: 'Competencia',
  TRAZABILIDAD: 'Trazabilidad',
  PROVEEDOR: 'Perfil de proveedor',
};
const familia = (f: string) => FAMILIA_LABEL[f] ?? titleCase(f.replace(/_/g, ' '));

const SEV_LABEL: Record<string, string> = {
  CRITICAL: 'Crítica', HIGH: 'Alta', MEDIUM: 'Media', LOW: 'Baja',
};
const SEV_TONE: Record<string, Tone> = {
  CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'watch',
};
const sevLabel = (s: string) => SEV_LABEL[s] ?? titleCase(s);
const sevTone = (s: string | null): Tone => SEV_TONE[s ?? ''] ?? 'none';

const TIPO_LABEL: Record<string, string> = {
  BUYER_CONCENTRATION: 'Concentración del comprador',
  SUPPLIER_ACCELERATION: 'Aceleración del proveedor',
  PAIR_ACCELERATION: 'Aceleración del par',
  PRICE_ANOMALY: 'Precio atípico',
  CONVERGENCE: 'Convergencia de señales',
};
/** El productor ya escribe el titular en español; el código solo se traduce
 *  cuando falta, para no mostrar nunca un identificador crudo. */
const tituloHallazgo = (f: { title: string | null; finding_type: string }) =>
  f.title ?? TIPO_LABEL[f.finding_type] ?? titleCase(f.finding_type.replace(/_/g, ' '));

type BadgeTone = Tone | 'neutral' | 'present' | 'absent' | 'unknown';

/** Las marcas del par llegan del productor sin tildes y en mayúsculas. */
const FLAG_LABEL: Record<string, string> = {
  CONCENTRACION: 'Concentración',
  ACELERACION: 'Aceleración',
  PRECIO: 'Precio',
  CONVERGENCIA: 'Convergencia',
};
const flagLabel = (f: string) => FLAG_LABEL[f] ?? titleCase(f.replace(/_/g, ' '));

const ESTADO: Record<string, { label: string; tone: BadgeTone }> = {
  AVAILABLE: { label: 'Disponible', tone: 'present' },
  PARTIAL: { label: 'Parcial', tone: 'medium' },
  REQUIRES_SOURCE: { label: 'Requiere fuente', tone: 'none' },
};

/** Los montos de compras públicas llegan en pesos y llegan grandes: un billón
 *  escrito con separadores no se lee de un vistazo durante un barrido. */
function clp(v: number | null | undefined): string {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return `$${n1(v / 1e12)} bill.`;
  if (a >= 1e9) return `$${n1(v / 1e9)} mil M`;
  if (a >= 1e6) return `$${n1(v / 1e6)} M`;
  return `$${n(Math.round(v))}`;
}

const pctShare = (v: number | null | undefined) => (v == null ? '—' : `${n1(v * 100)}%`);

/** El HHI vive entre 0 y 1 y suele ser pequeño: con un decimal, 0,042 se
 *  imprimiría como «0» y parecería un dato faltante. */
const hhiFmt = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('es-CL', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** El proveedor casi nunca trae razón social: la fuente publica 39 nombres para
 *  72.802 RUTs. Mostrar "—" perdería el único identificador que sí existe. */
function actorNombre(label: string | null | undefined, rut: string | null | undefined) {
  if (label) return titleCase(label);
  if (rut) return rutFormat(rut);
  return 'sin identificar';
}

export function GastoPublico({
  actor, familiaInicial, onNavigate,
}: {
  actor?: { id: string; role: 'BUYER' | 'SUPPLIER' };
  familiaInicial?: string;
  onNavigate: (hash: string) => void;
}) {
  if (actor) return <ActorDetalle actorId={actor.id} role={actor.role} onNavigate={onNavigate} />;
  return <Resumen familiaInicial={familiaInicial} onNavigate={onNavigate} />;
}

/* ───────────────────────────────────────────────────────────────── resumen */

function Resumen({
  familiaInicial, onNavigate,
}: {
  familiaInicial?: string;
  onNavigate: (hash: string) => void;
}) {
  const { data, error, loading, reload } = useRpc<SpendOverview>('obs_spend_overview', {});

  if (loading) return <Loading label="Leyendo el corte de compras públicas…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Empty title="Sin corte de compras publicado" />;

  const c = data.corte;

  if (!data.disponible || !c) {
    return (
      <div className="fade-in">
        <header className="view-head">
          <h1 className="view-title">Gasto público y compras</h1>
        </header>
        <Empty
          title="El corte de compras no está disponible"
          hint="El puente hacia el pipeline de perfilado no entregó datos en el último refresco. Las señales de ejecución presupuestaria siguen publicándose por separado."
        />
      </div>
    );
  }

  const ing = (c.ingested ?? {}) as Record<string, unknown>;
  const errores = Array.isArray(ing.errores) ? (ing.errores as string[]) : [];
  const uni = c.universe ?? {};
  const totalHallazgos = data.severidades.reduce((s, x) => s + x.hallazgos, 0);

  return (
    <div className="fade-in">
      <header className="view-head">
        <h1 className="view-title">Gasto público y compras</h1>
        <p className="view-lede">
          Dos lecturas que no se suman. <strong>Compras públicas</strong> describe la
          relación entre organismos compradores y proveedores en ChileCompra;{' '}
          <strong>ejecución presupuestaria</strong> describe el devengo de los organismos.
          Poblaciones distintas, grano distinto, fuente distinta. Lo que se publica aquí
          son patrones que ordenan una revisión, no irregularidades acreditadas.
        </p>
      </header>

      <Panel
        title="Corte vigente"
        meta={`origen ${c.source_snapshot_id ?? '—'}`}
      >
        <div className="grid grid-4" style={{ gap: 14 }}>
          <Stat
            label="Ventana observada"
            value={`${c.window_months ?? '—'} meses`}
            foot={`${fecha(c.period_start)} → ${fecha(c.period_end)}`}
          />
          <Stat
            label="Monto en órdenes"
            value={clp(c.amount_total_clp)}
            foot={`${n(c.order_count)} órdenes de compra`}
          />
          <Stat
            label="Organismos compradores"
            value={n(c.buyer_count)}
            foot={`${n(uni.pairs_total ?? c.pair_count)} pares comprador–proveedor`}
          />
          <Stat
            label="Proveedores"
            value={n(c.supplier_count)}
            foot={`${n(uni.findings_total ?? totalHallazgos)} hallazgos calculados`}
          />
        </div>
        <div className="note" style={{ marginTop: 14 }}>
          Los hallazgos se publican completos. Actores y pares se acotan a{' '}
          <span className="num">{n(Number(ing.cap_actors ?? 0))}</span> por prioridad de
          revisión: de {n(uni.suppliers_total)} proveedores y {n(uni.pairs_total)} pares
          del universo, aquí viven {n(Number(ing.suppliers ?? 0))} y{' '}
          {n(Number(ing.pairs ?? 0))}. El Observatorio publica lo que se mira, no el libro
          mayor completo.
          {errores.length > 0 && (
            <>
              {' '}
              <span style={{ color: 'var(--sig-high)' }}>
                El último traspaso reportó: {errores.join(', ')}.
              </span>
            </>
          )}
        </div>
      </Panel>

      {/* ───────────────────────────── bloque 1: compras públicas */}
      <SectionTitle
        title="Compras públicas"
        sub="ChileCompra · órdenes de compra y licitaciones · grano comprador–proveedor"
      />

      <div className="grid grid-main" style={{ marginBottom: 16 }}>
        <Panel title="Hallazgos por familia" meta="clic para filtrar el listado">
          <Bars
            data={data.familias.map((f) => ({
              label: familia(f.family),
              value: f.hallazgos,
              sub: `${n(f.urgentes)} urg.`,
            }))}
            onPick={(label) => {
              const found = data.familias.find((f) => familia(f.family) === label);
              if (found) onNavigate(`#/gasto?familia=${encodeURIComponent(found.family)}`);
            }}
          />
          <div className="note" style={{ marginTop: 14 }}>
            «Urgentes» son los hallazgos en banda crítica o alta. La familia describe qué
            se midió —concentración, trayectoria, precios o convergencia de varias— y no
            un grado de sospecha.
          </div>
        </Panel>

        <Panel title="Severidad" meta={`${n(totalHallazgos)} hallazgos`}>
          <Bars
            data={data.severidades.map((s) => ({
              label: sevLabel(s.severity_band),
              value: s.hallazgos,
              tone: sevTone(s.severity_band),
            }))}
          />
          <div className="note" style={{ marginTop: 14 }}>
            La banda combina materialidad y cuán atípico es el patrón frente a los pares
            del mismo universo. Es un orden de atención.
          </div>
        </Panel>
      </div>

      <Panel title="Materialidad por familia" pad={false}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Familia</th>
                <th className="right">Hallazgos</th>
                <th className="right">Urgentes</th>
                <th className="right">Materialidad</th>
                <th className="right">Prioridad media</th>
              </tr>
            </thead>
            <tbody>
              {data.familias.map((f) => (
                <tr
                  key={f.family}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onNavigate(`#/gasto?familia=${encodeURIComponent(f.family)}`)}
                >
                  <td style={{ fontWeight: 600 }}>{familia(f.family)}</td>
                  <td className="right num">{n(f.hallazgos)}</td>
                  <td className="right num">{n(f.urgentes)}</td>
                  <td className="right num" style={{ fontWeight: 650 }}>
                    {f.materialidad_mm == null ? '—' : `$${n1(f.materialidad_mm)} mil M`}
                  </td>
                  <td className="right num" style={{ color: 'var(--ink-3)' }}>
                    {n1(f.prioridad_media)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="note" style={{ margin: 14 }}>
          La materialidad no se suma entre familias: un mismo par puede aparecer en
          concentración y en convergencia, y sumarlas contaría dos veces el mismo dinero.
        </div>
      </Panel>

      <div style={{ marginTop: 16 }}>
        {/* La familia viaja en la URL para que el filtro sea compartible; la
            clave remonta solo el listado, no el resumen completo. */}
        <FeedHallazgos
          key={familiaInicial ?? 'todas'}
          familiaInicial={familiaInicial}
          onNavigate={onNavigate}
        />
      </div>

      <div className="grid grid-main" style={{ marginTop: 16 }}>
        <Panel title="Qué se puede afirmar hoy" meta="estado real de cada hipótesis" pad={false}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Hipótesis</th><th>Familia</th><th>Estado</th><th>Fuentes que faltan</th>
                </tr>
              </thead>
              <tbody>
                {c.readiness.map((h) => {
                  const e = ESTADO[h.status] ?? { label: h.status, tone: 'none' as BadgeTone };
                  const faltan = h.required_sources.filter(
                    (s) => !h.available_sources.includes(s),
                  );
                  return (
                    <tr key={h.hypothesis_id}>
                      <td style={{ minWidth: 230 }}>
                        <div style={{ fontWeight: 600 }}>{h.title}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 2 }}>
                          {h.explanation}
                        </div>
                      </td>
                      <td style={{ color: 'var(--ink-3)' }}>{familia(h.family)}</td>
                      <td><Badge tone={e.tone} dot>{e.label}</Badge></td>
                      <td className="mono" style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
                        {faltan.length ? faltan.join(', ') : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="note" style={{ margin: 14 }}>
            Una hipótesis sin su fuente se declara, no se simula. Las marcadas «requiere
            fuente» no producen ningún hallazgo en este corte: su ausencia en la pantalla
            es un vacío de datos, no un resultado negativo.
          </div>
        </Panel>

        <Panel title="Identificación de los actores">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            <Meter
              value={(data.cobertura.compradores_en_universo / Math.max(1, data.cobertura.compradores)) * 100}
              label="Compradores en el universo observado"
              hint={`${n(data.cobertura.compradores_en_universo)} de ${n(data.cobertura.compradores)} resuelven por RUT contra una entidad del Observatorio.`}
              tone="var(--accent)"
            />
            <Meter
              value={(data.cobertura.proveedores_en_universo / Math.max(1, data.cobertura.proveedores)) * 100}
              label="Proveedores en el universo observado"
              hint={`${n(data.cobertura.proveedores_en_universo)} de ${n(data.cobertura.proveedores)}. La mayoría de los proveedores del Estado no es sujeto obligado, así que una cobertura baja aquí es lo esperable, no una falla.`}
              tone="var(--accent)"
            />
            <Meter
              value={(data.cobertura.proveedores_con_nombre / Math.max(1, data.cobertura.proveedores)) * 100}
              label="Proveedores con razón social"
              hint={`${n(data.cobertura.proveedores_con_nombre)} de ${n(data.cobertura.proveedores)}. La fuente publica razón social para muy pocos proveedores; cuando no hay nombre, el RUT es el identificador y desde él se abre la búsqueda en cascada.`}
              tone="var(--accent)"
            />
          </div>
        </Panel>
      </div>

      {/* ───────────────────── bloque 2: ejecución presupuestaria */}
      <SectionTitle
        title="Ejecución presupuestaria y contraloría"
        sub="Presupuesto Abierto y CGR · grano organismo · universo distinto: no se suma con lo anterior"
      />

      <Panel title="Señales publicadas" pad={false}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Fuente</th>
                <th className="right">Señales</th>
                <th className="right">Severidad alta</th>
                <th className="right">Con entidad resuelta</th>
                <th className="right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {data.presupuesto.map((p) => (
                <tr key={p.source_code}>
                  <td style={{ fontWeight: 600 }}>{titleCase(p.source_code.replace(/_/g, ' '))}</td>
                  <td className="right num">{n(p.señales)}</td>
                  <td className="right num" style={{ color: p.altas > 0 ? 'var(--sig-high)' : undefined }}>
                    {n(p.altas)}
                  </td>
                  <td className="right num">{n(p.con_entidad)}</td>
                  <td className="right num">
                    {p.monto_mm == null ? '—' : `$${n1(p.monto_mm)} mil M`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="note" style={{ margin: 14 }}>
          Las audiencias de lobby se excluyen deliberadamente: llegan sin comprador, sin
          proveedor y sin monto, así que publicarlas junto a señales con materialidad las
          haría parecer equivalentes cuando no lo son.
        </div>
      </Panel>

      <div style={{ marginTop: 24 }}>
        <Semantics>
          <strong>Dos universos, un mismo corte.</strong> {data.semantics}
        </Semantics>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────── feed de hallazgos */

const PAGINA = 25;

function FeedHallazgos({
  familiaInicial, onNavigate,
}: {
  familiaInicial?: string;
  onNavigate: (hash: string) => void;
}) {
  const [fam, setFam] = useState<string | null>(familiaInicial ?? null);
  const [sev, setSev] = useState<string | null>(null);
  const [pagina, setPagina] = useState(0);

  const args = useMemo(
    () => ({ p_family: fam, p_severity: sev, p_limit: PAGINA, p_offset: pagina * PAGINA }),
    [fam, sev, pagina],
  );
  const { data, error, loading, reload } = useRpc<SpendFinding[]>('obs_spend_finding_feed', args);

  const total = data?.[0]?.total_count ?? 0;
  const paginas = Math.ceil(total / PAGINA);

  const filtrar = (setter: (v: string | null) => void, value: string | null) => {
    setter(value);
    setPagina(0);
  };

  return (
    <Panel
      title="Hallazgos"
      meta={loading ? 'consultando…' : `${n(total)} en el filtro actual`}
      pad={false}
    >
      <div className="filters" style={{ padding: '12px 14px 0', flexWrap: 'wrap' }}>
        <button className="chip" data-on={fam === null} onClick={() => filtrar(setFam, null)}>
          Todas las familias
        </button>
        {['CONCENTRACION', 'TRAYECTORIA', 'PRECIOS', 'CONVERGENCIA'].map((f) => (
          <button key={f} className="chip" data-on={fam === f} onClick={() => filtrar(setFam, f)}>
            {familia(f)}
          </button>
        ))}
      </div>
      <div className="filters" style={{ padding: '8px 14px 12px', flexWrap: 'wrap' }}>
        <button className="chip" data-on={sev === null} onClick={() => filtrar(setSev, null)}>
          Toda severidad
        </button>
        {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => (
          <button key={s} className="chip" data-on={sev === s} onClick={() => filtrar(setSev, s)}>
            {sevLabel(s)}
          </button>
        ))}
      </div>

      {error && <div style={{ padding: 14 }}><ErrorBox error={error} onRetry={reload} /></div>}

      {!error && (data?.length ?? 0) === 0 && !loading && (
        <div style={{ padding: 14 }}>
          <Empty title="Ningún hallazgo con ese filtro" />
        </div>
      )}

      {(data?.length ?? 0) > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Hallazgo</th>
                <th>Comprador</th>
                <th>Proveedor</th>
                <th className="right">Materialidad</th>
                <th className="right">Prioridad</th>
              </tr>
            </thead>
            <tbody>
              {data!.map((f) => (
                <tr key={f.finding_id}>
                  <td style={{ minWidth: 250 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Badge tone={sevTone(f.severity_band)} dot>
                        {sevLabel(f.severity_band)}
                      </Badge>
                      <span style={{ fontWeight: 600 }}>{tituloHallazgo(f)}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
                        {familia(f.family)}
                      </span>
                    </div>
                    {f.summary && (
                      <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 3 }}>
                        {f.summary}
                      </div>
                    )}
                  </td>
                  <td>
                    <ActorLink
                      id={f.buyer_id}
                      label={f.buyer_label}
                      entityId={f.buyer_entity_id}
                      role="BUYER"
                      onNavigate={onNavigate}
                    />
                  </td>
                  <td>
                    <ActorLink
                      id={f.supplier_id}
                      label={f.supplier_label}
                      entityId={f.supplier_entity_id}
                      role="SUPPLIER"
                      onNavigate={onNavigate}
                    />
                  </td>
                  <td className="right num">{clp(f.materiality_clp)}</td>
                  <td className="right num" style={{ fontWeight: 650 }}>{n1(f.review_priority)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {paginas > 1 && (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, padding: 14, borderTop: '1px solid var(--line)',
          }}
        >
          <button className="chip" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>
            ← Anterior
          </button>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            Página <span className="num">{pagina + 1}</span> de{' '}
            <span className="num">{n(paginas)}</span>
          </span>
          <button
            className="chip"
            disabled={pagina + 1 >= paginas}
            onClick={() => setPagina((p) => p + 1)}
          >
            Siguiente →
          </button>
        </div>
      )}
    </Panel>
  );
}

function ActorLink({
  id, label, entityId, role, onNavigate,
}: {
  id: string | null | undefined;
  label: string | null | undefined;
  entityId: string | null | undefined;
  role: 'BUYER' | 'SUPPLIER';
  onNavigate: (hash: string) => void;
}) {
  if (!id) return <span style={{ color: 'var(--ink-4)' }}>—</span>;
  const seg = role === 'BUYER' ? 'comprador' : 'proveedor';
  return (
    <div style={{ minWidth: 150 }}>
      <button
        onClick={() => onNavigate(`#/gasto/${seg}/${encodeURIComponent(id)}`)}
        style={{
          background: 'none', border: 0, padding: 0, cursor: 'pointer',
          color: 'var(--ink-1)', fontWeight: 600, textAlign: 'left', fontSize: 12.5,
        }}
      >
        {actorNombre(label, id)}
      </button>
      <div style={{ fontSize: 11, marginTop: 2, display: 'flex', gap: 8, alignItems: 'center' }}>
        {label && <span className="mono" style={{ color: 'var(--ink-4)' }}>{rutFormat(id)}</span>}
        {entityId ? (
          <a href={hrefFor({ view: 'ficha', entityId })} style={{ color: 'var(--accent)' }}>
            ficha
          </a>
        ) : (
          <a href={hrefFor({ view: 'entidades', q: id })} style={{ color: 'var(--ink-3)' }}>
            buscar
          </a>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────── ficha del actor */

function ActorDetalle({
  actorId, role, onNavigate,
}: {
  actorId: string;
  role: 'BUYER' | 'SUPPLIER';
  onNavigate: (hash: string) => void;
}) {
  const { data, error, loading, reload } = useRpc<SpendActorDetail | null>(
    'obs_spend_actor_detail', { p_actor_id: actorId, p_role: role },
  );

  if (loading) return <Loading label="Abriendo el actor…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) {
    return (
      <div className="fade-in">
        <VolverGasto onNavigate={onNavigate} />
        <Empty
          title={`${rutFormat(actorId)} no está en el corte publicado`}
          hint="Actores y pares se acotan a los 3.000 de mayor prioridad de revisión. Que no aparezca aquí no significa que no tenga compras públicas."
        />
      </div>
    );
  }

  const a = data.actor;
  const esComprador = role === 'BUYER';
  const contraparteLabel = esComprador ? 'proveedor' : 'comprador';
  const publicados = data.contrapartes.length;
  const totales = a.counterpart_count ?? 0;

  return (
    <div className="fade-in">
      <VolverGasto onNavigate={onNavigate} />

      <header className="ficha-head">
        <div style={{ minWidth: 0, flex: '1 1 340px' }}>
          <h1 className="ficha-title">{actorNombre(a.label, a.actor_id)}</h1>
          <div className="ficha-sub">
            <span className="mono">{rutFormat(a.actor_id)}</span>
            <span>{esComprador ? 'Organismo comprador' : 'Proveedor del Estado'}</span>
            {a.active_months != null && <span>{a.active_months} meses activos</span>}
            {a.first_seen && <span>desde {fecha(a.first_seen)}</span>}
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {a.entity_id ? (
              <a className="chip" href={hrefFor({ view: 'ficha', entityId: a.entity_id })}>
                Abrir ficha de observación
              </a>
            ) : (
              <a className="chip" href={hrefFor({ view: 'entidades', q: a.actor_id })}>
                Buscar este RUT en todas las fuentes
              </a>
            )}
          </div>
        </div>

        <div className="ficha-scores">
          <ScoreTile value={clp(a.amount_12m)} label="Monto 12 m" hint={`${n(a.order_count_12m)} órdenes`} />
          <ScoreTile
            value={pctShare(a.top_counterpart_share)}
            label={`Principal ${contraparteLabel}`}
            hint={a.top_counterpart_id ? rutFormat(a.top_counterpart_id) : undefined}
          />
          <ScoreTile
            value={n1(a.review_priority)}
            label="Prioridad"
            hint="orden de revisión, no juicio"
          />
        </div>
      </header>

      <div className="grid grid-main" style={{ marginTop: 16 }}>
        <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
          <Panel
            title={`Contrapartes · ${n(publicados)}`}
            meta={
              totales > publicados
                ? `de ${n(totales)} en el universo`
                : 'ordenadas por prioridad'
            }
            pad={false}
          >
            {publicados === 0 ? (
              <div style={{ padding: 14 }}>
                <Empty
                  title="Sin pares publicados para este actor"
                  hint="Los pares comprador–proveedor se acotan a los 3.000 de mayor prioridad del corte."
                />
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{esComprador ? 'Proveedor' : 'Comprador'}</th>
                      <th className="right">Monto 12 m</th>
                      <th className="right">Órdenes</th>
                      <th className="right">Del gasto</th>
                      <th className="right">Aceleración</th>
                      <th>Señales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.contrapartes.map((p) => {
                      const cpId = esComprador ? p.supplier_id : p.buyer_id;
                      const cpLabel = esComprador ? p.supplier_label : p.buyer_label;
                      const cpEnt = esComprador ? p.supplier_entity_id : p.buyer_entity_id;
                      const flags = Array.isArray(p.flags) ? (p.flags as string[]) : [];
                      return (
                        <tr key={p.pair_id}>
                          <td>
                            <ActorLink
                              id={cpId}
                              label={cpLabel}
                              entityId={cpEnt}
                              role={esComprador ? 'SUPPLIER' : 'BUYER'}
                              onNavigate={onNavigate}
                            />
                          </td>
                          <td className="right num">{clp(p.amount_12m)}</td>
                          <td className="right num" style={{ color: 'var(--ink-3)' }}>
                            {n(p.order_count_12m)}
                          </td>
                          <td className="right num" style={{ fontWeight: 650 }}>
                            {pctShare(esComprador ? p.buyer_share : p.supplier_share)}
                          </td>
                          <td className="right num">
                            {p.acceleration_ratio == null ? '—' : `${n1(p.acceleration_ratio)}×`}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                              {flags.map((fl) => (
                                <Badge key={fl} tone="neutral">{flagLabel(fl)}</Badge>
                              ))}
                              {flags.length === 0 && (
                                <span style={{ color: 'var(--ink-4)' }}>—</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="note" style={{ margin: 14 }}>
              «Del gasto» mide la participación dentro de las compras públicas{' '}
              <em>observadas</em>. Para un proveedor no es dependencia sobre sus ventas
              totales: el pipeline no ve su facturación privada.
            </div>
          </Panel>

          {data.hallazgos.length > 0 && (
            <Panel title={`Hallazgos · ${n(data.hallazgos.length)}`} pad={false}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Hallazgo</th>
                    <th className="right">Materialidad</th>
                    <th className="right">Prioridad</th>
                  </tr>
                </thead>
                <tbody>
                  {data.hallazgos.map((h) => (
                    <tr key={h.finding_id}>
                      <td>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Badge tone={sevTone(h.severity_band)} dot>
                            {sevLabel(h.severity_band)}
                          </Badge>
                          <span style={{ fontWeight: 600 }}>{tituloHallazgo(h)}</span>
                          <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
                            {familia(h.family)}
                          </span>
                        </div>
                        {h.summary && (
                          <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 3 }}>
                            {h.summary}
                          </div>
                        )}
                      </td>
                      <td className="right num">{clp(h.materiality_clp)}</td>
                      <td className="right num" style={{ fontWeight: 650 }}>
                        {n1(h.review_priority)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>

        <div className="grid" style={{ gap: 16, alignContent: 'start' }}>
          <Panel title="Forma de la relación comercial">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
              <Meter
                value={(a.top_counterpart_share ?? 0) * 100}
                label={`Concentración en el principal ${contraparteLabel}`}
                hint={`HHI ${hhiFmt(a.hhi)} · percentil ${pctShare(a.concentration_percentile)} frente a sus pares.`}
                tone="var(--accent)"
              />
              {a.materiality_percentile != null && (
                <Meter
                  value={a.materiality_percentile * 100}
                  label="Percentil de materialidad"
                  hint="Posición del monto observado frente al resto del universo."
                  tone="var(--accent)"
                />
              )}
              {a.growth_percentile != null && (
                <Meter
                  value={a.growth_percentile * 100}
                  label="Percentil de crecimiento"
                  hint={
                    a.growth_ratio == null
                      ? undefined
                      : `Últimos 6 meses frente a los 6 anteriores: ${n1(a.growth_ratio)}×.`
                  }
                  tone="var(--accent)"
                />
              )}
              <dl className="kv">
                <dt>Contrapartes</dt><dd className="num">{n(a.counterpart_count)}</dd>
                <dt>Órdenes 12 m</dt><dd className="num">{n(a.order_count_12m)}</dd>
                {a.active_months != null && (
                  <>
                    <dt>Meses activos</dt><dd className="num">{n(a.active_months)}</dd>
                  </>
                )}
                {a.first_seen && (<><dt>Primera orden</dt><dd>{fecha(a.first_seen)}</dd></>)}
                {a.last_seen && (<><dt>Última orden</dt><dd>{fecha(a.last_seen)}</dd></>)}
              </dl>
              {a.active_months == null && (
                // Callarlo dejaría tres guiones seguidos, que se leen como una
                // falla de datos en vez de como una ausencia esperada.
                <div className="note">
                  La fuente calcula trayectoria —meses activos, primera y última orden,
                  crecimiento— sólo para proveedores. Para un organismo comprador esas
                  columnas no existen en el corte.
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Cómo leer estos números">
            <div className="note">
              Un percentil alto significa «atípico frente a sus pares», no «irregular». La
              concentración puede reflejar un mercado con un solo proveedor capaz, y una
              aceleración puede reflejar un contrato grande y legítimo que empezó dentro de
              la ventana. Lo que estas cifras ordenan es a quién mirar primero.
            </div>
          </Panel>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <Semantics>
          <strong>Alcance.</strong> {data.semantics}
        </Semantics>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── piezas */

function VolverGasto({ onNavigate }: { onNavigate: (hash: string) => void }) {
  return (
    <nav style={{ marginBottom: 14, fontSize: 12.5 }}>
      <button
        onClick={() => onNavigate('#/gasto')}
        style={{ background: 'none', border: 0, color: 'var(--ink-3)', cursor: 'pointer', padding: 0 }}
      >
        ← Gasto público y compras
      </button>
    </nav>
  );
}

function SectionTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ margin: '28px 0 14px' }}>
      <h2
        style={{
          fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', margin: 0,
          display: 'flex', alignItems: 'center', gap: 10,
        }}
      >
        <i
          style={{
            width: 3, height: 15, borderRadius: 2, background: 'var(--accent)', flexShrink: 0,
          }}
        />
        {title}
      </h2>
      <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 4, paddingLeft: 13 }}>
        {sub}
      </div>
    </div>
  );
}

function ScoreTile({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div
      style={{
        minWidth: 122, padding: '12px 15px', borderRadius: 'var(--radius)',
        background: 'var(--bg-panel)', border: '1px solid var(--line)',
      }}
    >
      <div className="num" style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.035em' }}>
        {value}
      </div>
      <div
        style={{
          fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase',
          color: 'var(--ink-3)', fontWeight: 650, marginTop: 3,
        }}
      >
        {label}
      </div>
      {hint && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function Stat({ label, value, foot }: { label: string; value: string; foot?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value num">{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}
