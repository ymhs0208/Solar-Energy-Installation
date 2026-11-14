import { useState } from 'react';
import { ExternalLink, Info, X } from 'lucide-react';
import type { DataProvenance } from '../types/solar';

interface SourceTagProps {
  provenance: DataProvenance | null | undefined;
  shortLabel?: string;
}

const STATUS_TEXT: Record<string, string> = {
  live: '即時公開資料',
  no_data: '查無公開資料',
  error: '資料源異常',
  user_input: '使用者手動輸入',
  pending: '尚未擷取',
};

const STATUS_COLOR: Record<string, string> = {
  live: 'text-emerald-700',
  no_data: 'text-amber-700',
  error: 'text-red-700',
  user_input: 'text-slate-700',
  pending: 'text-slate-500',
};

export function SourceTag({ provenance, shortLabel }: SourceTagProps) {
  const [open, setOpen] = useState(false);

  if (!provenance) {
    return (
      <span className="text-[11px] font-mono text-slate-400 whitespace-nowrap shrink-0">
        {shortLabel || '待查詢'}
      </span>
    );
  }

  const formattedTime = provenance.fetchedAt
    ? new Date(provenance.fetchedAt).toLocaleString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    : '—';

  const statusTone =
    provenance.status === 'live'
      ? 'text-emerald-700 hover:text-emerald-800'
      : provenance.status === 'error'
      ? 'text-red-700 hover:text-red-800'
      : provenance.status === 'no_data'
      ? 'text-amber-700 hover:text-amber-800'
      : 'text-slate-500 hover:text-amber-700';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 text-[11px] font-mono ${statusTone} underline decoration-dotted underline-offset-2 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-600 transition-colors`}
        title="點擊檢視資料來源與擷取時間"
      >
        <Info className="w-3 h-3 shrink-0" />
        <span>{shortLabel || provenance.sourceName}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/45 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-5 shadow-xl text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3.5">
              <div>
                <div className="text-[11px] font-mono text-slate-500">資料來源追溯紀錄</div>
                <h4 className="text-base font-semibold text-slate-950 mt-0.5">{provenance.label}</h4>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-md cursor-pointer transition-colors"
                aria-label="關閉來源視窗"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <dl className="mt-3 divide-y divide-slate-100 text-sm">
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-slate-500 shrink-0">資料狀態</dt>
                <dd className={`font-semibold ${STATUS_COLOR[provenance.status] || 'text-slate-700'}`}>
                  {STATUS_TEXT[provenance.status] || provenance.status}
                </dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-slate-500 shrink-0">公開來源機構</dt>
                <dd className="text-slate-950 text-right font-medium">{provenance.sourceName}</dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-slate-500 shrink-0">取得時間</dt>
                <dd className="font-mono tabular-nums text-slate-800 text-xs">{formattedTime}</dd>
              </div>
              <div className="py-2.5">
                <dt className="text-slate-500 mb-1">來源網址</dt>
                <dd className="text-xs font-mono break-all text-slate-700">
                  {provenance.sourceUrl ? (
                    <a
                      href={provenance.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-amber-700 hover:underline"
                    >
                      <span>{provenance.sourceUrl}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ) : (
                    '無外部網址（使用者手動輸入）'
                  )}
                </dd>
              </div>
              <div className="py-2.5">
                <dt className="text-slate-500 mb-1">擷取摘要</dt>
                <dd className="text-slate-800 leading-relaxed">{provenance.summary}</dd>
              </div>
              {provenance.errorDetail && (
                <div className="py-2.5">
                  <dt className="text-red-700 mb-1 font-medium">錯誤明細</dt>
                  <dd className="text-xs font-mono text-red-700">
                    {provenance.errorDetail}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      )}
    </>
  );
}
