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
  shadeEvidence?: { description: string; coverage: string }
  sunText: string
  layoutName: string
  registrationDate: string | null
  completionYear: number | null
  moduleName: string | null
  estimateLimits: string[]
  inputs?: {
    registeredArea: number | null
    roofType: string
    module: string | null
    systemLoss: number | null
    systemLossSource?: string
    selfUse: number | null
    capex: number | null
    capexSource?: string
  }
  sources: { label: string; href?: string; when?: string | null }[]
  notes: string[]
}

type SessionValue = {
  report: ReportSnapshot | null
  setReport: (report: ReportSnapshot | null) => void
  leads: Lead[]
  savedReports: Record<string, ReportSnapshot>
  addLead: (lead: Lead, report: ReportSnapshot) => boolean
  removeLead: (id: string) => boolean
}

const SessionContext = createContext<SessionValue | null>(null)
const storageKey = 'solarx.workspace.v1'
type Workspace = { leads: Lead[]; savedReports: Record<string, ReportSnapshot> }

function loadWorkspace(): Workspace {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (Array.isArray(stored?.leads) && stored.savedReports && typeof stored.savedReports === 'object') return stored
  } catch {
    // A blocked browser store still allows an in-memory workspace.
  }
  return { leads: [], savedReports: {} }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [report, setReport] = useState<ReportSnapshot | null>(null)
  const [workspace, setWorkspace] = useState(loadWorkspace)
  const value = useMemo<SessionValue>(
    () => {
      function save(next: Workspace) {
        setWorkspace(next)
        try {
          localStorage.setItem(storageKey, JSON.stringify(next))
          return true
        } catch {
          return false
        }
      }
      return {
        report,
        setReport,
        ...workspace,
        addLead: (lead, snapshot) => save({
          leads: [lead, ...workspace.leads.filter((item) => item.id !== lead.id)],
          savedReports: { ...workspace.savedReports, [lead.id]: snapshot },
        }),
        removeLead: (id) => {
          const savedReports = { ...workspace.savedReports }
          delete savedReports[id]
          return save({ leads: workspace.leads.filter((lead) => lead.id !== id), savedReports })
        },
      }
    },
    [report, workspace],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('SessionProvider 不在樹上')
  return value
}
