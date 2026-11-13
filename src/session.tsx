import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Analysis } from './lib/analyze'
import type { Lead } from './lib/types'

export type ReportSnapshot = {
  name: string
  address: string
  label: string
  lat: number
  lng: number
  analysis: Analysis
  shadeNow: number | null
  sunText: string
  layoutName: string
  sources: { label: string; href?: string; when?: string | null }[]
  notes: string[]
}

type SessionValue = {
  report: ReportSnapshot | null
  setReport: (report: ReportSnapshot | null) => void
  leads: Lead[]
  addLead: (lead: Lead) => void
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [report, setReport] = useState<ReportSnapshot | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const value = useMemo<SessionValue>(
    () => ({
      report,
      setReport,
      leads,
      addLead: (lead) => setLeads((list) => [lead, ...list.filter((item) => item.id !== lead.id)]),
    }),
    [report, leads],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('SessionProvider 不在樹上')
  return value
}
