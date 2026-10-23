# Retiro de AML CLAUDE: controles reproducibles (sin impacto en producción)

**Fecha de captura:** 2026-10-23. **Estado:** NO APTO PARA CIERRE.

Esta rama no modifica los servicios publicados de Atlas. Contiene verificaciones de lectura, manifiestos de conteos agregados y un inventario de metadatos; **no incluye backups de bases, usuarios, secretos, funciones fuente ni registros personales**.

## Qué se verificó realmente
- Dos consultas SQL solo lectura ejecutadas por separado sobre el origen AML CLAUDE y el Atlas principal.
- Coinciden: snapshot `PS-2026-07-V1`, 72.802 proveedores, 494.867 relaciones del universo, 1.744 señales, 6.058 hallazgos y 72.802 entidades en el directorio de Atlas.
- 28 ejecuciones sin fallas del refresco del Observatorio y siete del directorio estatal en los últimos siete días.
- **BLOQUEO A:** último período de datos fuente `2026-07-01`, demasiado antiguo para aceptar paridad de frescura en octubre.
- **BLOQUEO B:** la ejecución del analizador `PROVIDER_ANALYZER_2026_09` figura FAILED en la fase de publicación. El análisis del workflow permite atribuir la falla a `git pull --rebase` antes de guardar los cambios. Corrección preparada como borrador: [Claude_AML PR #29](https://github.com/smoralesm07-source/Claude_AML/pull/29); NO FUSIONADA.
- **BLOQUEO C:** `provider_analyzer` contiene ~1,37 GB de tablas e índices y no existe todavía prueba de restauración independiente.
- **BLOQUEO D:** las alertas escolares siguen activas en AML CLAUDE; destino independiente todavía no creado. Rama de preparación: [calendario-escolar](https://github.com/smoralesm07-source/calendario-escolar/tree/migracion-alertas-escolares-aislada-20261023).

## Archivos
- `sql/origen_lectura.json.sql`: produce un JSON de datos **agregados**, sin PII, en AML CLAUDE.
- `sql/atlas_lectura.json.sql`: produce un JSON de datos agregados, sin PII, en Atlas principal.
- `linea_base_source_20261023.json` y `linea_base_core_20261023.json`: salidas reales guardadas solo con conteos y metadatos.
- `inventario_edge_deploy_20261023.json`: metadatos y huellas del código desplegado en las 15 Edge Functions; no equivale a conservar su código.
- `comparar_manifestos.py`: comparador offline, sin redes ni escritura en bases.

Para reproducir, copiar el valor de la columna `manifest` de cada consulta a archivos `source.json` y `core.json` y ejecutar:

```bash
python3 migracion_aml_claude/comparar_manifestos.py --source source.json --core core.json --today 2026-10-23
```

Un resultado exitoso demuestra solo **coincidencia estadística** de los manifiestos. No demuestra paridad del historial, autenticación, calidad funcional, renovaciones, seguridad ni capacidad de restauración.

## Requisitos que aún impiden retirar AML CLAUDE
1. Backup cifrado con hash del origen, preservando historial `provider_analyzer` y las tablas `ps_*`. Restauración satisfactoria en entorno aislado.
2. Conservación segura y versionada del código de las 15 Edge Functions, 43 rutinas SQL, configuraciones, roles y mecanismos Auth necesarios. Nunca publicar claves o dumps privados.
3. Sustituto con permisos correctos para `ps_export_for_observatory` y `ps_entity_query_for_observatory`, y pruebas de búsqueda/series históricas antes del cambio de endpoints.
4. Resolución del estado de actualización y validación de la frescura de fuentes.
5. Calendario escolar trasladado a otro entorno sin contaminar la seguridad ni la facturación de Atlas. Conservación de los 144 eventos, una suscripción y 64 entregas (línea base de octubre), sin duplicar envíos.
6. Verificación de cero tráfico productivo hacia AML CLAUDE después del cambio, con reversión definida.

**No ejecutar `DROP`, `DELETE`, `TRUNCATE`, desactivar Cron, sobrescribir `public` ni borrar proyectos como parte de esta rama.**
