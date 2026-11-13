import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { StatusPill } from '../components/Bits'
import { formatKwh, formatKwp, formatM2, formatTwd } from '../lib/format'
import { useSession } from '../session'

export function EpcPage() {
  const { leads } = useSession()
  const [district, setDistrict] = useState('全部')
  const [gate, setGate] = useState<'全部' | '合格' | '有警示' | '未過'>('全部')
  const [minKwp, setMinKwp] = useState('')
  const shown = useMemo(() => {
    const minimum = Number(minKwp)
    return leads.filter((lead) => {
      if (district !== '全部' && lead.district !== district) return false
      if (Number.isFinite(minimum) && minKwp !== '' && (lead.kwp ?? 0) < minimum) return false
      if (gate === '合格' && !lead.qualified) return false
      if (gate === '有警示' && !lead.conditional) return false
      if (gate === '未過' && lead.qualified) return false
      return true
    })
  }, [leads, district, gate, minKwp])

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">案源</h1>
        <p className="text-sm text-stone-600">這裡只列出這次工作階段從快篩放進來的地址。報價沒有公開行情，空白就是沒填。沒有金流。</p>
      </header>
      <div className="flex flex-wrap gap-2 text-sm">
        <select className="rounded border border-line bg-white px-2 py-1" value={district} onChange={(event) => setDistrict(event.target.value)}>
          {['全部', '桃園觀音', '台中大里', '其他'].map((item) => <option key={item}>{item}</option>)}
        </select>
        <select className="rounded border border-line bg-white px-2 py-1" value={gate} onChange={(event) => setGate(event.target.value as typeof gate)}>
          {['全部', '合格', '有警示', '未過'].map((item) => <option key={item}>{item}</option>)}
        </select>
        <input className="w-32 rounded border border-line px-2 py-1" placeholder="最小 kWp" value={minKwp} onChange={(event) => setMinKwp(event.target.value)} />
      </div>
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
              <p className="text-xs text-stone-500">{lead.qualified ? '合格' : '未列合格'} · {lead.createdAt}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
