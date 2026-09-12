import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/gi, " ");
const strip = (h: string) => decode(h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
const norm = (v: unknown) => String(v ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const rut = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^0-9K]/g, "");
const host = (raw: string) => { try { return new URL(raw).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
const publicUrl = (raw: string) => { try { const u = new URL(raw); if (!/^https?:$/.test(u.protocol)) return false; const h = u.hostname.toLowerCase(); if (h === "localhost" || h.endsWith(".local") || h === "0.0.0.0" || h.startsWith("127.") || h.startsWith("10.") || h.startsWith("192.168.")) return false; const m = h.match(/^172\.(\d+)\./); return !(m && Number(m[1]) >= 16 && Number(m[1]) <= 31); } catch { return false; } };
const official = (d: string) => d === "gob.cl" || d.endsWith(".gob.cl") || d.endsWith(".gov.cl") || d === "interior.gob.cl" || d.endsWith(".interior.gob.cl") || d === "bcn.cl" || d.endsWith(".bcn.cl") || d.endsWith(".leychile.cl") || d === "sii.cl" || d.endsWith(".sii.cl") || d === "cmfchile.cl" || d.endsWith(".cmfchile.cl") || d.endsWith(".contraloria.cl") || d.endsWith(".dipres.gob.cl");

const INTERIOR_SERVICES = "https://divdecar.interior.gob.cl/listado-de-servicios/";
const TRANSITION_DATE = "14/07/2021";

/**
 * El Ministerio del Interior publica un listado histórico que identifica las
 * Gobernaciones que fueron fusionadas con las antiguas Intendencias al crearse
 * las Delegaciones Presidenciales Regionales. Esta tabla funciona como evidencia
 * oficial determinística: no depende de que Bing/DDG indexen la página el día de
 * la consulta y evita ocultar un contexto que sí está acreditado en fuente pública.
 */
const GOVERNOR_TRANSITIONS = [
  ["antofagasta", "Delegación Presidencial Regional de Antofagasta"],
  ["arica", "Delegación Presidencial Regional de Arica y Parinacota"],
  ["cachapoal", "Delegación Presidencial Regional del Libertador General Bernardo O’Higgins"],
  ["cautin", "Delegación Presidencial Regional de La Araucanía"],
  ["concepcion", "Delegación Presidencial Regional del Biobío"],
  ["copiapo", "Delegación Presidencial Regional de Atacama"],
  ["coyhaique", "Delegación Presidencial Regional de Aysén del General Carlos Ibáñez del Campo"],
  ["diguillin", "Delegación Presidencial Regional de Ñuble"],
  ["elqui", "Delegación Presidencial Regional de Coquimbo"],
  ["iquique", "Delegación Presidencial Regional de Tarapacá"],
  ["llanquihue", "Delegación Presidencial Regional de Los Lagos"],
  ["magallanes", "Delegación Presidencial Regional de Magallanes y de la Antártica Chilena"],
  ["talca", "Delegación Presidencial Regional del Maule"],
  ["valdivia", "Delegación Presidencial Regional de Los Ríos"],
  ["valparaiso", "Delegación Presidencial Regional de Valparaíso"],
] as const;

function officialGovernorTransition(name: string) {
  const n = norm(name);
  if (!/\bgobernacion\b/.test(n)) return null;
  const row = GOVERNOR_TRANSITIONS.find(([province]) => new RegExp(`\\b${province}\\b`).test(n));
  if (!row) return null;
  return { province: row[0], successor: row[1] };
}

function governorResult(name: string, successor: string, province: string) {
  const provinceLabel = province.charAt(0).toUpperCase() + province.slice(1);
  const snippet = `Gobernación de ${provinceLabel}: fusionada a partir del ${TRANSITION_DATE} con la Intendencia correspondiente en la ${successor}.`;
  return {
    visible: true,
    status: "CONCLUSIVE_CONTEXT",
    confidence: 99,
    signal: "MERGER",
    signal_label: "fusión y continuidad institucional",
    successor,
    effective_date: TRANSITION_DATE,
    summary: `Una fuente oficial del Ministerio del Interior registra que ${name} dejó de existir bajo esa estructura institucional y fue fusionada, a partir del ${TRANSITION_DATE}, con la Intendencia correspondiente en la ${successor}. Este antecedente entrega una explicación documentada del cambio institucional asociado al término de giro registral.`,
    evidence: [{
      title: "Listado de Servicios · Ministerio del Interior",
      url: INTERIOR_SERVICES,
      domain: "divdecar.interior.gob.cl",
      official: true,
      snippet,
    }],
    searched_queries: 0,
    candidate_sources: 1,
    direct_official_sources: 1,
    independent_domains: 1,
    official_support: true,
    generated_at: new Date().toISOString(),
    resolution: "OFFICIAL_CURATED_TRANSITION",
  };
}

const STOP = new Set(["de", "del", "la", "las", "los", "y", "en", "para", "por", "spa", "ltda", "limitada", "sa", "eirl", "sociedad", "empresa", "servicio", "servicios", "regional", "provincial", "region"]);
const tokens = (name: string) => norm(name).split(" ").filter((x) => x.length >= 4 && !STOP.has(x)).slice(0, 8);
const identity = (text: string, name: string, rawRut: string) => {
  const n = norm(text), ts = tokens(name), hits = ts.filter((t) => n.includes(t)).length, rr = rut(rawRut);
  return (rr.length >= 7 && rut(text).includes(rr)) || n.includes(norm(name)) || (ts.length > 0 && hits / ts.length >= 0.75);
};

async function fetchText(raw: string, timeout = 7000) {
  if (!publicUrl(raw)) return null;
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(raw, {
      signal: ac.signal,
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; ATLAS-AML-OpenContext/1.2)",
        "accept": "text/html,text/plain;q=0.9,*/*;q=0.1",
        "accept-language": "es-CL,es;q=0.9,en;q=0.5",
      },
    });
    if (!r.ok) return null;
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!(ct.includes("text/html") || ct.includes("text/plain") || ct.includes("application/xhtml"))) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    return new TextDecoder().decode(b.slice(0, 620000));
  } catch { return null; } finally { clearTimeout(timer); }
}

