from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 occurrence, found {count}')
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# Huella pública: consume exactamente el mismo conjunto de coincidencias que
# Entidad 360 y muestra también Contexto / Por revisar, sin llamarlas directas.
# ---------------------------------------------------------------------------
path = 'src/components/HuellaPublicaPress.tsx'
text = read(path)
text = replace_once(
    text,
    "import { searchPress, type PressArticleMatch, type PressMatch } from '../lib/press';",
    "import type { PressMatch } from '../lib/press';\nimport { entityPressArticleRows, pressEvidenceLabel, searchEntityPress, type EntityPressArticle } from '../lib/entityPress';",
    'Huella import',
)
text = replace_once(
    text,
    "type DirectArticle = PressArticleMatch & { match: PressMatch };",
    "type DirectArticle = EntityPressArticle;",
    'Huella article type',
)

# Retira la segunda regla de identidad que hacía divergir Huella de Entidad 360.
text, n = re.subn(
    r"\nfunction compactRut\(value: unknown\) \{.*?\n\}\n\nfunction inPeriod\(",
    "\nfunction inPeriod(",
    text,
    count=1,
    flags=re.S,
)
if n != 1:
    raise RuntimeError(f'Huella direct-only helpers: expected 1 replacement, found {n}')

text, n = re.subn(
    r"\nfunction mergeMatches\(a: PressMatch\[\], b: PressMatch\[\]\) \{.*?\n\}\n\nfunction sourceInitials",
    "\nfunction sourceInitials",
    text,
    count=1,
    flags=re.S,
)
if n != 1:
    raise RuntimeError(f'Huella merge helper: expected 1 replacement, found {n}')

old_search = """      try {
        const byRut = await searchPress(rut, 8, 12);
        let combined = byRut;
        if (directArticles(byRut, rut).length === 0 && name && compactRut(name) !== compactRut(rut) && !/^consultar rut\\b/i.test(name)) {
          const byName = await searchPress(name, 8, 12);
          combined = mergeMatches(byRut, byName);
        }
        if (!cancelled) setState({ status: 'done', matches: combined });
"""
new_search = """      try {
        const combined = await searchEntityPress(name, rut, 10);
        if (!cancelled) setState({ status: 'done', matches: combined });
"""
text = replace_once(text, old_search, new_search, 'Huella shared search')

