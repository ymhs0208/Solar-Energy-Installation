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
      title: '併網關',
      reasons: ['這個位置 3 公里內沒有對上的台電公開變壓器點，無法取得可併網容量。'],
    }
  }
  reasons.push(`最近變壓器所屬饋線 ${input.feeder}，直線距離 ${Math.round(input.distanceM)} 公尺。`)
  reasons.push(`該饋線公告可併網容量 ${input.capacityKw} 瓩（交流）。`)
  if (input.distanceM > 1000) {
    reasons.push('距離超過 1 公里，這組容量不能當成該地址的正式餘裕。')
  }
  if (input.kwp == null) {
    reasons.push('還沒有裝置容量，無法和容量比較。')
    return { id: 'grid', status: 'insufficient', title: '併網關', reasons }
  }
  reasons.push(`試算裝置容量 ${input.kwp.toFixed(1)} kWp（直流），與公告的交流容量直接對照，正式併網以台電審查為準。`)
  let status: GateStatus
  if (input.capacityKw <= 0 || input.capacityKw < input.kwp * 0.5) status = 'fail'
  else if (input.capacityKw < input.kwp || input.distanceM > 1000) status = 'warn'
  else status = 'pass'
  if (status === 'fail') reasons.push('公告容量遠低於試算容量，這址現在不像併得上去。')
  else if (input.capacityKw < input.kwp) reasons.push('公告容量小於試算容量，要降載或改配置才有機會。')
  else if (status === 'pass') reasons.push('公告容量大於等於試算容量。')
  return { id: 'grid', status, title: '併網關', reasons }
}

export function legalGate(drawnM2: number, registeredM2: number | null): GateResult {
  if (!(drawnM2 > 0)) {
    return { id: 'legal', status: 'insufficient', title: '法規關', reasons: ['還沒有屋頂面積。'] }
  }
  if (registeredM2 == null || !(registeredM2 > 0)) {
    return {
      id: 'legal',
      status: 'insufficient',
      title: '法規關',
      reasons: ['無法取得公開資料。登記工廠名錄沒有廠房面積，請手動輸入登記面積後才比較。'],
    }
  }
  const over = (drawnM2 - registeredM2) / registeredM2
  const reasons = [
    `圈選屋頂 ${Math.round(drawnM2)} 平方公尺，輸入的登記面積 ${Math.round(registeredM2)} 平方公尺。`,
    `差距 ${(over * 100).toFixed(1)}%。工具門檻是登記面積的 15%，這不是法規條文。`,
  ]
  if (over > LEGAL_OVERAGE) {
    reasons.push('圈選面積超過登記面積 15%，標成疑似增建，要再核對建築執照與測量。')
    return { id: 'legal', status: 'fail', title: '法規關', reasons }
  }
  reasons.push('未超過 15% 門檻。')
  return { id: 'legal', status: 'pass', title: '法規關', reasons }
}

export type StructuralInput = {
  ageYears: number | null
  roofType: 'metal' | 'rc' | null
  leakOrRust: boolean
  seismicRetrofit: boolean
  rooftopAddOn: boolean
}

export const STRUCTURAL_CHECKLIST = [
  '樑柱配置、跨距，以及鐵皮檁條斷面與鏽蝕',
  '模組加支架的靜載，和既有水塔、管道、設備荷重',
  '錨定、抗風掀與防水收邊',
  '地震力與風力，依建築技術規則由結構技師計算',
  '本結果是規則式快篩，不能取代技師簽證',
]

export function structuralGate(input: StructuralInput): GateResult & { score: number | null; risk: '低' | '中' | '高' | null } {
  if (input.ageYears == null || input.roofType == null) {
    const reasons: string[] = []
    if (input.ageYears == null) reasons.push('無法取得公開資料。工廠登記日期無法換算屋齡。')
    if (input.roofType == null) reasons.push('無法取得公開資料。登記名錄沒有鐵皮或 RC，請手動選擇。')
    return { id: 'structural', status: 'insufficient', title: '結構關', reasons, score: null, risk: null }
  }
  let score = 0
  const reasons = [`屋齡 ${input.ageYears} 年（以 2026-11-13 回推登記日期）。`]
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
  return { id: 'structural', status, title: '結構關', reasons, score, risk }
}

export function qualification(gates: GateResult[]): { qualified: boolean; conditional: boolean; blocked: string[] } {
  const blocked = gates
    .filter((gate) => gate.status === 'fail' || gate.status === 'insufficient')
    .map((gate) => `${gate.title}：${gate.reasons[gate.reasons.length - 1] ?? gate.status}`)
  const conditional = gates.some((gate) => gate.status === 'warn')
  return { qualified: blocked.length === 0, conditional: blocked.length === 0 && conditional, blocked }
}
