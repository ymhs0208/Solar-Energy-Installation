import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { StatusPill } from '../components/Bits'
import { formatKwh, formatKwp, formatM2, formatTwd } from '../lib/format'
import { useSession } from '../session'

function csvCell(value: string | number | null) {
  const raw = String(value ?? '')
  const safe = typeof value === 'string' && /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(raw) ? "'" + raw : raw
  return '"' + safe.replaceAll('"', '""') + '"'
}

export function EpcPage() {
  const { leads, removeLead } = useSession()
  const [query, setQuery] = useState('')
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [district, setDistrict] = useState('全部')
  const [gate, setGate] = useState<'全部' | '合格' | '有警示' | '未過'>('全部')
  const [minKwp, setMinKwp] = useState('')
  const shown = useMemo(() => {
    const minimum = Number(minKwp)
    return leads.filter((lead) => {
      if (!`${lead.name} ${lead.address}`.toLowerCase().includes(query.trim().toLowerCase())) return false
      if (district !== '全部' && lead.district !== district) return false
      if (Number.isFinite(minimum) && minKwp !== '' && (lead.kwp ?? 0) < minimum) return false
      if (gate === '合格' && !lead.qualified) return false
      if (gate === '有警示' && !lead.conditional) return false
      if (gate === '未過' && lead.qualified) return false
      return true
    })
  }, [leads, query, district, gate, minKwp])

  function exportCases() {
    const rows = [
      ['案場', '地址', '區域', '面積（m²）', '容量（kWp）', '年發電（kWh）', '饋線', '報價（元）', '儲存時間'],
      ...shown.map((lead) => [lead.name, lead.address, lead.district, lead.areaM2, lead.kwp, lead.annualKwh, lead.feeder, lead.priceTwd, lead.createdAt]),
    ]
    const url = URL.createObjectURL(new Blob(['\uFEFF', rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'SolarX-案場清單.csv'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">案場工作台</h1>
          <p className="mt-1 text-sm text-stone-600">已儲存 {leads.length} 筆案場。資料保存在目前瀏覽器。</p>
        </div>
        <Link to="/" className="rounded-md bg-pine px-4 py-2 text-sm font-bold text-white">前往快篩</Link>
      </header>
      <div className="flex flex-wrap gap-2 text-sm">
        <input aria-label="搜尋案場" className="min-w-0 rounded border border-line bg-white px-2 py-1" placeholder="搜尋廠名或地址" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="區域" className="rounded border border-line bg-white px-2 py-1" value={district} onChange={(event) => setDistrict(event.target.value)}>
          {[...new Set(['全部', ...leads.map((lead) => lead.district), district])].map((item) => <option key={item}>{item}</option>)}
        </select>
        <select aria-label="初查狀態" className="rounded border border-line bg-white px-2 py-1" value={gate} onChange={(event) => setGate(event.target.value as typeof gate)}>
          {['全部', '合格', '有警示', '未過'].map((item) => <option key={item}>{item}</option>)}
        </select>
        <input aria-label="最小容量（kWp）" inputMode="decimal" className="w-32 rounded border border-line px-2 py-1" placeholder="最小 kWp" value={minKwp} onChange={(event) => setMinKwp(event.target.value)} />
        <button type="button" className="rounded border border-line bg-white px-3 py-2 font-bold disabled:opacity-50" disabled={!shown.length} onClick={exportCases}>匯出目前清單 CSV</button>
      </div>
      {message ? <p role="status" className="text-sm">{message}</p> : null}
      {leads.length === 0 ? (
        <p className="text-sm">還沒有案源。<Link className="underline" to="/">去做一筆快篩</Link></p>
      ) : shown.length === 0 ? (
        <p className="text-sm">這個篩選沒有結果。</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {shown.map((lead) => (
            <li key={lead.id + lead.createdAt} className="rounded-lg border border-line bg-card p-4">
              <p className="font-bold">{lead.name}</p>
              <p className="text-sm text-stone-600">{lead.address} · {lead.district}</p>
              <p className="mt-2 text-sm">{formatM2(lead.areaM2)} · {lead.kwp == null ? '無容量' : formatKwp(lead.kwp)} · {lead.annualKwh == null ? '無發電量' : formatKwh(lead.annualKwh)}</p>
              <p className="text-sm">饋線 {lead.feeder ?? '無'} · 容量 {lead.capacityKw ?? '無'} 瓩</p>
              <div className="mt-2 flex gap-1">
                <StatusPill status={lead.gates.grid} />
                <StatusPill status={lead.gates.legal} />
                <StatusPill status={lead.gates.structural} />
              </div>
              <p className="mt-2 text-lg font-bold">{lead.priceTwd == null ? '未填報價' : formatTwd(lead.priceTwd)}</p>
              <p className="text-xs text-stone-500">{new Date(lead.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</p>
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                <Link to={`/report?${new URLSearchParams({ 案場: lead.id })}`} className="font-bold text-pine underline">開啟報告</Link>
                {pendingDelete === lead.id ? (
                  <>
                    <button type="button" className="font-bold text-fail" onClick={() => { setMessage(removeLead(lead.id) ? '案場已刪除。' : '已從本次清單移除，瀏覽器儲存空間目前無法寫入。'); setPendingDelete(null) }}>確認刪除</button>
                    <button type="button" onClick={() => setPendingDelete(null)}>取消</button>
                  </>
                ) : <button type="button" className="text-stone-600" onClick={() => setPendingDelete(lead.id)}>刪除案場</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
