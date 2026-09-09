from pathlib import Path

CONTRACTS = Path('src/lib/contracts.ts')
TERRITORIO = Path('src/views/Territorio.tsx')
MAP = Path('src/components/ChileMap.tsx')


def patch_contracts() -> None:
    text = CONTRACTS.read_text(encoding='utf-8')
    text = text.replace(
        '  anomaly?: number;\n  years_observed?: number;',
        '  anomaly?: number;\n  temporal_anomaly?: number;\n  years_observed?: number;',
        1,
    )
    text = text.replace(
        '  igr_score: number | null;\n  igr_level: string | null;\n  igr_confidence: number | null;',
        '  igr_score: number | null;\n  igr_percentile: number | null;\n  igr_level: string | null;\n  igr_confidence: number | null;\n  igr_methodological_coverage: number | null;\n  igr_confidence_level: string | null;\n  igr_boundary_status: string | null;\n  igr_boundary_distance: number | null;',
        1,
    )
    text = text.replace(
        '    confianza_media: number | null;\n    baja_confianza: number;\n    anio: number | null;',
        '    confianza_media: number | null;\n    baja_confianza: number;\n    cobertura_metodologica_media?: number | null;\n    cobertura_incompleta?: number;\n    anio: number | null;',
        1,
    )
    text = text.replace(
        '    igr_score: number | null;\n    igr_level: string | null;\n    igr_confidence: number | null;\n    ctx_entities: number;',
        '    igr_score: number | null;\n    igr_percentile: number | null;\n    igr_level: string | null;\n    igr_confidence: number | null;\n    igr_methodological_coverage: number | null;\n    igr_confidence_level: string | null;\n    igr_boundary_status: string | null;\n    igr_boundary_distance: number | null;\n    ctx_entities: number;',
        1,
    )
    # TerritoryCommune: segunda ocurrencia de la misma secuencia base.
    old = '  igr_score: number | null;\n  igr_level: string | null;\n  igr_confidence: number | null;\n  ctx_entities: number;'
    new = '  igr_score: number | null;\n  igr_percentile: number | null;\n  igr_level: string | null;\n  igr_confidence: number | null;\n  igr_methodological_coverage: number | null;\n  igr_confidence_level: string | null;\n  igr_boundary_status: string | null;\n  igr_boundary_distance: number | null;\n  ctx_entities: number;'
    if old not in text:
        raise RuntimeError('No se encontró TerritoryCommune para extender')
    text = text.replace(old, new, 1)
    CONTRACTS.write_text(text, encoding='utf-8')


def patch_map() -> None:
    text = MAP.read_text(encoding='utf-8')
    text = text.replace(
        "{row?.igr_score != null ? ` · IGR ${n1(row.igr_score)} · ${row.igr_level}` : ' · sin dato'}",
        "{row?.igr_score != null ? ` · IGR ${n1(row.igr_score)} · P${n1(row.igr_percentile)} · ${row.igr_level}` : ' · sin dato'}",
        1,
    )
    old = '''          <div className="map-tip-v">\n            <i style={{ background: `var(--igr-${levelStep(row.igr_level)})` }} />\n            <span className="num">{n1(row.igr_score)}</span> · {row.igr_level}\n          </div>\n          <div className="map-tip-c">\n            padrón UAF <span className="num">{row.ctx_uaf_observed}</span> ·\n            entidades <span className="num">{row.ctx_entities}</span>\n          </div>'''
    new = '''          <div className="map-tip-v">\n            <i style={{ background: `var(--igr-${levelStep(row.igr_level)})` }} />\n            <span className="num">IGR {n1(row.igr_score)}</span> · P{n1(row.igr_percentile)}\n          </div>\n          <div className="map-tip-c">\n            {row.igr_level ?? 'sin banda'} · confianza <span className="num">{n1(row.igr_confidence)}%</span>\n          </div>\n          <div className="map-tip-c">\n            padrón UAF <span className="num">{row.ctx_uaf_observed}</span> ·\n            entidades <span className="num">{row.ctx_entities}</span>\n          </div>'''
    if old not in text:
        raise RuntimeError('No se encontró tooltip del mapa')
    text = text.replace(old, new, 1)
    MAP.write_text(text, encoding='utf-8')


