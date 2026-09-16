from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"


def read(rel: str) -> tuple[Path, str]:
    path = ROOT / rel
    return path, path.read_text(encoding="utf-8")


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def replace_required(rel: str, old: str, new: str, *, count: int | None = None) -> None:
    path, text = read(rel)
    hits = text.count(old)
    if hits == 0:
        raise RuntimeError(f"No se encontró el bloque esperado en {rel}: {old[:100]!r}")
    if count is not None and hits != count:
        raise RuntimeError(f"Se esperaban {count} coincidencias en {rel} y se encontraron {hits}: {old[:100]!r}")
    write(path, text.replace(old, new))


# 1) Marca pública: IPA3 era la versión técnica; la interfaz pasa a llamarlo simplemente IPA.
# No se renombran campos internos ipa3_* para no romper contratos ni histórico.
for path in SRC.rglob("*"):
    if path.suffix not in {".ts", ".tsx"}:
        continue
    text = path.read_text(encoding="utf-8")
    updated = text.replace("IPA3", "IPA")
    if updated != text:
        path.write_text(updated, encoding="utf-8")

# 2) Entidad 360: IPF deja de competir como segundo score visible.
replace_required(
    "src/views/EntityExpediente.tsx",
    "    <dt>IPF</dt><dd>{numberValue(uaf.ipf_score) == null ? '—' : `${n1(numberValue(uaf.ipf_score))} · ${text(uaf.ipf_band) ?? 'sin banda'}`}</dd>\n",
    "",
    count=1,
)

# 3) Metodología: un solo índice principal. IPF permanece únicamente como benchmark interno de transición.
replace_required(
    "src/views/Metodologia.tsx",
    """            <dt>IPF · Priorización fiscalizadora</dt>\n            <dd>\n              Ordena esfuerzo de fiscalización sobre sujetos obligados inscritos.\n              Su tasa sancionatoria describe lo publicado por la UAF, no la conducta\n              agregada del sector.\n            </dd>\n""",
    """            <dt>Contexto sectorial y supervisión</dt>\n            <dd>\n              Vulnerabilidad sectorial, supervisión, escala y observabilidad se muestran\n              como dimensiones explicativas del IPA, no como un segundo índice competidor.\n            </dd>\n""",
    count=1,
)

# 4) Directorio de sujetos obligados: usa el IPA vigente del snapshot, no IPF.
replace_required("src/components/SubjectDirectory.tsx", "'obs_uaf_subject_directory_v3'", "'obs_uaf_subject_directory_v4'", count=1)
replace_required("src/components/SubjectDirectory.tsx", "sort === 'score' ? 'ipf'", "sort === 'score' ? 'ipa'", count=1)
replace_required("src/components/SubjectDirectory.tsx", "{selection.kind === 'registered' ? 'IPF' : 'IVO'}", "{selection.kind === 'registered' ? 'IPA' : 'IVO'}", count=1)
replace_required(
    "src/components/SubjectDirectory.tsx",
    "{selection.kind === 'registered' ? 'IPF ordena revisión; no mide riesgo LA/FT.' : 'IVO ordena revisión registral; no acredita obligación ni incumplimiento.'}",
    "{selection.kind === 'registered' ? 'IPA ordena prioridad analítica; no mide probabilidad de LA/FT.' : 'IVO ordena revisión registral; no acredita obligación ni incumplimiento.'}",
    count=1,
)
replace_required("src/components/SubjectDirectory.tsx", "<th>IPF</th>", "<th>IPA</th>", count=1)
replace_required("src/components/SubjectDirectory.tsx", "row.ipf_score", "row.ipa_score", count=2)
replace_required("src/components/SubjectDirectory.tsx", "row.ipf_band", "row.ipa_band", count=2)
# El motivo interno histórico IPF_ALTA se mantiene por compatibilidad de datos, pero no se expone como un segundo índice.
replace_required("src/components/SubjectDirectory.tsx", "IPF_ALTA: 'IPF alto'", "IPF_ALTA: 'Prioridad alta'", count=1)

