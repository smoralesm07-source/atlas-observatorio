#!/usr/bin/env python3
"""Comparador offline de MANIFIESTOS AGREGADOS de los dos proyectos.
No conecta con Supabase, no ejecuta SQL y no manipula registros personales.
La salida NO autoriza el borrado de un proyecto.
"""
import argparse
import datetime as dt
import json
import sys
from pathlib import Path

def load(path):
    obj = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(obj, dict) and "manifest" in obj:
        obj = obj["manifest"]
    if isinstance(obj, str):
        obj = json.loads(obj)
    if not isinstance(obj, dict):
        raise ValueError(f"El archivo {path} no contiene un objeto JSON")
    return obj

def datepart(v):
    return dt.date.fromisoformat(str(v)[:10])

def compare(src, core, school=None, today=None):
    today = today or dt.date.today()
    checks = []
    def add(condition, message, detail):
        checks.append({"pass": bool(condition), "check": message, "detail": detail})

    add(src.get("project") == "AML_CLAUDE", "Origen correcto", str(src.get("project")))
    add(core.get("project") == "ATLAS_CORE", "Atlas correcto", str(core.get("project")))
    add(core.get("source_snapshot_id") == src.get("snapshot_id"),
        "Instantánea enlazada",
        f"origen {src.get('snapshot_id')} / Atlas {core.get('source_snapshot_id')}")
    for field in ("supplier_count", "pair_count", "signal_count", "findings_count"):
        add(src.get(field) is not None and src.get(field) == core.get(field),
            f"Paridad {field}", f"origen {src.get(field)} / Atlas {core.get(field)}")
    add(core.get("supplier_directory_count") == src.get("supplier_count"),
        "Directorio de proveedores", f"Atlas {core.get('supplier_directory_count')} / origen {src.get('supplier_count')}")
    add(core.get("observatory_cron_failures_7d") == 0,
        "Cron del Observatorio sin fallas en 7 días",
        str(core.get("observatory_cron_failures_7d")))
    try:
        period_end = datepart(src["period_end"])
        days = (today - period_end).days
        add(days <= 62, "Vigencia del último período de datos (<=62 días)",
            f"{period_end.isoformat()}, {days} días")
    except (KeyError, TypeError, ValueError) as exc:
        add(False, "Vigencia del último período de datos", f"Fecha inválida: {exc}")
    last = src.get("latest_provider_run") or {}
    add(last.get("status") not in ("FAILED", "ERROR") and bool(last.get("status")),
        "Última ejecución del analizador no fallida",
        f"{last.get('pipeline')}: {last.get('status')}")
    if school is None:
        add(False, "Migración escolar independiente",
            "Sin manifiesto de destino; el sistema escolar continúa en AML CLAUDE")
    else:
        for f in ("school_events", "school_subscriptions", "school_deliveries"):
            add(src.get(f) == school.get(f), "Control escolar " + f,
                f"origen={src.get(f)}, destino={school.get(f)}")
        add(school.get("project") == "SCHOOL_DESTINATION",
            "Destino escolar independiente", str(school.get("project")))
    return checks

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="JSON agregado de AML CLAUDE")
    parser.add_argument("--core", required=True, help="JSON agregado de Atlas")
    parser.add_argument("--school", help="JSON agregado del destino escolar (cuando exista)")
    parser.add_argument("--today", help="Fecha YYYY-MM-DD para pruebas reproducibles")
    args = parser.parse_args()
    src, core = load(args.source), load(args.core)
    school = load(args.school) if args.school else None
    today = dt.date.fromisoformat(args.today) if args.today else None
    checks = compare(src, core, school, today)
    for item in checks:
        print(("[OK] " if item["pass"] else "[BLOQUEADO] ") + item["check"] + ": " + item["detail"])
    good = sum(v["pass"] for v in checks)
    print(f"CONTROLES: {good}/{len(checks)} favorables")
    print("Este comparador NO acredita backup, restauración, seguridad, identidad, ni corte de tráfico.")
    return 0 if good == len(checks) else 1

if __name__ == "__main__":
    sys.exit(main())
