import { AlertTriangle, CheckCircle2, Clock, ArrowRight, XCircle } from 'lucide-react';
import type { GateStatus, InstallVerdict, InstallVerdictLevel } from '../types/solar';

interface InstallVerdictCardProps {
  verdict: InstallVerdict;
  onJumpToMissing?: () => void;
  onJumpToParams?: () => void;
  compact?: boolean;
}

function verdictVisuals(level: InstallVerdictLevel) {
  switch (level) {
    case 'recommended':
      return {
        icon: CheckCircle2,
        tag: '建議安裝',
        dotCls: 'bg-emerald-600',
        textCls: 'text-emerald-700',
        topRuleCls: 'border-t-2 border-t-emerald-600',
      };
    case 'conditional':
      return {
        icon: AlertTriangle,
        tag: '調整後建議安裝',
        dotCls: 'bg-amber-600',
        textCls: 'text-amber-700',
        topRuleCls: 'border-t-2 border-t-amber-600',
      };
    case 'not_recommended':
      return {
        icon: XCircle,
        tag: '暫不建議直接自建',
        dotCls: 'bg-red-600',
        textCls: 'text-red-700',
        topRuleCls: 'border-t-2 border-t-red-600',
      };
    case 'incomplete':
    default:
      return {
        icon: Clock,
        tag: '待補齊判斷條件',
        dotCls: 'bg-slate-400',
        textCls: 'text-slate-700',
        topRuleCls: 'border-t-2 border-t-slate-400',
      };
  }
}

function reasonDotCls(status: GateStatus) {
  if (status === 'pass') return 'bg-emerald-600';
  if (status === 'warn') return 'bg-amber-600';
  if (status === 'fail') return 'bg-red-600';
  return 'bg-slate-400';
}

function reasonStatusLabel(status: GateStatus) {
  if (status === 'pass') return { text: '利多 / 通過', cls: 'text-emerald-700' };
  if (status === 'warn') return { text: '須調整 / 留意', cls: 'text-amber-700' };
  if (status === 'fail') return { text: '主要阻礙', cls: 'text-red-700' };
  return { text: '待補資料', cls: 'text-slate-500' };
}

export function InstallVerdictStrip({
  verdict,
  onInspectDetails,
}: {
  verdict: InstallVerdict;
  onInspectDetails: () => void;
}) {
  const vis = verdictVisuals(verdict.level);
  const Icon = vis.icon;

  return (
    <div className="px-5 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
      <div className="min-w-0 flex items-center gap-2">
        <Icon className={`w-4 h-4 shrink-0 ${vis.textCls}`} />
        <div className="min-w-0 text-xs truncate">
          <span className={`font-bold ${vis.textCls}`}>{vis.tag}</span>
          <span className="mx-1.5 text-slate-300" aria-hidden="true">
            ·
          </span>
          <span className="text-slate-700 font-medium">{verdict.headline}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onInspectDetails}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-800 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
      >
        <span>原因與建議</span>
        <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  );
}

export function InstallVerdictCard({
  verdict,
  onJumpToMissing,
  onJumpToParams,
  compact = false,
}: InstallVerdictCardProps) {
  const vis = verdictVisuals(verdict.level);
  const Icon = vis.icon;

  return (
    <section
      aria-label="綜合評估結論與原因"
      className={`border border-slate-200 ${vis.topRuleCls} rounded-xl bg-white overflow-hidden`}
    >
      {/* Executive Headline */}
      <div className={compact ? 'p-4 space-y-2' : 'p-5 space-y-2.5'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2">
            <Icon className={`w-4 h-4 shrink-0 ${vis.textCls}`} />
            <span className={`text-xs font-bold ${vis.textCls}`}>
              綜合判斷 · {vis.tag}
            </span>
          </div>
          <span className="text-[11px] font-medium text-slate-600">
            {verdict.recommendedModeLabel}
          </span>
        </div>

        <h3 className="text-base font-bold text-slate-950 tracking-tight">
          {verdict.headline}
        </h3>
        <p className="text-xs text-slate-600 leading-relaxed">{verdict.summary}</p>

        {/* Quick missing checklist jump if incomplete */}
        {verdict.missingChecklist.length > 0 && (onJumpToMissing || onJumpToParams) && (
          <div className="pt-1.5 flex flex-wrap items-center gap-3 text-[11px]">
            {onJumpToMissing && (
              <button
                type="button"
                onClick={onJumpToMissing}
                className="font-semibold text-amber-700 hover:underline cursor-pointer"
              >
                前往補齊場址／屋頂欄位 →
              </button>
            )}
            {onJumpToParams && (
              <button
                type="button"
                onClick={onJumpToParams}
                className="font-semibold text-slate-700 hover:text-amber-700 hover:underline cursor-pointer"
              >
                設定費率與時間電價 →
              </button>
            )}
          </div>
        )}
      </div>

      {/* Quantified 4-Dimension Reason Breakdown */}
      <div className="border-t border-slate-200 divide-y divide-slate-100">
        {verdict.reasons.map((r) => {
          const st = reasonStatusLabel(r.status);
          return (
            <div
              key={r.dimension}
              className={`${compact ? 'px-4 py-2.5' : 'px-5 py-3'} flex items-start gap-2.5 text-xs`}
            >
              <span
                className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${reasonDotCls(r.status)}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-950">{r.label}</span>
                  <span className={`text-[11px] font-semibold ${st.cls}`}>{st.text}</span>
                </div>
                <p className="text-slate-600 mt-0.5 leading-relaxed">{r.detail}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Actionable Next Steps (if any) */}
      {verdict.topActions.length > 0 && (
        <div className={`${compact ? 'px-4 py-3' : 'px-5 py-3.5'} bg-[#F8FAFC] border-t border-slate-200 space-y-1`}>
          <div className="text-[11px] font-semibold text-slate-900">優先處理建議</div>
          <ul className="text-xs text-slate-700 space-y-1">
            {verdict.topActions.map((act, i) => (
              <li key={i} className="flex items-start gap-1.5 leading-relaxed">
                <span className="font-mono text-[11px] text-amber-700 font-bold shrink-0">
                  {i + 1}.
                </span>
                <span>{act}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
