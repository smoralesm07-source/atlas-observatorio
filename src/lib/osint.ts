/* Ubicación de un caso en fuentes abiertas
   ────────────────────────────────────────
   Un fiscalizador que abre un caso de inscripción o de desinscripción necesita
   una cosa que el padrón no trae: cómo alcanzar a la entidad. El Observatorio
   no compra bases de contacto ni raspa sitios: arma la consulta correcta a la
   fuente pública que corresponde y la abre en el buscador o en el registro.

   LÍMITES DECLARADOS:
    * Una consulta no es un dato. Lo que devuelve el buscador es una propuesta
      de contacto que el fiscalizador tiene que verificar antes de usarla en una
      gestión formal.
    * Abrir un enlace envía la razón social o el RUT al servicio externo. Es
      información pública del padrón, pero el hecho se declara en la interfaz.
    * Ningún enlace acredita vigencia, representación ni domicilio. Eso lo
      resuelve el registro que corresponda, no un resultado de búsqueda.
    * No se incluyen intermediarios de datos personales («rutificadores»): la
      misma respuesta se obtiene en registros oficiales sin ese costo. */

export interface LocateTarget {
  rut: string;
  name: string;
  region?: string | null;
  commune?: string | null;
  sector?: string | null;
}

export type LocateKind = 'buscador' | 'registro' | 'directorio' | 'red' | 'prensa';

export interface LocateLink {
  id: string;
  label: string;
  /** Qué devuelve la consulta, en términos del trabajo del fiscalizador. */
  hint: string;
  url: string;
  kind: LocateKind;
  /** Verdadero cuando la fuente pide escribir el RUT en su propio formulario. */
  manual?: boolean;
}

export interface LocateGroup {
  id: string;
  title: string;
  purpose: string;
  links: LocateLink[];
}

const google = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

/** El nombre del padrón llega en mayúsculas y con espacios dobles. Entre
 *  comillas, un espacio de más rompe la coincidencia exacta del buscador. */
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Un RUT con puntos no coincide con el mismo RUT sin puntos: las dos formas
 *  circulan en sitios públicos, así que la consulta pide las dos. */