def patch_territorio() -> None:
    text = TERRITORIO.read_text(encoding='utf-8')

    # El comparador deja de ser superficie principal: el IGR promovido ya vive en obs_territory.
    start = text.find('interface TerritoryIgrComparisonRow {')
    end = text.find('export function Territorio', start)
    if start < 0 or end < 0:
        raise RuntimeError('No se encontró bloque de tipos de comparación')
    text = text[:start] + text[end:]

    text = text.replace("  const { data: igrCompare } = useRpc<TerritoryIgrComparison>('obs_territory_igr_comparison', {});\n", '', 1)
    start = text.find('  const candidateById = useMemo(')
    end = text.find('\n\n  if (commune)', start)
    if start < 0 or end < 0:
        raise RuntimeError('No se encontró bloque candidateById')
    text = text[:start] + text[end:]
    text = text.replace('        candidate={candidateById.get(commune) ?? null}\n', '', 1)
    text = text.replace('  const cmp = igrCompare?.summary;\n', '', 1)

    text = text.replace(
        'IGR = amenaza territorial comunal · 86% vigente = cobertura metodológica · confianza RC1 = robustez de la estimación, separada del tamaño poblacional.',
        'IGR = amenaza territorial comunal · score + percentil nacional = lectura principal · confianza = robustez de la estimación.',
        1,
    )
    text = text.replace(
        '''                El IGR vigente es <strong>{m.indicador} {m.version.replace(/^IGR-/, '')}</strong>. La fórmula y\n                los pesos se leen desde el contrato metodológico vigente, de modo que esta ayuda se mantiene\n                sincronizada con el cálculo publicado.''',
        '''                La fórmula y los pesos se leen desde el contrato metodológico vigente. El <strong>score 0–100</strong> expresa magnitud\n                de amenaza observada y el <strong>percentil nacional</strong> sitúa a cada comuna frente al resto del país sin crear una segunda fórmula.''',
        1,
    )

    # Sustituye las tarjetas de lectura/validación por la lectura productiva, sin versiones visibles.
    start = text.find('            <section className="territory-method-card territory-method-card-wide">\n              <span className="territory-method-kicker">7 · Qué puede discriminar el analista hoy</span>')
    end = text.find('          </div>\n        </div>\n      </details>', start)
    if start < 0 or end < 0:
        raise RuntimeError('No se encontró sección metodológica 7/8')
    replacement = '''            <section className="territory-method-card territory-method-card-wide">\n              <span className="territory-method-kicker">7 · Cómo leer el IGR</span>\n              <div className="territory-read-grid">\n                <div>\n                  <strong>IGR · score</strong>\n                  <span>Magnitud de amenaza territorial observada en escala 0–100. Es la señal principal.</span>\n                </div>\n                <div>\n                  <strong>Percentil nacional</strong>\n                  <span>Posición relativa entre las comunas: P100 corresponde al extremo superior y P0 al inferior. No es probabilidad.</span>\n                </div>\n                <div>\n                  <strong>Confianza</strong>\n                  <span>Robustez de la estimación según cobertura temática, temporal, calidad de fuente y estabilidad. No modifica el score.</span>\n                </div>\n                <div>\n                  <strong>Banda</strong>\n                  <span>Apoyo secundario de lectura. Cerca de una frontera deben prevalecer score, percentil y evidencia.</span>\n                </div>\n                <div>\n                  <strong>Cobertura metodológica</strong>\n                  <span>Documenta cuánto del catálogo está materializado. No equivale a confianza ni a menor amenaza.</span>\n                </div>\n              </div>\n              <p className="territory-method-muted">\n                El IGR describe el territorio. Ninguno de estos elementos atribuye conducta, incumplimiento o probabilidad de LA/FT a una entidad domiciliada en la comuna.\n              </p>\n            </section>\n'''
    text = text[:start] + replacement + text[end:]

    # KPI superiores: confianza y cobertura pasan a tener semántica productiva.
    start = text.find('      <div className="grid grid-4" style={{ marginBottom: 16 }}>')
    end = text.find('      {/* El mapa reemplazó', start)
    if start < 0 or end < 0:
        raise RuntimeError('No se encontró bloque KPI/comparador')
    kpis = '''      <div className="grid grid-4" style={{ marginBottom: 16 }}>\n        <Stat label="Comunas evaluadas" value={n(cob.comunas)} foot={`año ${cob.anio ?? '—'}`} />\n        <Stat\n          label="Con universo observado"\n          value={n(cob.con_universo)}\n          foot={`${n(cob.comunas - cob.con_universo)} sin entidades en el corte`}\n        />\n        <Stat\n          label="Confianza IGR"\n          value={cob.confianza_media == null ? '—' : `${n1(cob.confianza_media)}%`}\n          foot={`${n(cob.baja_confianza)} comunas bajo el umbral medio de robustez`}\n        />\n        <Stat\n          label="Cobertura metodológica"\n          value={cob.cobertura_metodologica_media == null ? '—' : `${n1(cob.cobertura_metodologica_media)}%`}\n          foot="disponibilidad del catálogo · no es confianza"\n        />\n      </div>\n\n'''
    text = text[:start] + kpis + text[end:]

    text = text.replace('<Panel title="Distribución por nivel" meta={`${n(cob.comunas)} comunas`}>', '<Panel title="Distribución por banda" meta={`${n(cob.comunas)} comunas`}>', 1)

    text = text.replace(
        '<th>Comuna</th><th>Región</th><th>Nivel</th>\n              <th className="right">IGR</th><th className="right">Cobertura</th>\n              <th className="right">Entidades</th><th className="right">Padrón UAF</th>',
        '<th>Comuna</th><th>Región</th><th>Banda</th>\n              <th className="right">IGR</th><th className="right">Percentil</th>\n              <th className="right">Confianza</th><th className="right">Padrón UAF</th>',
        1,
    )
    text = text.replace(
        '''                <td className="right num" style={{ fontWeight: 650 }}>{n1(c.igr_score)}</td>\n                <td className="right num" style={{ color: 'var(--ink-3)' }}>{n1(c.igr_confidence)}%</td>\n                <td className="right num">{n(c.ctx_entities)}</td>\n                <td className="right num">{n(c.ctx_uaf_observed)}</td>''',
        '''                <td className="right num" style={{ fontWeight: 650 }}>{n1(c.igr_score)}</td>\n                <td className="right num" style={{ fontWeight: 650 }}>{c.igr_percentile == null ? '—' : `P${n1(c.igr_percentile)}`}</td>\n                <td className="right num" style={{ color: 'var(--ink-3)' }}>{n1(c.igr_confidence)}%</td>\n                <td className="right num">{n(c.ctx_uaf_observed)}</td>''',
        1,
    )
    text = text.replace(
        "          {m.excluido_del_indice.join(', ')}. Desde {m.version} el territorio se separó del\n",
        "          {m.excluido_del_indice.join(', ')}. El territorio se mantiene separado del\n",
        1,
    )

    # Detalle comunal consume ya el IGR principal, sin candidato ni versión visible.
    text = text.replace(
        '''function ComunaDetalle({\n  territoryId, candidate, onBack, onNavigate,\n}: {\n  territoryId: string;\n  candidate: TerritoryIgrComparisonRow | null;''',
        '''function ComunaDetalle({\n  territoryId, onBack, onNavigate,\n}: {\n  territoryId: string;''',
        1,
    )
    text = text.replace("            <span className=\"mono\">{t.score_version ? `CEAD ${t.score_version}` : ''}</span>\n", '', 1)

    start = text.find('        <div className="ficha-scores">')
    end = text.find('        </div>\n      </header>', start)
    if start < 0 or end < 0:
        raise RuntimeError('No se encontró ficha-scores')
    scores = '''        <div className="ficha-scores">\n          <div style={{ minWidth: 126, padding: '12px 15px', borderRadius: 'var(--radius)', background: 'var(--bg-panel)', border: '1px solid var(--line)' }}>\n            <div className="num" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.035em', color: `var(--igr-${levelStep(t.igr_level)})` }}>\n              {n1(t.igr_score)}\n            </div>\n            <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 650, marginTop: 3 }}>IGR</div>\n            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>banda {t.igr_level ?? '—'}</div>\n          </div>\n          <div style={{ minWidth: 126, padding: '12px 15px', borderRadius: 'var(--radius)', background: 'var(--bg-panel)', border: '1px solid var(--line)' }}>\n            <div className="num" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.035em' }}>\n              {t.igr_percentile == null ? '—' : `P${n1(t.igr_percentile)}`}\n            </div>\n            <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 650, marginTop: 3 }}>Percentil nacional</div>\n            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>posición {n(p.posicion_nacional)} de {n(p.comunas_pais)}</div>\n          </div>\n          <div style={{ minWidth: 126, padding: '12px 15px', borderRadius: 'var(--radius)', background: 'var(--bg-panel)', border: '1px solid var(--line)' }}>\n            <div className="num" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.035em' }}>\n              {t.igr_confidence == null ? '—' : `${n1(t.igr_confidence)}%`}\n            </div>\n            <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 650, marginTop: 3 }}>Confianza</div>\n            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>{t.igr_confidence_level ?? 'robustez no clasificada'}</div>\n          </div>\n          <div style={{ minWidth: 118, padding: '12px 15px', borderRadius: 'var(--radius)', background: 'var(--bg-panel)', border: '1px solid var(--line)' }}>\n            <div className="num" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.035em' }}>{n(p.posicion_en_region)}</div>\n            <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 650, marginTop: 3 }}>en su región</div>\n            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3 }}>de {n(p.comunas_region)} · media {n1(p.igr_region)}</div>\n          </div>\n'''
    text = text[:start] + scores + text[end:]

    start = text.find('          {candidate && (')
    end = text.find('\n\n          <Panel title="Universo observado aquí"', start)
    if start < 0 or end < 0:
        raise RuntimeError('No se encontró panel candidato del detalle')
    reading = '''          <Panel title="Lectura IGR" meta={`banda ${t.igr_level ?? '—'} · contexto secundario`}>\n            <dl className="kv">\n              <dt>IGR</dt><dd className="num">{n1(t.igr_score)}</dd>\n              <dt>Percentil nacional</dt><dd className="num">{t.igr_percentile == null ? '—' : `P${n1(t.igr_percentile)}`}</dd>\n              <dt>Confianza</dt><dd className="num">{t.igr_confidence == null ? '—' : `${n1(t.igr_confidence)}%`} {t.igr_confidence_level ? `· ${t.igr_confidence_level}` : ''}</dd>\n              <dt>Banda</dt><dd>{t.igr_level ?? '—'}</dd>\n              <dt>Lectura de frontera</dt><dd>{t.igr_boundary_status === 'borderline' ? 'Cerca de frontera' : t.igr_boundary_status === 'stable_relative_to_thresholds' ? 'Estable respecto de cortes' : '—'}</dd>\n              <dt>Distancia a frontera</dt><dd className="num">{t.igr_boundary_distance == null ? '—' : n1(t.igr_boundary_distance)}</dd>\n              <dt>Cobertura metodológica</dt><dd className="num">{t.igr_methodological_coverage == null ? '—' : `${n1(t.igr_methodological_coverage)}%`}</dd>\n            </dl>\n            <div className="note" style={{ marginTop: 12 }}>\n              Score y percentil son la lectura principal. La confianza informa robustez y la banda ayuda a resumir, pero una comuna cercana a frontera debe interpretarse con el valor continuo y la evidencia disponible. El IGR describe el territorio y no atribuye riesgo a sus entidades.\n            </div>\n          </Panel>'''
    text = text[:start] + reading + text[end:]

    text = text.replace('<td className="right num">{n1(c.anomaly)}</td>', '<td className="right num">{n1(c.temporal_anomaly ?? c.anomaly)}</td>', 1)
    text = text.replace('                    <th className="right">Anomalía</th>', '                    <th className="right">Anomalía temporal</th>', 1)

    text = text.replace("  const altas = filas.filter((c) => (c.igr_score ?? 0) >= 60).length;", "  const altas = filas.filter((c) => ['Alto', 'Muy alto'].includes(c.igr_level ?? '')).length;", 1)
    text = text.replace(' · {n(altas)} en nivel Alto o superior · padrón UAF', ' · {n(altas)} en banda Alta o Muy alta · padrón UAF', 1)
    text = text.replace('        Cada franja tiene su propia escala y la cifra bajo cada paso es el número de comunas.\n        El agregado regional es una media comunal simple; la cobertura metodológica se publica aparte', '        Cada franja tiene su propia escala y la cifra bajo cada paso es el número de comunas. Las bandas son una ayuda secundaria: score y percentil son la lectura principal.\n        El agregado regional es una media comunal simple; la cobertura metodológica se publica aparte', 1)

    # Ninguna referencia de versión/candidato debe quedar en la superficie pública.
    forbidden = ['v1.1', 'RC1', 'candidate', 'Candidate']
    visible = [token for token in forbidden if token in text]
    if visible:
        raise RuntimeError('Persisten referencias experimentales en Territorio.tsx: ' + ', '.join(visible))

    TERRITORIO.write_text(text, encoding='utf-8')


if __name__ == '__main__':
    patch_contracts()
    patch_map()
    patch_territorio()