text = replace_once(
    text,
    "  const allArticles = useMemo(() => directArticles(state.matches, entityRut), [state.matches, entityRut]);",
    "  const allArticles = useMemo(() => entityPressArticleRows(state.matches), [state.matches]);",
    'Huella article rows',
)
text = replace_once(
    text,
    "  const mediaCount = useMemo(() => new Set(periodArticles.map((article) => article.media).filter(Boolean)).size, [periodArticles]);\n  const categories = useMemo(() => new Set(periodArticles.flatMap((article) => topicsFor(article))).size, [periodArticles]);\n  const lastArticle = periodArticles[0] ?? null;",
    "  const lastArticle = periodArticles[0] ?? null;\n  const directCount = periodArticles.filter((article) => article.evidence === 'directa').length;\n  const contextCount = periodArticles.filter((article) => article.evidence === 'contexto').length;\n  const reviewCount = periodArticles.filter((article) => article.evidence === 'revision').length;",
    'Huella evidence counts',
)
text = replace_once(
    text,
    "      : `${periodArticles.length.toLocaleString('es-CL')} ${periodArticles.length === 1 ? 'mención directa' : 'menciones directas'}`;",
    "      : periodArticles.length === 0\n        ? 'Sin coincidencias de prensa'\n        : directCount > 0\n          ? `${periodArticles.length.toLocaleString('es-CL')} coincidencias · ${directCount.toLocaleString('es-CL')} directas`\n          : `${periodArticles.length.toLocaleString('es-CL')} coincidencias de prensa`;",
    'Huella alert label',
)
text = text.replace('Sin menciones en ${fromYear}–${toYear}', 'Sin coincidencias en ${fromYear}–${toYear}')
text = text.replace('Sin menciones directas en {fromYear}–{toYear}.', 'Sin coincidencias de prensa en {fromYear}–{toYear}.')
text = replace_once(
    text,
    "<p>Noticias donde <strong>{entityName}</strong> aparece con identidad resuelta. Se muestran como contexto y no como acreditación del hecho publicado.</p>",
    "<p>Coincidencias asociadas a <strong>{entityName}</strong> con la misma resolución de identidad usada por Entidad 360. Atlas distingue coincidencia directa, contexto y casos que requieren corroboración.</p>",
    'Huella drawer copy',
)
text = replace_once(
    text,
    """            <div><i>◎</i><span><strong>{periodArticles.length.toLocaleString('es-CL')}</strong><small>Menciones directas</small></span></div>
            <div><i>▣</i><span><strong>{mediaCount.toLocaleString('es-CL')}</strong><small>Medios distintos</small></span></div>
            <div><i>◇</i><span><strong>{categories.toLocaleString('es-CL')}</strong><small>Categorías relevantes</small></span></div>
            <div><i>▦</i><span><strong>{lastArticle ? dateLabel(lastArticle.date) : '—'}</strong><small>Última mención</small></span></div>""",
    """            <div><i>◎</i><span><strong>{periodArticles.length.toLocaleString('es-CL')}</strong><small>Coincidencias</small></span></div>
            <div><i>●</i><span><strong>{directCount.toLocaleString('es-CL')}</strong><small>Directas</small></span></div>
            <div><i>◇</i><span><strong>{(contextCount + reviewCount).toLocaleString('es-CL')}</strong><small>Contexto / revisar</small></span></div>
            <div><i>▦</i><span><strong>{lastArticle ? dateLabel(lastArticle.date) : '—'}</strong><small>Última mención</small></span></div>""",
    'Huella drawer metrics',
)
text = replace_once(
    text,
    "{state.status === 'done' && articles.length === 0 && <div className=\"state-press-empty\"><span>○</span><div><strong>Sin menciones directas en {fromYear}–{toYear}</strong><p>{allArticles.length > 0 ? `Radar Prensa registra ${allArticles.length.toLocaleString('es-CL')} coincidencia${allArticles.length === 1 ? '' : 's'} directa${allArticles.length === 1 ? '' : 's'} fuera del período seleccionado.` : 'No se encontraron coincidencias suficientemente resueltas para mostrarlas automáticamente en Huella pública.'}</p></div></div>}",
    "{state.status === 'done' && articles.length === 0 && <div className=\"state-press-empty\"><span>○</span><div><strong>Sin coincidencias de prensa en {fromYear}–{toYear}</strong><p>{allArticles.length > 0 ? `Radar Prensa registra ${allArticles.length.toLocaleString('es-CL')} coincidencia${allArticles.length === 1 ? '' : 's'} fuera del período seleccionado.` : 'Entidad 360 y Huella pública no registran coincidencias periodísticas para esta entidad en el índice vigente.'}</p></div></div>}",
    'Huella empty state',
)
text = replace_once(
    text,
    "return <article key={article.id} className=\"state-press-drawer-row\" data-relevance={relevance === 'Alta relevancia' ? 'high' : 'medium'}>",
    "return <article key={article.id} className=\"state-press-drawer-row\" data-relevance={relevance === 'Alta relevancia' ? 'high' : 'medium'} data-evidence={article.evidence}>",
    'Huella evidence row',
)
text = replace_once(
    text,
    "<div className=\"state-press-drawer-meta\"><time>{dateLabel(article.date)}</time><span>·</span><span>{article.media || 'Prensa abierta'}</span></div>",
    "<div className=\"state-press-drawer-meta\"><span className=\"state-press-evidence\" data-kind={article.evidence}>{pressEvidenceLabel(article.evidence)}</span><time>{dateLabel(article.date)}</time><span>·</span><span>{article.media || 'Prensa abierta'}</span></div>",
    'Huella evidence pill',
)
text = replace_once(
    text,
    "<footer className=\"state-press-rule\"><strong>Regla de lectura.</strong> Una noticia acredita una publicación asociada a la entidad, no la veracidad del hecho ni responsabilidad. Huella pública muestra sólo coincidencias directas; contexto de grupo y casos por revisar permanecen en Entidad 360.</footer>",
    "<footer className=\"state-press-rule\"><strong>Regla de lectura.</strong> Huella pública y Entidad 360 utilizan la misma resolución de Radar Prensa. Una noticia acredita una publicación asociada, no la veracidad del hecho ni responsabilidad. Las coincidencias de contexto y por revisar se distinguen explícitamente para evitar atribuciones automáticas.</footer>",
    'Huella governance footer',
)
write(path, text)


