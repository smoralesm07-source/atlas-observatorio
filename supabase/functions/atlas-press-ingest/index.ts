import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const FEED_URL = "https://raw.githubusercontent.com/smoralesm07-source/Monitor/atlas-press-state/atlas_prensa.json";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const jsonHeaders = { "Content-Type": "application/json" };

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function hasServiceCredential(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return token.length > 20 && SERVICE_ROLE.length > 20 && token === SERVICE_ROLE;
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((v) => text(v)).filter((v): v is string => Boolean(v))));
}

function dateOnly(value: unknown): string | null {
  const s = text(value);
  if (!s) return null;
  const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const t = Date.parse(`${match[1]}T00:00:00Z`);
  return Number.isFinite(t) ? match[1] : null;
}

function instant(value: unknown): string | null {
  const s = text(value);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function integer(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function db(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set("apikey", SERVICE_ROLE);
  headers.set("Authorization", `Bearer ${SERVICE_ROLE}`);
  headers.set("Content-Type", "application/json");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${path}: HTTP ${res.status} · ${detail.slice(0, 1200)}`);
  }
  const raw = await res.text();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

async function upsert(table: string, conflict: string, rows: Record<string, unknown>[]) {
  const chunkSize = 400;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await db(`${table}?on_conflict=${encodeURIComponent(conflict)}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,missing=default,return=minimal" },
      body: JSON.stringify(chunk),
    });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return response(405, { error: "POST required" });
  if (!SUPABASE_URL || !SERVICE_ROLE) return response(500, { error: "Supabase environment unavailable" });

  // El gateway queda independiente del formato JWT/opaque de la service key.
  // La mutación sólo se admite si la credencial recibida coincide exactamente
  // con el secreto de servicio disponible dentro de la función.
  if (!hasServiceCredential(req)) return response(403, { error: "service_role required" });

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  let bridgeGeneratedAt: string | null = null;

  try {
    const feedRes = await fetch(FEED_URL, {
      headers: { Accept: "application/json", "User-Agent": "ATLAS-Observatorio/press-archive" },
      cache: "no-store",
    });
    if (!feedRes.ok) throw new Error(`Monitor bridge HTTP ${feedRes.status}`);

    const bridge = await feedRes.json();
    if (!Array.isArray(bridge?.articles) || !Array.isArray(bridge?.entities) || !Array.isArray(bridge?.mentions)) {
      throw new Error("El puente atlas_prensa.json no contiene articles/entities/mentions válidos");
    }

    bridgeGeneratedAt = instant(bridge.generated_at);
    const seenAt = new Date().toISOString();

    await db("atlas_press_ingest_run", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        run_id: runId,
        started_at: startedAt,
        status: "RUNNING",
        bridge_generated_at: bridgeGeneratedAt,
        article_count: bridge.articles.length,
        entity_count: bridge.entities.length,
        mention_count: bridge.mentions.length,
      }),
    });

    const articles = bridge.articles
      .map((a: Record<string, unknown>) => {
        const id = text(a.id);
        if (!id) return null;
        return {
          article_id: id,
          article_date: dateOnly(a.date),
          title: text(a.title) ?? "Artículo de prensa sin título",
          media: text(a.media),
          url: text(a.url),
          summary: text(a.summary),
          region: text(a.region),
          commune: text(a.commune),
          search_terms: strings(a.search_terms),
          raw: a,
          bridge_generated_at: bridgeGeneratedAt,
          last_seen_in_feed_at: seenAt,
        };
      })
      .filter((x: unknown): x is Record<string, unknown> => Boolean(x));

    const entities = bridge.entities
      .map((e: Record<string, unknown>) => {
        const id = text(e.press_entity_id);
        if (!id) return null;
        return {
          press_entity_id: id,
          name: text(e.name) ?? id,
          normalized_name: text(e.normalized_name),
          entity_type: text(e.entity_type),
          nature: text(e.nature),
          ruts: strings(e.ruts),
          aliases: strings(e.aliases),
          source_first_seen: dateOnly(e.first_seen),
          source_last_seen: dateOnly(e.last_seen),
          article_count: integer(e.article_count),
          mention_count: integer(e.mention_count),
          media: strings(e.media),
          roles: strings(e.roles),
          source_identity_confidence: numberOrNull(e.confidence),
          requires_validation: Boolean(e.requires_validation),
          resolution_status: text(e.resolution_status),
          source: text(e.source) ?? "RADAR_PRENSA",
          raw: e,
          bridge_generated_at: bridgeGeneratedAt,
          last_seen_in_feed_at: seenAt,
        };
      })
      .filter((x: unknown): x is Record<string, unknown> => Boolean(x));

    const mentions = bridge.mentions
      .map((m: Record<string, unknown>) => {
        const id = text(m.mention_id);
        const pressEntityId = text(m.press_entity_id);
        const articleId = text(m.article_id);
        if (!id || !pressEntityId || !articleId) return null;
        return {
          mention_id: id,
          press_entity_id: pressEntityId,
          article_id: articleId,
          role: text(m.role),
          roles: strings(m.roles),
          mentions: integer(m.mentions, 1) || 1,
          confidence: numberOrNull(m.confidence),
          requires_validation: Boolean(m.requires_validation),
          raw: m,
          bridge_generated_at: bridgeGeneratedAt,
          last_seen_in_feed_at: seenAt,
        };
      })
      .filter((x: unknown): x is Record<string, unknown> => Boolean(x));

    // El archivo es acumulativo: lo que sale de la ventana fresca no se borra de ATLAS.
    await upsert("atlas_press_article_history", "article_id", articles);
    await upsert("atlas_press_entity_history", "press_entity_id", entities);
    await upsert("atlas_press_mention_history", "mention_id", mentions);

    const resolved = await db("rpc/atlas_press_reconcile", { method: "POST", body: "{}" });
    const applied = await db("rpc/atlas_press_apply_obs", {
      method: "POST",
      body: JSON.stringify({ p_snapshot_id: null }),
    });

    await db(`atlas_press_ingest_run?run_id=eq.${runId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "READY",
        completed_at: new Date().toISOString(),
        resolved_link_count: Number(resolved ?? 0),
        applied_evidence_count: Number(applied ?? 0),
      }),
    });

    const status = await db("rpc/atlas_press_status", { method: "POST", body: "{}" });
    return response(200, {
      ok: true,
      feed: FEED_URL,
      bridge_generated_at: bridgeGeneratedAt,
      ingested: { articles: articles.length, entities: entities.length, mentions: mentions.length },
      resolved_links: resolved,
      applied_evidence: applied,
      archive: status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await db(`atlas_press_ingest_run?run_id=eq.${runId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "FAILED",
          completed_at: new Date().toISOString(),
          error_detail: message.slice(0, 4000),
        }),
      });
    } catch {
      // La falla original es la que debe preservarse.
    }
    return response(500, { ok: false, error: message, bridge_generated_at: bridgeGeneratedAt });
  }
});