export function rutForms(rut: string): { plain: string; dotted: string; body: string; dv: string } {
  const bare = (rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();
  const body = bare.slice(0, -1);
  const dv = bare.slice(-1);
  return {
    plain: body && dv ? `${body}-${dv}` : bare,
    dotted: body && dv
      ? `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`
      : bare,
    body,
    dv,
  };
}

export function locateGroups(target: LocateTarget): LocateGroup[] {
  const name = clean(target.name);
  const { plain, dotted } = rutForms(target.rut);
  const rutPair = `("${plain}" OR "${dotted}")`;
  const place = clean([target.commune, target.region].filter(Boolean).join(' '));
  const site = (host: string, q: string) => google(`site:${host} ${q}`);

  return [
    {
      id: 'contacto',
      title: 'Contacto directo',
      purpose: 'Teléfono, correo, domicilio comercial y sitio propio de la entidad.',
      links: [
        {
          id: 'contacto-general',
          label: 'Razón social + contacto',
          hint: 'La consulta más productiva: sitio propio, teléfono y correo publicados.',
          url: google(`"${name}" (contacto OR teléfono OR correo OR email)`),
          kind: 'buscador',
        },
        {
          id: 'contacto-rut',
          label: 'RUT en la web abierta',
          hint: 'En Chile el RUT viaja en facturas, boletas y pies de página: suele llevar al sitio real.',
          url: google(rutPair),
          kind: 'buscador',
        },
        {
          id: 'contacto-sitio',
          label: 'Sitio oficial',
          hint: 'Página institucional, «quiénes somos» y formulario de contacto.',
          url: google(`"${name}" (sitio OR web OR "quiénes somos" OR "contáctanos")`),
          kind: 'buscador',
        },
        {
          id: 'contacto-telefono',
          label: 'Teléfono publicado',
          hint: 'Formatos chilenos de fono fijo y móvil junto a la razón social.',
          url: google(`"${name}" ("+56" OR fono OR teléfono OR whatsapp)`),
          kind: 'buscador',
        },
        {
          id: 'contacto-mapa',
          label: 'Domicilio en el mapa',
          hint: place
            ? `Ficha de lugar con dirección y horario en ${place}.`
            : 'Ficha de lugar con dirección y horario.',
          url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${place}`.trim())}`,
          kind: 'directorio',
        },
        {
          id: 'contacto-directorio',
          label: 'Directorios comerciales',
          hint: 'Guías de empresas y clasificados con teléfono de mesa central.',
          url: google(`("${name}") (site:amarillas.cl OR site:paginasamarillas.cl OR site:guiaempresas.cl OR site:emis.com)`),
          kind: 'directorio',
        },
      ],
    },
    {
      id: 'registro',
      title: 'Identidad y vigencia registral',
      purpose: 'Confirmar que la entidad es la que se busca y en qué estado está.',
      links: [
        {
          id: 'registro-sii',
          label: 'SII · situación tributaria',
          hint: 'Estado del contribuyente y actividades vigentes. Pide el RUT en su formulario.',
          url: 'https://zeus.sii.cl/cvc/stc/stc.html',
          kind: 'registro',
          manual: true,
        },
        {
          id: 'registro-res',
          label: 'Registro de Empresas y Sociedades',
          hint: 'Constitución, modificaciones y domicilio de sociedades del régimen simplificado.',
          url: 'https://www.registrodeempresasysociedades.cl/BuscarEmpresa.aspx',
          kind: 'registro',
          manual: true,
        },
        {
          id: 'registro-res-web',
          label: 'RES indexado',
          hint: 'Actuaciones del RES que el buscador ya indexó para este RUT.',
          url: site('registrodeempresasysociedades.cl', rutPair),
          kind: 'buscador',
        },
        {
          id: 'registro-diario',
          label: 'Diario Oficial',
          hint: 'Constitución, modificación, disolución y extractos societarios publicados.',
          url: site('diariooficial.interior.gob.cl', `${rutPair} OR "${name}"`),
          kind: 'registro',
        },
        {
          id: 'registro-concursal',
          label: 'Boletín Concursal',
          hint: 'Liquidación o reorganización: explica un término de giro y da el liquidador como contacto.',
          url: site('boletinconcursal.cl', `${rutPair} OR "${name}"`),
          kind: 'registro',
        },
      ],
    },
    {
      id: 'huella',
      title: 'Huella pública y representación',
      purpose: 'Dónde aparece la entidad ante el Estado y quién la representa.',
      links: [
        {
          id: 'huella-mercadopublico',
          label: 'Mercado Público',
          hint: 'Ficha de proveedor: contacto comercial declarado ante ChileCompra.',
          url: google(`(site:mercadopublico.cl OR site:chileproveedores.cl) ${rutPair}`),
          kind: 'registro',
        },
        {
          id: 'huella-cmf',
          label: 'CMF',
          hint: 'Entidades fiscalizadas, resoluciones y domicilio informado al regulador.',
          url: site('cmfchile.cl', `${rutPair} OR "${name}"`),
          kind: 'registro',
        },
        {
          id: 'huella-pjud',
          label: 'Poder Judicial',
          hint: 'Causas donde la entidad comparece: el escrito trae domicilio y apoderado.',
          url: google(`(site:pjud.cl OR site:oficinajudicialvirtual.pjud.cl) "${name}"`),
          kind: 'registro',
        },
        {
          id: 'huella-inapi',
          label: 'INAPI · marcas',
          hint: 'Solicitudes de marca: el titular declara domicilio y representante.',
          url: site('inapi.cl', `${rutPair} OR "${name}"`),
          kind: 'registro',
        },
        {
          id: 'huella-representante',
          label: 'Representante legal',
          hint: 'Menciones de gerente, socio o representante junto a la razón social.',
          url: google(`"${name}" ("representante legal" OR gerente OR socio OR "director")`),
          kind: 'buscador',
        },
      ],
    },
    {
      id: 'digital',
      title: 'Presencia digital',
      purpose: 'Canales activos cuando la entidad no publica teléfono ni correo.',
      links: [
        {
          id: 'digital-linkedin',
          label: 'LinkedIn',
          hint: 'Página de empresa, tamaño declarado y personas que dicen trabajar ahí.',
          url: site('linkedin.com/company', `"${name}" Chile`),
          kind: 'red',
        },
        {
          id: 'digital-social',
          label: 'Redes sociales',
          hint: 'Perfiles con mensajería directa, dirección y horario de atención.',
          url: google(`("${name}") (site:facebook.com OR site:instagram.com)`),
          kind: 'red',
        },
        {
          id: 'digital-empleo',
          label: 'Avisos de empleo',
          hint: 'Un aviso vigente prueba operación y suele traer correo de contacto.',
          url: google(`"${name}" (site:laborum.cl OR site:trabajando.com OR site:computrabajo.cl)`),
          kind: 'red',
        },
      ],
    },
    {
      id: 'prensa',
      title: 'Menciones y contexto',
      purpose: 'Qué se ha publicado de la entidad, para encuadrar la gestión.',
      links: [
        {
          id: 'prensa-news',
          label: 'Google Noticias',
          hint: 'Menciones fechadas en medios indexados.',
          url: `https://news.google.com/search?q=${encodeURIComponent(`"${name}"`)}&hl=es-419`,
          kind: 'prensa',
        },
        {
          id: 'prensa-sector',
          label: 'Mención con su sector',
          hint: target.sector
            ? `Cómo aparece la entidad asociada a «${clean(target.sector)}».`
            : 'Cómo aparece la entidad asociada a su giro.',
          url: google(`"${name}" ${target.sector ? `"${clean(target.sector)}"` : ''}`.trim()),
          kind: 'buscador',
        },
      ],
    },
  ];
}

/** Las tres consultas con mayor rendimiento para dar con un contacto. Se abren
 *  juntas cuando el fiscalizador empieza un caso. */
export const LOCATE_FIRST_PASS = ['contacto-general', 'contacto-rut', 'registro-sii'] as const;

/** El pliego de consultas, para pegarlo en la nota del caso o en un correo
 *  interno. Un fiscalizador que trabaja fuera de Atlas se lleva el trabajo
 *  hecho en vez de rearmarlo a mano. */
export function locateQueriesText(target: LocateTarget): string {
  const { dotted } = rutForms(target.rut);
  const lines = [
    `${clean(target.name)} · ${dotted}`,
    target.sector ? `Sector: ${clean(target.sector)}` : null,
    [target.commune, target.region].filter(Boolean).length
      ? `Territorio: ${clean([target.commune, target.region].filter(Boolean).join(', '))}`
      : null,
    '',
  ].filter((line) => line != null) as string[];

  for (const group of locateGroups(target)) {
    lines.push(`— ${group.title}`);
    for (const link of group.links) {
      lines.push(`  ${link.label}: ${link.url}`);
    }
    lines.push('');
  }
  lines.push('Las fuentes abiertas proponen datos de contacto; ninguna acredita identidad ni vigencia.');
  return lines.join('\n');
}

export const LOCATE_LIMIT =
  'Cada enlace abre una consulta pública, no un dato verificado: lo que devuelva propone un contacto que debes confirmar antes de usarlo en una gestión formal. Al abrir una consulta, la razón social o el RUT viaja al servicio externo.';