function decodeUrl(raw: string) {
  let href = decode(raw);
  try {
    if (href.startsWith("//")) href = "https:" + href;
    if (href.includes("duckduckgo.com/l/?")) {
      const u = new URL(href.startsWith("http") ? href : "https://duckduckgo.com" + href);
      href = decodeURIComponent(u.searchParams.get("uddg") || "");
    }
    if (href.startsWith("/url?")) {
      const u = new URL("https://www.google.com" + href);
      href = u.searchParams.get("q") || "";
    }
    return publicUrl(href) ? href : "";
  } catch { return ""; }
}

type Hit = { title: string; snippet: string; url: string; domain: string; official: boolean; page?: string };

function parseDdg(html: string): Hit[] {
  const out: Hit[] = [];
  const blocks = html.match(/<div[^>]+class="[^"]*result[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi) || [];
  for (const block of blocks.slice(0, 12)) {
    const a = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const url = decodeUrl(a[1]), domain = host(url);
    if (!url || !domain || domain.includes("duckduckgo.com")) continue;
    const sm = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i);
    out.push({ title: strip(a[2]).replace(/\s+/g, " ").slice(0, 220), snippet: sm ? strip(sm[1]).replace(/\s+/g, " ").slice(0, 700) : "", url, domain, official: official(domain) });
  }
  return out;
}

function parseBing(html: string): Hit[] {
  const out: Hit[] = [];
  const blocks = html.match(/<li[^>]+class="[^"]*b_algo[^"]*"[\s\S]*?<\/li>/gi) || [];
  for (const block of blocks.slice(0, 12)) {
    const a = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const url = decodeUrl(a[1]), domain = host(url);
    if (!url || !domain || domain.includes("bing.com") || domain.includes("microsoft.com")) continue;
    const sm = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    out.push({ title: strip(a[2]).replace(/\s+/g, " ").slice(0, 220), snippet: sm ? strip(sm[1]).replace(/\s+/g, " ").slice(0, 700) : "", url, domain, official: official(domain) });
  }
  return out;
}

