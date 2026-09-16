import { supabase } from './supabase';

type PressMomentum = {
  theme: string;
  current_n: number;
  previous_n: number;
  delta_pct: number | null;
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

const REPORT_SELECTOR = '.dbv2-view';
const SUMMARY_CLASS = 'dbv2-recent-trends';
const THEME_TREND_CLASS = 'dbv2-context-theme-trend';
const cache = new Map<number, RecentDepthPayload>();
const pending = new Map<number, Promise<RecentDepthPayload | null>>();
let scheduled = false;

const fmt0 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });

function findContextSection(report: HTMLElement) {
  return Array.from(report.querySelectorAll<HTMLElement>('.report-section')).find(
    (section) => section.querySelector('h3')?.textContent?.trim() === 'Contexto reciente',
  ) ?? null;
}

function windowDays(section: HTMLElement) {
  const text = section.querySelector('.report-section-heading p')?.textContent ?? '';
  const match = text.match(/Ventana\s+(\d+)\s+d[ií]as/i);
  const days = Number(match?.[1]);
  return Number.isFinite(days) && days > 0 ? days : 30;
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

async function load(days: number) {
  if (cache.has(days)) return cache.get(days) ?? null;
  if (pending.has(days)) return pending.get(days) ?? null;
  const request = supabase
    .rpc('obs_uaf_strategic_depth_payload', { p_novelty_days: days })
    .then(({ data, error }) => {
      if (error || !data) return null;
      const payload = data as RecentDepthPayload;
      cache.set(days, payload);
      return payload;
    })
    .finally(() => pending.delete(days));
  pending.set(days, request);
  return request;
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
  if (existing?.dataset.days === String(days) && existing.childElementCount > 0) return;
  const payload = await load(days);
  if (!payload) return;
  const currentReport = document.querySelector<HTMLElement>(REPORT_SELECTOR);
  const currentSection = currentReport ? findContextSection(currentReport) : null;
  if (!currentSection || windowDays(currentSection) !== days) return;
  render(currentSection, payload, days);
}

function scheduleScan() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => void scan());
}

const root = document.getElementById('root') ?? document.body;
new MutationObserver(scheduleScan).observe(root, { childList: true, subtree: true, characterData: true });
window.addEventListener('hashchange', scheduleScan);
scheduleScan();
