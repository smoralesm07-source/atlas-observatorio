import { useMemo, useState } from 'react';
import type {
  SectorOverview, SectorRow, UafPotential, UafPulse, UafReportingSector,
} from '../../lib/contracts';
import type { CohortRequest } from '../../components/CohortDrawer';
import { Bars, OrderedDistribution } from '../../components/charts';
import { Empty } from '../../components/primitives';
import { fecha, n, n1, titleCase } from '../../lib/format';
import { hrefFor } from '../../lib/router';
import { MarkCard, SectionHead, SortTh, Tile, compareBy, useSort } from './bits';

/* EJE 1 · SITUACIÓN ACTUAL DE LOS SUJETOS OBLIGADOS INSCRITOS
   ──────────────────────────────────────────────────────────
   Responde cuatro preguntas en el orden en que las hace un analista de
   inteligencia: de qué está hecho el padrón, qué marcas de caracterización
   lleva, cómo se reparte por sector y por región, y qué perfil de
   fiscalización y de ciclo registral tiene.

   Regla de la superficie: toda cifra abre la lista de entidades que la
   sostiene. Un tablero que sólo publica agregados obliga a salir a buscar los
   nombres en otra pantalla, y ahí se pierde el hilo del análisis. */

export type Focus = { kind: 'POTENCIAL' | 'TERMINO'; sector?: string | null };

interface SectorLine {
  sector: string;
  sujetos: number;
  share: number;
  terminados: number;
  sancionados: number;
  atencion: number;
  ipf: number | null;
  ros: number | null;
  tasa: number | null;
  icr: number | null;
  silencio: boolean;
  potenciales: number;
  ivo: number | null;
  detail: SectorRow | null;
  reporting: UafReportingSector | null;
}

interface RegionLine {
  region: string;
  sujetos: number;
  share: number;
  terminados: number;
  sancionados: number;
  proveedores: number;
  atencion: number;
  igr: number | null;
  banda: string | null;
  igrAlto: number;
}

type SectorField = keyof Pick<SectorLine,
  'sector' | 'sujetos' | 'terminados' | 'sancionados' | 'atencion' | 'ipf' | 'ros' | 'tasa' | 'potenciales'>;
type RegionField = keyof Pick<RegionLine,
  'region' | 'sujetos' | 'terminados' | 'sancionados' | 'proveedores' | 'atencion' | 'igr'>;
type SectorFilter = 'todos' | 'termino' | 'sancion' | 'potencial' | 'silencio';

const share = (part: number | null | undefined, total: number) =>
  part == null || total <= 0 ? null : (part / total) * 100;

/** La rampa del IGR es territorial y tiene su propio vocabulario de niveles.
 *  Ordenarla de menor a mayor amenaza es lo que la hace legible. */
const IGR_STEP: Record<string, number> = {
  'Muy bajo': 1, Bajo: 2, Medio: 3, Alto: 4, 'Muy alto': 5,
};

const IPF_ORDER = ['MINIMA', 'BAJA', 'MEDIA', 'ALTA', 'MUY_ALTA'];
const IPF_LABEL: Record<string, string> = {
  MINIMA: 'Mínima', BAJA: 'Baja', MEDIA: 'Media', ALTA: 'Alta', MUY_ALTA: 'Muy alta', SIN_IPF: 'Sin IPF medido',
};

