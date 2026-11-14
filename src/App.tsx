import { useCallback, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { loadActiveCase } from './lib/caseStorage';
import { EpcPage } from './pages/EpcPage';
import { EvaluationPage } from './pages/EvaluationPage';
import { MethodologyPage } from './pages/MethodologyPage';
import { ReportPage } from './pages/ReportPage';

export default function App() {
  const [hasActiveCase, setHasActiveCase] = useState<boolean>(() => loadActiveCase() !== null);

  const handleCaseUpdated = useCallback(() => {
    setHasActiveCase(true);
  }, []);

  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col app-shell">
        <TopBar hasActiveCase={hasActiveCase} />
        <div className="flex-1">
          <Routes>
            <Route path="/" element={<EvaluationPage onCaseUpdated={handleCaseUpdated} />} />
            <Route path="/report" element={<ReportPage />} />
            <Route path="/epc" element={<EpcPage />} />
            <Route path="/methodology" element={<MethodologyPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}
