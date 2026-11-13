import type { ReactNode } from 'react'
import type { GateStatus } from '../lib/gates'

export function Source({ label, href, when }: { label: string; href?: string; when?: string | null }) {
  return (
    <p className="mt-1 text-xs leading-5 text-stone-600">
      來源：
      {href ? (
        <a className="underline decoration-stone-400" href={href} target="_blank" rel="noreferrer">
          {label}
        </a>
      ) : (
        label
      )}
      {when ? ` · ${when}` : ''}
    </p>
  )
}

export function Problem({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="shrink-0 font-bold underline" onClick={onRetry}>
          重試
        </button>
      ) : null}
    </div>
  )
}

const STATUS_TEXT: Record<GateStatus, string> = {
  pass: '通過',
  warn: '警示',
  fail: '未過',
  insufficient: '無法判定',
}

export function StatusPill({ status }: { status: GateStatus }) {
  const color =
    status === 'pass'
      ? 'bg-pine text-white'
      : status === 'warn'
        ? 'bg-amber-700 text-white'
        : status === 'fail'
          ? 'bg-fail text-white'
          : 'bg-stone-500 text-white'
  return <span className={`rounded px-2 py-0.5 text-xs font-bold ${color}`}>{STATUS_TEXT[status]}</span>
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-stone-600">{label}</span>
      {children}
    </label>
  )
}

export const control =
  'w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-copper'

export function Missing({ text }: { text: string }) {
  return <p className="text-sm font-medium text-fail">無法取得公開資料。{text}</p>
}