async function search(q: string) {
  const [d, b] = await Promise.all([
    fetchText("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q), 7500),
    fetchText("https://www.bing.com/search?q=" + encodeURIComponent(q) + "&setlang=es-CL", 7500),
  ]);
  return [...(d ? parseDdg(d) : []), ...(b ? parseBing(b) : [])];
}

type Signal = "INSTITUTIONAL_REPLACEMENT" | "MERGER" | "DISSOLUTION" | "CLOSURE" | "TRANSFORMATION";
const SIGNALS: { id: Signal; label: string; rx: RegExp[] }[] = [
  { id: "INSTITUTIONAL_REPLACEMENT", label: "reemplazo o continuidad institucional", rx: [/\b(reemplazad[oa]s?|sustituid[oa]s?|suprimid[oa]s?|continuador(?:a)? legal|extingu(?:e|ida|ido)|se extingui[oó])\b/i, /\b(funciones|atribuciones)\b.{0,140}\b(a cargo de|traspasad[oa]s?|ejercid[oa]s?)\b/i] },
  { id: "MERGER", label: "fusión, absorción o integración", rx: [/\b(fusionad[oa]s?|fusi[oó]n|absorbida|absorbido|absorci[oó]n|integrada|integrado)\b/i] },
  { id: "DISSOLUTION", label: "disolución, liquidación o insolvencia", rx: [/\b(disoluci[oó]n|disuelta|disuelto|liquidaci[oó]n|liquidada|liquidado|quiebra|insolvencia|reorganizaci[oó]n)\b/i] },
  { id: "CLOSURE", label: "cierre o cese de operaciones", rx: [/\b(cierre definitivo|cerr[oó] sus puertas|cese de operaciones|ces[oó] operaciones|dej[oó] de operar|deja de operar|fin de operaciones)\b/i] },
  { id: "TRANSFORMATION", label: "cambio de nombre o transformación", rx: [/\b(cambi[oó] su nombre|cambio de denominaci[oó]n|se transform[oó] en|pas[oó] a denominarse|pas[oó] a ser)\b/i] },
];
const detect = (text: string) => SIGNALS.filter((s) => s.rx.some((r) => r.test(text))).map((s) => s.id);

function cleanSuccessor(v: string) {
  const x = decode(v).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().split(/\s+(?:tras|desde|debido|producto|a partir|luego|que reemplaz|que asum|conforme|seg[uú]n)\b/i)[0].trim().replace(/^[,:;\-–—\s]+|[,:;\-–—\s]+$/g, "");
  return x.length >= 5 && x.length <= 150 ? x : null;
}

function successor(text: string) {
  const patterns = [
    /fusionad[oa]s?.{0,190}?\ben (?:la|el)\s+([^.;\n()]{5,160})/i,
    /a cargo de (?:la|el)\s+([^.;\n()]{5,160})/i,
    /reemplazad[oa]s?.{0,120}?\bpor (?:la|el)\s+([^.;\n()]{5,160})/i,
    /sustituid[oa]s?.{0,120}?\bpor (?:la|el)\s+([^.;\n()]{5,160})/i,
    /pas(?:o|ó|aron) a (?:conformar|ser) (?:la|el)\s+([^.;\n()]{5,160})/i,
    /se transform(?:o|ó|aron) en (?:la|el)\s+([^.;\n()]{5,160})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) { const c = cleanSuccessor(m[1]); if (c) return c; }
  }
  return null;
}

function dateFrom(text: string) {
  const numeric = text.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/);
  if (numeric) return `${numeric[1].padStart(2, "0")}/${numeric[2].padStart(2, "0")}/${numeric[3]}`;
  const words = text.match(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(20\d{2})\b/i);
  return words ? words[0] : null;
}

