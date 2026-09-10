import { useEffect, useMemo, useState } from 'react';
import { useRpc } from '../lib/rpc';
import { fecha, n, n1, rutFormat, titleCase } from '../lib/format';
import { Empty, ErrorBox, Loading } from './primitives';
import { RefMeter } from './charts';
import type {
  UafCohort, UafDossier, UafDossierSubject, UafMotive, UafSubjectRow,
} from '../lib/contracts';

export interface CohortRequest {
  cohort: UafCohort;
  value?: string | null;
  title: string;
  hint?: string;
}

const PAGE = 80;

/* LA FICHA DEL SUJETO
   ───────────────────
   El tablero da cifras; esto da nombres, y cada nombre da su lectura. La capa
   se abre encima para que el analista pase del cuánto al quiénes sin perder el
   punto del tablero desde donde preguntó.

   La regla de esta superficie: ningún número aparece solo. Un IPF sin la
   mediana de su sector no se puede leer; una banda de ventas sin saber dónde
   cae en su sector tampoco; un antecedente sin su fecha y su fuente no es un
   antecedente. Lo que no se puede comparar se dice que no se puede comparar,
   en vez de dibujar una referencia inventada. */

const MOTIVE_LABEL: Record<UafMotive, string> = {
  SANCION_RECIENTE:  'Sanción últimos 5 años',
  SANCION_HISTORICA: 'Sanción histórica',
  TERMINO_GIRO:      'Término de giro',
  IPF_ALTA:          'IPF alta o muy alta',
  SECTOR_SIN_ROS:    'Sector sin ROS 2021-2025',
  GIRO_ATIPICO:      'Giro atípico en su sector',
  SIN_TERRITORIO:    'Sin territorio observado',
};

/** El estado ante el SII describe el ciclo de vida tributario. No mide
 *  cumplimiento de la obligación de reportar, y el rótulo lo dice. */
const SII_STATE: Record<string, { label: string; tone: string }> = {
  ACTIVE_AS_PUBLISHED:     { label: 'Activo ante el SII',   tone: 'var(--present)' },
  TERMINATED_AS_PUBLISHED: { label: 'Término de giro',      tone: 'var(--sig-high)' },
  SIN_PERFIL_SII:          { label: 'Sin perfil de persona jurídica', tone: 'var(--unknown)' },
};

const IPF_TONE: Record<string, string> = {
  MUY_ALTA: 'var(--sig-critical)',
  ALTA:     'var(--sig-high)',
  MEDIA:    'var(--sig-medium)',
  BAJA:     'var(--present)',
  MUY_BAJA: 'var(--present)',
};

const bandaIpf = (b: string | null | undefined) =>
  b ? titleCase(b.replace(/_/g, ' ')) : null;

/** El productor entrega el método de resolución en clave. Un antecedente que
 *  llegó por criterio conservador puede venir emitido bajo otra razón social
 *  del mismo RUT, así que la advertencia va en español y junto al hecho. */
function identityNote(status: string): string {
  switch (status) {
    case 'RESOLVED_CONSERVATIVE':
      return 'Vinculado por RUT con criterio conservador: el documento puede estar emitido bajo otra razón social del mismo contribuyente. Verifica la identidad antes de concluir.';
    case 'RESOLVED_EXACT_NAME':
      return 'Vinculado por coincidencia exacta de nombre, no por RUT. Verifica la identidad antes de concluir.';
    default:
      return 'Vínculo de identidad establecido por el productor. Verifica antes de concluir.';
  }
}

type Orden = 'relevancia' | 'ipf' | 'antecedentes' | 'antiguedad' | 'nombre';

const ORDENES: { key: Orden; label: string }[] = [
  { key: 'relevancia',   label: 'Relevancia' },
  { key: 'ipf',          label: 'IPF' },
  { key: 'antecedentes', label: 'Antecedentes' },
  { key: 'antiguedad',   label: 'Antigüedad' },
  { key: 'nombre',       label: 'Nombre' },
];

