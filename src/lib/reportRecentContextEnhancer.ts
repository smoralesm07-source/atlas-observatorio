import { supabase } from './supabase';

type PressMomentum = {
  theme: string;
  current_n: number;
  previous_n: number;
  delta_pct: number | null;
  latest_date?: string | null;
  current_media?: number | null;
};

type RecentDepthPayload = {
  window?: { days?: number };
  coverage?: {
    press_media_count?: number | null;
    press_relevant_articles?: number | null;
    sanctions_current?: number | null;
    sanctions_previous?: number | null;
    sanctions_documented?: number | null;
    sanction_regulators?: number | null;
  };
  press_momentum?: PressMomentum[];
};

type SanctionTrend = {
  event_id: string;
  event_date: string;
  canonical_name: string;
  regulator: string;
  uaf_sector?: string | null;
  document_url?: string | null;
};

type Top5Context = {
  pressDays: number;
  press: PressMomentum[];
  sanctionDays: number;
  sanctions: SanctionTrend[];
};

const REPORT_SELECTOR = '.dbv2-view';
const SUMMARY_CLASS = 'dbv2-recent-trends';
const TOP5_CLASS = 'dbv2-recent-top5';
const THEME_TREND_CLASS = 'dbv2-context-theme-trend';
const cache = new Map<number, RecentDepthPayload>();
const pending = new Map<number, Promise<RecentDepthPayload | null>>();
let top5Cache: Top5Context | null = null;
let top5Pending: Promise<Top5Context | null> | null = null;
let scheduled = false;

const fmt0 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });

function findContextSection(report: HTMLElement) {
  return Array.from(report.querySelectorAll<HTMLElement>('.report-section')).find((section) => {
    const title = section.querySelector('h3')?.textContent?.trim() ?? '';
    return title === 'Contexto reciente' || title === 'Qué cambió recientemente';
  }) ?? null;
}

function windowDays(section: HTMLElement) {
  const text = section.querySelector('.report-section-heading p')?.textContent ?? '';
  const match = text.match(/Ventana\s+(\d+)\s+d[ií]as/i);
  const days = Number(match?.[1]);
  return Number.isFinite(days) && days > 0 ? days : 30;
}

function reportCutoffDate(report: HTMLElement) {
  const text = report.querySelector('.report-cover-top')?.textContent ?? '';
  const match = text.match(/(20\d{2}-\d{2}-\d{2})/);
  return match?.[1] ?? new Date().toISOString().slice(0, 10);
}

function adaptiveWindows(baseDays: number) {
  const values = [Math.max(30, baseDays), 60, 90, 180, 365]
    .filter((value) => value >= Math.max(30, baseDays));
  return [...new Set(values)].sort((a, b) => a - b);
}

function dateMinusDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function dateCl(value?: string | null) {
  if (!value) return 's/f';
  const [y, m, d] = value.slice(0, 10).split('-');
  return y && m && d ? `${d}-${m}-${y}` : value;
}