# ---------------------------------------------------------------------------
# Entidad 360: reemplaza su resolvedor local por el resolvedor compartido.
# El comportamiento de búsqueda se mantiene, pero deja una única fuente de verdad.
# ---------------------------------------------------------------------------
path = 'src/views/EntityExpediente.tsx'
text = read(path)
text = replace_once(
    text,
    "import { searchPressDossier, type PressMatch } from '../lib/press';",
    "import type { PressMatch } from '../lib/press';\nimport { searchEntityPress } from '../lib/entityPress';",
    'Entity360 press import',
)
text, n = re.subn(
    r"\nfunction compactRut\(value: string \| null \| undefined\): string \{.*?\n\}\n",
    "\n",
    text,
    count=1,
    flags=re.S,
)
if n != 1:
    raise RuntimeError(f'Entity360 compactRut: expected 1 replacement, found {n}')
text, n = re.subn(
    r"\nfunction strictPressMatches\(entity: EntityDetail\['entity'\], matches: PressMatch\[\]\): PressMatch\[\] \{.*?\n\}\n\nfunction timelineFor",
    "\nfunction timelineFor",
    text,
    count=1,
    flags=re.S,
)
if n != 1:
    raise RuntimeError(f'Entity360 strictPressMatches: expected 1 replacement, found {n}')
text = replace_once(
    text,
    """        let matches = strictPressMatches(entity, await searchPressDossier(entity.name, 10));
        if (!matches.length && entity.rut) matches = strictPressMatches(entity, await searchPressDossier(entity.rut, 10));
        if (!cancelled) setPress({ status: 'done', matches });""",
    """        const matches = await searchEntityPress(entity.name, entity.rut, 10);
        if (!cancelled) setPress({ status: 'done', matches });""",
    'Entity360 shared search',
)
write(path, text)


# ---------------------------------------------------------------------------
# Construir muestra conserva un criterio deliberadamente más estricto: su marca
# viene de atlas_press_entity_link materializado. El nombre lo hace explícito.
# ---------------------------------------------------------------------------
path = 'src/views/HuellaSampleBuilder.tsx'
text = read(path)
text = replace_once(
    text,
    "{ code: 'PRESS', label: 'Presencia en prensa' },",
    "{ code: 'PRESS', label: 'Prensa resuelta' },",
    'Sample PRESS label',
)
write(path, text)


# ---------------------------------------------------------------------------
# Etiquetas de evidencia en el drawer de Huella.
# ---------------------------------------------------------------------------
path = 'src/styles/huella-publica-press.css'
text = read(path)
marker = '/* Coherencia prensa Entidad 360 ↔ Huella pública */'
if marker not in text:
    text += """

/* Coherencia prensa Entidad 360 ↔ Huella pública */
.state-press-evidence{display:inline-flex;align-items:center;min-height:18px;padding:2px 6px;border:1px solid var(--line);border-radius:999px;font-size:7.6px;font-weight:760;line-height:1;white-space:nowrap;background:var(--surface-1,var(--panel));color:var(--ink-3)}
.state-press-evidence[data-kind='directa']{border-color:color-mix(in srgb,#0f8aa8 28%,var(--line));background:color-mix(in srgb,#0f8aa8 7%,var(--panel));color:#08738d}
.state-press-evidence[data-kind='contexto']{border-color:color-mix(in srgb,#d97706 28%,var(--line));background:color-mix(in srgb,#d97706 7%,var(--panel));color:#a85b05}
.state-press-evidence[data-kind='revision']{border-color:color-mix(in srgb,var(--ink-3) 28%,var(--line));background:var(--surface-2,#f4f5f6);color:var(--ink-3)}
"""
write(path, text)

print('Press coherence patch applied successfully.')
