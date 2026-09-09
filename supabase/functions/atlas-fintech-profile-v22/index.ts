declare const Deno: any;

const UA = 'ATLAS-Fintech-Profile/2.2';
const VERSION = '2.2.1';

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function htmlDecode(s: string) {
  return (s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&aacute;/gi, 'á')
    .replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú')
    .replace(/&ntilde;/gi, 'ñ');
}

function stripHtml(s: string) {
  return htmlDecode(
    (s || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<br\s*\/?\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  ).trim();
}

function norm(s: string) {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normRut(s: string | null | undefined) {
  return (s || '').toUpperCase().replace(/[^0-9K]/g, '');
}

function fixUrl(u: string) {
  const x = (u || '').trim();
  return !x ? '' : /^https?:\/\//i.test(x) ? x : `https://${x}`;
}

async function hash(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function get(url: string, timeout = 7500) {
  const r = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) throw new Error(`HTTP_${r.status}`);
  return { url: r.url, html: await r.text() };
}

function titleOf(html: string) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripHtml(m[1]).slice(0, 240) : null;
}

function descriptionOf(html: string) {
  const m = html.match(
    /<meta\s+[^>]*(?:name=["']description["'][^>]*content=["']([^"']+)|content=["']([^"']+)["'][^>]*name=["']description["'])/i,
  );
  return stripHtml(m?.[1] || m?.[2] || '').slice(0, 500) || null;
}

function evidenceLinks(html: string, base: string) {
  const legal: string[] = [];
  const commercial: string[] = [];
  const seen = new Set<string>();
  try {
    const origin = new URL(base).origin;
    for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = htmlDecode(m[1]);
      const label = norm(`${stripHtml(m[2])} ${href}`);
      let u: URL;
      try {
        u = new URL(href, base);
      } catch {
        continue;
      }
      if (u.origin !== origin || !/^https?:/.test(u.protocol)) continue;
      u.hash = '';
      const url = u.toString();
      if (seen.has(url)) continue;
      seen.add(url);
      if (/(termin|legal|privacidad|privacy|condiciones|terms)/.test(label)) legal.push(url);
      if (/(precio|pricing|tarifa|plan|empresa|negocio|comercio|persona|producto|servicio|solucion|cuenta|credito|pago|inversion|developer|api)/.test(label)) {
        commercial.push(url);
      }
    }
  } catch {}
  return [...legal.slice(0, 1), ...commercial.slice(0, 2)];
}

const RUT_RE = /\b(?:\d{1,2}\.?\d{3}\.?\d{3}|\d{7,8})-[0-9kK]\b/g;

