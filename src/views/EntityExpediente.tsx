import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import type { CoverageRow, EntityDetail } from '../lib/contracts';
import { Badge, Empty, ErrorBox, Loading } from '../components/primitives';
import { bandLabel, fecha, n, n1, rutFormat, titleCase } from '../lib/format';
import { searchPress, type PressMatch } from '../lib/press';

type Tab = 'resumen' | 'tributario' | 'uaf' | 'sanciones' | 'registros' | 'historico' | 'fuentes';
type GlyphName = 'sales' | 'people' | 'activity' | 'public' | 'sanction' | 'uaf' | 'osfl' | 'res' | 'press' | 'sii' | 'alert' | 'copy' | 'external';
type TimelineKind = 'tax' | 'sanction' | 'press' | 'event';

type PressState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  matches: PressMatch[];
  error?: string;
};

type TimelineRow = {
  key: string;
  date: string | null;
  title: string;
  detail?: string | null;
  source?: string | null;
  kind: TimelineKind;
  url?: string | null;
};

type ActivityRow = {
  code: string | null;
  name: string;
  principal: boolean;
};

const TABS: { id: Tab; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'tributario', label: 'Tributario' },
  { id: 'uaf', label: 'UAF' },
  { id: 'sanciones', label: 'Sanciones' },
  { id: 'registros', label: 'OSFL / RES' },
  { id: 'historico', label: 'Histórico' },
  { id: 'fuentes', label: 'Fuentes' },
];

