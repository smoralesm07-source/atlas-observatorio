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
   `obs_spend_finding_feed`, `obs_spend_actor_detail`, `obs_uaf_pulse`,
   `obs_uaf_cohort` y `obs_uaf_subject_dossier`.
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

### El Pulso y la reportabilidad sectorial

El **Pulso** caracteriza el padrón de sujetos obligados —10.294 inscritos al
corte 30-06-2026— y responde cuatro preguntas en el orden en que las hace un
analista: de qué está hecho el padrón, cuánto reporta el universo obligado y
quién sostiene ese volumen, qué sujetos piden revisión hoy y por qué, y dónde
operan.

La reportabilidad es el único bloque que no nace de una tabla gobernada. No
existe ROS por sujeto en ninguna fuente disponible: la tabla de observaciones
de reporte está vacía y su vista de comportamiento devuelve `NOT_MATERIALIZED`
para los 10.294. Lo que sí existe es el agregado **sectorial** que la UAF
publica cada año en su Informe Estadístico, que Radar_UAF ya captura y versiona.
La migración `0010` lo trae como referencia con procedencia declarada —fuente,
método de captura y fecha de corte por cada valor— en dos tablas:

| Tabla | Qué guarda |
| --- | --- |
| `obs_uaf_reporting_national` | serie nacional por métrica y período: ROS, ROE, acciones de supervisión, padrón, ROS con indicios LA/FT |
| `obs_uaf_reporting_sector` | ROS por sector y año 2021-2025, intensidad por 100 inscritos, silencio quinquenal e índice de convertibilidad |

Tres condiciones que la pantalla declara en vez de esconder:

- **La reportabilidad es sectorial.** Ningún ROS se atribuye a una entidad.
- **Silencio no es incumplimiento.** El ROS se emite ante una operación
  sospechosa y no tiene periodicidad mínima: un sector sin ROS puede no haber
  tenido nada que reportar. Diez sectores no registran ninguno en cinco años.
- **Los denominadores no se mezclan.** La intensidad usa el padrón del Informe
  Estadístico al 31-12-2025 (9.911); el padrón operativo corta al 30-06-2026
  (10.294). Se muestran por separado.

El **motivo de atención** (`obs_uaf_subject.attention_motive`) es la otra pieza
nueva: una sola razón por sujeto, la de mayor precedencia, para que la cola de
revisión no repita al mismo nombre. Ordena trabajo de fiscalización y no imputa
incumplimiento ni riesgo LA/FT. La precedencia es sanción reciente, sanción
histórica, término de giro, IPF alta, sector sin ROS, giro atípico y ausencia de
territorio observado.

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

## Credencial de OpenSanctions

El screening internacional funciona hoy **sin** esta credencial: cuando falta, el
conector `aml-entity-global-watchlists-live` responde `credential_missing` y
conmuta solo al *fallback* oficial directo —OFAC, ONU, UE, Reino Unido, BID y
Banco Mundial, cada uno contra su propia fuente publicada—. Incorporar la clave
no reemplaza ese camino: agrega el agregador, que resuelve las seis listas en una
sola llamada y suma cobertura que las fuentes directas no publican.

En el código, la clave se lee así (`index.ts` del conector):

```ts
const key = Deno.env.get('OPENSANCTIONS_API_KEY');
if (!key) return { status: 'credential_missing', source: 'OPENSANCTIONS', … };
…
headers: { authorization: `ApiKey ${key}`, … }   // POST /match/default
```

El nombre del secreto es exactamente **`OPENSANCTIONS_API_KEY`**. Un nombre
distinto no falla: deja el conector en `credential_missing` para siempre.

### 1. Obtener la clave

1. Entra a <https://www.opensanctions.org> → sección **API**.
2. El endpoint que usa ATLAS es `POST /match/default`, del servicio comercial:
   requiere una licencia y una API key, no basta con una cuenta gratuita. Para
   uso institucional hay que contactarlos desde esa misma sección.
3. Al contratar, entregan una cadena de API key. Cópiala completa.

