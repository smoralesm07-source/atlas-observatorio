from pathlib import Path
import re

path = Path('src/views/Osfl.tsx')
text = path.read_text()

text = text.replace(
    "import { downloadExcel, ExportButton, exportDate, filtersAsMetadata } from '../lib/excelExport';",
    "import { exportDate } from '../lib/excelExport';",
    1,
)

text = text.replace(
    "  const [exporting, setExporting] = useState(false);",
    "  const [exporting, setExporting] = useState(false);\n  const [exportProgress, setExportProgress] = useState(0);",
    1,
)

pattern = re.compile(r"  async function exportUniverse\(\) \{.*?\n  \}\n\n  if \(dashboard\.loading\)", re.S)
replacement = r'''  async function exportUniverse() {
    setExporting(true);
    setExportProgress(0);
    try {
      type ExportPage = { rows: EntityRow[]; next_cursor: string | null; has_more: boolean };
      const parts: BlobPart[] = [
        '\ufeffsep=;\r\n',
        ['Nombre / Razón social', 'RUT', 'Categoría OSFL', 'Región', 'Comuna', 'Actividad / giro principal', 'Estado', 'Fuentes / cruces']
          .map(csvCell).join(';') + '\r\n',
      ];
      const limit = 10000;
      let cursor: string | null = null;
      let exported = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: payload, error } = await supabase.rpc('obs_osfl_export_page', {
          p_q: debouncedQuery || null,
          p_region: filters.region || null,
          p_type: filters.type || null,
          p_activity: filters.activity || null,
          p_source: filters.source || null,
          p_uaf: filters.uaf,
          p_public_funds: filters.publicFunds,
          p_sanctions: filters.sanctions,
          p_after_entity_id: cursor,
          p_limit: limit,
        });
        if (error) throw error;

        const page = payload as ExportPage | null;
        const batch = page?.rows ?? [];
        if (!batch.length) break;

        const chunk = batch.map((row) => [
          row.name,
          row.rut ?? 'Sin RUT',
          row.type,
          row.region ?? '',
          row.commune ?? '',
          row.main_activity ?? '',
          row.status ?? '',
          Object.entries(row.sources ?? {}).filter(([, present]) => present).map(([source]) => source).join(' · '),
        ].map(csvCell).join(';')).join('\r\n');
        parts.push(chunk + '\r\n');

        exported += batch.length;
        cursor = page?.next_cursor ?? null;
        hasMore = Boolean(page?.has_more && cursor);
        setExportProgress(totalResults > 0 ? Math.min(99, Math.round(exported / totalResults * 100)) : 0);
      }

      setExportProgress(100);
      const blob = new Blob(parts, { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `ATLAS_OSFL_${exportDate()}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.alert(`No fue posible exportar OSFL: ${(error as Error).message}`);
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  }

  if (dashboard.loading)'''
text, count = pattern.subn(lambda _: replacement, text, count=1)
if count != 1:
    raise SystemExit('No se pudo reemplazar exportUniverse')

old_button = '<div className="osfl-export-below"><ExportButton exporting={exporting} count={totalResults} onClick={exportUniverse} /></div>'
new_button = '<div className="osfl-export-below"><button className="atlas-export-button" type="button" disabled={exporting || totalResults <= 0} onClick={exportUniverse} title="Exporta el universo filtrado en un CSV optimizado para Excel">{exporting ? `Preparando archivo… ${exportProgress}%` : `⇩ Exportar universo (${formatNumber(totalResults)})`}</button></div>'
if old_button not in text:
    raise SystemExit('No se encontró el botón OSFL esperado')
text = text.replace(old_button, new_button, 1)

marker = "function formatNumber(value: number | null | undefined)"
helper = "function csvCell(value: unknown) { const text = String(value ?? '').replaceAll('\\r', ' ').replaceAll('\\n', ' '); return `\"${text.replaceAll('\\\"', '\\\"\\\"')}\"`; }\n"
if helper not in text:
    text = text.replace(marker, helper + marker, 1)

path.write_text(text)
