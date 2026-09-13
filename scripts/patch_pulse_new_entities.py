from pathlib import Path

path = Path('src/views/PulsoV6.tsx')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f'No se encontró bloque para {label}')
    text = text.replace(old, new, 1)


replace_once(
    "import '../styles/pulso-v6.css';",
    "import '../styles/pulso-v6.css';\nimport '../styles/pulso-new-entities.css';",
    'import css',
)

replace_once(
    "const ALL: CohortRequest = { cohort: 'TODOS', title: 'Padrón completo de sujetos obligados' };\n",
    """const ALL: CohortRequest = { cohort: 'TODOS', title: 'Padrón completo de sujetos obligados' };

interface NewEntitiesDigest {
  contract: 'ATLAS_OBS_NEW_ENTITIES_V1';
  window_days: number;
  reference_date: string | null;
  staleness_days: number | null;
  counts: {
    detected_total: number;
    res_constitutions: number;
    sii_activity_starts: number;
    source_overlap: number;
    visible_in_atlas: number;
    outside_visible: number;
  };
  sources: {
    res: { latest_event_date: string | null; cutoff_date: string | null };
    sii: { latest_event_date: string | null };
  };
  latest: {
    rut: string;
    name: string;
    event_date: string;
    sources: string[];
    entity_id: string | null;
    visible_in_atlas: boolean;
  }[];
  semantics: string;
}
""",
    'contrato nuevas entidades',
)

replace_once(
    """  const { data, error, loading, reload } = useRpc<UafPulse>('obs_uaf_pulse', {});
  const [directory, setDirectory] = useState<DirectorySelection>({ kind: 'registered', request: ALL });
""",
    """  const { data, error, loading, reload } = useRpc<UafPulse>('obs_uaf_pulse', {});
  const {
    data: newEntities,
    error: newEntitiesError,
    loading: newEntitiesLoading,
    reload: reloadNewEntities,
  } = useRpc<NewEntitiesDigest>('obs_new_entities_digest', {});
  const [directory, setDirectory] = useState<DirectorySelection>({ kind: 'registered', request: ALL });
""",
    'hook nuevas entidades',
)

text = text.replace('  const scr = data.screening;\n', '', 1)

old_row_one = """      <section className=\"p6-row-one\">
        <div className=\"p6-panel\">
          <div className=\"p6-insight\">
            <strong>{n(scr?.corte?.universo_declarado)}</strong>
            <b>Universo observable fuera del padrón</b>
            <p>
              Equivale a {n1((scr?.corte?.universo_declarado ?? 0) / Math.max(1, u.total))} veces el padrón. La coincidencia por giro orienta conciliación y no prueba obligación de inscripción.
            </p>
            <button onClick={() => onNavigate(hrefFor({ view: 'universo', mode: 'casos', cola: 'potenciales' }))}>Abrir potenciales SO →</button>
          </div>
        </div>

        <MiniPanel title=\"Distribución por estado\" action=\"Universo SO →\" onAction={() => onNavigate(hrefFor({ view: 'universo' }))}>
          <div className=\"p6-status-total\">{n(u.total)}</div>
          <div className=\"p6-status-track\">
            {status.map((row) => <button key={row.key} data-s={row.key} style={{ width: `${percent(row.value, u.total)}%` }} title={`${row.label}: ${n(row.value)}`} onClick={() => setCohort(row.request)} />)}
          </div>
          <div className=\"p6-status-legend\">
            {status.map((row) => (
              <button key={row.key} onClick={() => setCohort(row.request)}>
                <i style={{ background: row.tone }} /><span>{row.label}</span><b>{n(row.value)}</b>
              </button>
            ))}
          </div>
        </MiniPanel>

        <MiniPanel title=\"Distribución territorial\" action=\"Territorio →\" onAction={() => onNavigate(hrefFor({ view: 'territorio' }))}>
          <div className=\"p6-ranks\">
            {topRegions.map((row) => (
              <RankRow key={row.region} label={titleCase(row.region)} value={row.sujetos} max={maxRegion}
                onClick={() => setCohort({ cohort: 'REGION', value: row.region, title: `Sujetos obligados en ${titleCase(row.region)}` })} />
            ))}
          </div>
          <p className=\"p6-note\">{n(u.con_territorio)} sujetos con territorio observado.</p>
        </MiniPanel>
      </section>
"""

new_row_one = """      <section className=\"p6-row-one\">
        <NewEntitiesInsight
          data={newEntities}
          loading={newEntitiesLoading}
          error={newEntitiesError}
          onReload={reloadNewEntities}
          onSources={() => onNavigate(hrefFor({ view: 'fuentes' }))}
        />

        <MiniPanel title=\"Distribución por estado\" action=\"Universo SO →\" onAction={() => onNavigate(hrefFor({ view: 'universo' }))}>
          <div className=\"p6-status-total\">{n(u.total)}</div>
          <div className=\"p6-status-track\">
            {status.map((row) => <button key={row.key} data-s={row.key} style={{ width: `${percent(row.value, u.total)}%` }} title={`${row.label}: ${n(row.value)}`} onClick={() => setCohort(row.request)} />)}
          </div>
          <div className=\"p6-status-legend\">
            {status.map((row) => (
              <button key={row.key} onClick={() => setCohort(row.request)}>
                <i style={{ background: row.tone }} /><span>{row.label}</span><b>{n(row.value)}</b>
              </button>
            ))}
          </div>
        </MiniPanel>

        <NovedadesObservatorio compact />
      </section>
"""
replace_once(old_row_one, new_row_one, 'fila superior de Pulso')

