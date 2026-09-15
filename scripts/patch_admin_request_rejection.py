from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: se esperaba 1 coincidencia y se encontraron {count}")
    return text.replace(old, new, 1)


# --- Administración ---
path = Path("src/views/Administracion.tsx")
text = path.read_text(encoding="utf-8")

if "type RequestStatus = 'pending' | 'approved' | 'rejected';" not in text:
    text = replace_once(
        text,
        "type Role = 'viewer' | 'analyst' | 'admin';\n",
        "type Role = 'viewer' | 'analyst' | 'admin';\ntype RequestStatus = 'pending' | 'approved' | 'rejected';\n",
        "request status type",
    )

if "request: {" not in text:
    text = replace_once(
        text,
        "  provider: string | null;\n  authorization: Authorization | null;\n};",
        "  provider: string | null;\n  authorization: Authorization | null;\n  request: {\n    user_id: string;\n    status: RequestStatus;\n    requested_at: string;\n    last_seen_at: string;\n    resolved_at: string | null;\n  } | null;\n};",
        "admin user request",
    )

text = text.replace(
    "  action: 'grant' | 'role_change' | 'enable' | 'disable';",
    "  action: 'grant' | 'role_change' | 'enable' | 'disable' | 'reject' | 'reopen';",
)

text = text.replace(
    "  const pending = users.filter((user) => !user.authorization);\n",
    "  const pending = users.filter((user) => !user.authorization && user.request?.status === 'pending');\n  const rejected = users.filter((user) => !user.authorization && user.request?.status === 'rejected');\n",
)

pending_actions_old = """                  <button
                    className=\"btn btn-primary\"
                    type=\"button\"
                    disabled={busyId === user.id}
                    onClick={() => void mutate(
                      user,
                      { action: 'grant', role: requestedRole(user) },
                      requestedRole(user) === 'admin' ? `¿Habilitar a ${user.email} como administrador?` : undefined,
                    )}
                  >
                    {busyId === user.id ? 'Guardando…' : 'Habilitar'}
                  </button>"""
pending_actions_new = """                  <button
                    className=\"btn admin-danger-btn\"
                    type=\"button\"
                    disabled={busyId === user.id}
                    onClick={() => void mutate(
                      user,
                      { action: 'reject' },
                      `¿Rechazar la solicitud de ${user.email}? El usuario no podrá reabrirla por sí mismo; un administrador deberá hacerlo.`,
                    )}
                  >
                    Rechazar
                  </button>
                  <button
                    className=\"btn btn-primary\"
                    type=\"button\"
                    disabled={busyId === user.id}
                    onClick={() => void mutate(
                      user,
                      { action: 'grant', role: requestedRole(user) },
                      requestedRole(user) === 'admin' ? `¿Habilitar a ${user.email} como administrador?` : undefined,
                    )}
                  >
                    {busyId === user.id ? 'Guardando…' : 'Habilitar'}
                  </button>"""
if "{ action: 'reject' }" not in text:
    text = replace_once(text, pending_actions_old, pending_actions_new, "pending reject button")

status_old = """                      {!access ? (
                        <span className=\"admin-status admin-status-pending\"><i /> Pendiente</span>
                      ) : access.enabled ? ("""
status_new = """                      {!access ? (
                        user.request?.status === 'rejected' ? (
                          <span className=\"admin-status admin-status-rejected\"><i /> Rechazado</span>
                        ) : user.request?.status === 'pending' ? (
                          <span className=\"admin-status admin-status-pending\"><i /> Pendiente</span>
                        ) : (
                          <span className=\"admin-status admin-status-off\"><i /> Sin solicitud</span>
                        )
                      ) : access.enabled ? ("""
if "admin-status-rejected" not in text:
    text = replace_once(text, status_old, status_new, "request status cell")

action_old = """                      {!access ? (
                        <button className=\"btn btn-primary admin-inline-btn\" type=\"button\" onClick={() => void mutate(user, { action: 'grant', role: 'viewer' })} disabled={isBusy}>
                          Habilitar
                        </button>
                      ) : ("""
action_new = """                      {!access ? (
                        user.request?.status === 'rejected' ? (
                          <button
                            className=\"btn admin-inline-btn\"
                            type=\"button\"
                            onClick={() => void mutate(user, { action: 'reopen' }, `¿Reabrir la solicitud de ${user.email}?`)}
                            disabled={isBusy}
                          >
                            {isBusy ? 'Guardando…' : 'Reabrir'}
                          </button>
                        ) : (
                          <button className=\"btn btn-primary admin-inline-btn\" type=\"button\" onClick={() => void mutate(user, { action: 'grant', role: 'viewer' })} disabled={isBusy}>
                            Habilitar
                          </button>
                        )
                      ) : ("""
