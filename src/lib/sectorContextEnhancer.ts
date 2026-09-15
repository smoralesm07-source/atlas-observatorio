import { supabase } from './supabase';

type SizeMix = {
  micro?: number | null;
  small?: number | null;
  medium?: number | null;
  large?: number | null;
  with_sales_band?: number | null;
};

type PeerPosition = {
  peer_level?: string | null;
  peer_n?: number | null;
  sales_percentile_pct?: number | null;
};

type EntitySectorContext = {
  available?: boolean;
  comparison_level?: 'ACTIVITY' | 'SECTOR' | string;
  label?: string | null;
  economic_sector?: string | null;
  main_activity?: string | null;
  commercial_year?: number | null;
  peer_count?: number | null;
  active_count?: number | null;
  workers_total?: number | null;
  workers_avg?: number | null;
  observed_growth_5y_pct?: number | null;
  starts_5y?: number | null;
  terminations_5y?: number | null;
  size_mix?: SizeMix | null;
  peer_position?: PeerPosition | null;
  method_note?: string | null;
};

type SectorActivity = {
  activity?: string | null;
  uaf_subjects?: number | null;
  observed_entities?: number | null;
};

type UafSectorContext = {
  available?: boolean;
  uaf_sector?: string | null;
  uaf_subjects?: number | null;
  uaf_subjects_with_sii_activity?: number | null;
  uaf_mapping_pct?: number | null;
  commercial_year?: number | null;
  observed_comparable_entities?: number | null;
  observed_workers_total?: number | null;
  observed_growth_5y_pct?: number | null;
  size_mix?: SizeMix | null;
  top_activities?: SectorActivity[] | null;
  method_note?: string | null;
};

const entityCache = new Map<string, EntitySectorContext | null>();
const sectorCache = new Map<string, UafSectorContext | null>();
const entityPending = new Set<string>();
const sectorPending = new Set<string>();
let activeSector: string | null = null;
let lastSectorScrollKey: string | null = null;

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalize(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentence(value: string | null | undefined) {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Sin actividad comparable';
  const lower = raw.toLocaleLowerCase('es');
  return `${lower.charAt(0).toLocaleUpperCase('es')}${lower.slice(1)}`;
}

function number(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Number(value));
}

function decimal(value: number | null | undefined, suffix = '') {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(Number(value))}${suffix}`;
}

function signed(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${decimal(n, '%')}`;
}

