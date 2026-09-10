from pathlib import Path
import re

COMP = Path('src/components/CohortDrawer.tsx')
MAIN = Path('src/main.tsx')

text = COMP.read_text(encoding='utf-8')

# 1) Portal al body: evita que un ancestro transformado convierta position:fixed
#    en relativo al documento y deje la cabecera fuera de la ventana.
if "import { createPortal } from 'react-dom';" not in text:
    text = text.replace(
        "import { useEffect, useMemo, useState } from 'react';\n",
        "import { useEffect, useMemo, useState } from 'react';\nimport { createPortal } from 'react-dom';\n",
        1,
    )

# El detalle pesado desaparece: ya no se necesita el contrato de dossier ni los
# medidores avanzados dentro del listado.
text = text.replace(
    "import { fecha, n, n1, rutFormat, titleCase } from '../lib/format';",
    "import { n, n1, rutFormat, titleCase } from '../lib/format';",
)
text = text.replace("import { RefMeter } from './charts';\n", "")
text = text.replace(
    "  UafCohort, UafDossier, UafDossierSubject, UafMotive, UafSubjectRow,\n",
    "  UafCohort, UafMotive, UafSubjectRow,\n",
)

# Quita helper exclusivo del dossier antiguo.
text = re.sub(
    r"function identityNote\(status: string\): string \{.*?\n\}\n\n",
    "",
    text,
    flags=re.S,
)

# Monta la capa fuera del árbol visual que la invoca.
old_start = "  return (\n    <>\n      <div className=\"drawer-scrim\" onClick={onClose} />"
new_start = "  return createPortal(\n    <>\n      <div className=\"drawer-scrim\" onClick={onClose} />"
if old_start in text:
    text = text.replace(old_start, new_start, 1)

old_end = "      </aside>\n    </>\n  );\n}\n\nfunction Chip"
new_end = "      </aside>\n    </>,\n    document.body,\n  );\n}\n\nfunction Chip"
if old_end in text:
    text = text.replace(old_end, new_end, 1)

# La expansión de una fila deja de disparar un dossier completo y usa sólo la
# información ya cargada para la cohorte.
text = text.replace(
    "      {open && <SubjectDossier rut={s.rut} entityId={s.entity_id} onOpenEntity={onOpenEntity} />}",
    "      {open && <SubjectQuick subject={s} onOpenEntity={onOpenEntity} />}",
)

# Elimina Tile + SubjectDossier (que incluían índices, perfil, peers y rail de
# antecedentes) y los sustituye por una vista rápida. Se asume que ambos están
# al final del archivo, como en el componente vigente.
quick = r'''function SubjectQuick({
  subject: s,
  onOpenEntity,
}: {
  subject: UafSubjectRow;
  onOpenEntity?: (entityId: string) => void;
}) {
  const estado = s.sii_status ? SII_STATE[s.sii_status] : undefined;
  const ipfTone = s.ipf_band ? IPF_TONE[s.ipf_band] ?? 'var(--accent)' : 'var(--ink-4)';
  const ubicacion = s.commune
    ? `${s.commune}${s.region ? ` · ${s.region}` : ''}`
    : s.region ?? 'Sin territorio observado';

  return (
    <div className="subject-quick" role="region" aria-label={`Vista rápida de ${s.name}`}>
      <div className="subject-quick-facts">
        <span className="subject-quick-fact">
          <small>RUT</small>
          <b className="mono">{rutFormat(s.rut)}</b>
        </span>
        <span className="subject-quick-fact">
          <small>Estado SII</small>
          <b style={estado ? { color: estado.tone } : undefined}>{estado?.label ?? 'Sin perfil'}</b>
        </span>
        <span className="subject-quick-fact">
          <small>IPF</small>
          <b className="num" style={{ color: ipfTone }}>
            {s.ipf_score != null ? `${n1(s.ipf_score)} · ${bandaIpf(s.ipf_band) ?? '—'}` : 'Sin medir'}
          </b>
        </span>
        <span className="subject-quick-fact">
          <small>Antigüedad</small>
          <b>{s.activity_years != null ? `${n(s.activity_years)} años` : 'Sin dato'}</b>
        </span>
        <span className="subject-quick-fact subject-quick-location" title={ubicacion}>
          <small>Ubicación</small>
          <b>{ubicacion}</b>
        </span>
      </div>

      <div className="subject-quick-signals" aria-label="Marcas principales">
        {s.attention_motive && (
          <span data-tone="critical">{MOTIVE_LABEL[s.attention_motive] ?? s.attention_motive}</span>
        )}
        {s.sanction_evidence_count > 0 && (
          <span data-tone="high">{n(s.sanction_evidence_count)} sanción{s.sanction_evidence_count === 1 ? '' : 'es'}</span>
        )}
        {s.press_evidence_count > 0 && (
          <span data-tone="watch">{n(s.press_evidence_count)} prensa</span>
        )}
        {s.sii_status === 'TERMINATED_AS_PUBLISHED' && <span data-tone="term">Término de giro</span>}
        {s.is_osfl && <span data-tone="neutral">OSFL</span>}
        {s.is_state_supplier && <span data-tone="present">Proveedor del Estado</span>}
        {!s.attention_motive && s.sanction_evidence_count === 0 && s.press_evidence_count === 0 &&
          s.sii_status !== 'TERMINATED_AS_PUBLISHED' && !s.is_osfl && !s.is_state_supplier && (
            <span data-tone="neutral">Sin marcas adicionales en este corte</span>
          )}
      </div>

      <div className="subject-quick-actions">
        <span>Vista rápida del listado. El expediente completo queda en Entidad 360.</span>
        {s.entity_id && onOpenEntity ? (
          <button className="subject-quick-cta" onClick={() => onOpenEntity(s.entity_id!)}>
            Abrir Entidad 360 →
          </button>
        ) : (
          <span className="subject-quick-unavailable">Sin ficha 360 vinculada</span>
        )}
      </div>
    </div>
  );
}
'''

m = re.search(r"\nfunction Tile\(\{.*\Z", text, flags=re.S)
if m:
    text = text[:m.start()] + "\n" + quick
elif "function SubjectQuick({" not in text:
    raise SystemExit('No se encontró el bloque final del dossier para compactarlo.')

COMP.write_text(text, encoding='utf-8')

main = MAIN.read_text(encoding='utf-8')
imp = "import './styles/cohort-overlay-v2.css';"
if imp not in main:
    anchor = "import './styles/cohort-dense.css';"
    if anchor not in main:
        raise SystemExit('No se encontró la importación de cohort-dense.css en main.tsx')
    main = main.replace(anchor, anchor + "\n" + imp, 1)
    MAIN.write_text(main, encoding='utf-8')
