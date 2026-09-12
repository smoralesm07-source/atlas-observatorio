import { useEffect, useMemo, useState } from 'react';
import type { EntityDetail } from '../../lib/contracts';
import { fecha, n, n1, titleCase } from '../../lib/format';
import { searchPress, type PressMatch } from '../../lib/press';
import { useRpc } from '../../lib/rpc';
import type { CaseRow } from './model';

type PressState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  matches: PressMatch[];
};

const compactRut = (value: string | null | undefined) => String(value ?? '').toUpperCase().replace(/[^0-9K]/g, '');
const normalizedStatus = (value: string | null | undefined) => String(value ?? '').toUpperCase();

function strictPress(rut: string, matches: PressMatch[]): PressMatch[] {
  const target = compactRut(rut);
  if (target) {
    const exact = matches.filter((match) => match.ruts.some((candidate) => compactRut(candidate) === target));
    if (exact.length) return exact;
  }
  return matches.filter((match) => match.match_score >= 0.94 && !match.requires_validation);
}

function statusLabel(value: string | null | undefined): string {
  const raw = normalizedStatus(value);
  if (!raw) return 'Sin dato';
  if (raw.includes('ACTIVE') || raw.includes('VIGENTE')) return 'Activo';
  if (raw.includes('TERMIN')) return 'Término de giro';
  return titleCase(raw.replace(/_/g, ' '));
}

function signalTone(value: boolean | null): 'positive' | 'neutral' | 'attention' {
  if (value === true) return 'positive';
  if (value === false) return 'neutral';
  return 'attention';
}

