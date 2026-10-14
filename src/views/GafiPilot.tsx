import { useMemo, useState } from 'react';
import { useRpc } from '../lib/rpc';
import '../styles/gafi-pilot.css';

type Family = 'TODOS' | 'IF' | 'APNFD' | 'PSAV' | 'OSFL' | 'TRANSVERSAL';
type Tab = 'resumen' | 'evaluacion' | 'sectores' | 'entidades';
interface PilotQuestion {
  sequence: number; family: string; fatf_recommendations: string; immediate_outcomes: string;
  title: string; question: string; what_to_request: string; availability: string;
}
interface PilotSector { family: string; sector: string; classification_status: string; n: number; }
interface PilotOverview {
  status: string; completed_at?: string; methodology_version?: string;
  counts?: {
    uaf_source_rows: number; fintech_source_rows: number;
    uaf_classes: Record<string, number>; fintech_classes: Record<string, number>;
    fintech_uaf_intersection: number; osfl_context_not_r8: number; coverage_limits: string[];
  };
  questions?: PilotQuestion[]; sector_breakdown?: PilotSector[];
}
interface ClassifiedEntity {
  source: string; source_key: string; entity_id: string | null; rut: string | null;
  display_name: string; origin_sector: string; family: string;
  classification_status: string; evidence_basis: string;
}
interface EntityResponse { status: string; items?: ClassifiedEntity[]; }
const fmt = (value?: number) => typeof value === 'number' ? new Intl.NumberFormat('es-CL').format(value) : '—';
const when = (value?: string) => value ? new Date(value).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' }) : 'Sin fecha';
const families: { key: Family; label: string }[] = [
  { key: 'TODOS', label: 'Todos' }, { key: 'IF', label: 'IF' }, { key: 'APNFD', label: 'APNFD' },
  { key: 'PSAV', label: 'PSAV / AV' }, { key: 'OSFL', label: 'OSFL' }, { key: 'TRANSVERSAL', label: 'Transversal' },
];
const familyDescription: Record<string, string> = {
  IF: 'Función financiera y materialidad: R.1, R.10–21, R.26–27; RI.1, RI.3 y RI.4.',
  APNFD: 'Actividades y operaciones condicionadas: R.22–23, R.28; RI.3 y RI.4.',
  PSAV: 'Funciones sobre activos virtuales: R.15 y R.16; RI.1, RI.3 y RI.4.',
  OSFL: 'R.8/RI.10: solo el subconjunto funcional relevante, con medidas proporcionales.',
  TRANSVERSAL: 'Coherencia de riesgos y coordinación: R.1–2; RI.1.',
};
const statuses: Record<string, string> = {
  PARCIAL: 'Datos parciales', AGREGADO: 'Solo agregados', NO_INTEGRADO: 'Evidencia no integrada',
  SIN_DATOS: 'Evidencia pendiente', CONDICIONAL: 'Definición condicionada',
  SECTOR_INDICATIVO: 'Sector indicativo', ACTIVIDAD_CONDICIONAL: 'Actividad por verificar',
  SIN_FUNCION_VERIFICADA: 'Función no verificada',
  NO_EQUIVALENCIA_AUTOMATICA: 'Sin equivalencia automática',
  FUNCION_PSAV_IDENTIFICADA: 'Función PSAV identificada',
  INDICIO_REQUIERE_VALIDACION: 'Indicio por validar',
  NO_HAY_EVIDENCIA_NO_EQUIVALE_A_DESCARTE: 'No acreditado ≠ descartado',
};
function Status({ value }: { value: string }) {
  return <span className="gf-status">{statuses[value] ?? value}</span>;
}

