import { useEffect, useMemo, useState } from 'react';
import type { EntityDetail } from '../../lib/contracts';
import { fecha, n, titleCase } from '../../lib/format';
import { normalizePressText, searchPress, type PressMatch } from '../../lib/press';
import { useRpc } from '../../lib/rpc';
import { CopyButton } from './bits';
import type { CaseRow } from './model';
import '../../styles/universo-termination-intake.css';

type PressState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  matches: PressMatch[];
};

const compactRut = (value: string | null | undefined) => String(value ?? '').toUpperCase().replace(/[^0-9K]/g, '');

function strictPress(rut: string, matches: PressMatch[]): PressMatch[] {
  const target = compactRut(rut);
  if (target) {
    const exact = matches.filter((match) => match.ruts.some((candidate) => compactRut(candidate) === target));
    if (exact.length) return exact;
  }
  return matches.filter((match) => match.match_score >= 0.94 && !match.requires_validation);
}

function trimText(value: string | null | undefined, max = 230): string {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

const EXIT_PATTERNS = [
  { label: 'cierre o cese de operaciones', rx: /\b(cierre|cerrad|cese|ceso|dejo de operar|dejar de operar)\b/ },
  { label: 'liquidación, quiebra o insolvencia', rx: /\b(liquidacion|quiebra|insolvencia|reorganizacion)\b/ },
  { label: 'disolución, fusión o absorción', rx: /\b(disolucion|fusion|absorcion|absorbida|extincion)\b/ },
  { label: 'cambio o reemplazo institucional', rx: /\b(reemplaz|suprim|delegacion presidencial|reforma|transformacion|reestructuracion)\b/ },
];

function pressSignals(matches: PressMatch[]): string[] {
  const text = normalizePressText(matches
    .flatMap((match) => match.articles)
    .flatMap((article) => [article.title, article.summary])
    .filter(Boolean)
    .join(' '));
  return EXIT_PATTERNS.filter((item) => item.rx.test(text)).map((item) => item.label);
}

export function TerminationIntakePreview({ row, onTake }: { row: CaseRow; onTake: () => void }) {
  const entityId = row.subject.entityId ?? row.termination?.entity_id ?? null;
  const detail = useRpc<EntityDetail | null>('obs_entity_detail', { p_entity_id: entityId }, { skip: !entityId });
  const [press, setPress] = useState<PressState>({ status: 'idle', matches: [] });

  const runPressSearch = () => {
    let cancelled = false;
    setPress({ status: 'loading', matches: [] });
    const run = async () => {
      try {
        let matches = strictPress(row.subject.rut, await searchPress(row.subject.rut || row.subject.name, 12));
        if (!matches.length) matches = strictPress(row.subject.rut, await searchPress(row.subject.name, 12));
        if (!cancelled) setPress({ status: 'done', matches });
      } catch {
        if (!cancelled) setPress({ status: 'error', matches: [] });
      }
    };
    void run();
    return () => { cancelled = true; };
  };

  useEffect(() => runPressSearch(), [row.key, row.subject.name, row.subject.rut]);

  const articles = useMemo(() => {
    const seen = new Set<string>();
    return press.matches
      .flatMap((match) => match.articles)
      .filter((article) => {
        if (seen.has(article.id)) return false;
        seen.add(article.id);
        return true;
      })
      .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  }, [press.matches]);

  const signals = useMemo(() => pressSignals(press.matches), [press.matches]);
  const latest = articles[0] ?? null;
  const terminationDate = row.date ?? detail.data?.entity.tax_termination ?? null;
  const activityStart = detail.data?.entity.tax_activity_start ?? null;
  const workers = row.workers ?? detail.data?.entity.tax_workers ?? null;
  const sales = row.size ?? detail.data?.entity.tax_sales_band_uf ?? detail.data?.entity.tax_size ?? null;
  const activity = row.termination?.main_activity ?? detail.data?.entity.tax_activity ?? null;
  const sanctions = detail.data?.sanctions?.length ?? row.marks.sanction;
  const pressCount = articles.length;

  const summary = useMemo(() => {
    const name = titleCase(row.subject.name) || row.subject.name;
    if (press.status === 'loading') return `Atlas está consultando Radar Prensa para ${name}.`;
    if (press.status === 'error') return `No fue posible consultar Radar Prensa para ${name}. Conviene complementar con una búsqueda web manual antes de concluir sobre la causa del término de giro.`;
    if (!articles.length) return `Radar Prensa no registra coincidencias de alta confianza para ${name}. La ausencia de resultados no descarta antecedentes disponibles en otras fuentes abiertas.`;
    const latestLine = latest
      ? `La referencia más reciente es de ${latest.media || 'fuente abierta'}${latest.date ? ` (${fecha(latest.date)})` : ''}: “${trimText(latest.title, 145)}”.`
      : '';
    const signalLine = signals.length
      ? `En los textos recuperados aparecen referencias compatibles con ${signals.join(', ')}.`
      : 'Los resúmenes recuperados no muestran una explicación explícita del término de giro.';
    return `Radar Prensa registra ${n(articles.length)} noticia${articles.length === 1 ? '' : 's'} coincidente${articles.length === 1 ? '' : 's'} de alta confianza para ${name}. ${latestLine} ${signalLine} Este resumen orienta la revisión y debe contrastarse con la fuente antes de usarlo como antecedente.`;
  }, [articles.length, latest, press.status, row.subject.name, signals]);

  const webQuery = `"${row.subject.name}" ${row.subject.rut} cierre "término de giro" liquidación quiebra disolución fusión`; 
  const webSearchUrl = `https://www.google.com/search?tbm=nws&q=${encodeURIComponent(webQuery)}`;

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
          <p>Usa el contexto registral y la revisión de prensa para decidir si vale la pena abrir el caso.</p>
          <button className="btn btn-primary" onClick={onTake}>Tomar caso</button>
          <small>Al tomarlo, Atlas abre el flujo de ubicación y registro de gestión.</small>
        </aside>
      </section>

      <section className="uso-termination-news-card">
        <div className="uso-termination-news-head">
          <div>
            <span className="uso-kicker">Fuentes abiertas</span>
            <h5>Noticias que pueden explicar el término de giro</h5>
            <p>Radar Prensa busca coincidencias de alta confianza; la búsqueda web amplía la revisión cuando el índice no basta.</p>
          </div>
          <div className="uso-termination-news-actions">
            <button className="btn btn-sm" onClick={runPressSearch} disabled={press.status === 'loading'}>
              {press.status === 'loading' ? 'Buscando…' : 'Actualizar noticias'}
            </button>
            <a className="btn btn-sm" href={webSearchUrl} target="_blank" rel="noreferrer">Buscar en Google Noticias ↗</a>
          </div>
        </div>

        <div className="uso-termination-news-summary" data-state={press.status}>
          <div>
            <span>Resumen para observación</span>
            <p>{summary}</p>
          </div>
          <CopyButton text={summary} label="Copiar resumen" done="Resumen copiado" small />
        </div>

        {press.status === 'done' && articles.length > 0 && (
          <div className="uso-termination-news-list">
            {articles.slice(0, 3).map((article) => (
              <article key={article.id}>
                <div>
                  <b>{article.title}</b>
                  <small>{[article.media, article.date ? fecha(article.date) : null].filter(Boolean).join(' · ')}</small>
                  {article.summary && <p>{trimText(article.summary)}</p>}
                </div>
                {article.url && <a href={article.url} target="_blank" rel="noreferrer">Abrir ↗</a>}
              </article>
            ))}
          </div>
        )}

        <div className="uso-termination-news-foot">
          <span>{press.status === 'loading' ? 'Consultando…' : `${n(pressCount)} coincidencia${pressCount === 1 ? '' : 's'} visible${pressCount === 1 ? '' : 's'}`}</span>
          {signals.length > 0 && <span>Señales: {signals.join(' · ')}</span>}
          {detail.loading && <span>Completando antecedentes de Entidad 360…</span>}
        </div>
      </section>
    </div>
  );
}
