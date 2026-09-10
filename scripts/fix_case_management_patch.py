from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(rel: str, old: str, new: str, marker: str) -> None:
    path = ROOT / rel
    text = path.read_text(encoding='utf-8')
    if marker in text:
        return
    if old not in text:
        raise SystemExit(f'Bloque de ajuste no encontrado en {rel}: {old[:100]!r}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


# Cierra el contenedor de acciones que el patch principal abre en la ficha rápida.
patch(
    'src/components/CohortDrawer.tsx',
    "        ) : (\n          <span className=\"subject-quick-unavailable\">Sin ficha 360 vinculada</span>\n        )}\n      </div>\n    </div>\n  );\n}",
    "        ) : (\n          <span className=\"subject-quick-unavailable\">Sin ficha 360 vinculada</span>\n        )}\n        </div>{/* casework-actions-close */}\n      </div>\n    </div>\n  );\n}",
    'casework-actions-close',
)

# Gestionar abre la mesa ya filtrada por el RUT que originó la acción.
patch(
    'src/components/CohortDrawer.tsx',
    "window.location.hash = '#/universo-so?vista=casos&cola=termino';",
    "window.location.hash = `#/universo-so?vista=casos&cola=termino&q=${encodeURIComponent(s.rut)}`;",
    'cola=termino&q=${encodeURIComponent(s.rut)}',
)
patch(
    'src/components/Entity360StatusMarks.tsx',
    "window.location.hash = `#/universo-so?vista=casos&cola=${manageableQueue}`;",
    "window.location.hash = `#/universo-so?vista=casos&cola=${manageableQueue}&q=${encodeURIComponent(data.rut ?? entityId)}`;",
    '&q=${encodeURIComponent(data.rut ?? entityId)}',
)
patch(
    'src/views/universo/CasosAxis.tsx',
    "  const [query, setQuery] = useState('');",
    "  const [query, setQuery] = useState(() => {\n    const raw = window.location.hash.split('?')[1] ?? '';\n    return new URLSearchParams(raw).get('q') ?? '';\n  });",
    "new URLSearchParams(raw).get('q')",
)

# La API no acepta crear un caso directamente como FINALIZADO o DEVUELTO:
# ambos estados necesitan una historia previa de gestión.
migration = ROOT / 'supabase/migrations/20260910173500_case_management_completion_release.sql'
text = migration.read_text(encoding='utf-8')
marker = "Estados terminales requieren un caso previamente gestionado"
if marker not in text:
    old = "  if not found then\n    if not p_claim then raise exception 'El caso aún no fue tomado por un fiscalizador'; end if;"
    new = "  if not found then\n    -- Estados terminales requieren un caso previamente gestionado.\n    if p_state in ('FINALIZADO','DEVUELTO') then\n      raise exception 'El caso debe ser tomado y gestionado antes de cerrarlo o devolverlo';\n    end if;\n    if not p_claim then raise exception 'El caso aún no fue tomado por un fiscalizador'; end if;"
    if old not in text:
        raise SystemExit('No se encontró el bloque de creación en la migración de casos')
    migration.write_text(text.replace(old, new, 1), encoding='utf-8')

print('Ajustes finales del patch de gestión aplicados.')
