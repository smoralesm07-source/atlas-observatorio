export {};

/* ATLAS Observatorio · lecturas determinísticas de tendencias e integración
   Enriquece los gráficos del informe institucional sin recalcular las series
   en backend ni usar IA. Describe propiedades observables de los puntos ya
   renderizados y compara series relacionadas sólo sobre años comunes. */

type TrendObservation = { year: number; value: number };
type Variation = { first: TrendObservation; last: TrendObservation; pct: number | null };

const REPORT_SELECTOR = '.dbv2-view';
const CHART_SELECTOR = '.dbv2-trend:not(.dbv2-empty)';
const INSIGHT_CLASS = 'dbv2-trend-insight';
const INTEGRATED_CLASS = 'dbv2-integrated-reading';
const PRINT_FOOTER_ID = 'atlas-report-print-footer';
let trendInsightScheduled = false;

const pctFmt = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const integerFmt = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });

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
  if (Math.abs(value) >= 1_000_000) return `${pctFmt.format(value / 1_000_000)} M`;
  return integerFmt.format(value);
}

function formatPct(value: number | null) {
  if (value == null || !Number.isFinite(value)) return 's/d';
  return `${value > 0 ? '+' : ''}${pctFmt.format(value)}%`;
}

function variation(points: TrendObservation[]): Variation | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  return {
    first,
    last,
    pct: first.value === 0 ? null : ((last.value - first.value) / Math.abs(first.value)) * 100,
  };
}

function commonYears(a: TrendObservation[], b: TrendObservation[]) {
  const bMap = new Map(b.map((point) => [point.year, point.value]));
  const left: TrendObservation[] = [];
  const right: TrendObservation[] = [];
  a.forEach((point) => {
    const other = bMap.get(point.year);
    if (other == null) return;
    left.push(point);
    right.push({ year: point.year, value: other });
  });
  return { left, right };
}

function buildInsight(points: TrendObservation[]): string[] {
  if (points.length < 2) return [];

  const first = points[0];
  const last = points[points.length - 1];
  const maxPoint = points.reduce((best, current) => current.value > best.value ? current : best, points[0]);
  const minPoint = points.reduce((best, current) => current.value < best.value ? current : best, points[0]);
  const total = last.value - first.value;
  const variationPct = first.value === 0 ? null : (total / Math.abs(first.value)) * 100;
  const deltas = points.slice(1).map((point, index) => point.value - points[index].value);
  const directions = deltas.map(sign);
  const up = directions.filter((direction) => direction > 0).length;
  const down = directions.filter((direction) => direction < 0).length;
  const flat = directions.filter((direction) => direction === 0).length;
  const sentences: string[] = [];

  if (last.value === maxPoint.value && last.year === maxPoint.year) {
    sentences.push(`${last.year} marca el máximo de la serie (${formatValue(last.value)}).`);
  } else if (last.value === minPoint.value && last.year === minPoint.year) {
    sentences.push(`${last.year} marca el mínimo de la serie (${formatValue(last.value)}).`);
  } else {
    sentences.push(`Máximo en ${maxPoint.year} (${formatValue(maxPoint.value)}) y mínimo en ${minPoint.year} (${formatValue(minPoint.value)}).`);
  }

  if (variationPct != null) {
    const direction = variationPct > 0 ? 'aumento' : variationPct < 0 ? 'disminución' : 'variación nula';
    sentences.push(`${direction.charAt(0).toUpperCase()}${direction.slice(1)} acumulado ${first.year}–${last.year}: ${formatPct(variationPct)}.`);
  }

  const nonZero = directions.filter((direction) => direction !== 0);
  if (nonZero.length && nonZero.every((direction) => direction > 0)) {
    sentences.push(`Trayectoria ascendente en ${up} de ${deltas.length} intervalos${flat ? `, con ${flat} sin cambio` : ''}.`);
  } else if (nonZero.length && nonZero.every((direction) => direction < 0)) {
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
      sentences.push(`El ${pctFmt.format(share * 100)}% del cambio neto del período se concentra desde ${anchor.year}.`);
    }
  }

  return sentences.slice(0, 3);
}

