# SolarX AI｜工廠屋頂太陽能快篩

工廠地址進去之後，先看三關（併網、登記面積、結構），再算發電、配置和兩種收益，合格的可以放進案源清單。畫面是繁體中文。數字都在當下向公開來源要，失敗就顯示錯誤和重試，沒有離線備援。

## 執行

```bash
npm install
npm run dev
```

瀏覽器開 [http://127.0.0.1:4317](http://127.0.0.1:4317)。

```bash
npm test
npm run build
npm run preview
```

`dev` 和 `preview` 都會掛同一個同源代理。靜態空間如果沒有這個 Node 程序，下面列的幾個官方檔案會被瀏覽器 CORS 擋住。

## 哪些請求直連、哪些走代理

直連（回應有 `Access-Control-Allow-Origin`，瀏覽器可自己叫）：

- NASA POWER climatology：月平均全天空短波、散射、二米氣溫
- 國土測繪中心正射影像 WMTS、縣市 3D Tiles

必須走 `/live/*` 代理：

| 路徑 | 官方網址 | 原因 |
| --- | --- | --- |
| `/live/nlsc` | `https://api.nlsc.gov.tw/idc/TextQueryMap/` | 沒有 `Referer: https://maps.nlsc.gov.tw/` 會被拒，瀏覽器不能代填這個 Referer |
| `/live/factories` | 經濟部產業發展署生產中工廠清冊 ZIP | 回應沒有 CORS |
| `/live/feeder` | 台電桃園市、臺中市可併網容量 ZIP | 同上 |
| `/live/tariff` | 台電各類電價表 JSON | 同上 |
| `/live/fit` | 經濟部 115 年 1 月 2 日躉購費率公告 PDF | 同上。程式從 PDF 文字讀屋頂型級距 |
| `/live/overpass` | `https://overpass.openstreetmap.fr/api/interpreter` | 帶瀏覽器 Origin 會被拒（403，僅白名單）。代理不帶 Origin，查建物輪廓與 `height` |

代理只允許上表這些官方網址，不是開放代理。本機 `npm run dev` / `npm run preview` 由 Vite 中介層轉送；Cloudflare Worker 由 `worker/index.ts` 做同一件事。`/report` 與 `/epc` 沒有實體檔案，Static Assets 以單頁應用回傳 `index.html`。

## 部署到 Cloudflare Workers

部署目標是 Worker 加上 Static Assets。`npm run build` 產出 `dist`，`npx wrangler deploy` 依 `wrangler.toml` 上傳：

- Worker 名稱 `solar-energy-installation`，進入點 `worker/index.ts`
- `[assets]` 目錄 `./dist`，binding `ASSETS`，`not_found_handling = "single-page-application"`
- `run_worker_first = ["/live/*"]`：這條路徑先跑白名單代理；其餘路徑先找靜態檔，沒有檔案就回 `index.html`（`/`、`/report`、`/epc` 都是這樣）

環境變數不用填。

### Workers Builds（Git 連線）

推上 `main` 後，Workers Builds 會執行建置再部署：

```bash
npm run build
npx wrangler deploy
```

若要重新接一次：

1. 打開 [Cloudflare dashboard](https://dash.cloudflare.com/)。
2. 左側進入 **Workers & Pages**。
3. 選 **Create**。
4. 選 **Workers**（Workers Builds），再選 **Connect to Git**。
5. 授權 GitHub 後，選倉庫 `ymhs0208/Solar-Energy-Installation`。
6. 建置設定：
   - Project name：`solar-energy-installation`（須與 `wrangler.toml` 的 `name` 相同）
   - Production branch：`main`
   - Build command：`npm run build`
   - Deploy command：`npx wrangler deploy`
7. 環境變數不用填。按 **Save and Deploy**。
8. 部署完成後打開 Worker 的 `*.workers.dev` 網址。快篩頁會透過 `/live/*` 向國土測繪中心、經濟部、台電、能源署與 Overpass 取數。

### 只用指令部署

在已登入 Wrangler 的機器上：

```bash
npm install
npm run build
npx wrangler deploy
```

本機先確認靜態頁和代理（Wrangler 4.20 以上才支援 `run_worker_first` 的路徑陣列）：

```bash
npm run build
npx wrangler dev
```

對該埠請求 `/`、`/report`、`/epc` 應回 `index.html`（200）。`/live/nlsc?q=桃園市觀音區大同二路11號` 應回門牌 XML。

## 資料怎麼用

- 工廠名錄：執行時下載 ZIP，只留下桃園市觀音區、臺中市大里區。名錄沒有廠房面積，也沒有鐵皮／RC。負責人姓名和統一編號不進畫面。
- 地址：國土測繪中心門牌定位。名錄裡的廠只是搜尋名單，座標仍是即時定位。
- 併網：下載桃園、臺中饋線容量和變壓器 TWD67 座標，用 EPSG:3828 轉成 WGS84，取 3 公里內最近的變壓器所屬饋線。這不是台電正式審查。
- 射量與氣溫：NASA POWER 2001–2025 月氣候值，單位 kWh/m²/日 與 °C。
- 發電：代表日（每月 15 日、台北時間）的太陽位置分配 NASA 日射量，各向同性散射，傾角入射角用 Duffie 幾何。模組效率＝額定功率÷（長×寬）。溫度、系統損失、反照率空白就不計。
- 配置：南向用冬至正午的前後排間距；東西向和平鋪只用投影深度加你填的間隙。這三個傾角是配置設定，不是觀測值。
- 遮蔽：只對有高度的屋頂和建物做射線。OSM 沒有 `height` 就不估。`building:levels` 只顯示，不換算公尺。三維模型用來檢視，網格高度沒有拆成屬性。
- 電費：台電 JSON。高壓三段式用發電小時加權，週日比例是 5 個工作日、1 個週六、1 個週日，沒有套國定假日曆。
- 租金、每瓩造價、模組規格、案源報價：沒有可下載的公開表。造價旁邊有內政部國土署 115-06-09 新聞稿連結（約每瓩 3.8 萬餘元），數字要自己輸入。

## 三關

- 併網：公告容量對目前選定配置的直流 kWp。容量為 0 或低於一半算未過，介於一半和裝置容量之間算警示，變壓器超過 1 公里也只到警示。
- 法規：圈選面積超過你輸入的登記面積 15% 就標疑似增建。15% 是工具門檻，不是法條。
- 結構：屋齡（以登記日期算到今天）加你選的屋面和勾選項目。不取代技師簽證。
