from pathlib import Path

path = Path('src/views/PulsoV6.tsx')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f'No se encontró bloque para {label}')
    text = text.replace(old, new, 1)


replace_once(
    "import { NovedadesObservatorio } from './pulso/Novedades';",
    "import { NovedadesObservatorio } from './pulso/Novedades';\nimport { NewEntitiesDirectory } from './pulso/NewEntitiesDirectory';",
    'import directorio',
)

replace_once(
    "  const [directory, setDirectory] = useState<DirectorySelection>({ kind: 'registered', request: ALL });",
    "  const [directory, setDirectory] = useState<DirectorySelection>({ kind: 'registered', request: ALL });\n  const [newEntitiesDirectoryOpen, setNewEntitiesDirectoryOpen] = useState(false);",
    'estado directorio',
)

replace_once(
    "          onSources={() => onNavigate(hrefFor({ view: 'fuentes' }))}\n        />",
    "          onSources={() => onNavigate(hrefFor({ view: 'fuentes' }))}\n          onOpenDirectory={() => setNewEntitiesDirectoryOpen(true)}\n        />",
    'acción abrir directorio',
)

replace_once(
    """      <Semantics>
        <strong>Lectura de Pulso.</strong> Esta pantalla queda deliberadamente como síntesis y puerta de entrada. La reportabilidad sectorial,
        los motivos de revisión, los cambios del stock y los bordes registrales se analizan en Universo SO. Las marcas ordenan revisión y no concluyen incumplimiento ni riesgo LA/FT.
      </Semantics>
    </div>
""",
    """      <Semantics>
        <strong>Lectura de Pulso.</strong> Esta pantalla queda deliberadamente como síntesis y puerta de entrada. La reportabilidad sectorial,
        los motivos de revisión, los cambios del stock y los bordes registrales se analizan en Universo SO. Las marcas ordenan revisión y no concluyen incumplimiento ni riesgo LA/FT.
      </Semantics>

      <NewEntitiesDirectory
        open={newEntitiesDirectoryOpen}
        onClose={() => setNewEntitiesDirectoryOpen(false)}
        onNavigate={onNavigate}
      />
    </div>
""",
    'montaje directorio',
)

replace_once(
    """  onReload,
  onSources,
}: {
""",
    """  onReload,
  onSources,
  onOpenDirectory,
}: {
""",
    'prop directorio firma',
)

replace_once(
    """  onReload: () => void;
  onSources: () => void;
}) {
""",
    """  onReload: () => void;
  onSources: () => void;
  onOpenDirectory: () => void;
}) {
""",
    'prop directorio tipo',
)

replace_once(
    """        <div className=\"p6-new-main\">
          <strong>{n(data.counts.detected_total)}</strong>
          <div className=\"p6-new-copy\">
""",
    """        <div className=\"p6-new-main\">
          <button
            type=\"button\"
            className=\"p6-new-count\"
            onClick={onOpenDirectory}
            aria-label={`Abrir directorio de ${n(data.counts.detected_total)} nuevas entidades detectadas`}
          >
            <strong>{n(data.counts.detected_total)}</strong>
          </button>
          <div className=\"p6-new-copy\">
""",
    'contador clickeable',
)

replace_once(
    """        <div className=\"p6-new-foot\">
          <span className=\"p6-new-latest\" title={latestText}>{latestText}</span>
          <button onClick={onSources}>Fuentes →</button>
        </div>
""",
    """        <div className=\"p6-new-foot\">
          <span className=\"p6-new-latest\" title={latestText}>{latestText}</span>
          <div className=\"p6-new-foot-actions\">
            <button className=\"is-primary\" onClick={onOpenDirectory}>Abrir directorio →</button>
            <button onClick={onSources}>Fuentes</button>
          </div>
        </div>
""",
    'acciones directorio',
)

path.write_text(text, encoding='utf-8')

css_path = Path('src/styles/pulso-new-entities.css')
css = css_path.read_text(encoding='utf-8')
marker = '/* Directorio operativo de altas */'
if marker not in css:
    css += r'''

/* Directorio operativo de altas */
.p6-new-count {
  align-self: end;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.p6-new-count strong {
  display: block;
  font-family: var(--mono);
  font-size: 28px;
  font-weight: 720;
  line-height: .95;
  letter-spacing: -.04em;
  color: var(--accent);
  transition: transform .14s ease, color .14s ease;
}

.p6-new-count:hover strong,
.p6-new-count:focus-visible strong {
  color: color-mix(in srgb, var(--accent) 80%, white);
  transform: translateY(-1px);
}

.p6-new-count:focus-visible {
  outline: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  outline-offset: 3px;
  border-radius: 4px;
}

.p6-new-foot-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
}

.p6-new-foot-actions button.is-primary {
  color: var(--accent);
  font-weight: 680;
}

@media (max-width: 760px) {
  .p6-new-count strong { font-size: 25px; }
}
'''
    css_path.write_text(css, encoding='utf-8')

print('PulsoV6 y estilos integrados con directorio de altas')
