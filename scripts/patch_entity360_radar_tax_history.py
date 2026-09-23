from pathlib import Path

path = Path('src/views/EntityExpediente.tsx')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        "import { useRpc } from '../lib/rpc';\n",
        "import { useRpc } from '../lib/rpc';\nimport { supabase } from '../lib/supabase';\n",
    ),
    (
        "  return rows.sort((a, b) => a.year - b.year).slice(-6);\n",
        "  return rows.sort((a, b) => a.year - b.year);\n",
    ),
    (
        "  const { data, error, loading, reload } = useRpc<EntityDetail | null>('obs_entity_detail', { p_entity_id: entityId });\n  const { data: taxHistory } = useRpc<EntityTaxHistoryRow[]>('obs_entity_tax_history', { p_entity_id: entityId });\n\n  useEffect(() => {\n",
        "  const { data, error, loading, reload } = useRpc<EntityDetail | null>('obs_entity_detail', { p_entity_id: entityId });\n  const { data: taxHistory } = useRpc<EntityTaxHistoryRow[]>('obs_entity_tax_history', { p_entity_id: entityId });\n  const [liveTaxHistory, setLiveTaxHistory] = useState<EntityTaxHistoryRow[] | null>(null);\n\n  useEffect(() => {\n    let cancelled = false;\n    const rut = data?.entity.rut;\n    if (!rut) {\n      setLiveTaxHistory(null);\n      return () => { cancelled = true; };\n    }\n    setLiveTaxHistory(null);\n    const run = async () => {\n      try {\n        const { data: live, error: liveError } = await supabase.functions.invoke('atlas-sii-tax-history-live', { body: { rut } });\n        const rows = !liveError && live && live.ok && Array.isArray(live.rows) ? live.rows as EntityTaxHistoryRow[] : null;\n        if (!cancelled) setLiveTaxHistory(rows);\n      } catch {\n        if (!cancelled) setLiveTaxHistory(null);\n      }\n    };\n    void run();\n    return () => { cancelled = true; };\n  }, [data?.entity.entity_id, data?.entity.rut]);\n\n  useEffect(() => {\n",
    ),
    (
        "  const history = salesHistory(data, taxHistory);\n",
        "  const mergedTaxHistory = useMemo(() => {\n    const byYear = new Map<number, EntityTaxHistoryRow>();\n    (taxHistory ?? []).forEach((row) => byYear.set(Number(row.commercial_year), row));\n    (liveTaxHistory ?? []).forEach((row) => byYear.set(Number(row.commercial_year), row));\n    return [...byYear.values()].filter((row) => Number.isFinite(Number(row.commercial_year))).sort((a, b) => Number(a.commercial_year) - Number(b.commercial_year));\n  }, [taxHistory, liveTaxHistory]);\n  const history = salesHistory(data, mergedTaxHistory);\n",
    ),
]

for old, new in replacements:
    if old not in text:
        raise SystemExit(f'Expected block not found:\n{old[:180]}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('EntityExpediente.tsx patched for complete Radar SII tax history.')
