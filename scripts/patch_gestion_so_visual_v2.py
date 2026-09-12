from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CASES = ROOT / 'src/views/universo/CasosAxis.tsx'
MAIN = ROOT / 'src/main.tsx'

text = CASES.read_text(encoding='utf-8')

charts_markup = r'''

      <section className="uso-navigation-layer" aria-label="Navegación visual de la cola">
        <QueueDistributionChart
          kind="sector"
          eyebrow="Composición de la cola"
          title="Sector económico"
          items={options.sectors}
          selected={sector}
          total={queueRows.length}
          onPick={setSector}
        />
        <QueueDistributionChart
          kind="region"
          eyebrow="Distribución territorial"
          title="Región"
          items={options.regions}
          selected={region}
          total={queueRows.length}
          onPick={setRegion}
        />
      </section>
'''

queue_anchor = """      </section>\n\n      {queue === 'potenciales' && potential?.disponible && ("""
if 'className="uso-navigation-layer"' not in text:
    if queue_anchor not in text:
        raise SystemExit('No se encontró el ancla posterior a uso-queues.')
    text = text.replace(
        queue_anchor,
        "      </section>" + charts_markup + "\n      {queue === 'potenciales' && potential?.disponible && (",
        1,
    )

helper = r'''
type DistributionItem = {
  value: string;
  label: string;
  count: number;
};

function QueueDistributionChart({
  kind, eyebrow, title, items, selected, total, onPick,
}: {
  kind: 'sector' | 'region';
  eyebrow: string;
  title: string;
  items: DistributionItem[];
  selected: string;
  total: number;
  onPick: (value: string) => void;
}) {
  const selectedItem = selected ? items.find((item) => item.value === selected) : undefined;
  const leading = items.slice(0, 5);
  const visible = selectedItem && !leading.some((item) => item.value === selectedItem.value)
    ? [selectedItem, ...leading.slice(0, 4)]
    : leading;
  const peak = Math.max(1, ...visible.map((item) => item.count));
  const denominator = Math.max(1, total);

  return (
    <section className="uso-nav-chart" data-kind={kind} aria-label={`Distribución por ${title.toLowerCase()}`}>
      <header className="uso-nav-chart-head">
        <div className="uso-nav-chart-title">
          <span>{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        {selected && (
          <button className="uso-nav-chart-clear" onClick={() => onPick('')}>
            Limpiar filtro
          </button>
        )}
      </header>

      {visible.length ? (
        <div className="uso-nav-chart-bars">
          {visible.map((item) => {
            const rank = Math.max(1, items.findIndex((candidate) => candidate.value === item.value) + 1);
            const share = Math.round((item.count / denominator) * 100);
            const width = Math.max(item.count > 0 ? 4 : 0, (item.count / peak) * 100);
            const active = selected === item.value;
            return (
              <button
                key={item.value}
                className="uso-nav-chart-row"
                data-on={active}
                aria-pressed={active}
                title={`${item.label}: ${n(item.count)} casos`}
                onClick={() => onPick(active ? '' : item.value)}
              >
                <span className="uso-nav-chart-rank">{String(rank).padStart(2, '0')}</span>
                <span className="uso-nav-chart-main">
                  <strong>{item.label}</strong>
                  <i className="uso-nav-chart-track" aria-hidden>
                    <i style={{ width: `${width}%` }} />
                  </i>
                </span>
                <span className="uso-nav-chart-value">
                  <b className="num">{n(item.count)}</b>
                  <em>{share}%</em>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="uso-nav-chart-empty">Sin datos disponibles en esta cola.</div>
      )}

      <footer className="uso-nav-chart-foot">
        <span><b>{n(items.length)}</b> categorías disponibles</span>
        <span>Selecciona una barra para filtrar la tabla</span>
      </footer>
    </section>
  );
}

'''

helper_anchor = """/* El encuadre de la cola importa —de dónde salen estos casos— pero en una"""
if 'function QueueDistributionChart' not in text:
    if helper_anchor not in text:
        raise SystemExit('No se encontró el ancla previa a ContextPanel.')
    text = text.replace(helper_anchor, helper + helper_anchor, 1)

CASES.write_text(text, encoding='utf-8')

main = MAIN.read_text(encoding='utf-8')
css_import = "import './styles/gestion-so-redesign-v2.css';"
if css_import not in main:
    import_anchor = "import './styles/gestion-so-search-focus-fix.css';"
    if import_anchor not in main:
        raise SystemExit('No se encontró el ancla de estilos de Gestión SO en main.tsx.')
    main = main.replace(import_anchor, import_anchor + "\n" + css_import, 1)
    MAIN.write_text(main, encoding='utf-8')

print('Gestión SO visual v2 aplicada.')
