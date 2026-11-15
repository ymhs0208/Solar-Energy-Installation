import { useMemo, useState } from 'react';
import type { FinancialScenarioResult } from '../types/solar';

interface CashflowComparisonChartProps {
  fit: FinancialScenarioResult | null;
  self: FinancialScenarioResult | null;
  bess: FinancialScenarioResult | null;
}

export function CashflowComparisonChart({
  fit,
  self,
  bess,
}: CashflowComparisonChartProps) {
  const [hoverYear, setHoverYear] = useState<number | null>(null);

  const series = useMemo(() => {
    const items: Array<{
      id: 'fit' | 'self' | 'bess';
      label: string;
      color: string;
      points: Array<{ year: number; cumNtd: number }>;
    }> = [];

    const addSeries = (
      scen: FinancialScenarioResult | null,
      id: 'fit' | 'self' | 'bess',
      label: string,
      color: string,
    ) => {
      if (!scen || scen.cashflows.length === 0) return;
      items.push({
        id,
        label,
        color,
        points: [
          { year: 0, cumNtd: -scen.capexNtd },
          ...scen.cashflows.map((cf) => ({ year: cf.year, cumNtd: cf.cumulativeCashflowNtd })),
        ],
      });
    };

    addSeries(fit, 'fit', '全額售電 (FIT)', '#d97706');
    addSeries(self, 'self', '純光電自發自用', '#2563eb');
    addSeries(bess, 'bess', '光儲合一 (PV+BESS)', '#059669');
    return items;
  }, [fit, self, bess]);

  if (series.length === 0) {
    return null;
  }

  const width = 520;
  const height = 220;
  const padL = 56;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const allVals = series.flatMap((s) => s.points.map((p) => p.cumNtd));
  const rawMin = Math.min(0, ...allVals);
  const rawMax = Math.max(100000, ...allVals);
  const padRange = (rawMax - rawMin) * 0.08;
  const minVal = rawMin - padRange;
  const maxVal = rawMax + padRange;
  const span = Math.max(1, maxVal - minVal);

  const xForYear = (y: number) => padL + (y / 20) * plotW;
  const yForVal = (v: number) => padT + ((maxVal - v) / span) * plotH;
  const zeroY = yForVal(0);

  const formatWan = (ntd: number) => {
    const wan = ntd / 10000;
    return `${wan >= 0 ? '' : '-'}${Math.abs(wan).toFixed(0)}萬`;
  };

  const primarySeries = series[series.length - 1];
  const primaryAreaD = primarySeries
    ? [
        ...primarySeries.points.map(
          (pt, idx) =>
            `${idx === 0 ? 'M' : 'L'} ${xForYear(pt.year).toFixed(1)} ${yForVal(pt.cumNtd).toFixed(1)}`,
        ),
        `L ${xForYear(20).toFixed(1)} ${zeroY.toFixed(1)}`,
        `L ${xForYear(0).toFixed(1)} ${zeroY.toFixed(1)}`,
        'Z',
      ].join(' ')
    : '';

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-950">
          20 年累計淨現金流對比曲線 (萬元)
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
          {series.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span
                className="w-3 h-0.5 inline-block rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span>{s.label}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible select-none"
          onMouseLeave={() => setHoverYear(null)}
        >
          <defs>
            <linearGradient id="cashflowPrimaryArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={primarySeries?.color || '#059669'} stopOpacity="0.11" />
              <stop offset="100%" stopColor={primarySeries?.color || '#059669'} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Horizontal gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const val = minVal + (1 - t) * span;
            const y = padT + t * plotH;
            return (
              <g key={t}>
                <line
                  x1={padL}
                  y1={y}
                  x2={width - padR}
                  y2={y}
                  stroke="#f1f5f9"
                  strokeWidth={1}
                />
                <text
                  x={padL - 8}
                  y={y + 3}
                  textAnchor="end"
                  fontSize="10"
                  fill="#64748b"
                  className="font-mono tabular-nums"
                >
                  {formatWan(val)}
                </text>
              </g>
            );
          })}

          {/* Break-even zero line */}
          {zeroY >= padT && zeroY <= height - padB && (
            <g>
              <line
                x1={padL}
                y1={zeroY}
                x2={width - padR}
                y2={zeroY}
                stroke="#64748b"
                strokeWidth={1.1}
                strokeDasharray="4 3"
              />
              <text
                x={width - padR}
                y={zeroY - 4}
                textAnchor="end"
                fontSize="9"
                fill="#64748b"
                className="font-mono"
              >
                回本損益線 0
              </text>
            </g>
          )}

          {/* X-axis year ticks */}
          {[0, 5, 10, 15, 20].map((yr) => (
            <text
              key={yr}
              x={xForYear(yr)}
              y={height - 6}
              textAnchor="middle"
              fontSize="10"
              fill="#64748b"
              className="font-mono tabular-nums"
            >
              第{yr}年
            </text>
          ))}

          {/* Subtle area wash under primary curve */}
          {primaryAreaD && <path d={primaryAreaD} fill="url(#cashflowPrimaryArea)" />}

          {/* Curves */}
          {series.map((s) => {
            const d = s.points
              .map(
                (pt, idx) =>
                  `${idx === 0 ? 'M' : 'L'} ${xForYear(pt.year).toFixed(1)} ${yForVal(pt.cumNtd).toFixed(1)}`,
              )
              .join(' ');
            return (
              <path
                key={s.id}
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={s.id === primarySeries?.id ? 2.4 : 1.9}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}

          {/* Hover vertical guide & dots */}
          {hoverYear !== null && (
            <g>
              <line
                x1={xForYear(hoverYear)}
                y1={padT}
                x2={xForYear(hoverYear)}
                y2={height - padB}
                stroke="#94a3b8"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
              {series.map((s) => {
                const pt = s.points[hoverYear];
                if (!pt) return null;
                return (
                  <circle
                    key={s.id}
                    cx={xForYear(pt.year)}
                    cy={yForVal(pt.cumNtd)}
                    r={3.5}
                    fill={s.color}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                  />
                );
              })}
            </g>
          )}

          {/* Invisible column hit targets for smooth year scrubbing */}
          {Array.from({ length: 21 }, (_, yr) => {
            const colW = plotW / 20;
            return (
              <rect
                key={yr}
                x={xForYear(yr) - colW / 2}
                y={padT}
                width={colW}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoverYear(yr)}
              />
            );
          })}
        </svg>

        <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-700 min-h-[24px]">
          {hoverYear !== null ? (
            <>
              <span className="font-semibold text-slate-900">第 {hoverYear} 年累計淨現金流</span>
              <div className="flex flex-wrap gap-3">
                {series.map((s) => {
                  const pt = s.points[hoverYear];
                  if (!pt) return null;
                  return (
                    <span key={s.id} style={{ color: s.color }} className="font-semibold">
                      {s.label} {formatWan(pt.cumNtd)}
                    </span>
                  );
                })}
              </div>
            </>
          ) : (
            <span className="font-sans text-slate-400">
              將游標移至曲線上可檢視第 0–20 年各情境累計淨現金流
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