function mixValue(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function currentEntityId() {
  const match = window.location.hash.match(/^#\/entidad\/([^?]+)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function sizeMixMarkup(mix: SizeMix | null | undefined) {
  const rows: [string, number][] = [
    ['Micro', mixValue(mix?.micro)],
    ['Pequeña', mixValue(mix?.small)],
    ['Mediana', mixValue(mix?.medium)],
    ['Grande', mixValue(mix?.large)],
  ];
  return rows.map(([label, value]) => `
    <div class="sctx-mix-row">
      <span>${label}</span>
      <i><b style="width:${value}%"></b></i>
      <strong>${decimal(value, '%')}</strong>
    </div>`).join('');
}

function methodologyMarkup(note: string | null | undefined, year: number | null | undefined) {
  return `
    <details class="sctx-help">
      <summary aria-label="Ayuda metodológica de contexto sectorial" title="Cómo leer esta referencia">i</summary>
      <div class="sctx-help-popover">
        <strong>Referencia económica SII</strong>
        <p>${escapeHtml(note || 'Referencia descriptiva sobre datos SII observados por Atlas.')}</p>
        <p>El tamaño relativo, la composición sectorial y la trayectoria económica son contexto descriptivo. <b>No modifican IPA3</b> ni acreditan riesgo, incumplimiento o delito.</p>
        ${year ? `<small>Corte económico ${escapeHtml(year)}</small>` : ''}
      </div>
    </details>`;
}

function entityCard(data: EntitySectorContext, entityId: string) {
  const card = document.createElement('section');
  card.className = 'entity360-card sctx-card sctx-entity';
  card.dataset.sctxEntity = entityId;
  const level = data.comparison_level === 'ACTIVITY' ? 'actividad económica' : 'sector económico';
  const percentile = data.peer_position?.sales_percentile_pct;
  const position = percentile == null
    ? `<strong>Sin percentil comparable</strong><p>Atlas no materializa un percentil suficientemente robusto para esta entidad en el corte vigente.</p>`
    : `<strong>P${escapeHtml(decimal(percentile))}</strong><p>Percentil de ventas entre ${escapeHtml(number(data.peer_position?.peer_n))} pares comparables del benchmark SII gobernado.</p>`;

  card.innerHTML = `
    <header class="sctx-card-head">
      <div>
        <h2>Contexto sectorial SII</h2>
        <span>${escapeHtml(level)} · corte observado ${escapeHtml(data.commercial_year ?? '—')}</span>
      </div>
      <div class="sctx-head-tools">
        <span class="sctx-chip">Referencia económica</span>
        ${methodologyMarkup(data.method_note, data.commercial_year)}
      </div>
    </header>
    <div class="entity360-card-body sctx-body">
      <div class="sctx-entity-grid">
        <div class="sctx-anchor">
          <span class="sctx-eyebrow">Cohorte comparable</span>
          <h3>${escapeHtml(sentence(data.label))}</h3>
          <p>${escapeHtml(data.comparison_level === 'ACTIVITY' ? sentence(data.economic_sector) : 'Comparación a nivel de sector económico')}</p>
          <div class="sctx-metrics">
            <div><span>Entidades observadas</span><strong>${escapeHtml(number(data.peer_count))}</strong><small>${escapeHtml(number(data.active_count))} activas en el corte</small></div>
            <div><span>Trabajadores</span><strong>${escapeHtml(number(data.workers_total))}</strong><small>promedio ${escapeHtml(decimal(data.workers_avg))}</small></div>
            <div><span>Variación 5 años</span><strong>${escapeHtml(signed(data.observed_growth_5y_pct))}</strong><small>stock observado comparable</small></div>
            <div><span>Dinámica 5 años</span><strong>${escapeHtml(number(data.starts_5y))}</strong><small>inicios · ${escapeHtml(number(data.terminations_5y))} términos</small></div>
          </div>
        </div>
        <div class="sctx-mix">
          <span class="sctx-eyebrow">Composición por tramo de ventas</span>
          ${sizeMixMarkup(data.size_mix)}
          <small class="sctx-mix-foot">Base con tramo publicado: ${escapeHtml(number(data.size_mix?.with_sales_band))}</small>
        </div>
        <div class="sctx-position">
          <span class="sctx-eyebrow">Posición de esta entidad</span>
          <div class="sctx-position-box">${position}</div>
          <div class="sctx-neutral-note">Lectura contextual. La posición económica no constituye una señal adversa por sí sola.</div>
        </div>
      </div>
    </div>`;
  return card;
}

function renderEntityContext(entityId: string, data: EntitySectorContext) {
  if (currentEntityId() !== entityId) return;
  const summary = document.querySelector<HTMLElement>('.entity360-summary');
  if (!summary) return;
  summary.querySelectorAll<HTMLElement>('[data-sctx-entity]').forEach((node) => {
    if (node.dataset.sctxEntity !== entityId) node.remove();
  });
  if (summary.querySelector(`[data-sctx-entity="${CSS.escape(entityId)}"]`)) return;
  const anchor = summary.querySelector<HTMLElement>('.entity360-row-top') ?? summary.querySelector<HTMLElement>('.entity360-kpis');
  const card = entityCard(data, entityId);
  if (anchor?.nextSibling) summary.insertBefore(card, anchor.nextSibling);
  else summary.append(card);
}

async function loadEntityContext(entityId: string) {
  const cached = entityCache.get(entityId);
  if (cached) {
    renderEntityContext(entityId, cached);
    return;
  }
  if (cached === null || entityPending.has(entityId)) return;
  entityPending.add(entityId);
  const { data, error } = await supabase.rpc('obs_sii_entity_sector_context', { p_entity_id: entityId });
  entityPending.delete(entityId);
  if (error || !data || typeof data !== 'object') {
    entityCache.set(entityId, null);
    return;
  }
  const context = data as EntitySectorContext;
  if (!context.available) {
    entityCache.set(entityId, null);
    return;
  }
  entityCache.set(entityId, context);
  renderEntityContext(entityId, context);
}

function sectorCard(data: UafSectorContext, sector: string) {
  const card = document.createElement('section');
  card.className = 'uso2-section sctx-universe';
  card.dataset.sctxSector = sector;
  const activities = (data.top_activities ?? []).slice(0, 5);
  card.innerHTML = `
    <header class="uso2-section-head sctx-universe-head">
      <div>
        <h3>Referencia económica del sector · SII</h3>
        <p>${escapeHtml(sentence(data.uaf_sector || sector))} · base comparable observada ${escapeHtml(data.commercial_year ?? '—')}</p>
      </div>
      <div class="sctx-head-tools">
        <span class="sctx-chip">Contexto · no riesgo</span>
        ${methodologyMarkup(data.method_note, data.commercial_year)}
        <button class="sctx-close" type="button" aria-label="Cerrar referencia sectorial" title="Cerrar">×</button>
      </div>
    </header>
    <div class="uso2-body sctx-universe-body">
      <div class="sctx-universe-metrics">
        <div><span>SO en el sector</span><strong>${escapeHtml(number(data.uaf_subjects))}</strong><small>Padrón vigente observado</small></div>
        <div><span>Con actividad SII</span><strong>${escapeHtml(number(data.uaf_subjects_with_sii_activity))}</strong><small>${escapeHtml(decimal(data.uaf_mapping_pct, '%'))} con perfil comparable</small></div>
        <div><span>Base comparable</span><strong>${escapeHtml(number(data.observed_comparable_entities))}</strong><small>principales actividades SII</small></div>
        <div><span>Variación 5 años</span><strong>${escapeHtml(signed(data.observed_growth_5y_pct))}</strong><small>stock económico observado</small></div>
      </div>
      <div class="sctx-universe-detail">
        <div class="sctx-mix sctx-mix-universe">
          <span class="sctx-eyebrow">Composición de la base comparable</span>
          ${sizeMixMarkup(data.size_mix)}
        </div>
        <div class="sctx-activities">
          <span class="sctx-eyebrow">Actividades SII que explican el sector</span>
          ${activities.length ? activities.map((row) => `
            <div class="sctx-activity-row">
              <span>${escapeHtml(sentence(row.activity))}</span>
              <b>${escapeHtml(number(row.uaf_subjects))} SO</b>
              <small>${escapeHtml(number(row.observed_entities))} entidades observadas</small>
            </div>`).join('') : '<p class="sctx-empty">Sin actividades comparables materializadas.</p>'}
        </div>
        <div class="sctx-sector-reading">
          <strong>Cómo leer esta cifra</strong>
          <p>La “base comparable” reúne entidades observadas por Atlas en las principales actividades tributarias presentes en este sector UAF.</p>
          <p><b>No es el universo nacional</b>, no equivale a potenciales SO y la diferencia con el padrón no representa una brecha regulatoria.</p>
          <button class="sctx-go-directory" type="button">Ver entidades filtradas ↓</button>
        </div>
      </div>
    </div>`;

  card.querySelector<HTMLButtonElement>('.sctx-close')?.addEventListener('click', () => {
    activeSector = null;
    lastSectorScrollKey = null;
    card.remove();
  });
  card.querySelector<HTMLButtonElement>('.sctx-go-directory')?.addEventListener('click', () => {
    document.getElementById('universo-directorio')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  return card;
}

function renderSectorContext(sector: string, data: UafSectorContext, scroll = false) {
  if (!window.location.hash.startsWith('#/universo')) return;
  const root = document.querySelector<HTMLElement>('.uso2');
  const edge = root?.querySelector<HTMLElement>('.uso2-edge-grid');
  if (!root || !edge) return;
  root.querySelectorAll<HTMLElement>('[data-sctx-sector]').forEach((node) => node.remove());
  const card = sectorCard(data, sector);
  root.insertBefore(card, edge);
  if (scroll && lastSectorScrollKey !== normalize(sector)) {
    lastSectorScrollKey = normalize(sector);
    window.setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 90);
  }
}

async function loadSectorContext(sector: string, scroll = true) {
  activeSector = sector;
  const key = normalize(sector);
  const cached = sectorCache.get(key);
  if (cached) {
    renderSectorContext(sector, cached, scroll);
    return;
  }
  if (cached === null || sectorPending.has(key)) return;
  sectorPending.add(key);
  const { data, error } = await supabase.rpc('obs_uaf_sector_economic_context', { p_sector: sector });
  sectorPending.delete(key);
  if (activeSector == null || normalize(activeSector) !== key) return;
  if (error || !data || typeof data !== 'object') {
    sectorCache.set(key, null);
    return;
  }
  const context = data as UafSectorContext;
  if (!context.available) {
    sectorCache.set(key, null);
    return;
  }
  sectorCache.set(key, context);
  renderSectorContext(sector, context, scroll);
}

function isPrincipalSectorRank(rank: HTMLElement) {
  const section = rank.closest<HTMLElement>('.uso2-section');
  const title = section?.querySelector<HTMLElement>('.uso2-section-head h3')?.textContent ?? '';
  return normalize(title).includes('principales sectores que conforman el padron');
}

function handleClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  const rank = target.closest<HTMLElement>('.uso2-rank');
  if (!rank || !isPrincipalSectorRank(rank)) return;
  const sector = rank.querySelector<HTMLElement>('.uso2-rank-name')?.textContent?.trim();
  if (sector) void loadSectorContext(sector, true);
}

function syncOnRender() {
  const entityId = currentEntityId();
  if (entityId && document.querySelector('.entity360-summary')) {
    const cached = entityCache.get(entityId);
    if (cached) renderEntityContext(entityId, cached);
    else if (cached !== null) void loadEntityContext(entityId);
  }

  if (!window.location.hash.startsWith('#/universo')) {
    activeSector = null;
    lastSectorScrollKey = null;
    return;
  }
  if (activeSector) {
    const cached = sectorCache.get(normalize(activeSector));
    if (cached && !document.querySelector('[data-sctx-sector]')) renderSectorContext(activeSector, cached, false);
  }
}

document.addEventListener('click', handleClick);
window.addEventListener('hashchange', syncOnRender);
new MutationObserver(syncOnRender).observe(document.documentElement, { childList: true, subtree: true });
syncOnRender();
