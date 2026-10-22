# Cribado de nóminas: PEP y Poder Judicial

Pantalla `#/cribado`. El analista carga la nómina de un requerimiento (CSV o
filas pegadas, con RUT y, si lo trae, nombre) y recibe, por fila, el estado de
dos líneas con tres valores: **con registro**, **sin registro** y **no
consultada**.

La nómina no se guarda. Lo único que persiste es la verificación judicial que
un analista registra a mano.

## Línea PEP

En Chile no existe un listado PEP oficial y público. La fuente abierta más
amplia son las declaraciones de intereses y patrimonio de la Ley 20.880, que
publica InfoProbidad (CPLT), más las nóminas del Senado y de la Cámara.
OpenSanctions las publica estructuradas como datasets PEP:

| Dataset | Contenido |
| --- | --- |
| `cl_info_probidad` | autoridades y funcionarios obligados a declarar que OpenSanctions considera PEP |
| `cl_senate` | senadores actuales y recientes |
| `cl_chamber_deputies` | diputados actuales y recientes |

`atlas-pep-ingest` descarga los tres (formato FollowTheMoney), reconstruye los
cargos y los carga en `obs_pep_record`. Corre todos los lunes vía `pg_cron`.
Cada carga queda en `obs_pep_load`; si un dataset nunca cargó, la línea PEP sale
**no consultada**, nunca *sin registro*.

Límites que la pantalla declara:

- **Ninguna fuente trae RUT.** El cruce es por nombre (tokens ordenados, así
  «PÉREZ SOTO JUAN» coincide con «Juan Pérez Soto»), y toda coincidencia es
  candidata. Con nombre exacto la confianza es 0,99; las aproximadas entran
  desde una similitud de 0,60.
- **Si la nómina trae sólo RUT**, el nombre se toma del universo ATLAS. Si el
  RUT no está ahí, la fila queda *sin nombre para cruzar*.
- **La cobertura no es la de la Circular UAF.** Quedan fuera los familiares y
  los asociados cercanos, y los cargos que no declaran ante InfoProbidad.
- **Licencia.** OpenSanctions publica bajo CC BY-NC 4.0. Antes de pasar a
  producción hay que confirmar con ellos que el uso de un organismo público
  califica como no comercial.

### Puesta en marcha

```bash
supabase db push                                   # aplica 20261022_obs_nomina_screening_pep_judicial.sql
supabase secrets set ATLAS_PEP_CRON_TOKEN='<token-largo-aleatorio>' --project-ref ldmtlwzqaqmegedktlxr
supabase functions deploy atlas-pep-ingest --project-ref ldmtlwzqaqmegedktlxr
```

En el editor SQL, el mismo token en Vault para la agenda:

```sql
select vault.create_secret('<token-largo-aleatorio>', 'atlas_pep_cron_token');
select public.obs_pep_trigger_ingest();            -- primera carga, sin esperar al lunes
select dataset, status, row_count, finished_at, error
  from public.obs_pep_load order by started_at desc;
```

## Línea Poder Judicial

No hay fuente abierta para consultar en lote. La Consulta Unificada de Causas
de la Oficina Judicial Virtual es individual y tiene CAPTCHA. Por RUT sólo busca
personas jurídicas: a las personas naturales se las busca por nombre. Este
módulo **no la automatiza**: hacerlo exige resolver el CAPTCHA, puede chocar con
los términos de uso del sitio y se rompe sin aviso.

Lo que sí hace:

1. Cada fila trae un enlace a la Oficina Judicial Virtual y un botón **Registrar
   verificación** (con causas, sin causas o no verificable, más ROL, RIT o
   tribunal).
2. Lo registrado queda en `obs_judicial_check` con autor y fecha, y aparece en
   las nóminas siguientes que incluyan ese RUT. Lo no verificado queda **no
   consultado**.

### Ruta para tener acceso masivo

La vía sostenible es un **convenio de interoperabilidad con la Corporación
Administrativa del Poder Judicial (CAPJ)**. Hay precedentes: un convenio con la
SBIF (2013) para consultas por RUT, y otro con el SII (2019) mediante web
service. Ese web service consulta por rol, no por RUT, así que el convenio
tendría que pedir explícitamente la búsqueda por RUT de litigantes. Cuando
exista un endpoint, se agrega como otra fuente de `obs_judicial_check` (con
`source` distinto de `PJUD_CONSULTA_UNIFICADA`) sin tocar la pantalla.

Hay servicios comerciales que exponen la consulta de PJUD por API (por ejemplo,
Khipu, para personas jurídicas). Funcionan sobre el sitio público y tienen costo
por consulta, así que no reemplazan al convenio.
