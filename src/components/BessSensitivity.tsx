import type { FinancialScenarioResult } from '../types/solar';

export function BessSensitivity({ scenario }: { scenario: FinancialScenarioResult }) {
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
      <h3 className="font-bold text-slate-950">光儲敏感度試算</h3>
      <p className="leading-relaxed">
        以年度電量與設定值估算。假設每年運作 285 天、可用容量為額定容量的 85%，
        可移轉最多 25% 的直接自用光電，第 11 年翻修費為初始電池成本的 40%。
        要驗證削峰與套利收益，需比對案場逐時負載、光電出力及實際尖峰時段。
      </p>
      {scenario.sensitivity && (
        <div className="overflow-x-auto">
          <table className="w-full text-left tabular-nums">
            <thead>
              <tr className="border-y border-slate-200">
                <th scope="col" className="py-1.5 pr-2">情境</th>
                <th scope="col" className="pr-2">自用率</th>
                <th scope="col" className="pr-2">假設削峰</th>
                <th scope="col" className="pr-2">20 年 NPV（元）</th>
                <th scope="col">IRR</th>
              </tr>
            </thead>
            <tbody>
              {scenario.sensitivity.map((row, index) => (
                <tr key={index} className="border-b border-slate-200">
                  <th scope="row" className="py-1.5 pr-2 font-medium">
                    {['基準', '自用率變動', '無削峰收益'][index]}
                  </th>
                  <td className="pr-2">{row.selfConsumptionSharePct}%</td>
                  <td className="pr-2">{row.peakShavingKw} kW</td>
                  <td className="pr-2">{row.npv20Ntd === null ? '—' : Math.round(row.npv20Ntd).toLocaleString('zh-TW')}</td>
                  <td>{row.irrPct === null ? '—' : `${row.irrPct.toFixed(2)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
