const PIPELINE_STEPS = [
  {
    step: '01',
    title: '空間定位與 AI 自動挖空',
    desc: '於國土測繪 PHOTO2 正射影像框選屋頂，透過 Gemini Vision 識別水塔、採光罩與外推棚架並輸出地理座標一鍵自動挖空。',
  },
  {
    step: '02',
    title: '逐板遮蔭熱圖與配置優化',
    desc: '讀取國土測繪 3D Tiles 與 OSM height 建物屋高，計算每片光電板全年逐時 SunCalc 遮蔭率熱圖，一鍵剔除 >15% 低效板。',
  },
  {
    step: '03',
    title: '台電與建管法規三關審查',
    desc: '比對台電饋線餘裕、100/500 kW 併網級別與 RPR 逆電力、4.5 m 免雜照棚架高度及登記面積外推風險。',
  },
  {
    step: '04',
    title: 'TOU、光儲與 ESG 減碳試算',
    desc: '模擬高壓時間電價與 BESS 削峰減約，結合 0.494 kg CO₂e/度、T-REC 憑證與碳費避險產出標準化報告。',
  },
];

const DATA_PROVENANCE_ROWS = [
  {
    item: '正射影像與 3D 建物',
    agency: '內政部國土測繪中心 (NLSC)',
    usage: 'PHOTO2 底圖、段籍定位、3D Tiles (.glb) 實測屋高',
    fallback: '無公開 3D 模型之區域不推算屋高，明確回報圖資覆蓋狀態',
  },
  {
    item: '周圍建物輪廓高度',
    agency: 'OpenStreetMap (Overpass API)',
    usage: '補充建物輪廓點選套用及具備 height / building:levels 之建物遮蔭',
    fallback: '嚴格過濾缺 height 標籤建物，絕不臆測樓層高度',
  },
  {
    item: '逐月日照與環境氣溫',
    agency: 'NASA POWER Climatology API',
    usage: '取得經緯度格點逐月水平面 GHI 與環境氣溫 T_amb',
    fallback: '連線逾時直接顯示錯誤與重試鈕，不使用離線假數值',
  },
  {
    item: '饋線可併網剩餘容量',
    agency: '台灣電力公司政府開放資料平臺',
    usage: '即時解壓縣市 Feeder CSV/ZIP，計算距離與 1.5 km 替代饋線',
    fallback: '無最近饋線或解析失敗時標記須洽台電區處查核',
  },
  {
    item: '商工登記與費率參考',
    agency: '經濟部 GCIS · 能源署 · 台電電價表',
    usage: '統編查核公司狀態、115 年度再生能源躉購費率、高壓時間電價',
    fallback: '廠房使照面積與屋頂材質（鐵皮/RC）無公開 API，強制由使用者確認填寫',
  },
];

