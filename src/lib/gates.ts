export type GateStatus = 'pass' | 'warn' | 'fail' | 'insufficient'

export type GateResult = {
  id: 'grid' | 'legal' | 'structural'
  status: GateStatus
  title: string
  reasons: string[]
}

/** Tool screening threshold, not a statutory illegal-structure rule. */
export const LEGAL_OVERAGE = 0.15

export function gridGate(input: {
  capacityKw: number | null
  distanceM: number | null
  feeder: string | null
  kwp: number | null
}): GateResult {
  const reasons: string[] = []
  if (input.capacityKw == null || input.feeder == null || input.distanceM == null) {
    return {
      id: 'grid',
      status: 'insufficient',
      title: '併網初查',
      reasons: ['目前沒有可用的附近饋線容量資料。'],
    }
  }
  reasons.push(`最近變壓器所屬饋線 ${input.feeder}，直線距離 ${Math.round(input.distanceM)} 公尺。`)
  reasons.push(`該饋線公告可併網容量 ${input.capacityKw} 瓩（交流）。`)
  if (input.distanceM > 1000) {
    reasons.push('距離超過 1 公里，這組容量不能當成該地址的正式餘裕。')
  }
  if (input.kwp == null) {
    reasons.push('已取得附近饋線資料。請圈選屋頂並填入模組規格，才能估算裝置容量。實際接入點待確認。')
    return { id: 'grid', status: 'insufficient', title: '併網初查', reasons }
  }
  reasons.push(`試算裝置容量 ${input.kwp.toFixed(1)} kWp（直流），與公告的交流容量直接對照，正式併網以台電審查為準。`)
  let status: GateStatus
  if (input.capacityKw <= 0 || input.capacityKw < input.kwp * 0.5) status = 'fail'
  else if (input.capacityKw < input.kwp || input.distanceM > 1000) status = 'warn'
  else status = 'pass'
  if (status === 'fail') reasons.push('公告容量遠低於試算容量，這址現在不像併得上去。')
  else if (input.capacityKw < input.kwp) reasons.push('公告容量小於試算容量，要降載或改配置才有機會。')
  else if (status === 'pass') reasons.push('公告容量大於等於試算容量。')
  return { id: 'grid', status, title: '併網初查', reasons }
}

export function legalGate(drawnM2: number, registeredM2: number | null): GateResult {
  if (!(drawnM2 > 0)) {
    return { id: 'legal', status: 'insufficient', title: '法規關', reasons: ['還沒有屋頂面積。'] }
  }
  if (registeredM2 == null || !(registeredM2 > 0)) {
    return {
      id: 'legal',
      status: 'insufficient',
      title: '面積初查',
      reasons: ['無法取得公開資料。登記工廠名錄沒有廠房面積，請手動輸入登記面積後才比較。'],
    }
  }
  const over = (drawnM2 - registeredM2) / registeredM2
  const reasons = [
    `圈選屋頂 ${Math.round(drawnM2)} 平方公尺，輸入的登記面積 ${Math.round(registeredM2)} 平方公尺。`,
    `差距 ${(over * 100).toFixed(1)}%。工具門檻是登記面積的 15%，這不是法規條文。`,
  ]
  if (over > LEGAL_OVERAGE) {
    reasons.push('面積差異超過 15%，待核對兩者涵蓋的範圍及登記圖說。')
    return { id: 'legal', status: 'fail', title: '面積初查', reasons }
  }
  reasons.push('未超過 15% 門檻。')
  return { id: 'legal', status: 'pass', title: '面積初查', reasons }
}

export type RoofCondition = boolean | null

export type StructuralInput = {
  ageYears: number | null
  roofType: 'metal' | 'rc' | null
  leakOrRust: RoofCondition
  seismicRetrofit: RoofCondition
  rooftopAddOn: RoofCondition
}

export const STRUCTURAL_CHECKLIST = [
  '樑柱配置、跨距，以及鐵皮檁條斷面與鏽蝕',
  '模組加支架的靜載，和既有水塔、管道、設備荷重',
  '錨定、抗風掀與防水收邊',
  '地震力與風力，依建築技術規則由結構技師計算',
  '本結果是規則式快篩，不能取代技師簽證',
]

