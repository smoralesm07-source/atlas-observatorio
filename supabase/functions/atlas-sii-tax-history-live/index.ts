import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "content-type": "application/json; charset=utf-8",
  "cache-control": "private, max-age=300",
};

// Entity 360 treats this governed longitudinal source as loaded Atlas evidence
// when the central annual profile has not been materialized yet.
const BASE = "https://smoralesm07-source.github.io/Radar_SII/data/tax-history";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

function normalizeRut(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^0-9K]/g, "");
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const body = await req.json().catch(() => ({}));
  const rut = normalizeRut((body as { rut?: unknown })?.rut);
  if (!/^[0-9]{7,9}[0-9K]$/.test(rut)) return json({ ok: false, error: "INVALID_RUT" }, 400);

  const prefix = rut.slice(0, 3);
  try {
    const response = await fetch(`${BASE}/${prefix}.json`, { headers: { accept: "application/json" } });
    if (response.status === 404) {
      return json({ ok: true, rut, rows: [], source: "RADAR_SII_TAX_HISTORY_WEB_V2", status: "NOT_PUBLISHED" });
    }
    if (!response.ok) return json({ ok: false, error: "UPSTREAM_ERROR", status: response.status }, 502);

    const payload = await response.json();
    const raw = Array.isArray(payload?.entities?.[rut]) ? payload.entities[rut] : [];
    const rows = raw
      .map((row: unknown[]) => ({
        commercial_year: Number(row?.[0]),
        sales_band_rank: row?.[1] == null ? null : Number(row[1]),
        workers_numeric: row?.[2] == null ? null : Number(row[2]),
        // V2 adds the governed annual principal activity and economic hierarchy.
        // V1 shards remain backward compatible and simply return null here.
        main_activity: optionalText(row?.[3]),
        economic_sector: optionalText(row?.[4]),
        economic_subsector: optionalText(row?.[5]),
        activity_coverage: optionalText(row?.[3]) ? "ANNUAL_PRINCIPAL_ACTIVITY" : null,
        source: "RADAR_SII_TAX_HISTORY_WEB_V2",
      }))
      .filter((row: { commercial_year: number }) => Number.isFinite(row.commercial_year))
      .sort((a: { commercial_year: number }, b: { commercial_year: number }) => a.commercial_year - b.commercial_year);

    return json({
      ok: true,
      rut,
      rows,
      source: "RADAR_SII_TAX_HISTORY_WEB_V2",
      source_schema: payload?.schema ?? null,
      semantics: {
        main_activity: "Principal economic activity for the commercial year from governed Radar SII history; not the complete current ACTECO list.",
      },
    });
  } catch (error) {
    return json({
      ok: false,
      error: "UPSTREAM_UNAVAILABLE",
      detail: String((error as Error)?.message || error),
    }, 502);
  }
});
