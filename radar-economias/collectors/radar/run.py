"""Arma un corte del radar: consulta cada fuente, deriva indicadores y publica.

    python -m radar.run --data ../data

Escribe:
  data/latest.json                 el corte vigente (lo consume la app)
  data/snapshots/<snapshot_id>.json
  data/history.json                serie de conteos por corte, para tendencias
  data/watchlists/ofac_crypto.json lista de vigilancia cripto (no son eventos)

Un recolector que falla no detiene el corte: queda declarado con su estado.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from . import SCHEMA
from .catalog import ECONOMIES, SOURCES
from .core import NOT_CONSULTED, Collected, SourceResult, failed, now_iso
from .sources import curated, deepdarkcti, hibp, ofac, phishing, ransomware

HISTORY_KEEP = 400
SNAPSHOTS_KEEP = 120   # 30 días a cuatro cortes diarios; history.json conserva la serie larga


def _load(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=False) + "\n", encoding="utf-8")


def build(data_dir: Path, only: set[str] | None = None) -> dict[str, Any]:
    previous = _load(data_dir / "latest.json") or {}
    prev_watch = (_load(data_dir / "watchlists" / "ofac_crypto.json") or {}).get("lists")

    collectors: list[tuple[str, Callable[[], Collected]]] = [
        ("RANSOMWARE_LIVE", ransomware.collect_live),
        ("RANSOMWATCH", ransomware.collect_watch),
        ("HIBP_BREACHES", hibp.collect),
        ("PHISHING_DATABASE", phishing.collect_phishing_database),
        ("OPENPHISH", phishing.collect_openphish),
        ("OFAC_CRYPTO", lambda: ofac.collect(prev_watch)),
        ("DEEPDARKCTI", deepdarkcti.collect),
        ("CMF_ALERTAS", curated.collect_cmf),
        ("SUBTEL_BLOQUEOS", curated.collect_subtel),
    ]

    results: list[Collected] = []
    for code, fn in collectors:
        if only and code not in only:
            results.append(Collected(SourceResult(code, NOT_CONSULTED, now_iso(), note="Excluida en esta corrida.")))
            continue
        try:
            results.append(fn())
        except Exception as e:  # noqa: BLE001 — un parser roto no tumba el corte
            results.append(failed(code, e))
        print(f"  {code:<18} {results[-1].result.status:<13} {results[-1].result.records_kept:>6} eventos")
    results.append(Collected(SourceResult("TELEGRAM_PUBLICO", NOT_CONSULTED, now_iso(),
                                          note="Desactivada hasta contar con informe jurídico.")))

    # Una fuente caída (o excluida de la corrida) conserva sus eventos del corte
    # anterior, marcados como arrastrados: que no haya respondido no significa
    # que el hecho desapareció.
    prev_events = {e["id"]: e for e in previous.get("events", [])}
    events: list[dict[str, Any]] = []
    for c in results:
        excluded = bool(only) and c.result.code not in only and c.result.code != "TELEGRAM_PUBLICO"
        if (c.result.status in ("DEGRADED", "UNREACHABLE") or excluded) and previous:
            carried = [dict(e, carried_from=previous.get("snapshot_id")) for e in prev_events.values()
                       if e["source_code"] == c.result.code]
            c.result.note = (c.result.note or "") + f" Se arrastran {len(carried)} eventos del corte anterior."
            events.extend(carried)
            continue
        for ev in c.events:
            d = ev.to_dict()
            d["first_seen"] = prev_events.get(d["id"], {}).get("first_seen") or d["observed_at"]
            events.append(d)

    # La misma víctima puede llegar por el agregador vivo y por el archivo.
    events = _dedupe_ransomware(events)

    snapshot_id = "RAD-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    new_ids = [e["id"] for e in events if e["id"] not in prev_events] if previous else []

    by_source = {c.result.code: c for c in results}
    indicators = {
        "by_economy": _by_economy(events, set(new_ids)),
        "ransomware": dict(
            ransomware.indicators([_Ev(e) for e in events if e["economy"] == "EXTORSION_DIGITAL"]),
            by_confidence=dict(Counter((e.get("chile_link") or {}).get("confidence", "sin vínculo")
                                       for e in events if e["economy"] == "EXTORSION_DIGITAL"))),
        "phishing": phishing.indicators([_Ev(e) for e in events if e["economy"] == "FRAUDE_SUPLANTACION"]),
        "breaches": by_source["HIBP_BREACHES"].indicators or None,
        "ofac_crypto": by_source["OFAC_CRYPTO"].indicators or None,
        "ecosystem": by_source["DEEPDARKCTI"].indicators or None,
    }

    snapshot = {
        "schema": SCHEMA,
        "snapshot_id": snapshot_id,
        "generated_at": now_iso(),
        "previous_snapshot_id": previous.get("snapshot_id"),
        "economies": ECONOMIES,
        "sources": [dict(c.result.to_dict(), **{k: SOURCES[c.result.code][k] for k in
                                                ("name", "economy", "kind", "url", "authority", "legal", "does_not")})
                    for c in results],
        "indicators": indicators,
        "events": sorted(events, key=lambda e: (e.get("event_date") or "", e["first_seen"]), reverse=True),
        "new_event_ids": new_ids,
    }

    _write(data_dir / "latest.json", snapshot)
    _write(data_dir / "snapshots" / f"{snapshot_id}.json", snapshot)
    for old in sorted((data_dir / "snapshots").glob("RAD-*.json"))[:-SNAPSHOTS_KEEP]:
        old.unlink()
    watch = by_source["OFAC_CRYPTO"].sidecar.get("ofac_crypto")
    if watch:
        _write(data_dir / "watchlists" / "ofac_crypto.json",
               {"snapshot_id": snapshot_id, "source": SOURCES["OFAC_CRYPTO"]["url"], "lists": watch})
    history = _load(data_dir / "history.json") or []
    history.append({"snapshot_id": snapshot_id, "generated_at": snapshot["generated_at"],
                    "by_economy": {k: v["cl"] for k, v in indicators["by_economy"].items()},
                    "sources": {s["code"]: s["status"] for s in snapshot["sources"]}})
    _write(data_dir / "history.json", history[-HISTORY_KEEP:])
    return snapshot


class _Ev:
    """Vista mínima de un evento serializado para reutilizar los indicadores."""

    def __init__(self, d: dict[str, Any]):
        self.event_date = d.get("event_date")
        self.actor = d.get("actor")
        self.target = d.get("target") or {}


def _dedupe_ransomware(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    from .core import norm
    live = {(norm(e.get("actor")), norm(e["title"])) for e in events if e["source_code"] == "RANSOMWARE_LIVE"}
    return [e for e in events
            if not (e["source_code"] == "RANSOMWATCH" and (norm(e.get("actor")), norm(e["title"])) in live)]


def _by_economy(events: list[dict[str, Any]], new_ids: set[str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for code in ECONOMIES:
        evs = [e for e in events if e["economy"] == code]
        out[code] = {
            "total": len(evs),
            "cl": sum(e["scope"] == "CL" for e in evs),
            "new": sum(e["id"] in new_ids for e in evs),
            "by_scope": dict(Counter(e["scope"] for e in evs)),
        }
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(Path(__file__).resolve().parents[2] / "data"))
    ap.add_argument("--only", help="códigos de fuente separados por coma")
    args = ap.parse_args()
    only = {x.strip().upper() for x in args.only.split(",")} if args.only else None
    print("Radar de economías criminales · corte en curso")
    snap = build(Path(args.data), only)
    print(f"Publicado {snap['snapshot_id']}: {len(snap['events'])} eventos, "
          f"{len(snap['new_event_ids'])} nuevos respecto del corte anterior.")


if __name__ == "__main__":
    main()