old_row_two = """      <section className=\"p6-row-two\">
        <MiniPanel title=\"Evolución publicada del padrón\" action=\"Universo SO →\" onAction={() => onNavigate(hrefFor({ view: 'universo' }))}>
          {trend.length > 1 ? <MiniLine points={trend} /> : <div className=\"p6-note\">Sin serie histórica suficiente.</div>}
        </MiniPanel>

        <MiniPanel title=\"Principales sectores\" action=\"Universo SO →\" onAction={() => onNavigate(hrefFor({ view: 'universo' }))}>
          <div className=\"p6-ranks\">
            {topSectors.map((row) => (
              <RankRow key={row.sector} label={titleCase(row.sector)} value={row.sujetos} max={maxSector}
                onClick={() => setCohort({ cohort: 'SECTOR', value: row.sector, title: titleCase(row.sector) })} />
            ))}
          </div>
          <p className=\"p6-note\">Selecciona un sector para filtrar el directorio.</p>
        </MiniPanel>

        <NovedadesObservatorio compact />
      </section>
"""

new_row_two = """      <section className=\"p6-row-two\">
        <MiniPanel title=\"Evolución publicada del padrón\" action=\"Universo SO →\" onAction={() => onNavigate(hrefFor({ view: 'universo' }))}>
          {trend.length > 1 ? <MiniLine points={trend} /> : <div className=\"p6-note\">Sin serie histórica suficiente.</div>}
        </MiniPanel>

        <MiniPanel title=\"Principales sectores\" action=\"Universo SO →\" onAction={() => onNavigate(hrefFor({ view: 'universo' }))}>
          <div className=\"p6-ranks\">
            {topSectors.map((row) => (
              <RankRow key={row.sector} label={titleCase(row.sector)} value={row.sujetos} max={maxSector}
                onClick={() => setCohort({ cohort: 'SECTOR', value: row.sector, title: titleCase(row.sector) })} />
            ))}
          </div>
          <p className=\"p6-note\">Selecciona un sector para filtrar el directorio.</p>
        </MiniPanel>

        <MiniPanel title=\"Distribución territorial\" action=\"Territorio →\" onAction={() => onNavigate(hrefFor({ view: 'territorio' }))}>
          <div className=\"p6-ranks\">
            {topRegions.map((row) => (
              <RankRow key={row.region} label={titleCase(row.region)} value={row.sujetos} max={maxRegion}
                onClick={() => setCohort({ cohort: 'REGION', value: row.region, title: `Sujetos obligados en ${titleCase(row.region)}` })} />
            ))}
          </div>
          <p className=\"p6-note\">{n(u.con_territorio)} sujetos con territorio observado.</p>
        </MiniPanel>
      </section>
"""
replace_once(old_row_two, new_row_two, 'fila secundaria de Pulso')

component = r'''
function NewEntitiesInsight({
  data,
  loading,
  error,
  onReload,
  onSources,
}: {
  data: NewEntitiesDigest | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onSources: () => void;
}) {
  if (loading && !data) {
    return (
      <section className="p6-panel p6-new-entities-panel">
        <div className="p6-new-entities">
          <div className="p6-new-top"><span>Altas de fuente · 30 días disponibles</span></div>
          <div className="p6-new-state">Leyendo constituciones RES e inicios SII…</div>
        </div>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="p6-panel p6-new-entities-panel">
        <div className="p6-new-entities">
          <div className="p6-new-top">
            <span>Altas de fuente</span>
            <button className="p6-new-refresh" onClick={onReload} aria-label="Reintentar lectura de nuevas entidades">↻</button>
          </div>
          <div className="p6-new-state is-error">No fue posible leer las altas recientes.</div>
        </div>
      </section>
    );
  }

  if (!data) return null;

  const latest = data.latest?.[0] ?? null;
  const latestText = latest
    ? `Entre las últimas: ${latest.name} · ${latest.sources.join(' + ')} · ${compactDate(latest.event_date)}`
    : 'Sin ejemplos recientes disponibles.';

  return (
    <section className="p6-panel p6-new-entities-panel">
      <div className="p6-new-entities">
        <div className="p6-new-top">
          <span>Altas de fuente · {data.window_days} días disponibles · cobertura {compactDate(data.reference_date)}</span>
          <button className="p6-new-refresh" onClick={onReload} disabled={loading} aria-label="Actualizar nuevas entidades" title="Actualizar ahora">
            {loading ? '…' : '↻'}
          </button>
        </div>

        <div className="p6-new-main">
          <strong>{n(data.counts.detected_total)}</strong>
          <div className="p6-new-copy">
            <b>Nuevas entidades detectadas</b>
            <p>Constituciones RES o inicios SII en los 30 días más recientes cubiertos. SII puede corresponder a una empresa ya constituida.</p>
          </div>
        </div>

        <div className="p6-new-metrics" aria-label="Composición de altas recientes">
          <div className="p6-new-metric"><span>Constituidas RES</span><b>{n(data.counts.res_constitutions)}</b></div>
          <div className="p6-new-metric"><span>Inicio SII</span><b>{n(data.counts.sii_activity_starts)}</b></div>
          <div className="p6-new-metric"><span>Ya en Atlas</span><b>{n(data.counts.visible_in_atlas)}</b></div>
        </div>

        <div className="p6-new-foot">
          <span className="p6-new-latest" title={latestText}>{latestText}</span>
          <button onClick={onSources}>Fuentes →</button>
        </div>
      </div>
    </section>
  );
}

function compactDate(value: string | null | undefined) {
  if (!value) return '—';
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}
'''

replace_once('\nfunction Kpi(', '\n' + component + '\nfunction Kpi(', 'componente nuevas entidades')

path.write_text(text, encoding='utf-8')
print('PulsoV6.tsx actualizado')
