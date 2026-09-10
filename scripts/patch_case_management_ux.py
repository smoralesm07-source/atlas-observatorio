from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(rel: str, old: str, new: str, marker: str | None = None) -> None:
    path = ROOT / rel
    text = path.read_text(encoding='utf-8')
    if marker and marker in text:
        return
    if old not in text:
        raise SystemExit(f'No se encontró bloque esperado en {rel}: {old[:100]!r}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


# 1) Ciclo de vida: finalización explícita + devolución trazable al universo.
replace_once(
    'src/lib/casework.ts',
    "  | 'CONTACTADO'\n  | 'SIN_UBICAR'\n  | 'DESCARTADO';",
    "  | 'CONTACTADO'\n  | 'FINALIZADO'\n  | 'DEVUELTO'\n  | 'SIN_UBICAR'\n  | 'DESCARTADO';",
    "| 'FINALIZADO'",
)
replace_once(
    'src/lib/casework.ts',
    "  { key: 'CONTACTADO', label: 'Contactado', short: 'Contactado', tone: 'var(--present)', step: 3 },\n  { key: 'SIN_UBICAR',",
    "  { key: 'CONTACTADO', label: 'Contactado', short: 'Contactado', tone: 'var(--present)', step: 3 },\n  { key: 'FINALIZADO', label: 'Finalizado', short: 'Finalizado', tone: 'var(--present)', step: 4 },\n  { key: 'DEVUELTO', label: 'Devuelto al universo', short: 'Revisado antes', tone: 'var(--ink-3)', step: 0 },\n  { key: 'SIN_UBICAR',",
    "label: 'Devuelto al universo'",
)
replace_once(
    'src/lib/casework.ts',
    "export const isTracked = (record: CaseRecord) =>\n  record.state !== 'SIN_TRABAJAR'\n  || record.note.trim().length > 0\n  || contactFilled(record.contact) > 0;",
    "export const isTracked = (record: CaseRecord) =>\n  record.state !== 'DEVUELTO' && (\n    record.state !== 'SIN_TRABAJAR'\n    || record.note.trim().length > 0\n    || contactFilled(record.contact) > 0\n  );",
    "record.state !== 'DEVUELTO' &&",
)
replace_once(
    'src/lib/casework.ts',
    "    r.contact.fuente,\n    r.note.replace(/\\s+/g, ' ').trim(),\n    r.updatedAt,",
    "    r.contact.fuente,\n    r.assignedName ?? '',\n    r.assignedEmail ?? '',\n    r.assignedAt ?? '',\n    r.contactedAt ?? '',\n    r.note.replace(/\\s+/g, ' ').trim(),\n    r.updatedAt,",
    "r.assignedName ?? '',",
)

# 2) Ficha: liberación, trazabilidad visible y cierre exitoso sólo tras contacto.
replace_once(
    'src/views/universo/CaseFile.tsx',
    "  const tracked = isTracked(record);\n  const locked = tracked && record.isMine === false;\n  const canEdit = tracked && !locked;\n  const owner = record.assignedName || record.assignedEmail || null;",
    "  const tracked = isTracked(record);\n  const released = record.state === 'DEVUELTO';\n  const finalized = record.state === 'FINALIZADO';\n  const locked = tracked && record.isMine === false;\n  const canEdit = tracked && !locked && !finalized;\n  const owner = record.assignedName || record.assignedEmail || null;",
    "const released = record.state === 'DEVUELTO';",
)
replace_once(
    'src/views/universo/CaseFile.tsx',
    "              <span className=\"uso-kicker\">Disponible para gestión</span>\n              <b>Nadie está atendiendo este caso</b>\n              <em>Al tomarlo saldrá de la cola pendiente y el equipo verá que quedó asignado a ti.</em>\n            </div>\n            <button className=\"btn btn-sm btn-primary\" onClick={() => onPatch({ state: 'EN_UBICACION' })}>Tomar caso</button>",
    "              <span className=\"uso-kicker\">{released ? 'Disponible nuevamente' : 'Disponible para gestión'}</span>\n              <b>{released ? 'Devuelto al universo sin gestión activa' : 'Nadie está atendiendo este caso'}</b>\n              <em>{released && owner\n                ? `Revisado antes por ${owner}${record.updatedAt ? ` · devuelto ${desde(record.updatedAt)}` : ''}. La traza se conserva.`\n                : 'Al tomarlo saldrá de la cola pendiente y el equipo verá que quedó asignado a ti.'}</em>\n            </div>\n            <button className=\"btn btn-sm btn-primary\" onClick={() => onPatch({ state: 'EN_UBICACION' })}>{released ? 'Retomar caso' : 'Tomar caso'}</button>",
    "Disponible nuevamente",
)
replace_once(
    'src/views/universo/CaseFile.tsx',
    "              const done = meta.step <= state.step && record.state !== 'DESCARTADO' && record.state !== 'SIN_UBICAR';",
    "              const done = meta.step <= state.step && record.state !== 'DESCARTADO' && record.state !== 'SIN_UBICAR' && record.state !== 'DEVUELTO';",
    "record.state !== 'DEVUELTO';",
)
replace_once(
    'src/views/universo/CaseFile.tsx',
    "          </div>\n\n          <div className=\"uso-priority\" role=\"group\" aria-label=\"Prioridad del caso\">",
    "          </div>\n\n          <div className=\"uso-case-resolution\" data-finalized={finalized ? 'true' : undefined}>\n            <div>\n              <span className=\"uso-kicker\">Cierre de la gestión</span>\n              <b>{finalized ? 'Gestión finalizada' : 'Resultado del caso'}</b>\n              <em>{finalized\n                ? `Contacto logrado${record.contactedAt ? ` · ${fecha(record.contactedAt)}` : ''}. El caso queda cerrado en la mesa.`\n                : record.state === 'CONTACTADO'\n                  ? 'El contacto ya fue registrado. Marca Finalizado cuando la gestión haya concluido exitosamente.'\n                  : 'Finalizar se habilita sólo después de registrar que hubo contacto. También puedes devolver el caso al universo sin gestión activa.'}</em>\n            </div>\n            {!finalized && (\n              <div className=\"uso-case-resolution-actions\">\n                <button\n                  className=\"btn btn-sm btn-primary uso-finalize\"\n                  disabled={!canEdit || record.state !== 'CONTACTADO'}\n                  onClick={() => onPatch({ state: 'FINALIZADO' })}\n                  title={record.state !== 'CONTACTADO' ? 'Primero registra el estado Contactado' : 'Cerrar la gestión como exitosa'}\n                >\n                  Finalizar gestión\n                </button>\n                <button\n                  className=\"btn btn-sm uso-release\"\n                  disabled={!canEdit}\n                  onClick={() => {\n                    if (window.confirm('El caso volverá al universo sin gestión activa. Se conservará la traza de esta revisión. ¿Continuar?')) {\n                      onPatch({ state: 'DEVUELTO' });\n                    }\n                  }}\n                >\n                  Devolver al universo\n                </button>\n              </div>\n            )}\n          </div>\n\n          <div className=\"uso-priority\" role=\"group\" aria-label=\"Prioridad del caso\">",
    "className=\"uso-case-resolution\"",
)

# 3) Contactabilidad: una recomendación de contacto confiable y selección explícita.
replace_once(
    'src/views/universo/OpenContactPanel.tsx',
    "const statusRank = (status: string | null) => status === 'VERIFICADO' ? 3 : status === 'PROBABLE' ? 2 : 1;",
    "const statusRank = (status: string | null) => status === 'VERIFICADO' ? 3 : status === 'PROBABLE' ? 2 : 1;\n\nconst isReliable = (contact: OpenContact) =>\n  contact.verification_status === 'VERIFICADO'\n  || (contact.verification_status === 'PROBABLE'\n    && Number(contact.confidence_pct ?? 0) >= 85\n    && Number(contact.evidence_count ?? 0) >= 2);",
    "const isReliable = (contact: OpenContact)",
)
replace_once(
    'src/views/universo/OpenContactPanel.tsx',
    "  const channels = new Set(items.map((item) => item.contact_type)).size;\n  const verified = items.filter((item) => item.verification_status === 'VERIFICADO').length;",
    "  const channels = new Set(items.map((item) => item.contact_type)).size;\n  const verified = items.filter((item) => item.verification_status === 'VERIFICADO').length;\n  const recommended = items.find((item) => isReliable(item) && ['TELEFONO', 'EMAIL', 'DIRECCION'].includes(item.contact_type))\n    ?? items.find(isReliable)\n    ?? null;",
    "const recommended = items.find",
)
replace_once(
    'src/views/universo/OpenContactPanel.tsx',
    "  function adopt(contact: OpenContact) {\n    const field = FIELD_BY_TYPE[contact.contact_type];\n    if (!field) return;",
    "  function adopt(contact: OpenContact) {\n    const field = FIELD_BY_TYPE[contact.contact_type];\n    if (!field) return;\n    if (!isReliable(contact)) {\n      setMessage('Valida este hallazgo o confirma evidencia suficiente antes de usarlo como medio de contacto.');\n      return;\n    }",
    "Valida este hallazgo o confirma evidencia suficiente",
)
replace_once(
    'src/views/universo/OpenContactPanel.tsx',
    "      </div>\n\n      {(contacts.error || localError) && (",
    "      </div>\n\n      {recommended && (() => {\n        const field = FIELD_BY_TYPE[recommended.contact_type];\n        const selected = Boolean(field && row.record.contact[field] === recommended.contact_value);\n        return (\n          <div className=\"uso-open-primary\" data-selected={selected ? 'true' : undefined}>\n            <span className=\"uso-open-primary-glyph\" aria-hidden>{TYPE_GLYPH[recommended.contact_type] ?? '·'}</span>\n            <div>\n              <span className=\"uso-kicker\">Dato confiable disponible</span>\n              <b>{TYPE_LABEL[recommended.contact_type] ?? recommended.contact_type}: {recommended.contact_value}</b>\n              <em>{recommended.source_label || host(recommended.source_url) || 'fuente abierta'} · {STATUS_LABEL[recommended.verification_status ?? 'NO_VERIFICADO'] ?? 'No verificado'} · {n1(Number(recommended.confidence_pct ?? 0))}% confianza</em>\n            </div>\n            {field && !readOnly && (\n              <button className=\"btn btn-sm btn-primary\" disabled={selected} onClick={() => adopt(recommended)}>\n                {selected ? 'Medio seleccionado' : 'Usar como medio de contacto'}\n              </button>\n            )}\n          </div>\n        );\n      })()}\n\n      {(contacts.error || localError) && (",
    "className=\"uso-open-primary\"",
)
replace_once(
    'src/views/universo/OpenContactPanel.tsx',
    "            const preview = previews[contact.contact_id];\n            return (",
    "            const preview = previews[contact.contact_id];\n            const reliable = isReliable(contact);\n            const selected = Boolean(field && row.record.contact[field] === contact.contact_value);\n            return (",
    "const reliable = isReliable(contact);",
)
replace_once(
    'src/views/universo/OpenContactPanel.tsx',
    "                  {field && !readOnly && <button className=\"uso-open-use\" onClick={() => adopt(contact)}>Usar</button>}",
    "                  {field && !readOnly && (\n                    <button\n                      className=\"uso-open-use\"\n                      data-reliable={reliable ? 'true' : undefined}\n                      disabled={!reliable || selected}\n                      title={!reliable ? 'Valida el hallazgo o exige al menos 85% de confianza con dos evidencias' : undefined}\n                      onClick={() => adopt(contact)}\n                    >\n                      {selected ? 'Seleccionado' : 'Usar como contacto'}\n                    </button>\n                  )}",
    "{selected ? 'Seleccionado' : 'Usar como contacto'}",
)

# 4) Grilla: responsable explícito y navegación coherente al devolver un caso.
replace_once(
    'src/views/universo/CasosAxis.tsx',
    "                onPatch(active, patch);\n                if (claim) window.requestAnimationFrame(() => changeQueue('cartera'));",
    "                onPatch(active, patch);\n                if (patch.state === 'DEVUELTO') {\n                  window.requestAnimationFrame(() => changeQueue(active.kind === 'TERMINO' ? 'termino' : 'potenciales'));\n                } else if (claim) {\n                  window.requestAnimationFrame(() => changeQueue('cartera'));\n                }",
    "patch.state === 'DEVUELTO'",
)
replace_once(
    'src/views/universo/CasosAxis.tsx',
    "                {STATES.map((meta) => <option key={meta.key} value={meta.key}>{meta.label}</option>)}",
    "                {STATES.filter((meta) => !['SIN_TRABAJAR', 'FINALIZADO', 'DEVUELTO'].includes(meta.key)).map((meta) => <option key={meta.key} value={meta.key}>{meta.label}</option>)}",
    "!['SIN_TRABAJAR', 'FINALIZADO', 'DEVUELTO'].includes(meta.key)",
)
replace_once(
    'src/views/universo/CasosAxis.tsx',
    "              {row.record.isMine ? 'Tú' : (row.record.assignedName || row.record.assignedEmail.split('@')[0])}",
    "              {row.record.state === 'DEVUELTO'\n                ? `Revisó: ${row.record.isMine ? 'tú' : (row.record.assignedName || row.record.assignedEmail.split('@')[0])}`\n                : `Gestiona: ${row.record.isMine ? 'tú' : (row.record.assignedName || row.record.assignedEmail.split('@')[0])}`}",
    "? `Revisó: ${row.record.isMine ? 'tú'",
)

# 5) Ficha rápida reutilizable: gestionar términos de giro sin entrar primero a Entidad 360.
replace_once(
    'src/components/CohortDrawer.tsx',
    "  const ubicacion = s.commune\n    ? `${s.commune}${s.region ? ` · ${s.region}` : ''}`\n    : s.region ?? 'Sin territorio observado';",
    "  const ubicacion = s.commune\n    ? `${s.commune}${s.region ? ` · ${s.region}` : ''}`\n    : s.region ?? 'Sin territorio observado';\n  const manageable = s.sii_status === 'TERMINATED_AS_PUBLISHED' || Boolean(s.sii_termination_date);",
    "const manageable = s.sii_status",
)
replace_once(
    'src/components/CohortDrawer.tsx',
    "        <span>Vista rápida del listado. El expediente completo queda en Entidad 360.</span>\n        {s.entity_id && onOpenEntity ? (",
    "        <span>Vista rápida del listado. El expediente completo queda en Entidad 360.</span>\n        <div className=\"subject-quick-action-buttons\">\n          {manageable && (\n            <button\n              className=\"subject-quick-manage\"\n              onClick={() => { window.location.hash = '#/universo-so?vista=casos&cola=termino'; }}\n            >\n              Gestionar\n            </button>\n          )}\n        {s.entity_id && onOpenEntity ? (",
    "className=\"subject-quick-manage\"",
)
replace_once(
    'src/components/CohortDrawer.tsx',
    "        ) : (\n          <span className=\"subject-quick-unavailable\">Sin ficha 360 vinculada</span>\n        )}\n      </div>\n    </div>\n  );\n}",
    "        ) : (\n          <span className=\"subject-quick-unavailable\">Sin ficha 360 vinculada</span>\n        )}\n        </div>\n      </div>\n    </div>\n  );\n}",
    "subject-quick-action-buttons",
)

# 6) Entidad 360: potencial SO o SO con término de giro muestran Gestionar.
replace_once(
    'src/components/Entity360StatusMarks.tsx',
    "  const potentialTitle = data.uaf_sector\n    ? `Screening de potencial SO · ${data.uaf_sector}. ${basis ?? ''}`.trim()\n    : basis;",
    "  const potentialTitle = data.uaf_sector\n    ? `Screening de potencial SO · ${data.uaf_sector}. ${basis ?? ''}`.trim()\n    : basis;\n  const terminated = /término de giro/i.test(target.textContent ?? '');\n  const manageableQueue = potential ? 'potenciales' : registered && terminated ? 'termino' : null;",
    "const manageableQueue = potential",
)
replace_once(
    'src/components/Entity360StatusMarks.tsx',
    "      {potential && (\n        <Badge tone=\"medium\" title={potentialTitle}>\n          Potencial SO\n        </Badge>\n      )}\n    </>,",
    "      {potential && (\n        <Badge tone=\"medium\" title={potentialTitle}>\n          Potencial SO\n        </Badge>\n      )}\n      {manageableQueue && (\n        <button\n          className=\"entity360-manage-case\"\n          onClick={() => { window.location.hash = `#/universo-so?vista=casos&cola=${manageableQueue}`; }}\n          title={manageableQueue === 'termino' ? 'Abrir este universo en la mesa de casos' : 'Abrir potenciales SO en la mesa de casos'}\n        >\n          Gestionar\n        </button>\n      )}\n    </>,",
    "className=\"entity360-manage-case\"",
)

# 7) Hoja compacta cargada después de los estilos base de Universo SO.
replace_once(
    'src/views/UniversoSO.tsx',
    "import '../styles/universo-so.css';",
    "import '../styles/universo-so.css';\nimport '../styles/universo-casework-compact.css';",
    "universo-casework-compact.css",
)

css = r'''/* Mesa de casos · densidad operativa v2
   Conserva el lenguaje visual de Atlas y prioriza lectura simultánea grilla/ficha. */
.uso .uso-axis-body { gap: 9px; }
.uso .uso-queues { gap: 7px; }
.uso .uso-queues button { min-height: 58px; padding: 7px 10px; grid-template-columns: minmax(0,1fr) auto; column-gap: 9px; row-gap: 1px; }
.uso .uso-queues button > span { font-size: 11px; }
.uso .uso-queues button > b { font-size: 18px; grid-row: 1 / 3; grid-column: 2; align-self: center; }
.uso .uso-queues button > em { font-size: 9px; line-height: 1.25; }
.uso .uso-context > summary { padding: 7px 34px 7px 11px; min-height: 44px; }
.uso .uso-context > summary b { font-size: 12px; }
.uso .uso-context > summary em { font-size: 9px; }
.uso .uso-context-body { padding: 0 11px 8px; }
.uso .uso-funnel { gap: 5px; }
.uso .uso-funnel-step { padding: 6px 7px; }
.uso .uso-funnel-step p { font-size: 9px; margin-top: 3px; }
.uso .uso-funnel-facts { padding: 6px 0 0; gap: 5px 10px; font-size: 9px; }
.uso .uso-cartera-context { padding: 8px 10px; }
.uso .uso-state-counts { gap: 5px; margin-top: 6px; }
.uso .uso-state-counts button { min-height: 31px; padding: 5px 7px; }
.uso .uso-state-counts span { font-size: 9px; }
.uso .uso-state-counts b { font-size: 12px; }
.uso .uso-toolbar { padding: 7px 9px; gap: 6px 7px; border-radius: 9px; }
.uso .uso-search input, .uso .uso-select select { min-height: 31px; font-size: 10px; }
.uso .uso-select > span { font-size: 8px; }
.uso .uso-toolbar-chips { gap: 4px; }
.uso .uso-toolbar .chip { min-height: 26px; padding: 3px 7px; font-size: 9px; }

/* La vista principal es realmente partida: la ficha deja de ser una barra lateral estrecha. */
.uso .uso-work { grid-template-columns: minmax(520px, 1.12fr) minmax(430px, .88fr); gap: 9px; align-items: start; }
.uso .uso-list-panel { border-radius: 9px; min-width: 0; }
.uso .uso-list-head { min-height: 38px; padding: 6px 9px; }
.uso .uso-list-head b { font-size: 14px; }
.uso .uso-list-head span, .uso .uso-list-head em { font-size: 9px; }
.uso .uso-list { max-height: calc(100vh - 230px); min-height: 380px; }
.uso .uso-row-main { grid-template-columns: 4px minmax(175px,1.9fr) minmax(110px,1.25fr) 62px minmax(72px,.72fr) minmax(128px,1fr); gap: 6px; padding: 6px 8px 6px 3px; min-height: 49px; }
.uso .uso-row-id b { font-size: 10px; line-height: 1.2; }
.uso .uso-row-id em, .uso .uso-row-place span, .uso .uso-row-place em, .uso .uso-row-score em, .uso .uso-row-work > em { font-size: 8.5px; }
.uso .uso-row-score b { font-size: 13px; }
.uso .uso-row-marks { gap: 2px; }
.uso .uso-row-marks i { width: 17px; height: 17px; font-size: 8px; }
.uso .uso-row-work { gap: 3px; align-items: flex-start; }
.uso .uso-row-owner { display: inline-flex; max-width: 126px; padding: 2px 5px; border: 1px solid var(--line); border-radius: 999px; background: color-mix(in srgb, var(--panel-2) 86%, transparent); color: var(--ink-2); font-size: 8px; line-height: 1.2; white-space: normal; overflow-wrap: anywhere; }
.uso .uso-row-contact { font-size: 8px; }
.uso .uso-detail { position: sticky; top: 66px; min-width: 0; }
.uso .uso-case { max-height: calc(100vh - 82px); border-radius: 9px; }
.uso .uso-case-head { padding: 9px 10px 7px; gap: 7px; }
.uso .uso-case-id h3 { font-size: 14px; margin: 3px 0 2px; }
.uso .uso-case-id p { font-size: 9px; }
.uso .uso-case-badges { gap: 4px; }
.uso .uso-case-assignment { margin: 0 9px 7px; padding: 7px 9px; min-height: 46px; }
.uso .uso-case-assignment b { font-size: 10px; }
.uso .uso-case-assignment em { font-size: 8.5px; }
.uso .uso-case-tabs { min-height: 34px; }
.uso .uso-case-tabs button { padding: 7px 8px; font-size: 9px; }
.uso .uso-case-body { padding: 9px 10px 12px; gap: 9px; }
.uso .uso-section-head { margin-bottom: 5px; }
.uso .uso-section-head h4 { font-size: 11px; }
.uso .uso-section-head p { font-size: 8.5px; }
.uso .uso-contact { gap: 6px; grid-template-columns: 1fr 1fr; }
.uso .uso-contact-field span { font-size: 8px; }
.uso .uso-contact-field input { min-height: 31px; font-size: 10px; padding: 5px 7px; }
.uso .uso-flow { gap: 4px; }
.uso .uso-flow button { min-height: 36px; padding: 5px 3px; }
.uso .uso-flow button span { font-size: 8px; }
.uso .uso-flow-alt { gap: 5px; }
.uso .uso-flow-alt button { min-height: 27px; font-size: 8.5px; }
.uso .uso-priority { min-height: 31px; }
.uso .uso-note-field textarea { min-height: 62px; font-size: 10px; }

.uso .uso-case-resolution { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 9px; align-items: center; padding: 8px 9px; border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--line)); border-radius: 8px; background: color-mix(in srgb, var(--accent) 5%, var(--panel-2)); }
.uso .uso-case-resolution[data-finalized="true"] { border-color: color-mix(in srgb, var(--present) 42%, var(--line)); background: color-mix(in srgb, var(--present) 7%, var(--panel-2)); }
.uso .uso-case-resolution > div:first-child { display: grid; gap: 2px; }
.uso .uso-case-resolution b { font-size: 10px; color: var(--ink-1); }
.uso .uso-case-resolution em { font-size: 8.5px; line-height: 1.35; color: var(--ink-3); font-style: normal; }
.uso .uso-case-resolution-actions { display: flex; gap: 5px; flex-wrap: wrap; justify-content: flex-end; }
.uso .uso-release { border-color: color-mix(in srgb, var(--sig-watch) 40%, var(--line)); }

/* El mejor dato observado queda a primera vista; el resto sigue disponible para auditoría. */
.uso .uso-open-head { gap: 8px; }
.uso .uso-open-head h4 { font-size: 12px; margin: 1px 0 2px; }
.uso .uso-open-head p { font-size: 8.5px; line-height: 1.35; }
.uso .uso-open-stats { gap: 5px; }
.uso .uso-open-stats span { padding: 4px 6px; font-size: 8px; }
.uso .uso-open-primary { display: grid; grid-template-columns: 30px minmax(0,1fr) auto; gap: 8px; align-items: center; padding: 8px 9px; border: 1px solid color-mix(in srgb, var(--present) 48%, var(--line)); border-radius: 8px; background: color-mix(in srgb, var(--present) 7%, var(--panel-2)); }
.uso .uso-open-primary[data-selected="true"] { box-shadow: inset 3px 0 0 var(--present); }
.uso .uso-open-primary-glyph { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px; background: color-mix(in srgb, var(--present) 14%, var(--panel)); color: var(--present); font-weight: 800; font-size: 11px; }
.uso .uso-open-primary > div { display: grid; gap: 2px; min-width: 0; }
.uso .uso-open-primary b { font-size: 10.5px; color: var(--ink-1); overflow-wrap: anywhere; }
.uso .uso-open-primary em { font-size: 8px; color: var(--ink-3); font-style: normal; }
.uso .uso-open-grid { gap: 5px; }
.uso .uso-open-item { padding: 7px; gap: 6px; grid-template-columns: 26px minmax(0,1fr) 58px; }
.uso .uso-open-kind { width: 25px; height: 25px; font-size: 9px; }
.uso .uso-open-value b { font-size: 10px; }
.uso .uso-open-value small, .uso .uso-open-value em { font-size: 8px; }
.uso .uso-open-quality b { font-size: 11px; }
.uso .uso-open-quality span, .uso .uso-open-quality small { font-size: 7.5px; }
.uso .uso-open-actions { grid-column: 2 / -1; gap: 4px; }
.uso .uso-open-actions button, .uso .uso-open-actions a { min-height: 24px; padding: 3px 6px; font-size: 8px; }
.uso .uso-open-use[data-reliable="true"] { border-color: color-mix(in srgb, var(--present) 55%, var(--line)); color: var(--present); }
.uso .uso-open-use:disabled { opacity: .46; cursor: not-allowed; }

.subject-quick-action-buttons { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
.subject-quick-manage, .entity360-manage-case { border: 1px solid color-mix(in srgb, var(--present) 65%, var(--line)); border-radius: 7px; background: color-mix(in srgb, var(--present) 10%, var(--panel)); color: var(--present); font: inherit; font-size: 10px; font-weight: 700; padding: 6px 10px; cursor: pointer; }
.subject-quick-manage:hover, .entity360-manage-case:hover { background: color-mix(in srgb, var(--present) 17%, var(--panel)); }
.entity360-manage-case { margin-left: 4px; align-self: center; }

@media (min-width: 901px) and (max-width: 1080px) {
  .uso .uso-work { grid-template-columns: minmax(470px, 1fr) 390px; }
  .uso .uso-detail { position: sticky; top: 62px; }
  .uso .uso-case { max-height: calc(100vh - 76px); }
  .uso .uso-back { display: none; }
  .uso .uso-row-main { grid-template-columns: 4px minmax(150px,1.8fr) minmax(95px,1fr) 56px minmax(60px,.6fr) 116px; }
}

@media (max-width: 900px) {
  .uso .uso-work { grid-template-columns: 1fr; }
  .uso .uso-detail { position: static; }
  .uso .uso-case { max-height: none; }
  .uso .uso-list { max-height: 58vh; min-height: 300px; }
  .uso .uso-case-resolution, .uso .uso-open-primary { grid-template-columns: 1fr; }
  .uso .uso-case-resolution-actions { justify-content: flex-start; }
}
'''
css_path = ROOT / 'src/styles/universo-casework-compact.css'
if not css_path.exists() or 'Mesa de casos · densidad operativa v2' not in css_path.read_text(encoding='utf-8'):
    css_path.write_text(css, encoding='utf-8')

migration = r'''-- Mesa de casos v2: cierre exitoso y devolución trazable al universo.
-- FINALIZADO sólo se admite después de CONTACTADO. DEVUELTO saca el caso de
-- gestión activa sin borrar identidad, contacto, notas, responsable ni eventos.

alter table public.aml_uaf_case_management
  drop constraint if exists aml_uaf_case_management_state_check;

alter table public.aml_uaf_case_management
  add constraint aml_uaf_case_management_state_check
  check (state in ('EN_UBICACION','CONTACTO_OBTENIDO','CONTACTADO','FINALIZADO','DEVUELTO','SIN_UBICAR','DESCARTADO'));

create or replace function public.aml_uaf_case_patch(
  p_kind text,
  p_rut text,
  p_subject jsonb default '{}'::jsonb,
  p_state text default null,
  p_priority text default null,
  p_note text default null,
  p_contact jsonb default null,
  p_claim boolean default false
)
returns uuid
language plpgsql
set search_path to 'public', 'auth', 'extensions', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_email text;
  v_name text;
  v_key text := regexp_replace(upper(coalesce(p_rut, '')), '[^0-9K]', '', 'g');
  v_case public.aml_uaf_case_management%rowtype;
  v_old_state text;
  v_new_state text;
  v_meta jsonb := coalesce(auth.jwt()->'user_metadata', '{}'::jsonb);
begin
  if v_uid is null then raise exception 'Sesión requerida'; end if;
  if p_kind not in ('POTENCIAL','TERMINO') then raise exception 'Tipo de caso no permitido'; end if;
  if nullif(v_key,'') is null then raise exception 'RUT requerido'; end if;
  if p_state is not null and p_state not in ('EN_UBICACION','CONTACTO_OBTENIDO','CONTACTADO','FINALIZADO','DEVUELTO','SIN_UBICAR','DESCARTADO') then
    raise exception 'Estado de gestión no permitido';
  end if;
  if p_priority is not null and p_priority not in ('ALTA','MEDIA','BAJA') then
    raise exception 'Prioridad no permitida';
  end if;

  select u.role, coalesce(nullif(u.email,''), auth.jwt()->>'email', 'usuario')
    into v_role, v_email
  from public.aml_allowed_users u
  where u.user_id = v_uid and u.enabled = true;
  if v_role is null then raise exception 'Cuenta no habilitada'; end if;

  v_name := coalesce(
    nullif(v_meta->>'full_name',''),
    nullif(v_meta->>'name',''),
    split_part(v_email,'@',1)
  );

  select * into v_case
  from public.aml_uaf_case_management c
  where c.case_kind = p_kind and c.rut_key = v_key
  for update;

  if not found then
    if not p_claim then raise exception 'El caso aún no fue tomado por un fiscalizador'; end if;
    insert into public.aml_uaf_case_management (
      case_kind, rut, rut_key, entity_id, entity_name, sector, region, commune, motive,
      state, priority, note, contact, assigned_to, assigned_email, assigned_name,
      assigned_at, updated_by, updated_email, contacted_at, updated_at
    ) values (
      p_kind, p_rut, v_key,
      nullif(p_subject->>'entityId',''), nullif(p_subject->>'name',''), nullif(p_subject->>'sector',''),
      nullif(p_subject->>'region',''), nullif(p_subject->>'commune',''), nullif(p_subject->>'motive',''),
      coalesce(p_state,'EN_UBICACION'), coalesce(p_priority,'MEDIA'), coalesce(p_note,''), coalesce(p_contact,'{}'::jsonb),
      v_uid, v_email, v_name, now(), v_uid, v_email,
      case when coalesce(p_state,'EN_UBICACION') = 'CONTACTADO' then now() else null end,
      now()
    ) returning * into v_case;

    insert into public.aml_uaf_case_management_event (
      case_id, case_kind, rut_key, event_type, previous_state, new_state,
      actor_id, actor_email, actor_name, detail
    ) values (
      v_case.case_id, p_kind, v_key, 'CLAIM', null, v_case.state,
      v_uid, v_email, v_name, 'Caso tomado para gestión'
    );
    return v_case.case_id;
  end if;

  -- Un caso devuelto puede ser retomado por cualquier usuario habilitado. La
  -- asignación anterior queda preservada en eventos y es reemplazada sólo al retomar.
  if v_case.state = 'DEVUELTO' and p_claim then
    v_old_state := v_case.state;
    v_new_state := coalesce(p_state, 'EN_UBICACION');
    update public.aml_uaf_case_management c
       set entity_id = coalesce(nullif(p_subject->>'entityId',''), c.entity_id),
           entity_name = coalesce(nullif(p_subject->>'name',''), c.entity_name),
           sector = coalesce(nullif(p_subject->>'sector',''), c.sector),
           region = coalesce(nullif(p_subject->>'region',''), c.region),
           commune = coalesce(nullif(p_subject->>'commune',''), c.commune),
           motive = coalesce(nullif(p_subject->>'motive',''), c.motive),
           state = v_new_state,
           priority = coalesce(p_priority, c.priority),
           note = case when p_note is null then c.note else left(p_note, 1200) end,
           contact = case when p_contact is null then c.contact else c.contact || p_contact end,
           assigned_to = v_uid,
           assigned_email = v_email,
           assigned_name = v_name,
           assigned_at = now(),
           updated_by = v_uid,
           updated_email = v_email,
           updated_at = now()
     where c.case_id = v_case.case_id
     returning * into v_case;

    insert into public.aml_uaf_case_management_event (
      case_id, case_kind, rut_key, event_type, previous_state, new_state,
      actor_id, actor_email, actor_name, detail
    ) values (
      v_case.case_id, p_kind, v_key, 'RECLAIM', v_old_state, v_new_state,
      v_uid, v_email, v_name, 'Caso retomado desde el universo sin gestión activa'
    );
    return v_case.case_id;
  end if;

  if v_case.assigned_to <> v_uid and coalesce(v_role,'viewer') <> 'admin' then
    raise exception 'Este caso ya está siendo atendido por %', coalesce(v_case.assigned_name, v_case.assigned_email);
  end if;

  if v_case.state = 'FINALIZADO' and p_state is distinct from 'FINALIZADO' then
    raise exception 'El caso ya está finalizado';
  end if;
  if p_state = 'FINALIZADO' and v_case.state <> 'CONTACTADO' then
    raise exception 'Para finalizar, primero registra que se logró contacto';
  end if;

  v_old_state := v_case.state;
  v_new_state := coalesce(p_state, v_case.state);

  update public.aml_uaf_case_management c
     set entity_id = coalesce(nullif(p_subject->>'entityId',''), c.entity_id),
         entity_name = coalesce(nullif(p_subject->>'name',''), c.entity_name),
         sector = coalesce(nullif(p_subject->>'sector',''), c.sector),
         region = coalesce(nullif(p_subject->>'region',''), c.region),
         commune = coalesce(nullif(p_subject->>'commune',''), c.commune),
         motive = coalesce(nullif(p_subject->>'motive',''), c.motive),
         state = v_new_state,
         priority = coalesce(p_priority, c.priority),
         note = case when p_note is null then c.note else left(p_note, 1200) end,
         contact = case when p_contact is null then c.contact else c.contact || p_contact end,
         contacted_at = case when v_new_state = 'CONTACTADO' and c.contacted_at is null then now() else c.contacted_at end,
         updated_by = v_uid,
         updated_email = v_email,
         updated_at = now()
   where c.case_id = v_case.case_id
   returning * into v_case;

  if v_old_state is distinct from v_new_state then
    insert into public.aml_uaf_case_management_event (
      case_id, case_kind, rut_key, event_type, previous_state, new_state,
      actor_id, actor_email, actor_name, detail
    ) values (
      v_case.case_id, p_kind, v_key,
      case when v_new_state = 'DEVUELTO' then 'RELEASE'
           when v_new_state = 'FINALIZADO' then 'FINALIZE'
           else 'STATE' end,
      v_old_state, v_new_state,
      v_uid, v_email, v_name,
      case when v_new_state = 'DEVUELTO' then 'Caso devuelto al universo sin gestión activa; se conserva la traza'
           when v_new_state = 'FINALIZADO' then 'Gestión finalizada exitosamente después de contacto'
           else 'Estado de gestión actualizado' end
    );
  end if;

  return v_case.case_id;
end;
$function$;

comment on function public.aml_uaf_case_patch(text,text,jsonb,text,text,text,jsonb,boolean) is
  'Gestiona casos compartidos. FINALIZADO exige contacto previo. DEVUELTO libera el caso hacia el universo manteniendo historial y permite retoma trazable.';
'''
migration_path = ROOT / 'supabase/migrations/20260910173500_case_management_completion_release.sql'
if not migration_path.exists():
    migration_path.write_text(migration, encoding='utf-8')

print('Patch de gestión de casos aplicado.')
