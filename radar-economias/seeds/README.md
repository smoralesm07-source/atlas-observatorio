# Fuentes curadas

Dos fuentes oficiales todavía no tienen un formato que se pueda leer de forma
automática y estable, así que se cargan a mano. Cada fila cita la publicación
de la que sale.

| Archivo | Fuente | Qué va en cada fila |
| --- | --- | --- |
| `cmf_alertas.csv` | Alertas de fraude de la CMF sobre entidades no autorizadas | una entidad o marca alertada |
| `subtel_bloqueos.csv` | Órdenes de bloqueo de sitios de apuestas (Subtel / Corte de Apelaciones) | un dominio con orden de bloqueo |

Columnas: `name`, `domain` (opcional), `published` (AAAA-MM-DD o AAAA-MM),
`source_url` (obligatoria) y `note`.

Mientras un archivo no tenga filas, su fuente aparece como **no consultada**.
Un archivo vacío no significa que no existan entidades alertadas.

Las tres filas iniciales de `cmf_alertas.csv` vienen de la prensa (oct 2026) y
deben contrastarse con el listado oficial de la CMF antes de usarlas.
