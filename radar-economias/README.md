# Radar de economías criminales

Prototipo independiente de ATLAS. Sigue los mercados ilícitos que se anuncian en
la dark web y en canales similares, y los lee desde la pregunta de LA/FT: **qué
economías criminales tocan a entidades y mercados chilenos, y por qué rieles del
sistema financiero podría entrar o salir su dinero**.

Vive en esta carpeta sin tocar nada de ATLAS. No importa código de la app ni de
sus migraciones, ni usa su proyecto Supabase. Se puede mover a un repositorio
propio copiando la carpeta y el workflow `.github/workflows/radar-economias.yml`.

## Qué es y qué no es

- **Es** un monitor de *hechos publicados*: que un grupo de ransomware reivindicó a
  una entidad chilena, que un dominio de phishing imita a un banco chileno, que
  OFAC designó una dirección cripto nueva, que un mercado de tarjetas sigue activo.
- **No** descarga filtraciones, no visita sitios `.onion` ni dominios de phishing,
  no guarda direcciones de acceso a mercados ni enlaces de invitación, y no trata
  datos de personas naturales.
- **No** es un ROS, una denuncia ni una decisión institucional. Una reivindicación
  no confirma un incidente y un dominio de phishing no prueba un fraude consumado.

## Economías y fuentes

| Economía | Fuente | Estado en el primer corte | Riesgo legal |
| --- | --- | --- | --- |
| Extorsión digital (ransomware) | ransomware.live API v2 (víctimas por país) | no alcanzable desde la sesión de desarrollo; debería responder en GitHub Actions | nombres de organizaciones |
| | ransomwatch (archivo 2020-2025) | **19 reivindicaciones** sobre entidades chilenas | nombres de organizaciones |
| Comercio de datos robados | Have I Been Pwned, catálogo de brechas (sólo servicios) | no alcanzable desde la sesión de desarrollo | metadatos públicos |
| | Canales públicos de Telegram | **desactivada** hasta tener informe jurídico | requiere informe |
| Fraude por suplantación | Phishing.Database (dominios activos) | **34 dominios** que imitan marcas chilenas | metadatos públicos |
| | OpenPhish (feed público) | respondió, sin coincidencias | metadatos públicos |
| Servicios financieros no autorizados | Alertas de la CMF (curado) | 3 marcas, por contrastar con la CMF | metadatos públicos |
| Apuestas ilegales | Órdenes de bloqueo de la Subtel (curado) | **no consultada**: falta cargar la lista | metadatos públicos |
| Criptoactivos sancionados | OFAC SDN, direcciones cripto | **1.060 direcciones** en 18 redes (línea base) | metadatos públicos |
| Ecosistema de mercados y foros | deepdarkCTI | 129 mercados, 238 foros, 484 sitios de ransomware y 398 canales activos; 4 actores orientados a Chile o Latinoamérica | metadatos públicos |

El estado de cada fuente se publica en cada corte. Distinguimos *respondió*,
*archivo histórico*, *respondió con error*, *no respondió* y *no consultada*.
Una economía sin ninguna fuente que haya respondido se muestra **sin lectura**,
nunca con un cero.

## Estructura

```
collectors/   recolectores en Python (sólo biblioteca estándar) y sus pruebas
seeds/        fuentes curadas a mano: alertas CMF y bloqueos Subtel
data/         el corte publicado: latest.json, snapshots/, history.json, watchlists/
app/          interfaz React + Vite que lee data/latest.json
supabase/     modelo rad_* y contratos para cuando pase a base de datos
```

## Uso

```bash
# Corte nuevo (lee el anterior para marcar hechos nuevos y arrastrar fuentes caídas)
cd collectors
python -m unittest -v
python -m radar.run                       # escribe en ../data
python -m radar.run --only PHISHING_DATABASE,OFAC_CRYPTO

# Interfaz
cd ../app
npm install
npm run dev                               # http://localhost:5173
npm run build
```

En GitHub, `.github/workflows/radar-economias.yml` arma un corte cada 6 horas y lo
publica en la rama `radar-economias-state`, para no llenar `main` de commits de
datos. No necesita secretos. Mientras el workflow no esté en la rama por defecto,
la programación no corre; se puede lanzar a mano desde *Actions*.

## Reglas de diseño (las mismas del Observatorio de ATLAS)

1. **El hecho, nunca el contenido.**
2. **Calcular, publicar, mostrar.** Cada corte tiene `snapshot_id`, huella sha256
   del contenido leído por fuente y la lista de hechos nuevos respecto del anterior.
3. **La ausencia de una fuente es ausencia, nunca un cero.** Si una fuente no
   responde, sus hechos del corte anterior se arrastran marcados como tales.
4. **Las capas no se mezclan.** Lo global (OFAC, ecosistema) se separa de lo que
   tiene vínculo con Chile, y cada vínculo declara su razón y su confianza.
5. **Lo externo es candidato.** Al integrarse, nada de esto modifica la prioridad
   analítica de una entidad en ATLAS.

## Camino de integración con ATLAS

1. Pasar el corte a un proyecto Supabase propio con `supabase/0001_rad_foundation.sql`.
   La migración ya se probó dos veces seguidas sobre Postgres 16: es idempotente,
   los contratos responden y un usuario no habilitado lee cero filas.
2. Reemplazar `collectors/radar/brands.py` por el universo de proveedores de pago
   de ATLAS (CMF, SII, PSP), para que cada marca suplantada llegue con su RUT.
3. Exponer a ATLAS dos contratos por un puente servidor a servidor, como el de
   compras públicas: `rad_entity_exposure(rut, dominio)` para la ficha de entidad y
   `rad_economy_overview()` para el panel sectorial.
4. Usar el mismo login de Microsoft Entra y la misma lista `aml_allowed_users`.

## Próximos módulos

- **Apuestas ilegales**: cargar la lista de la Subtel; detectar dominios espejo
  (Certificate Transparency, huellas compartidas); extraer los medios de pago que
  cada sitio *declara públicamente* y cruzarlos con el padrón UAF.
- **Exposición cripto**: rastrear desde direcciones publicadas en sitios ilícitos y
  en causas judiciales hacia billeteras de exchanges que operan en Chile, usando la
  lista OFAC como vigilancia.
- **Cuentas mula**: sólo con informe jurídico favorable (Ley 21.459 art. 6 y
  Ley 21.719), y registrando únicamente la institución mencionada, el precio y la fecha.