if "{ action: 'reopen' }" not in text:
    text = replace_once(text, action_old, action_new, "reopen table action")

text = text.replace(
    "          <span>{enabled.length} habilitados · {disabled.length} deshabilitados · {pending.length} pendientes</span>",
    "          <span>{enabled.length} habilitados · {disabled.length} deshabilitados · {pending.length} pendientes · {rejected.length} rechazados</span>",
)

if "Solicitud rechazada" not in text:
    text = replace_once(
        text,
        "function auditLabel(entry: AuditEntry) {\n  if (entry.action === 'grant') return `Acceso habilitado · ${ROLE_LABEL[entry.new_role]}`;",
        "function auditLabel(entry: AuditEntry) {\n  if (entry.action === 'reject') return 'Solicitud rechazada';\n  if (entry.action === 'reopen') return 'Solicitud reabierta';\n  if (entry.action === 'grant') return `Acceso habilitado · ${ROLE_LABEL[entry.new_role]}`;",
        "audit labels",
    )

path.write_text(text, encoding="utf-8")


# --- CSS Administración ---
path = Path("src/styles/administracion.css")
text = path.read_text(encoding="utf-8")
if ".admin-status-rejected" not in text:
    text = replace_once(
        text,
        ".admin-status-pending { color: var(--sig-medium); }\n.admin-status-off { color: var(--ink-4); }",
        ".admin-status-pending { color: var(--sig-medium); }\n.admin-status-rejected { color: var(--sig-high); }\n.admin-status-off { color: var(--ink-4); }",
        "rejected status css",
    )
if ".admin-audit-reject" not in text:
    text = replace_once(
        text,
        ".admin-audit-disable { background: var(--sig-high); box-shadow: 0 0 0 4px color-mix(in srgb, var(--sig-high) 10%, transparent); }\n.admin-audit-role_change",
        ".admin-audit-disable, .admin-audit-reject { background: var(--sig-high); box-shadow: 0 0 0 4px color-mix(in srgb, var(--sig-high) 10%, transparent); }\n.admin-audit-reopen { background: var(--sig-medium); box-shadow: 0 0 0 4px color-mix(in srgb, var(--sig-medium) 10%, transparent); }\n.admin-audit-role_change",
        "audit reject css",
    )
path.write_text(text, encoding="utf-8")


# --- Pantalla del usuario rechazado ---
path = Path("src/components/Auth.tsx")
text = path.read_text(encoding="utf-8")
if "| { state: 'rejected' }" not in text:
    text = replace_once(
        text,
        "type RequestState =\n  | { state: 'saving' }\n  | { state: 'saved' }\n  | { state: 'error'; message: string };",
        "type RequestState =\n  | { state: 'saving' }\n  | { state: 'saved' }\n  | { state: 'rejected' }\n  | { state: 'error'; message: string };",
        "auth rejected request state",
    )

text = text.replace(
    "        state?: 'pending' | 'granted' | 'disabled';",
    "        state?: 'pending' | 'granted' | 'disabled' | 'rejected';",
)

if "data?.state === 'rejected'" not in text:
    text = replace_once(
        text,
        "      if (data?.state === 'granted' || data?.state === 'disabled') {\n        onRecheck();\n        return;\n      }\n\n      if (data?.ok && data.state === 'pending') {",
        "      if (data?.state === 'granted' || data?.state === 'disabled') {\n        onRecheck();\n        return;\n      }\n\n      if (data?.ok && data.state === 'rejected') {\n        setRequest({ state: 'rejected' });\n        return;\n      }\n\n      if (data?.ok && data.state === 'pending') {",
        "auth rejected response",
    )

if "Solicitud de acceso rechazada" not in text:
    text = replace_once(
        text,
        "  const saved = request.state === 'saved';\n\n  return (",
        "  if (request.state === 'rejected') {\n    return (\n      <Card title=\"Solicitud de acceso rechazada\">\n        <p style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.6 }}>\n          Tu identidad fue verificada, pero la solicitud de acceso a ATLAS Observatorio fue rechazada por Administración.\n        </p>\n        <div className=\"note note-warn\">\n          <strong style={{ display: 'block', marginBottom: 5, color: 'var(--ink-1)' }}>{identity}</strong>\n          {session.user.email ?? 'Correo no informado'}\n        </div>\n        <p style={{ color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.55, marginBottom: 0 }}>\n          Si corresponde revisar esta decisión, contacta a un administrador. Solo Administración puede reabrir una solicitud rechazada.\n        </p>\n        <SignOutButton marginTop={18} />\n      </Card>\n    );\n  }\n\n  const saved = request.state === 'saved';\n\n  return (",
        "auth rejected screen",
    )

path.write_text(text, encoding="utf-8")

print("Administración y autenticación alineadas con rechazo/reapertura de solicitudes.")
