import { useMemo, useState } from 'react';
import { useRpc } from '../lib/rpc';

type CohortRow = {
  cohort_code: string;
  cohort_label: string;
  entity_count: number;
  business_model_classified: number;
  target_customer_classified: number;
  revenue_model_classified: number;
  metrics_profiled: number;
  function_profiled: number;
  psav_confirmed: number;
  va_exposure: number;
  comparable_entities: number;
  cmf_registered: number;
  uaf_registered: number;
  dual_registered: number;
};

type LeaderRow = {
  cohort_code: string;
  cohort_label: string;
  metric_code: string;
  metric_label: string;
  dimension: string;
  entity_name: string;
  fintech_id: string;
  value_numeric: number;
  value_text: string | null;
  unit: string | null;
  currency: string | null;
  qualifier: string | null;
  geography: string | null;
  source_url: string | null;
  peer_count: number | null;
  peer_rank: number | null;
  percentile: number | null;
  tier: string | null;
};

type MarketStatus = {
  error?: string;
  observations: number;
  entities_profiled: number;
  cohorts: CohortRow[];
  leaders: LeaderRow[];
  refreshed_at: string | null;
  methodology: string;
};

const COHORT_ORDER = [
  'PAYMENTS_REMITTANCES',
  'LENDING_FINANCING',
  'FINANCE_MANAGEMENT',
  'WEALTH_MARKETS',
  'FINANCIAL_INFRASTRUCTURE',
  'INSURTECH',
  'DIGITAL_ASSETS',
];

const METRIC_ORDER = [
  'USERS','CLIENTS','BUSINESS_CLIENTS','MERCHANTS','INSURED_PERSONS','APP_DOWNLOADS_COUNT',
  'TRANSACTIONS_MONTHLY_COUNT','TRANSACTIONS_QUARTERLY_COUNT','TRANSACTIONS_ANNUAL_COUNT',
  'VERIFICATIONS_24H_COUNT','FINANCINGS_COUNT','PROJECTS_FINANCED_COUNT',
  'PROCESSED_VOLUME_MONTHLY_USD','PROCESSED_VOLUME_PERIOD_USD','ANNUAL_TRANSACTION_VOLUME_USD','ANNUALIZED_TRANSACTION_VOLUME_USD_EST',
  'CUMULATIVE_TRANSACTION_VOLUME_USD','TPV_USD','ORIGINATED_VOLUME_USD','AUM_AUC_USD',
  'FINANCIAL_INSTITUTIONS_CONNECTED_COUNT','DATA_SOURCES_CONNECTED_COUNT','API_CONNECTIONS',
  'COUNTRIES_SERVICE_REACH','COUNTRIES_OPERATING','PAYMENT_METHODS_COUNT','AGREEMENTS_COUNT','HEALTH_PROVIDERS_NETWORK',
];

export function FintechMarketCohorts({ onSelectEntity }: { onSelectEntity: (entityName: string) => void }) {
  const market = useRpc<MarketStatus>('obs_fintech_market_weight_status', {});
  const [active, setActive] = useState('PAYMENTS_REMITTANCES');
  const data = market.data;

  const cohorts = useMemo(() => {
    const rows = data?.cohorts ?? [];
    return [...rows].sort((a,b) => COHORT_ORDER.indexOf(a.cohort_code) - COHORT_ORDER.indexOf(b.cohort_code));
  }, [data?.cohorts]);

  const selected = cohorts.find((row) => row.cohort_code === active) ?? cohorts[0];
  const leaders = useMemo(() => {
    if (!selected) return [];
    return (data?.leaders ?? [])
      .filter((row) => row.cohort_code === selected.cohort_code)
      .sort((a,b) => metricOrder(a.metric_code) - metricOrder(b.metric_code))
      .slice(0,8);
  }, [data?.leaders, selected]);

  if (market.loading) return <div className="fintech-market-loading">Construyendo cohortes comparables…</div>;
  if (market.error || !data || data.error) return <div className="fintech-market-loading error">No fue posible cargar la lectura de peso observable.</div>;

  return <>
    <div className="fintech-cohort-grid">
      {cohorts.map((row) => {
        const metricsPct = pct(row.metrics_profiled,row.entity_count);
        const comparablePct = pct(row.comparable_entities,row.entity_count);
        return <button key={row.cohort_code} data-active={selected?.cohort_code===row.cohort_code} onClick={() => setActive(row.cohort_code)}>
          <span>{row.cohort_label}</span>
          <strong>{formatNumber(row.entity_count)}</strong>
          <small>{formatNumber(row.metrics_profiled)} con métricas · {formatNumber(row.comparable_entities)} comparables</small>
          <i className="coverage"><b style={{width:`${metricsPct}%`}} /></i>
          <em>{metricsPct}% evidencia · {comparablePct}% con pares</em>
        </button>;
      })}
    </div>

    {selected && <div className="fintech-market-focus">
      <div className="fintech-market-summary">
        <div className="fintech-market-summary-head"><div><span>Cohorte activa</span><h3>{selected.cohort_label}</h3></div><b>{formatNumber(selected.entity_count)}</b></div>
        <div className="fintech-market-stat-grid">
          <MarketStat label="Modelo conocido" value={selected.business_model_classified} total={selected.entity_count}/>
          <MarketStat label="Con métricas" value={selected.metrics_profiled} total={selected.entity_count}/>
          <MarketStat label="Con pares válidos" value={selected.comparable_entities} total={selected.entity_count}/>
          <MarketStat label="Monetización" value={selected.revenue_model_classified} total={selected.entity_count}/>
        </div>
        <div className="fintech-market-signal-row">
          <span><b>{formatNumber(selected.function_profiled)}</b> función financiera observada</span>
          {(selected.cmf_registered>0 || selected.uaf_registered>0) && <span><b>{formatNumber(selected.cmf_registered)}</b> CMF · <b>{formatNumber(selected.uaf_registered)}</b> UAF{selected.dual_registered>0 ? ` · ${formatNumber(selected.dual_registered)} ambos` : ''}</span>}
          {(selected.psav_confirmed>0 || selected.va_exposure>0) && <span><b>{formatNumber(selected.psav_confirmed)}</b> PSAV · <b>{formatNumber(selected.va_exposure)}</b> exposición AV</span>}
        </div>
      </div>

      <div className="fintech-market-leaders">
        <div className="fintech-market-leaders-head"><div><b>Líderes observables</b><span>Cada fila usa una unidad propia; no se suman entre sí.</span></div><small>{leaders.length} métricas con señal</small></div>
        {leaders.length ? <div className="fintech-market-leader-list">{leaders.map((row) => <button key={`${row.cohort_code}-${row.metric_code}`} onClick={() => onSelectEntity(row.entity_name)} title={row.value_text ?? row.metric_label}>
          <span className="metric"><b>{shortMetric(row.metric_code,row.metric_label)}</b><small>{dimensionLabel(row.dimension)}</small></span>
          <span className="entity">{row.entity_name}</span>
          <strong>{formatMetricValue(row)}</strong>
          <em data-comparable={row.percentile!=null}>{row.percentile!=null ? `P${Math.round(row.percentile*100)} · ${row.peer_count} pares` : `${row.peer_count ?? 0} pares · insuf.`}</em>
        </button>)}</div> : <div className="fintech-market-empty">La cohorte todavía no tiene métricas cuantitativas suficientes para mostrar líderes comparables.</div>}
      </div>
    </div>}

    <div className="fintech-market-method"><span>Lectura</span><p>{data.methodology}</p><small>{formatNumber(data.entities_profiled)} entidades con alguna métrica · {formatNumber(data.observations)} observaciones estructuradas.</small></div>
  </>;
}

