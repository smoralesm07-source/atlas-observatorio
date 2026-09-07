# ATLAS Observatorio

Monitor de fuentes abiertas para análisis de entidades. Es una aplicación nueva,
construida en paralelo a ATLAS, que no modifica ni un objeto del ATLAS actual:
lee los mismos datos gobernados a través de contratos propios.

## Qué es

- Un **monitor global** del estado de las fuentes abiertas gobernadas.
- Una **superficie de anticipación**: los patrones que se activan sobre el
  conjunto, ordenados por prioridad e intensidad.
- Una lectura de **territorio** (IGR v2A, amenaza territorial CEAD-LA) y de
  **sectores obligados** (padrón UAF, vulnerabilidad estructural, IPF), cada una
  con su metodología a la vista y sus exclusiones declaradas.
- Una lectura de **gasto público y compras**: patrones de concentración,
  trayectoria, precios y convergencia sobre la relación comprador–proveedor en
  ChileCompra, junto a —y nunca sumada con— la ejecución presupuestaria.
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
FUENTES GOBERNADAS  →  obs_refresh_full()  →  read models obs_*  →  contratos RPC  →  app
   (tablas Fusion)      (pg_cron, cada 6 h)    (corte versionado)   (SECURITY INVOKER)
        ↑
  pipeline de compras del proyecto core, vía puente servidor a servidor
```

Reglas que sostienen el diseño:

1. **Calcular, publicar, mostrar.** Ninguna pantalla reconstruye universos en el
   navegador. El trabajo pesado ocurre en `obs_refresh_all()` y se publica como
   un corte con identidad (`snapshot_id`, `row_counts`, `published_at`).
2. **Una pantalla consume un contrato, no una tabla.** Los contratos son
   `obs_pulse`, `obs_search_entities`, `obs_entity_detail`, `obs_alert_feed`,
   `obs_source_status`, `obs_territory_map`, `obs_territory_detail`,
   `obs_sector_overview`, `obs_sector_detail`, `obs_spend_overview`,
   `obs_spend_finding_feed` y `obs_spend_actor_detail`.
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
   compra pública; padrón UAF no es universo económico. La pantalla de gasto
   público los separa en dos bloques y nunca los agrega en una sola cifra.

### Aditivo sobre el proyecto existente

Los read models viven en el mismo proyecto Supabase que las tablas gobernadas,
porque ahí está el universo de entidades y así la materialización es SQL puro,
sin ETL entre proyectos ni credenciales cruzadas. Las migraciones sólo **crean**
objetos con prefijo `obs_`: no alteran, renombran ni eliminan nada de ATLAS.

La única excepción son las métricas de compras públicas, que las calcula el
pipeline de perfilado en el proyecto core de ATLAS. Lo que el Observatorio
agrega allí está en `supabase/core-project/`: una función de sólo lectura y un
índice. Nada más, y nada existente se modifica.

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
select public.obs_refresh_full();
```

`obs_refresh_full()` materializa el universo, el territorio, los sectores y el
corte de compras bajo un mismo `snapshot_id`.

`.github/workflows/vigilancia.yml` no refresca: vigila. Cada seis horas
comprueba que el corte vigente no haya envejecido, que el último intento no haya
terminado en `FAILED` y que la agenda siga activa. Un planificador que se
detiene en silencio es peor que uno que falla ruidosamente.

## Base de datos

`supabase/migrations/` contiene, en orden, las migraciones que crean el
observatorio. Son idempotentes en su mayoría y todas aditivas.

`supabase/core-project/` **no se aplica aquí**: contiene lo que el puente de
compras necesita en el proyecto core de ATLAS, versionado para que el mecanismo
quede completo en un solo repositorio.

### Secretos del puente

El puente hacia el pipeline de compras usa tres secretos en Vault del proyecto
del Observatorio —`obs_bridge_url`, `obs_bridge_apikey` y `obs_bridge_token`— y
el mismo `obs_bridge_token` en Vault del proyecto core. Ninguno llega al
navegador: `obs_bridge_fetch()` es `SECURITY DEFINER` y sólo `service_role`
puede ejecutarla.
