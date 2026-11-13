import { BrowserRouter, Route, Routes, useMatch } from 'react-router-dom'
import { Shell } from './components/Shell'
import { EpcPage } from './pages/EpcPage'
import { ReportPage } from './pages/ReportPage'
import { ToolPage } from './pages/ToolPage'
import { SessionProvider } from './session'

function Workspace() {
  const isToolOpen = useMatch('/') != null

  return (
    <Shell>
      <div hidden={!isToolOpen}><ToolPage active={isToolOpen} /></div>
      <Routes>
        <Route path="/" element={null} />
        <Route path="/report" element={<ReportPage />} />
        <Route path="/epc" element={<EpcPage />} />
      </Routes>
    </Shell>
  )
}

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Workspace />
      </BrowserRouter>
    </SessionProvider>
  )
}
