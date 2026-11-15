import { MonthlyPerformanceChart } from '../components/MonthlyPerformanceChart';
import { formatReportDate, ReportLayoutComparison, ReportSource } from '../components/ReportEvidence';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Printer,
  Send,
  XCircle,
} from 'lucide-react';
import { BessSensitivity } from '../components/BessSensitivity';
import { CashflowComparisonChart } from '../components/CashflowComparisonChart';
import { InstallVerdictCard } from '../components/InstallVerdictCard';
import { loadActiveCase, upsertCaseToEpcPool } from '../lib/caseStorage';
import { computeEsgValuation, computeInstallVerdict, SOLAR_MODEL_VERSION } from '../lib/solarEngine';
import type { EvaluationCase, GateStatus } from '../types/solar';

function statusBadgeText(status: GateStatus) {
  if (status === 'pass') return { icon: CheckCircle2, cls: 'text-emerald-700' };
  if (status === 'warn') return { icon: AlertTriangle, cls: 'text-amber-700' };
  if (status === 'fail') return { icon: XCircle, cls: 'text-red-700' };
  return { icon: Clock, cls: 'text-slate-600' };
}

export function ReportPage() {
  const navigate = useNavigate();
  const [evalCase, setEvalCase] = useState<EvaluationCase | null>(null);
  const [epcNotice, setEpcNotice] = useState<string | null>(null);

  useEffect(() => {
    setEvalCase(loadActiveCase());
  }, []);

  if (!evalCase) {
    return (
      <main className="max-w-4xl mx-auto px-6 py-16">
        <div className="surface empty-state p-6 sm:p-10 text-center space-y-3">
          <h1 className="text-xl font-bold text-slate-950">尚無可列印的屋頂評估報告</h1>
          <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
            本系統不提供預製示範假資料。請先於案場評估頁定位廠址、框選屋頂多邊形並擷取即時公開圖資，即可立即產出附有完整出處的可行性評估報告。
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="px-5 py-2.5 text-sm font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md cursor-pointer transition-colors"
            >
              前往案場評估頁
            </button>
          </div>
        </div>
      </main>
    );
  }

  const { params, district, result, provenances, taipower, reportEvidence, nasa } = evalCase;
  const model = result.modelVersion === undefined ? '版本未留存' : `v${result.modelVersion}`;
  const isTou = params.tariffMode !== 'flat';
  const shadowSources = provenances.filter((source) =>
    source.key === 'nlsc-3d' ||
    source.key === evalCase.osmSummary?.provenance.key,
  );
  const esg =
    result.esg && typeof result.esg.annualCo2ReductionKg === 'number'
      ? result.esg
      : computeEsgValuation(result.annualGenKwh, params);
  const verdict =
    result.verdict ??
    computeInstallVerdict({
      capacity: result.capacity,
      shading: result.shading,
      annualGenKwh: result.annualGenKwh,
      specificYieldKwhPerKwp: result.specificYieldKwhPerKwp,
      gates: result.gates,
      gate1Recommendation: result.gate1Recommendation ?? null,
      params,
      nasa: evalCase.nasa,
      taipower,
      aiVision: evalCase.aiVision,
      financials: result.financials,
    });

  const handleDownloadJson = () => {
    const blob = new Blob([JSON.stringify(evalCase, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `solarx-report-${evalCase.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSendEpc = () => {
    upsertCaseToEpcPool(evalCase);
    setEpcNotice('已將本案標準化報告規格送入 EPC 媒合頁。');
    window.setTimeout(() => setEpcNotice(null), 4000);
  };

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Action Header (hidden on print) */}
      <div className="no-print page-banner flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-mono text-slate-500">SolarX AI 標準化可行性評估報告</div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950 mt-1">
            {params.factoryName || '工廠屋頂太陽光電評估報告'}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleDownloadJson}
            className="h-9 inline-flex items-center gap-1.5 px-3.5 text-xs font-semibold border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 rounded-md cursor-pointer whitespace-nowrap transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>匯出規格 JSON</span>
          </button>
          <button
            type="button"
            onClick={handleSendEpc}
            className="h-9 inline-flex items-center gap-1.5 px-3.5 text-xs font-semibold border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 rounded-md cursor-pointer whitespace-nowrap transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            <span>送出 EPC 媒合</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="h-9 inline-flex items-center gap-1.5 px-4 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md cursor-pointer whitespace-nowrap transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>列印 / 另存 PDF</span>
          </button>
        </div>
      </div>

      {epcNotice && (
        <div className="no-print text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-4 py-2.5">
          {epcNotice}
        </div>
      )}

      {/* Printable Report Sheet */}
      <article className="surface report-paper p-4 sm:p-6 md:p-10 space-y-8">
        {result.modelVersion !== SOLAR_MODEL_VERSION && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            此報告使用舊版評估模型，容量、遮蔭及其衍生試算須重新確認。請返回案場評估重新計算。
          </p>
        )}
        {/* Report Title & Scope Disclaimer */}
        <header className="border-b border-slate-200 pb-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-mono text-slate-500 flex flex-wrap items-center gap-2">
                <span>案件編號 {evalCase.id}</span>
                <span aria-hidden="true">·</span>
                <span>
                  產出時間 {new Date(evalCase.updatedAt).toLocaleString('zh-TW', { hour12: false })}
                </span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-950">
                {params.factoryName || '台灣工廠屋頂太陽光電可行性前期評估報告'}
              </h2>
              <p className="text-sm text-slate-600">
                廠址：{params.address || '地圖座標定位'}
                {district?.ctyName
                  ? ` · ${district.ctyName}${district.townName}${
                      district.sectName
                        ? ` ${district.sectName.endsWith('段') ? district.sectName : `${district.sectName}段`}(${district.sectCode})`
                        : ''
                    }`
                  : ''}
                {params.taxId ? ` · 統編 ${params.taxId}` : ''}
              </p>
            </div>
            <div className="sm:text-right font-mono tabular-nums text-xs text-slate-600 space-y-1">
              <div>
                WGS84：{evalCase.lat.toFixed(6)}, {evalCase.lon.toFixed(6)}
              </div>
              <div>
                屋頂型式：
                {params.roofType === 'metal'
                  ? '鐵皮屋頂 / 鋼構'
                  : params.roofType === 'rc'
                  ? 'RC 鋼筋混凝土'
                  : '尚未指定'}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3.5 text-xs text-slate-600 leading-relaxed">
            <strong className="text-slate-900">評估範圍聲明：</strong>
            本報告依公開政府圖資、衛星氣象與物理模型進行前期可行性篩選，
            <strong className="text-slate-900">不取代合格結構技師安全簽證及台灣電力公司正式併網審查意見書</strong>
            。報告標示主要估算值所用的公開資料、案場輸入及模型假設。
          </div>

          {/* Executive Gate Readiness Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:divide-x sm:divide-slate-200 border-t border-slate-200 pt-4">
            {result.gates.map((g, idx) => {
              const { icon: Icon, cls } = statusBadgeText(g.status);
              return (
                <div
                  key={g.id}
                  className={idx === 0 ? 'sm:pr-3' : idx === 1 ? 'sm:px-3' : 'sm:pl-3'}
                >
                  <div className="text-[11px] font-medium text-slate-500">{g.title}</div>
                  <div className={`inline-flex items-center gap-1.5 text-xs font-semibold mt-1 ${cls}`}>
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{g.statusLabel}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </header>

        {/* Executive Install Verdict & Quantified Reasons */}
        <div className="print-break-inside-avoid">
          <InstallVerdictCard verdict={verdict} />
        </div>

        {/* Key Capacity & Yield Summary */}
        <section className="print-break-inside-avoid">
          <h3 className="text-base font-bold text-slate-950 mb-4">01. 屋頂可裝容量與發電摘要</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:divide-x sm:divide-slate-200 border-y border-slate-200 py-4">
            <div className="sm:pr-4">
              <div className="text-xs text-slate-500">淨屋頂面積 / 有效面積</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-950 mt-1">
                {(result.capacity.netRoofAreaSqm ?? result.capacity.roofAreaSqm).toFixed(1)} /{' '}
                {result.capacity.effectiveAreaSqm.toFixed(1)} m²
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                退縮 {params.setbackM} m · 通道 {params.walkwayRatioPct}%
                {result.capacity.excludedAreaSqm > 0
                  ? ` · 挖除 ${result.capacity.excludedAreaSqm.toFixed(1)} m²`
                  : ''}
              </div>
            </div>
            <div className="sm:px-4">
              <div className="text-xs text-slate-500">裝置容量 P_DC / P_AC</div>
              <div className="text-lg font-bold font-mono tabular-nums text-amber-700 mt-1">
                {result.capacity.pDcKw.toFixed(1)} kWp / {result.capacity.pAcKw.toFixed(1)} kW
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {params.moduleWatt} Wp × {result.capacity.moduleCount} 片
                {result.capacity.isDeratedByOverride ? ' · Gate 1 降載' : ''}
                <div className="mt-1">
                  案場輸入及模型排布 · {formatReportDate(evalCase.updatedAt)} · {model}
                  <br /><a className="underline" href="#report-inputs">屋頂輪廓與排布參數</a>
                </div>
              </div>
            </div>
            <div className="sm:px-4">
              <div className="text-xs text-slate-500">預估首年發電量</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-950 mt-1">
                {nasa ? `${Math.round(result.annualGenKwh).toLocaleString('zh-TW')} kWh` : '日照資料不足'}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {nasa && result.capacity.pDcKw > 0
                  ? `單位年發電 ${result.specificYieldKwhPerKwp.toFixed(0)} kWh/kWp`
                  : '單位年發電：—'}
                <div className="mt-1">
                  <ReportSource source={nasa?.provenance} missing="NASA POWER 日照資料未取得" />
                  <br />模型估算 · {model} · <a className="underline" href="#report-inputs">發電與遮蔭參數</a>
                </div>
              </div>
            </div>
            <div className="sm:pl-4">
              <div className="text-xs text-slate-500">最近台電饋線餘裕</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-950 mt-1">
                {taipower?.nearestFeeder
                  ? `${taipower.nearestFeeder.capacityKw.toLocaleString('zh-TW')} kW`
                  : '無資料'}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {taipower?.nearestFeeder
                  ? `饋線 ${taipower.nearestFeeder.feederId} · 距 ${taipower.nearestFeeder.distanceM} m`
                  : '須洽台電區處'}
                <div className="mt-1"><ReportSource source={taipower?.provenance} missing="饋線資料未取得" /></div>
              </div>
            </div>
          </div>
        </section>

        <section id="report-inputs" className="scroll-mt-28 space-y-3 rounded-lg border border-slate-200 p-4">
          <h3 className="text-base font-bold text-slate-950">屋頂輪廓、計算參數與電價依據</h3>
          <p className="text-xs text-slate-600">模型 {model} · 案場快照 {formatReportDate(evalCase.updatedAt)}（臺灣時間）</p>
          <dl className="grid gap-3 text-xs text-slate-700 sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-slate-950">案場輸入與工程設定</dt>
              <dd>屋頂標高 {params.targetRoofHeightM} m · 退縮 {params.setbackM} m · 通道 {params.walkwayRatioPct}%</dd>
              <dd>模組 {params.moduleWidthM} × {params.moduleLengthM} m、{params.moduleWatt} Wp · DC/AC {params.dcAcRatio}</dd>
              <dd>上限 {params.maxModuleCountOverride ?? '未設定'} 片 · 遮蔭門檻 {params.excludeShadedThresholdPct == null ? '未啟用' : `${params.excludeShadedThresholdPct}%`}</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-950">發電模型設定</dt>
              <dd>傾角 {params.tiltDeg}° · 方位 {params.azimuthDeg}° · 系統損失 {params.systemLossPct}%</dd>
              <dd>NOCT {params.noctC}°C · 溫度係數 {params.tempCoeffPctPerC}%/°C · 反照率 {params.albedo}</dd>
              {shadowSources.map((source) => <dd key={source.key}><ReportSource source={source} /></dd>)}
              {reportEvidence && (
                <dd>
                  {reportEvidence.shadowBuildings.some((building) => building.heightM !== null)
                    ? `快照內含 ${reportEvidence.shadowBuildings.filter((building) => building.heightM !== null).length} 筆具高度的周邊建物輸入。`
                    : '快照無具高度的周邊建物輸入，現場遮蔭仍待確認。'}
                </dd>
              )}
            </div>
            <div>
              <dt className="font-semibold text-slate-950">躉購費率 {params.fitRateNtd ?? '—'}{params.fitRateNtd != null && ' 元/kWh'}</dt>
              <dd><ReportSource source={reportEvidence?.fitRateSource} missing={params.fitRateNtd == null ? '未設定' : reportEvidence ? `案場輸入／設定值 · 隨案場於 ${formatReportDate(evalCase.updatedAt)} 留存` : '輸入來源未留存'} /></dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-950">自用加權電價 {result.effectiveSelfRateNtd == null ? '—' : `${result.effectiveSelfRateNtd.toFixed(3)} 元/kWh`}</dt>
              <dd><ReportSource source={reportEvidence?.selfRateSource} missing={result.effectiveSelfRateNtd == null ? '未設定' : !reportEvidence ? '輸入來源未留存' : isTou ? '模型內建時段費率 · 依月發電加權' : `案場輸入／設定值 · 隨案場於 ${formatReportDate(evalCase.updatedAt)} 留存`} /></dd>
              {isTou && reportEvidence?.selfRateSource && <dd>公開費率經模型按月發電量加權；報告附存原費率表。</dd>}
            </div>
          </dl>
          <details className="text-xs text-slate-700">
            <summary className="cursor-pointer font-medium">查看屋頂頂點與障礙區（經度、緯度）</summary>
            {evalCase.roofPolygon.length > 0
              ? <ol className="mt-2 list-decimal pl-5 font-mono">{evalCase.roofPolygon.map(([lon, lat], index) =>
                  <li key={index}>{lon.toFixed(7)}, {lat.toFixed(7)}</li>)}</ol>
              : <p className="mt-2">尚未框選屋頂。</p>}
            {(evalCase.exclusionPolygons ?? []).map(({ id, coordinates }, index) => (
              <div key={id} className="mt-2"><strong>障礙區 {index + 1}</strong>
                <ol className="list-decimal pl-5 font-mono">{coordinates.map(([lon, lat], vertex) =>
                  <li key={vertex}>{lon.toFixed(7)}, {lat.toFixed(7)}</li>)}</ol>
              </div>
            ))}
          </details>
          <p className="text-xs text-slate-600">下載報告 JSON 可取得完整參數、輪廓座標與資料快照。</p>
        </section>
        <ReportLayoutComparison evidence={reportEvidence} />

        {/* Three Gates Decision Table */}
        <section className="print-break-inside-avoid">
          <h3 className="text-base font-bold text-slate-950 mb-3">02. 三道關卡可行性判定</h3>
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-200">
            {result.gates.map((gate) => {
              const { icon: Icon, cls } = statusBadgeText(gate.status);
              return (
                <div key={gate.id} className="p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-950">{gate.title}</div>
                    <div className={`inline-flex items-center gap-1.5 text-sm font-semibold ${cls}`}>
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{gate.statusLabel}</span>
                    </div>
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-700 pt-1.5 border-t border-slate-100">
                    <span className="font-sans font-semibold text-slate-900">判斷依據：</span>
                    {gate.quantitativeBasis}
                  </div>
                  <div className="text-xs text-slate-700 space-y-1">
                    {gate.reasons.map((r, i) => (
                      <p key={i}>• {r}</p>
                    ))}
                  </div>
                  <div className="text-xs text-amber-800 font-medium">
                    建議下一步：{gate.nextSteps.join(' ')}
                  </div>
                  {gate.id === 'grid' && result.gate1Recommendation?.isConstrained && (
                    <div className="text-xs border-t border-slate-100 pt-2.5 mt-2 space-y-1">
                      <div className="font-semibold text-slate-950">
                        Gate 1 免補強替代解法
                      </div>
                      <div className="font-mono tabular-nums text-slate-700">
                        • 建議最佳降載併網容量：{result.gate1Recommendation.recommendedMaxAcKw} kW AC（
                        {result.gate1Recommendation.recommendedMaxDcKw.toFixed(1)} kWp /{' '}
                        {result.gate1Recommendation.recommendedModuleCount} 片）
                      </div>
                      {result.gate1Recommendation.alternativeFeeders.length > 0 && (
                        <div className="font-mono tabular-nums text-emerald-800">
                          • 1.5 km 內餘裕替代饋線：
                          {result.gate1Recommendation.alternativeFeeders
                            .slice(0, 3)
                            .map((f) => `${f.feederId} (距 ${f.distanceM}m，餘 ${f.capacityKw} kW)`)
                            .join('、')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* AI Orthophoto Pre-Screening Summary (when executed) */}
        {evalCase.aiVision && (
          <section className="print-break-inside-avoid">
            <h3 className="text-base font-bold text-slate-950 mb-3">
              補充紀錄 · AI 衛星正射影像現勘初篩
            </h3>
            <div className="border-y border-slate-200 py-4 space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-950">
                  AI 判讀疑似屋頂特徵：{evalCase.aiVision.suspectedMaterialLabel}
                </span>
                <span className="font-mono text-slate-500">
                  {evalCase.aiVision.provenance.sourceName}
                </span>
              </div>
              <p className="text-slate-700 leading-relaxed">{evalCase.aiVision.summary}</p>
              {evalCase.aiVision.detectedObstacles.length > 0 && (
                <div className="text-slate-700">
                  檢出屋頂障礙徵兆：
                  {evalCase.aiVision.detectedObstacles
                    .map((o) => `${o.type}（${o.locationHint}）`)
                    .join('、')}
                </div>
              )}
              <div className="text-amber-900 pt-2 border-t border-slate-100 font-medium">
                {evalCase.aiVision.disclaimer}
              </div>
            </div>
          </section>
        )}

        {/* Financial Comparison */}
        <section className="print-break-inside-avoid">
          <h3 className="text-base font-bold text-slate-950 mb-3">
            03. 財務模型與情境比較（20 年期）
          </h3>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-[#F8FAFC] border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="text-left py-2.5 px-3 font-semibold">投資情境</th>
                  <th className="text-right py-2.5 px-3 font-semibold">適用單價</th>
                  <th className="text-right py-2.5 px-3 font-semibold">預估建置成本</th>
                  <th className="text-right py-2.5 px-3 font-semibold">首年淨收益</th>
                  <th className="text-right py-2.5 px-3 font-semibold">回收年限</th>
                  <th className="text-right py-2.5 px-3 font-semibold">20年淨現值 NPV</th>
                  <th className="text-right py-2.5 px-3 font-semibold">內部報酬率 IRR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                {[
                  result.financials.fit,
                  result.financials.self,
                  ...(result.financials.bess ? [result.financials.bess] : []),
                  result.financials.lease,
                ].map((scen, idx) => {
                  const labels = ['全額售電 (躉購 FIT)', '自發自用 (節省電費)', '屋頂出租 (零出資收租)'];
                  if (!scen) {
                    return (
                      <tr key={idx}>
                        <td className="py-2.5 px-3 font-sans font-medium text-slate-900">
                          {labels[idx] || '情境試算'}
                        </td>
                        <td colSpan={6} className="py-2.5 px-3 text-right font-sans text-slate-500">
                          尚未設定適用費率或電價
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr
                      key={scen.id}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        scen.id === 'bess' ? 'bg-emerald-50/40' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3 font-sans font-medium text-slate-900">
                        <div>{scen.label}</div>
                        {scen.id === 'bess' && scen.demandSavingsYear1Ntd ? (
                          <div className="text-[10px] font-mono text-emerald-700 mt-0.5">
                            含契約容量調降年省 {Math.round(scen.demandSavingsYear1Ntd).toLocaleString('zh-TW')} 元
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700">
                        {scen.id === 'lease'
                          ? params.roofLeaseMode === 'revenue_share'
                            ? `分潤 ${params.roofLeaseSharePct}%`
                            : `${params.roofLeaseNtdPerSqmMonth} 元/m²/月`
                          : `${scen.rateUsedNtd?.toFixed(4)} 元/度`}
                        {scen.id !== 'lease' && (
                          <div className="mt-1 text-[10px]"><a className="underline" href="#report-inputs">費率依據</a></div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700">
                        {Math.round(scen.capexNtd).toLocaleString('zh-TW')} 元
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-950 font-medium">
                        {Math.round(scen.year1NetNtd).toLocaleString('zh-TW')} 元
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700">
                        {scen.paybackYears ? `${scen.paybackYears.toFixed(1)} 年` : '零出資'}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-950">
                        {scen.npv20Ntd !== null
                          ? `${Math.round(scen.npv20Ntd).toLocaleString('zh-TW')} 元`
                          : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-emerald-700">
                        {scen.irrPct !== null ? `${scen.irrPct.toFixed(2)}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {result.financials.bess && <BessSensitivity scenario={result.financials.bess} />}
          <div className="mt-4">
            <CashflowComparisonChart
              fit={result.financials.fit}
              self={result.financials.self}
              bess={result.financials.bess ?? null}
            />
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-600 font-mono tabular-nums">
            <span>
              <strong className="font-sans text-slate-800">財務參數：</strong>折現率 {params.discountRatePct}% · 年衰減 {params.degradationPct}% · 建置成本 {params.capexPerKw.toLocaleString('zh-TW')} 元/kW · 年維運 {params.opexPerKwYear} 元/kW
            </span>
            <span>
              <strong className="font-sans text-slate-800">工程配置：</strong>傾角 {params.tiltDeg}° · 方位 {params.azimuthDeg}° · 棚架高 {params.canopyHeightM ?? 3.2}m · 模組 {params.moduleWatt}Wp ({params.moduleWidthM}×{params.moduleLengthM}m) · DC/AC {params.dcAcRatio}
            </span>
          </div>
        </section>

        {/* Monthly Physical Model & Shading Disclosure */}
        <section className="print-break-inside-avoid">
          <h3 className="text-base font-bold text-slate-950 mb-2">
            04. 逐月日照發電與遮蔭模擬明細
          </h3>
          <p className="text-xs text-slate-600 mb-3 leading-relaxed">
            遮蔭規則說明：{result.shading.note}（嚴格僅採用實測 3D Tiles 建物高度與 OSM <code className="font-mono">height</code> 標籤，無高度標籤建物絕不猜測推算。）
          </p>
          {nasa && result.capacity.moduleCount > 0 && (
            <div className="mb-3"><MonthlyPerformanceChart rows={result.monthly} /></div>
          )}
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-[#F8FAFC] border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="text-left py-2.5 px-3 font-semibold">月份</th>
                  <th className="text-right py-2.5 px-3 font-semibold">水平日照 GHI</th>
                  <th className="text-right py-2.5 px-3 font-semibold">傾斜面 POA</th>
                  <th className="text-right py-2.5 px-3 font-semibold">環境氣溫</th>
                  <th className="text-right py-2.5 px-3 font-semibold">模組溫升 T_cell</th>
                  <th className="text-right py-2.5 px-3 font-semibold">溫度係數 η_T</th>
                  <th className="text-right py-2.5 px-3 font-semibold">遮蔭損失 S_m</th>
                  <th className="text-right py-2.5 px-3 font-semibold">預估發電量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                {result.monthly.map((row) => (
                  <tr key={row.month} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2 px-3 font-sans font-medium text-slate-900">
                      {row.monthLabel}
                    </td>
                    <td className="py-2 px-3 text-right">{row.ghiDailyKwhM2.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right">{row.poaMonthlyKwhM2.toFixed(1)}</td>
                    <td className="py-2 px-3 text-right">{row.tAmbC.toFixed(1)} °C</td>
                    <td className="py-2 px-3 text-right">{row.tCellC.toFixed(1)} °C</td>
                    <td className="py-2 px-3 text-right">{(row.etaTemp * 100).toFixed(1)}%</td>
                    <td className="py-2 px-3 text-right">
                      {(row.shadingLossRatio * 100).toFixed(1)}%
                    </td>
                    <td className="py-2 px-3 text-right font-semibold text-slate-950">
                      {Math.round(row.genKwh).toLocaleString('zh-TW')} kWh
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Environmental Benefits & ESG: CO2 kg, Equivalent Trees, T-REC & CBAM */}
        <section className="print-break-inside-avoid">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h3 className="text-base font-bold text-slate-950">
              05. 環境效益與 ESG
            </h3>
            <span className="text-[11px] font-mono tabular-nums text-slate-500">
              基準年發電 {Math.round(result.annualGenKwh).toLocaleString('zh-TW')} kWh × 電力排碳係數 {esg.emissionFactorKgPerKwh.toFixed(3)} kg CO₂e/度
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-0 lg:divide-x lg:divide-slate-200 border-y border-slate-200 py-4">
            <div className="lg:pr-4">
              <div className="text-xs text-slate-500">年減碳量（公斤 / 公噸）</div>
              <div className="text-lg font-bold font-mono tabular-nums text-emerald-700 mt-1">
                {Math.round(esg.annualCo2ReductionKg).toLocaleString('zh-TW')} kg
              </div>
              <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                約 {esg.annualCo2ReductionTonnes.toFixed(2)} tCO₂e/年 · 20年累計{' '}
                {Math.round(esg.lifetime20YrCo2ReductionTonnes).toLocaleString('zh-TW')} t
              </div>
            </div>

            <div className="lg:px-4">
              <div className="text-xs text-slate-500">相當於種植樹木數量</div>
              <div className="text-lg font-bold font-mono tabular-nums text-emerald-700 mt-1">
                {esg.equivalentTreesPlanted.toLocaleString('zh-TW')} 棵/年
              </div>
              <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                依單株喬木年吸碳 12 kg CO₂e 折算
              </div>
            </div>

            <div className="lg:px-4">
              <div className="text-xs text-slate-500">綠電憑證 (T-REC) 預估價值</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-950 mt-1">
                {Math.round(esg.annualTrecValueNtd).toLocaleString('zh-TW')} 元/年
              </div>
              <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                年申領 {esg.annualTrecCertificates.toFixed(1)} 張（自用 {params.selfConsumptionSharePct}% · 單張{' '}
                {(params.trecPriceNtdPerMwh ?? 0).toLocaleString('zh-TW')} 元）
              </div>
            </div>

            <div className="lg:pl-4">
              <div className="text-xs text-slate-500">CBAM / 碳費減免潛力</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-950 mt-1">
                {Math.round(esg.annualCarbonFeeAvoidedNtd).toLocaleString('zh-TW')} 元/年
              </div>
              <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                20年累計 {Math.round(esg.lifetimeCarbonFeeAvoidedNtd / 10000).toLocaleString('zh-TW')} 萬元（參考碳價{' '}
                {params.carbonFeeNtdPerTonne ?? 300} 元/t）
              </div>
            </div>
          </div>

          <div className="mt-2.5 text-[11px] text-slate-500 leading-relaxed space-y-1">
            <div>
              換算明細：年減碳{' '}
              <span className="font-mono tabular-nums text-slate-700">
                {Math.round(esg.annualCo2ReductionKg).toLocaleString('zh-TW')} kg CO₂e
              </span>{' '}
              ÷ 12 kg/棵 ≈{' '}
              <span className="font-mono tabular-nums text-slate-700">
                {esg.equivalentTreesPlanted.toLocaleString('zh-TW')} 棵喬木年吸碳量
              </span>
              ；出口歐洲 CBAM 供應鏈企業可併計範疇二（Scope 2）外購電力排碳抵減效益。
            </div>
            <div>
              法規備註：依《再生能源發展條例》與國家再生能源憑證中心規定，僅「自發自用（不領取台電全額躉購 FIT）」之發電量得申請 T-REC 憑證（每 1,000 度核發 1 張），且{params.includeTrecInSelf ? '本報告自發自用／光儲試算已計入憑證收益。' : '本報告財務表目前採保守估計未將憑證收益併入 IRR。'}
            </div>
          </div>
        </section>

        {/* Provenance Audit List */}
        <section>
          <h3 id="report-sources" className="text-base font-bold text-slate-950 mb-3">06. 公開資料來源與取得時間清單</h3>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-[#F8FAFC] border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="text-left py-2.5 px-3 font-semibold">資料項目</th>
                  <th className="text-left py-2.5 px-3 font-semibold">來源與狀態</th>
                  <th className="text-left py-2.5 px-3 font-semibold">取得時間</th>
                  <th className="text-left py-2.5 px-3 font-semibold">出處網址與備註</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {provenances.map((p) => (
                  <tr key={p.key} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-3 font-medium text-slate-900 whitespace-nowrap">
                      {p.label}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700">{p.sourceName}</td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {formatReportDate(p.fetchedAt)}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      <div>{p.summary}</div>
                      {/^https?:\/\//i.test(p.sourceUrl) && (
                        <a
                          href={p.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-mono text-amber-700 hover:underline break-all mt-0.5"
                        >
                          <span>{p.sourceUrl}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </article>
    </main>
  );
}
