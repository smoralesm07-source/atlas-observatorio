from pathlib import Path

PATH = Path('src/views/Territorio.tsx')

REPLACEMENTS = {
    "  candidate_score: number;\n  score_delta: number;":
        "  candidate_score: number;\n  candidate_percentile: number | null;\n  score_delta: number;",
    "  status: 'EXPERIMENTAL';":
        "  status: 'EXPERIMENTAL' | 'RC1';",
    """                <div>\n                  <strong>Confianza v1.1 RC1</strong>\n                  <span>Combina cobertura temática, cobertura temporal, calidad de fuente y estabilidad; la confiabilidad del denominador se muestra aparte y no pondera la confianza.</span>\n                </div>\n                <div>\n                  <strong>Banda v1.1 provisional</strong>\n                  <span>Recalibrada sobre el score candidate.3 congelado en RC1; sigue siendo diagnóstica y no reemplaza el nivel IGR vigente.</span>\n                </div>""":
        """                <div>\n                  <strong>Confianza v1.1 RC1</strong>\n                  <span>Combina cobertura temática, cobertura temporal, calidad de fuente y estabilidad; la confiabilidad del denominador se muestra aparte y no pondera la confianza.</span>\n                </div>\n                <div>\n                  <strong>Percentil nacional RC1</strong>\n                  <span>Posición relativa dentro de las 345 comunas: 100 = extremo superior del score RC1 y 0 = extremo inferior. No es probabilidad ni una segunda fórmula.</span>\n                </div>\n                <div>\n                  <strong>Banda v1.1 provisional</strong>\n                  <span>Contexto secundario de lectura. Cerca de una frontera deben prevalecer el score continuo y el percentil nacional.</span>\n                </div>""",
    """                  El score RC1 es <strong>idéntico a candidate.3</strong>: reemplaza la anomalía transversal por anomalía temporal estabilizada por soporte y combina\n                  volumen con tasa por 100 mil usando contracción en comunas pequeñas. RC1 corrige además la confianza para que el tamaño poblacional\n                  no actúe como proxy de solidez. <strong>El mapa y el ranking oficial siguen usando v1.0.</strong>""":
        """                  El score RC1 es <strong>idéntico a candidate.3</strong>: reemplaza la anomalía transversal por anomalía temporal estabilizada por soporte y combina\n                  volumen con tasa por 100 mil usando contracción en comunas pequeñas. La validación de bandas mostró que ninguna regla categórica mejora\n                  suficientemente la estabilidad sin introducir otros costos; por eso <strong>score + percentil nacional son la lectura primaria RC1</strong> y la banda queda como apoyo secundario.\n                  <strong>El mapa y el ranking oficial siguen usando v1.0.</strong>""",
    "<span>Revisa cuánto cambia el ranking y por qué la nueva confianza sí discrimina entre comunas.</span>":
        "<span>Compara magnitud del score, posición nacional y robustez; la banda queda como contexto secundario.</span>",
    """              <strong>Qué cambió:</strong> RC1 congela el score validado de candidate.3 y corrige la confianza: la confiabilidad del denominador\n              deja de ponderarla para evitar doble penalización y efecto proxy de población. Las bandas recalibradas siguen en\n              diagnóstico y <strong>no se promueven como clasificación oficial</strong>. El score continuo sigue siendo la salida primaria.""":
        """              <strong>Lectura recomendada:</strong> RC1 conserva el score validado y añade el <strong>percentil nacional</strong> para mostrar posición relativa sin crear otra fórmula de amenaza.\n              La banda recalibrada queda como apoyo secundario con alerta de frontera. La histéresis y las bandas puramente relativas fueron descartadas como lectura principal por su dependencia temporal o escasa mejora de estabilidad.""",
    "<thead><tr><th>Comuna</th><th>Región</th><th className=\"right\">IGR v1</th><th className=\"right\">v1.1</th><th>Banda provisional</th><th className=\"right\">Δ score</th><th className=\"right\">Confianza</th></tr></thead>":
        "<thead><tr><th>Comuna</th><th>Región</th><th className=\"right\">IGR v1</th><th className=\"right\">v1.1</th><th className=\"right\">Percentil</th><th>Banda secundaria</th><th className=\"right\">Δ score</th><th className=\"right\">Confianza</th></tr></thead>",
    """                      <td className=\"right num\">{n1(r.candidate_score)}</td>\n                      <td>""":
        """                      <td className=\"right num\">{n1(r.candidate_score)}</td>\n                      <td className=\"right num\">{r.candidate_percentile == null ? '—' : `P${n1(r.candidate_percentile)}`}</td>\n                      <td>""",
    "<Panel title=\"IGR v1.1 RC1\" meta={`${candidate.provisional_level ?? 'sin banda'} · diagnóstico`}":
        "<Panel title=\"IGR v1.1 RC1\" meta={`score + percentil · banda ${candidate.provisional_level ?? '—'}`}",
    """                <div><span>Candidato</span><strong>{n1(candidate.candidate_score)}</strong><small>banda prov. {candidate.provisional_level ?? '—'}</small></div>""":
        """                <div><span>RC1</span><strong>{n1(candidate.candidate_score)}</strong><small>percentil {candidate.candidate_percentile == null ? '—' : n1(candidate.candidate_percentile)}</small></div>""",
    """                <dt>Δ ranking</dt><dd className=\"num\">{candidate.rank_delta > 0 ? '+' : ''}{n(candidate.rank_delta)}</dd>\n                <dt>Banda provisional</dt><dd>{candidate.provisional_level ?? '—'}</dd>""":
        """                <dt>Δ ranking</dt><dd className=\"num\">{candidate.rank_delta > 0 ? '+' : ''}{n(candidate.rank_delta)}</dd>\n                <dt>Percentil nacional RC1</dt><dd className=\"num\">{candidate.candidate_percentile == null ? '—' : `P${n1(candidate.candidate_percentile)}`}</dd>\n                <dt>Banda secundaria</dt><dd>{candidate.provisional_level ?? '—'}</dd>""",
    """                La banda provisional “{candidate.provisional_level ?? '—'}” usa los cortes recalibrados sobre el score congelado de RC1 y sirve sólo como ayuda diagnóstica.\n                {candidate.provisional_boundary_status === 'borderline' && ' Está cerca de una frontera según su estabilidad: conviene priorizar el score continuo y revisar la evidencia antes de interpretar el cambio de banda.'}\n                {' '}No es una clasificación aprobada y no modifica el mapa vigente. El nivel legado “{candidate.candidate_level ?? '—'}” se conserva sólo para comparar con v1.0.""":
        """                La lectura primaria RC1 combina el <strong>score continuo</strong> con el <strong>percentil nacional</strong>. El percentil expresa posición relativa entre comunas y no una probabilidad de LA/FT.\n                La banda “{candidate.provisional_level ?? '—'}” queda como contexto secundario.\n                {candidate.provisional_boundary_status === 'borderline' && ' Está cerca de una frontera según su estabilidad: no debe interpretarse un cambio de etiqueta sin revisar score, percentil y evidencia.'}\n                {' '}No modifica todavía el mapa vigente. El nivel legado “{candidate.candidate_level ?? '—'}” se conserva sólo para comparar con v1.0.""",
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
