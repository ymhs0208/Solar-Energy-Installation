import type { DataProvenance, EvaluationCase, LayoutComparisonRow } from '../types/solar';

export function formatReportDate(value?: string | null) {
  const date = new Date(value ?? '');
  return Number.isNaN(date.getTime()) ? '日期未留存' : date.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour12: false,
  });
}

export function ReportSource({ source, missing = '來源未留存' }: {
  source?: DataProvenance | null;
  missing?: string;
}) {
  if (!source) return <span>{missing}</span>;
  const status = source.status === 'live' ? '公開資料' : '公開資料查詢未取得';
  return (
    <span>
      {status} · {source.sourceUrl && /^https?:\/\//i.test(source.sourceUrl)
        ? <a className="underline underline-offset-2" href={source.sourceUrl} target="_blank" rel="noreferrer">{source.sourceName}</a>
        : source.sourceName}
      {' · '}{formatReportDate(source.fetchedAt)}
    </span>
  );
}

const metrics: { key: keyof LayoutComparisonRow; label: string }[] = [
  { key: 'moduleCount', label: '模組片數（片）' },
  { key: 'annualGenKwh', label: '首年總發電量（kWh）' },
  { key: 'specificYieldKwhPerKwp', label: '單位容量年發電（kWh/kWp）' },
  { key: 'npv20Ntd', label: '20 年 NPV（新臺幣元）' },
];

function formatNumber(value: number | null) {
  return value === null ? '—' : Math.round(value).toLocaleString('zh-TW');
}

export function ReportLayoutComparison({ evidence }: { evidence: EvaluationCase['reportEvidence'] }) {
  const comparison = evidence?.layoutComparison;
  return (
    <section id="layout-comparison" className="scroll-mt-28 print-break-inside-avoid space-y-3">
      <h3 className="text-base font-bold text-slate-950">同一屋頂的排布方案比較</h3>
      {comparison ? (
        <>
          <p className="text-xs text-slate-600 leading-relaxed">
            兩案沿用相同屋頂、障礙區、退縮、容量上限與財務參數，只切換遮蔭剔除條件。
            高遮蔭方案剔除估計年遮蔭率達 {comparison.thresholdPct}% 的板位。兩案分別依保留板位的逐月遮蔭估算發電量。
            {comparison.financialScenario
              ? `NPV 均採${comparison.financialScenario === 'self' ? '自發自用' : '全額售電'}情境。`
              : '尚缺可用費率，暫無 NPV。'}
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs tabular-nums">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="p-2 text-left">指標</th>
                  <th scope="col" className="p-2 text-right">全排布</th>
                  <th scope="col" className="p-2 text-right">剔除高遮蔭板</th>
                  <th scope="col" className="p-2 text-right">剔除後變化</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {metrics.map(({ key, label }) => {
                  const full = comparison.full[key];
                  const filtered = comparison.filtered[key];
                  const delta = full === null || filtered === null ? null : filtered - full;
                  return (
                    <tr key={key}>
                      <th scope="row" className="p-2 text-left font-medium">{label}</th>
                      <td className="p-2 text-right">{formatNumber(full)}</td>
                      <td className="p-2 text-right">{formatNumber(filtered)}</td>
                      <td className="p-2 text-right">{delta !== null && Math.round(delta) > 0 ? '+' : ''}{formatNumber(delta)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs leading-relaxed text-slate-600">
            用總發電量比較每年供電，用每 kWp 發電量比較單位容量效率，再用 NPV 檢查少裝模組後的成本與收益。
            「—」表示資料不足或沒有可計算的單位容量。
          </p>
          <h4 className="text-xs font-bold text-slate-900">下一步確認</h4>
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-700">
            <li>現勘確認屋頂邊界、障礙物高度和實際陰影，核對排布與維修動線。</li>
            <li>用電費單及負載資料核對可自用比例與適用電價，取得兩種配置的 EPC 報價。</li>
            <li>向台電確認併網點及實際可用容量。</li>
          </ul>
        </>
      ) : (
        <p className="text-xs text-slate-600">這份報告尚無雙方案結果。請返回案場，確認屋頂已框選後重新產出報告。</p>
      )}
    </section>
  );
}
