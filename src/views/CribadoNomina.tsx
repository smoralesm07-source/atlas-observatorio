/* Cribado de nóminas: PEP y Poder Judicial desde fuentes abiertas.
 *
 * El analista carga la nómina del requerimiento (RUT y, si lo trae, nombre) y
 * recibe por fila el estado de cada línea con tres valores: con registro, sin
 * registro y no consultada. La nómina no se guarda: sólo se guarda la
 * verificación judicial que el analista registra a mano.
 */
import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { downloadExcel, exportDate } from '../lib/excelExport';
import { Badge, Empty, ErrorBox, Loading, Panel, Semantics } from '../components/primitives';

type LineStatus = 'CON_REGISTRO' | 'SIN_REGISTRO' | 'NO_CONSULTADA' | 'SIN_NOMBRE';
type JudicialResult = 'CON_CAUSAS' | 'SIN_CAUSAS' | 'NO_VERIFICABLE';

interface PepCandidate {
  record_id: string;
  dataset: string;
  name: string;
  positions: string[];
  source_url: string | null;
  match_method: 'NOMBRE_EXACTO' | 'NOMBRE_APROXIMADO';
  match_confidence: number;
}

interface ScreenRow {
  row: number;
  rut: string | null;
  rut_search: string | null;
  rut_valid: boolean;
  name: string | null;
  name_basis: 'NOMINA' | 'UNIVERSO_ATLAS' | null;
  entity_id: string | null;
  pep: { status: LineStatus; candidates: PepCandidate[] };
  judicial: { status: LineStatus; reason?: string; result?: JudicialResult; detail?: string | null; checked_at?: string };
}

interface ScreenResult {
  screened_at: string;
  pep_sources: { dataset: string; row_count: number; loaded_at: string }[];
  rows: ScreenRow[];
}

const CHUNK = 500;
const PJUD_URL = 'https://oficinajudicialvirtual.pjud.cl/';

const STATUS_LABEL: Record<LineStatus, string> = {
  CON_REGISTRO: 'Con registro',
  SIN_REGISTRO: 'Sin registro',
  NO_CONSULTADA: 'No consultada',
  SIN_NOMBRE: 'Sin nombre para cruzar',
};
const STATUS_TONE: Record<LineStatus, 'high' | 'absent' | 'unknown'> = {
  CON_REGISTRO: 'high',
  SIN_REGISTRO: 'absent',
  NO_CONSULTADA: 'unknown',
  SIN_NOMBRE: 'unknown',
};
const DATASET_LABEL: Record<string, string> = {
  cl_info_probidad: 'InfoProbidad · declaraciones Ley 20.880',
  cl_senate: 'Senado',
  cl_chamber_deputies: 'Cámara de Diputadas y Diputados',
};
const JUDICIAL_LABEL: Record<JudicialResult, string> = {
  CON_CAUSAS: 'Con causas',
  SIN_CAUSAS: 'Sin causas',
  NO_VERIFICABLE: 'No verificable',
};

/** Lee CSV o texto pegado: separador ; , o tabulador, con o sin encabezado.
 *  La columna de RUT se reconoce por el encabezado o, si no hay, es la primera. */
export function parseNomina(text: string): { rut: string; name: string }[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const sep = [';', '\t', ','].find((s) => lines[0].includes(s)) ?? ';';
  const split = (l: string) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const hasHeader = head.some((h) => /rut|nombre|raz[oó]n/.test(h));
  const rutIx = hasHeader ? Math.max(0, head.findIndex((h) => h.includes('rut'))) : 0;
  const nameIx = hasHeader ? head.findIndex((h) => /nombre|raz[oó]n/.test(h)) : 1;
  return (hasHeader ? lines.slice(1) : lines).map((l) => {
    const c = split(l);
    return { rut: c[rutIx] ?? '', name: nameIx >= 0 ? c[nameIx] ?? '' : '' };
  });
}