export function CohortDrawer({
  request,
  onClose,
  onOpenEntity,
}: {
  request: CohortRequest;
  onClose: () => void;
  onOpenEntity?: (entityId: string) => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  const [openRut, setOpenRut] = useState<string | null>(null);
  const [orden, setOrden] = useState<Orden>('relevancia');
  const [filtro, setFiltro] = useState('');

  const { data, error, loading, reload } = useRpc<UafSubjectRow[]>('obs_uaf_cohort', {
    p_cohort: request.cohort,
    p_value: request.value ?? null,
    p_limit: limit,
    p_offset: 0,
  });

  useEffect(() => {
    setLimit(PAGE);
    setOpenRut(null);
    setOrden('relevancia');
    setFiltro('');
  }, [request.cohort, request.value]);

  // Cerrar con Escape es lo que espera cualquiera que abra una capa encima.
  // El fondo se congela mientras tanto: si sigue desplazandose bajo el velo, el
  // analista pierde el punto del tablero desde donde abrio la lista.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previo;
    };
  }, [onClose]);

  const total = data?.[0]?.total_count ?? 0;
  const cargadas = data?.length ?? 0;

  /* El orden y el filtro operan sobre lo que ya está en pantalla. El servidor
     resuelve el corte y entrega hasta 200 filas; reordenar aquí no cambia esa
     selección, y la barra lo dice para que nadie lea el primer lugar de la
     lista como el primero del padrón. */
  const visibles = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    const rows = (data ?? []).filter((s) => {
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.rut.toLowerCase().includes(q) ||
        (s.uaf_sector ?? '').toLowerCase().includes(q) ||
        (s.commune ?? '').toLowerCase().includes(q) ||
        (s.region ?? '').toLowerCase().includes(q)
      );
    });
    const arr = [...rows];
    switch (orden) {
      case 'ipf':
        arr.sort((a, b) => (b.ipf_score ?? -1) - (a.ipf_score ?? -1));
        break;
      case 'antecedentes':
        arr.sort((a, b) => (b.evidence_count ?? 0) - (a.evidence_count ?? 0));
        break;
      case 'antiguedad':
        arr.sort((a, b) => (b.activity_years ?? -1) - (a.activity_years ?? -1));
        break;
      case 'nombre':
        arr.sort((a, b) => a.name.localeCompare(b.name, 'es'));
        break;
      default:
        break; // relevancia = el orden que resolvió el servidor
    }
    return arr;
  }, [data, filtro, orden]);

  /* Composición de lo cargado, no del corte completo: contar sobre 40 filas y
     rotularlo como el total sería una cifra falsa. El rótulo dice sobre qué
     universo se cuenta. */
  const mezcla = useMemo(() => {
    const rows = data ?? [];
    if (!rows.length) return null;
    return {
      sancionados: rows.filter((s) => s.sanction_evidence_count > 0).length,
      terminados:  rows.filter((s) => s.sii_status === 'TERMINATED_AS_PUBLISHED').length,
      ipfAlto:     rows.filter((s) => s.ipf_band === 'ALTA' || s.ipf_band === 'MUY_ALTA').length,
      conMotivo:   rows.filter((s) => s.attention_motive != null).length,
    };
  }, [data]);

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={request.title}>
        <header className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <h2>{request.title}</h2>
            <p>
              {loading && !data
                ? 'Consultando el padrón…'
                : `${n(total)} sujeto${total === 1 ? '' : 's'} obligado${total === 1 ? '' : 's'}`}
              {request.hint && ` · ${request.hint}`}
            </p>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>

        {!error && cargadas > 0 && (
          <div className="drawer-tools">
            <div className="drawer-find">
              <input
                type="search"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                placeholder="Filtrar por nombre, RUT, sector o comuna"
                aria-label="Filtrar los sujetos cargados"
              />
              {filtro && (
                <button onClick={() => setFiltro('')} aria-label="Limpiar filtro">×</button>
              )}
            </div>
            <div className="seg seg-sm" role="group" aria-label="Ordenar">
              {ORDENES.map((o) => (
                <button
                  key={o.key}
                  data-on={orden === o.key}
                  onClick={() => setOrden(o.key)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {mezcla && (
              <div className="drawer-mix">
                <span>
                  {filtro
                    ? `${n(visibles.length)} de ${n(cargadas)} en pantalla`
                    : `${n(cargadas)} en pantalla de ${n(total)}`}
                </span>
                {mezcla.conMotivo > 0 && <span><i data-t="motivo" />{n(mezcla.conMotivo)} con motivo</span>}
                {mezcla.sancionados > 0 && <span><i data-t="sancion" />{n(mezcla.sancionados)} con sanción</span>}
                {mezcla.terminados > 0 && <span><i data-t="termino" />{n(mezcla.terminados)} con término</span>}
                {mezcla.ipfAlto > 0 && <span><i data-t="ipf" />{n(mezcla.ipfAlto)} IPF alta</span>}
              </div>
            )}
          </div>
        )}

        <div className="drawer-body">
          {error ? (
            <ErrorBox error={error} onRetry={reload} />
          ) : loading && !data ? (
            <Loading label="Leyendo el padrón…" />
          ) : !data?.length ? (
            <Empty
              title="Sin sujetos en este corte"
              hint="Ningún sujeto obligado cumple esta condición en el snapshot vigente."
            />
          ) : !visibles.length ? (
            <Empty
              title="El filtro no deja ninguno"
              hint={`Ninguno de los ${n(cargadas)} sujetos cargados coincide con «${filtro}».`}
            />
          ) : (
            <>
              <div className="subject-columns" aria-hidden="true">
                <span className="subject-columns-main">
                  <span>Entidad · identificación · ubicación</span>
                  <span>Marcas</span>
                </span>
                <span>IPF</span>
                <span />
              </div>
              <div className="rows">
                {visibles.map((s) => (
                  <SubjectRow
                    key={s.rut}
                    subject={s}
                    open={openRut === s.rut}
                    onToggle={() => setOpenRut(openRut === s.rut ? null : s.rut)}
                    onOpenEntity={onOpenEntity}
                  />
                ))}
              </div>
              {cargadas < total && !filtro && (
                <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
                  <button className="btn" onClick={() => setLimit((v) => Math.min(200, v + PAGE))}>
                    {limit >= 200
                      ? 'Máximo de 200 en pantalla · afina el corte'
                      : `Ver más · ${n(total - cargadas)} restantes`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function Chip({
  children, tone, title,
}: {
  children: React.ReactNode; tone?: string; title?: string;
}) {
  return (
    <span className="chip" style={tone ? { ['--chip-tone' as string]: tone } : undefined} title={title}>
      {children}
    </span>
  );
}

function SubjectRow({
  subject: s,
  open,
  onToggle,
  onOpenEntity,
}: {
  subject: UafSubjectRow;
  open: boolean;
  onToggle: () => void;
  onOpenEntity?: (entityId: string) => void;
}) {
  const estado = s.sii_status ? SII_STATE[s.sii_status] : undefined;
  const ipfTone = s.ipf_band ? IPF_TONE[s.ipf_band] ?? 'var(--accent)' : 'var(--ink-4)';

  return (
    <div className="subject" data-open={open}>
      <button className="subject-head" onClick={onToggle} aria-expanded={open}>
        <span className="subject-main">
          <span className="subject-name">{s.name}</span>
          <span className="subject-meta">
            <span className="rut">{rutFormat(s.rut)}</span>
            {s.uaf_sector && <span>{titleCase(s.uaf_sector)}</span>}
            {(s.commune || s.region) && (
              <span>{s.commune ? `${s.commune}, ${s.region}` : s.region}</span>
            )}
          </span>
          <span className="subject-chips">
            {s.attention_motive && (
              <Chip tone="var(--sig-critical)" title="Motivo de mayor precedencia por el que entra a revisión">
                {MOTIVE_LABEL[s.attention_motive] ?? s.attention_motive}
              </Chip>
            )}
            {estado && s.sii_status !== 'ACTIVE_AS_PUBLISHED' && (
              <Chip tone={estado.tone}>{estado.label}</Chip>
            )}
            {s.sanction_evidence_count > 0 && (
              <Chip tone="var(--sig-high)" title="Antecedentes sancionatorios abribles">
                {n(s.sanction_evidence_count)} sanción{s.sanction_evidence_count === 1 ? '' : 'es'}
              </Chip>
            )}
            {s.press_evidence_count > 0 && (
              <Chip tone="var(--sig-watch)">{n(s.press_evidence_count)} en prensa</Chip>
            )}
            {s.is_osfl && <Chip tone="var(--unknown)">OSFL</Chip>}
            {s.is_state_supplier && <Chip tone="var(--accent)">Proveedor del Estado</Chip>}
          </span>
        </span>

        <span className="subject-ipf">
          {s.ipf_score != null ? (
            <>
              <span className="subject-ipf-num num" style={{ color: ipfTone }}>
                {n1(s.ipf_score)}
              </span>
              <span className="subject-ipf-bar">
                <i style={{ width: `${Math.max(2, Math.min(100, s.ipf_score))}%`, background: ipfTone }} />
              </span>
              <span className="subject-ipf-band">IPF {bandaIpf(s.ipf_band) ?? '—'}</span>
            </>
          ) : (
            <span className="subject-ipf-band">IPF sin medir</span>
          )}
        </span>
        <span className="subject-caret" aria-hidden>{open ? '▲' : '▼'}</span>
      </button>
      {open && <SubjectDossier rut={s.rut} entityId={s.entity_id} onOpenEntity={onOpenEntity} />}
    </div>
  );
}

function Tile({
  label, value, foot, tone,
}: {
  label: string; value: string; foot?: string; tone?: string;
}) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <b className="tile-value num" style={tone ? { color: tone } : undefined}>{value}</b>
      {foot && <span className="tile-foot">{foot}</span>}
    </div>
  );
}

/** El antecedente, tal como lo publica su fuente. Cuando la fuente no entrega
 *  enlace, se dice: ofrecer un link inexistente seria peor que no ofrecerlo. */
function SubjectDossier({
  rut,
  entityId,
  onOpenEntity,
}: {
  rut: string;
  entityId: string | null;
  onOpenEntity?: (entityId: string) => void;
}) {
  const { data, error, loading } = useRpc<UafDossier>('obs_uaf_subject_dossier', { p_rut: rut });

  if (loading) return <div className="dossier"><Loading label="Buscando antecedentes…" /></div>;
  if (error) return <div className="dossier"><ErrorBox error={error} /></div>;

  const ev = data?.evidence ?? [];
  const s = data?.subject as UafDossierSubject | null | undefined;
  const peers = data?.peers ?? null;
  const pos = data?.position ?? null;

  const ipfTone = s?.ipf_band ? IPF_TONE[s.ipf_band] ?? 'var(--accent)' : 'var(--accent)';
  const estado = s?.sii_status ? SII_STATE[s.sii_status] : undefined;

  /* Señales del perfil tributario. Sólo se dibujan las que están encendidas:
     una lista de "no" ocupa el mismo espacio y no dice nada. */
  const senales: { label: string; hint: string }[] = [];
  if (s?.sii_activity_changed) {
    senales.push({ label: 'Cambió de actividad', hint: 'el giro declarado ante el SII cambió respecto del corte anterior' });
  }
  if (s?.sii_region_changed) {
    senales.push({ label: 'Cambió de región', hint: 'la región tributaria cambió respecto del corte anterior' });
  }
  if ((s?.sii_signal_count ?? 0) > 0) {
    senales.push({ label: `${n(s!.sii_signal_count)} señal${s!.sii_signal_count === 1 ? '' : 'es'} del SII`, hint: 'marcas del propio perfil tributario, como amplitud del historial de domicilios' });
  }
  if ((s?.ownership_edge_count ?? 0) > 0) {
    senales.push({ label: `${n(s!.ownership_edge_count)} vínculo${s!.ownership_edge_count === 1 ? '' : 's'} societario${s!.ownership_edge_count === 1 ? '' : 's'}`, hint: 'aristas de propiedad observadas hacia otras entidades' });
  }
  if ((s?.activity_atypicality ?? 0) >= 0.9 && s?.activity_peer_share != null) {
    senales.push({
      label: `Giro atípico · ${n1(s.activity_peer_share * 100)}% de sus pares`,
      hint: 'su actividad principal es poco frecuente entre los inscritos del mismo sector obligado',
    });
  }

  return (
    <div className="dossier">
      {s && (
        <>
          {/* La fila ya rotula el motivo, el estado y las marcas. Aquí va lo
              que la fila no alcanza a decir: qué tipo de contribuyente es, de
              dónde sale su territorio y de qué corte viene la ficha. */}
          <div className="dossier-id">
            {s.entity_type && <Chip>{s.entity_type}</Chip>}
            {s.uaf_sector && <Chip tone="var(--accent)">{titleCase(s.uaf_sector)}</Chip>}
            {s.sii_termination_date && estado && (
              <span className="state-pill" style={{ ['--pill' as string]: estado.tone }}>
                Giro cerrado el {fecha(s.sii_termination_date)}
              </span>
            )}
            {s.territory_basis === 'PADRON_ENTIDAD' && (
              <Chip title="La comuna proviene del propio padrón, no de una inferencia">
                Territorio del padrón
              </Chip>
            )}
            {s.refreshed_at && (
              <span className="dossier-corte">corte {fecha(s.refreshed_at)}</span>
            )}
          </div>

          <div className="dossier-grid">
            <section className="dossier-block">
              <h4>Índices, contra sus pares</h4>
              <div style={{ display: 'grid', gap: 14 }}>
                <RefMeter
                  label="IPF · prioridad fiscalizadora"
                  value={s.ipf_score}
                  tone={ipfTone}
                  valueLabel={s.ipf_score != null
                    ? `${n1(s.ipf_score)}${bandaIpf(s.ipf_band) ? ` · ${bandaIpf(s.ipf_band)}` : ''}`
                    : 'sin medir'}
                  refValue={peers?.ipf_mediana ?? null}
                  refLabel={peers ? `mediana de ${n(peers.sujetos)} pares` : undefined}
                  percentile={pos?.ipf_percentil_sector ?? null}
                  hint={s.ipf_credibility_pct != null
                    ? `calculado con ${n1(s.ipf_credibility_pct)}% de los insumos`
                    : undefined}
                />
                <RefMeter
                  label="IGR de la comuna donde opera"
                  value={s.igr_score}
                  tone="var(--sig-medium)"
                  valueLabel={s.igr_score != null
                    ? `${n1(s.igr_score)}${s.igr_level ? ` · ${s.igr_level}` : ''}`
                    : 'sin comuna observada'}
                  hint="Describe el entorno de la comuna, nunca al sujeto."
                />
              </div>
              {peers ? (
                <div className="peer-mix">
                  <span>
                    Su sector: <b className="num">{n(peers.sujetos)}</b> inscritos
                  </span>
                  <span>
                    <b className="num">{n(peers.sancionados)}</b> con sanción
                  </span>
                  <span>
                    <b className="num">{n(peers.terminados)}</b> con término
                  </span>
                  <span>
                    <b className="num">{n(peers.en_atencion)}</b> en revisión
                  </span>
                </div>
              ) : (
                <p className="dossier-note">
                  Su sector no tiene otros inscritos en este corte: no hay mediana con
                  la cual comparar.
                </p>
              )}
            </section>

            <section className="dossier-block">
              <h4>Perfil tributario</h4>
              <div className="tile-grid">
                <Tile
                  label="Antigüedad"
                  value={s.activity_years != null ? `${n(s.activity_years)} años` : '—'}
                  foot={
                    s.activity_years == null
                      ? 'el SII no publica fecha de inicio'
                      : pos?.antiguedad_percentil_sector != null
                        ? `P${n1(pos.antiguedad_percentil_sector)} de su sector · mediana ${n1(peers?.antiguedad_mediana ?? 0)}`
                        : `desde ${fecha(s.sii_activity_start_date)}`
                  }
                />
                {/* El tramo 1 del SII es ausencia de informacion, no ventas
                    cero: se rotula como tal en vez de imprimir un rango. */}
                <Tile
                  label="Ventas declaradas"
                  value={
                    s.sales_band_rank == null
                      ? 'Sin tramo'
                      : s.sales_band_size ?? 'Sin información'
                  }
                  foot={
                    s.sales_band_rank == null
                      ? 'el SII no publica tramo para este RUT'
                      : s.sales_band_uf ?? undefined
                  }
                />
                <Tile
                  label="Posición por ventas"
                  value={
                    s.sales_band_rank != null && peers?.ventas_rank_max
                      ? `${n(s.sales_band_rank)} de ${n(peers.ventas_rank_max)}`
                      : '—'
                  }
                  foot={
                    peers?.ventas_rank_mediana != null && s.sales_band_rank != null
                      ? s.sales_band_rank > peers.ventas_rank_mediana
                        ? 'sobre la mediana de su sector'
                        : s.sales_band_rank < peers.ventas_rank_mediana
                          ? 'bajo la mediana de su sector'
                          : 'en la mediana de su sector'
                      : undefined
                  }
                />
                <Tile
                  label="Trabajadores"
                  value={s.workers != null ? n(s.workers) : '—'}
                />
              </div>
              {(s.main_activity || s.economic_sector) && (
                <p className="dossier-act">
                  {s.main_activity && <b>{titleCase(s.main_activity)}</b>}
                  {s.economic_sector && <span> · {titleCase(s.economic_sector)}</span>}
                  {s.economic_subsector && <span> · {titleCase(s.economic_subsector)}</span>}
                </p>
              )}
              {s.is_state_supplier && s.supplier_amount_12m != null && (
                <p className="dossier-note">
                  Proveedor del Estado · {n(Math.round(s.supplier_amount_12m / 1_000_000))} millones
                  en 12 meses{s.supplier_order_count != null ? ` en ${n(s.supplier_order_count)} órdenes` : ''}.
                </p>
              )}
            </section>
          </div>

          {senales.length > 0 && (
            <section className="dossier-block dossier-signals">
              <h4>Señales del perfil</h4>
              <div className="subject-chips">
                {senales.map((x) => (
                  <Chip key={x.label} tone="var(--sig-medium)" title={x.hint}>{x.label}</Chip>
                ))}
              </div>
              <p className="dossier-note">
                Una señal describe el perfil tributario y no imputa incumplimiento.
              </p>
            </section>
          )}
        </>
      )}

      <section className="dossier-block">
        <h4>
          Antecedentes
          {ev.length > 0 && <span className="dossier-count">{n(ev.length)}</span>}
        </h4>
        {ev.length === 0 ? (
          <p className="dossier-note">
            Sin antecedentes de sanción ni de prensa en el corte vigente.
          </p>
        ) : (
          <ol className="ev-rail">
            {ev.map((e, i) => (
              <li className="ev-node" data-kind={e.kind} key={i}>
                <div className="ev-head">
                  <span className="ev-src">
                    {e.kind === 'SANCION' ? e.source_label ?? 'Sanción' : 'Prensa'}
                  </span>
                  <span className="ev-date">{fecha(e.event_date)}</span>
                  {e.amount_uf != null && <span className="ev-amount num">{n(e.amount_uf)} UF</span>}
                </div>
                {e.headline && <p className="ev-title">{e.headline}</p>}
                {e.summary && e.summary !== e.headline && <p className="ev-sum">{e.summary}</p>}
                {/* La resolución por RUT puede traer un registro emitido bajo otra
                    razón social: mismo contribuyente, nombre anterior, o un empate
                    que hay que revisar. Callarlo dejaría al analista sin el dato
                    que necesita para descartar. */}
                {e.identity_status && e.identity_status !== 'RESOLVED_SOURCE' && (
                  <p className="ev-sum" style={{ color: 'var(--ink-4)' }}>
                    {identityNote(e.identity_status)}
                  </p>
                )}
                {e.has_link && e.document_url ? (
                  <a className="ev-link" href={e.document_url} target="_blank" rel="noreferrer">
                    Abrir documento original →
                  </a>
                ) : (
                  <span className="ev-nolink">
                    La fuente no publica enlace para este registro.
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {entityId && onOpenEntity && (
        <button className="btn dossier-cta" onClick={() => onOpenEntity(entityId)}>
          Ver ficha completa de la entidad →
        </button>
      )}
    </div>
  );
}
