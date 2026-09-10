# Administración de usuarios

ATLAS Observatorio mantiene dos capas separadas:

1. **Microsoft Entra / Supabase Auth** acredita la identidad.
2. **`public.aml_allowed_users`** autoriza el acceso y define el rol.

## Alta de un usuario

1. El usuario entra por primera vez con **Ingresar con Microsoft**.
2. Supabase Auth registra su identidad, pero Observatorio mantiene los datos cerrados.
3. Un administrador abre **Administración** y encuentra la cuenta en **Solicitudes pendientes**.
4. Selecciona `viewer`, `analyst` o `admin` y pulsa **Habilitar**.
5. El cambio queda registrado en `public.atlas_user_access_audit`.

## Baja o suspensión

No se elimina la identidad. Se usa **Deshabilitar** para conservar trazabilidad y permitir una reactivación posterior.

## Seguridad

- La sección sólo aparece a usuarios con rol `admin`.
- La Edge Function `atlas-user-admin` vuelve a validar el JWT y el rol admin en cada petición.
- La clave `service_role` permanece únicamente en el servidor.
- Las mutaciones se ejecutan mediante `atlas_admin_apply_access_change`, junto con el registro de auditoría.
- La última cuenta administradora activa no puede ser degradada ni deshabilitada.
