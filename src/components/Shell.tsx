import { NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'

const link = 'rounded px-3 py-1.5 text-sm'
const idle = `${link} text-stone-700 hover:bg-white`
const active = `${link} bg-ink text-paper`

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <NavLink to="/" className="leading-tight">
            <span className="block text-lg font-bold tracking-tight">SolarX AI</span>
            <span className="block text-xs text-stone-600">工廠屋頂太陽能快篩</span>
          </NavLink>
          <nav aria-label="主導覽" className="flex gap-1">
            <NavLink to="/" end className={({ isActive }) => (isActive ? active : idle)}>
              快篩
            </NavLink>
            <NavLink to="/report" className={({ isActive }) => (isActive ? active : idle)}>
              報告
            </NavLink>
            <NavLink to="/epc" className={({ isActive }) => (isActive ? active : idle)}>
              案場
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  )
}
