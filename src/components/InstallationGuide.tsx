export function InstallationGuide() {
  return (
    <section className="rounded-xl border border-line bg-card p-4 sm:p-6">
      <h2 className="text-lg font-bold">裝設前要確認什麼</h2>
      <p className="mt-1 text-sm text-stone-600">把地圖初估轉成工程方案，需要以下文件與現場查核。</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {[
          ['屋頂可用範圍', '確認水塔、採光罩、排煙設備、維修通道及屋頂邊緣。圈選範圍需扣除這些區域後再確認排板。', '廠方與工程行共同現勘'],
          ['建物與土地文件', '準備建照、使用執照、登記圖說及屋頂使用同意文件。圈選面積差異可協助找出需核對的位置。', '建築師或主管建築機關核對'],
          ['結構與施工', '核對樑柱、檁條、鏽蝕、防水及既有設備荷重，確認固定方式、抗風與施工動線。', '技師與工程行評估'],
          ['電力與營運', '確認實際接入點、交流容量及線路工程。自用方案需核對電費單與用電時段，出租方案需取得租賃條件。', '台電、工程行與屋主共同確認'],
        ].map(([title, body, owner]) => (
          <article key={title} className="rounded-lg border border-line bg-white p-4">
            <h3 className="font-bold">{title}</h3>
            <p className="mt-2 text-sm leading-6">{body}</p>
            <p className="mt-2 text-xs text-stone-600">{owner}</p>
          </article>
        ))}
      </div>
      <details className="mt-4 border-t border-line pt-3">
        <summary className="cursor-pointer font-bold">法規適用與官方查核入口</summary>
        <p className="mt-2 text-sm leading-6">新建、增建與改建案件，需依建築物用途、規模、申請時點及現行規定確認光電設置義務。既有工廠應另核對建物合法性、設備設置與地方申辦要求。面積差異與結構快篩供前期查核使用。</p>
        <a className="mt-2 inline-block text-sm font-bold text-pine underline" href="https://www.nlma.gov.tw/ch/legislation/regsearch/7260" target="_blank" rel="noreferrer">查看建築物設置太陽光電發電設備標準</a>
      </details>
    </section>
  )
}
