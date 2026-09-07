# ATLAS Observatorio

Monitor de fuentes abiertas para análisis de entidades. Es una aplicación nueva,
construida en paralelo a ATLAS, que no modifica ni un objeto del ATLAS actual:
lee los mismos datos gobernados a través de contratos propios.

## Qué es

- Un **monitor global** del estado de las fuentes abiertas gobernadas.
- Una **superficie de anticipación**: los patrones que se activan sobre el
  conjunto, ordenados por prioridad e intensidad.
- Un **buscador de entidades en cascada**: busca en el universo observado y, si
  ahí no hay nada, sigue solo hacia sanciones internacionales, debarment y bases
  offshore. La identidad digital se resuelve bajo demanda.
- Una **ficha de observación** que distingue tres estados por fuente: con
  registro, sin registro y no consultada.

## Qué no es

- No es un expediente ni un sistema de gestión de casos.
- No asigna tareas a fiscalizadores.
- No es un ROS, una denuncia ni una decisión institucional.

## Arquitectura

```
FUENTES GOBERNADAS  →  obs_refresh_all()  →  read models obs_*  →  contratos RPC  →  app
   (tablas Fusion)      (pg_cron, cada 6 h)   (corte versionado)   (SECURITY INVOKER)
```

Reglas que sostienen el diseño:

1. **Calcular, publicar, mostrar.** Ninguna pantalla reconstruye universos en el
   navegador. El trabajo pesado ocurre en `obs_refresh_all()` y se publica como
   un corte con identidad (`snapshot_id`, `row_counts`, `published_at`).
2. **Una pantalla consume un contrato, no una tabla.** Los cinco contratos son
   `obs_pulse`, `obs_search_entities`, `obs_entity_detail`, `obs_alert_feed` y
   `obs_source_status`.
3. **Las capas no se mezclan.** Universo observado, listas internacionales e
   identidad digital tienen autoridad distinta y se presentan por separado. Lo
   externo es siempre candidato: no se persiste, no crea identidad canónica y no
   modifica la prioridad analítica de ninguna entidad.
4. **La autorización no se degrada.** La identidad la acredita Microsoft Entra,
   igual que ATLAS. Todos los contratos son `SECURITY INVOKER` y las tablas
   `obs_*` tienen RLS contra la misma lista `aml_allowed_users`. Un usuario
   autenticado fuera de la lista lee cero filas y ve una pantalla que se lo dice;
   `anon` no tiene privilegio de ejecución sobre ningún contrato.
5. **La ausencia de una fuente es ausencia, nunca un cero.** Una fuente no
   consultada jamás se presenta como una fuente que no encontró nada.
6. **Universos distintos permanecen explícitos.** Ejecución presupuestaria no es
   compra pública; padrón UAF no es universo económico.

### Aditivo sobre el proyecto existente

Los read models viven en el mismo proyecto Supabase que las tablas gobernadas,
porque ahí está el universo de entidades y así la materialización es SQL puro,
sin ETL entre proyectos ni credenciales cruzadas. Las migraciones sólo **crean**
objetos con prefijo `obs_`: no alteran, renombran ni eliminan nada de ATLAS.

## Puesta en marcha

```bash
npm install
cp .env.example .env     # apunta al proyecto Supabase que hospeda los obs_*
npm run dev
```

El acceso usa las cuentas que ya existen en ATLAS: se entra con Microsoft
Entra, no con contraseña. Iniciar sesión acredita identidad; lo que se puede
leer lo decide la política de la base de datos.

La URL de retorno de Entra debe estar registrada como *redirect URL* en Supabase
Auth. Por defecto la app usa su propio origen y ruta base, así que basta con
registrar la URL donde quede publicada.

### Variables

| Variable | Dónde | Para qué |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | variable de repositorio | proyecto que hospeda los `obs_*` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | variable de repositorio | clave publicable del cliente |
| `VITE_BASE` | variable de repositorio (opcional) | subruta si se sirve en `/atlas-observatorio/` |
| `VITE_AUTH_REDIRECT_TO` | variable de repositorio (opcional) | fuerza la URL de retorno de Entra |
| `SUPABASE_URL` | secreto | vigilancia de frescura |
| `SUPABASE_SERVICE_ROLE_KEY` | secreto | vigilancia de frescura |

La clave de servicio nunca llega al navegador. El refresco **no** la necesita:
lo ejecuta `pg_cron` dentro de la base.

## Operación

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | servidor de desarrollo |
| `npm run build` | verifica tipos y construye |
| `npm run typecheck` | sólo tipos |
| `node tests/render.mjs` | verifica que las vistas rendericen los contratos |
| `node scripts/capture-fixtures.mjs` | recaptura los fixtures desde los contratos vivos |

El corte se republica cada seis horas mediante `pg_cron`, dentro de la base. No
se ejecuta desde CI: la materialización tarda unos 25 s y PostgREST corta a los
8 s, así que una llamada RPC desde un job fallaría siempre (ver
`docs/ARQUITECTURA.md`). Para forzar un corte a mano, desde el editor SQL:

```sql
set statement_timeout to '600s';
select public.obs_refresh_all();
```

`.github/workflows/vigilancia.yml` no refresca: vigila. Cada seis horas
comprueba que el corte vigente no haya envejecido, que el último intento no haya
terminado en `FAILED` y que la agenda siga activa. Un planificador que se
detiene en silencio es peor que uno que falla ruidosamente.

## Base de datos

`supabase/migrations/` contiene, en orden, las migraciones que crean el
observatorio. Son idempotentes en su mayoría y todas aditivas.
