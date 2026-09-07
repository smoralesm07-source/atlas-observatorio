# ATLAS Observatorio

Monitor de fuentes abiertas para análisis de entidades. Es una aplicación nueva,
construida en paralelo a ATLAS, que no modifica ni un objeto del ATLAS actual:
lee los mismos datos gobernados a través de contratos propios.

## Qué es

- Un **monitor global** del estado de las fuentes abiertas gobernadas.
- Una **superficie de anticipación**: los patrones que se activan sobre el
  conjunto, ordenados por prioridad e intensidad.
- Un **buscador de entidades** por nombre o RUT que responde, de inmediato, qué
  información tiene el observatorio sobre esa entidad y desde qué fuente.
- Una **ficha de observación** que distingue tres estados por fuente: con
  registro, sin registro y no consultada.

## Qué no es

- No es un expediente ni un sistema de gestión de casos.
- No asigna tareas a fiscalizadores.
- No es un ROS, una denuncia ni una decisión institucional.

## Arquitectura

```
FUENTES GOBERNADAS  →  obs_refresh_all()  →  read models obs_*  →  contratos RPC  →  app
   (tablas Fusion)      (una sola escritura)   (corte versionado)   (SECURITY INVOKER)
```

Reglas que sostienen el diseño:

1. **Calcular, publicar, mostrar.** Ninguna pantalla reconstruye universos en el
   navegador. El trabajo pesado ocurre en `obs_refresh_all()` y se publica como
   un corte con identidad (`snapshot_id`, `row_counts`, `published_at`).
2. **Una pantalla consume un contrato, no una tabla.** Los cinco contratos son
   `obs_pulse`, `obs_search_entities`, `obs_entity_detail`, `obs_alert_feed` y
   `obs_source_status`.
3. **La autorización no se degrada.** Todos los contratos son `SECURITY INVOKER`
   y las tablas `obs_*` tienen RLS contra la misma lista `aml_allowed_users` que
   ya gobierna ATLAS. Un usuario autenticado fuera de la lista lee cero filas.
   `anon` no tiene privilegio de ejecución sobre ningún contrato.
4. **La ausencia de una fuente es ausencia, nunca un cero.** Una fuente no
   consultada jamás se presenta como una fuente que no encontró nada.
5. **Universos distintos permanecen explícitos.** Ejecución presupuestaria no es
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

El acceso usa las cuentas que ya existen en ATLAS. Iniciar sesión acredita
identidad; lo que se puede leer lo decide la política de la base de datos.

### Variables

| Variable | Dónde | Para qué |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | variable de repositorio | proyecto que hospeda los `obs_*` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | variable de repositorio | clave publicable del cliente |
| `VITE_BASE` | variable de repositorio (opcional) | subruta si se sirve en `/atlas-observatorio/` |
| `SUPABASE_URL` | secreto | refresco programado |
| `SUPABASE_SERVICE_ROLE_KEY` | secreto | única credencial que escribe los `obs_*` |

La clave de servicio nunca llega al navegador: sólo la usa el job de refresco.

## Operación

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | servidor de desarrollo |
| `npm run build` | verifica tipos y construye |
| `npm run typecheck` | sólo tipos |
| `node tests/render.mjs` | verifica que las vistas rendericen los contratos |
| `node scripts/capture-fixtures.mjs` | recaptura los fixtures desde los contratos vivos |

El corte se republica cada seis horas (`.github/workflows/refresh.yml`) y puede
lanzarse a mano desde Actions. Un corte que no termine en `READY` falla el job:
un read model desactualizado pero honesto es aceptable, uno a medio escribir no.

## Base de datos

`supabase/migrations/` contiene, en orden, las migraciones que crean el
observatorio. Son idempotentes en su mayoría y todas aditivas.