export function PadronAxis({
  pulse, potential, sectorOverview, onCohort, onNavigate, onWork,
}: {
  pulse: UafPulse;
  potential: UafPotential | null;
  sectorOverview: SectorOverview | null;
  onCohort: (request: CohortRequest) => void;
  onNavigate: (hash: string) => void;
  onWork: (focus: Focus) => void;
}) {
  const [sectorQuery, setSectorQuery] = useState('');
  const [sectorFilter, setSectorFilter] = useState<SectorFilter>('todos');
  const [picked, setPicked] = useState<string | null>(null);
  const sectorSort = useSort<SectorField>('sujetos');
  const regionSort = useSort<RegionField>('sujetos');

  const u = pulse.universe;
  const cross = pulse.crosscuts;
  const total = u?.total ?? 0;

  const sectorLines = useMemo<SectorLine[]>(() => {
    const detail = new Map((sectorOverview?.sectores ?? []).map((row) => [row.uaf_sector_canonical, row]));
    const gaps = new Map((potential?.sectores ?? []).map((row) => [row.sector, row]));
    const reporting = new Map(
      (pulse.reporting?.sectores ?? [])
        .filter((row): row is UafReportingSector & { sector_canonical: string } => Boolean(row.sector_canonical))
        .map((row) => [row.sector_canonical, row]),
    );
    return (pulse.by_sector ?? []).map((row) => {
      const rep = reporting.get(row.sector) ?? null;
      const gap = gaps.get(row.sector);
      return {
        sector: row.sector,
        sujetos: row.sujetos,
        share: share(row.sujetos, total) ?? 0,
        terminados: row.terminados,
        sancionados: row.sancionados,
        atencion: row.en_atencion,
        ipf: row.ipf_medio,
        ros: rep?.ros_2025 ?? null,
        tasa: rep?.ros_per_100_so_2025 ?? null,
        icr: rep?.icr_pct ?? null,
        silencio: Boolean(rep?.silence_5y),
        potenciales: gap?.accionables ?? 0,
        ivo: gap?.ivo_medio ?? null,
        detail: detail.get(row.sector) ?? null,
        reporting: rep,
      };
    });
  }, [pulse.by_sector, pulse.reporting, potential, sectorOverview, total]);

  const sectorRows = useMemo(() => {
    const q = sectorQuery.trim().toLowerCase();
    return sectorLines
      .filter((row) => {
        if (q && !row.sector.toLowerCase().includes(q)) return false;
        if (sectorFilter === 'termino') return row.terminados > 0;
        if (sectorFilter === 'sancion') return row.sancionados > 0;
        if (sectorFilter === 'potencial') return row.potenciales > 0;
        if (sectorFilter === 'silencio') return row.silencio;
        return true;
      })
      .slice()
      .sort((a, b) => compareBy(a, b, (row) => row[sectorSort.field], sectorSort.dir));
  }, [sectorLines, sectorQuery, sectorFilter, sectorSort.field, sectorSort.dir]);

  const regionLines = useMemo<RegionLine[]>(
    () => (pulse.by_region ?? []).map((row) => ({
      region: row.region,
      sujetos: row.sujetos,
      share: share(row.sujetos, total) ?? 0,
      terminados: row.terminados,
      sancionados: row.sancionados,
      proveedores: row.proveedores,
      atencion: row.en_atencion,
      igr: row.igr_medio,
      banda: row.igr_banda,
      igrAlto: row.en_igr_alto,
    })),
    [pulse.by_region, total],
  );

  const regionRows = useMemo(
    () => regionLines.slice().sort((a, b) => compareBy(a, b, (row) => row[regionSort.field], regionSort.dir)),
    [regionLines, regionSort.field, regionSort.dir],
  );

  const focus = useMemo(
    () => sectorLines.find((row) => row.sector === picked)
      ?? sectorRows[0]
      ?? sectorLines[0]
      ?? null,
    [sectorLines, sectorRows, picked],
  );

  const maxSector = Math.max(1, ...sectorLines.map((row) => row.sujetos));
  const maxRegion = Math.max(1, ...regionLines.map((row) => row.sujetos));

  if (!u) return <Empty title="Sin padrón UAF publicado" hint="El snapshot vigente no trae el universo de sujetos obligados." />;

  const cycleYears = buildCycle(pulse.lifecycle);
  const maxCycle = Math.max(1, ...cycleYears.map((y) => Math.max(y.altas, y.terminos)));
  const ipfBands = IPF_ORDER
    .map((banda, index) => {
      const row = (pulse.ipf_bands ?? []).find((b) => b.banda === banda);
      return { banda, label: IPF_LABEL[banda] ?? banda, sujetos: row?.sujetos ?? 0, medio: row?.ipf_medio ?? null, step: index + 1 };
    })
    .filter((row) => row.sujetos > 0);
  const sinIpf = (pulse.ipf_bands ?? []).find((b) => b.banda === 'SIN_IPF')?.sujetos ?? 0;
  const igrRows = (pulse.igr_mix ?? [])
    .filter((row) => IGR_STEP[row.banda] != null)
    .map((row) => ({ label: row.banda, value: row.sujetos, step: IGR_STEP[row.banda] }))
    .sort((a, b) => a.step - b.step);
  const sinIgr = (pulse.igr_mix ?? []).find((row) => IGR_STEP[row.banda] == null)?.sujetos ?? 0;
  const rep = pulse.reporting?.totales ?? null;
  const potentialTotal = potential?.totales?.accionables ?? 0;
  const stateTotal = u.activos + u.terminados + u.sin_perfil;
  const natureTotal = u.juridicas + u.naturales + u.organismos;
  const withoutTerritory = Math.max(0, total - u.con_territorio);

  return (
    <div className="uso-axis-body fade-in">
      <section className="uso-band" aria-label="Cifras ancla del padrón">
        <Tile
          label="Padrón inscrito" value={n(u.total)}
          foot={`${n(u.sectores_uaf)} sectores · ${n(u.regiones)} regiones`}
          tone="var(--accent)"
          onClick={() => onCohort({ cohort: 'TODOS', title: 'Padrón completo de sujetos obligados' })}
        />
        <Tile
          label="Activos ante el SII" value={n(u.activos)}
          foot={`${n1(share(u.activos, total))}% del padrón`}
          tone="var(--present)"
          onClick={() => onCohort({ cohort: 'ACTIVO', title: 'Sujetos activos ante el SII' })}
        />
        <Tile
          label="Con término de giro" value={n(u.terminados)}
          foot="candidatos a revisión de desinscripción"
          tone="var(--sig-high)"
          onClick={() => onCohort({ cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro' })}
        />
        <Tile
          label="Sin perfil ante el SII" value={n(u.sin_perfil)}
          foot="personas naturales sin perfil de persona jurídica"
          tone="var(--unknown)"
          onClick={() => onCohort({ cohort: 'SIN_PERFIL_SII', title: 'Sujetos sin perfil SII' })}
        />
        <Tile
          label="Piden revisión" value={n(u.en_atencion)}
          foot={`${n1(share(u.en_atencion, total))}% con motivo de precedencia`}
          tone="var(--sig-medium)"
          onClick={() => onCohort({ cohort: 'ATENCION', title: 'Sujetos que piden revisión' })}
        />
      </section>

      <section className="uso-panel">
        <SectionHead
          kicker="1 · Composición"
          title="De qué está hecho el padrón vigente"
          hint={`Dos lecturas del mismo padrón: situación publicada ante el SII y naturaleza del inscrito. Todos los porcentajes usan como denominador los ${n(total)} sujetos.`}
        />
        <div className="uso-composition uso-composition-context">
          <div className="uso-composition-block">
            <div className="uso-composition-label">
              <span>Situación publicada ante el SII</span>
              <em className="num">{n(stateTotal)} de {n(total)} sujetos</em>
            </div>
            <div className="uso-statebar" role="group" aria-label="Situación publicada ante el SII">
              <div className="uso-statebar-track">
                <button
                  data-tone="active" style={{ width: `${share(u.activos, total) ?? 0}%` }}
                  onClick={() => onCohort({ cohort: 'ACTIVO', title: 'Sujetos activos ante el SII' })}
                  aria-label={`Activos ante el SII: ${n(u.activos)}`}
                />
                <button
                  data-tone="terminated" style={{ width: `${share(u.terminados, total) ?? 0}%` }}
                  onClick={() => onCohort({ cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro' })}
                  aria-label={`Con término de giro: ${n(u.terminados)}`}
                />
                <button
                  data-tone="unknown" style={{ width: `${share(u.sin_perfil, total) ?? 0}%` }}
                  onClick={() => onCohort({ cohort: 'SIN_PERFIL_SII', title: 'Sujetos sin perfil SII' })}
                  aria-label={`Sin perfil de persona jurídica en SII: ${n(u.sin_perfil)}`}
                />
              </div>
              <div className="uso-statebar-legend">
                <button onClick={() => onCohort({ cohort: 'ACTIVO', title: 'Sujetos activos ante el SII' })}>
                  <i data-tone="active" />Activos <b className="num">{n(u.activos)}</b>
                  <em>{n1(share(u.activos, total))}% del padrón</em>
                </button>
                <button onClick={() => onCohort({ cohort: 'TERMINO_GIRO', title: 'Sujetos con término de giro' })}>
                  <i data-tone="terminated" />Término de giro <b className="num">{n(u.terminados)}</b>
                  <em>{n1(share(u.terminados, total))}% del padrón</em>
                </button>
                <button onClick={() => onCohort({ cohort: 'SIN_PERFIL_SII', title: 'Sujetos sin perfil SII' })}>
                  <i data-tone="unknown" />Sin perfil PJ SII <b className="num">{n(u.sin_perfil)}</b>
                  <em>{n1(share(u.sin_perfil, total))}% del padrón</em>
                </button>
              </div>
            </div>
            <p className="uso-composition-note">
              Los tres estados son excluyentes y deben sumar el padrón completo.{' '}
              {u.sin_perfil === u.naturales
                ? `En este corte, los ${n(u.sin_perfil)} sin perfil SII coinciden con las personas naturales: no significa inactividad ni término de giro.`
                : 'Sin perfil SII significa que la nómina tributaria de personas jurídicas no entrega perfil para ese inscrito; no acredita inactividad.'}
            </p>
            {stateTotal !== total && (
              <p className="uso-data-warning">
                Inconsistencia del corte: los estados SII suman {n(stateTotal)} y el padrón informa {n(total)}. Diferencia: {n(Math.abs(total - stateTotal))}.
              </p>
            )}
          </div>

          <div className="uso-composition-block">
            <div className="uso-composition-label">
              <span>Naturaleza del inscrito</span>
              <em className="num">{n(natureTotal)} de {n(total)} sujetos</em>
            </div>
            <dl className="uso-nature-grid">
              <div>
                <dt>Personas jurídicas</dt>
                <dd className="num">{n(u.juridicas)}</dd>
                <em>{n1(share(u.juridicas, total))}% del padrón</em>
              </div>
              <div>
                <dt>Personas naturales</dt>
                <dd className="num">{n(u.naturales)}</dd>
                <em>{n1(share(u.naturales, total))}% del padrón</em>
              </div>
              <div>
                <dt>Organismos públicos</dt>
                <dd className="num">{n(u.organismos)}</dd>
                <em>{n1(share(u.organismos, total))}% del padrón</em>
              </div>
            </dl>
            <p className="uso-composition-note">
              Esta es otra partición de los mismos {n(total)} inscritos. No se suma a la barra de estado SII: responde una pregunta distinta.
            </p>
            {natureTotal !== total && (
              <p className="uso-data-warning">
                Inconsistencia del corte: la naturaleza identificada suma {n(natureTotal)} y difiere del padrón en {n(Math.abs(total - natureTotal))} sujetos.
              </p>
            )}
          </div>
        </div>

        <div className="uso-context-strip" aria-label="Cobertura de caracterización del padrón">
          <div>
            <span>Antigüedad media</span>
            <b className="num">{u.antiguedad_media == null ? '—' : `${n1(u.antiguedad_media)} años`}</b>
            <em>media sobre {n(u.con_inicio)} sujetos con fecha de inicio SII</em>
          </div>
          <div>
            <span>Trabajadores informados</span>
            <b className="num">{n(u.trabajadores)}</b>
            <em>suma de dotación declarada en perfiles SII; no es número de sujetos</em>
          </div>
          <div>
            <span>Territorio observado</span>
            <b className="num">{n(u.con_territorio)}</b>
            <em>{n1(share(u.con_territorio, total))}% del padrón · {n(withoutTerritory)} sin territorio observado</em>
          </div>
        </div>
      </section>

      <section className="uso-panel">
        <SectionHead
          kicker="2 · Marcas"
          title="Caracterización del padrón"
          hint="Cada marca es una capa observada sobre el mismo sujeto. Describe y ordena revisión; ninguna concluye incumplimiento ni riesgo LA/FT."
        />
        <div className="uso-marks">
          <MarkCard
            label="Con alguna señal externa" value={cross?.con_senal ?? null} total={total}
            hint={`${n(cross?.senales_totales)} señales en total`} tone="var(--sig-watch)"
            onClick={() => onCohort({ cohort: 'CON_SENAL', title: 'Sujetos con señales externas' })}
          />
          <MarkCard
            label="Con antecedente sancionatorio" value={cross?.sancionados_con_antecedente ?? null} total={total}
            hint="resolución abrible por RUT" tone="var(--sig-critical)"
            onClick={() => onCohort({ cohort: 'SANCIONADO', title: 'Sujetos con antecedente sancionatorio' })}
          />
          <MarkCard
            label="Sanción en 5 años" value={cross?.sancionados_5y ?? null} total={total}
            hint="subconjunto reciente del anterior" tone="var(--sig-high)"
          />
          <MarkCard
            label="Con prensa coincidente" value={cross?.prensa ?? null} total={total}
            hint={pulse.coverage?.press_has_links ? 'con enlace al artículo' : 'sin enlace ingerido'}
            tone="var(--class-osint)"
            onClick={() => onCohort({ cohort: 'PRENSA', title: 'Sujetos con presencia en prensa' })}
          />
          <MarkCard
            label="También OSFL" value={cross?.osfl ?? null} total={total}
            hint="intersección con el universo sin fines de lucro" tone="var(--unknown)"
            onClick={() => onCohort({ cohort: 'OSFL', title: 'Sujetos obligados que además son OSFL' })}
          />
          <MarkCard
            label="Proveedor del Estado" value={cross?.proveedores ?? null} total={total}
            hint={pulse.coverage?.supplier_capped ? 'corte acotado de compras públicas' : 'corte de compras públicas'}
            tone="var(--class-official)"
            onClick={() => onCohort({ cohort: 'PROVEEDOR_ESTADO', title: 'Sujetos obligados proveedores del Estado' })}
          />
          <MarkCard
            label="IPF alta o muy alta" value={u.ipf_alto} total={total}
            hint={`IPF medio del padrón ${n1(u.ipf_medio)}`} tone="var(--sig-medium)"
            onClick={() => onCohort({ cohort: 'IPF_ALTO', title: 'Sujetos con IPF alta o muy alta' })}
          />
          <MarkCard
            label="Giro atípico en su sector" value={u.giro_atipico} total={total}
            hint="actividad infrecuente entre sus pares" tone="var(--class-dataset)"
            onClick={() => onCohort({ cohort: 'GIRO_ATIPICO', title: 'Sujetos con giro atípico en su sector' })}
          />
          <MarkCard
            label="Cambio de actividad" value={u.cambio_actividad} total={total}
            hint="el SII registra un giro distinto al inicial" tone="var(--class-connector)"
            onClick={() => onCohort({ cohort: 'CAMBIO_ACTIVIDAD', title: 'Sujetos con cambio de actividad' })}
          />
          <MarkCard
            label="Sin territorio observado" value={total - u.con_territorio} total={total}
            hint="no se puede situar en una comuna" tone="var(--ink-3)"
            onClick={() => onCohort({ cohort: 'SIN_TERRITORIO', title: 'Sujetos sin territorio observado' })}
          />
          <MarkCard
            label="En sector sin ROS 5 años" value={rep?.sujetos_en_silencio ?? null} total={total}
            hint={`${n(rep?.sectores_silenciosos)} sectores en silencio`} tone="var(--sig-none)"
            onClick={() => onCohort({ cohort: 'SECTOR_SIN_ROS', title: 'Sujetos en sectores sin ROS 2021-2025' })}
          />
          <MarkCard
            label="Estructura societaria amplia" value={u.estructura_amplia} total={total}
            hint="más socios o vínculos que sus pares" tone="var(--ink-2)"
          />
        </div>
        <p className="uso-note">
          {pulse.coverage?.sanction_note}
        </p>
      </section>

      <section className="uso-panel">
        <SectionHead
          kicker="3 · Sectores"
          title="Sectores obligados, uno por uno"
          hint="Ordena por cualquier columna. Elige un sector para caracterizarlo: la ficha de la derecha lo describe y abre sus entidades."
          actions={(
            <div className="uso-tools">
              <label className="uso-search">
                <i aria-hidden>⌕</i>
                <input
                  value={sectorQuery} onChange={(e) => setSectorQuery(e.target.value)}
                  placeholder="Buscar sector…" aria-label="Buscar sector"
                />
              </label>
              <div className="seg seg-sm" role="group" aria-label="Filtro de sectores">
                <button data-on={sectorFilter === 'todos'} onClick={() => setSectorFilter('todos')}>Todos</button>
                <button data-on={sectorFilter === 'termino'} onClick={() => setSectorFilter('termino')}>Con término</button>
                <button data-on={sectorFilter === 'sancion'} onClick={() => setSectorFilter('sancion')}>Con sanción</button>
                <button data-on={sectorFilter === 'potencial'} onClick={() => setSectorFilter('potencial')}>Con potenciales</button>
                <button data-on={sectorFilter === 'silencio'} onClick={() => setSectorFilter('silencio')}>Sin ROS 5 años</button>
              </div>
            </div>
          )}
        />
        <div className="uso-sector-layout">
          <div className="uso-table-wrap">
            <table className="table uso-table">
              <thead>
                <tr>
                  <SortTh sort={sectorSort} field="sector" label="Sector obligado" align="left" />
                  <SortTh sort={sectorSort} field="sujetos" label="SO" hint="Inscritos en el padrón vigente" />
                  <SortTh sort={sectorSort} field="terminados" label="Término" />
                  <SortTh sort={sectorSort} field="sancionados" label="Sanción" />
                  <SortTh sort={sectorSort} field="atencion" label="Revisión" />
                  <SortTh sort={sectorSort} field="ipf" label="IPF medio" />
                  <SortTh sort={sectorSort} field="ros" label="ROS 2025" />
                  <SortTh sort={sectorSort} field="tasa" label="ROS/100" hint="ROS 2025 por cada 100 inscritos del Informe Estadístico" />
                  <SortTh sort={sectorSort} field="potenciales" label="Potenciales" />
                </tr>
              </thead>
              <tbody>
                {sectorRows.map((row) => (
                  <tr key={row.sector} data-on={focus?.sector === row.sector}>
                    <td className="uso-cell-name">
                      <button onClick={() => setPicked(row.sector)} aria-pressed={focus?.sector === row.sector}>
                        <span>
                          {titleCase(row.sector)}
                          {row.silencio && <em className="uso-tag" data-tone="none">sin ROS 5a</em>}
                        </span>
                        <span className="uso-cell-bar" aria-hidden><i style={{ width: `${(row.sujetos / maxSector) * 100}%` }} /></span>
                      </button>
                    </td>
                    <td className="right num"><b>{n(row.sujetos)}</b><em className="uso-cell-sub">{n1(row.share)}%</em></td>
                    <td className="right num">{row.terminados > 0 ? n(row.terminados) : '—'}</td>
                    <td className="right num">{row.sancionados > 0 ? n(row.sancionados) : '—'}</td>
                    <td className="right num">{n(row.atencion)}</td>
                    <td className="right num">{n1(row.ipf)}</td>
                    <td className="right num">{row.ros == null ? '—' : n(row.ros)}</td>
                    <td className="right num">{row.tasa == null ? '—' : n1(row.tasa)}</td>
                    <td className="right num">{row.potenciales > 0 ? n(row.potenciales) : '—'}</td>
                  </tr>
                ))}
                {!sectorRows.length && (
                  <tr><td colSpan={9}><div className="uso-inline"><Empty title="Ningún sector cumple el filtro" /></div></td></tr>
                )}
              </tbody>
            </table>
          </div>

          {focus && (
            <aside className="uso-focus" aria-live="polite">
              <span className="uso-kicker">Sector seleccionado</span>
              <h3>{titleCase(focus.sector)}</h3>
              <div className="uso-focus-head">
                <b className="num">{n(focus.sujetos)}</b>
                <em>inscritos · {n1(focus.share)}% del padrón</em>
              </div>
              <dl className="uso-facts uso-facts-tight">
                <div title={sectorOverview?.metodologia.vulnerabilidad}>
                  <dt>Vulnerabilidad</dt>
                  <dd className="num">
                    {n1(focus.detail?.vulnerability_index)}
                    {sectorOverview?.totales.vulnerabilidad_media != null && (
                      <em className="uso-cell-sub">media {n1(sectorOverview.totales.vulnerabilidad_media)}</em>
                    )}
                  </dd>
                </div>
                <div><dt>Riesgo inherente</dt><dd className="num">{focus.detail?.risk_inherent_1_5 == null ? '—' : `${n1(focus.detail.risk_inherent_1_5)}/5`}</dd></div>
                <div><dt>IPF medio</dt><dd className="num">{n1(focus.ipf)}</dd></div>
                <div><dt>IPF p90</dt><dd className="num">{n1(focus.detail?.ipf_p90)}</dd></div>
                <div><dt>Sanción /100</dt><dd className="num">{n1(focus.detail?.sanction_rate_per_100)}</dd></div>
                <div><dt>Cobertura SII</dt><dd className="num">{focus.detail?.sii_coverage_pct == null ? '—' : `${n1(focus.detail.sii_coverage_pct)}%`}</dd></div>
                <div><dt>Giro atípico</dt><dd className="num">{n(focus.detail?.atypical_activity_subjects)}</dd></div>
                <div><dt>Personas naturales</dt><dd className="num">{n(focus.detail?.natural_person_subjects)}</dd></div>
              </dl>
              <p className="uso-focus-role">
                La vulnerabilidad describe el modelo de negocio del sector —efectivo, opacidad, internacionalidad,
                velocidad, terceros y complejidad jurídica—, nunca la conducta de una entidad inscrita.
              </p>
              {focus.detail?.top_region && (
                <p className="uso-focus-note">
                  Mayor concentración en <b>{titleCase(focus.detail.top_region)}</b>
                  {focus.detail.top_region_share_pct != null && <> · {n1(focus.detail.top_region_share_pct)}% del sector</>}
                </p>
              )}
              <div className="uso-focus-ros">
                <span className="uso-kicker">Reportabilidad del sector</span>
                {focus.reporting ? (
                  <>
                    <div className="uso-spark" role="img" aria-label="ROS por año, 2021 a 2025">
                      {([
                        ['21', focus.reporting.ros_2021], ['22', focus.reporting.ros_2022],
                        ['23', focus.reporting.ros_2023], ['24', focus.reporting.ros_2024],
                        ['25', focus.reporting.ros_2025],
                      ] as const).map(([label, value]) => {
                        const peak = Math.max(1, focus.reporting?.ros_2021 ?? 0, focus.reporting?.ros_2022 ?? 0,
                          focus.reporting?.ros_2023 ?? 0, focus.reporting?.ros_2024 ?? 0, focus.reporting?.ros_2025 ?? 0);
                        return (
                          <span key={label} title={`20${label}: ${n(value)} ROS`}>
                            <i style={{ height: `${value == null ? 2 : Math.max(3, (value / peak) * 100)}%` }} data-empty={value == null} />
                            <em>{label}</em>
                          </span>
                        );
                      })}
                    </div>
                    <div className="uso-focus-rosfacts">
                      <span>ROS 2021-2025 <b className="num">{n(focus.reporting.ros_total_2021_2025)}</b></span>
                      <span>ICR <b className="num">{focus.icr == null ? '—' : `${n1(focus.icr)}%`}</b></span>
                      {focus.silencio && <span className="uso-tag" data-tone="none">sin ROS en 5 años</span>}
                    </div>
                  </>
                ) : <p className="uso-focus-note">El Informe Estadístico no publica serie para este sector.</p>}
              </div>
              <div className="uso-focus-actions">
                <button className="btn btn-sm" onClick={() => onCohort({ cohort: 'SECTOR', value: focus.sector, title: titleCase(focus.sector) })}>
                  Ver las {n(focus.sujetos)} entidades
                </button>
                {focus.terminados > 0 && (
                  <button className="btn btn-sm" onClick={() => onWork({ kind: 'TERMINO', sector: focus.sector })}>
                    Gestionar {n(focus.terminados)} términos →
                  </button>
                )}
                {focus.potenciales > 0 && (
                  <button className="btn btn-sm" onClick={() => onWork({ kind: 'POTENCIAL', sector: focus.sector })}>
                    Revisar {n(focus.potenciales)} potenciales →
                  </button>
                )}
              </div>
            </aside>
          )}
        </div>
      </section>

      <section className="uso-panel">
        <SectionHead
          kicker="4 · Territorio"
          title="Dónde están los sujetos obligados"
          hint="El IGR describe el entorno comunal donde opera el sujeto; nunca al sujeto. Siempre se imprime con el nombre de su nivel."
          actions={<button className="btn btn-sm" onClick={() => onNavigate(hrefFor({ view: 'territorio' }))}>Abrir Territorio →</button>}
        />
        <div className="uso-region-layout">
          <div className="uso-table-wrap">
            <table className="table uso-table">
              <thead>
                <tr>
                  <SortTh sort={regionSort} field="region" label="Región" align="left" />
                  <SortTh sort={regionSort} field="sujetos" label="SO" />
                  <SortTh sort={regionSort} field="terminados" label="Término" />
                  <SortTh sort={regionSort} field="sancionados" label="Sanción" />
                  <SortTh sort={regionSort} field="proveedores" label="Proveedor" />
                  <SortTh sort={regionSort} field="atencion" label="Revisión" />
                  <SortTh sort={regionSort} field="igr" label="IGR medio" hint="Índice de gravedad del entorno comunal" />
                  <th />
                </tr>
              </thead>
              <tbody>
                {regionRows.map((row) => (
                  <tr key={row.region}>
                    <td className="uso-cell-name">
                      <button onClick={() => onCohort({ cohort: 'REGION', value: row.region, title: titleCase(row.region) })}>
                        <span>{titleCase(row.region)}</span>
                        <span className="uso-cell-bar" aria-hidden><i style={{ width: `${(row.sujetos / maxRegion) * 100}%` }} /></span>
                      </button>
                    </td>
                    <td className="right num"><b>{n(row.sujetos)}</b><em className="uso-cell-sub">{n1(row.share)}%</em></td>
                    <td className="right num">{row.terminados > 0 ? n(row.terminados) : '—'}</td>
                    <td className="right num">{row.sancionados > 0 ? n(row.sancionados) : '—'}</td>
                    <td className="right num">{row.proveedores > 0 ? n(row.proveedores) : '—'}</td>
                    <td className="right num">{n(row.atencion)}</td>
                    <td className="right num">
                      {n1(row.igr)}
                      {row.banda && <em className="uso-cell-sub">{row.banda}</em>}
                    </td>
                    <td className="right">
                      <button
                        className="btn btn-sm"
                        onClick={() => onNavigate(hrefFor({ view: 'entidades', region: row.region }))}
                      >
                        Entidades →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="uso-triple">
        <div className="uso-panel">
          <SectionHead
            kicker="5 · Prioridad"
            title="Prioridad fiscalizadora (IPF)"
            hint="Ordena esfuerzo de fiscalización. No es probabilidad de LA/FT."
          />
          <div className="uso-ipf">
            <div className="uso-ipf-track" aria-hidden>
              {ipfBands.map((row) => (
                <i key={row.banda} data-step={row.step} style={{ width: `${(row.sujetos / Math.max(1, u.con_ipf)) * 100}%` }} title={`${row.label}: ${n(row.sujetos)}`} />
              ))}
            </div>
            <ul className="uso-ipf-legend">
              {ipfBands.map((row) => (
                <li key={row.banda}>
                  <i data-step={row.step} aria-hidden />
                  <span>{row.label}</span>
                  <b className="num">{n(row.sujetos)}</b>
                  <em>{row.medio == null ? '' : `IPF ${n1(row.medio)}`}</em>
                </li>
              ))}
            </ul>
            <p className="uso-note">
              {n(sinIpf)} sujetos sin IPF medido quedan fuera de la distribución · p90 del padrón {n1(u.ipf_p90)}
            </p>
            <button className="btn btn-sm" onClick={() => onCohort({ cohort: 'IPF_ALTO', title: 'Sujetos con IPF alta o muy alta' })}>
              Abrir los {n(u.ipf_alto)} de prioridad alta →
            </button>
          </div>
        </div>

        <div className="uso-panel">
          <SectionHead
            kicker="6 · Entorno"
            title="Entorno territorial donde operan"
            hint="Mezcla de niveles del IGR comunal de los inscritos con comuna observable."
          />
          {igrRows.length ? <OrderedDistribution rows={igrRows} total={igrRows.reduce((acc, row) => acc + row.value, 0)} /> : <Empty title="Sin mezcla de IGR en el corte" />}
          <p className="uso-note">
            {n(sinIgr)} sujetos sin IGR: su comuna no está observada o no tiene índice vigente.
          </p>
          <div className="uso-focus-actions">
            <button className="btn btn-sm" onClick={() => onCohort({ cohort: 'IGR_MUY_ALTO', title: 'Sujetos en comunas de IGR muy alto' })}>
              Entidades en IGR muy alto →
            </button>
          </div>
        </div>

        <div className="uso-panel">
          <SectionHead
            kicker="7 · Industria"
            title="Industria declarada al SII"
            hint="Rubro económico del contribuyente, distinto del sector que obliga."
          />
          <Bars
            data={(pulse.by_industry ?? []).slice(0, 8).map((row) => ({
              label: titleCase(row.industria),
              value: row.sujetos,
              sub: row.terminados > 0 ? `${n(row.terminados)} término` : undefined,
            }))}
            onPick={(label) => {
              const row = (pulse.by_industry ?? []).find((item) => titleCase(item.industria) === label);
              if (row) onCohort({ cohort: 'INDUSTRIA', value: row.industria, title: titleCase(row.industria) });
            }}
          />
        </div>
      </section>

      <section className="uso-panel">
        <SectionHead
          kicker="8 · Ciclo"
          title="Altas de actividad contra términos de giro"
          hint="Cada barra de término abre la cohorte de ese año, que es de donde sale la cola de desinscripción."
        />
        <div className="uso-cycle">
          {cycleYears.map((year) => (
            <div className="uso-cycle-year" key={year.ano}>
              <div className="uso-cycle-bars">
                <span
                  className="uso-cycle-bar" data-kind="alta"
                  style={{ height: `${(year.altas / maxCycle) * 100}%` }}
                  title={`${year.ano}: ${n(year.altas)} inicios de actividad`}
                />
                <button
                  className="uso-cycle-bar" data-kind="termino"
                  style={{ height: `${(year.terminos / maxCycle) * 100}%` }}
                  onClick={() => onCohort({ cohort: 'TERMINO_ANO', value: String(year.ano), title: `Término de giro en ${year.ano}` })}
                  title={`${year.ano}: ${n(year.terminos)} términos de giro — abrir la cohorte`}
                  aria-label={`Abrir los ${n(year.terminos)} términos de giro de ${year.ano}`}
                />
              </div>
              <em>{String(year.ano).slice(2)}</em>
            </div>
          ))}
        </div>
        <div className="uso-cycle-legend">
          <span><i data-kind="alta" />Inicio de actividades</span>
          <span><i data-kind="termino" />Término de giro</span>
          <em>{pulse.coverage?.uaf_registration_note}</em>
        </div>
      </section>

      <section className="uso-panel uso-bridge">
        <SectionHead
          kicker="9 · Puente a la gestión"
          title="Lo que este padrón deja abierto"
          hint="Las dos brechas del registro se trabajan caso a caso en el segundo eje."
        />
        <div className="uso-bridge-grid">
          <button className="uso-bridge-card" onClick={() => onWork({ kind: 'TERMINO' })}>
            <span>Inscritos con término de giro</span>
            <b className="num">{n(u.terminados)}</b>
            <em>Siguen en el padrón con giro terminado ante el SII. Cola de revisión de desinscripción.</em>
            <strong>Abrir la mesa →</strong>
          </button>
          <button className="uso-bridge-card" onClick={() => onWork({ kind: 'POTENCIAL' })}>
            <span>Potenciales sujetos obligados</span>
            <b className="num">{n(potentialTotal)}</b>
            <em>
              Hipótesis accionables de la conciliación SII ↔ UAF
              {potential?.totales ? ` sobre ${n(potential.totales.observadas)} observadas por giro` : ''}.
            </em>
            <strong>Abrir la mesa →</strong>
          </button>
          <div className="uso-bridge-note">
            <span className="uso-kicker">Reportabilidad, en una línea</span>
            <p>
              El padrón reportó <b className="num">{n(rep?.ros_2025)}</b> ROS en 2025 y{' '}
              <b className="num">{n(rep?.ros_5y)}</b> en cinco años, con{' '}
              <b className="num">{n(rep?.indicios_5y)}</b> ROS con indicios LA/FT.{' '}
              {rep?.sectores_silenciosos ? <>Hay <b className="num">{n(rep.sectores_silenciosos)}</b> sectores sin ningún ROS en el período.</> : null}
            </p>
            <button className="btn btn-sm" onClick={() => onNavigate(hrefFor({ view: 'pulso', lente: 'reportabilidad' }))}>
              Abrir la lente de reportabilidad →
            </button>
          </div>
        </div>
      </section>

      <details className="uso-limits">
        <summary>Límites declarados de este corte</summary>
        <ul>
          {[
            pulse.coverage?.denominator_note,
            pulse.coverage?.reporting_note,
            pulse.coverage?.silence_note,
            pulse.coverage?.sanction_note,
            pulse.coverage?.press_note,
            pulse.coverage?.supplier_cap_note,
            pulse.coverage?.uaf_registration_note,
            // La caracterización sectorial trae su propia metodología y sus
            // propios límites: se publican aquí, no en la documentación.
            sectorOverview?.metodologia.vulnerabilidad,
            sectorOverview?.metodologia.irar_e.nota,
            sectorOverview?.semantics,
          ].filter(Boolean).map((note) => <li key={note as string}>{note}</li>)}
          {pulse.snapshot && (
            <li>
              Corte {pulse.snapshot.snapshot_id} · generado {fecha(pulse.snapshot.generated_at)}
              {pulse.snapshot.published_at ? ` · publicado ${fecha(pulse.snapshot.published_at)}` : ''}.
            </li>
          )}
        </ul>
      </details>
    </div>
  );
}

function buildCycle(lifecycle: UafPulse['lifecycle']): { ano: number; altas: number; terminos: number }[] {
  const altas = new Map((lifecycle?.started_by_year ?? []).map((row) => [row.ano, row.n]));
  const terminos = new Map((lifecycle?.terminated_by_year ?? []).map((row) => [row.ano, row.n]));
  const years = Array.from(new Set([...altas.keys(), ...terminos.keys()])).sort((a, b) => a - b);
  return years.map((ano) => ({ ano, altas: altas.get(ano) ?? 0, terminos: terminos.get(ano) ?? 0 }));
}
