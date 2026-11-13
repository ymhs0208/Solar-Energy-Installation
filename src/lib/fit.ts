/**
 * 115 年度費率在執行時向經濟部能源署公告 PDF 取值，不把費率寫死在程式裡。
 * 公告：115 年 1 月 2 日經能字第11458005630號，附表三。
 */
export const FIT_115_URL =
  'https://www.moeaea.gov.tw/ECW/populace/news/wHandNews_File.ashx?file_id=28963'

export const FIT_115_CITATION = {
  name: '經濟部 115 年度太陽光電躉購費率公告附表',
  url: FIT_115_URL,
  date: '2026-01-02',
} as const

export type FitBracket = { minKwp: number; maxKwp: number | null; rate: number; label: string }

export function parseRoofFitTable(text: string): FitBracket[] {
  const flat = text.replace(/\s+/g, '').replace(/(\d+\.\d{4})(\d{1,4})(?=瓩以上)/g, '$1|$2')
  const roof = flat.split('地面型')[0] ?? flat
  const rows: FitBracket[] = []
  const ranged = /(\d{1,4})瓩以上不及(\d{1,5})瓩(\d+\.\d{4})/g
  for (const match of roof.matchAll(ranged)) {
    const minKwp = Number(match[1])
    const maxKwp = Number(match[2])
    const rate = Number(match[3])
    rows.push({ minKwp, maxKwp, rate, label: `${minKwp} 瓩以上未滿 ${maxKwp} 瓩` })
  }
  const top = roof.match(/500瓩以上(\d+\.\d{4})/)
  if (top?.[1]) {
    const rate = Number(top[1])
    rows.push({ minKwp: 500, maxKwp: null, rate, label: '500 瓩以上' })
  }
  const unique = rows.filter((row, index) => rows.findIndex((item) => item.minKwp === row.minKwp) === index)
  unique.sort((a, b) => a.minKwp - b.minKwp)
  if (unique.length < 6) throw new Error('公告附表裡讀不到完整的屋頂型級距')
  return unique
}

export function lookupFit(kwp: number, rows: FitBracket[]): FitBracket | null {
  if (!(kwp >= 1)) return null
  for (const row of rows) {
    if (kwp >= row.minKwp && (row.maxKwp == null || kwp < row.maxKwp)) return row
  }
  return null
}

export const CAPEX_CITATION = {
  name: '內政部國土署新聞稿（引述經濟部及建研所）',
  url: 'https://www.moi.gov.tw/News_Content.aspx?n=8&s=338947',
  date: '2026-06-09',
  text: '太陽光電建置費用每瓩約 3.8 萬餘元。這不是可下載的費率表，請自行輸入要採用的單價。',
} as const
