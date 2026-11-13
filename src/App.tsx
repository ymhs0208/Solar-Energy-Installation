import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { EpcPage } from './pages/EpcPage'
import { ReportPage } from './pages/ReportPage'
import { ToolPage } from './pages/ToolPage'
import { SessionProvider } from './session'

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Shell>
          <Routes>
            <Route path="/" element={<ToolPage />} />
            <Route path="/report" element={<ReportPage />} />
            <Route path="/epc" element={<EpcPage />} />
          </Routes>
        </Shell>
      </BrowserRouter>
    </SessionProvider>
  )
}
