import type { ReactNode } from 'react';

export type ExcelColumn<T> = {
  header: string;
  value: (row: T) => unknown;
};

export type ExcelMeta = { label: string; value: unknown };

function xmlEscape(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function cell(value: unknown, header = false): string {
  const style = header ? ' ss:StyleID="Header"' : '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<Cell${style}><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  if (typeof value === 'boolean') {
    return `<Cell${style}><Data ss:Type="String">${value ? 'Sí' : 'No'}</Data></Cell>`;
  }
  return `<Cell${style}><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`;
}

function row(values: unknown[], header = false): string {
  return `<Row>${values.map((value) => cell(value, header)).join('')}</Row>`;
}

function worksheet<T>(name: string, rows: T[], columns: ExcelColumn<T>[]): string {
  const header = row(columns.map((column) => column.header), true);
  const body = rows.map((item) => row(columns.map((column) => column.value(item)))).join('');
  const range = rows.length ? `R1C1:R${rows.length + 1}C${Math.max(1, columns.length)}` : `R1C1:R1C${Math.max(1, columns.length)}`;
  return `<Worksheet ss:Name="${xmlEscape(name)}"><Table>${header}${body}</Table><x:AutoFilter x:Range="${range}"/><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions></Worksheet>`;
}

function metadataSheet(metadata: ExcelMeta[]): string {
  const rows = metadata.map((item) => row([item.label, item.value])).join('');
  return `<Worksheet ss:Name="Metadatos"><Table>${row(['Campo', 'Valor'], true)}${rows}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions></Worksheet>`;
}

// Reusable export for monitor universes; each monitor supplies its filtered rows and domain columns.
export function downloadExcel<T>({ filename, sheetName, rows, columns, metadata }: {
  filename: string;
  sheetName: string;
  rows: T[];
  columns: ExcelColumn<T>[];
  metadata: ExcelMeta[];
}) {
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Bottom"/><Font ss:FontName="Calibri" ss:Size="11"/></Style><Style ss:ID="Header"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1"/><Interior ss:Color="#EDEDED" ss:Pattern="Solid"/></Style></Styles>${worksheet(sheetName, rows, columns)}${metadataSheet(metadata)}</Workbook>`;
  const blob = new Blob(['\ufeff', workbook], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function exportDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function filtersAsMetadata(filters: Record<string, unknown>): ExcelMeta[] {
  const active = Object.entries(filters)
    .filter(([, value]) => value != null && value !== '' && value !== 'TODAS' && value !== 'TODOS')
    .map(([key, value]) => `${key}=${String(value)}`);
  return [{ label: 'Filtros aplicados', value: active.length ? active.join(' · ') : 'Sin filtros' }];
}

export function ExportButton({ exporting, count, onClick }: { exporting: boolean; count: number; onClick: () => void }): ReactNode {
  return <button className="atlas-export-button" type="button" disabled={exporting || count <= 0} onClick={onClick} title="Exporta el universo actualmente filtrado a Excel">{exporting ? 'Preparando Excel…' : `⇩ Exportar universo${count > 0 ? ` (${count.toLocaleString('es-CL')})` : ''}`}</button>;
}
