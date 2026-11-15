import { useState } from 'react';
import type { MonthlySimulationRow } from '../types/solar';

const whole = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat('zh-TW', { style: 'percent', maximumFractionDigits: 1 });

export function MonthlyPerformanceChart({ rows }: { rows: MonthlySimulationRow[] }) {
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  if (rows.length === 0) return null;

  const peak = rows.reduce((best, row) => row.genKwh > best.genKwh ? row : best);
  const selected = rows.find((row) => row.month === selectedMonth) ?? peak;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(1, peak.genKwh))));
  const maxGeneration = Math.ceil(Math.max(1, peak.genKwh) / magnitude) * magnitude;
  const charts = [
    { label: '預估發電量（kWh）', max: maxGeneration, value: (row: MonthlySimulationRow) => row.genKwh, format: whole.format, color: '#267157' },
    { label: '遮蔭損失率', max: 1, value: (row: MonthlySimulationRow) => row.shadingLossRatio, format: percent.format, color: '#ad5814' },
  ];

  return (
    <figure className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      <figcaption className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-700" aria-live="polite">
        <strong>{selected.month} 月</strong>
        <span>預估發電 {whole.format(selected.genKwh)} kWh</span>
        <span>遮蔭損失 {percent.format(selected.shadingLossRatio)}</span>
      </figcaption>
      {charts.map(({ label, max, value, format, color }) => (
        <div key={label} role="group" aria-label={label} className="space-y-1">
          <p className="text-xs font-semibold text-slate-800">{label}</p>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
            <div className="flex h-20 flex-col justify-between text-[10px] tabular-nums text-slate-600" aria-hidden="true">
              <span>{format(max)}</span><span>{format(max / 2)}</span><span>{format(0)}</span>
            </div>
            <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
              {rows.map((row) => {
                const active = row.month === selected.month;
                return (
                  <button
                    key={row.month}
                    type="button"
                    className="group min-w-0 cursor-pointer text-[10px] text-slate-600"
                    aria-label={`${row.month} 月，${label} ${format(value(row))}`}
                    aria-pressed={active}
                    onClick={() => setSelectedMonth(row.month)}
                  >
                    <span className="relative flex h-20 items-end justify-center rounded-t border-b border-slate-300 group-hover:bg-slate-100">
                      <span aria-hidden="true" className="absolute inset-x-0 top-1/2 border-t border-slate-100" />
                      <span aria-hidden="true" className="z-10 w-3/4 rounded-t-sm" style={{
                        height: `${100 * value(row) / max}%`, backgroundColor: color, opacity: active ? 1 : 0.65,
                        printColorAdjust: 'exact',
                      }} />
                    </span>
                    <span className={active ? 'font-bold text-slate-950' : ''}>{row.month}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </figure>
  );
}