function compactRut(value: string | null | undefined): string {
  return String(value ?? '').toUpperCase().replace(/[^0-9K]/g, '');
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasRecordData(value: Record<string, unknown>): boolean {
  return Object.values(value).some((item) => {
    if (item == null || item === '') return false;
    if (Array.isArray(item)) return item.length > 0;
    if (typeof item === 'object') return Object.keys(item as Record<string, unknown>).length > 0;
    return true;
  });
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatClp(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${n1(value / 1e12)} bill.`;
  if (abs >= 1e9) return `$${n1(value / 1e9)} mil M`;
  if (abs >= 1e6) return `$${n1(value / 1e6)} M`;
  return `$${n(Math.round(value))}`;
}

function splitPipe(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? '').split('|').map((item) => item.trim()).filter(Boolean);
}

function coverageByCode(data: EntityDetail, ...codes: string[]): CoverageRow | undefined {
  return data.coverage.find((row) => codes.includes(row.source_code));
}

function coverageStatus(row: CoverageRow | undefined): 'present' | 'absent' | 'unknown' {
  if (!row || row.status === 'NOT_CONSULTED' || row.status === 'ERROR') return 'unknown';
  return row.status === 'PRESENT' ? 'present' : 'absent';
}

function coverageLabel(row: CoverageRow | undefined): string {
  if (!row) return 'Sin cobertura';
  if (row.status === 'PRESENT') return 'Sí registra';
  if (row.status === 'ABSENT') return 'No registra';
  if (row.status === 'NOT_CONSULTED') return 'No consultado';
  return 'Error de fuente';
}

function activitiesFor(data: EntityDetail): ActivityRow[] {
  const tax = record(data.tax);
  const names = splitPipe(tax.activity_names);
  const codes = splitPipe(tax.activity_codes);
  const main = text(tax.main_activity) ?? text(data.entity.tax_activity);
  const rows = names.map((name, index) => ({
    name: titleCase(name),
    code: codes[index] ?? null,
    principal: main ? name.localeCompare(main, 'es', { sensitivity: 'base' }) === 0 : index === 0,
  }));
  if (main && !rows.some((row) => row.principal)) {
    rows.unshift({ name: titleCase(main), code: codes[0] ?? null, principal: true });
  }
  if (rows.length === 0 && main) return [{ name: titleCase(main), code: codes[0] ?? null, principal: true }];
  return rows;
}

function salesHistory(data: EntityDetail) {
  const tax = record(data.tax);
  const currentYear = numberValue(tax.commercial_year);
  const currentRank = numberValue(tax.sales_band_rank);
  const currentBand = text(tax.sales_band_uf) ?? text(data.entity.tax_sales_band_uf);
  const rows = data.peers
    .map((peer) => ({ year: peer.commercial_year, rank: numberValue(peer.sales_band_code), band: peer.sales_band_code }))
    .filter((row) => row.year && row.rank != null);
  if (currentYear && currentRank != null && !rows.some((row) => row.year === currentYear)) {
    rows.push({ year: currentYear, rank: currentRank, band: currentBand });
  }
  return rows.sort((a, b) => a.year - b.year).slice(-6);
}

function pressArticles(matches: PressMatch[]) {
  const seen = new Set<string>();
  return matches
    .flatMap((match) => match.articles.map((article) => ({ ...article, match })))
    .filter(({ id }) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
}

function strictPressMatches(entity: EntityDetail['entity'], matches: PressMatch[]): PressMatch[] {
  const rut = compactRut(entity.rut);
  if (rut) {
    const byRut = matches.filter((match) => match.ruts.some((candidate) => compactRut(candidate) === rut));
    if (byRut.length) return byRut;
  }
  return matches.filter((match) => match.match_score >= 0.94);
}

function timelineFor(data: EntityDetail, press: PressMatch[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  data.lifecycle.forEach((milestone, index) => {
    rows.push({
      key: `life-${index}-${milestone.fecha ?? 'none'}`,
      date: milestone.fecha,
      title: milestone.etiqueta,
      detail: milestone.detalle,
      source: milestone.fuente,
      kind: 'tax',
    });
  });
  data.sanctions.forEach((sanction) => {
    rows.push({
      key: `sanction-${sanction.sanction_id}`,
      date: sanction.event_date,
      title: sanction.regulator ? `Sanción ${sanction.regulator}` : 'Sanción registrada',
      detail: sanction.subject,
      source: sanction.regulator,
      kind: 'sanction',
      url: sanction.document_url,
    });
  });
  pressArticles(press).slice(0, 8).forEach((article) => {
    rows.push({
      key: `press-${article.id}`,
      date: article.date,
      title: article.title,
      detail: article.summary,
      source: article.media,
      kind: 'press',
      url: article.url,
    });
  });
  data.events.forEach((event) => {
    const producer = String(event.productor ?? '').toUpperCase();
    if (producer === 'RADAR_SANCIONES' || producer === 'RADAR_PRENSA'
      || /GASTO|COMPRA|MERCADO_PUBLICO|PRESUPUESTO/.test(producer)) return;
    rows.push({
      key: `event-${event.event_id ?? `${event.tipo}-${event.fecha}`}`,
      date: event.fecha,
      title: event.tipo_es ? titleCase(event.tipo_es) : titleCase(String(event.tipo ?? 'Hecho observado').replace(/_/g, ' ')),
      detail: event.titulo && event.titulo !== event.tipo ? event.titulo : null,
      source: event.productor ? titleCase(event.productor.replace(/_/g, ' ')) : null,
      kind: 'event',
    });
  });
  return rows
    .filter((row) => row.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .filter((row, index, array) => {
      const signature = `${String(row.date).slice(0, 10)}|${row.title.toLowerCase()}`;
      return array.findIndex((candidate) => `${String(candidate.date).slice(0, 10)}|${candidate.title.toLowerCase()}` === signature) === index;
    });
}

function mainFinding(data: EntityDetail) {
  if (data.alerts.length) {
    const alert = [...data.alerts].sort((a, b) => Number(b.strength ?? 0) - Number(a.strength ?? 0))[0];
    return {
      title: alert.title ?? 'Señal activa sobre la entidad',
      summary: alert.summary ?? 'Existe una señal gobernada que justifica revisión analítica.',
    };
  }
  if (data.findings.length) {
    const finding = [...data.findings].sort((a, b) => {
      const av = Math.max(Number(a.score_investigate ?? 0), Number(a.score_supervise ?? 0), Number(a.score_explore ?? 0));
      const bv = Math.max(Number(b.score_investigate ?? 0), Number(b.score_supervise ?? 0), Number(b.score_explore ?? 0));
      return bv - av;
    })[0];
    const payload = record(finding.payload);
    return {
      title: finding.title ?? titleCase(finding.finding_type.replace(/_/g, ' ')),
      summary: text(payload.explanation) ?? 'Hallazgo derivado de evidencia observable en las fuentes integradas.',
    };
  }
  return null;
}

function initials(name: string): string {
  const ignored = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'S.A.', 'SPA', 'LTDA']);
  const parts = name.split(/\s+/).filter(Boolean).filter((part) => !ignored.has(part.toUpperCase()));
  if (!parts.length) return 'AT';
  return `${parts[0][0] ?? ''}${parts[1]?.[0] ?? parts[0][1] ?? ''}`.toUpperCase();
}

export function EntityExpediente({ entityId, onNavigate }: { entityId: string; onNavigate: (hash: string) => void }) {
  const [tab, setTab] = useState<Tab>('resumen');
  const [press, setPress] = useState<PressState>({ status: 'idle', matches: [] });
  const { data, error, loading, reload } = useRpc<EntityDetail | null>('obs_entity_detail', { p_entity_id: entityId });

  useEffect(() => {
    let cancelled = false;
    const entity = data?.entity;
    if (!entity) return () => { cancelled = true; };
    setPress({ status: 'loading', matches: [] });
    const run = async () => {
      try {
        let matches = await searchPress(entity.rut ?? entity.name, 10);
        matches = strictPressMatches(entity, matches);
        if (!matches.length && entity.rut) matches = strictPressMatches(entity, await searchPress(entity.name, 10));
        if (!cancelled) setPress({ status: 'done', matches });
      } catch (e) {
        if (!cancelled) setPress({ status: 'error', matches: [], error: (e as Error).message });
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [data?.entity.entity_id, data?.entity.name, data?.entity.rut]);

  const timeline = useMemo(() => data ? timelineFor(data, press.matches) : [], [data, press.matches]);
  const articles = useMemo(() => pressArticles(press.matches), [press.matches]);

  if (loading) return <Loading label="Construyendo expediente analítico…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Empty title="Entidad no encontrada en este corte" hint={`El identificador ${entityId} no está en el universo publicado.`} />;

  const entity = data.entity;
  const tax = record(data.tax);
  const uaf = record(data.uaf);
  const res = record(data.res);
  const osfl = record(data.osfl);
  const activities = activitiesFor(data);
  const history = salesHistory(data);
  const finding = mainFinding(data);
  const purchase = coverageByCode(data, 'MERCADO_PUBLICO');
  const uafCoverage = coverageByCode(data, 'RADAR_UAF');
  const siiCoverage = coverageByCode(data, 'RADAR_SII');
  const osflCoverage = coverageByCode(data, 'RADAR_OSFL', 'REGISTRO_CIVIL_OSFL');
  const resCoverage = coverageByCode(data, 'RES');
  const pressCoverage = coverageByCode(data, 'RADAR_PRENSA');
  const sanctionCoverage = coverageByCode(data, 'RADAR_SANCIONES');
  const taxStatus = (text(tax.current_status) ?? '').toUpperCase();
  const active = !text(tax.termination_date) && (taxStatus.includes('ACTIVE') || taxStatus.includes('VIGENTE'));
  const score = entity.ipa3_score;
  const scoreBand = bandLabel(entity.ipa3_band ?? data.priority?.priority_band_shadow);
  const scorePct = Math.max(0, Math.min(100, Number(score ?? 0)));

  const tabHasData: Record<Tab, boolean> = {
    resumen: false,
    tributario: siiCoverage?.status === 'PRESENT' || hasRecordData(tax) || activities.length > 0 || history.length > 0,
    uaf: uafCoverage?.status === 'PRESENT' || hasRecordData(uaf),
    sanciones: sanctionCoverage?.status === 'PRESENT' || data.sanctions.length > 0,
    registros: osflCoverage?.status === 'PRESENT' || resCoverage?.status === 'PRESENT' || hasRecordData(osfl) || hasRecordData(res),
    historico: timeline.length > 0,
    fuentes: data.coverage.some((row) => row.status === 'PRESENT'),
  };

  return (
    <div className="entity360 fade-in">
      <div className="entity360-crumbs">
        <button className="entity360-back" onClick={() => onNavigate(hrefFor({ view: 'entidades' }))}>← Volver a entidades</button>
        <span>/</span><strong>Expediente</strong>
      </div>

      <header className="entity360-hero">
        <div className="entity360-identity">
          <div className="entity360-avatar" aria-hidden>{initials(entity.name)}</div>
          <div className="entity360-nameblock">
            <div className="entity360-eyebrow">Entidad 360</div>
            <div className="entity360-titleline">
              <h1>{titleCase(entity.name)}</h1>
              {active ? <Badge tone="present">Vigente</Badge> : text(tax.termination_date) ? <Badge tone="critical">Término de giro</Badge> : null}
            </div>
            <div className="entity360-meta">
              <span className="mono">{entity.rut ? rutFormat(entity.rut) : 'Sin RUT'}</span>
              {entity.entity_type && <span>{entity.entity_type}</span>}
              {text(tax.main_activity) && <span className="entity360-meta-activity">{titleCase(String(tax.main_activity))}</span>}
            </div>
            {(entity.commune || entity.region) && <div className="entity360-location"><span>⌖</span>{entity.commune ? titleCase(entity.commune) : null}{entity.commune && entity.region ? ', ' : ''}{entity.region ? titleCase(entity.region) : null}</div>}
          </div>
        </div>

        <div className="entity360-score" data-has-score={score != null && score > 0}>
          <div className="entity360-score-label">IPA3 · prioridad analítica</div>
          <div className="entity360-score-value">{score == null ? '—' : n1(score)}<small>/100</small></div>
          <div className="entity360-score-track"><i style={{ width: `${scorePct}%` }} /></div>
          <div className="entity360-score-foot">{scoreBand || 'Sin banda materializada'}</div>
        </div>

        <div className="entity360-finding" data-empty={!finding}>
          <div className="entity360-finding-icon"><Glyph name="alert" /></div>
          <div>
            <div className="entity360-finding-label">Hallazgo principal</div>
            <strong>{finding?.title ?? 'Sin hallazgo prioritario en el corte'}</strong>
            <p>{finding?.summary ?? 'Las fuentes integradas no activan un hallazgo gobernado sobre esta entidad.'}</p>
          </div>
        </div>
      </header>

      <nav className="entity360-tabs" aria-label="Secciones del expediente">
        {TABS.map((item) => (
          <button
            key={item.id}
            data-active={tab === item.id}
            data-has-info={tabHasData[item.id]}
            title={tabHasData[item.id] ? 'Hay información disponible en esta sección' : undefined}
            onClick={() => setTab(item.id)}
          >
            <span>{item.label}</span>
            {tabHasData[item.id] && <i className="entity360-tab-data-dot" aria-hidden="true" />}
          </button>
        ))}
      </nav>

      {tab === 'resumen' && <ResumenTab data={data} press={press} articles={articles} timeline={timeline} activities={activities} history={history} purchase={purchase} registry={{ uaf: uafCoverage, sii: siiCoverage, osfl: osflCoverage, res: resCoverage, press: pressCoverage, sanctions: sanctionCoverage }} />}
      {tab === 'tributario' && <TributarioTab data={data} activities={activities} history={history} />}
      {tab === 'uaf' && <UafTab data={data} uaf={uaf} coverage={uafCoverage} />}
      {tab === 'sanciones' && <SancionesTab data={data} />}
      {tab === 'registros' && <RegistrosTab data={data} osfl={osfl} res={res} osflCoverage={osflCoverage} resCoverage={resCoverage} />}
      {tab === 'historico' && <HistoricoTab rows={timeline} />}
      {tab === 'fuentes' && <FuentesTab coverage={data.coverage} />}

      <div className="entity360-semantics"><strong>Lectura analítica.</strong> Esta vista reúne evidencia observada y prioriza revisión. Presencia, ausencia, score o coincidencia de prensa no acreditan por sí solos una conducta ilícita. Corte <span className="mono">{entity.snapshot_id}</span> · actualizado {fecha(entity.refreshed_at)}.</div>
    </div>
  );
}

function ResumenTab({ data, press, articles, timeline, activities, history, purchase, registry }: {
  data: EntityDetail;
  press: PressState;
  articles: ReturnType<typeof pressArticles>;
  timeline: TimelineRow[];
  activities: ActivityRow[];
  history: ReturnType<typeof salesHistory>;
  purchase: CoverageRow | undefined;
  registry: { uaf: CoverageRow | undefined; sii: CoverageRow | undefined; osfl: CoverageRow | undefined; res: CoverageRow | undefined; press: CoverageRow | undefined; sanctions: CoverageRow | undefined };
}) {
  const tax = record(data.tax);
  const salesBand = text(tax.sales_band_uf) ?? data.entity.tax_sales_band_uf ?? 'Sin tramo';
  const workers = numberValue(tax.workers_numeric) ?? data.entity.tax_workers;
  const purchasePresent = purchase?.status === 'PRESENT';
  const indexedPressCount = press.matches.reduce((best, match) => Math.max(best, match.article_count ?? 0), 0);
  const pressCount = Math.max(articles.length, indexedPressCount, registry.press?.record_count ?? 0);
  return (
    <div className="entity360-summary">
      <div className="entity360-kpis">
        <Kpi icon="sales" label="Tramo ventas (UF)" value={salesBand} sub={text(tax.commercial_year) ? `Año comercial ${text(tax.commercial_year)}` : 'SII'} compact />
        <Kpi icon="people" label="Trabajadores" value={workers == null ? '—' : n(workers)} sub={workers == null ? 'Sin dato publicado' : 'Dotación publicada por SII'} />
        <Kpi icon="activity" label="Actividades SII" value={n(activities.length || numberValue(tax.activity_count) || 0)} sub={activities[0]?.name ?? 'Sin actividades materializadas'} />
        <Kpi icon="public" label="Proveedor del Estado" value={purchasePresent ? 'Sí' : coverageLabel(purchase)} sub="ChileCompra · señal de presencia" tone={purchasePresent ? 'present' : 'neutral'} />
        <Kpi icon="sanction" label="Sanciones" value={n(data.sanctions.length)} sub={data.sanctions.length ? `${data.sanctions[0]?.regulator ?? 'Supervisor'} · última ${fecha(data.sanctions[0]?.event_date)}` : 'Sin eventos materializados'} tone={data.sanctions.length ? 'critical' : 'neutral'} />
      </div>
      <div className="entity360-row entity360-row-top"><BaseCard data={data} /><SalesBandCard history={history} currentBand={salesBand} /><ActivitiesCard rows={activities} /></div>
      <div className="entity360-row entity360-row-middle"><RegistryCard data={data} pressStatus={press.status} pressCount={Number(pressCount)} registry={registry} purchase={purchase} /><TimelineCard rows={timeline} /></div>
      <div className="entity360-row entity360-row-bottom"><SanctionsCard data={data} /><PressCard press={press} articles={articles} /></div>
    </div>
  );
}

function BaseCard({ data }: { data: EntityDetail }) {
  const tax = record(data.tax);
  const res = record(data.res);
  return <Card title="Ficha base" meta="SII · identidad resuelta"><dl className="entity360-kv">
    <dt>Razón social</dt><dd>{titleCase(data.entity.name)}</dd>
    <dt>RUT</dt><dd className="mono">{data.entity.rut ? rutFormat(data.entity.rut) : '—'}</dd>
    <dt>Tipo</dt><dd>{data.entity.entity_type ?? text(tax.taxpayer_type) ?? '—'}</dd>
    <dt>Régimen / estado</dt><dd>{text(tax.current_status) ? titleCase(String(tax.current_status).replace(/_/g, ' ')) : '—'}</dd>
    <dt>Domicilio</dt><dd>{[text(tax.commune) ?? data.entity.commune, text(tax.region) ?? data.entity.region].filter(Boolean).map((v) => titleCase(String(v))).join(', ') || '—'}</dd>
    <dt>Inicio actividades</dt><dd>{fecha(text(tax.activity_start_date))}</dd>
    {text(res.constitution_date) && <><dt>Constitución RES</dt><dd>{fecha(text(res.constitution_date))}</dd></>}
  </dl></Card>;
}

function SalesBandCard({ history, currentBand }: { history: ReturnType<typeof salesHistory>; currentBand: string }) {
  const maxRank = Math.max(13, ...history.map((row) => row.rank ?? 0));
  return <Card title="Evolución tributaria" meta="tramo de ventas SII">
    {history.length ? <div className="entity360-bars" role="img" aria-label="Evolución del tramo de ventas por año comercial"><div className="entity360-bars-grid" /><div className="entity360-bars-items">{history.map((row) => <div className="entity360-bar-col" key={row.year} title={`${row.year}: tramo ${row.band ?? row.rank ?? '—'}`}><div className="entity360-bar-value">{row.rank ?? '—'}</div><div className="entity360-bar-wrap"><i style={{ height: `${Math.max(8, ((row.rank ?? 0) / maxRank) * 100)}%` }} /></div><div className="entity360-bar-year">{row.year}</div></div>)}</div></div> : <div className="entity360-bigfact"><span>Tramo publicado</span><strong>{currentBand}</strong><small>No hay serie comparable materializada para años anteriores.</small></div>}
    <div className="entity360-chart-note">El gráfico representa el <strong>ordinal del tramo</strong>, no ventas exactas. El rango en UF se muestra en la tarjeta superior.</div>
  </Card>;
}

function ActivitiesCard({ rows }: { rows: ActivityRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 5);
  return <Card title="Actividades y giros (SII)" meta={`${n(rows.length)} materializados`}>
    {rows.length ? <div className="entity360-activity-list">{visible.map((row, index) => <div className="entity360-activity" key={`${row.code ?? index}-${row.name}`}><div className="entity360-activity-rank">{String(index + 1).padStart(2, '0')}</div><div className="entity360-activity-text"><strong>{row.name}</strong><span>{row.code ? `Código ${row.code}` : 'Código no materializado'}</span></div>{row.principal && <Badge tone="present">Principal</Badge>}</div>)}{rows.length > 5 && <button className="entity360-linkbtn" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Mostrar menos' : `Ver ${rows.length - 5} actividades más`} →</button>}</div> : <Empty title="Sin actividades materializadas" hint="El corte SII no aporta giros para esta entidad." />}
  </Card>;
}

function RegistryCard({ data, pressStatus, pressCount, registry, purchase }: {
  data: EntityDetail;
  pressStatus: PressState['status'];
  pressCount: number;
  registry: { uaf: CoverageRow | undefined; sii: CoverageRow | undefined; osfl: CoverageRow | undefined; res: CoverageRow | undefined; press: CoverageRow | undefined; sanctions: CoverageRow | undefined };
  purchase: CoverageRow | undefined;
}) {
  const pressTone = pressStatus === 'loading' ? 'unknown' : pressCount > 0 ? 'present' : coverageStatus(registry.press);
  return <Card title="Presencia en registros" meta="estado del corte vigente"><div className="entity360-registry-grid">
    <RegistryTile icon="sii" label="SII" status={coverageStatus(registry.sii)} value={coverageLabel(registry.sii)} detail={data.entity.tax_status ? titleCase(data.entity.tax_status.replace(/_/g, ' ')) : 'Perfil tributario'} />
    <RegistryTile icon="uaf" label="UAF" status={coverageStatus(registry.uaf)} value={coverageLabel(registry.uaf)} detail={data.entity.uaf_sector ? titleCase(data.entity.uaf_sector) : 'Padrón de SO'} />
    <RegistryTile icon="osfl" label="OSFL" status={coverageStatus(registry.osfl)} value={coverageLabel(registry.osfl)} detail="Registro Civil / SII" />
    <RegistryTile icon="res" label="RES / Empresa en un Día" status={coverageStatus(registry.res)} value={coverageLabel(registry.res)} detail="Registro de Empresas y Sociedades" />
    <RegistryTile icon="public" label="Proveedor del Estado" status={coverageStatus(purchase)} value={purchase?.status === 'PRESENT' ? 'Sí' : coverageLabel(purchase)} detail="ChileCompra · presencia como proveedor" />
    <RegistryTile icon="sanction" label="Sanciones" status={coverageStatus(registry.sanctions)} value={data.sanctions.length ? `${n(data.sanctions.length)} registro${data.sanctions.length === 1 ? '' : 's'}` : coverageLabel(registry.sanctions)} detail="UAF · CMF · SCJ · CGR" />
    <RegistryTile icon="press" label="Prensa" status={pressTone} value={pressStatus === 'loading' ? 'Consultando…' : pressCount > 0 ? `${n(pressCount)} noticia${pressCount === 1 ? '' : 's'}` : coverageLabel(registry.press)} detail="Radar Prensa" />
  </div></Card>;
}

function TimelineCard({ rows }: { rows: TimelineRow[] }) {
  const visible = rows.slice(0, 6).reverse();
  return <Card title="Hechos críticos" meta={rows.length ? `${n(rows.length)} hechos fechados` : 'sin hechos fechados'}>{visible.length ? <div className="entity360-timeline-rail"><div className="entity360-timeline-line" />{visible.map((row) => <div className="entity360-timeline-stop" data-kind={row.kind} key={row.key}><i /><time>{fecha(row.date)}</time><strong>{row.title}</strong><span>{row.source ?? row.detail ?? 'Fuente integrada'}</span></div>)}</div> : <Empty title="Sin hechos críticos fechados" hint="No hay fechas suficientes para construir una secuencia confiable." />}</Card>;
}

function SanctionsCard({ data }: { data: EntityDetail }) {
  return <Card title="Sanciones y fiscalizaciones" meta={data.sanctions.length ? `${n(data.sanctions.length)} eventos` : 'sin registros'}>{data.sanctions.length ? <div className="entity360-mini-table-wrap"><table className="entity360-mini-table"><thead><tr><th>Fecha</th><th>Institución</th><th>Materia</th><th>Documento</th></tr></thead><tbody>{data.sanctions.slice(0, 4).map((sanction) => <tr key={sanction.sanction_id}><td className="mono">{fecha(sanction.event_date)}</td><td>{sanction.regulator ?? '—'}</td><td className="entity360-cell-clip" title={sanction.subject ?? undefined}>{sanction.subject ?? '—'}</td><td>{sanction.document_url ? <a className="entity360-inline-link" href={sanction.document_url} target="_blank" rel="noreferrer">{sanction.resolution_ref ? `N° ${sanction.resolution_ref}` : 'Abrir'} ↗</a> : '—'}</td></tr>)}</tbody></table></div> : <Empty title="Sin sanciones materializadas" hint="Ningún evento sancionatorio se enlaza a la identidad en este corte." />}</Card>;
}

function PressCard({ press, articles }: { press: PressState; articles: ReturnType<typeof pressArticles> }) {
  return <Card title="Prensa coincidente" meta={press.status === 'loading' ? 'consultando Radar Prensa…' : `${n(articles.length)} noticias enlazadas`}>
    {press.status === 'error' ? <div className="entity360-card-message">Radar Prensa no respondió en esta consulta. {press.error}</div> : articles.length ? <div className="entity360-press-list">{articles.slice(0, 3).map((article, index) => <details key={article.id} open={index === 0}><summary><div><time>{fecha(article.date)}</time><strong>{article.title}</strong><span>{article.media ?? 'Prensa abierta'}</span></div><span className="entity360-detail-chevron">›</span></summary><div className="entity360-press-detail"><p>{article.summary ?? 'La fuente no entrega un resumen en el corte vigente.'}</p>{article.url && <a href={article.url} target="_blank" rel="noopener noreferrer">Abrir nota <Glyph name="external" /></a>}</div></details>)}</div> : press.status === 'loading' ? <div className="entity360-card-message">Buscando por RUT y razón social…</div> : <Empty title="Sin prensa coincidente" hint="No se encontraron coincidencias suficientemente precisas por RUT o nombre." />}
    <div className="entity360-card-footnote">La coincidencia periodística aporta contexto de fuente abierta; no acredita identidad, participación ni responsabilidad por sí sola.</div>
  </Card>;
}

function TributarioTab({ data, activities, history }: { data: EntityDetail; activities: ActivityRow[]; history: ReturnType<typeof salesHistory> }) {
  const tax = record(data.tax);
  const workers = numberValue(tax.workers_numeric);
  return <div className="entity360-tabgrid entity360-tabgrid-tax"><Card title="Perfil tributario" meta="Servicio de Impuestos Internos"><dl className="entity360-kv entity360-kv-wide">
    <dt>Estado</dt><dd>{text(tax.current_status) ? titleCase(String(tax.current_status).replace(/_/g, ' ')) : '—'}</dd>
    <dt>Inicio de actividades</dt><dd>{fecha(text(tax.activity_start_date))}</dd>
    <dt>Término de giro</dt><dd>{fecha(text(tax.termination_date))}</dd>
    <dt>Tipo de contribuyente</dt><dd>{text(tax.taxpayer_type) ? titleCase(String(tax.taxpayer_type)) : '—'}</dd>
    <dt>Tipo de sociedad</dt><dd>{text(tax.society_type) ? titleCase(String(tax.society_type)) : '—'}</dd>
    <dt>Sector económico</dt><dd>{text(tax.economic_sector) ? titleCase(String(tax.economic_sector)) : '—'}</dd>
    <dt>Subsector</dt><dd>{text(tax.economic_subsector) ? titleCase(String(tax.economic_subsector)) : '—'}</dd>
    <dt>Región / comuna</dt><dd>{[text(tax.region), text(tax.commune)].filter(Boolean).map((value) => titleCase(String(value))).join(' · ') || '—'}</dd>
    <dt>Tramo ventas UF</dt><dd>{text(tax.sales_band_uf) ?? '—'}</dd>
    <dt>Trabajadores</dt><dd className="mono">{workers == null ? '—' : n(workers)}</dd>
    <dt>Domicilios observados</dt><dd className="mono">{numberValue(tax.address_count) == null ? '—' : n(numberValue(tax.address_count))}</dd>
  </dl></Card><SalesBandCard history={history} currentBand={text(tax.sales_band_uf) ?? 'Sin tramo'} /><ActivitiesCard rows={activities} /></div>;
}

function UafTab({ data, uaf, coverage }: { data: EntityDetail; uaf: Record<string, unknown>; coverage: CoverageRow | undefined }) {
  const present = coverage?.status === 'PRESENT' || data.entity.is_uaf_observed;
  return <div className="entity360-tabgrid entity360-tabgrid-2"><Card title="Registro UAF" meta="padrón de sujetos obligados">{present ? <dl className="entity360-kv entity360-kv-wide">
    <dt>Estado</dt><dd><Badge tone="present">Observada en padrón</Badge></dd>
    <dt>Sector</dt><dd>{titleCase(text(uaf.uaf_sector_canonical) ?? data.entity.uaf_sector ?? '—')}</dd>
    <dt>Naturaleza</dt><dd>{text(uaf.subject_nature) ? titleCase(String(uaf.subject_nature).replace(/_/g, ' ')) : '—'}</dd>
    <dt>Observado por Atlas</dt><dd>{fecha(text(uaf.registry_observed_at))}</dd>
    <dt>IPF</dt><dd>{numberValue(uaf.ipf_score) == null ? '—' : `${n1(numberValue(uaf.ipf_score))} · ${text(uaf.ipf_band) ?? 'sin banda'}`}</dd>
    <dt>Vulnerabilidad sectorial</dt><dd>{numberValue(uaf.sector_vulnerability) == null ? '—' : n1(numberValue(uaf.sector_vulnerability))}</dd>
    <dt>Sanciones observadas</dt><dd className="mono">{numberValue(uaf.sanction_event_count) == null ? n(data.sanctions.length) : n(numberValue(uaf.sanction_event_count))}</dd>
  </dl> : <Empty title={coverageLabel(coverage)} hint="La ausencia de registro en el corte no reemplaza una consulta a la fuente primaria." />}</Card><Card title="Lectura UAF" meta="contexto de supervisión"><div className="entity360-explain"><strong>{present ? 'Entidad observada como sujeto obligado' : 'Sin perfil UAF materializado'}</strong><p>{typeof uaf.semantics === 'string' ? uaf.semantics.replace(/_/g, ' ') : 'El perfil UAF se utiliza como contexto regulatorio y de priorización; no como probabilidad de LA/FT.'}</p>{Array.isArray(uaf.ipf_flags) && uaf.ipf_flags.length > 0 && <div className="entity360-chipset">{(uaf.ipf_flags as unknown[]).map((flag) => <Badge key={String(flag)} tone="unknown">{titleCase(String(flag).replace(/_/g, ' '))}</Badge>)}</div>}</div></Card></div>;
}

function SancionesTab({ data }: { data: EntityDetail }) {
  return <Card title={`Sanciones y fiscalizaciones · ${n(data.sanctions.length)}`} meta="UAF · CMF · SCJ · CGR">{data.sanctions.length ? <div className="entity360-full-table-wrap"><table className="entity360-full-table"><thead><tr><th>Fecha</th><th>Supervisor</th><th>Materia / extracto</th><th>Monto UF</th><th>Identidad</th><th>Resolución</th></tr></thead><tbody>{data.sanctions.map((sanction) => <tr key={sanction.sanction_id}><td className="mono">{fecha(sanction.event_date)}</td><td>{sanction.regulator ?? '—'}</td><td>{sanction.subject ?? '—'}</td><td className="mono">{sanction.amount_uf == null ? '—' : n1(sanction.amount_uf)}</td><td>{sanction.identity_status ? <Badge tone={sanction.identity_status.includes('RESOLVED') || sanction.identity_status.includes('EXACT') ? 'present' : 'unknown'}>{titleCase(sanction.identity_status.replace(/_/g, ' '))}</Badge> : '—'}</td><td>{sanction.document_url ? <a className="entity360-inline-link" href={sanction.document_url} target="_blank" rel="noreferrer">{sanction.resolution_ref ? `N° ${sanction.resolution_ref}` : 'Abrir documento'} ↗</a> : '—'}</td></tr>)}</tbody></table></div> : <Empty title="Sin sanciones materializadas" />}</Card>;
}

function RegistrosTab({ data, osfl, res, osflCoverage, resCoverage }: { data: EntityDetail; osfl: Record<string, unknown>; res: Record<string, unknown>; osflCoverage: CoverageRow | undefined; resCoverage: CoverageRow | undefined }) {
  return <div className="entity360-tabgrid entity360-tabgrid-2"><Card title="OSFL" meta="Registro Civil / SII">{osflCoverage?.status === 'PRESENT' || Object.keys(osfl).length ? <dl className="entity360-kv entity360-kv-wide"><dt>Estado</dt><dd><Badge tone="present">Registro materializado</Badge></dd><dt>Confirmación</dt><dd>{text(osfl.confirmation_level) ? titleCase(String(osfl.confirmation_level).replace(/_/g, ' ')) : '—'}</dd><dt>Actividad</dt><dd>{text(osfl.profile_activity_group) ? titleCase(String(osfl.profile_activity_group)) : text(osfl.main_activity) ?? '—'}</dd><dt>Estado actual</dt><dd>{text(osfl.current_status) ?? '—'}</dd><dt>Tramo ventas</dt><dd>{text(osfl.sales_band) ?? '—'}</dd></dl> : <Empty title={coverageLabel(osflCoverage)} hint="No se interpreta la ausencia como inexistencia de la persona jurídica." />}</Card><Card title="RES / Empresa en un Día" meta="Registro de Empresas y Sociedades">{resCoverage?.status === 'PRESENT' || Object.keys(res).length ? <dl className="entity360-kv entity360-kv-wide"><dt>Estado</dt><dd><Badge tone="present">Registro materializado</Badge></dd><dt>Constitución</dt><dd>{fecha(text(res.constitution_date))}</dd><dt>Capital declarado</dt><dd>{numberValue(res.capital) == null ? '—' : formatClp(numberValue(res.capital))}</dd><dt>Vínculos societarios</dt><dd className="mono">{numberValue(res.relationship_count) == null ? '—' : n(numberValue(res.relationship_count))}</dd></dl> : <Empty title={coverageLabel(resCoverage)} hint={data.lifecycle_notes?.res_coverage_note ?? 'El RES sólo cubre sociedades acogidas al régimen simplificado.'} />}</Card></div>;
}

function HistoricoTab({ rows }: { rows: TimelineRow[] }) {
  return <Card title={`Histórico · ${n(rows.length)} hechos`} meta="orden cronológico descendente">{rows.length ? <div className="entity360-history">{rows.map((row) => <article key={row.key} data-kind={row.kind}><div className="entity360-history-date"><i /><time>{fecha(row.date)}</time></div><div className="entity360-history-body"><strong>{row.title}</strong>{(row.source || row.detail) && <p>{[row.source, row.detail].filter(Boolean).join(' · ')}</p>}{row.url && <a href={row.url} target="_blank" rel="noreferrer">Abrir evidencia ↗</a>}</div></article>)}</div> : <Empty title="Sin hechos fechados" />}</Card>;
}

function FuentesTab({ coverage }: { coverage: CoverageRow[] }) {
  return <Card title="Cobertura de fuentes" meta={`${n(coverage.length)} fuentes configuradas`}><div className="entity360-source-grid">{coverage.map((row) => <div className="entity360-source" data-status={coverageStatus(row)} key={row.source_code}><i /><div><strong>{row.source_name}</strong><span>{row.authoritative_source ?? row.source_code}</span></div><Badge tone={coverageStatus(row)}>{coverageLabel(row)}</Badge></div>)}</div></Card>;
}

function Kpi({ icon, label, value, sub, tone = 'neutral', compact = false }: { icon: GlyphName; label: string; value: string; sub: string; tone?: 'neutral' | 'present' | 'critical'; compact?: boolean }) {
  return <div className="entity360-kpi" data-tone={tone}><div className="entity360-kpi-icon"><Glyph name={icon} /></div><div className="entity360-kpi-copy"><span>{label}</span><strong data-compact={compact}>{value}</strong><small>{sub}</small></div></div>;
}

function RegistryTile({ icon, label, status, value, detail }: { icon: GlyphName; label: string; status: 'present' | 'absent' | 'unknown'; value: string; detail: string }) {
  return <div className="entity360-registry" data-status={status}><div className="entity360-registry-icon"><Glyph name={icon} /></div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>;
}

function Card({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return <section className="entity360-card"><header><h2>{title}</h2>{meta && <span>{meta}</span>}</header><div className="entity360-card-body">{children}</div></section>;
}

function Glyph({ name }: { name: GlyphName }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return <svg viewBox="0 0 24 24" aria-hidden>
    {name === 'sales' && <path {...common} d="M4 20V10M10 20V4M16 20v-7M22 20V7" />}
    {name === 'people' && <><circle {...common} cx="9" cy="8" r="3" /><path {...common} d="M3 20c0-4 2.5-6 6-6s6 2 6 6M16 6.5a2.5 2.5 0 1 1 0 5M17 14c2.7.4 4 2.2 4 5" /></>}
    {name === 'activity' && <><path {...common} d="M6 3h9l3 3v15H6z" /><path {...common} d="M15 3v4h4M9 11h6M9 15h6" /></>}
    {name === 'public' && <><path {...common} d="M3 9h18M5 9v9M9 9v9M15 9v9M19 9v9M3 18h18M12 3l9 5H3z" /></>}
    {name === 'sanction' && <><path {...common} d="m14 4 6 6-3 3-6-6zM9 9l6 6-7 5-4-4zM13 17l4 4" /></>}
    {name === 'uaf' && <><path {...common} d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z" /><path {...common} d="M9 12l2 2 4-4" /></>}
    {name === 'osfl' && <><path {...common} d="M12 21V9M7 14c-3 0-4-2-4-5 3 0 5 1 6 4M17 14c3 0 4-2 4-5-3 0-5 1-6 4M12 9c-2-2-2-5 0-7 2 2 2 5 0 7" /></>}
    {name === 'res' && <><rect {...common} x="4" y="4" width="16" height="16" rx="2" /><path {...common} d="M8 8h8M8 12h8M8 16h5" /></>}
    {name === 'press' && <><rect {...common} x="4" y="5" width="16" height="14" rx="2" /><path {...common} d="M8 9h8M8 13h4M14 13h2M8 16h8" /></>}
    {name === 'sii' && <><path {...common} d="M4 20h16M6 20V8h12v12M9 8V4h6v4M9 12h2M13 12h2M9 16h2M13 16h2" /></>}
    {name === 'alert' && <><path {...common} d="M12 3 2.8 20h18.4z" /><path {...common} d="M12 9v5M12 17h.01" /></>}
    {name === 'copy' && <><rect {...common} x="8" y="8" width="11" height="11" rx="2" /><path {...common} d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>}
    {name === 'external' && <><path {...common} d="M14 4h6v6M20 4l-9 9" /><path {...common} d="M18 13v6H5V6h6" /></>}
  </svg>;
}