export function CribadoNomina() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<ScreenResult | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => parseNomina(input), [input]);

  async function run() {
    setError(null);
    setResult(null);
    try {
      const rows: ScreenRow[] = [];
      let head: Omit<ScreenResult, 'rows'> | null = null;
      for (let i = 0; i < parsed.length; i += CHUNK) {
        setProgress(`Cribando ${Math.min(i + CHUNK, parsed.length)} de ${parsed.length}…`);
        const { data, error: rpcError } = await supabase.rpc('obs_nomina_screen', { p_rows: parsed.slice(i, i + CHUNK) });
        if (rpcError) throw new Error(rpcError.message);
        const chunk = data as ScreenResult;
        head = head ?? { screened_at: chunk.screened_at, pep_sources: chunk.pep_sources };
        rows.push(...chunk.rows.map((r) => ({ ...r, row: r.row + i })));
      }
      setResult({ ...(head as Omit<ScreenResult, 'rows'>), rows });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) {
      setError('Guarda la planilla como CSV (separado por punto y coma) y cárgala de nuevo.');
      return;
    }
    setInput(await file.text());
  }

  function recordJudicial(row: ScreenRow, judicial: ScreenRow['judicial']) {
    setResult((r) => r && { ...r, rows: r.rows.map((x) => (x.row === row.row ? { ...x, judicial } : x)) });
  }

  return (
    <div className="fade-in">
      <header className="view-head">
        <h1 className="view-title">Cribado de nóminas</h1>
        <p className="view-lede">
          Carga la nómina de un requerimiento y revisa, RUT por RUT, si aparece como persona
          expuesta políticamente y si tiene causas en el Poder Judicial. Cada línea se informa como
          con registro, sin registro o no consultada: una fuente que no se consultó nunca se
          presenta como una fuente sin hallazgos.
        </p>
      </header>

      <div className="grid" style={{ gap: 16 }}>
        <Panel title="Nómina" meta={parsed.length ? `${parsed.length} filas leídas` : undefined}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <input type="file" accept=".csv,.txt,.xls,.xlsx" onChange={(e) => onFile(e.target.files?.[0])} />
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              CSV con columnas RUT y Nombre, o pega las filas abajo.
            </span>
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={6}
            placeholder={'RUT;Nombre\n12.345.678-5;Juan Pérez Soto\n76.086.428-5;Inversiones Ejemplo SpA'}
            style={{ width: '100%', fontFamily: 'var(--mono, monospace)', fontSize: 12.5, padding: 10, background: 'var(--bg-panel-2)', color: 'var(--ink-1)', border: '1px solid var(--line)', borderRadius: 6 }}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button className="btn btn-primary" disabled={!parsed.length || !!progress} onClick={run}>
              Cribar nómina
            </button>
            {result && (
              <button className="btn" onClick={() => exportResult(result)}>
                Exportar a Excel
              </button>
            )}
          </div>
        </Panel>

        {progress && <Loading label={progress} />}
        {error && <ErrorBox error={error} />}
        {result && <Summary result={result} />}
        {result && (
          <Panel title="Resultado por fila" meta={`${result.rows.length} filas`} pad={false}>
            {result.rows.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>RUT</th>
                      <th>Nombre</th>
                      <th>PEP</th>
                      <th>Poder Judicial</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.row}>
                        <td>{r.row}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {r.rut ?? '—'}
                          {r.rut && !r.rut_valid && <div><Badge tone="unknown">DV inválido</Badge></div>}
                        </td>
                        <td>
                          {r.name ?? '—'}
                          {r.name_basis === 'UNIVERSO_ATLAS' && (
                            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Nombre tomado del universo ATLAS</div>
                          )}
                        </td>
                        <td><PepCell row={r} /></td>
                        <td><JudicialCell row={r} onRecorded={(j) => recordJudicial(r, j)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="La nómina no tiene filas" />
            )}
          </Panel>
        )}

        <Semantics>
          <strong>PEP</strong>: se cruza por nombre contra InfoProbidad (declaraciones de la Ley
          20.880), el Senado y la Cámara, estructurados por OpenSanctions. Esas fuentes no publican
          RUT, así que toda coincidencia es candidata y el analista la confirma. No cubren a todos los
          cargos PEP de la Circular UAF ni a familiares o asociados cercanos.{' '}
          <strong>Poder Judicial</strong>: no existe una fuente abierta para consultar en lote. La
          columna informa sólo lo que un analista verificó en la Oficina Judicial Virtual y dejó
          registrado; todo lo demás queda como no consultado.
        </Semantics>
      </div>
    </div>
  );
}

