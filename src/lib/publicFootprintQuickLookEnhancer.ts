import { supabase } from './supabase';
import { fetchProviderHistory, type ProviderHistoryResponse } from './providerHistory';
import { hrefFor } from './router';

type JsonRow = Record<string, unknown>;
type RowsPayload = { rows?: JsonRow[] } | JsonRow[] | null;

const FROM_YEAR = 2020;
let activeOverlay: HTMLDivElement | null = null;
let decorateFrame = 0;

function normalizeRut(value: string): string {
  return value.toUpperCase().replace(/[^0-9K]/g, '');
}

function formatRut(value: string): string {
  const clean = normalizeRut(value);
  if (clean.length < 2) return value;
  const body = clean.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${body}-${clean.slice(-1)}`;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clp(value: unknown): string {
  const parsed = numberValue(value);
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(parsed);
}

function integer(value: unknown): string {
  return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(numberValue(value));
}

function rowsOf(value: RowsPayload): JsonRow[] {
  if (Array.isArray(value)) return value;
  return value && Array.isArray(value.rows) ? value.rows : [];
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function currentEntityIdentity(): { name: string; rut: string } | null {
  const root = document.querySelector('.entity360');
  const rutNode = root?.querySelector('.entity360-meta .mono');
  const nameNode = root?.querySelector('.entity360-titleline h1');
  const rut = normalizeRut(rutNode?.textContent ?? '');
  if (!root || !rut || !/^[0-9]{6,8}[0-9K]$/.test(rut)) return null;
  return { name: nameNode?.textContent?.trim() || rut, rut };
}

function footprintKpis(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.entity360-kpi')].filter((item) => {
    const label = item.querySelector('.entity360-kpi-copy > span')?.textContent?.trim();
    const value = item.querySelector('.entity360-kpi-copy > strong')?.textContent?.trim();
    return label === 'Huella pública' && value === 'Sí registra';
  });
}

function decorateFootprintKpi() {
  if (!window.location.hash.startsWith('#/entidad/')) return;
  for (const item of footprintKpis()) {
    item.classList.add('entity360-kpi-quicklook');
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', 'Abrir resumen de Huella pública');
    item.setAttribute('title', 'Ver contrapartes, años y montos sin salir de Entidad 360');
  }
}

function scheduleDecorate() {
  if (decorateFrame) cancelAnimationFrame(decorateFrame);
  decorateFrame = requestAnimationFrame(() => {
    decorateFrame = 0;
    decorateFootprintKpi();
  });
}

function closeOverlay() {
  if (!activeOverlay) return;
  activeOverlay.remove();
  activeOverlay = null;
  document.body.classList.remove('atlas-footprint-quicklook-open');
}

function loadingBody(): HTMLElement {
  const wrap = node('div', 'atlas-footprint-quicklook-loading');
  wrap.append(
    node('span', 'atlas-footprint-quicklook-spinner'),
    node('strong', '', 'Reconstruyendo huella pública…'),
    node('small', '', 'El detalle se consulta sólo ahora; no se carga al abrir Entidad 360.'),
  );
  return wrap;
}

function summaryChip(label: string, value: string): HTMLElement {
  const chip = node('div', 'atlas-footprint-quicklook-chip');
  chip.append(node('span', '', label), node('strong', '', value));
  return chip;
}

function counterpartySection(title: string, source: string, rows: { name: string; amount: number; count: number; detail?: string }[]): HTMLElement {
  const section = node('section', 'atlas-footprint-quicklook-section');
  const head = node('header');
  const titleBox = node('div');
  titleBox.append(node('strong', '', title), node('span', '', source));
  head.append(titleBox);
  section.append(head);

  if (!rows.length) {
    section.append(node('div', 'atlas-footprint-quicklook-empty', 'Sin contrapartes detalladas disponibles para esta fuente.'));
    return section;
  }

  const list = node('div', 'atlas-footprint-quicklook-counterparties');
  rows.slice(0, 5).forEach((row, index) => {
    const item = node('div', 'atlas-footprint-quicklook-counterparty');
    item.append(node('span', 'atlas-footprint-quicklook-rank', String(index + 1).padStart(2, '0')));
    const copy = node('div', 'atlas-footprint-quicklook-counterparty-copy');
    copy.append(node('strong', '', row.name), node('small', '', row.detail || `${integer(row.count)} registros`));
    item.append(copy, node('b', '', clp(row.amount)));
    list.append(item);
  });
  section.append(list);
  return section;
}

function yearSection(market: ProviderHistoryResponse | null, fundsRows: JsonRow[]): HTMLElement {
  const section = node('section', 'atlas-footprint-quicklook-section atlas-footprint-quicklook-years');
  const head = node('header');
  const titleBox = node('div');
  titleBox.append(node('strong', '', 'Años y montos'), node('span', '', 'comparación rápida por fuente'));
  head.append(titleBox);
  section.append(head);

  const marketByYear = new Map<number, { amount: number; count: number }>();
  for (const row of market?.years ?? []) {
    marketByYear.set(Number(row.year), { amount: numberValue(row.amount_clp), count: numberValue(row.order_count) });
  }
  const fundsByYear = new Map<number, { amount: number; count: number }>();
  for (const row of fundsRows) {
    fundsByYear.set(Number(row.year), { amount: numberValue(row.amount_paid), count: numberValue(row.transaction_count) });
  }

  const years = [...new Set([...marketByYear.keys(), ...fundsByYear.keys()])]
    .filter(Number.isFinite)
    .sort((a, b) => b - a)
    .slice(0, 6);

  if (!years.length) {
    section.append(node('div', 'atlas-footprint-quicklook-empty', 'La presencia está materializada, pero no hay serie anual disponible en esta consulta.'));
    return section;
  }

  const tableWrap = node('div', 'atlas-footprint-quicklook-table-wrap');
  const table = node('table');
  const thead = node('thead');
  const headRow = node('tr');
  ['Año', 'Mercado Público', 'Presupuesto Abierto'].forEach((label) => headRow.append(node('th', '', label)));
  thead.append(headRow);
  const tbody = node('tbody');
  years.forEach((year) => {
    const marketRow = marketByYear.get(year);
    const fundsRow = fundsByYear.get(year);
    const tr = node('tr');
    tr.append(node('td', 'mono', String(year)));
    const marketCell = node('td');
    marketCell.append(node('strong', '', marketRow ? clp(marketRow.amount) : '—'));
    if (marketRow) marketCell.append(node('small', '', `${integer(marketRow.count)} OC`));
    const fundsCell = node('td');
    fundsCell.append(node('strong', '', fundsRow ? clp(fundsRow.amount) : '—'));
    if (fundsRow) fundsCell.append(node('small', '', `${integer(fundsRow.count)} registros`));
    tr.append(marketCell, fundsCell);
    tbody.append(tr);
  });
  table.append(thead, tbody);
  tableWrap.append(table);
  section.append(tableWrap);
  return section;
}

async function loadQuickLook(rut: string) {
  const toYear = new Date().getFullYear();
  const marketPromise = fetchProviderHistory(rut, FROM_YEAR, toYear);
  const payersPromise = supabase.rpc('obs_state_public_funds_entity', {
    p_action: 'payers', p_rut: rut, p_query: null, p_from_year: FROM_YEAR, p_to_year: toYear, p_limit: 5, p_offset: 0,
  });
  const timelinePromise = supabase.rpc('obs_state_public_funds_entity', {
    p_action: 'timeline', p_rut: rut, p_query: null, p_from_year: FROM_YEAR, p_to_year: toYear, p_limit: 20, p_offset: 0,
  });

  const [marketResult, payersResult, timelineResult] = await Promise.allSettled([marketPromise, payersPromise, timelinePromise]);
  const market = marketResult.status === 'fulfilled' ? marketResult.value : null;

  let payers: JsonRow[] = [];
  if (payersResult.status === 'fulfilled' && !payersResult.value.error) {
    payers = rowsOf(payersResult.value.data as RowsPayload);
  }

  let fundsYears: JsonRow[] = [];
  if (timelineResult.status === 'fulfilled' && !timelineResult.value.error) {
    fundsYears = rowsOf(timelineResult.value.data as RowsPayload);
  }

  if (!market && !payers.length && !fundsYears.length) {
    throw new Error('No fue posible recuperar el detalle de Huella pública en esta consulta.');
  }

  return { market, payers, fundsYears, toYear };
}

function renderLoaded(body: HTMLElement, data: Awaited<ReturnType<typeof loadQuickLook>>) {
  body.replaceChildren();
  const market = data.market;
  const marketBuyers = (market?.buyers ?? []).map((row) => ({
    name: row.buyer_label || row.buyer_id || 'Organismo comprador',
    amount: numberValue(row.amount_clp),
    count: numberValue(row.order_count),
    detail: `${integer(row.order_count)} OC`,
  }));
  const fundPayers = data.payers.map((row) => ({
    name: String(row.payer_name || row.payer_key || 'Organismo pagador'),
    amount: numberValue(row.amount_paid),
    count: numberValue(row.transaction_count),
    detail: `${integer(row.transaction_count)} registros${row.first_year || row.last_year ? ` · ${row.first_year ?? '…'}–${row.last_year ?? '…'}` : ''}`,
  }));

  const marketTotal = numberValue(market?.summary?.amount_clp);
  const marketCount = numberValue(market?.summary?.order_count);
  const fundsTotal = data.fundsYears.reduce((sum, row) => sum + numberValue(row.amount_paid), 0);
  const fundsCount = data.fundsYears.reduce((sum, row) => sum + numberValue(row.transaction_count), 0);

  const chips = node('div', 'atlas-footprint-quicklook-chips');
  chips.append(
    summaryChip('Mercado Público', market ? `${clp(marketTotal)} · ${integer(marketCount)} OC` : 'Sin detalle'),
    summaryChip('Presupuesto Abierto', data.fundsYears.length ? `${clp(fundsTotal)} · ${integer(fundsCount)} registros` : 'Sin detalle'),
    summaryChip('Período consultado', `${FROM_YEAR}–${data.toYear}`),
  );
  body.append(chips);
  body.append(counterpartySection('Principales compradores', 'Mercado Público', marketBuyers));
  body.append(counterpartySection('Principales pagadores', 'Presupuesto Abierto', fundPayers));
  body.append(yearSection(market, data.fundsYears));
  body.append(node('p', 'atlas-footprint-quicklook-note', 'Lectura rápida: montos y contrapartes provienen de las mismas fuentes que Huella pública. Los DTE municipales, cuando correspondan, son evidencia documental observada y no se presentan como pago efectivo.'));
}

function renderError(body: HTMLElement, error: unknown, retry: () => void) {
  body.replaceChildren();
  const panel = node('div', 'atlas-footprint-quicklook-error');
  panel.append(node('strong', '', 'No se pudo cargar el resumen'), node('span', '', error instanceof Error ? error.message : 'Error de consulta.'));
  const button = node('button', '', 'Reintentar');
  button.type = 'button';
  button.addEventListener('click', retry);
  panel.append(button);
  body.append(panel);
}

function openQuickLook() {
  const identity = currentEntityIdentity();
  if (!identity) return;
  closeOverlay();

  const overlay = node('div', 'atlas-footprint-quicklook-overlay');
  const dialog = node('div', 'atlas-footprint-quicklook-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', `Resumen de Huella pública de ${identity.name}`);

  const header = node('header', 'atlas-footprint-quicklook-head');
  const heading = node('div');
  heading.append(node('span', '', 'Huella pública · vista rápida'), node('h2', '', identity.name), node('small', 'mono', formatRut(identity.rut)));
  const close = node('button', 'atlas-footprint-quicklook-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Cerrar resumen');
  close.addEventListener('click', closeOverlay);
  header.append(heading, close);

  const body = node('div', 'atlas-footprint-quicklook-body');
  body.append(loadingBody());

  const footer = node('footer', 'atlas-footprint-quicklook-footer');
  footer.append(node('span', '', 'Resumen bajo demanda · no agrega carga al abrir la ficha'));
  const openFull = node('button', 'atlas-footprint-quicklook-open-full', 'Ir a Huella pública →');
  openFull.type = 'button';
  openFull.addEventListener('click', () => {
    closeOverlay();
    window.location.hash = hrefFor({ view: 'relacionEstado' });
  });
  footer.append(openFull);

  dialog.append(header, body, footer);
  overlay.append(dialog);
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closeOverlay();
  });
  document.body.append(overlay);
  document.body.classList.add('atlas-footprint-quicklook-open');
  activeOverlay = overlay;
  close.focus();

  const run = () => {
    body.replaceChildren(loadingBody());
    void loadQuickLook(identity.rut)
      .then((result) => {
        if (activeOverlay === overlay) renderLoaded(body, result);
      })
      .catch((error) => {
        if (activeOverlay === overlay) renderError(body, error, run);
      });
  };
  run();
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  const trigger = target?.closest<HTMLElement>('.entity360-kpi-quicklook');
  if (!trigger) return;
  event.preventDefault();
  openQuickLook();
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && activeOverlay) {
    event.preventDefault();
    closeOverlay();
    return;
  }
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target as HTMLElement | null;
  if (!target?.classList.contains('entity360-kpi-quicklook')) return;
  event.preventDefault();
  openQuickLook();
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKeydown);
  window.addEventListener('hashchange', () => {
    closeOverlay();
    scheduleDecorate();
  });
  const observer = new MutationObserver(scheduleDecorate);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleDecorate();
}
