import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRpc } from '../lib/rpc';
import { n, n1, rutFormat, titleCase } from '../lib/format';
import { Empty, ErrorBox, Loading } from './primitives';
import type {
  UafCohort, UafMotive, UafSubjectRow,
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

  return createPortal(
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
    </>,
    document.body,
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
      {open && <SubjectQuick subject={s} onOpenEntity={onOpenEntity} />}
    </div>
  );
}

function SubjectQuick({
  subject: s,
  onOpenEntity,
}: {
  subject: UafSubjectRow;
  onOpenEntity?: (entityId: string) => void;
}) {
  const estado = s.sii_status ? SII_STATE[s.sii_status] : undefined;
  const ipfTone = s.ipf_band ? IPF_TONE[s.ipf_band] ?? 'var(--accent)' : 'var(--ink-4)';
  const ubicacion = s.commune
    ? `${s.commune}${s.region ? ` · ${s.region}` : ''}`
    : s.region ?? 'Sin territorio observado';

  return (
    <div className="subject-quick" role="region" aria-label={`Vista rápida de ${s.name}`}>
      <div className="subject-quick-facts">
        <span className="subject-quick-fact">
          <small>RUT</small>
          <b className="mono">{rutFormat(s.rut)}</b>
        </span>
        <span className="subject-quick-fact">
          <small>Estado SII</small>
          <b style={estado ? { color: estado.tone } : undefined}>{estado?.label ?? 'Sin perfil'}</b>
        </span>
        <span className="subject-quick-fact">
          <small>IPF</small>
          <b className="num" style={{ color: ipfTone }}>
            {s.ipf_score != null ? `${n1(s.ipf_score)} · ${bandaIpf(s.ipf_band) ?? '—'}` : 'Sin medir'}
          </b>
        </span>
        <span className="subject-quick-fact">
          <small>Antigüedad</small>
          <b>{s.activity_years != null ? `${n(s.activity_years)} años` : 'Sin dato'}</b>
        </span>
        <span className="subject-quick-fact subject-quick-location" title={ubicacion}>
          <small>Ubicación</small>
          <b>{ubicacion}</b>
        </span>
      </div>

      <div className="subject-quick-signals" aria-label="Marcas principales">
        {s.attention_motive && (
          <span data-tone="critical">{MOTIVE_LABEL[s.attention_motive] ?? s.attention_motive}</span>
        )}
        {s.sanction_evidence_count > 0 && (
          <span data-tone="high">{n(s.sanction_evidence_count)} sanción{s.sanction_evidence_count === 1 ? '' : 'es'}</span>
        )}
        {s.press_evidence_count > 0 && (
          <span data-tone="watch">{n(s.press_evidence_count)} prensa</span>
        )}
        {s.sii_status === 'TERMINATED_AS_PUBLISHED' && <span data-tone="term">Término de giro</span>}
        {s.is_osfl && <span data-tone="neutral">OSFL</span>}
        {s.is_state_supplier && <span data-tone="present">Proveedor del Estado</span>}
        {!s.attention_motive && s.sanction_evidence_count === 0 && s.press_evidence_count === 0 &&
          s.sii_status !== 'TERMINATED_AS_PUBLISHED' && !s.is_osfl && !s.is_state_supplier && (
            <span data-tone="neutral">Sin marcas adicionales en este corte</span>
          )}
      </div>

      <div className="subject-quick-actions">
        <span>Vista rápida del listado. El expediente completo queda en Entidad 360.</span>
        {s.entity_id && onOpenEntity ? (
          <button className="subject-quick-cta" onClick={() => onOpenEntity(s.entity_id!)}>
            Abrir Entidad 360 →
          </button>
        ) : (
          <span className="subject-quick-unavailable">Sin ficha 360 vinculada</span>
        )}
      </div>
    </div>
  );
}