function deltaPct(current: number, previous: number) {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function signedPct(value: number | null) {
  if (value == null || !Number.isFinite(value)) return 's/d';
  return `${value > 0 ? '+' : ''}${fmt1.format(value)}%`;
}

function directionLabel(current: number, previous: number) {
  if (current > previous) return 'Aumento';
  if (current < previous) return 'Disminución';
  return 'Sin variación';
}

function make(tag: string, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function metricCard(args: {
  title: string;
  previous: number;
  current: number;
  detail: string;
  note: string;
  tone?: 'orange' | 'graphite';
}) {
  const { title, previous, current, detail, note, tone = 'orange' } = args;
  const change = deltaPct(current, previous);
  const max = Math.max(1, previous, current);
  const article = make('article', `dbv2-recent-trend-card dbv2-recent-trend-${tone}`);
  const head = make('div', 'dbv2-recent-trend-head');
  head.append(make('h4', undefined, title));
  head.append(make('strong', undefined, signedPct(change)));
  article.append(head);
  article.append(make('p', 'dbv2-recent-trend-direction', `${directionLabel(current, previous)} respecto de la ventana anterior.`));

  const rows = make('div', 'dbv2-recent-trend-bars');
  [
    ['Ventana anterior', previous],
    ['Ventana actual', current],
  ].forEach(([label, raw]) => {
    const value = Number(raw);
    const row = make('div', 'dbv2-recent-trend-row');
    const labelNode = make('span', undefined, String(label));
    const bar = make('i');
    bar.style.width = `${Math.max(3, (value / max) * 100)}%`;
    const valueNode = make('b', undefined, fmt0.format(value));
    row.append(labelNode, bar, valueNode);
    rows.append(row);
  });
  article.append(rows);
  article.append(make('small', undefined, detail));
  article.append(make('em', undefined, note));
  return article;
}

async function load(days: number): Promise<RecentDepthPayload | null> {
  if (cache.has(days)) return cache.get(days) ?? null;
  const active = pending.get(days);
  if (active) return active;

  const request: Promise<RecentDepthPayload | null> = (async () => {
    const { data, error } = await supabase.rpc('obs_uaf_strategic_depth_payload', { p_novelty_days: days });
    if (error || !data) return null;
    const payload = data as RecentDepthPayload;
    cache.set(days, payload);
    return payload;
  })();

  pending.set(days, request);
  try {
    return await request;
  } finally {
    pending.delete(days);
  }
}

async function loadTop5(report: HTMLElement, baseDays: number): Promise<Top5Context | null> {
  if (top5Cache) return top5Cache;
  if (top5Pending) return top5Pending;

  top5Pending = (async () => {
    const windows = adaptiveWindows(baseDays);
    let pressDays = windows[0];
    let press: PressMomentum[] = [];
    for (const days of windows) {
      const payload = await load(days);
      const rows = (payload?.press_momentum ?? []).filter((item) => Number(item.current_n ?? 0) > 0 && item.latest_date);
      pressDays = days;
      press = rows.slice(0, 5);
      if (press.length >= 5) break;
    }

    const cutoff = reportCutoffDate(report);
    let sanctionDays = windows[0];
    let sanctions: SanctionTrend[] = [];
    for (const days of windows) {
      const fromDate = dateMinusDays(cutoff, days);
      const { data, error } = await supabase
        .from('aml_v_sanctions_cases_current_v1')
        .select('event_id,event_date,canonical_name,regulator,uaf_sector,document_url')
        .eq('is_uaf_registered', true)
        .gte('event_date', fromDate)
        .lte('event_date', cutoff)
        .order('event_date', { ascending: false })
        .limit(5);
      if (error) continue;
      sanctionDays = days;
      sanctions = (data ?? []) as SanctionTrend[];
      if (sanctions.length >= 5) break;
    }

    top5Cache = { pressDays, press, sanctionDays, sanctions };
    return top5Cache;
  })();

  try {
    return await top5Pending;
  } finally {
    top5Pending = null;
  }
}

function enrichThemeRows(section: HTMLElement, payload: RecentDepthPayload) {
  const firstArticle = section.querySelector<HTMLElement>('.dbv2-context-grid article');
  if (!firstArticle) return;
  const rows = Array.from(firstArticle.querySelectorAll<HTMLElement>('.dbv2-context-row'));
  rows.forEach((row, index) => {
    row.querySelector(`.${THEME_TREND_CLASS}`)?.remove();
    const theme = payload.press_momentum?.[index];
    if (!theme) return;
    const marker = make('small', THEME_TREND_CLASS, `${signedPct(theme.delta_pct)} vs ventana anterior`);
    row.append(marker);
  });
}

function renderTop5(section: HTMLElement, context: Top5Context) {
  section.querySelector(`.${TOP5_CLASS}`)?.remove();
  const wrap = make('div', TOP5_CLASS);

  const pressPanel = make('article', 'dbv2-recent-top5-panel dbv2-recent-top5-press');
  const pressHead = make('div', 'dbv2-recent-top5-head');
  pressHead.innerHTML = `<div><span>TOP 5</span><strong>Tendencias de prensa</strong></div><em>${context.pressDays} días</em>`;
  pressPanel.append(pressHead);
  const pressList = make('div', 'dbv2-recent-top5-list');
  context.press.forEach((item, index) => {
    const row = make('div', 'dbv2-recent-top5-item');
    row.innerHTML = `<b>${index + 1}</b><div><strong>${item.theme}</strong><small>Última aparición: ${dateCl(item.latest_date)} · ${fmt0.format(item.current_n)} notas · ${fmt0.format(item.current_media ?? 0)} medios</small></div><em>${signedPct(item.delta_pct)}</em>`;
    pressList.append(row);
  });
  if (!context.press.length) pressList.append(make('p', 'report-method-note', 'Sin tendencias de prensa suficientes en la ventana máxima revisada.'));
  pressPanel.append(pressList);
  pressPanel.append(make('small', 'dbv2-recent-top5-note', context.pressDays > 30 ? `Ventana ampliada automáticamente desde 30 a ${context.pressDays} días para completar hasta cinco tendencias.` : 'La ventana de 30 días contiene cinco tendencias con actividad.'));

  const sanctionPanel = make('article', 'dbv2-recent-top5-panel dbv2-recent-top5-sanctions');
  const sanctionHead = make('div', 'dbv2-recent-top5-head');
  sanctionHead.innerHTML = `<div><span>TOP 5</span><strong>Sanciones recientes</strong></div><em>${context.sanctionDays} días</em>`;
  sanctionPanel.append(sanctionHead);
  const sanctionList = make('div', 'dbv2-recent-top5-list');
  context.sanctions.forEach((item, index) => {
    const row = make('div', 'dbv2-recent-top5-item');
    const title = item.document_url ? `<a href="${item.document_url}" target="_blank" rel="noreferrer">${item.canonical_name}</a>` : item.canonical_name;
    row.innerHTML = `<b>${index + 1}</b><div><strong>${title}</strong><small>${dateCl(item.event_date)} · ${item.regulator}${item.uaf_sector ? ` · ${item.uaf_sector}` : ''}</small></div><em>${dateCl(item.event_date)}</em>`;
    sanctionList.append(row);
  });
  if (!context.sanctions.length) sanctionList.append(make('p', 'report-method-note', 'Sin sanciones UAF observadas en la ventana máxima revisada.'));
  sanctionPanel.append(sanctionList);
  sanctionPanel.append(make('small', 'dbv2-recent-top5-note', context.sanctionDays > 30 ? `Ventana ampliada automáticamente desde 30 a ${context.sanctionDays} días porque 30 días no contenían cinco eventos.` : 'La ventana de 30 días contiene al menos cinco eventos sancionatorios.'));

  wrap.append(pressPanel, sanctionPanel);
  const summary = section.querySelector<HTMLElement>(`.${SUMMARY_CLASS}`);
  if (summary) summary.insertAdjacentElement('afterend', wrap);
  else section.querySelector('.report-section-heading')?.insertAdjacentElement('afterend', wrap);
}

function render(section: HTMLElement, payload: RecentDepthPayload, days: number) {
  const previousSummary = section.querySelector<HTMLElement>(`.${SUMMARY_CLASS}`);
  previousSummary?.remove();

  const momentum = payload.press_momentum ?? [];
  const pressCurrent = momentum.reduce((sum, item) => sum + Number(item.current_n || 0), 0);
  const pressPrevious = momentum.reduce((sum, item) => sum + Number(item.previous_n || 0), 0);
  const sanctionsCurrent = Number(payload.coverage?.sanctions_current ?? 0);
  const sanctionsPrevious = Number(payload.coverage?.sanctions_previous ?? 0);

  const summary = make('div', SUMMARY_CLASS);
  summary.dataset.days = String(days);
  summary.append(metricCard({
    title: 'Tendencia de prensa',
    previous: pressPrevious,
    current: pressCurrent,
    detail: `${fmt0.format(payload.coverage?.press_media_count ?? 0)} medios en la ventana actual · ${fmt0.format(pressCurrent)} notas temáticas relevantes.`,
    note: 'Variación de cobertura publicada; no representa variación de hechos delictivos.',
  }));
  summary.append(metricCard({
    title: 'Tendencia de sanciones',
    previous: sanctionsPrevious,
    current: sanctionsCurrent,
    detail: `${fmt0.format(payload.coverage?.sanctions_documented ?? 0)} sanciones actuales con documento · ${fmt0.format(payload.coverage?.sanction_regulators ?? 0)} regulador(es).`,
    note: 'Compara registros sancionatorios de sujetos UAF entre ventanas equivalentes.',
    tone: 'graphite',
  }));

  const heading = section.querySelector('.report-section-heading');
  heading?.insertAdjacentElement('afterend', summary);
  enrichThemeRows(section, payload);
}

async function scan() {
  scheduled = false;
  const report = document.querySelector<HTMLElement>(REPORT_SELECTOR);
  if (!report) return;
  const section = findContextSection(report);
  if (!section) return;
  const days = windowDays(section);
  const existing = section.querySelector<HTMLElement>(`.${SUMMARY_CLASS}`);
  const needsSummary = !(existing?.dataset.days === String(days) && existing.childElementCount > 0);
  if (needsSummary) {
    const payload = await load(days);
    if (payload) {
      const currentReport = document.querySelector<HTMLElement>(REPORT_SELECTOR);
      const currentSection = currentReport ? findContextSection(currentReport) : null;
      if (currentSection) render(currentSection, payload, days);
    }
  }

  const currentReport = document.querySelector<HTMLElement>(REPORT_SELECTOR);
  const currentSection = currentReport ? findContextSection(currentReport) : null;
  if (!currentReport || !currentSection || currentSection.querySelector(`.${TOP5_CLASS}`)) return;
  const top5 = await loadTop5(currentReport, days);
  if (top5) {
    const latestReport = document.querySelector<HTMLElement>(REPORT_SELECTOR);
    const latestSection = latestReport ? findContextSection(latestReport) : null;
    if (latestSection) renderTop5(latestSection, top5);
  }
}

function scheduleScan() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => void scan());
}

const root = document.getElementById('root') ?? document.body;
new MutationObserver(scheduleScan).observe(root, { childList: true, subtree: true, characterData: true });
window.addEventListener('hashchange', () => {
  top5Cache = null;
  scheduleScan();
});
scheduleScan();