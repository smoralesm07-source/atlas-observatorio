import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import '../styles/administracion.css';

type Role = 'viewer' | 'analyst' | 'admin';

type Authorization = {
  user_id: string;
  email: string;
  role: Role;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type AdminUser = {
  id: string;
  email: string;
  created_at: string | null;
  last_sign_in_at: string | null;
  provider: string | null;
  authorization: Authorization | null;
};

type AuditEntry = {
  id: number;
  actor_user_id: string;
  actor_email: string | null;
  target_user_id: string;
  target_email: string;
  action: 'grant' | 'role_change' | 'enable' | 'disable';
  old_role: Role | null;
  new_role: Role;
  old_enabled: boolean | null;
  new_enabled: boolean;
  created_at: string;
};

type Snapshot = {
  ok: true;
  actor: { id: string; email: string; role: 'admin' };
  users: AdminUser[];
  audit: AuditEntry[];
};

type ApiFailure = { ok: false; error?: { code?: string; message?: string } };

const ROLE_LABEL: Record<Role, string> = {
  viewer: 'Viewer',
  analyst: 'Analyst',
  admin: 'Admin',
};

const ROLE_HELP: Record<Role, string> = {
  viewer: 'Consulta del Observatorio',
  analyst: 'Perfil analítico',
  admin: 'Gestión de accesos',
};

function formatDate(value: string | null) {
  if (!value) return 'Sin registro';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin registro';
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

async function invokeAdmin(body: Record<string, unknown>): Promise<Snapshot> {
  const { data, error } = await supabase.functions.invoke<Snapshot | ApiFailure>('atlas-user-admin', { body });

  if (error) {
    let message = error.message || 'No fue posible completar la operación.';
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const payload = (await context.clone().json()) as ApiFailure;
        message = payload.error?.message ?? message;
      } catch {
        // Conserva el mensaje transportado por supabase-js.
      }
    }
    throw new Error(message);
  }

  if (!data || data.ok !== true) {
    throw new Error((data as ApiFailure | null)?.error?.message ?? 'La administración respondió sin datos válidos.');
  }

  return data;
}

