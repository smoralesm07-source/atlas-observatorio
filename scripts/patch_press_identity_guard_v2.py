from pathlib import Path

PATH = Path("src/lib/press.ts")
text = PATH.read_text(encoding="utf-8")

required_snippets = [
    "'proyecto', 'proyectos', 'inmobiliario', 'inmobiliaria', 'inmobiliarios', 'inmobiliarias'",
    "function corporateCoreName(queryText: string): string",
    "function articleIdentityFields(article: PressArticle): string[]",
    "function articleHasIdentityPhrase(queryText: string, article: PressArticle): boolean",
    "const exactIdentityPhrase = articleHasIdentityPhrase(queryText, article);",
    "const strongEntityIdentity = kind === 'RUT'",
    "(kind === 'EXACTA' && distinctiveTokens(queryText).length > 0)",
]

for snippet in required_snippets:
    if snippet not in text:
        raise SystemExit(f"Falta guardia esperada: {snippet}")

score_slice = text[text.index("function scoreArticle"):text.index("function articleSupportsIdentity")]
support_slice = text[text.index("function articleSupportsIdentity"):text.index("function articleHasExactToken")]
if "search_terms" in score_slice or "search_terms" in support_slice:
    raise SystemExit("search_terms sigue participando como evidencia de identidad")

# Regresión que motivó el cambio: una razón social puramente descriptiva no
# puede resolverse sólo porque una noticia contenga las palabras sectoriales
# «proyectos inmobiliarios». La única vía textual automática es la frase
# societaria contigua; RUT y alias curados mantienen precedencia autoritativa.
if "return tokens.filter((token) => token.length >= 3 && !GENERIC_ENTITY_TOKENS.has(token));" not in text:
    raise SystemExit("distinctiveTokens volvió a fabricar anclas desde descriptores genéricos")
if "return [article.title, article.summary]" not in text:
    raise SystemExit("la evidencia de identidad debe provenir de título/resumen")

print("Guardia de identidad de prensa v2 verificada.")