> No pude verificar desde aquí la página de planes de OpenSanctions —el proxy de
> red de esta sesión bloquea ese dominio—, así que confirma con ellos las
> condiciones de licencia vigentes antes de contratar. Lo que sí está verificado
> es todo lo de nuestro lado: el nombre del secreto, el formato del encabezado y
> el endpoint.

### 2. Cargar el secreto en Supabase

Por la consola:

1. <https://supabase.com/dashboard> → proyecto **`ldmtlwzqaqmegedktlxr`**
   (el que hospeda los `obs_*` y las funciones de borde).
2. Menú lateral → **Edge Functions** → pestaña **Secrets**.
3. **Add new secret**:
   - *Name*: `OPENSANCTIONS_API_KEY`
   - *Value*: la clave, sin comillas, sin el prefijo `ApiKey` y sin espacios al
     final. El conector arma el encabezado `ApiKey <clave>` por su cuenta; si lo
     incluyes en el valor, el encabezado queda `ApiKey ApiKey …` y la API
     responde 401.
4. **Save**.

Por CLI, si prefieres:

```bash
supabase secrets set OPENSANCTIONS_API_KEY='...' --project-ref ldmtlwzqaqmegedktlxr
```

El secreto queda a nivel de proyecto: lo ven todas las funciones de borde, no
sólo el conector de listas. Nunca llega al navegador — la app llama a la función,
y la función llama a OpenSanctions.

### 3. Reiniciar la función

Los secretos se leen en el arranque del runtime, así que la clave toma efecto
recién en el siguiente arranque en frío. Para no esperarlo, redespliega:

```bash
supabase functions deploy aml-entity-global-watchlists-live --project-ref ldmtlwzqaqmegedktlxr
```

O, desde la consola, **Edge Functions → aml-entity-global-watchlists-live →
Deploy**. No hay que cambiar ni una línea del código.

### 4. Verificar que quedó activa

Desde la app: **Entidades → busca un nombre → Listas internacionales**. El panel
deja de decir *Sin credencial* y las coincidencias pasan a llegar por el
agregador.

Desde la terminal, sin abrir la app:

```bash
curl -s -X POST \
  'https://ldmtlwzqaqmegedktlxr.supabase.co/functions/v1/aml-entity-global-watchlists-live' \
  -H "Authorization: Bearer $SUPABASE_PUBLISHABLE_KEY" \
  -H 'content-type: application/json' \
  -d '{"name":"Vladimir Putin","entity_type":"persona"}' \
  | jq '.routing'
```

Antes: `"opensanctions_status": "credential_missing"`, `"fallback_used": true`.
Después: `"opensanctions_status": "fresh"`, `"fallback_used": false`.

Otros valores posibles y qué significan:

| `opensanctions_status` | Qué pasó |
| --- | --- |
| `credential_missing` | El secreto no existe o se llama distinto |
| `quota_exhausted` | La API respondió 429: se acabó la cuota del plan |
| `degraded` | Error de red o HTTP; el campo `error` trae el detalle |
| `fresh` | Funcionando |

En los tres primeros casos el conector conmuta solo al *fallback* directo y lo
declara en `fallback_reason`. El screening nunca se queda sin respuesta por una
credencial.

### 5. Dejarlo asentado en el catálogo

La pantalla de Fuentes seguirá mostrando OpenSanctions *sin señal* hasta que
exista el registro de consultas (ver `docs/ARQUITECTURA.md`), porque hoy nada
persiste el resultado de una consulta bajo demanda. Si quieres reflejar el cambio
de inmediato, actualiza su nota en el catálogo:

```sql
update public.aml_external_source_health
   set software_status = 'healthy',
       notes = 'Agregador preferente con credencial activa. Si la cuota o el servicio fallan, ATLAS conmuta automáticamente a las fuentes oficiales directas.'
 where source_code = 'OPENSANCTIONS';
```

El cambio se refleja en la app en el corte siguiente, o antes si fuerzas un
refresco.

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