export function GafiPilot() {
  const [tab, setTab] = useState<Tab>('resumen');
  const [family, setFamily] = useState<Family>('TODOS');
  const { data, error, loading, reload } = useRpc<PilotOverview>('gafi_pilot_overview', {});
  const { data: entityResult, loading: loadingEntities, error: errorEntities } = useRpc<EntityResponse>(
    'gafi_pilot_entities',
    { p_family: family === 'TODOS' || family === 'OSFL' || family === 'TRANSVERSAL' ? null : family, p_limit: 35 },
    { skip: tab !== 'entidades' || family === 'OSFL' || family === 'TRANSVERSAL' }
  );
  const questions = useMemo(() => (data?.questions ?? []).filter(q =>
    family === 'TODOS' || q.family === family
  ), [data?.questions, family]);
  const sectors = useMemo(() => (data?.sector_breakdown ?? []).filter(s =>
    family === 'TODOS' || family === s.family
  ), [data?.sector_breakdown, family]);
  const count = data?.counts;

  return <section className="gf-view fade-in">
    <div className="gf-head">
      <div>
        <p className="gf-eyebrow">ATLAS · PILOTO AISLADO · EVALUACIÓN MUTUA</p>
        <h1>Radiografía GAFI · Chile</h1>
        <p className="gf-lead">Participantes, perímetro de obligaciones, evidencia supervisora y brechas de caracterización. Análisis adicional que <b>no altera</b> las secciones operativas de Atlas.</p>
      </div>
      <div className="gf-head-side">
        <span className="gf-private">Solo administración · No publicado al resto de usuarios</span>
        <span>Último cálculo: {when(data?.completed_at)}</span>
        <button type="button" onClick={reload} className="gf-refresh">Reconsultar datos publicados ↻</button>
      </div>
    </div>
    {loading && <div className="gf-message">Consultando el último corte del piloto…</div>}
    {error && <div className="gf-message gf-error" role="alert">Error de lectura del piloto: {error}</div>}
    {!loading && !error && data?.status !== 'READY' && <div className="gf-message gf-error">
      {data?.status === 'RESTRICTED' ? 'Piloto disponible solo para administradores.' : 'Aún no hay un corte calculado.'}
    </div>}
    {count && <div className="gf-main">
      <div className="gf-kpis">
        <article><small>Padrón UAF analizado</small><strong>{fmt(count.uaf_source_rows)}</strong><span>100% de sus registros</span></article>
        <article><small>IF · sector indicativo</small><strong>{fmt(count.uaf_classes.IF)}</strong><span>No acredita función efectiva</span></article>
        <article><small>APNFD · sector posible</small><strong>{fmt(count.uaf_classes.APNFD)}</strong><span>Condicionado a actividad y umbral</span></article>
        <article><small>PSAV · función identificada</small><strong>{fmt(count.fintech_classes.PSAV)}</strong><span>+ {fmt(count.fintech_classes.EXPOSICION_AV)} con exposición por validar</span></article>
        <article><small>OSFL · universo contextual</small><strong>{fmt(count.osfl_context_not_r8)}</strong><span>No equivale al subconjunto R.8</span></article>
      </div>
      <div className="gf-tabs" role="tablist" aria-label="Vistas del piloto">
        {([
          ['resumen', 'Radiografía'], ['evaluacion', 'Matriz del evaluador'],
          ['sectores', 'Correspondencia sectorial'], ['entidades', 'Muestra y trazabilidad'],
        ] as const).map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key}
          type="button" data-active={tab === key} onClick={() => { setTab(key); if (key === 'evaluacion') setFamily('TODOS'); }}>{label}</button>)}
      </div>
      <div className="gf-filters" aria-label="Universo de evaluación">
        {families.map(f => <button type="button" key={f.key} data-active={family === f.key} onClick={() => setFamily(f.key)}>{f.label}</button>)}
      </div>
      {tab === 'resumen' && <div className="gf-columns">
        <article className="gf-card">
          <h2>Lectura del perímetro</h2>
          <p>El piloto clasifica el padrón UAF; <b>las familias GAFI no son conjuntos necesariamente excluyentes</b> al extenderlas al universo nacional.</p>
          <div className="gf-bars">
            {[
              { label: 'IF · correspondencia preliminar', n: count.uaf_classes.IF, kind: 'if' },
              { label: 'APNFD · actividad por verificar', n: count.uaf_classes.APNFD, kind: 'apnfd' },
              { label: 'Otros sectores sin equivalencia automática', n: count.uaf_classes.OTROS, kind: 'otros' },
              { label: 'Funciones aún sin verificar', n: count.uaf_classes.POR_EVALUAR, kind: 'pending' },
            ].map(item => <div key={item.kind} className="gf-bar-line">
              <div><span>{item.label}</span><b>{fmt(item.n)}</b></div>
              <div className="gf-bar-track"><i data-kind={item.kind} style={{ width: (100 * item.n / Math.max(count.uaf_source_rows,1)) + '%' }} /></div>
            </div>)}
          </div>
        </article>
        <article className="gf-card">
          <h2>Calidad de la inferencia</h2>
          <div className="gf-fact"><strong>{fmt(count.fintech_uaf_intersection)}</strong><span>Fintech también presentes en padrón UAF. No sumar sin deduplicar RUT.</span></div>
          <div className="gf-fact"><strong>{fmt(count.fintech_classes.FINTECH_NO_PSAV_ACREDITADO)}</strong><span>Fintech sin evidencia funcional PSAV suficiente; no implica ausencia de actividad.</span></div>
          <div className="gf-fact"><strong>{fmt(count.osfl_context_not_r8)}</strong><span>OSFL en base contextual. Falta determinar el subconjunto funcional R.8.</span></div>
        </article>
        <article className="gf-card gf-card-wide">
          <h2>Restricciones para interpretar resultados</h2>
          <div className="gf-constraints">{count.coverage_limits.map((x,i) => <p key={i}><span>{i+1}</span>{x}</p>)}</div>
          <p className="gf-footnote">Metodología: {data.methodology_version}. No son calificaciones de cumplimiento técnico o efectividad. Sin datos de beneficiario final.</p>
        </article>
      </div>}
      {tab === 'evaluacion' && <div className="gf-card">
        <div className="gf-section-title"><h2>Qué pedir · qué medir · qué evaluar</h2><span>{questions.length} controles</span></div>
        {family !== 'TODOS' && <p className="gf-sub">{familyDescription[family]}</p>}
        <div className="gf-matrix">
          {questions.map(q => <article key={q.sequence} className="gf-eval">
            <div className="gf-eval-head"><strong>{q.family}</strong><span>{q.fatf_recommendations} · {q.immediate_outcomes}</span><Status value={q.availability}/></div>
            <h3>{q.title}</h3>
            <p><b>Pregunta:</b> {q.question}</p>
            <p><b>Solicitar y evaluar:</b> {q.what_to_request}</p>
          </article>)}
        </div>
      </div>}
      {tab === 'sectores' && <div className="gf-card">
        <div className="gf-section-title"><h2>Reglas GAFI–Chile sobre sectores UAF</h2><span>{sectors.length} sectores</span></div>
        {(family === 'OSFL' || family === 'PSAV' || family === 'TRANSVERSAL') && <p className="gf-sub">Este universo exige clasificación funcional específica. Revisa la Matriz del evaluador.</p>}
        <div className="gf-table-scroll"><table className="gf-table">
          <thead><tr><th>Sector UAF publicado</th><th>Familia indicativa</th><th>Estado metodológico</th><th>SO</th></tr></thead>
          <tbody>{sectors.map(s => <tr key={s.sector}><td>{s.sector}</td><td>{s.family}</td><td><Status value={s.classification_status}/></td><td className="gf-number">{fmt(s.n)}</td></tr>)}</tbody>
        </table></div>
      </div>}
      {tab === 'entidades' && <div className="gf-card">
        <div className="gf-section-title"><h2>Muestra limitada · vínculo al expediente original</h2><span>35 entidades como máximo</span></div>
        {(family === 'OSFL' || family === 'TRANSVERSAL') ? <p className="gf-message">No se publica una lista de OSFL «R.8» sin validación funcional. Selecciona IF, APNFD o PSAV.</p> : <>
          {loadingEntities && <p className="gf-message">Cargando muestra…</p>}
          {errorEntities && <p className="gf-message gf-error">{errorEntities}</p>}
          <div className="gf-table-scroll"><table className="gf-table">
            <thead><tr><th>Entidad</th><th>Fuente</th><th>Familia</th><th>Certeza</th></tr></thead>
            <tbody>{(entityResult?.items ?? []).map(x => <tr key={x.source + ':' + x.source_key}>
              <td>{x.source === 'UAF' && x.entity_id ? <a href={'#/entidad/' + encodeURIComponent(x.entity_id)}>{x.display_name}</a> : x.display_name}
                <small>{x.rut || 'Sin RUT nacional confirmado'} · {x.origin_sector}</small></td>
              <td>{x.source}</td><td>{x.family}</td><td><Status value={x.classification_status}/></td>
            </tr>)}</tbody>
          </table></div>
          {!loadingEntities && entityResult?.items?.length === 0 && <p className="gf-message">No hay resultados en el corte actual.</p>}
        </>}
      </div>}
      <p className="gf-disclaimer">PILOTO DE TRABAJO · Datos derivados y reglas versionadas. Sin modificaciones en registros UAF, fuentes SII/RES, supervisión ni contenido de fichas existentes.</p>
    </div>}
  </section>;
}
