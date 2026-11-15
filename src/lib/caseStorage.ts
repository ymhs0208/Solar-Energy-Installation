import type { EpcQuoteItem, EvaluationCase } from '../types/solar';

const ACTIVE_CASE_KEY = 'solarx_active_case_v1';
const EPC_POOL_KEY = 'solarx_epc_pool_v1';

export function saveActiveCase(evalCase: EvaluationCase): void {
  try {
    localStorage.setItem(ACTIVE_CASE_KEY, JSON.stringify(evalCase));
  } catch {
    // ignore storage quota issues
  }
}

export function loadActiveCase(): EvaluationCase | null {
  try {
    const raw = localStorage.getItem(ACTIVE_CASE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as EvaluationCase;
  } catch {
    return null;
  }
}

export function loadEpcPool(): EvaluationCase[] {
  try {
    const raw = localStorage.getItem(EPC_POOL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EvaluationCase[]) : [];
  } catch {
    return [];
  }
}

export function upsertCaseToEpcPool(evalCase: EvaluationCase): EvaluationCase[] {
  const pool = loadEpcPool();
  const idx = pool.findIndex((c) => c.id === evalCase.id);
  const next = [...pool];
  if (idx >= 0) {
    // Preserve existing EPC quotes on update
    next[idx] = { ...evalCase, quotes: pool[idx].quotes || [], updatedAt: new Date().toISOString() };
  } else {
    next.unshift({ ...evalCase, updatedAt: new Date().toISOString() });
  }
  localStorage.setItem(EPC_POOL_KEY, JSON.stringify(next));
  return next;
}

export function addQuoteToCase(caseId: string, quote: Omit<EpcQuoteItem, 'id' | 'submittedAt'>): EvaluationCase[] {
  const pool = loadEpcPool();
  const next = pool.map((c) => {
    if (c.id !== caseId) return c;
    const newQuote: EpcQuoteItem = {
      ...quote,
      id: `quote-${Date.now()}`,
      submittedAt: new Date().toISOString(),
    };
    return {
      ...c,
      quotes: [newQuote, ...(c.quotes || [])],
      updatedAt: new Date().toISOString(),
    };
  });
  localStorage.setItem(EPC_POOL_KEY, JSON.stringify(next));
  return next;
}

export function removeCaseFromEpcPool(caseId: string): EvaluationCase[] {
  const pool = loadEpcPool().filter((c) => c.id !== caseId);
  localStorage.setItem(EPC_POOL_KEY, JSON.stringify(pool));
  return pool;
}
