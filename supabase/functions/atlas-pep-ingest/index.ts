/* Ingesta PEP desde fuentes abiertas chilenas, estructuradas por OpenSanctions.
 *
 *  cl_info_probidad     declaraciones de intereses y patrimonio (Ley 20.880, InfoProbidad)
 *  cl_senate            nómina del Senado
 *  cl_chamber_deputies  nómina de la Cámara de Diputadas y Diputados
 *
 * Se descarga el archivo FollowTheMoney (una entidad JSON por línea). Los cargos
 * vienen como entidades Position y Occupancy separadas de la Person, así que se
 * reconstruyen antes de cargar. Ninguna fuente trae RUT.
 *
 * Licencia: OpenSanctions publica sus datos como CC BY-NC 4.0. El uso no
 * comercial por un organismo público debe confirmarse con ellos antes de pasar
 * a producción.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, x-atlas-cron-token", "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_TOKEN = Deno.env.get("ATLAS_PEP_CRON_TOKEN") ?? "";
const DATASETS = ["cl_info_probidad", "cl_senate", "cl_chamber_deputies"];
const BATCH = 500;
const sourceUrl = (ds: string) => `https://data.opensanctions.org/datasets/latest/${ds}/entities.ftm.json`;

type Ftm = { id: string; schema: string; properties?: Record<string, string[]>; first_seen?: string; last_seen?: string };
type PepRow = { id: string; name: string; aliases: string[]; positions: string[]; source_url: string; first_seen: string; last_seen: string };

function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: cors }); }

function authorized(req: Request) {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const cron = (req.headers.get("x-atlas-cron-token") ?? "").trim();
  return (SERVICE_ROLE.length > 20 && bearer === SERVICE_ROLE) || (CRON_TOKEN.length > 20 && cron === CRON_TOKEN);
}

async function* lines(url: string): AsyncGenerator<string> {
  const res = await fetch(url, { headers: { "user-agent": "ATLAS-Observatorio/pep-ingest" }, signal: AbortSignal.timeout(240000) });
  if (!res.ok || !res.body) throw new Error(`HTTP_${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (line) yield line; }
  }
  if (buf.trim()) yield buf.trim();
}

async function readDataset(ds: string): Promise<PepRow[]> {
  const persons = new Map<string, PepRow>();
  const positions = new Map<string, string>();
  const occupancies: { holder: string; post: string }[] = [];
  for await (const line of lines(sourceUrl(ds))) {
    let e: Ftm;
    try { e = JSON.parse(line); } catch { continue; }
    const p = e.properties ?? {};
    if (e.schema === "Person") {
      const names = p.name ?? [];
      if (!names.length) continue;
      persons.set(e.id, {
        id: e.id, name: names[0],
        aliases: [...names.slice(1), ...(p.alias ?? [])],
        positions: [...(p.position ?? [])],
        source_url: (p.sourceUrl ?? [])[0] ?? "",
        first_seen: e.first_seen ?? "", last_seen: e.last_seen ?? "",
      });
    } else if (e.schema === "Position") {
      if (p.name?.[0]) positions.set(e.id, p.name[0]);
    } else if (e.schema === "Occupancy") {
      const holder = p.holder?.[0], post = p.post?.[0];
      if (holder && post) occupancies.push({ holder, post });
    }
  }
  for (const o of occupancies) {
    const person = persons.get(o.holder), label = positions.get(o.post);
    if (person && label && !person.positions.includes(label)) person.positions.push(label);
  }
  return [...persons.values()];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!authorized(req)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await req.json().catch(() => ({}));
  const wanted: string[] = Array.isArray(body?.datasets) ? body.datasets.filter((d: string) => DATASETS.includes(d)) : DATASETS;
  const results = [];

  for (const ds of wanted) {
    const { data: load, error: loadErr } = await db.from("obs_pep_load").insert({ dataset: ds, status: "RUNNING", source_url: sourceUrl(ds) }).select("load_id").single();
    if (loadErr) { results.push({ dataset: ds, status: "FAILED", error: loadErr.message }); continue; }
    try {
      const rows = await readDataset(ds);
      for (let i = 0; i < rows.length; i += BATCH) {
        const { error } = await db.rpc("obs_pep_ingest_batch", { p_load_id: load.load_id, p_dataset: ds, p_rows: rows.slice(i, i + BATCH) });
        if (error) throw new Error(error.message);
      }
      // Una fuente que llegó vacía no reemplaza lo cargado antes: se registra como falla.
      const status = rows.length ? "LOADED" : "FAILED";
      const { data, error } = await db.rpc("obs_pep_finish_load", { p_load_id: load.load_id, p_status: status, p_error: rows.length ? null : "EMPTY_SOURCE" });
      if (error) throw new Error(error.message);
      results.push(data);
    } catch (e) {
      await db.rpc("obs_pep_finish_load", { p_load_id: load.load_id, p_status: "FAILED", p_error: String((e as Error).message ?? e).slice(0, 1000) });
      results.push({ dataset: ds, status: "FAILED", error: String((e as Error).message ?? e) });
    }
  }
  return json({ ok: results.every((r: any) => r.status === "LOADED"), results });
});
