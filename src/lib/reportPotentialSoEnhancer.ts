import { supabase } from './supabase';

export {};

type PotentialTotal = {
  observadas: number | null;
  accionables: number | null;
  revisados: number | null;
  sin_revisar: number | null;
  sectores: number | null;
  sii_periodo: string | null;
  uaf_corte: string | null;
  refreshed_at: string | null;
};

type PotentialSector = {
  sector: string;
  observadas: number | null;
  accionables: number | null;
};

type PotentialPayload = {
  total: PotentialTotal;
  sectors: PotentialSector[];
};

const SECTION_CLASS = 'dbv2-potential-so';
const REPORT_SELECTOR = '.dbv2-view';
const fmt0 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
let cached: PotentialPayload | null = null;
let pending: Promise<PotentialPayload | null> | null = null;
let scheduled = false;

function esc(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function load(): Promise<PotentialPayload | null> {
  if (cached) return cached;
  if (pending) return pending;

  pending = (async () => {
    const [totalRes, sectorRes] = await Promise.all([
      supabase
        .from('obs_uaf_potential_total')
        .select('observadas,accionables,revisados,sin_revisar,sectores,sii_periodo,uaf_corte,refreshed_at')
        .limit(1)
        .maybeSingle(),
      supabase
        .from('obs_uaf_potential_sector')
        .select('sector,observadas,accionables')
        .gt('accionables', 0)
        .order('accionables', { ascending: false })
        .order('observadas', { ascending: false })
        .limit(8),
    ]);

    if (totalRes.error || sectorRes.error || !totalRes.data) return null;
    cached = {
      total: totalRes.data as PotentialTotal,
      sectors: (sectorRes.data ?? []) as PotentialSector[],
    };
    return cached;
  })();

  try {
    return await pending;
  } finally {
    pending = null;
  }
}

function stat(label: string, value: string, note: string, highlight = false) {
  return `<div class="dbv2-stat ${highlight ? 'dbv2-stat-highlight' : ''}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`;
}

function render(report: HTMLElement, payload: PotentialPayload) {
  const paper = report.querySelector<HTMLElement>('.report-paper');
  if (!paper) return;
  if (paper.querySelector(`.${SECTION_CLASS}`)) return;

  const expansion = Array.from(paper.querySelectorAll<HTMLElement>('.report-section')).find(
    (section) => section.querySelector('h3')?.textContent?.trim() === 'Expansión del universo obligado',
  );
  if (!expansion) return;

  const total = payload.total;
  const observed = Number(total.observadas ?? 0);
  const actionable = Number(total.accionables ?? 0);
  const reviewed = Number(total.revisados ?? 0);
  const pendingReview = Number(total.sin_revisar ?? 0);
  const sectorsN = Number(total.sectores ?? 0);
  const topFive = payload.sectors.slice(0, 5).reduce((sum, row) => sum + Number(row.accionables ?? 0), 0);
  const concentration = actionable > 0 ? topFive * 100 / actionable : 0;
  const maxActionable = Math.max(1, ...payload.sectors.map((row) => Number(row.accionables ?? 0)));

  const section = document.createElement('section');
  section.className = `report-section report-page-break ${SECTION_CLASS}`;
  section.innerHTML = `
    <div class="report-section-heading">
      <span>07</span>
      <div>
        <h3>Potenciales sujetos obligados</h3>
        <p>Screening económico de entidades fuera del corte público del padrón UAF.</p>
      </div>
    </div>

    <div class="dbv2-stat-grid dbv2-potential-kpis">
      ${stat('Entidades observadas', fmt0.format(observed), `${sectorsN} sectores cubiertos`)}
      ${stat('Hipótesis accionables', fmt0.format(actionable), 'candidatas que cumplen el criterio vigente de screening', true)}
      ${stat('Revisadas', fmt0.format(reviewed), 'revisión analítica registrada')}
      ${stat('Pendientes de revisión', fmt0.format(pendingReview), 'hipótesis accionables aún sin revisión')}
    </div>

    <div class="dbv2-potential-layout">
      <article class="dbv2-potential-chart">
        <div class="dbv2-potential-chart-head">
          <div><strong>Principales sectores económicos</strong><span>Hipótesis accionables por sector</span></div>
          <em>${fmt1.format(concentration)}%</em>
        </div>
        <small class="dbv2-potential-concentration">Los cinco primeros sectores reúnen ${fmt0.format(topFive)} de ${fmt0.format(actionable)} hipótesis accionables.</small>
        <div class="dbv2-potential-bars">
          ${payload.sectors.map((row) => {
            const n = Number(row.accionables ?? 0);
            const width = Math.max(3, n * 100 / maxActionable);
            return `<div class="dbv2-potential-row"><span title="${esc(row.sector)}">${esc(row.sector)}</span><i><b style="width:${width}%"></b></i><strong>${fmt0.format(n)}</strong></div>`;
          }).join('')}
        </div>
      </article>

      <article class="dbv2-potential-reading">
        <strong>Lectura institucional</strong>
        <p>El universo observado corresponde a un barrido económico amplio; no equivale a nuevos sujetos obligados. El criterio de Atlas reduce esa base a ${fmt0.format(actionable)} hipótesis accionables que requieren validación antes de cualquier conclusión registral.</p>
        <p>Si una hipótesis se confirma, el efecto institucional potencial no se limita a sumar una entidad al padrón: puede implicar validación de antecedentes, incorporación y orientación registral, supervisión posterior y eventual nueva reportabilidad. Esta sección describe ese perímetro potencial y no estima una brecha de dotación.</p>
        <small>Corte UAF: ${esc(total.uaf_corte ?? 's/d')} · período SII: ${esc(total.sii_periodo ?? 's/d')} · actualización Atlas: ${esc(total.refreshed_at ? new Date(total.refreshed_at).toLocaleDateString('es-CL') : 's/d')}.</small>
      </article>
    </div>

    <p class="dbv2-note dbv2-potential-caveat">Una entidad potencial no se presenta como sujeto obligado confirmado ni como incumplidora. La ausencia del corte público del padrón UAF, por sí sola, no acredita falta de inscripción ni obligación jurídica.</p>
  `;

  expansion.insertAdjacentElement('afterend', section);

  const numbering: Record<string, string> = {
    'Potenciales sujetos obligados': '07',
    'Preguntas y antecedentes': '08',
    'Contexto reciente': '09',
    'Fuentes y cortes': '10',
  };
  paper.querySelectorAll<HTMLElement>('.report-section').forEach((candidate) => {
    const title = candidate.querySelector('h3')?.textContent?.trim() ?? '';
    const number = numbering[title];
    if (!number) return;
    const badge = candidate.querySelector<HTMLElement>('.report-section-heading > span');
    if (badge) badge.textContent = number;
  });
}

async function scan() {
  scheduled = false;
  const report = document.querySelector<HTMLElement>(REPORT_SELECTOR);
  if (!report || !window.location.hash.startsWith('#/reportes')) return;
  if (report.querySelector(`.${SECTION_CLASS}`)) return;
  const payload = await load();
  if (!payload) return;
  const current = document.querySelector<HTMLElement>(REPORT_SELECTOR);
  if (current) render(current, payload);
}

function scheduleScan() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => void scan());
}

const root = document.getElementById('root') ?? document.body;
new MutationObserver(scheduleScan).observe(root, { childList: true, subtree: true });
window.addEventListener('hashchange', scheduleScan);
scheduleScan();
