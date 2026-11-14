import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Download,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  addQuoteToCase,
  loadActiveCase,
  loadEpcPool,
  removeCaseFromEpcPool,
  upsertCaseToEpcPool,
} from '../lib/caseStorage';
import { computeFinancialScenario } from '../lib/solarEngine';
import type { EvaluationCase } from '../types/solar';

export function EpcPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [pool, setPool] = useState<EvaluationCase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'pass' | 'review'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeEvalAvailable, setActiveEvalAvailable] = useState<EvaluationCase | null>(null);

  // EPC Quote submission form
  const [epcCompany, setEpcCompany] = useState('');
  const [contactName, setContactName] = useState('');
  const [quotedCapexPerKw, setQuotedCapexPerKw] = useState(41000);
  const [moduleSpec, setModuleSpec] = useState('N-Type TOPCon 450Wp 雙玻');
  const [inverterSpec, setInverterSpec] = useState('三相組串型逆變器 50/100kW');
  const [warrantyYears, setWarrantyYears] = useState(10);
  const [estimatedWeeks, setEstimatedWeeks] = useState(14);
  const [quoteNotes, setQuoteNotes] = useState('');

  useEffect(() => {
    const loaded = loadEpcPool();
    setPool(loaded);
    if (loaded.length > 0) setSelectedId(loaded[0].id);
    setActiveEvalAvailable(loadActiveCase());
  }, []);

  const filteredPool = useMemo(() => {
    return pool.filter((c) => {
      if (filterMode === 'pass' && !c.result.overallPass) return false;
      if (filterMode === 'review' && c.result.overallPass) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const hay = `${c.params.factoryName} ${c.params.address} ${c.district?.ctyName ?? ''} ${c.district?.townName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [pool, filterMode, searchTerm]);

  const selectedCase = useMemo(
    () => filteredPool.find((c) => c.id === selectedId) ?? filteredPool[0] ?? null,
    [filteredPool, selectedId],
  );

  const handleImportActiveCase = () => {
    if (!activeEvalAvailable) return;
    const next = upsertCaseToEpcPool(activeEvalAvailable);
    setPool(next);
    setSelectedId(activeEvalAvailable.id);
  };

  const handleImportJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const txt = await file.text();
      const parsed = JSON.parse(txt) as EvaluationCase;
      if (parsed && parsed.id && parsed.result && parsed.params) {
        const next = upsertCaseToEpcPool(parsed);
        setPool(next);
        setSelectedId(parsed.id);
      }
    } catch {
      // ignore malformed JSON
    }
    e.target.value = '';
  };

  const handleQuoteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase || !epcCompany.trim()) return;
    const next = addQuoteToCase(selectedCase.id, {
      epcCompany: epcCompany.trim(),
      contactName: contactName.trim(),
      quotedCapexPerKw,
      moduleSpec,
      inverterSpec,
      warrantyYears,
      estimatedWeeks,
      notes: quoteNotes.trim(),
    });
    setPool(next);
    setEpcCompany('');
    setContactName('');
    setQuoteNotes('');
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header & Controls */}
      <div className="page-banner flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">
            EPC 標準化案件媒合與報價比較
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            將已通過三道關卡初步篩選的工廠屋頂規格公開給 EPC 廠商，以同一套發電量與實測資料進行透明報價比較。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {activeEvalAvailable && (
            <button
              type="button"
              onClick={handleImportActiveCase}
              className="h-9 inline-flex items-center gap-1.5 px-3.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md cursor-pointer whitespace-nowrap transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>加入目前評估案場</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            onChange={handleImportJsonFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-9 inline-flex items-center gap-1.5 px-3.5 text-xs font-semibold border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 rounded-md cursor-pointer whitespace-nowrap transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>匯入案件規格 JSON</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200">
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className={`pb-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              filterMode === 'all'
                ? 'border-amber-600 text-slate-950'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            全部案場 ({pool.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('pass')}
            className={`pb-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              filterMode === 'pass'
                ? 'border-amber-600 text-slate-950'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            三關全數通過
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('review')}
            className={`pb-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              filterMode === 'review'
                ? 'border-amber-600 text-slate-950'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            含須評估/補件項目
          </button>
        </div>

        <div className="relative w-full sm:w-72 pb-2">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-[10px] pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜尋廠名、縣市或地址..."
            className="w-full h-9 pl-9 pr-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/15"
          />
        </div>
      </div>

      {/* Empty State */}
      {filteredPool.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
          <h2 className="text-lg font-semibold text-slate-950">目前媒合池尚無案場規格</h2>
          <p className="text-sm text-slate-600 max-w-lg mx-auto leading-relaxed">
            媒合池僅接收實際經過系統評估並送出的工廠案件（不預填示範假案場）。您可以從「案場評估」送出剛評估完的工廠，或匯入業主提供的標準化 JSON 規格檔。
          </p>
          <div className="pt-2 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="px-5 py-2.5 text-sm font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md cursor-pointer transition-colors"
            >
              前往評估第一個工廠案場
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-start">
          {/* Left Queue */}
          <div className="border border-slate-200 rounded-xl bg-white divide-y divide-slate-200 overflow-hidden">
            {filteredPool.map((item) => {
              const active = selectedCase?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full text-left p-4 transition-colors cursor-pointer ${
                    active ? 'bg-amber-50/45' : 'hover:bg-[#F8FAFC]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className={`font-semibold text-sm flex items-center gap-2 ${active ? 'text-slate-950' : 'text-slate-900'}`}>
                      {active && <span className="w-1.5 h-1.5 rounded-full bg-amber-600 shrink-0" />}
                      <span>{item.params.factoryName || '未命名工廠案場'}</span>
                    </div>
                    <span className="text-xs font-mono tabular-nums font-bold text-amber-700 shrink-0">
                      {item.result.capacity.pDcKw.toFixed(1)} kWp
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 mt-1 truncate">
                    {item.district?.ctyName}
                    {item.district?.townName} · {item.params.address || '座標定位'}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
                    <span>
                      {item.params.roofType === 'metal'
                        ? '鐵皮屋頂'
                        : item.params.roofType === 'rc'
                        ? 'RC 屋頂'
                        : '未填材質'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {item.result.overallPass
                        ? '三關全過'
                        : item.result.hasBlocker
                        ? '有阻擋項'
                        : '待評估'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{item.quotes?.length || 0} 份報價</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right Standardized Case Spec & Quote Comparison */}
          {selectedCase && (
            <div className="space-y-6">
              <section className="surface p-4 sm:p-6 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
                  <div>
                    <div className="text-xs font-mono text-slate-500">
                      案號 {selectedCase.id} · 送出時間{' '}
                      {new Date(selectedCase.updatedAt).toLocaleString('zh-TW', { hour12: false })}
                    </div>
                    <h2 className="text-xl font-bold tracking-tight text-slate-950 mt-1">
                      {selectedCase.params.factoryName || '未命名工廠案場'}
                    </h2>
                    <p className="text-sm text-slate-600 mt-0.5">
                      {selectedCase.params.address}（{selectedCase.lat.toFixed(5)},{' '}
                      {selectedCase.lon.toFixed(5)}）
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const blob = new Blob([JSON.stringify(selectedCase, null, 2)], {
                          type: 'application/json',
                        });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `epc-spec-${selectedCase.id}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="h-8 inline-flex items-center gap-1.5 px-3 text-xs font-medium border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer whitespace-nowrap transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>下載規格</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = removeCaseFromEpcPool(selectedCase.id);
                        setPool(next);
                        setSelectedId(next[0]?.id ?? null);
                      }}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md cursor-pointer transition-colors"
                      title="移除此案場"
                      aria-label="移除此案場"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Standardized Technical Specs */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:divide-x sm:divide-slate-200 text-xs">
                  <div className="sm:pr-3">
                    <div className="text-slate-500">可裝容量 / 預估發電</div>
                    <div className="font-mono tabular-nums font-bold text-slate-950 text-sm mt-1">
                      {selectedCase.result.capacity.pDcKw.toFixed(1)} kWp ·{' '}
                      {Math.round(selectedCase.result.annualGenKwh).toLocaleString('zh-TW')} 度/年
                    </div>
                  </div>
                  <div className="sm:px-3">
                    <div className="text-slate-500">屋頂面積與型式</div>
                    <div className="font-mono tabular-nums font-semibold text-slate-950 text-sm mt-1">
                      {selectedCase.result.capacity.roofAreaSqm.toFixed(0)} m² ·{' '}
                      {selectedCase.params.roofType === 'metal'
                        ? '鐵皮'
                        : selectedCase.params.roofType === 'rc'
                        ? 'RC'
                        : '未定'}
                    </div>
                  </div>
                  <div className="sm:px-3">
                    <div className="text-slate-500">最近饋線餘裕</div>
                    <div className="font-mono tabular-nums font-semibold text-slate-950 text-sm mt-1">
                      {selectedCase.taipower?.nearestFeeder
                        ? `${selectedCase.taipower.nearestFeeder.feederId} (${selectedCase.taipower.nearestFeeder.capacityKw.toLocaleString('zh-TW')} kW)`
                        : '無資料'}
                    </div>
                  </div>
                  <div className="sm:pl-3">
                    <div className="text-slate-500">遮蔭損失 (SunCalc)</div>
                    <div className="font-mono tabular-nums font-semibold text-slate-950 text-sm mt-1">
                      {selectedCase.result.shading.annualWeightedShadingLossPct.toFixed(1)}%
                    </div>
                  </div>
                </div>

                {/* Gate Summary Strip (flattened hairline dividers) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-0 divide-y md:divide-y-0 md:divide-x divide-slate-200 border-t border-slate-200 pt-5">
                  {selectedCase.result.gates.map((g, idx) => (
                    <div
                      key={g.id}
                      className={
                        idx === 0
                          ? 'pt-2 md:pt-0 md:pr-4'
                          : idx === 1
                          ? 'pt-3 md:pt-0 md:px-4'
                          : 'pt-3 md:pt-0 md:pl-4'
                      }
                    >
                      <div className="text-xs font-semibold text-slate-950">{g.title}</div>
                      <div
                        className={`text-xs font-semibold mt-1 ${
                          g.status === 'pass'
                            ? 'text-emerald-700'
                            : g.status === 'fail'
                            ? 'text-red-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {g.statusLabel}
                      </div>
                      <div className="text-[11px] text-slate-600 mt-1 leading-relaxed">{g.headline}</div>
                    </div>
                  ))}
                </div>
              </section>

              {/* EPC Quote Comparison & Submission */}
              <section className="surface p-4 sm:p-6 space-y-5">
                <div>
                  <h3 className="text-base font-bold text-slate-950">EPC 統一規格報價比較區</h3>
                  <p className="text-xs text-slate-600 mt-1">
                    不同 EPC 報價將套用本案同一組年發電量（
                    {Math.round(selectedCase.result.annualGenKwh).toLocaleString('zh-TW')} kWh/年），即時計算實際 IRR 與回收年限，讓業主直接比較。
                  </p>
                </div>

                {/* Existing Quotes Table */}
                {selectedCase.quotes && selectedCase.quotes.length > 0 ? (
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-[#F8FAFC] border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="text-left py-2.5 px-3 font-semibold">EPC 廠商</th>
                          <th className="text-left py-2.5 px-3 font-semibold">設備規格</th>
                          <th className="text-right py-2.5 px-3 font-semibold">單價 (元/kW)</th>
                          <th className="text-right py-2.5 px-3 font-semibold">總價估算</th>
                          <th className="text-right py-2.5 px-3 font-semibold">試算 IRR (FIT)</th>
                          <th className="text-right py-2.5 px-3 font-semibold">工期/保固</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                        {(() => {
                          const minCapex = Math.min(
                            ...selectedCase.quotes.map((item) => item.quotedCapexPerKw),
                          );
                          return selectedCase.quotes.map((q) => {
                            const isBestCapex =
                              selectedCase.quotes &&
                              selectedCase.quotes.length > 1 &&
                              q.quotedCapexPerKw === minCapex;
                            const simFin = computeFinancialScenario(
                              'fit',
                              'FIT',
                              selectedCase.result.annualGenKwh,
                              selectedCase.result.capacity.pDcKw,
                              selectedCase.result.capacity.effectiveAreaSqm,
                              selectedCase.params.fitRateNtd,
                              { ...selectedCase.params, capexPerKw: q.quotedCapexPerKw },
                              selectedCase.params.fitRateNtd,
                            );
                            return (
                              <tr
                                key={q.id}
                                className={`transition-colors ${
                                  isBestCapex ? 'bg-emerald-50/40 hover:bg-emerald-50/70' : 'hover:bg-slate-50/70'
                                }`}
                              >
                                <td className="py-2.5 px-3 font-sans">
                                  <div className="font-semibold text-slate-950 flex items-center gap-2">
                                    <span>{q.epcCompany}</span>
                                    {isBestCapex && (
                                      <span className="text-[11px] font-semibold text-emerald-700">
                                        · 最低單價 / 最佳 IRR
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-500">{q.contactName}</div>
                                </td>
                                <td className="py-2.5 px-3 font-sans text-slate-700">
                                  <div>{q.moduleSpec}</div>
                                  <div className="text-[11px] text-slate-500">{q.inverterSpec}</div>
                                </td>
                                <td className="py-2.5 px-3 text-right font-semibold text-slate-950">
                                  {q.quotedCapexPerKw.toLocaleString('zh-TW')}
                                </td>
                                <td className="py-2.5 px-3 text-right text-slate-700">
                                  {Math.round(
                                    (q.quotedCapexPerKw * selectedCase.result.capacity.pDcKw) / 10000,
                                  ).toLocaleString('zh-TW')}{' '}
                                  萬
                                </td>
                                <td className="py-2.5 px-3 text-right font-semibold text-emerald-700">
                                  {simFin?.irrPct != null ? `${simFin.irrPct.toFixed(2)}%` : '未設費率'}
                                </td>
                                <td className="py-2.5 px-3 text-right text-slate-600">
                                  {q.estimatedWeeks}週 / {q.warrantyYears}年
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 border border-dashed border-slate-300 rounded-lg p-4 text-center">
                    尚無 EPC 報價紀錄，可於下方輸入報價單進行統一基準試算比較。
                  </div>
                )}

                {/* Quote Submission Form */}
                <form
                  onSubmit={handleQuoteSubmit}
                  className="pt-5 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3.5"
                >
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      EPC 統包廠商名稱
                    </label>
                    <input
                      type="text"
                      required
                      value={epcCompany}
                      onChange={(e) => setEpcCompany(e.target.value)}
                      placeholder="例：永光能源工程股份有限公司"
                      className="w-full h-9 px-2.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-amber-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      聯絡人 / 電話
                    </label>
                    <input
                      type="text"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      placeholder="陳工程師 0912-xxx-xxx"
                      className="w-full h-9 px-2.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-amber-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      每 kW 報價
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        required
                        step={500}
                        value={quotedCapexPerKw}
                        onChange={(e) => setQuotedCapexPerKw(Math.max(10000, Number(e.target.value)))}
                        className="w-full h-9 pl-2.5 pr-16 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-mono text-slate-400 pointer-events-none">
                        元/kWp
                      </span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      採用模組規格
                    </label>
                    <input
                      type="text"
                      value={moduleSpec}
                      onChange={(e) => setModuleSpec(e.target.value)}
                      className="w-full h-9 px-2.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      逆變器品牌規格
                    </label>
                    <input
                      type="text"
                      value={inverterSpec}
                      onChange={(e) => setInverterSpec(e.target.value)}
                      className="w-full h-9 px-2.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        工程保固
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          value={warrantyYears}
                          onChange={(e) => setWarrantyYears(Number(e.target.value))}
                          className="w-full h-9 pl-2.5 pr-7 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-mono text-slate-400 pointer-events-none">
                          年
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        預估工期
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          value={estimatedWeeks}
                          onChange={(e) => setEstimatedWeeks(Number(e.target.value))}
                          className="w-full h-9 pl-2.5 pr-7 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-mono text-slate-400 pointer-events-none">
                          週
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <input
                      type="text"
                      value={quoteNotes}
                      onChange={(e) => setQuoteNotes(e.target.value)}
                      placeholder="備註（例如是否含浪板補強、無穿孔夾具、台電併網代辦費用）"
                      className="w-full h-9 px-2.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-amber-600"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="w-full sm:w-auto h-9 inline-flex items-center justify-center gap-1.5 px-4 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-md cursor-pointer whitespace-nowrap transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>登錄 EPC 報價試算</span>
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