function contextualSummary(name: string, signal: Signal, next: string | null, date: string | null, officialSupport: boolean, domains: number) {
  const source = officialSupport ? "Una fuente oficial" : `${domains} fuentes abiertas independientes`;
  const when = date ? ` desde/alrededor de ${date}` : "";
  if (signal === "INSTITUTIONAL_REPLACEMENT") return next
    ? `${source} indica que ${name} dejó de operar bajo esa estructura institucional y sus funciones pasaron a ${next}${when}. Este antecedente ofrece una explicación plausible del término de giro registral y debe contrastarse con la fuente.`
    : `${source} indica que ${name} fue extinguida, reemplazada o sucedida institucionalmente${when}. Este antecedente ofrece una explicación plausible del término de giro registral y debe contrastarse con la fuente.`;
  if (signal === "MERGER") return next
    ? `${source} indica que ${name} fue fusionada o integrada en ${next}${when}. El antecedente es consistente con el término de giro observado y debe contrastarse con la fuente original.`
    : `${source} contiene evidencia consistente con una fusión, absorción o integración de ${name}${when}. El antecedente es compatible con el término de giro observado y debe contrastarse con la fuente original.`;
  if (signal === "DISSOLUTION") return `${source} contiene evidencia consistente con disolución, liquidación, quiebra o insolvencia de ${name}${when}. El antecedente puede explicar el término de giro observado y debe validarse con la fuente original.`;
  if (signal === "CLOSURE") return `${source} contiene evidencia consistente con cierre o cese de operaciones de ${name}${when}. El antecedente puede explicar el término de giro observado y debe validarse con la fuente original.`;
  return next
    ? `${source} indica que ${name} cambió de denominación o se transformó en ${next}${when}. Este cambio puede contextualizar el término de giro y debe contrastarse con la fuente original.`
    : `${source} contiene evidencia consistente con un cambio de denominación o transformación de ${name}${when}. Este cambio puede contextualizar el término de giro y debe contrastarse con la fuente original.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") || "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: allowed } = await admin.from("aml_allowed_users").select("user_id").eq("user_id", user.id).eq("enabled", true).maybeSingle();
  if (!allowed) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const rawRut = String(body.rut || "").trim();
  const region = String(body.region || "").trim();
  if (!name) return json({ error: "name_required" }, 400);

  // Primero resolvemos hechos institucionales oficiales que no necesitan una
  // búsqueda web variable. Esto cubre, entre otros, Gobernación de Antofagasta.
  const transition = officialGovernorTransition(name);
  if (transition) return json(governorResult(name, transition.successor, transition.province));

  const queries = [
    `"${name}"${rawRut ? ` "${rawRut}"` : ""}`,
    `"${name}" reemplazada reemplazado sucesor funciones`,
    `"${name}" fusionada fusionado disolución liquidación cierre`,
    `"${name}" "dejó de existir" "pasó a ser"${region ? ` ${region}` : ""}`,
  ];

  const batches = await Promise.all(queries.map(search));
  const byUrl = new Map<string, Hit>();
  for (const hit of batches.flat()) {
    if (!identity(`${hit.title} ${hit.snippet}`, name, rawRut)) continue;
    const key = hit.url.replace(/[#?].*$/, "");
    const prev = byUrl.get(key);
    if (!prev || (hit.official && !prev.official) || hit.snippet.length > prev.snippet.length) byUrl.set(key, hit);
  }

  const ranked = [...byUrl.values()].sort((a, b) => Number(b.official) - Number(a.official)).slice(0, 10);
  const enriched = await Promise.all(ranked.slice(0, 7).map(async (hit) => ({ ...hit, page: (await fetchText(hit.url, 6500)) || "" })));
  const evidence = enriched.map((hit) => {
    const text = [hit.title, hit.snippet, hit.page ? strip(hit.page).slice(0, 140000) : ""].filter(Boolean).join("\n");
    return { ...hit, text, signals: detect(text), successor: successor(text), date: dateFrom(text) };
  }).filter((item) => identity(item.text, name, rawRut) && item.signals.length > 0);

  let best: null | { signal: Signal; items: typeof evidence; officialSupport: boolean; domains: string[]; confidence: number } = null;
  for (const signal of SIGNALS) {
    const items = evidence.filter((item) => item.signals.includes(signal.id));
    if (!items.length) continue;
    const domains = [...new Set(items.map((item) => item.domain).filter(Boolean))];
    const officialSupport = items.some((item) => item.official);
    const confidence = officialSupport ? Math.min(98, 92 + Math.min(6, Math.max(0, domains.length - 1) * 3)) : domains.length >= 3 ? 90 : domains.length >= 2 ? 84 : 58;
    if (!best || confidence > best.confidence || (confidence === best.confidence && items.length > best.items.length)) best = { signal: signal.id, items, officialSupport, domains, confidence };
  }

  if (!best || best.confidence < 80) return json({
    visible: false,
    status: "NO_CONCLUSION",
    confidence: best?.confidence || 0,
    reason: "No se reunió evidencia suficientemente consistente para mostrar una conclusión al analista.",
    searched_queries: queries.length,
    candidate_sources: ranked.length,
    direct_official_sources: 0,
  });

  const preferred = best.items.find((item) => item.official && item.successor) || best.items.find((item) => item.official) || best.items.find((item) => item.successor) || best.items[0];
  const next = preferred?.successor || null;
  const effective = preferred?.date || best.items.find((item) => item.date)?.date || null;
  const label = SIGNALS.find((signal) => signal.id === best!.signal)?.label || "contexto explicativo";
  const outputEvidence = best.items.slice().sort((a, b) => Number(b.official) - Number(a.official))
    .filter((item, index, list) => list.findIndex((other) => other.url.replace(/[#?].*$/, "") === item.url.replace(/[#?].*$/, "")) === index)
    .slice(0, 3)
    .map((item) => ({
      title: item.title || item.domain,
      url: item.url,
      domain: item.domain,
      official: item.official,
      snippet: (item.snippet || (item.page ? strip(item.page) : "")).replace(/\s+/g, " ").trim().slice(0, 420),
    }));

  return json({
    visible: true,
    status: "CONCLUSIVE_CONTEXT",
    confidence: best.confidence,
    signal: best.signal,
    signal_label: label,
    successor: next,
    effective_date: effective,
    summary: contextualSummary(name, best.signal, next, effective, best.officialSupport, best.domains.length),
    evidence: outputEvidence,
    searched_queries: queries.length,
    candidate_sources: ranked.length,
    direct_official_sources: best.officialSupport ? 1 : 0,
    independent_domains: best.domains.length,
    official_support: best.officialSupport,
    generated_at: new Date().toISOString(),
    resolution: "OPEN_WEB_CORROBORATION",
  });
});