function MarketStat({label,value,total}:{label:string;value:number;total:number}) {
  const share=pct(value,total);
  return <div><span>{label}</span><b>{formatNumber(value)} <small>/ {formatNumber(total)}</small></b><i><em style={{width:`${share}%`}} /></i><small>{share}%</small></div>;
}

function metricOrder(code:string) { const index=METRIC_ORDER.indexOf(code); return index===-1 ? 999 : index; }
function pct(value:number,total:number) { return total>0 ? Math.round(value/total*100) : 0; }
function formatNumber(value:number|null|undefined) { return value==null ? 'n/d' : new Intl.NumberFormat('es-CL').format(value); }
function compact(value:number) { return new Intl.NumberFormat('es-CL',{notation:'compact',maximumFractionDigits:1}).format(value); }
function formatMetricValue(row:LeaderRow) {
  if (row.currency==='USD' || row.unit==='USD') return `USD ${compact(row.value_numeric)}`;
  const suffix:Record<string,string>={ users:' usuarios',clients:' clientes',companies:' empresas',merchants:' comercios',insured_persons:' asegurados',downloads:' descargas',transactions:' tx',verifications:' verificaciones',financings:' financiamientos',projects:' proyectos',institutions:' instituciones',sources:' fuentes',countries:' países',payment_methods:' medios',connections:' conexiones',agreements:' acuerdos',providers:' prestadores',policies:' pólizas',workers:' trabajadores' };
  return `${compact(row.value_numeric)}${suffix[row.unit ?? ''] ?? (row.unit ? ` ${row.unit}` : '')}`;
}
function shortMetric(code:string,label:string) {
  const map:Record<string,string>={
    USERS:'Usuarios',CLIENTS:'Clientes',BUSINESS_CLIENTS:'Clientes empresa',MERCHANTS:'Comercios',INSURED_PERSONS:'Asegurados',APP_DOWNLOADS_COUNT:'Descargas app',
    TRANSACTIONS_MONTHLY_COUNT:'Transacciones / mes',TRANSACTIONS_QUARTERLY_COUNT:'Transacciones / trimestre',TRANSACTIONS_ANNUAL_COUNT:'Transacciones / año',VERIFICATIONS_24H_COUNT:'Verificaciones / 24h',FINANCINGS_COUNT:'Financiamientos',PROJECTS_FINANCED_COUNT:'Proyectos financiados',
    PROCESSED_VOLUME_MONTHLY_USD:'Volumen procesado / mes',PROCESSED_VOLUME_PERIOD_USD:'Volumen del período',ANNUAL_TRANSACTION_VOLUME_USD:'Volumen anual',ANNUALIZED_TRANSACTION_VOLUME_USD_EST:'Volumen anualizado',CUMULATIVE_TRANSACTION_VOLUME_USD:'Volumen acumulado',TPV_USD:'TPV',ORIGINATED_VOLUME_USD:'Originación',AUM_AUC_USD:'AUM / AUC',
    FINANCIAL_INSTITUTIONS_CONNECTED_COUNT:'Instituciones conectadas',DATA_SOURCES_CONNECTED_COUNT:'Fuentes conectadas',API_CONNECTIONS:'Conexiones API',COUNTRIES_SERVICE_REACH:'Alcance países',COUNTRIES_OPERATING:'Países operando',PAYMENT_METHODS_COUNT:'Métodos de pago',AGREEMENTS_COUNT:'Acuerdos de red',HEALTH_PROVIDERS_NETWORK:'Red de prestadores',
  };
  return map[code] ?? label;
}
function dimensionLabel(value:string) { return ({ECONOMIC_SCALE:'escala económica',BUSINESS_ACTIVITY:'actividad',REACH:'alcance',CAPITAL:'capital'} as Record<string,string>)[value] ?? value.toLowerCase().replaceAll('_',' '); }
