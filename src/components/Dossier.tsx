import type {
  BudgetSignalRow, EntityDetail, EntityDossier, TimelineRow, TaxProfile,
} from '../lib/contracts';
import type { PressForSubject } from '../lib/press';
import { fecha, n, n1, pct, taxStatusLabel, titleCase } from '../lib/format';
import { Badge, Empty, Panel, Semantics } from './primitives';

/* ─────────────────────────────────────────────────────────── formatos locales */

function clp(value: number | null | undefined): string {
  if (value == null) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${n1(value / 1e12)} billones`;
  if (abs >= 1e9) return `$${n1(value / 1e9)} mil millones`;
  if (abs >= 1e6) return `$${n1(value / 1e6)} millones`;
  return `$${n(Math.round(value))}`;
}

/* ══════════════════════════════════════════════════════ qué es esta entidad

   Cinco preguntas, cinco respuestas, en el orden en que las hace un analista.
   Una fuente sin registro nunca se dibuja igual que una fuente no consultada:
   todas las de este bloque son de consulta programada, de modo que su silencio
   sí es ausencia y se rotula como tal. */

type CardTone = 'present' | 'critical' | 'warn' | 'none';

function EstadoCard({
  label, value, hint, tone,
}: {
  label: string;
  value: string;
  hint?: string | null;
  tone: CardTone;
}) {
  return (
    <div className="estado-card" data-tone={tone}>
      <div className="estado-label">{label}</div>
      <div className="estado-value">{value}</div>
      {hint && <div className="estado-hint">{hint}</div>}
    </div>
  );
}

export function QueEsEstaEntidad({
  data, press,
}: {
  data: EntityDossier;
  press: PressForSubject | null;
}) {
  const uaf = data.uaf as Record<string, unknown> | null;
  const osfl = data.osfl_registry;
  const spend = data.spend;
  const sanctions = data.sanctions?.length ?? 0;
  const withDocument = (data.sanctions ?? []).filter((s) => s.document_url).length;
  const notes = press?.articleCount ?? 0;

  return (
    <>
      <div className="estado-grid">
        <EstadoCard
          label="Sujeto obligado"
          value={data.entity.is_uaf_observed ? 'Inscrita en el padrón' : 'Sin registro'}
          hint={
            data.entity.is_uaf_observed
              ? titleCase(String(uaf?.uaf_sector_canonical ?? data.entity.uaf_sector ?? ''))
              : 'Padrón UAF de la Ley 19.913'
          }
          tone={data.entity.is_uaf_observed ? 'present' : 'none'}
        />
        <EstadoCard
          label="Sanciones"
          value={sanctions > 0 ? `${n(sanctions)} ${sanctions === 1 ? 'evento' : 'eventos'}` : 'Sin registro'}
          hint={
            sanctions > 0
              ? withDocument > 0
                ? `${n(withDocument)} con documento oficial`
                : 'sin documento publicado por la fuente'
              : 'CMF · UAF · SCJ · CGR'
          }
          tone={sanctions > 0 ? 'critical' : 'none'}
        />
        <EstadoCard
          label="Prensa"
          value={notes > 0 ? `${n(notes)} ${notes === 1 ? 'nota' : 'notas'}` : 'Sin registro'}
          hint={
            notes > 0
              ? press && press.matches.length > 1
                ? `${n(press.matches.length)} variantes del nombre`
                : 'ventana de los últimos 30 días'
              : 'ventana de los últimos 30 días'
          }
          tone={notes > 0 ? 'warn' : 'none'}
        />
        <EstadoCard
          label="Proveedor del Estado"
          value={
            spend?.actor_role === 'SUPPLIER' ? clp(spend.amount_12m)
            : spend?.actor_role === 'BUYER' ? 'Comprador público'
            : 'Sin registro'
          }
          hint={
            spend
              ? `${n(spend.order_count_12m)} órdenes · ${n(spend.counterpart_count)} contrapartes · 12 meses`
              : 'Mercado Público · ChileCompra'
          }
          tone={spend ? 'present' : 'none'}
        />
        <EstadoCard
          label="Sin fines de lucro"
          value={osfl ? (osfl.osfl_type ? titleCase(osfl.osfl_type) : 'En el registro') : 'Sin registro'}
          hint={
            osfl
              ? osfl.registro19862 ? 'Inscrita en el Registro 19.862' : 'sin inscripción en Registro 19.862'
              : 'RNPJSFL · Registro Civil'
          }
          tone={osfl ? 'present' : 'none'}
        />
      </div>
      <p className="estado-note">
        Cinco fuentes de consulta programada. Aquí “sin registro” significa que la fuente
        fue consultada y no reporta a esta entidad — nunca que no se haya mirado. Las
        fuentes bajo demanda viven en su propia pestaña.
      </p>
    </>
  );
}

/* ══════════════════════════════════════════════════════════ perfil tributario

   Lo primero que mira un analista: desde cuándo existe, a qué se dedica, dónde
   tributa, de qué tamaño es y si sigue operando. */

function TaxRow({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="tax-row">
      <dt>{k}</dt>
      <dd title={hint}>{v}</dd>
    </div>
  );
}

export function PerfilTributario({ data }: { data: EntityDetail }) {
  const tax = data.tax as TaxProfile | null;
  const notes = data.lifecycle_notes;

  if (!tax) {
    return (
      <Panel title="Perfil tributario" meta="Servicio de Impuestos Internos">
        <Empty
          title="Sin perfil tributario en el corte"
          hint="El corte publicado no incluye actividad económica declarada para esta entidad. No significa que no exista: significa que Radar SII no la reporta."
        />
      </Panel>
    );
  }

  // El giro principal ya se muestra destacado: repetirlo en la lista de
  // secundarias haría creer que la entidad declara dos veces la misma actividad.
  const principal = String(tax.main_activity ?? '').trim().toUpperCase();
  const activities = String(tax.activity_names ?? '')
    .split(/\s*[;|]\s*|\s{2,}/)
    .map((a) => a.trim())
    .filter((a) => a && a.toUpperCase() !== principal);
  const vigente = !tax.termination_date;

  return (
    <Panel
      title="Perfil tributario"
      meta={
        <span className="panel-meta-line">
          Servicio de Impuestos Internos
          {tax.commercial_year && <> · año comercial {tax.commercial_year}</>}
        </span>
      }
    >
      <div className="tax-head">
        <Badge tone={vigente ? 'present' : 'critical'} dot>
          {vigente ? 'Giro vigente' : `Término de giro ${tax.termination_date?.slice(0, 4)}`}
        </Badge>
        {tax.size_label && <Badge tone="neutral">{tax.size_label}</Badge>}
        {tax.taxpayer_type && <Badge tone="neutral">{titleCase(tax.taxpayer_type)}</Badge>}
        {tax.society_type && <Badge tone="neutral">{titleCase(tax.society_type)}</Badge>}
      </div>

      <dl className="tax-grid">
        <TaxRow k="Inicio de actividades" v={fecha(tax.activity_start_date)} />
        <TaxRow
          k="Primera actividad registrada"
          v={fecha(tax.first_activity_registration_date)}
        />
        <TaxRow
          k="Término de giro"
          v={tax.termination_date ? fecha(tax.termination_date) : 'No registra'}
        />
        <TaxRow k="Estado" v={taxStatusLabel(tax.current_status)} />
        {/* El tramo 1 del SII es ausencia de información, no ventas cero.
            Presentarlo como rango afirmaría un tamaño que la fuente no informa. */}
        <TaxRow
          k="Tramo de ventas"
          v={
            tax.sales_band_rank === 1 || !tax.sales_band_uf
              ? 'Sin información de ventas'
              : tax.sales_band_uf
          }
          hint={notes?.sales_band_note}
        />
        <TaxRow
          k="Trabajadores"
          v={tax.workers_numeric == null ? 'No informa' : n(tax.workers_numeric)}
        />
        <TaxRow k="Región" v={tax.region ? titleCase(tax.region) : '—'} />
        <TaxRow
          k="Comuna"
          v={[tax.commune, tax.province].filter(Boolean).map((x) => titleCase(String(x))).join(' · ') || '—'}
        />
        <TaxRow k="Sector económico" v={tax.economic_sector ? titleCase(tax.economic_sector) : '—'} />
        <TaxRow k="Subsector" v={tax.economic_subsector ? titleCase(tax.economic_subsector) : '—'} />
        <TaxRow
          k="Domicilios registrados"
          v={
            tax.address_count == null ? '—'
            : `${n(tax.address_count)} · ${n(tax.current_address_count)} vigente${tax.current_address_count === 1 ? '' : 's'}`
          }
        />
        <TaxRow
          k="Socios personas jurídicas"
          v={tax.legal_entity_partner_count == null ? '—' : n(tax.legal_entity_partner_count)}
        />
      </dl>

      <div className="tax-activities">
        <div className="tax-activities-head">
          Actividades económicas declaradas
          {tax.activity_count != null && <span className="num">{n(tax.activity_count)}</span>}
        </div>
        {tax.main_activity && (
          <div className="tax-activity-main">
            <span className="tax-activity-tag">Principal</span>
            {titleCase(tax.main_activity)}
          </div>
        )}
        {activities.length > 0 ? (
          <ul className="tax-activity-list" aria-label="Actividades secundarias declaradas">
            {activities.slice(0, 12).map((a, i) => (
              <li key={`${a}-${i}`}>{titleCase(a)}</li>
            ))}
          </ul>
        ) : (
          !tax.main_activity && (
            <p className="tax-empty">La fuente no publica el detalle de actividades declaradas.</p>
          )
        )}
        {activities.length > 12 && (
          <p className="tax-empty">y {n(activities.length - 12)} actividades más en el corte.</p>
        )}
      </div>

      {notes?.sales_band_note && <Semantics>{notes.sales_band_note}</Semantics>}
    </Panel>
  );
}

/* ═══════════════════════════════════════════════════════════ línea de tiempo */

const KIND_LABEL: Record<string, string> = {
  SANCION: 'Sanción',
  PRENSA: 'Prensa',
  PRESUPUESTO: 'Presupuesto y CGR',
  COMPRAS: 'Compras públicas',
  SII: 'SII',
  PADRON_UAF: 'Padrón UAF',
};

const KIND_TONE: Record<string, string> = {
  SANCION: 'critical',
  PRENSA: 'warn',
  PRESUPUESTO: 'watch',
  COMPRAS: 'present',
  SII: 'neutral',
  PADRON_UAF: 'present',
};

const LINK_LABEL: Record<string, string> = {
  SANCION: 'Ver resolución',
  PRENSA: 'Abrir nota',
  PRESUPUESTO: 'Ver fuente',
};

function TimelineItem({ row }: { row: TimelineRow }) {
  const undated = row.date_precision === 'SIN_FECHA' || !row.event_date;
  return (
    <li className="dtl-item">
      <time className="dtl-date" dateTime={row.event_date ?? undefined}>
        {undated ? <span className="dtl-undated">sin fecha</span> : fecha(row.event_date)}
      </time>
      <span className="dtl-rail" aria-hidden data-tone={KIND_TONE[row.kind] ?? 'neutral'} />
      <div className="dtl-body">
        <div className="dtl-head">
          <Badge tone={(KIND_TONE[row.kind] ?? 'neutral') as 'present'}>
            {KIND_LABEL[row.kind] ?? row.kind}
          </Badge>
          {row.source_label && <span className="dtl-source">{row.source_label}</span>}
          {row.amount_uf != null && <span className="dtl-amount">{n1(row.amount_uf)} UF</span>}
          {row.amount_clp != null && <span className="dtl-amount">{clp(row.amount_clp)}</span>}
        </div>
        <div className="dtl-title">{row.title}</div>
        {row.summary && <div className="dtl-summary">{row.summary}</div>}
      </div>
      <div className="dtl-link">
        {row.has_link && row.document_url ? (
          <a href={row.document_url} target="_blank" rel="noopener noreferrer">
            {LINK_LABEL[row.kind] ?? 'Ver documento'} ↗
          </a>
        ) : (
          <span className="dtl-nolink" title="La fuente registra el hecho pero no publica un documento enlazable.">
            sin documento
          </span>
        )}
      </div>
    </li>
  );
}

/** La evidencia periodística vive en el puente de Radar Prensa, no en el corte
 *  materializado, así que se convierte a filas de la misma serie. Es la única
 *  capa que aporta el enlace a la nota original. */
export function pressToTimeline(press: PressForSubject | null): TimelineRow[] {
  if (!press) return [];
  return press.articles.map((a) => ({
    kind: 'PRENSA' as const,
    event_date: a.date,
    date_precision: (a.date ? 'DIA' : 'SIN_FECHA') as TimelineRow['date_precision'],
    source_code: 'RADAR_PRENSA',
    source_label: a.media ?? 'Prensa',
    title: a.title,
    summary: a.role && a.role !== 'mencionada en la publicación' ? `Rol: ${a.role}` : a.summary,
    amount_uf: null,
    amount_clp: null,
    document_url: a.url,
    has_link: !!a.url,
    identity_status: 'PRESS_ONLY',
  }));
}

export function LineaDeTiempo({
  rows, note,
}: {
  rows: TimelineRow[];
  note?: string;
}) {
  if (rows.length === 0) {
    return (
      <Empty
        title="Sin hechos fechados en el corte"
        hint="Ninguna fuente gobernada registra eventos con fecha para esta entidad. Las fuentes bajo demanda se consultan por separado."
      />
    );
  }
  const withLink = rows.filter((r) => r.has_link).length;
  return (
    <>
      <div className="dtl-meta">
        {n(rows.length)} {rows.length === 1 ? 'hecho registrado' : 'hechos registrados'}
        {' · '}
        {n(withLink)} con documento o enlace a la fuente
      </div>
      <ol className="dossier-timeline">
        {rows.map((r, i) => (
          <TimelineItem key={`${r.kind}-${r.event_date}-${i}`} row={r} />
        ))}
      </ol>
      {note && <Semantics>{note}</Semantics>}
    </>
  );
}

/* ══════════════════════════════════════════════════ por qué aparece priorizada

   El listado mostraba "0,0" al lado de una sociedad sancionada. Un cero
   numérico se lee como bajo riesgo; la ausencia de cálculo no es un cero. */

export function PorQueAparece({
  data, press,
}: {
  data: EntityDossier;
  press: PressForSubject | null;
}) {
  const e = data.entity;
  const priority = data.priority as Record<string, unknown> | null;
  const scored = e.ipa3_score != null && Number(e.ipa3_score) > 0;
  const band = String(e.ipa3_band ?? '');

  const razones: string[] = [];
  const present = data.coverage.filter((c) => c.status === 'PRESENT').length;
  if (present > 0) razones.push(`converge en ${n(present)} fuentes gobernadas`);
  if ((data.sanctions?.length ?? 0) > 0) {
    razones.push(`registra ${n(data.sanctions.length)} evento${data.sanctions.length === 1 ? '' : 's'} sancionatorio${data.sanctions.length === 1 ? '' : 's'}`);
  }
  if (press && press.articleCount > 0) {
    razones.push(`aparece en ${n(press.articleCount)} nota${press.articleCount === 1 ? '' : 's'} de prensa de los últimos 30 días`);
  }
  if (data.spend) razones.push('tiene relación registrada con compras públicas');
  if (data.budget.length > 0) razones.push(`arrastra ${n(data.budget.length)} señal${data.budget.length === 1 ? '' : 'es'} de ejecución fiscal o auditoría`);
  if (e.finding_count > 0) razones.push(`el motor de patrones le atribuye ${n(e.finding_count)} hallazgos`);

  return (
    <Panel title="Por qué aparece" meta="lectura del corte, no una conclusión">
      <div className="porque-score">
        <div className="porque-value" data-scored={scored}>
          {scored ? n1(e.ipa3_score) : '—'}
        </div>
        <div className="porque-label">
          {scored ? (
            <>
              Prioridad analítica · banda {titleCase(band.replace(/_/g, ' '))}
              {priority?.score_confidence_pct != null && (
                <> · confianza {pct(Number(priority.score_confidence_pct))}</>
              )}
            </>
          ) : (
            /* SIN_MARCA_SHADOW no significa "evaluada y limpia": significa que
               el modelo no pudo calcularla en este corte. */
            <>Prioridad no calculada en este corte. No es un cero, y no significa
              que la entidad haya sido evaluada sin hallazgos.</>
          )}
        </div>
      </div>

      {razones.length > 0 ? (
        <ul className="porque-list">
          {razones.map((r) => <li key={r}>{r}</li>)}
        </ul>
      ) : (
        <p className="tax-empty">
          Ninguna fuente del corte aporta hechos sobre esta entidad más allá de su
          presencia en el padrón.
        </p>
      )}

      <Semantics>
        La prioridad ordena esfuerzo de fiscalización. No es probabilidad de LA/FT ni
        imputación de incumplimiento.
      </Semantics>
    </Panel>
  );
}

/* ══════════════════════════════════════════════ compras y ejecución fiscal

   Dos universos distintos, en dos bloques que nunca se suman en una cifra. */

export function ComprasYPresupuesto({ data }: { data: EntityDossier }) {
  const spend = data.spend;
  const budget: BudgetSignalRow[] = data.budget ?? [];

  if (!spend && budget.length === 0) {
    return (
      <Panel title="Relación con el Estado" meta="compras públicas y ejecución fiscal">
        <Empty
          title="Sin registro en compras públicas ni en ejecución fiscal"
          hint="Ni Mercado Público ni las señales de DIPRES, Contraloría o InfoLobby reportan a esta entidad en el corte vigente."
        />
      </Panel>
    );
  }

  return (
    <div className="grid grid-2">
      <Panel title="Compras públicas" meta="Mercado Público · ventana de 12 meses">
        {spend ? (
          <dl className="tax-grid">
            <TaxRow
              k="Rol"
              v={spend.actor_role === 'SUPPLIER' ? 'Proveedor del Estado' : 'Comprador público'}
            />
            <TaxRow k="Monto en 12 meses" v={clp(spend.amount_12m)} />
            <TaxRow k="Órdenes" v={n(spend.order_count_12m)} />
            <TaxRow k="Contrapartes" v={n(spend.counterpart_count)} />
            <TaxRow
              k="Concentración"
              v={spend.hhi == null ? '—' : `HHI ${n1(spend.hhi * 100) }/100`}
              hint="La concentración describe la distribución de la relación comprador–proveedor, no una irregularidad."
            />
            <TaxRow
              k="Mayor contraparte"
              v={spend.top_counterpart_share == null ? '—' : pct(spend.top_counterpart_share * 100)}
            />
            <TaxRow k="Meses activos" v={n(spend.active_months)} />
            <TaxRow
              k="Ventana observada"
              v={`${fecha(spend.first_seen)} → ${fecha(spend.last_seen)}`}
            />
          </dl>
        ) : (
          <Empty title="Sin registro en Mercado Público" hint="La fuente fue consultada y no reporta órdenes de esta entidad en la ventana del corte." />
        )}
      </Panel>

      <Panel title="Ejecución fiscal, auditoría y lobby" meta="DIPRES · CGR · InfoLobby">
        {budget.length === 0 ? (
          <Empty title="Sin señales" hint="Ninguna de las tres fuentes reporta a esta entidad en el corte." />
        ) : (
          <ul className="budget-list">
            {budget.map((b) => (
              <li key={b.evidence_id}>
                <div className="budget-head">
                  <Badge tone="watch">{b.source_code ?? 'Fuente fiscal'}</Badge>
                  <span className="dtl-source">{fecha(b.event_date)}</span>
                  {b.amount_clp != null && <span className="dtl-amount">{clp(b.amount_clp)}</span>}
                </div>
                <div className="dtl-title">{b.title ?? b.signal_code ?? 'Señal registrada'}</div>
                {b.summary && <div className="dtl-summary">{b.summary}</div>}
                {b.source_url && (
                  <a href={b.source_url} target="_blank" rel="noopener noreferrer" className="budget-link">
                    Ver fuente ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Semantics>{data.dossier_semantics?.spend_note}</Semantics>
    </div>
  );
}
