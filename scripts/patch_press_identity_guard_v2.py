from pathlib import Path

PATH = Path("src/lib/press.ts")
text = PATH.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if new in text:
        print(f"{label}: ya aplicado")
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: se esperaba 1 bloque origen y se encontraron {count}")
    text = text.replace(old, new, 1)
    print(f"{label}: aplicado")


replace_once(
    """  'consultora', 'consultores', 'fundacion', 'corporacion', 'asociacion',\n  'organizacion', 'instituto',\n]);""",
    """  'consultora', 'consultores', 'fundacion', 'corporacion', 'asociacion',\n  'organizacion', 'instituto',\n  // Descriptores de actividad frecuentes que no individualizan por sí solos\n  // una razón social. Evita atribuir noticias sólo porque el texto habla de\n  // \"proyectos inmobiliarios\" u otros conceptos sectoriales genéricos.\n  'proyecto', 'proyectos', 'inmobiliario', 'inmobiliaria', 'inmobiliarios', 'inmobiliarias',\n]);""",
    "tokens genéricos inmobiliarios",
)

replace_once(
    """function distinctiveTokens(value: string): string[] {\n  const tokens = nameTokens(value);\n  const distinctive = tokens.filter((token) => token.length >= 3 && !GENERIC_ENTITY_TOKENS.has(token));\n  if (distinctive.length) return distinctive;\n  return tokens.filter((token) => token.length >= 4);\n}""",
    """function distinctiveTokens(value: string): string[] {\n  const tokens = nameTokens(value);\n  // Si una razón social está compuesta sólo por descriptores genéricos, no\n  // inventamos un token distintivo. En ese caso la evidencia automática debe\n  // venir de RUT, alias curado o de la frase societaria contigua en el artículo.\n  return tokens.filter((token) => token.length >= 3 && !GENERIC_ENTITY_TOKENS.has(token));\n}""",
    "tokens distintivos conservadores",
)

replace_once(
    """function hasLegalForm(queryText: string): boolean {\n  return /(^| )(spa|ltda|limitada|eirl)( |$)/.test(queryText)\n    || /(^| )s a( |$)/.test(queryText);\n}""",
    """function hasLegalForm(queryText: string): boolean {\n  return /(^| )(spa|ltda|limitada|eirl)( |$)/.test(queryText)\n    || /(^| )s a( |$)/.test(queryText);\n}\n\nfunction corporateCoreName(queryText: string): string {\n  return queryText\n    .replace(/\\s+(spa|ltda|limitada|eirl|sa|s a)$/, '')\n    .replace(/\\s+/g, ' ')\n    .trim();\n}\n\nfunction articleIdentityFields(article: PressArticle): string[] {\n  // search_terms sirve para descubrir una noticia, no para demostrar que la\n  // entidad fue mencionada. La identidad se acredita sólo con texto publicado.\n  return [article.title, article.summary]\n    .map(normalizePressText)\n    .filter(Boolean);\n}\n\nfunction articleHasIdentityPhrase(queryText: string, article: PressArticle): boolean {\n  const fields = articleIdentityFields(article);\n  const core = corporateCoreName(queryText);\n  if (!core || core.length < 6) return fields.some((field) => field.includes(queryText));\n  return fields.some((field) => field.includes(queryText) || field.includes(core));\n}""",
    "frase societaria contigua",
)

replace_once(
    """function scoreArticle(queryText: string, article: PressArticle): number {\n  const fields = [article.title, article.summary, ...(article.search_terms ?? [])]\n    .map(normalizePressText)\n    .filter(Boolean);\n  const required = distinctiveTokens(queryText);\n  const titleTokens = new Set(nameTokens(normalizePressText(article.title)));\n  const safeDistinctiveMatch = hasLegalForm(queryText)\n    && required.length > 0\n    && required.every((token) => titleTokens.has(token))\n    && articleHasCorporateContext(article);\n\n  let best = safeDistinctiveMatch ? 0.96 : 0;\n  fields.forEach((field) => {\n    if (field === queryText) best = Math.max(best, 1);\n    else if (field.includes(queryText)) best = Math.max(best, 0.98);\n    else if (tokenPrefixMatch(queryText, field)) best = Math.max(best, 0.90);\n  });\n  return best;\n}""",
    """function scoreArticle(queryText: string, article: PressArticle): number {\n  const fields = articleIdentityFields(article);\n  const required = distinctiveTokens(queryText);\n  const titleTokens = new Set(nameTokens(normalizePressText(article.title)));\n  const exactIdentityPhrase = articleHasIdentityPhrase(queryText, article);\n  const safeDistinctiveMatch = hasLegalForm(queryText)\n    && required.length > 0\n    && required.every((token) => titleTokens.has(token))\n    && articleHasCorporateContext(article);\n\n  // Una razón social puramente descriptiva (p. ej. \"Administradora de\n  // Proyectos Inmobiliarios S.A.\") sólo puede entrar por frase societaria\n  // contigua. Nunca por suma de palabras dispersas ni por search_terms.\n  let best = exactIdentityPhrase ? 0.99 : safeDistinctiveMatch ? 0.96 : 0;\n  fields.forEach((field) => {\n    if (field === queryText) best = Math.max(best, 1);\n    else if (field.includes(queryText)) best = Math.max(best, 0.99);\n    else if (required.length > 0 && tokenPrefixMatch(queryText, field)) best = Math.max(best, 0.90);\n  });\n  return best;\n}""",
    "score de artículo",
)

replace_once(
    """function articleSupportsIdentity(queryText: string, article: PressArticle): boolean {\n  const fields = [article.title, article.summary, ...(article.search_terms ?? [])]\n    .map(normalizePressText)\n    .filter(Boolean);\n  if (!fields.length) return false;\n  if (fields.some((field) => field.includes(queryText))) return true;\n\n  const required = distinctiveTokens(queryText);\n  if (!required.length) return false;\n  const articleTokens = new Set(fields.flatMap((field) => nameTokens(field)));\n  return required.every((token) => articleTokens.has(token));\n}""",
    """function articleSupportsIdentity(queryText: string, article: PressArticle): boolean {\n  const fields = articleIdentityFields(article);\n  if (!fields.length) return false;\n  if (articleHasIdentityPhrase(queryText, article)) return true;\n\n  const required = distinctiveTokens(queryText);\n  if (!required.length) return false;\n  const articleTokens = new Set(fields.flatMap((field) => nameTokens(field)));\n  return required.every((token) => articleTokens.has(token));\n}""",
    "evidencia textual de identidad",
)

# Invariantes del cambio: search_terms no puede volver a ser evidencia de
# identidad y la familia inmobiliaria debe permanecer en el vocabulario genérico.
for token in ("'proyecto'", "'proyectos'", "'inmobiliario'", "'inmobiliarios'"):
    if token not in text:
        raise SystemExit(f"Falta token conservador {token}")

score_slice = text[text.index("function scoreArticle"):text.index("function articleSupportsIdentity")]
support_slice = text[text.index("function articleSupportsIdentity"):text.index("function articleHasExactToken")]
if "search_terms" in score_slice or "search_terms" in support_slice:
    raise SystemExit("search_terms sigue participando como evidencia de identidad")

PATH.write_text(text, encoding="utf-8")
print("Guardia de identidad de prensa v2 lista.")
