export {};

/* ATLAS Observatorio · lecturas determinísticas de tendencias
   Enriquece los gráficos del informe institucional sin recalcular las series
   en backend ni usar IA. Sólo describe propiedades observables de los puntos
   que ya están renderizados: variación, máximos/mínimos y cambios de dirección. */

type TrendObservation = { year: number; value: number };

const REPORT_SELECTOR = '.dbv2-view';
const CHART_SELECTOR = '.dbv2-trend:not(.dbv2-empty)';
const INSIGHT_CLASS = 'dbv2-trend-insight';
let scheduled = false;

const pct = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });

function parseDisplayedValue(raw: string | null | undefined): number | null {
  const text = String(raw ?? '').trim();
  if (!text || text === '—' || /^s\/d$/i.test(text)) return null;

  const million = /\bM\b|mill[oó]n/i.test(text);
  const normalized = text
    .replace(/millones?|\bM\b/gi, '')
    .replace(/\s+/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^0-9+\-.]/g, '');
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return million ? value * 1_000_000 : value;
}

function sameX(a: string | null, b: string | null) {
  const av = Number(a);
  const bv = Number(b);
  return Number.isFinite(av) && Number.isFinite(bv) && Math.abs(av - bv) < 0.5;
}

function observations(chart: HTMLElement): TrendObservation[] {
  const svg = chart.querySelector('svg');
  if (!svg) return [];

  const years = Array.from(svg.querySelectorAll<SVGTextElement>('.dbv2-year'));
  const values: TrendObservation[] = [];

  svg.querySelectorAll<SVGGElement>('g').forEach((group) => {
    const circle = group.querySelector<SVGCircleElement>('.dbv2-dot');
    const valueText = group.querySelector<SVGTextElement>('.dbv2-value');
    if (!circle || !valueText) return;

    const yearText = years.find((candidate) => sameX(candidate.getAttribute('x'), circle.getAttribute('cx')));
    const year = Number(yearText?.textContent?.trim());
    const value = parseDisplayedValue(valueText.textContent);
    if (!Number.isFinite(year) || value == null) return;
    values.push({ year, value });
  });

  return values.sort((a, b) => a.year - b.year);
}

function sign(value: number) {
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : -1;
}

function formatValue(value: number) {
  if (Math.abs(value) >= 1_000_000) return `${pct.format(value / 1_000_000)} M`;
  return integer.format(value);
}

function buildInsight(points: TrendObservation[]): string[] {
  if (points.length < 2) return [];

  const first = points[0];
  const last = points[points.length - 1];
  const maxPoint = points.reduce((best, current) => current.value > best.value ? current : best, points[0]);
  const minPoint = points.reduce((best, current) => current.value < best.value ? current : best, points[0]);
  const total = last.value - first.value;
  const variation = first.value === 0 ? null : (total / Math.abs(first.value)) * 100;
  const deltas = points.slice(1).map((point, index) => point.value - points[index].value);
  const directions = deltas.map(sign);
  const up = directions.filter((d) => d > 0).length;
  const down = directions.filter((d) => d < 0).length;
  const flat = directions.filter((d) => d === 0).length;
  const sentences: string[] = [];

  if (last.value === maxPoint.value && last.year === maxPoint.year) {
    sentences.push(`${last.year} marca el máximo de la serie (${formatValue(last.value)}).`);
  } else if (last.value === minPoint.value && last.year === minPoint.year) {
    sentences.push(`${last.year} marca el mínimo de la serie (${formatValue(last.value)}).`);
  } else {
    sentences.push(`Máximo en ${maxPoint.year} (${formatValue(maxPoint.value)}) y mínimo en ${minPoint.year} (${formatValue(minPoint.value)}).`);
  }

  if (variation != null) {
    const direction = variation > 0 ? 'aumento' : variation < 0 ? 'disminución' : 'variación nula';
    const signed = `${variation > 0 ? '+' : ''}${pct.format(variation)}%`;
    sentences.push(`${direction.charAt(0).toUpperCase()}${direction.slice(1)} acumulado ${first.year}–${last.year}: ${signed}.`);
  }

  const nonZero = directions.filter((d) => d !== 0);
  if (nonZero.length && nonZero.every((d) => d > 0)) {
    sentences.push(`Trayectoria ascendente en ${up} de ${deltas.length} intervalos${flat ? `, con ${flat} sin cambio` : ''}.`);
  } else if (nonZero.length && nonZero.every((d) => d < 0)) {
    sentences.push(`Trayectoria descendente en ${down} de ${deltas.length} intervalos${flat ? `, con ${flat} sin cambio` : ''}.`);
  } else if (directions.length >= 2) {
    const current = directions[directions.length - 1];
    const previous = directions[directions.length - 2];
    if (current !== 0 && previous !== 0 && current !== previous) {
      sentences.push(`Cambio de dirección en ${last.year}: la serie vuelve a ${current > 0 ? 'aumentar' : 'disminuir'} respecto de ${points[points.length - 2].year}.`);
    }
  }

  if (points.length >= 4 && Math.abs(total) > 1e-9) {
    const anchor = points[points.length - 3];
    const recent = last.value - anchor.value;
    const share = Math.abs(recent / total);
    if (sign(recent) === sign(total) && share >= 0.6 && share <= 1.2) {
      sentences.push(`El ${pct.format(share * 100)}% del cambio neto del período se concentra desde ${anchor.year}.`);
    }
  }

  return sentences.slice(0, 3);
}

function renderInsight(chart: HTMLElement) {
  const points = observations(chart);
  const signature = points.map((p) => `${p.year}:${p.value}`).join('|');
  if (!signature) return;

  const current = chart.querySelector<HTMLElement>(`.${INSIGHT_CLASS}`);
  if (current?.dataset.signature === signature) return;

  const messages = buildInsight(points);
  if (!messages.length) {
    current?.remove();
    return;
  }

  const box = current ?? document.createElement('div');
  box.className = INSIGHT_CLASS;
  box.dataset.signature = signature;
  box.innerHTML = `<span>LECTURA DE LA SERIE</span><p>${messages.join(' ')}</p>`;
  if (!current) chart.append(box);
}

function scan() {
  scheduled = false;
  const report = document.querySelector<HTMLElement>(REPORT_SELECTOR);
  if (!report) return;
  report.querySelectorAll<HTMLElement>(CHART_SELECTOR).forEach(renderInsight);
}

function scheduleScan() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(scan);
}

const root = document.getElementById('root') ?? document.body;
new MutationObserver(scheduleScan).observe(root, { childList: true, subtree: true, characterData: true });
window.addEventListener('hashchange', scheduleScan);
scheduleScan();