function renderInsight(chart: HTMLElement) {
  const points = observations(chart);
  const signature = points.map((point) => `${point.year}:${point.value}`).join('|');
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

function chartByTitle(report: HTMLElement, title: string) {
  return Array.from(report.querySelectorAll<HTMLElement>(CHART_SELECTOR)).find((chart) => {
    const heading = chart.querySelector('figcaption strong')?.textContent?.trim();
    return heading === title;
  }) ?? null;
}

function relationshipText(aLabel: string, a: Variation, bLabel: string, b: Variation) {
  if (a.pct == null || b.pct == null) return `${aLabel} y ${bLabel} cuentan con puntos comparables, pero no permiten calcular variación relativa para todo el período.`;
  const aSign = sign(a.pct);
  const bSign = sign(b.pct);
  if (aSign !== 0 && bSign !== 0 && aSign !== bSign) {
    return `${aLabel} varía ${formatPct(a.pct)} y ${bLabel} ${formatPct(b.pct)} entre ${a.first.year} y ${a.last.year}: las series se mueven en direcciones opuestas.`;
  }
  if (aSign === bSign && aSign !== 0) {
    return `${aLabel} varía ${formatPct(a.pct)} y ${bLabel} ${formatPct(b.pct)} entre ${a.first.year} y ${a.last.year}. Ambas series se mueven en la misma dirección, con magnitudes relativas distintas.`;
  }
  return `${aLabel} varía ${formatPct(a.pct)} y ${bLabel} ${formatPct(b.pct)} entre ${a.first.year} y ${a.last.year}.`;
}

function comparisonCard(
  report: HTMLElement,
  title: string,
  leftTitle: string,
  leftLabel: string,
  rightTitle: string,
  rightLabel: string,
  caveat: string,
) {
  const leftChart = chartByTitle(report, leftTitle);
  const rightChart = chartByTitle(report, rightTitle);
  if (!leftChart || !rightChart) return null;

  const aligned = commonYears(observations(leftChart), observations(rightChart));
  const leftVariation = variation(aligned.left);
  const rightVariation = variation(aligned.right);
  if (!leftVariation || !rightVariation) return null;

  return {
    title,
    leftLabel,
    leftPct: formatPct(leftVariation.pct),
    rightLabel,
    rightPct: formatPct(rightVariation.pct),
    text: relationshipText(leftLabel, leftVariation, rightLabel, rightVariation),
    caveat,
  };
}

function renderIntegratedReading(report: HTMLElement) {
  const cards = [
    comparisonCard(report, 'Información recibida y dotación', 'Reportes de Operaciones Sospechosas', 'ROS', 'Dotación efectiva total', 'Dotación', 'La dotación corresponde al total institucional publicado; la comparación no estima una brecha de personal.'),
    comparisonCard(report, 'Demanda del Ministerio Público y dotación', 'Requerimientos del Ministerio Público', 'Requerimientos MP', 'Dotación efectiva total', 'Dotación', 'Los requerimientos del Ministerio Público son una línea de demanda distinta de los ROS y de los productos de inteligencia.'),
    comparisonCard(report, 'Composición de la reportabilidad', 'Reportes de Operaciones Sospechosas', 'ROS', 'Reportes de Operaciones en Efectivo', 'ROE', 'ROS y ROE tienen naturaleza y reglas de reporte distintas; la comparación describe la evolución de la composición de los flujos recibidos.'),
    comparisonCard(report, 'Información recibida y productos de inteligencia', 'Reportes de Operaciones Sospechosas', 'ROS', 'IIF y complementos', 'IIF', 'La relación no constituye una tasa de conversión: un IIF puede consolidar múltiples ROS, cruces y antecedentes adicionales.'),
  ].filter((card): card is NonNullable<typeof card> => card != null);

  const signature = cards.map((card) => `${card.title}:${card.leftPct}:${card.rightPct}`).join('|');
  if (!signature) return;

  const current = report.querySelector<HTMLElement>(`.${INTEGRATED_CLASS}`);
  if (current?.dataset.signature === signature) return;

  const section = current ?? document.createElement('section');
  section.className = `report-section report-page-break ${INTEGRATED_CLASS}`;
  section.dataset.signature = signature;
  section.innerHTML = `
    <div class="report-section-heading dbv2-integrated-heading">
      <span>↔</span>
      <div>
        <h3>Lectura integrada de la evolución institucional</h3>
        <p>Comparación determinística de series relacionadas sobre años comunes.</p>
      </div>
    </div>
    <div class="dbv2-integrated-grid">
      ${cards.map((card) => `
        <article class="dbv2-integrated-card">
          <h4>${card.title}</h4>
          <div class="dbv2-integrated-pair">
            <div><span>${card.leftLabel}</span><strong>${card.leftPct}</strong></div>
            <b>vs</b>
            <div><span>${card.rightLabel}</span><strong>${card.rightPct}</strong></div>
          </div>
          <p>${card.text}</p>
          <small>${card.caveat}</small>
        </article>
      `).join('')}
    </div>`;

  if (!current) {
    const sections = Array.from(report.querySelectorAll<HTMLElement>('.report-paper > .report-section'));
    const expansion = sections.find((item) => item.querySelector('h3')?.textContent?.trim() === 'Expansión del universo obligado');
    if (expansion) expansion.before(section);
    else report.querySelector('.report-paper')?.append(section);
  }
}

function ensurePrintUi(report: HTMLElement) {
  const button = report.querySelector<HTMLButtonElement>('.atlas-report-controls .report-btn-primary');
  if (button && button.textContent?.trim() === 'Generar PDF') {
    button.textContent = 'Imprimir / guardar PDF';
    button.title = 'Abre la impresión A4 del informe completo para imprimir o guardar como PDF.';
  }

  if (button && !button.parentElement?.querySelector('.dbv2-pdf-hint')) {
    const hint = document.createElement('small');
    hint.className = 'dbv2-pdf-hint';
    hint.textContent = 'A4 · incluye portada, gráficos, lecturas, tablas, contexto y fuentes';
    button.insertAdjacentElement('afterend', hint);
  }

  const paper = report.querySelector<HTMLElement>('.report-paper');
  if (paper && !paper.querySelector(`#${PRINT_FOOTER_ID}`)) {
    const footer = document.createElement('div');
    footer.id = PRINT_FOOTER_ID;
    footer.className = 'dbv2-print-footer';
    footer.innerHTML = '<span>ATLAS OBSERVATORIO · INFORME INSTITUCIONAL UAF</span><span>Series trazadas · cortes y fuentes al final del documento</span>';
    paper.append(footer);
  }
}

function scanTrendReport() {
  trendInsightScheduled = false;
  const report = document.querySelector<HTMLElement>(REPORT_SELECTOR);
  if (!report) return;
  report.querySelectorAll<HTMLElement>(CHART_SELECTOR).forEach(renderInsight);
  renderIntegratedReading(report);
  ensurePrintUi(report);
}

function scheduleTrendScan() {
  if (trendInsightScheduled) return;
  trendInsightScheduled = true;
  window.requestAnimationFrame(scanTrendReport);
}

const reportRoot = document.getElementById('root') ?? document.body;
new MutationObserver(scheduleTrendScan).observe(reportRoot, { childList: true, subtree: true, characterData: true });
window.addEventListener('hashchange', scheduleTrendScan);
window.addEventListener('beforeprint', () => {
  document.body.classList.add('atlas-pdf-printing');
  scanTrendReport();
});
window.addEventListener('afterprint', () => document.body.classList.remove('atlas-pdf-printing'));
scheduleTrendScan();