# 5) Contrato TypeScript: se conserva IPF internamente, pero el nuevo RPC expone IPA.
contracts = ROOT / "src/lib/contracts.ts"
text = contracts.read_text(encoding="utf-8")
needle = "  ipf_score: number | null;\n  ipf_band: string | null;\n"
if needle not in text:
    raise RuntimeError("No se encontró el bloque IPF esperado en contracts.ts")
if "  ipa_score: number | null;\n  ipa_band: string | null;\n" not in text:
    text = text.replace(needle, needle + "  ipa_score: number | null;\n  ipa_band: string | null;\n")
# Nueva cohorte pública; se mantiene el alias IPF_ALTO sólo para contratos históricos.
cohort_old = "  | 'ATENCION' | 'MOTIVO' | 'IPF_ALTO' | 'GIRO_ATIPICO'"
cohort_new = "  | 'ATENCION' | 'MOTIVO' | 'IPA_ALTO' | 'IPF_ALTO' | 'GIRO_ATIPICO'"
if cohort_old not in text:
    raise RuntimeError("No se encontró UafCohort con IPF_ALTO en contracts.ts")
text = text.replace(cohort_old, cohort_new, 1)
contracts.write_text(text, encoding="utf-8")

# 6) Universo SO: el acceso rápido y la explicación pasan a IPA.
replace_required(
    "src/views/universo/PadronAxisV2.tsx",
    "{ cohort: 'IPF_ALTO', title: 'Sujetos con IPF alta o muy alta' }",
    "{ cohort: 'IPA_ALTO', title: 'Sujetos con IPA alta o muy alta' }",
    count=1,
)
replace_required(
    "src/views/UniversoSOV2.tsx",
    "Sanciones, prensa, IPF y demás marcas sirven para ordenar revisión: no concluyen por sí solas incumplimiento ni riesgo LA/FT.",
    "Sanciones, prensa y demás marcas alimentan el IPA para ordenar revisión: no concluyen por sí solas incumplimiento ni riesgo LA/FT.",
    count=1,
)

# 7) Ficha clásica: estandariza IPA y retira la antigua ficha IPF/percentiles.
replace_required("src/views/Ficha.tsx", 'label="Prioridad analítica"', 'label="IPA"', count=1)
replace_required(
    "src/views/Ficha.tsx",
    "              <Row k=\"IPF\" v={`${n1(uaf.ipf_score as number)} · ${String(uaf.ipf_band ?? '—')}`} />\n",
    "",
    count=1,
)
replace_required(
    "src/views/Ficha.tsx",
    "              <Row k=\"Percentil IPF\" v={pct(uaf.ipf_percentile as number)} />\n",
    "",
    count=1,
)
replace_required(
    "src/views/Ficha.tsx",
    "              <Row k=\"Percentil en sector\" v={pct(uaf.ipf_sector_percentile as number)} />\n",
    "",
    count=1,
)

# Protección: ninguna superficie activa debe seguir mostrando IPA3 o IPF como rótulo.
# IPF_ALTA puede persistir como clave técnica heredada hasta migrar el histórico de motivos.
active_surfaces = [
    "src/views/EntityExpediente.tsx",
    "src/views/Metodologia.tsx",
    "src/components/SubjectDirectory.tsx",
    "src/views/universo/PadronAxisV2.tsx",
    "src/views/UniversoSOV2.tsx",
    "src/views/Ficha.tsx",
]
for rel in active_surfaces:
    content = (ROOT / rel).read_text(encoding="utf-8")
    if "IPA3" in content:
        raise RuntimeError(f"Persistió el rótulo IPA3 en {rel}")
    visible_check = content.replace("IPF_ALTA", "")
    if "IPF" in visible_check:
        raise RuntimeError(f"Persistió un IPF visible o referencia no migrada en {rel}")

print("Unificación IPA aplicada: IPA es el único índice principal visible en las superficies activas.")