export function PotentialIntakePreview({ row, onTake }: { row: CaseRow; onTake: () => void }) {
  const candidate = row.candidate;
  const entityId = row.subject.entityId ?? candidate?.entity_id ?? null;
  const detail = useRpc<EntityDetail | null>('obs_entity_detail', { p_entity_id: entityId }, { skip: !entityId });
  const [press, setPress] = useState<PressState>({ status: 'idle', matches: [] });

  useEffect(() => {
    let cancelled = false;
    setPress({ status: 'loading', matches: [] });
    const run = async () => {
      try {
        let matches = strictPress(row.subject.rut, await searchPress(row.subject.rut || row.subject.name, 10));
        if (!matches.length) matches = strictPress(row.subject.rut, await searchPress(row.subject.name, 10));
        if (!cancelled) setPress({ status: 'done', matches });
      } catch {
        if (!cancelled) setPress({ status: 'error', matches: [] });
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [row.key, row.subject.name, row.subject.rut]);

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

  const sector = candidate?.implied_sector ?? row.subject.sector ?? null;
  const activity = candidate?.matched_activity ?? detail.data?.entity.tax_activity ?? null;
  const siiStatus = candidate?.sii_status ?? detail.data?.entity.tax_status ?? null;
  const active = /ACTIVE|VIGENTE/.test(normalizedStatus(siiStatus));
  const activityStart = candidate?.sii_activity_start_date ?? detail.data?.entity.tax_activity_start ?? null;
  const workers = candidate?.workers ?? detail.data?.entity.tax_workers ?? null;
  const salesRank = candidate?.sales_band_rank ?? detail.data?.entity.tax_sales_band_rank ?? null;
  const salesBand = salesRank === 1
    ? null
    : candidate?.sales_band_uf ?? detail.data?.entity.tax_sales_band_uf ?? candidate?.sales_band_size ?? null;
  const region = candidate?.region ?? row.subject.region ?? detail.data?.entity.tax_region ?? null;
  const commune = candidate?.commune ?? row.subject.commune ?? detail.data?.entity.commune ?? null;
  const sanctions = detail.data?.sanctions ?? [];
  const sanctionCount = sanctions.length || candidate?.uaf_sanction_events || 0;
  const sanctionLast = sanctions
    .map((item) => item.event_date)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.localeCompare(a))[0] ?? candidate?.uaf_sanction_last_date ?? null;
  const sourceCount = candidate?.source_count ?? detail.data?.entity.source_count ?? 0;
  const evidenceCount = candidate?.screening_evidence_count ?? row.marks.evidence ?? 0;
  const pressCount = articles.length;
  const latestPress = articles[0] ?? null;
  const hasOperatingFootprint = Boolean((salesBand && salesBand !== '—') || (workers != null && workers > 0));
  const hasExternalSignal = pressCount > 0 || sanctionCount > 0;

  return (
    <div className="uso-potential-intake">
      <section className="uso-potential-hero">
        <div className="uso-potential-sector">
          <span className="uso-kicker">Sector propuesto para incorporación</span>
          <h4>{sector ? titleCase(sector) : 'Sector aún no resuelto'}</h4>
          <p>{row.subject.motive}</p>
          <div className="uso-potential-tags" aria-label="Claves de la propuesta">
            <span data-tone={signalTone(Boolean(activity))}>{activity ? 'Actividad SII coincidente' : 'Actividad por revisar'}</span>
            <span data-tone={signalTone(active)}>{statusLabel(siiStatus)}</span>
            <span data-tone={signalTone(hasOperatingFootprint)}>{hasOperatingFootprint ? 'Operación observable' : 'Huella operativa limitada'}</span>
            <span data-tone={signalTone(hasExternalSignal)}>{hasExternalSignal ? 'Con señales externas' : 'Sin señales externas detectadas'}</span>
          </div>
        </div>
        <aside className="uso-potential-decision-box">
          <span className="uso-kicker">Decisión analítica</span>
          <b>¿Corresponde abrir una gestión?</b>
          <p>Revisa sector, actividad, tamaño y señales externas antes de asignarte el caso.</p>
          <button className="btn btn-primary" onClick={onTake}>Tomar caso</button>
          <small>Al tomarlo, Atlas abre el flujo de ubicación y registro de gestión.</small>
        </aside>
      </section>

      <section className="uso-potential-grid">
        <article className="uso-potential-card uso-potential-profile">
          <div className="uso-potential-card-head">
            <div>
              <span className="uso-kicker">Perfil operativo</span>
              <h5>Antecedentes SII y territoriales</h5>
            </div>
            <span className="uso-potential-card-status">{statusLabel(siiStatus)}</span>
          </div>
          <div className="uso-potential-kpis">
            <div><span>Inicio de actividades</span><b>{activityStart ? fecha(activityStart) : 'Sin dato'}</b></div>
            <div><span>Ventas</span><b>{salesBand ? salesBand : 'Sin información publicada'}</b></div>
            <div><span>Trabajadores</span><b>{workers != null ? n(workers) : 'Sin dato'}</b></div>
            <div><span>Región</span><b>{region ? titleCase(region) : 'Sin dato'}</b></div>
            <div><span>Comuna</span><b>{commune ? titleCase(commune) : 'Sin dato'}</b></div>
            <div><span>Antigüedad</span><b>{candidate?.activity_years != null ? `${n(candidate.activity_years)} años` : 'Sin dato'}</b></div>
          </div>
          <div className="uso-potential-activity">
            <span>Actividad que gatilla la propuesta</span>
            <b>{activity ? titleCase(activity) : 'Sin actividad coincidente identificada'}</b>
          </div>
        </article>

        <article className="uso-potential-card uso-potential-signals">
          <div className="uso-potential-card-head">
            <div>
              <span className="uso-kicker">Señales externas</span>
              <h5>Prensa y sanciones</h5>
            </div>
          </div>
          <div className="uso-potential-signal-list">
            <div className="uso-potential-signal" data-active={pressCount > 0 ? 'true' : undefined}>
              <div><span>Prensa coincidente</span><b>{press.status === 'loading' ? 'Consultando…' : press.status === 'error' ? 'No disponible' : `${n(pressCount)} coincidencia${pressCount === 1 ? '' : 's'}`}</b></div>
              {latestPress ? (
                <div className="uso-potential-signal-detail">
                  <strong>{latestPress.title}</strong>
                  <small>{[latestPress.media, latestPress.date ? fecha(latestPress.date) : null].filter(Boolean).join(' · ')}</small>
                  {latestPress.url && <a href={latestPress.url} target="_blank" rel="noreferrer">Abrir noticia ↗</a>}
                </div>
              ) : <small>{press.status === 'done' ? 'No hay coincidencias de alta confianza para esta entidad.' : 'El resultado se actualiza con Radar Prensa.'}</small>}
            </div>
            <div className="uso-potential-signal" data-active={sanctionCount > 0 ? 'true' : undefined}>
              <div><span>Sanciones</span><b>{sanctionCount > 0 ? `${n(sanctionCount)} evento${sanctionCount === 1 ? '' : 's'}` : 'Sin sanciones observadas'}</b></div>
              <small>{sanctionLast ? `Último evento: ${fecha(sanctionLast)}` : 'Según las fuentes integradas disponibles.'}</small>
            </div>
          </div>
        </article>
      </section>

      <section className="uso-potential-context-grid">
        <article className="uso-potential-reason">
          <span className="uso-kicker">Por qué aparece como Potencial SO</span>
          <b>{row.subject.motive}</b>
          <p>La propuesta orienta revisión registral y no constituye por sí sola una conclusión jurídica de obligación o incumplimiento.</p>
          <div className="uso-potential-evidence-strip">
            <span><b>{candidate?.ivo_score != null ? n1(candidate.ivo_score) : '—'}</b> IVO</span>
            <span><b>{n(sourceCount)}</b> fuentes</span>
            <span><b>{n(evidenceCount)}</b> evidencias</span>
            <span><b>{candidate?.res_available ? 'Sí' : 'No'}</b> RES</span>
          </div>
        </article>

        <article className="uso-potential-review">
          <span className="uso-kicker">Lectura para decisión</span>
          <ul>
            <li data-ok={Boolean(sector)}>Sector sugerido: <b>{sector ? titleCase(sector) : 'por resolver'}</b></li>
            <li data-ok={active}>Actividad SII: <b>{statusLabel(siiStatus)}</b></li>
            <li data-ok={hasOperatingFootprint}>Huella operativa: <b>{hasOperatingFootprint ? 'observable' : 'limitada / sin dato'}</b></li>
            <li data-ok={hasExternalSignal}>Señales externas: <b>{hasExternalSignal ? 'presentes' : 'no detectadas'}</b></li>
          </ul>
          {detail.loading && <small>Atlas está completando antecedentes de Entidad 360…</small>}
          {detail.error && <small>No fue posible completar Entidad 360; la ficha conserva los datos de la cohorte Potencial SO.</small>}
        </article>
      </section>
    </div>
  );
}