function Summary({ result }: { result: ScreenResult }) {
  const count = (pick: (r: ScreenRow) => LineStatus, s: LineStatus) => result.rows.filter((r) => pick(r) === s).length;
  return (
    <Panel title="Resumen" meta={`Cribado ${new Date(result.screened_at).toLocaleString('es-CL')}`}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
        {(['pep', 'judicial'] as const).map((k) => (
          <div key={k}>
            <strong>{k === 'pep' ? 'PEP' : 'Poder Judicial'}</strong>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {(['CON_REGISTRO', 'SIN_REGISTRO', 'NO_CONSULTADA', 'SIN_NOMBRE'] as LineStatus[]).map((s) => {
                const n = count((r) => r[k].status, s);
                return n ? <Badge key={s} tone={STATUS_TONE[s]}>{STATUS_LABEL[s]}: {n}</Badge> : null;
              })}
            </div>
          </div>
        ))}
        <div>
          <strong>Fuentes PEP cargadas</strong>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>
            {result.pep_sources.length
              ? result.pep_sources.map((s) => (
                  <div key={s.dataset}>
                    {DATASET_LABEL[s.dataset] ?? s.dataset} · {s.row_count} registros · {new Date(s.loaded_at).toLocaleDateString('es-CL')}
                  </div>
                ))
              : 'Ninguna: la línea PEP queda como no consultada.'}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function PepCell({ row }: { row: ScreenRow }) {
  const { status, candidates } = row.pep;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <span><Badge tone={STATUS_TONE[status]} dot>{STATUS_LABEL[status]}</Badge></span>
      {candidates.map((c) => (
        <div key={c.record_id} style={{ fontSize: 12 }}>
          <strong>{c.name}</strong>{' '}
          <span style={{ color: 'var(--ink-3)' }}>
            · {c.match_method === 'NOMBRE_EXACTO' ? 'nombre exacto' : `similitud ${Math.round(c.match_confidence * 100)}%`}
            {' '}· {DATASET_LABEL[c.dataset] ?? c.dataset}
          </span>
          {c.positions.length > 0 && <div style={{ color: 'var(--ink-2)' }}>{c.positions.slice(0, 3).join(' · ')}</div>}
          {c.source_url && <a href={c.source_url} target="_blank" rel="noreferrer">Ver fuente</a>}
        </div>
      ))}
    </div>
  );
}

function JudicialCell({ row, onRecorded }: { row: ScreenRow; onRecorded: (j: ScreenRow['judicial']) => void }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<JudicialResult>('SIN_CAUSAS');
  const [detail, setDetail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const j = row.judicial;

  async function save() {
    setSaving(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('obs_judicial_check_record', {
      p_rut: row.rut, p_result: result, p_detail: detail || null, p_name: row.name,
    });
    setSaving(false);
    if (rpcError) { setError(rpcError.message); return; }
    onRecorded({
      status: result === 'CON_CAUSAS' ? 'CON_REGISTRO' : result === 'SIN_CAUSAS' ? 'SIN_REGISTRO' : 'NO_CONSULTADA',
      result, detail, checked_at: new Date().toISOString(),
    });
    setOpen(false);
  }

  return (
    <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
      <span><Badge tone={STATUS_TONE[j.status]} dot>{j.result ? JUDICIAL_LABEL[j.result] : STATUS_LABEL[j.status]}</Badge></span>
      {j.checked_at && (
        <span style={{ color: 'var(--ink-3)' }}>
          Verificado {new Date(j.checked_at).toLocaleDateString('es-CL')}{j.detail ? ` · ${j.detail}` : ''}
        </span>
      )}
      {row.rut_valid && !open && (
        <span style={{ display: 'flex', gap: 8 }}>
          <a href={PJUD_URL} target="_blank" rel="noreferrer">Abrir Oficina Judicial Virtual</a>
          <button className="btn btn-sm" onClick={() => setOpen(true)}>Registrar verificación</button>
        </span>
      )}
      {open && (
        <div style={{ display: 'grid', gap: 6 }}>
          <select value={result} onChange={(e) => setResult(e.target.value as JudicialResult)}>
            {(Object.keys(JUDICIAL_LABEL) as JudicialResult[]).map((k) => <option key={k} value={k}>{JUDICIAL_LABEL[k]}</option>)}
          </select>
          <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="ROL/RIT, tribunal o forma de búsqueda" />
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm btn-primary" disabled={saving} onClick={save}>Guardar</button>
            <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancelar</button>
          </span>
          {error && <span style={{ color: 'var(--sig-high)' }}>{error}</span>}
        </div>
      )}
    </div>
  );
}

function exportResult(result: ScreenResult) {
  downloadExcel({
    filename: `ATLAS_Cribado_Nomina_${exportDate()}.xls`,
    sheetName: 'Cribado',
    rows: result.rows,
    columns: [
      { header: 'Fila', value: (r) => r.row },
      { header: 'RUT', value: (r) => r.rut ?? '' },
      { header: 'RUT válido', value: (r) => r.rut_valid },
      { header: 'Nombre', value: (r) => r.name ?? '' },
      { header: 'Origen del nombre', value: (r) => (r.name_basis === 'UNIVERSO_ATLAS' ? 'Universo ATLAS' : r.name_basis === 'NOMINA' ? 'Nómina' : '') },
      { header: 'PEP · estado', value: (r) => STATUS_LABEL[r.pep.status] },
      { header: 'PEP · candidatos', value: (r) => r.pep.candidates.map((c) => `${c.name} (${Math.round(c.match_confidence * 100)}%, ${DATASET_LABEL[c.dataset] ?? c.dataset}${c.positions.length ? `: ${c.positions.slice(0, 2).join(' / ')}` : ''})`).join(' | ') },
      { header: 'Poder Judicial · estado', value: (r) => (r.judicial.result ? JUDICIAL_LABEL[r.judicial.result] : STATUS_LABEL[r.judicial.status]) },
      { header: 'Poder Judicial · verificado', value: (r) => (r.judicial.checked_at ? new Date(r.judicial.checked_at).toLocaleDateString('es-CL') : '') },
      { header: 'Poder Judicial · detalle', value: (r) => r.judicial.detail ?? '' },
    ],
    metadata: [
      { label: 'Cribado', value: new Date(result.screened_at).toLocaleString('es-CL') },
      { label: 'Fuentes PEP', value: result.pep_sources.map((s) => `${DATASET_LABEL[s.dataset] ?? s.dataset} (${new Date(s.loaded_at).toLocaleDateString('es-CL')})`).join('; ') || 'Ninguna cargada' },
      { label: 'Alcance PEP', value: 'Coincidencia por nombre; las fuentes no publican RUT. Candidatos sujetos a confirmación.' },
      { label: 'Alcance Poder Judicial', value: 'Sólo verificaciones manuales registradas por analistas. Sin fuente abierta masiva.' },
    ],
  });
}
