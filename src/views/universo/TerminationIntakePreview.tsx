import { useEffect, useState } from 'react';
import type { EntityDetail } from '../../lib/contracts';
import { fecha, n, titleCase } from '../../lib/format';
import { useRpc } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { CopyButton } from './bits';
import type { CaseRow } from './model';
import '../../styles/universo-termination-intake.css';

type ContextEvidence = {
  title: string;
  url: string;
  domain: string;
  official: boolean;
  snippet: string;
};

type ContextResult = {
  visible: boolean;
  status: string;
  confidence: number;
  signal?: string;
  signal_label?: string;
  successor?: string | null;
  effective_date?: string | null;
  summary?: string;
  evidence?: ContextEvidence[];
  independent_domains?: number;
  official_support?: boolean;
};

type ContextState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  data: ContextResult | null;
};

function trimText(value: string | null | undefined, max = 270): string {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function TerminationIntakePreview({ row, onTake }: { row: CaseRow; onTake: () => void }) {
  const entityId = row.subject.entityId ?? row.termination?.entity_id ?? null;
  const detail = useRpc<EntityDetail | null>('obs_entity_detail', { p_entity_id: entityId }, { skip: !entityId });
  const [context, setContext] = useState<ContextState>({ status: 'idle', data: null });

  useEffect(() => {
    let cancelled = false;
    setContext({ status: 'loading', data: null });
    void supabase.functions.invoke('atlas-termination-openweb', {
      body: {
        name: row.subject.name,
        rut: row.subject.rut,
        region: row.subject.region,
        commune: row.subject.commune,
        termination_date: row.date,
      },
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setContext({ status: 'error', data: null });
        return;
      }
      setContext({ status: 'done', data: data as ContextResult });
    }).catch(() => {
      if (!cancelled) setContext({ status: 'error', data: null });
    });
    return () => { cancelled = true; };
  }, [row.key, row.subject.name, row.subject.rut, row.subject.region, row.subject.commune, row.date]);

  const terminationDate = row.date ?? detail.data?.entity.tax_termination ?? null;
  const activityStart = detail.data?.entity.tax_activity_start ?? null;
  const workers = row.workers ?? detail.data?.entity.tax_workers ?? null;
  const sales = row.size ?? detail.data?.entity.tax_sales_band_uf ?? detail.data?.entity.tax_size ?? null;
  const activity = row.termination?.main_activity ?? detail.data?.entity.tax_activity ?? null;
  const sanctions = detail.data?.sanctions?.length ?? row.marks.sanction;
  const openContext = context.status === 'done' && context.data?.visible && context.data.summary
    ? context.data
    : null;

  return (
    <div className="uso-termination-intake">
      <section className="uso-termination-hero">
        <article className="uso-termination-case-card">
          <div className="uso-termination-card-head">
            <div>
              <span className="uso-kicker">Evaluación previa</span>
              <h4>Revisar término de giro</h4>
              <p>{row.subject.motive}</p>
            </div>
            <span className="uso-termination-date">{terminationDate ? fecha(terminationDate) : 'Fecha sin dato'}</span>
          </div>

          <div className="uso-termination-kpis">
            <div><span>Inicio actividades</span><b>{activityStart ? fecha(activityStart) : 'Sin dato'}</b></div>
            <div><span>Antigüedad</span><b>{row.years != null ? `${n(row.years)} años` : 'Sin dato'}</b></div>
            <div><span>Ventas</span><b>{sales || 'Sin dato'}</b></div>
            <div><span>Trabajadores</span><b>{workers != null ? n(workers) : 'Sin dato'}</b></div>
            <div><span>Región</span><b>{row.subject.region ? titleCase(row.subject.region) : 'Sin dato'}</b></div>
            <div><span>Sanciones</span><b>{sanctions > 0 ? `${n(sanctions)} evento${sanctions === 1 ? '' : 's'}` : 'Sin sanciones observadas'}</b></div>
          </div>

          {activity && (
            <div className="uso-termination-activity">
              <span>Actividad principal</span>
              <b>{titleCase(activity)}</b>
            </div>
          )}
        </article>

        <aside className="uso-termination-decision-box">
          <span className="uso-kicker">Decisión analítica</span>
          <b>¿Conviene iniciar gestión?</b>
          <p>Usa el contexto registral y, cuando exista evidencia suficiente, la explicación recuperada desde fuentes abiertas.</p>
          <button className="btn btn-primary" onClick={onTake}>Tomar caso</button>
          <small>Al tomarlo, Atlas abre el flujo de ubicación y registro de gestión.</small>
        </aside>
      </section>

      {openContext && (
        <section className="uso-termination-context-card">
          <div className="uso-termination-context-head">
            <div>
              <span className="uso-kicker">Contexto abierto concluyente</span>
              <h5>Qué puede explicar el término de giro</h5>
              <p>Atlas sólo muestra este bloque cuando reúne evidencia consistente por identidad y fuente. Si no alcanza ese umbral, la ficha no presenta una conclusión.</p>
            </div>
            <span className="uso-termination-confidence" data-official={openContext.official_support ? 'true' : undefined}>
              {openContext.official_support ? 'Fuente oficial' : 'Fuentes concordantes'} · {n(openContext.confidence)}%
            </span>
          </div>

          <div className="uso-termination-context-summary">
            <div>
              <span>{openContext.signal_label || 'Contexto explicativo'}</span>
              <p>{openContext.summary}</p>
            </div>
            <CopyButton text={openContext.summary || ''} label="Copiar resumen" done="Resumen copiado" small />
          </div>

          {Array.isArray(openContext.evidence) && openContext.evidence.length > 0 && (
            <div className="uso-termination-context-evidence">
              {openContext.evidence.slice(0, 3).map((item) => (
                <article key={item.url}>
                  <div>
                    <div className="uso-termination-evidence-title">
                      <b>{item.title || item.domain}</b>
                      {item.official && <span>Oficial</span>}
                    </div>
                    <small>{item.domain}</small>
                    {item.snippet && <p>{trimText(item.snippet)}</p>}
                  </div>
                  <a href={item.url} target="_blank" rel="noreferrer">Fuente ↗</a>
                </article>
              ))}
            </div>
          )}

          <div className="uso-termination-context-foot">
            <span>{openContext.independent_domains ? `${n(openContext.independent_domains)} fuente${openContext.independent_domains === 1 ? '' : 's'} independiente${openContext.independent_domains === 1 ? '' : 's'}` : 'Evidencia contrastada'}</span>
            {openContext.successor && <span>Continuidad detectada: {openContext.successor}</span>}
            {openContext.effective_date && <span>Fecha referencial: {openContext.effective_date}</span>}
          </div>
        </section>
      )}
    </div>
  );
}
