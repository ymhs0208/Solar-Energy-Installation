import { Link, useSearchParams } from 'react-router-dom'
import { Source, StatusPill } from '../components/Bits'
import { formatKwh, formatKwp, formatM2, formatPercent, formatTwd, formatYears } from '../lib/format'
import { STRUCTURAL_CHECKLIST, surveyRecommendation } from '../lib/gates'
import { useSession } from '../session'
import { InstallationGuide } from '../components/InstallationGuide'

export function ReportPage() {
  const { report: currentReport, savedReports } = useSession()
  const [params] = useSearchParams()
  const savedId = params.get('案場')
  const report = savedId ? (Object.hasOwn(savedReports, savedId) ? savedReports[savedId] : null) : currentReport
  if (!report) {
    return (
      <p className="text-sm">
        {savedId ? '找不到這份已存報告。' : '目前沒有開啟的報告。'} <Link className="underline" to="/epc">查看已存案場</Link>
      </p>
    )
  }
  const chosen = report.analysis.layouts.find((item) => item.name === report.layoutName) ?? report.analysis.layouts[0]
  const recommendation = surveyRecommendation(report.analysis.gates, report.analysis.structural.missing)
  const inputs = report.inputs
  const metrics = [
    ['圈選屋頂面積', report.analysis.areaM2 > 0 ? formatM2(report.analysis.areaM2) : '待圈選', '地圖圈選範圍'],
    ['直流裝置容量', chosen?.kwp != null ? formatKwp(chosen.kwp) : '待估算', chosen ? `${chosen.name} · ${chosen.count} 片` : '需屋頂範圍與模組規格'],
    ['年發電量初估', chosen?.annualKwh != null ? formatKwh(chosen.annualKwh) : '待估算', '依 NASA POWER 氣候資料'],
  ]
  return (
    <article className="space-y-5 rounded-xl border border-line bg-white p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="text-xs tracking-wide text-stone-500">SolarX AI 快篩報告</p>
          <h1 className="text-2xl font-bold">{report.name}</h1>
          <p className="text-sm">{report.address}</p>
          <p className="text-sm text-stone-600">{report.label}</p>
          <p className="text-sm text-stone-600">{report.lat.toFixed(6)}, {report.lng.toFixed(6)}</p>
        </div>
        <div className="no-print flex shrink-0 flex-col gap-2 sm:flex-row">
          <Link className="rounded border border-line px-3 py-1 text-sm" to={savedId ? '/epc' : '/'}>{savedId ? '返回案場' : '返回快篩'}</Link>
          <button type="button" className="rounded border border-ink px-3 py-1 text-sm" onClick={() => window.print()}>
            列印／存 PDF
          </button>
        </div>
      </header>
      <dl className="grid gap-2 sm:grid-cols-3">
        {metrics.map(([label, value, detail]) => (
          <div key={label} className="rounded-lg border border-line bg-card p-3">
            <dt className="text-sm text-stone-600">{label}</dt>
            <dd className="mt-1 text-xl font-bold">{value}</dd>
            <dd className="mt-1 text-xs text-stone-600">{detail}</dd>
          </div>
        ))}
      </dl>
      <section className="rounded-lg border border-line bg-card p-4 sm:p-5" aria-labelledby="survey-title">
        <p className="text-sm font-bold text-stone-600">現勘建議</p>
        <h2 id="survey-title" className="mt-1 text-2xl font-bold">{recommendation.status}</h2>
        <ul className="mt-3 divide-y divide-line text-sm">
          {recommendation.tasks.map((task) => (
            <li key={task.id} className="py-2.5">
              <h3 className="font-bold">{task.title}</h3>
              <p className="mt-1 text-stone-600">{task.reason}</p>
              <p className="mt-1">{task.next}</p>
            </li>
          ))}
        </ul>
      </section>
      <p className="text-sm text-stone-600">
        工廠登記日期 {report.registrationDate ?? '未取得'} · 建物完工年份 {report.completionYear ?? '待確認'}
        {report.analysis.ageYears != null ? ` · 估算屋齡約 ${report.analysis.ageYears} 年` : ''}
      </p>
      <section aria-label="初查依據" className="grid gap-3 md:grid-cols-3">
        {report.analysis.gates.map((gate) => (
          <div key={gate.id} className="rounded border border-line p-3">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">{gate.title}</h2>
              <StatusPill status={gate.status} />
            </div>
            <ul className="mt-2 space-y-1 text-sm">{gate.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          </div>
        ))}
      </section>
      <section>
        <h2 className="font-bold">配置比較 · {report.layoutName}</h2>
        {report.analysis.recommendation ? (
          <p className="mt-1 text-sm text-stone-600">系統依{report.analysis.recommendation.basis === 'energy' ? '年發電量初估' : '直流裝置容量'}建議先看 {report.analysis.layouts.find((layout) => layout.id === report.analysis.recommendation?.id)?.name}。</p>
        ) : null}
        <p className="mt-1 text-sm">模組規格 {report.moduleName ?? '已略過'}</p>
        {report.analysis.usableAreaM2 != null ? <p className="mt-1 text-sm">排除設備與通道範圍 {formatM2(report.analysis.excludedAreaM2 ?? 0)} · 可配置範圍 {formatM2(report.analysis.usableAreaM2)}</p> : null}
        {chosen?.annualKwh != null && report.estimateLimits.length ? (
          <p className="mt-1 text-sm text-amber-800">發電量初估 · {report.estimateLimits.join('、')}</p>
        ) : null}
        {chosen ? (
          <p className="mt-1 text-sm">
            面積 {formatM2(report.analysis.areaM2)} · {chosen.kwp == null ? '無裝置容量' : formatKwp(chosen.kwp)} · {chosen.annualKwh == null ? '無發電量' : `年發電 ${formatKwh(chosen.annualKwh)}`}
          </p>
        ) : null}
        <p className="mt-2 text-sm"><strong>指定時刻的遮蔽：</strong>{report.shadeEvidence?.description ?? '待確認。舊版報告未記錄高度資料涵蓋率。'} {report.shadeEvidence?.coverage}</p>
        <p className="text-sm text-stone-600">{report.sunText}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="py-1">配置</th>
                <th>kWp</th>
                <th>年發電</th>
                <th>躉購收入</th>
                <th>自用效益</th>
                <th>租金</th>
                <th>回收</th>
              </tr>
            </thead>
            <tbody>
              {report.analysis.layouts.map((layout) => (
                <tr key={layout.id} className="border-b border-line">
                  <td className="py-1">{layout.name}</td>
                  <td>{layout.kwp == null ? '—' : formatKwp(layout.kwp)}</td>
                  <td>{layout.annualKwh == null ? '—' : formatKwh(layout.annualKwh)}</td>
                  <td>{layout.fullSaleTwd == null ? '—' : formatTwd(layout.fullSaleTwd)}</td>
                  <td>{layout.selfUseTwd == null ? '—' : formatTwd(layout.selfUseTwd)}</td>
                  <td>{layout.rentTwd == null ? '—' : formatTwd(layout.rentTwd)}</td>
                  <td>{formatYears(layout.fullPayback)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {inputs ? (
        <section className="rounded-lg border border-line bg-card p-4">
          <h2 className="font-bold">估算使用的資料與條件</h2>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['登記廠房面積', inputs.registeredArea == null ? '待核對登記圖說' : formatM2(inputs.registeredArea)],
              ['屋面材質', inputs.roofType],
              ['模組功率與尺寸', inputs.module ?? '待確認'],
              ['系統損失', inputs.systemLoss == null ? '未計入' : `${formatPercent(inputs.systemLoss)}${inputs.systemLossSource ? ` · ${inputs.systemLossSource}` : ''}`],
              ['自用比例', inputs.selfUse == null ? '待核對用電資料' : formatPercent(inputs.selfUse)],
              ['單位建置成本', inputs.capex == null ? '待取得報價' : `${formatTwd(inputs.capex)} / kWp${inputs.capexSource ? ` · ${inputs.capexSource}` : ''}`],
            ].map(([label, value]) => (
              <div key={label}><dt className="text-stone-600">{label}</dt><dd className="mt-0.5 font-bold">{value}</dd></div>
            ))}
          </dl>
        </section>
      ) : null}
      <section className="text-sm">
        <h2 className="font-bold">尚待補齊的估算資料</h2>
        <ul className="mt-1 list-disc pl-5">{report.notes.map((note) => <li key={note}>{note}</li>)}</ul>
        <p className="mt-2">結構檢查不取代技師簽證：{STRUCTURAL_CHECKLIST.join('、')}</p>
      </section>
      <section className="text-xs text-stone-600">
        {report.sources.map((source) => (
          <Source key={source.label} label={source.label} href={source.href} when={source.when} />
        ))}
      </section>
      <InstallationGuide />
    </article>
  )
}
