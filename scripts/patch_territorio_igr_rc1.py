from pathlib import Path

PATH = Path('src/views/Territorio.tsx')

REPLACEMENTS = {
    "IGR = amenaza territorial comunal · 86% vigente = cobertura metodológica · confianza v1.1 = evaluación experimental de solidez.":
        "IGR = amenaza territorial comunal · 86% vigente = cobertura metodológica · confianza RC1 = robustez de la estimación, separada del tamaño poblacional.",
    "<strong>Confianza v1.1 · experimental</strong>":
        "<strong>Confianza v1.1 RC1</strong>",
    "<span>Varía por comuna según cobertura temática/temporal, fuente, estabilidad y denominador.</span>":
        "<span>Combina cobertura temática, cobertura temporal, calidad de fuente y estabilidad; la confiabilidad del denominador se muestra aparte y no pondera la confianza.</span>",
    "<span>Recalibrada para candidate.3; sirve para diagnóstico y no reemplaza el nivel IGR vigente.</span>":
        "<span>Recalibrada sobre el score candidate.3 congelado en RC1; sigue siendo diagnóstica y no reemplaza el nivel IGR vigente.</span>",
    "La confianza experimental nunca modifica el score ni transforma menor evidencia en menor amenaza.":
        "La confianza RC1 nunca modifica el score ni transforma menor evidencia en menor amenaza. La confiabilidad del denominador continúa visible, pero ya no entra al compuesto de confianza porque su efecto ya está incorporado al contraer el peso de la tasa.",
    "<span className=\"territory-method-kicker\">8 · Evaluación experimental v1.1</span>":
        "<span className=\"territory-method-kicker\">8 · Validación RC1 · v1.1</span>",
    "<div><span>Sesgo población</span><strong>{n1(cmp.sesgo_poblacion_candidate)}</strong><small>vigente {n1(cmp.sesgo_poblacion_vigente)}</small></div>":
        "<div><span>Asociación score-población</span><strong>{n1(cmp.sesgo_poblacion_candidate)}</strong><small>vigente {n1(cmp.sesgo_poblacion_vigente)}</small></div>",
    "El candidate.3 reemplaza la anomalía transversal por <strong>anomalía temporal estabilizada por soporte</strong>, combina\n                  volumen y tasa por 100 mil con contracción del peso de tasa en comunas pequeñas, y calcula una\n                  confianza comunal separada del IGR. <strong>El mapa y el ranking oficial siguen usando v1.0.</strong>":
        "El score RC1 es <strong>idéntico a candidate.3</strong>: reemplaza la anomalía transversal por anomalía temporal estabilizada por soporte y combina\n                  volumen con tasa por 100 mil usando contracción en comunas pequeñas. RC1 corrige además la confianza para que el tamaño poblacional\n                  no actúe como proxy de solidez. <strong>El mapa y el ranking oficial siguen usando v1.0.</strong>",
    "label=\"Confianza v1.1 · experimental\"":
        "label=\"Confianza v1.1 RC1\"",
    "<strong>Comparar IGR vigente vs candidato v1.1</strong>":
        "<strong>Comparar IGR vigente vs v1.1 RC1</strong>",
    "<span className=\"territory-candidate-badge\">Experimental · mapa vigente intacto</span>":
        "<span className=\"territory-candidate-badge\">{cmp.candidate_version ?? 'v1.1 RC1'} · mapa vigente intacto</span>",
    "<strong>Qué cambió:</strong> anomalía temporal estabilizada según soporte; intensidad con volumen + tasa\n              estabilizada; confianza separada en cinco dimensiones. Candidate.3 incorpora bandas recalibradas para\n              diagnóstico, pero <strong>no las promueve como clasificación oficial</strong>. El score continuo sigue siendo la salida primaria.":
        "<strong>Qué cambió:</strong> RC1 congela el score validado de candidate.3 y corrige la confianza: la confiabilidad del denominador\n              deja de ponderarla para evitar doble penalización y efecto proxy de población. Las bandas recalibradas siguen en\n              diagnóstico y <strong>no se promueven como clasificación oficial</strong>. El score continuo sigue siendo la salida primaria.",
    "<Panel title=\"IGR v1.1 · experimental\" meta={`${candidate.provisional_level ?? 'sin banda'} · diagnóstico`}":
        "<Panel title=\"IGR v1.1 RC1\" meta={`${candidate.provisional_level ?? 'sin banda'} · diagnóstico`}",
    "La banda provisional “{candidate.provisional_level ?? '—'}” usa los cortes recalibrados de candidate.3 y sirve sólo como ayuda diagnóstica.":
        "La banda provisional “{candidate.provisional_level ?? '—'}” usa los cortes recalibrados sobre el score congelado de RC1 y sirve sólo como ayuda diagnóstica.",
}


def main() -> None:
    text = PATH.read_text(encoding='utf-8')
    missing = [old for old in REPLACEMENTS if old not in text]
    if missing:
        raise SystemExit('No se encontraron reemplazos esperados:\n- ' + '\n- '.join(missing))
    for old, new in REPLACEMENTS.items():
        text = text.replace(old, new, 1)
    PATH.write_text(text, encoding='utf-8')


if __name__ == '__main__':
    main()
