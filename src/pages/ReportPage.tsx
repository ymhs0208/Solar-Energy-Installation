import { Link } from 'react-router-dom'
import { Source, StatusPill } from '../components/Bits'
import { formatKwh, formatKwp, formatM2, formatPercent, formatTwd, formatYears } from '../lib/format'
import { STRUCTURAL_CHECKLIST } from '../lib/gates'
import { useSession } from '../session'

export function ReportPage() {
  const { report } = useSession()
  if (!report) {
    return (
      <p className="text-sm">
        這次工作階段還沒有報告。<Link className="underline" to="/">回快篩</Link>
      </p>
    )
  }
  const chosen = report.analysis.layouts.find((item) => item.name === report.layoutName) ?? report.analysis.layouts[0]
  return (
    <article className="space-y-5 rounded-lg border border-line bg-white p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs tracking-wide text-stone-500">SolarX AI 快篩報告</p>
          <h1 className="text-2xl font-bold">{report.name}</h1>
          <p className="text-sm">{report.address}</p>
          <p className="text-sm text-stone-600">{report.label}</p>
          <p className="text-sm text-stone-600">{report.lat.toFixed(6)}, {report.lng.toFixed(6)}</p>
        </div>
        <button type="button" className="no-print rounded border border-ink px-3 py-1 text-sm" onClick={() => window.print()}>
          列印
        </button>
      </header>
      <section className="grid gap-3 md:grid-cols-3">
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
        <h2 className="font-bold">目前選用的配置：{report.layoutName}</h2>
        {chosen ? (
          <p className="mt-1 text-sm">
            面積 {formatM2(report.analysis.areaM2)} · {chosen.kwp == null ? '無裝置容量' : formatKwp(chosen.kwp)} · {chosen.annualKwh == null ? '無發電量' : `年發電 ${formatKwh(chosen.annualKwh)}`} · 此刻遮蔽 {report.shadeNow == null ? '無法計算' : formatPercent(report.shadeNow)}
          </p>
        ) : null}
        <p className="text-sm text-stone-600">{report.sunText}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
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
      <section className="text-sm">
        <h2 className="font-bold">還沒有的公開資料</h2>
        <ul className="mt-1 list-disc pl-5">{report.notes.map((note) => <li key={note}>{note}</li>)}</ul>
        <p className="mt-2">結構檢查不取代技師簽證：{STRUCTURAL_CHECKLIST.join('、')}</p>
      </section>
      <section>
        <h2 className="font-bold">案源</h2>
        <p className="text-sm">{report.analysis.qualification.qualified ? '三關都可判定，且沒有未過。' : `尚未列為合格：${report.analysis.qualification.blocked.join('；')}`}</p>
      </section>
      <section className="text-xs text-stone-600">
        {report.sources.map((source) => (
          <Source key={source.label} label={source.label} href={source.href} when={source.when} />
        ))}
      </section>
    </article>
  )
}
