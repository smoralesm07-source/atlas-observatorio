from pathlib import Path

p = Path('src/views/universo/CasosAxis.tsx')
s = p.read_text(encoding='utf-8')


def rep(old: str, new: str, label: str):
    global s
    if old not in s:
        raise SystemExit(f'No se encontró patrón: {label}')
    s = s.replace(old, new, 1)

rep(
    "import { useRpcPaged } from '../../lib/rpc';",
    "import { useRpc, useRpcPaged } from '../../lib/rpc';",
    'import useRpc',
)
rep(
    "type SortField = 'score' | 'nombre' | 'sector' | 'region' | 'fecha' | 'marcas' | 'gestion' | 'contacto' | 'materialidad';",
    "type SortField = 'score' | 'nombre' | 'sector' | 'region' | 'fecha' | 'marcas' | 'gestion' | 'contacto' | 'materialidad';\n\ntype OpenContactCoverage = {\n  rut_key: string;\n  finding_count: number;\n  channel_count: number;\n  verified_count: number;\n  probable_count: number;\n  last_observed_at: string | null;\n};\n\nconst contactRutKey = (rut: string) => rut.replace(/[^0-9kK]/g, '').toUpperCase();",
    'tipo cobertura',
)
rep(
    "{ value: 'contacto', label: 'Contacto capturado' },",
    "{ value: 'contacto', label: 'Contacto disponible' },",
    'etiqueta orden contacto',
)
rep(
    "  const [onlyMarks, setOnlyMarks] = useState(false);\n  const [onlyRes, setOnlyRes] = useState(false);",
    "  const [onlyMarks, setOnlyMarks] = useState(false);\n  const [onlyRes, setOnlyRes] = useState(false);\n  const [onlyContact, setOnlyContact] = useState(false);",
    'estado filtro contacto',
)
rep(
    "  }, [queue, potential, term.rows, cases]);\n\n  const options = useMemo(() => {",
    "  }, [queue, potential, term.rows, cases]);\n\n  const contactCoverage = useRpc<OpenContactCoverage[]>('obs_uaf_contact_osint_coverage', {\n    p_ruts: queueRows.map((row) => row.subject.rut),\n  });\n  const contactByRut = useMemo(() => new Map(\n    (contactCoverage.data ?? []).map((item) => [item.rut_key, item] as const),\n  ), [contactCoverage.data]);\n\n  const options = useMemo(() => {",
    'rpc cobertura',
)
rep(
    "      if (onlyMarks && markCount(row.marks) === 0) return false;\n      if (onlyRes && !row.res) return false;\n      return true;",
    "      if (onlyMarks && markCount(row.marks) === 0) return false;\n      if (onlyRes && !row.res) return false;\n      if (onlyContact) {\n        const observed = contactByRut.get(contactRutKey(row.subject.rut));\n        if (contactFilled(row.record.contact) === 0 && Number(observed?.finding_count ?? 0) === 0) return false;\n      }\n      return true;",
    'filtro cobertura',
)
rep(
    "        case 'contacto': return dir * (contactFilled(a.record.contact) - contactFilled(b.record.contact));",
    "        case 'contacto': {\n          const ca = contactByRut.get(contactRutKey(a.subject.rut));\n          const cb = contactByRut.get(contactRutKey(b.subject.rut));\n          const wa = contactFilled(a.record.contact) * 100 + Number(ca?.verified_count ?? 0) * 10 + Number(ca?.channel_count ?? 0) * 2 + Number(ca?.finding_count ?? 0);\n          const wb = contactFilled(b.record.contact) * 100 + Number(cb?.verified_count ?? 0) * 10 + Number(cb?.channel_count ?? 0) * 2 + Number(cb?.finding_count ?? 0);\n          return dir * (wa - wb);\n        }",
    'orden contacto',
)
rep(
    "  }, [queueRows, query, sector, region, gestion, prioridad, banda, year, onlyMarks, onlyRes, sort]);",
    "  }, [queueRows, query, sector, region, gestion, prioridad, banda, year, onlyMarks, onlyRes, onlyContact, sort, contactByRut]);",
    'dependencias filas',
)
rep(
    "          <button className=\"chip\" data-on={onlyMarks} onClick={() => setOnlyMarks(!onlyMarks)}>Con marcas</button>",
    "          <button className=\"chip\" data-on={onlyMarks} onClick={() => setOnlyMarks(!onlyMarks)}>Con marcas</button>\n          <button className=\"chip\" data-on={onlyContact} onClick={() => setOnlyContact(!onlyContact)}>\n            Contacto abierto {contactCoverage.loading && !contactCoverage.data ? '…' : n(contactCoverage.data?.length ?? 0)}\n          </button>",
    'chip contacto',
)
rep(
    "          {(query || sector || region || gestion || prioridad || banda || year || onlyMarks || onlyRes) && (",
    "          {(query || sector || region || gestion || prioridad || banda || year || onlyMarks || onlyRes || onlyContact) && (",
    'condición reset',
)
rep(
    "                setPrioridad(''); setBanda(''); setYear(''); setOnlyMarks(false); setOnlyRes(false);",
    "                setPrioridad(''); setBanda(''); setYear(''); setOnlyMarks(false); setOnlyRes(false); setOnlyContact(false);",
    'reset contacto',
)
rep(
    "                  inLote={lote.has(row.key)} onOpen={() => openCase(row.key)}\n                  onLote={() => toggleLote(row.key)}",
    "                  inLote={lote.has(row.key)} onOpen={() => openCase(row.key)}\n                  onLote={() => toggleLote(row.key)}\n                  openContact={contactByRut.get(contactRutKey(row.subject.rut)) ?? null}",
    'prop cobertura fila',
)
rep(
    "function CaseListRow({\n  row, active, inLote, onOpen, onLote,\n}: {\n  row: CaseRow;\n  active: boolean;\n  inLote: boolean;\n  onOpen: () => void;\n  onLote: () => void;\n}) {\n  const state = STATE_META[row.record.state];\n  const filled = contactFilled(row.record.contact);",
    "function CaseListRow({\n  row, active, inLote, onOpen, onLote, openContact,\n}: {\n  row: CaseRow;\n  active: boolean;\n  inLote: boolean;\n  onOpen: () => void;\n  onLote: () => void;\n  openContact?: OpenContactCoverage | null;\n}) {\n  const state = STATE_META[row.record.state];\n  const filled = contactFilled(row.record.contact);\n  const openFilled = Number(openContact?.finding_count ?? 0);",
    'firma fila',
)
rep(
    "          {filled > 0 && <i className=\"uso-row-contact\" title={`${filled} datos de contacto capturados`}>✆{filled}</i>}",
    "          {filled > 0 && <i className=\"uso-row-contact\" title={`${filled} datos de contacto incorporados a la gestión`}>✆{filled}</i>}\n          {openFilled > 0 && <i className=\"uso-row-contact uso-row-contact-open\" title={`${openFilled} hallazgos de contacto observados en red abierta`}>◎{openFilled}</i>}",
    'badge contacto abierto',
)

p.write_text(s, encoding='utf-8')

css_path = Path('src/styles/universo-contact.css')
css = css_path.read_text(encoding='utf-8')
extra = r'''

/* Disponibilidad de contacto antes de abrir la ficha. */
.uso-row-contact-open {
  border-color: color-mix(in srgb, var(--accent) 34%, var(--line));
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 7%, transparent);
}
'''
if '.uso-row-contact-open {' not in css:
    css_path.write_text(css + extra, encoding='utf-8')

print('Mesa de casos priorizada por contacto abierto')