function legalRut(pages: { url: string; text: string }[]) {
  const scores = new Map<string, { score: number; url: string; ctx: string }>();
  for (const p of pages) {
    for (const m of p.text.matchAll(RUT_RE)) {
      const key = normRut(m[0]);
      if (!key || key === '608100008') continue;
      const i = m.index || 0;
      const ctx = p.text.slice(Math.max(0, i - 210), Math.min(p.text.length, i + 250));
      let score = 1;
      if (/raz[oó]n social|rut de la empresa|rut empresa|sociedad.*rut|empresa.*rut|titular del sitio|responsable.*rut/i.test(ctx)) score += 3;
      else if (/sociedad|empresa|titular del sitio|responsable/i.test(ctx)) score += 1;
      if (/termin|legal|privacidad|privacy|condiciones/i.test(p.url)) score += 1;
      if (/entregad[oa]s? por|administrad[oa]s? por|provist[oa]s? por|operad[oa]s? por|emitid[oa]s? por|gestionad[oa]s? por|a cargo de|tercero|proveedor externo/i.test(ctx)) score -= 5;
      const prev = scores.get(key);
      scores.set(key, { score: (prev?.score || 0) + score, url: p.url, ctx: ctx.replace(/\s+/g, ' ').slice(0, 550) });
    }
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  if (!ranked.length) return null;
  const [key, best] = ranked[0];
  const margin = ranked.length > 1 ? best.score - ranked[1][1].score : best.score;
  if (best.score < 5 || margin < 2) return null;
  return {
    rut: `${key.slice(0, -1)}-${key.slice(-1)}`,
    url: best.url,
    ctx: best.ctx,
    confidence: Math.min(0.99, 0.88 + Math.min(best.score, 6) * 0.017),
  };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function literalHits(text: string, term: string) {
  return (text.match(new RegExp(`(?:^|\\s)${escapeRe(norm(term))}(?=\\s|$)`, 'g')) || []).length;
}

function scoreEvidence(text: string, strongTerms: string[], weakTerms: string[]) {
  let strong = 0;
  let weak = 0;
  const strongMatches: string[] = [];
  const weakMatches: string[] = [];

  for (const term of strongTerms) {
    const hits = literalHits(text, term);
    if (!hits) continue;
    strong += Math.min(hits, 2) * 3;
    strongMatches.push(term);
  }
  for (const term of weakTerms) {
    const hits = literalHits(text, term);
    if (!hits) continue;
    weak += Math.min(hits, 2);
    weakMatches.push(term);
  }

  return {
    score: strong + weak,
    strong,
    weak,
    distinctStrong: strongMatches.length,
    strongMatches: strongMatches.slice(0, 8),
    weakMatches: weakMatches.slice(0, 8),
  };
}

function classify(raw: string) {
  const text = norm(raw).slice(0, 120000);

  const b2b = scoreEvidence(
    text,
    [
      'para empresas', 'para negocios', 'para comercios', 'para pymes', 'soluciones para empresas',
      'plataforma para empresas', 'servicios para empresas', 'gestion de gastos', 'cuentas por pagar',
      'tesoreria empresarial', 'facturacion para empresas', 'api para empresas', 'api para desarrolladores',
      'integracion api', 'portal de comercios', 'merchant dashboard', 'business banking', 'banca empresas',
      'for businesses', 'for enterprises', 'large enterprises', 'financial institutions', 'for financial institutions',
      'enterprise software', 'enterprise platform', 'business customers',
    ],
    ['empresas', 'comercios', 'negocios', 'pymes', 'pyme', 'merchant', 'api', 'developers', 'corporate', 'tesoreria', 'facturas', 'business'],
  );

  const b2c = scoreEvidence(
    text,
    [
      'para personas', 'para ti', 'persona natural', 'personas naturales', 'clientes personas',
      'cuenta digital', 'billetera digital', 'tu dinero', 'tu inversion', 'invierte desde', 'ahorra desde',
      'envia dinero', 'descarga nuestra app', 'descarga la app', 'abre tu cuenta', 'paga con tu',
      'consumer banking', 'retail customers', 'individual customers',
    ],
    ['personas', 'usuarios', 'consumidores', 'app'],
  );

  let business_model_hint: string | null = null;
  let business_model_confidence = 0;

  if (b2b.strong >= 6 && b2c.strong >= 6 && b2b.score >= 8 && b2c.score >= 8) {
    business_model_hint = 'B2B2C';
    business_model_confidence = 0.95;
  } else if (b2b.strong >= 6 && b2b.score >= 8 && b2b.score - b2c.score >= 3) {
    business_model_hint = 'B2B';
    business_model_confidence = b2b.distinctStrong >= 2 ? 0.96 : 0.94;
  } else if (b2c.strong >= 6 && b2c.score >= 8 && b2c.score - b2b.score >= 3) {
    business_model_hint = 'B2C';
    business_model_confidence = b2c.distinctStrong >= 2 ? 0.96 : 0.94;
  } else if (b2b.strong >= 3 && b2b.score >= 6 && b2b.score - b2c.score >= 2) {
    business_model_hint = 'B2B';
    business_model_confidence = 0.88;
  } else if (b2c.strong >= 3 && b2c.score >= 6 && b2c.score - b2b.score >= 2) {
    business_model_hint = 'B2C';
    business_model_confidence = 0.88;
  } else if (b2b.strong >= 3 && b2c.strong >= 3) {
    business_model_hint = 'B2B2C';
    business_model_confidence = 0.86;
  }

  const target_customer_hint =
    business_model_hint === 'B2B' ? 'EMPRESAS' :
    business_model_hint === 'B2C' ? 'PERSONAS' :
    business_model_hint === 'B2B2C' ? 'AMBOS' : null;
  const target_customer_confidence = business_model_confidence;

  const revenueRules = [
    ['COMISION_TRANSACCIONAL',
      ['comision por transaccion', 'tarifa por transaccion', 'fee por transaccion', 'costo por transaccion', 'comision por operacion', 'comision por pago'],
      ['comision', 'fee']],
    ['SUSCRIPCION_SAAS',
      ['plan mensual', 'suscripcion mensual', 'precio mensual', 'tarifa mensual', 'por usuario al mes', 'software as a service', 'saas'],
      ['suscripcion', 'mensualidad', 'plan']],
    ['SPREAD_FX',
      ['spread cambiario', 'margen cambiario', 'spread fx', 'comision de cambio', 'tarifa de cambio'],
      ['spread', 'tipo de cambio', 'fx']],
    ['INTERES_ORIGINACION',
      ['tasa de interes', 'interes anual', 'interes mensual', 'costo total del credito', 'tasa mensual', 'cae'],
      ['interes', 'originacion']],
    ['ASESORIA_HONORARIOS',
      ['honorarios de asesoria', 'tarifa de asesoria', 'advisory fee', 'management fee'],
      ['honorarios']],
    ['CUSTODIA',
      ['tarifa de custodia', 'custody fee', 'comision de custodia'],
      ['custodia']],
  ] as const;

  const revenueScores = revenueRules
    .map(([code, strong, weak]) => ({ code, ...scoreEvidence(text, [...strong], [...weak]) }))
    .sort((a, b) => b.score - a.score);

  const bestRevenue = revenueScores[0];
  const secondRevenue = revenueScores[1];
  let revenue_model_hint: string | null = null;
  let revenue_model_confidence = 0;

  if (bestRevenue && bestRevenue.score >= 7 && bestRevenue.strong >= 6 && bestRevenue.score - (secondRevenue?.score || 0) >= 2) {
    revenue_model_hint = bestRevenue.code;
    revenue_model_confidence = bestRevenue.distinctStrong >= 2 ? 0.95 : 0.93;
  } else if (bestRevenue && bestRevenue.score >= 5 && bestRevenue.strong >= 3 && bestRevenue.score - (secondRevenue?.score || 0) >= 2) {
    revenue_model_hint = bestRevenue.code;
    revenue_model_confidence = 0.88;
  }

  const products: [string, string[], string[]][] = [
    ['PAGOS', ['procesamiento de pagos', 'acepta pagos', 'pasarela de pagos', 'payment gateway', 'checkout', 'adquirencia'], ['pagos', 'payment', 'pos']],
    ['REMESAS_FX', ['transferencias internacionales', 'envia dinero al extranjero', 'remesas internacionales', 'cambio de divisas'], ['remesas', 'fx']],
    ['CREDITO_LENDING', ['solicita tu credito', 'credito para empresas', 'credito para personas', 'financiamiento para empresas', 'adelanto de facturas'], ['credito', 'prestamo', 'lending', 'factoring', 'financiamiento']],
    ['INVERSION', ['plataforma de inversion', 'invierte en', 'gestion de inversiones', 'administracion de portafolio'], ['inversion', 'portafolio', 'wealth', 'inversiones']],
    ['CUSTODIA', ['servicio de custodia', 'custodia de activos', 'custody service'], ['custodia', 'custody']],
    ['CRYPTO_EXCHANGE', ['compra bitcoin', 'vende bitcoin', 'intercambio de criptomonedas', 'crypto exchange', 'compra criptomonedas'], ['bitcoin', 'criptomoneda', 'crypto', 'stablecoin', 'usdt', 'usdc', 'ethereum']],
    ['TARJETAS', ['tarjeta prepago', 'tarjeta de credito', 'tarjeta virtual', 'emision de tarjetas'], ['tarjeta', 'prepago', 'card']],
    ['OPEN_FINANCE', ['open finance', 'open banking', 'iniciacion de pagos', 'agregacion de cuentas'], ['api bancaria']],
    ['INSURTECH', ['seguro digital', 'cotiza tu seguro', 'plataforma de seguros', 'insurance platform'], ['seguros', 'insurance', 'poliza']],
    ['REGTECH', ['plataforma de cumplimiento', 'prevencion de fraude', 'conoce a tu cliente', 'know your customer'], ['cumplimiento', 'compliance', 'kyc', 'regtech']],
  ];

  const product_hints = products
    .filter(([, strong, weak]) => {
      const s = scoreEvidence(text, strong, weak);
      return s.strong >= 3 || s.score >= 5;
    })
    .map(([code]) => code);

  const countries = ['Chile', 'Argentina', 'Perú', 'Colombia', 'México', 'Brasil', 'Uruguay', 'Paraguay', 'Ecuador', 'Bolivia', 'Estados Unidos', 'España'];
  const country_hints = countries.filter((c) => text.includes(norm(c)));
  const vaTerms = ['bitcoin', 'criptomoneda', 'crypto', 'stablecoin', 'usdt', 'usdc', 'ethereum', 'blockchain', 'wallet', 'activo virtual', 'digital asset'];
  const virtual_asset_signals = [...new Set(vaTerms.filter((v) => text.includes(norm(v))))];

  return {
    business_model_hint,
    business_model_confidence,
    target_customer_hint,
    target_customer_confidence,
    revenue_model_hint,
    revenue_model_confidence,
    product_hints,
    country_hints,
    virtual_asset_signals,
    classifier_version: VERSION,
    classification_evidence: { b2b, b2c, revenue: revenueScores.slice(0, 3) },
  };
}

async function crawlSubject(q: any) {
  const now = new Date().toISOString();
  const facts: any[] = [];
  let requested = fixUrl(q.website);

  try {
    let home;
    try {
      home = await get(requested);
    } catch {
      if (!/^https:\/\//i.test(requested)) throw new Error('FETCH_FAILED');
      requested = requested.replace(/^https:/i, 'http:');
      home = await get(requested);
    }

    const homeHtml = home.html.slice(0, 350000);
    const pages = [{ url: home.url, text: stripHtml(homeHtml).slice(0, 65000) }];

    for (const link of evidenceLinks(homeHtml, home.url)) {
      if (pages.some((p) => p.url === link)) continue;
      try {
        const page = await get(link, 6500);
        pages.push({ url: page.url, text: stripHtml(page.html).slice(0, 40000) });
      } catch {}
      if (pages.length >= 4) break;
    }

    const cls = classify(pages.map((p) => p.text).join(' '));
    const rut = legalRut(pages);
    const title = titleOf(homeHtml);
    const description = descriptionOf(homeHtml);

    const push = async (
      field_code: string,
      value_text: string | null,
      evidence_class: string,
      confidence: number,
      source_url: string,
      evidence_excerpt: string | null,
      value_json: Record<string, unknown> = {},
    ) => {
      if (!value_text) return;
      facts.push({
        evidence_key: await hash(`${q.subject_type}|${q.subject_key}|${field_code}|${value_text}|${source_url}|${VERSION}`),
        field_code,
        value_text,
        value_json,
        evidence_class,
        confidence,
        source_code: 'COMPANY_WEB',
        source_url,
        evidence_excerpt,
        observed_at: now,
      });
    };

    await push('WEBSITE_STATUS', 'OK', 'DECLARED', 1, home.url, `Sitio corporativo accesible: ${home.url}`, { pages_scanned: pages.length, classifier_version: VERSION });
    await push('SITE_TITLE', title, 'DECLARED', 0.95, home.url, title);
    await push('SITE_DESCRIPTION', description, 'DECLARED', 0.92, home.url, description);

    if (rut) await push('LEGAL_RUT_DECLARED', rut.rut, 'DECLARED', rut.confidence, rut.url, rut.ctx);

    if (cls.business_model_hint) {
      await push(
        'BUSINESS_MODEL_HINT',
        cls.business_model_hint,
        'INFERRED',
        cls.business_model_confidence,
        home.url,
        `Clasificación determinística v${VERSION}; alta confianza exige anclas comerciales fuertes y separación suficiente de la hipótesis alternativa.`,
        { classifier_version: VERSION, b2b: cls.classification_evidence.b2b, b2c: cls.classification_evidence.b2c, pages_scanned: pages.length },
      );
    }

    if (cls.target_customer_hint) {
      await push(
        'TARGET_CUSTOMER_HINT',
        cls.target_customer_hint,
        'INFERRED',
        cls.target_customer_confidence,
        home.url,
        `Segmento objetivo derivado del vector B2B/B2C v${VERSION}.`,
        { classifier_version: VERSION, b2b: cls.classification_evidence.b2b, b2c: cls.classification_evidence.b2c },
      );
    }

    if (cls.revenue_model_hint) {
      await push(
        'REVENUE_MODEL_HINT',
        cls.revenue_model_hint,
        'INFERRED',
        cls.revenue_model_confidence,
        home.url,
        `Monetización inferida v${VERSION} desde frases fuertes de pricing, comisión, interés o custodia.`,
        { classifier_version: VERSION, revenue_top: cls.classification_evidence.revenue, pages_scanned: pages.length },
      );
    }

    for (const p of cls.product_hints) {
      await push('PRODUCT_SIGNAL', p, 'INFERRED', 0.86, home.url, 'Producto o servicio detectado con anclas contextuales en contenido corporativo.');
    }
    for (const c of cls.country_hints) {
      await push('COUNTRY_SIGNAL', c, 'INFERRED', 0.8, home.url, 'País mencionado en contenido corporativo.');
    }
    for (const v of cls.virtual_asset_signals) {
      await push('VIRTUAL_ASSET_SIGNAL', v, 'INFERRED', 0.78, home.url, 'Señal AV detectada; requiere validación funcional.');
    }

    return {
      ...q,
      website: home.url,
      fetch_status: 'OK',
      legal_rut: rut?.rut || null,
      legal_rut_confidence: rut?.confidence || null,
      legal_rut_source_url: rut?.url || null,
      pages_scanned: pages.length,
      ...cls,
      facts,
    };
  } catch (e) {
    const source = requested || q.website;
    return {
      ...q,
      fetch_status: 'FETCH_FAILED',
      pages_scanned: 0,
      classifier_version: VERSION,
      facts: [{
        evidence_key: await hash(`${q.subject_type}|${q.subject_key}|WEBSITE_STATUS|FETCH_FAILED|${source}|${VERSION}`),
        field_code: 'WEBSITE_STATUS',
        value_text: 'FETCH_FAILED',
        value_json: { error: String((e as Error)?.message || e).slice(0, 240), classifier_version: VERSION },
        evidence_class: 'DECLARED',
        confidence: 1,
        source_code: 'COMPANY_WEB',
        source_url: source,
        evidence_excerpt: 'No fue posible acceder al sitio en este barrido.',
        observed_at: now,
      }],
    };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return response(405, { ok: false, error: 'METHOD_NOT_ALLOWED' });

  let runId: number | null = null;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) return response(503, { ok: false, error: 'SERVER_CREDENTIALS_UNAVAILABLE' });

    const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' };
    const rpc = async (name: string, payload: unknown) => {
      const r = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(payload) });
      const text = await r.text();
      if (!r.ok) throw new Error(`${name} HTTP ${r.status}: ${text.slice(0, 800)}`);
      return text ? JSON.parse(text) : null;
    };

    const token = req.headers.get('x-atlas-cron-token') || '';
    if (!token || await rpc('aml_fintech_validate_internal_token', { p_token: token }) !== true) {
      return response(401, { ok: false, error: 'INVALID_INTERNAL_TOKEN' });
    }

    let body: any = {};
    try { body = await req.json(); } catch {}
    const limit = Math.max(1, Math.min(Number(body.limit || 8), 20));

    const queue = await rpc('aml_fintech_enrichment_batch', { p_limit: limit });
    runId = await rpc('aml_fintech_enrichment_run_start', {
      p_requested: Array.isArray(queue) ? queue.length : 0,
      p_payment_seen: 0,
    });

    const results: any[] = [];
    let failed = 0;

    for (let i = 0; i < (queue || []).length; i += 4) {
      const chunk = await Promise.all(queue.slice(i, i + 4).map((x: any) => crawlSubject(x)));
      results.push(...chunk);
      failed += chunk.filter((x: any) => x.fetch_status !== 'OK').length;
    }

    const ingest = results.length
      ? await rpc('aml_fintech_ingest_enrichment', { p_rows: results })
      : { processed: 0, facts_upserted: 0 };

    await rpc('aml_fintech_enrichment_run_finish', {
      p_run_id: runId,
      p_processed: results.length,
      p_failed: failed,
      p_payment_seen: 0,
      p_status: 'COMPLETED',
      p_detail: { enrichment: ingest, classifier_version: VERSION, profile_only: true },
    });

    return response(200, {
      ok: true,
      run_id: runId,
      classifier_version: VERSION,
      queue: queue.length,
      processed: results.length,
      failed,
      enrichment: ingest,
      sample: results.slice(0, 8).map((x) => ({
        subject_type: x.subject_type,
        subject_key: x.subject_key,
        display_name: x.display_name,
        fetch_status: x.fetch_status,
        pages_scanned: x.pages_scanned,
        legal_rut: x.legal_rut,
        business_model: x.business_model_hint,
        business_model_confidence: x.business_model_confidence,
        revenue_model: x.revenue_model_hint,
        revenue_model_confidence: x.revenue_model_confidence,
        products: x.product_hints,
      })),
    });
  } catch (e) {
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (runId && supabaseUrl && serviceKey) {
        await fetch(`${supabaseUrl}/rest/v1/rpc/aml_fintech_enrichment_run_finish`, {
          method: 'POST',
          headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            p_run_id: runId,
            p_processed: 0,
            p_failed: 1,
            p_payment_seen: 0,
            p_status: 'FAILED',
            p_detail: { error: String((e as Error)?.message || e).slice(0, 800), classifier_version: VERSION, profile_only: true },
          }),
        });
      }
    } catch {}

    return response(502, {
      ok: false,
      error: 'FINTECH_PROFILE_V22_FAILED',
      classifier_version: VERSION,
      detail: String((e as Error)?.message || e),
    });
  }
});