export function Administracion({ session }: { session: Session }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pendingRoles, setPendingRoles] = useState<Record<string, Role>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await invokeAdmin({ action: 'list' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const users = snapshot?.users ?? [];
  const pending = users.filter((user) => !user.authorization);
  const enabled = users.filter((user) => user.authorization?.enabled);
  const disabled = users.filter((user) => user.authorization && !user.authorization.enabled);
  const admins = enabled.filter((user) => user.authorization?.role === 'admin');

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('es-CL');
    if (!q) return users;
    return users.filter((user) => user.email.toLocaleLowerCase('es-CL').includes(q));
  }, [query, users]);

  async function mutate(user: AdminUser, body: Record<string, unknown>, confirmMessage?: string) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusyId(user.id);
    setError(null);
    try {
      setSnapshot(await invokeAdmin({ ...body, target_user_id: user.id }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  function requestedRole(user: AdminUser): Role {
    return pendingRoles[user.id] ?? 'viewer';
  }

  return (
    <div className="admin-view fade-in">
      <div className="view-head admin-head">
        <div>
          <div className="admin-kicker">Gobierno de acceso</div>
          <h1 className="view-title">Administración</h1>
          <p className="view-lede">
            Microsoft Entra acredita la identidad. Desde aquí decides quién entra a ATLAS Observatorio,
            con qué rol y desde cuándo. Cada cambio queda registrado.
          </p>
        </div>
        <button className="btn admin-refresh" type="button" onClick={() => void load()} disabled={loading || busyId !== null}>
          {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      {error && (
        <div className="admin-alert" role="alert">
          <strong>No fue posible completar la operación.</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="admin-metrics" aria-label="Resumen de accesos">
        <Metric label="Identidades" value={users.length} foot="Cuentas que ya pasaron por Entra" />
        <Metric label="Habilitados" value={enabled.length} foot="Con acceso vigente" />
        <Metric label="Pendientes" value={pending.length} foot="Autenticados, aún sin habilitar" emphasis={pending.length > 0} />
        <Metric label="Administradores" value={admins.length} foot="Con facultad para gestionar accesos" />
      </div>

      <section className="admin-section" aria-labelledby="pending-title">
        <div className="admin-section-head">
          <div>
            <h2 id="pending-title">Solicitudes pendientes</h2>
            <p>Usuarios que ya se autenticaron con Microsoft pero todavía no están en la lista de habilitación.</p>
          </div>
          <span className="admin-count">{pending.length}</span>
        </div>

        {loading && !snapshot ? (
          <div className="admin-empty">Consultando identidades y permisos…</div>
        ) : pending.length === 0 ? (
          <div className="admin-empty admin-empty-ok">
            <span className="admin-empty-dot" />
            No hay solicitudes pendientes.
          </div>
        ) : (
          <div className="admin-pending-grid">
            {pending.map((user) => (
              <article className="admin-pending-card" key={user.id}>
                <div className="admin-user-avatar">{user.email.slice(0, 1).toUpperCase()}</div>
                <div className="admin-user-main">
                  <strong>{user.email || 'Cuenta sin correo'}</strong>
                  <span>Primera identidad: {formatDate(user.created_at)}</span>
                </div>
                <div className="admin-pending-actions">
                  <select
                    aria-label={`Rol para ${user.email}`}
                    value={requestedRole(user)}
                    onChange={(event) => setPendingRoles((current) => ({ ...current, [user.id]: event.target.value as Role }))}
                    disabled={busyId === user.id}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="analyst">Analyst</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={busyId === user.id}
                    onClick={() => void mutate(
                      user,
                      { action: 'grant', role: requestedRole(user) },
                      requestedRole(user) === 'admin' ? `¿Habilitar a ${user.email} como administrador?` : undefined,
                    )}
                  >
                    {busyId === user.id ? 'Guardando…' : 'Habilitar'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-section" aria-labelledby="users-title">
        <div className="admin-section-head admin-section-head-search">
          <div>
            <h2 id="users-title">Usuarios y permisos</h2>
            <p>Cambiar el rol no modifica la identidad de Microsoft. Deshabilitar conserva el historial.</p>
          </div>
          <label className="admin-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
              <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por correo" />
          </label>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Estado</th>
                <th>Rol</th>
                <th>Último acceso</th>
                <th>Identidad</th>
                <th className="admin-action-col">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => {
                const access = user.authorization;
                const isSelf = user.id === session.user.id;
                const isBusy = busyId === user.id;
                return (
                  <tr key={user.id}>
                    <td>
                      <div className="admin-user-cell">
                        <div className="admin-user-avatar admin-user-avatar-small">{user.email.slice(0, 1).toUpperCase()}</div>
                        <div>
                          <strong>{user.email || 'Cuenta sin correo'}</strong>
                          {isSelf && <span className="admin-you">Tú</span>}
                        </div>
                      </div>
                    </td>
                    <td>
                      {!access ? (
                        <span className="admin-status admin-status-pending"><i /> Pendiente</span>
                      ) : access.enabled ? (
                        <span className="admin-status admin-status-active"><i /> Activo</span>
                      ) : (
                        <span className="admin-status admin-status-off"><i /> Deshabilitado</span>
                      )}
                    </td>
                    <td>
                      {access ? (
                        <div className="admin-role-control">
                          <select
                            value={access.role}
                            disabled={isBusy}
                            aria-label={`Rol de ${user.email}`}
                            onChange={(event) => {
                              const next = event.target.value as Role;
                              if (next === access.role) return;
                              const prompt = next === 'admin'
                                ? `¿Asignar privilegios de administrador a ${user.email}?`
                                : access.role === 'admin'
                                  ? `¿Cambiar a ${user.email} desde Admin a ${ROLE_LABEL[next]}?`
                                  : undefined;
                              void mutate(user, { action: 'set_role', role: next }, prompt);
                            }}
                          >
                            <option value="viewer">Viewer</option>
                            <option value="analyst">Analyst</option>
                            <option value="admin">Admin</option>
                          </select>
                          <small>{ROLE_HELP[access.role]}</small>
                        </div>
                      ) : (
                        <span className="admin-muted">Sin asignar</span>
                      )}
                    </td>
                    <td className="admin-date">{formatDate(user.last_sign_in_at)}</td>
                    <td><span className="admin-provider">{user.provider === 'azure' ? 'Microsoft Entra' : user.provider ?? 'Microsoft Entra'}</span></td>
                    <td className="admin-action-col">
                      {!access ? (
                        <button className="btn btn-primary admin-inline-btn" type="button" onClick={() => void mutate(user, { action: 'grant', role: 'viewer' })} disabled={isBusy}>
                          Habilitar
                        </button>
                      ) : (
                        <button
                          className={`btn admin-inline-btn ${access.enabled ? 'admin-danger-btn' : ''}`}
                          type="button"
                          disabled={isBusy}
                          onClick={() => void mutate(
                            user,
                            { action: 'set_enabled', enabled: !access.enabled },
                            access.enabled ? `¿Deshabilitar el acceso de ${user.email}?` : undefined,
                          )}
                        >
                          {isBusy ? 'Guardando…' : access.enabled ? 'Deshabilitar' : 'Reactivar'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="admin-table-empty">No hay usuarios que coincidan con la búsqueda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="admin-table-foot">
          <span>{enabled.length} habilitados · {disabled.length} deshabilitados · {pending.length} pendientes</span>
          <span>No se eliminan identidades desde Observatorio.</span>
        </div>
      </section>

      <section className="admin-section" aria-labelledby="audit-title">
        <div className="admin-section-head">
          <div>
            <h2 id="audit-title">Actividad administrativa</h2>
            <p>Últimos cambios de habilitación, rol y estado registrados por la capa de gobierno.</p>
          </div>
          <span className="admin-count">{snapshot?.audit.length ?? 0}</span>
        </div>
        <div className="admin-audit-list">
          {(snapshot?.audit ?? []).slice(0, 12).map((entry) => (
            <div className="admin-audit-row" key={entry.id}>
              <span className={`admin-audit-icon admin-audit-${entry.action}`} aria-hidden />
              <div className="admin-audit-copy">
                <strong>{auditLabel(entry)}</strong>
                <span>{entry.target_email}</span>
              </div>
              <div className="admin-audit-meta">
                <span>por {entry.actor_email ?? 'administrador'}</span>
                <time>{formatDate(entry.created_at)}</time>
              </div>
            </div>
          ))}
          {!loading && (snapshot?.audit.length ?? 0) === 0 && (
            <div className="admin-empty">Aún no hay cambios administrativos registrados.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, foot, emphasis = false }: { label: string; value: number; foot: string; emphasis?: boolean }) {
  return (
    <div className={`admin-metric ${emphasis ? 'admin-metric-emphasis' : ''}`}>
      <div className="admin-metric-label">{label}</div>
      <div className="admin-metric-value num">{value}</div>
      <div className="admin-metric-foot">{foot}</div>
    </div>
  );
}

function auditLabel(entry: AuditEntry) {
  if (entry.action === 'grant') return `Acceso habilitado · ${ROLE_LABEL[entry.new_role]}`;
  if (entry.action === 'enable') return `Acceso reactivado · ${ROLE_LABEL[entry.new_role]}`;
  if (entry.action === 'disable') return 'Acceso deshabilitado';
  return `Rol ${entry.old_role ? ROLE_LABEL[entry.old_role] : '—'} → ${ROLE_LABEL[entry.new_role]}`;
}
