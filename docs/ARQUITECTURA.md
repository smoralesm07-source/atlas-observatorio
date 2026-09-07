# Arquitectura del Observatorio

## Por qué una app nueva y no una versión más de ATLAS

ATLAS funciona, pero su runtime creció por acumulación: más de doscientos
archivos versionados (`v016` … `v0527`) cargados por orden de aparición, con
capas sucesivas de *fix*, *hardening* y *authority* compitiendo por el control de
la misma ruta. Cada corrección nueva tiene que negociar con las anteriores.

El Observatorio no reescribe ATLAS ni lo toca. Toma los mismos datos gobernados y
los expone por un camino distinto y corto:

```
FUENTES GOBERNADAS  →  obs_refresh_all()  →  obs_*  →  contratos RPC  →  app
```

Un único escritor, cinco contratos, una app con build. No hay capas de
autoridad en competencia porque no hay dos caminos hacia el mismo dato.

## Dónde viven los read models

En el mismo proyecto Supabase que las tablas Fusion (`aml_entities`,
`aml_findings`, `aml_pattern_alerts`, `aml_sanctions`, padrón UAF, OSFL, IPA3).

La razón es operativa: ahí está el universo de entidades, así que la
materialización es `INSERT … SELECT` puro. Ubicarlos en otro proyecto habría
exigido un ETL entre proyectos, credenciales cruzadas y una copia de 50 mil
entidades que se puede desincronizar. Además, la app usa un solo cliente y una
sola sesión, en vez del intercambio federado de sesión que ATLAS necesita hoy.

Esto es seguro porque las migraciones son estrictamente aditivas: sólo crean
objetos con prefijo `obs_`. Ningún objeto de ATLAS se altera, renombra ni
elimina, y ninguna ruta actual cambia de comportamiento.

## Las cinco reglas

1. **Calcular, publicar, mostrar.** El trabajo pesado ocurre una vez cada seis
   horas en `obs_refresh_all()`. Ninguna pantalla lo repite. Un corte declara
   `snapshot_id`, `row_counts` y `published_at`; si no termina en `READY`, no se
   publica y el job falla.
2. **Una pantalla consume un contrato.** `obs_pulse`, `obs_search_entities`,
   `obs_entity_detail`, `obs_alert_feed`, `obs_source_status`. Cambiar la forma
   de un contrato exige una versión nueva; las tablas `obs_*` no son API.
3. **La autorización no se degrada.** Contratos `SECURITY INVOKER` sobre RLS
   ligado a `aml_allowed_users`. Verificado: un usuario autenticado fuera de la
   lista lee cero filas y la ficha devuelve `null`. `anon` no tiene `EXECUTE`.
4. **La ausencia de una fuente es ausencia, nunca un cero.** `obs_entity_source`
   guarda sólo filas `PRESENT`; el estado `ABSENT` o `NOT_CONSULTED` se deriva al
   leer, contra el catálogo de fuentes. Por eso la ficha distingue *sin registro*
   (se preguntó, no aparece) de *no consultada* (no se preguntó).
5. **Universos distintos permanecen explícitos.** El observatorio conecta
   fuentes sin pretender que sus montos, poblaciones o granos sean comparables.

## Búsqueda de entidades

Es la operación primaria, así que tiene su propio diseño:

- `name_search` guarda el nombre en minúsculas, sin acentos ni puntuación, con
  índice GIN trigram.
- `rut_search` guarda el RUT reducido a dígitos y DV, con índice de prefijo. Lo
  escribe la propia materialización, no un backfill posterior: un corte publicado
  con el índice de RUT vacío rompería la búsqueda en silencio.
- La función decide primero **qué le escribieron**. Si la consulta es
  mayoritariamente numérica se resuelve por el índice de RUT; si no, por trigram.
  Cuando ambos predicados vivían en un mismo `OR`, el planificador recorría las
  50 mil filas ejecutando una expresión regular por fila: 960 ms. Separadas por
  rama: 134 ms.
- Resuelven todas las formas de escribir un RUT: `97.080.000-K`, `97080000-K`,
  `97080000-k`, `97080000` y prefijos parciales.

## Verificación

- **Contratos y autorización**: en la base, simulando el rol `authenticated` con
  los claims de un analista habilitado y de uno que no lo está.
- **Render**: `tests/render.mjs` levanta el bundle construido, intercepta las
  llamadas RPC con payloads reales capturados de los contratos vivos, y recorre
  las seis vistas, las pestañas de la ficha, el tema claro y el ancho de teléfono.

## Lo que falta conectar

`RADAR_CGR`, `RADAR_DELICTUAL`, `MERCADO_PUBLICO` y `PRESUPUESTO_ABIERTO` están
declarados en el catálogo de fuentes pero todavía no aportan vínculos por
entidad: la interfaz los muestra honestamente como *en silencio* en lugar de
omitirlos. Conectarlos consiste en que sus productores escriban `entity_id` en el
perfil Fusion; el Observatorio los recoge en el corte siguiente sin cambios de
código.

Las listas internacionales (OFAC, ONU, UE, Reino Unido, Banco Mundial, BID,
OpenSanctions) y las herramientas OSINT operan bajo demanda por entidad. Hoy la
ficha las declara como *no consultadas*; el siguiente paso es ejecutarlas desde
la ficha y persistir el resultado como una fila `PRESENT` o `ABSENT` con su
fecha de consulta.