export function MethodologyPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      <header className="page-banner space-y-2">
        <div className="text-xs font-medium text-amber-700">
          系統架構與公開資料規範
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-950">
          SolarX AI 演算法與公開資料來源說明
        </h1>
        <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">
          所有幾何排布、日照轉置與財務淨現值皆於瀏覽器端即時運算，後端僅負責白名單政府域之同源代理（
          <code className="font-mono text-xs bg-slate-200/70 px-1.5 py-0.5 rounded">/live/*</code>
          ），以解決圖資 CORS 與 Referer 限制，絕不留存廠房地址與機敏參數。
        </p>
      </header>

      {/* 4-Step Pipeline Strip */}
      <section aria-label="系統評估流程架構">
        <div className="methodology-steps grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {PIPELINE_STEPS.map((p) => (
            <div key={p.step} className="surface p-5 space-y-2">
              <div className="font-mono text-xs font-bold text-amber-700 tabular-nums">
                階段 {p.step}
              </div>
              <h2 className="text-sm font-bold text-slate-950">{p.title}</h2>
              <p className="text-xs text-slate-600 leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Open Data Provenance & Zero-Fabrication Matrix */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-slate-950">01. 即時公開資料源與缺漏處理準則</h2>
          <p className="text-xs text-slate-600 mt-1">
            每個數值皆附帶上游來源網址與擷取時間戳記；公開資料查無欄位絕不以假設值冒充。
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#F8FAFC] border-b border-slate-200 text-slate-600">
              <tr>
                <th className="text-left py-3 px-4 font-semibold whitespace-nowrap">資料項目</th>
                <th className="text-left py-3 px-4 font-semibold whitespace-nowrap">權威來源單位</th>
                <th className="text-left py-3 px-4 font-semibold">系統用途</th>
                <th className="text-left py-3 px-4 font-semibold">缺漏或異常時處理</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {DATA_PROVENANCE_ROWS.map((row) => (
                <tr key={row.item} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3 px-4 font-semibold text-slate-950 whitespace-nowrap">
                    {row.item}
                  </td>
                  <td className="py-3 px-4 text-slate-700 whitespace-nowrap">{row.agency}</td>
                  <td className="py-3 px-4 text-slate-700 leading-relaxed">{row.usage}</td>
                  <td className="py-3 px-4 text-slate-600 leading-relaxed">{row.fallback}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Core Models & Three Gates */}
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
        <section className="p-6 md:p-7 space-y-4">
          <h2 className="text-base font-bold text-slate-950">02. 核心物理排布與 3D 遮蔭計算模型</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-slate-700 leading-relaxed">
            <div className="space-y-2">
              <div className="font-semibold text-slate-950 text-sm">幾何排布與有效面積扣除</div>
              <p>
                依測地投影面積計算屋頂多邊形外框面積，扣除障礙物挖空多邊形、屋緣消防退縮距離（Setback）與維運通道比例（Walkway Ratio），將模組尺寸依實質方位轉置投射於屋面，向下取整求得實際可排片數與 P_DC / P_AC 容量。
              </p>
            </div>
            <div className="space-y-2">
              <div className="font-semibold text-slate-950 text-sm">類 pvlib 日照轉置與溫升損失</div>
              <p>
                取 NASA POWER 逐月水平面日照量（GHI）與環境氣溫（T_amb），經 Erbs 散射分解與 Liu-Jordan 傾斜面轉置推導傾斜面日照 H_POA,m；並依 NOCT 電池工作溫度模型、模組溫度係數 γ 與系統損失 L_sys 計算逐月發電量。
              </p>
            </div>
            <div className="space-y-2 md:col-span-2 pt-2 border-t border-slate-100">
              <div className="font-semibold text-slate-950 text-sm">
                SunCalc 3D 逐板遮蔭熱圖與 ESG 減碳計算（國土測繪 3D Tiles + OSM height）
              </div>
              <p>
                針對 1–12 月代表日 06:00–18:00 逐時以 SunCalc 計算太陽高度角與方位角，優先採用國土測繪中心實測 3D Tiles 建物屋高並補充 OSM 明確標註{' '}
                <code className="font-mono text-[11px] bg-slate-100 px-1 py-0.5 rounded">height</code>{' '}
                之建築投影，算出逐片光電板年遮蔭率並提供一鍵剔除低效板（&gt;15%）；減碳與 T-REC 依經濟部能源署電力排碳係數（預設 0.494 kg CO₂e/度）及非 FIT 自用憑證規範計算。
              </p>
            </div>
          </div>
        </section>

        <section className="p-6 md:p-7 space-y-4">
          <h2 className="text-base font-bold text-slate-950">03. 三道關卡審查邏輯與實測驗證聲明</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs text-slate-700 leading-relaxed">
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-amber-700">第一關卡 · 饋線併網</div>
              <div className="font-semibold text-slate-950 text-sm">台電饋線與併網級別審查</div>
              <p>
                依 P_AC 判定低壓（&lt;100 kW）、高壓 MOF（100–500 kW）或系統衝擊檢討（≥500 kW）級別；饋線不足時搜尋 1.5 km 替代饋線並建議降載容量或 RPR 逆電力電驛不逆送設計。
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-amber-700">第二關卡 · 建管法規</div>
              <div className="font-semibold text-slate-950 text-sm">建管 4.5m 免雜照與外推比對</div>
              <p>
                比對屋頂幾何面積與登記面積、檢核《設置再生能源設施免請領雜項執照標準》4.5 m 棚架高度上限與 1.5 m 消防搶救退縮，並連動 AI 外推雨遮初篩結果示警。
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-amber-700">第三關卡 · 結構安全</div>
              <div className="font-semibold text-slate-950 text-sm">屋頂結構承重技師篩檢</div>
              <p>
                依據屋頂構造型式（鐵皮浪板 vs. RC 混凝土）與 AI 鏽蝕初篩結果檢核抗風壓拉拔與載重餘裕，明確提示結構技師簽證與浪板補強項目。
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 text-xs text-slate-600 leading-relaxed">
            <strong className="text-slate-950">實測驗證進度聲明：</strong>
            目前系統尚未載入已完工案場之台電實際抄表發電校正係數；後續將結合合作 EPC 提供之併網電廠實績、各時段無人機空拍遮蔭照片與台電審查意見書退件案例，持續進行模型迴歸校驗。
          </div>
        </section>
      </div>
    </main>
  );
}