export function structuralGate(input: StructuralInput): GateResult & { missing: string[]; score: number | null; risk: '低' | '中' | '高' | null } {
  const missing: string[] = []
  if (input.ageYears == null) missing.push('請向廠方確認建物完工年份。')
  if (input.roofType == null) missing.push('請向廠方確認屋面材質。')
  if (input.leakOrRust == null) missing.push('請確認屋頂是否有漏水或鏽蝕。')
  if (input.seismicRetrofit == null) missing.push('請確認是否有結構補強紀錄。')
  if (input.rooftopAddOn == null) missing.push('請確認屋頂是否另有加蓋。')
  if (input.ageYears == null || missing.length > 0) {
    const reasons = input.leakOrRust ? ['已回報漏水或鏽蝕。', ...missing] : missing
    return { id: 'structural', status: 'insufficient', title: '結構初查', reasons, missing, score: null, risk: null }
  }
  let score = 0
  const reasons = [`依填寫的完工年份估算屋齡約 ${input.ageYears} 年。`]
  if (input.roofType === 'metal') {
    score += 2
    reasons.push('屋面選為鐵皮，檁條與固定件是承載關鍵。')
  } else {
    reasons.push('屋面選為 RC，仍要確認樓板載重與錨定。')
  }
  if (input.ageYears >= 30) score += 3
  else if (input.ageYears >= 20) score += 2
  else if (input.ageYears >= 12) score += 1
  if (input.leakOrRust) {
    score += 2
    reasons.push('有填漏水或鏽蝕。')
  }
  if (input.rooftopAddOn) {
    score += 1
    reasons.push('有填屋頂另有加蓋。')
  }
  if (input.seismicRetrofit) {
    score -= 2
    reasons.push('有填做過結構補強；正式仍以簽證為準。')
  }
  score = Math.max(0, Math.min(10, score))
  const risk = score <= 2 ? '低' : score <= 4 ? '中' : '高'
  const status: GateStatus = risk === '低' ? 'pass' : risk === '中' ? 'warn' : 'fail'
  reasons.push(`規則分數 ${score}，風險${risk}。高風險在取得技師簽證前不列合格案源。`)
  return { id: 'structural', status, title: '結構初查', reasons, missing, score, risk }
}

export function surveyRecommendation(gates: GateResult[], structuralMissing: string[]) {
  const status = gates.some((gate) => gate.status === 'fail')
    ? '建議暫緩'
    : gates.some((gate) => gate.status !== 'pass')
      ? '先補資料'
      : '建議優先現勘'
  const followUp = {
    grid: '向台電確認實際接入點及可用交流容量。',
    legal: '取得登記圖說，核對屋頂範圍與面積。',
    structural: '安排現勘查核屋況，並請技師評估承載及固定條件。',
  }
  const priority = { fail: 0, insufficient: 1, warn: 2, pass: 3 }
  return {
    status,
    tasks: [...gates].sort((a, b) => priority[a.status] - priority[b.status]).map((gate) => ({
      id: gate.id,
      title: gate.title,
      reason: gate.id === 'structural' && structuralMissing.length ? '屋齡或屋況資料尚未齊全。' : gate.reasons[gate.reasons.length - 1],
      next: gate.id === 'structural' && structuralMissing.length ? structuralMissing.join('') : followUp[gate.id],
    })),
  }
}

export function qualification(gates: GateResult[]): { qualified: boolean; conditional: boolean; blocked: string[] } {
  const blocked = gates
    .filter((gate) => gate.status === 'fail' || gate.status === 'insufficient')
    .map((gate) => `${gate.title}：${gate.reasons[gate.reasons.length - 1] ?? gate.status}`)
  const conditional = gates.some((gate) => gate.status === 'warn')
  return { qualified: blocked.length === 0, conditional: blocked.length === 0 && conditional, blocked }
}
