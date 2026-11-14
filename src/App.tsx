import { lazy, Suspense, useCallback, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { loadActiveCase } from './lib/caseStorage';
const EpcPage = lazy(() => import('./pages/EpcPage').then((module) => ({ default: module.EpcPage })));
const EvaluationPage = lazy(() => import('./pages/EvaluationPage').then((module) => ({ default: module.EvaluationPage })));
const MethodologyPage = lazy(() => import('./pages/MethodologyPage').then((module) => ({ default: module.MethodologyPage })));
const ReportPage = lazy(() => import('./pages/ReportPage').then((module) => ({ default: module.ReportPage })));

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
          <Suspense fallback={<p role="status" className="p-6 text-sm text-slate-600">頁面載入中…</p>}>
            <Routes>
              <Route path="/" element={<EvaluationPage onCaseUpdated={handleCaseUpdated} />} />
              <Route path="/report" element={<ReportPage />} />
              <Route path="/epc" element={<EpcPage />} />
              <Route path="/methodology" element={<MethodologyPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </div>
    </BrowserRouter>
  );
}
