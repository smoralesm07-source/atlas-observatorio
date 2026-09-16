from pathlib import Path


path = Path("src/views/ReportesDirectivosV2.tsx")
text = path.read_text(encoding="utf-8")

source_block = """  const sourceMap = new Map<string, Point>();
  ['dotacion_efectiva_total','entidades_reportantes_total','ros_recibidos','roe_recibidos_miles','ros_con_indicios_laft','informes_inteligencia_financiera','requerimientos_ministerio_publico','personas_en_requerimientos_mp','actividades_economicas_obligadas'].forEach((metric) => {
    (d.series[metric] ?? []).forEach((p) => { if (p.source_url) sourceMap.set(p.source_url, p); });
  });
  const sources = Array.from(sourceMap.values());

"""

section_block = """      <section className=\"report-section report-page-break\">
        <div className=\"report-section-heading\"><span>09</span><div><h3>Fuentes y cortes</h3><p>Cada serie conserva fuente, fecha de corte y método de captura.</p></div></div>
        <div className=\"dbv2-method\"><p><strong>Cálculo.</strong> Las cifras, variaciones y gráficos se construyen de forma determinística desde series trazadas.</p><p><strong>Cortes.</strong> El padrón y la dotación pueden tener fechas distintas; el informe conserva la fecha de cada serie.</p><p><strong>Redacción.</strong> La síntesis generativa, cuando se utiliza, recibe sólo cifras previamente validadas y no reemplaza los cálculos.</p></div>
        <ol className=\"dbv2-sources\">{sources.map((p) => <li key={p.source_url ?? ''}><a href={p.source_url ?? '#'} target=\"_blank\" rel=\"noreferrer\">{p.source_url}</a><span>{p.as_of_date ?? 's/d'} · {p.capture_method ?? 's/d'}</span></li>)}</ol>
      </section>
"""

changed = False

if source_block in text:
    text = text.replace(source_block, "", 1)
    changed = True

if section_block in text:
    text = text.replace(section_block, "", 1)
    changed = True

if "Fuentes y cortes" in text:
    raise SystemExit('No fue posible retirar completamente la sección "Fuentes y cortes".')
if "const sources = Array.from(sourceMap.values());" in text:
    raise SystemExit("Quedó código auxiliar de fuentes sin retirar.")

if changed:
    path.write_text(text, encoding="utf-8")
    print('Sección "Fuentes y cortes" eliminada del informe activo de Atlas.')
else:
    print('La sección "Fuentes y cortes" ya no está presente; no hay cambios que aplicar.')
