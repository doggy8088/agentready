# AgentReady.js

> **加一段 JavaScript,讓你的網站準備好迎接 AI Agent。**

AgentReady.js 是一個為「既有網頁」設計的漸進增強層。只要載入一個 `<script>` 標籤,它就會把你網站的語意化 HTML——表單、導覽、按鈕、應用程式狀態——轉換成安全、結構化的 **[WebMCP](https://webmachinelearning.github.io/webmcp/)** 工具,讓任何支援 WebMCP 的 agent 都能直接呼叫:ChatGPT 內建瀏覽器、Chrome 149+,或是使用標準 `getTools()` / `executeTool()` 形態的頁內 agent(in-page agents)。

人類繼續使用原本的介面,agents 則獲得一套屬於自己的可靠介面。

```html
<script src="agentready.js" defer></script>
```

為 **WebMCP Challenge**(2026 年 9 月)而打造。

> 🌐 English version: [README.md](./README.md)

---

## 為什麼重要

WebMCP 讓網站把自身能力**宣告**給 agents,而不是讓 agents 靠截圖和蠻力翻 DOM 去猜。但要重寫現存數百萬個網站並不現實——所以 AgentReady.js 會自動推導出工具層:

| Level | 網站要做什麼 | Agents 得到什麼 |
|---|---|---|
| **0 — 一個 script 標籤** | 什麼都不用做,載入 `agentready.js` 即可 | 7 個核心語意工具 + 自動合成的表單工具 |
| **1 — HTML metadata** | 加上 `data-agent-*` 屬性 | 精確的工具名稱、描述、送出政策 |
| **2 — 原生註冊** | 呼叫 `AgentReady.register({...})` | 完整的領域特定工具,logic 全由你寫 |

同一個頁面因此能與**任何** WebMCP agent 協作——ChatGPT、頁內 agent,或未來的任何 client——因為一切都透過標準的 `document.modelContext` API 暴露(另含 `navigator.modelContext` 後備偵測以支援 Firefox;沒有原生 API 的環境——包括只有 `registerTool` 的 ChatGPT 桌面版用戶端——則使用功能相同的頁內 fallback)。

```
            人類
              │
        ┌─────┴─────┐
        │   網站    │
        └─────┬─────┘
     AgentReady.js(語意探索 + 安全政策 + inspector)
              │
      document.modelContext  ← 有原生 WebMCP 時優先使用
              │
   ChatGPT 瀏覽器 · Chrome 149+ · 頁內 agents(AskPage 等)
```

---

## 快速開始

### Level 0 — 直接載入

```html
<script src="https://cdn.jsdelivr.net/npm/@willh/agentready@latest/dist/agentready.js" defer></script>
```

或改用 npm 安裝:`npm install @willh/agentready` → 直接 serve `node_modules/@willh/agentready/dist/agentready.js`。

就這樣。AgentReady 會探索頁面並註冊:

| 工具 | 類型 | 說明 |
|---|---|---|
| `get_page_context` | 唯讀 | 頁面語意摘要:標題、標題層級、區域、表單、統計 |
| `find_on_page` | 唯讀 | 以關鍵字/自然語言搜尋互動元素**與頁面上的可見文字**(支援中日韓等各語言)→ 回傳穩定的語意 refs 或文字片段;查不到時會說明搜尋範圍與下一步建議 |
| `read_target` | 唯讀 | 讀取某 ref 的細節:值、選項、連結、周圍內容 |
| `activate_target` | 寫入 | 點擊按鈕 / 連結 / 分頁(具破壞性的動作需要人類核准) |
| `set_field` | 寫入 | 設定單一 input / select / checkbox / radio,觸發真實的 `input`+`change` 事件 |
| `fill_form` | 寫入 | 依 label 一次填完整張表單;**永不送出** |
| `submit_form` | 寫入 | 送出前**必須經過頁面上明確的人類核准** |
| `search_products`、`signup_form`、… | 自動 | 每個語意化表單合成一個工具,附真實 JSON Schema |

合成的工具衍生自 `aria-label` / 標題 / action URL。一個搜尋表單會變成
`search_products({ q, category, max_price })` —— 而不是二十個 `set_input_17` 這種低階工具。

### Level 1 — 加上 metadata(選用)

```html
<form
  method="get"
  aria-label="Product search"
  data-agent-name="search_products"
  data-agent-description="Search products in the catalog"
  data-agent-submit="auto">
  <input name="q" type="search" placeholder="Search…" />
  <select name="category">…</select>
  <button>Search</button>
</form>
```

- `data-agent-name` / `data-agent-tool` — 工具名稱(否則從 label/標題/action 推導)
- `data-agent-description` — 工具描述
- `data-agent-submit="auto | confirm | never"` — 覆寫送出政策
- `data-agent-hide` — 完全排除某個欄位,不讓 agents 看見
- `data-agent-priority` — 優先合成這個表單(每頁最多 8 個)

### Level 2 — 註冊原生工具(選用)

```html
<script>
  window.AgentReadyConfig = { siteName: 'My Store' };
</script>
<script src="agentready.js" defer></script>
<script>
  document.addEventListener('DOMContentLoaded', () => {
    window.AgentReady.register({
      name: 'add_to_cart',
      description: 'Add a product to the shopping cart',
      inputSchema: {
        type: 'object',
        properties: { productId: { type: 'string' }, quantity: { type: 'number' } },
        required: ['productId'],
      },
      execute: ({ productId, quantity }) => cart.add(productId, quantity ?? 1),
    });
  });
</script>
```

`window.AgentReady` 也提供 `getTools()`、`executeTool(name, args)` 與 `inspect()` —— 與
WebMCP 標準 API 同形 —— 所以**頁內 agents 在每個瀏覽器上都能運作**,即使沒有原生 API。

---

## 安全模型(內建)

AgentReady 預設把頁面上的一切——以及 agent 可能做的一切——視為不可信任。所有工具都帶
`untrustedContentHint`;唯讀工具另帶 `readOnlyHint`。每次工具輸出會被限制在約 1,500 字元內。

| 內容 / 動作 | 政策 |
|---|---|
| 讀取頁面內容、搜尋、導覽 | ✅ 允許 — 頁面文字搜尋會略過隱藏內容、`data-agent-hide` 子樹、腳本、表單控制項的值,以及敏感欄位的 label/提示;文字結果為唯讀(`activate_target` / `set_field` 會拒絕) |
| 填寫一般表單欄位 | ✅ 允許 |
| hidden 欄位、token、密碼、卡號欄位(`cc-*`、CVV) | ⛔ 不暴露、不填寫、值一律遮蔽 |
| 表單送出、結帳、刪除/購買類按鈕 | 🙋 透過頁面板取得人類核准 |
| 任意 JavaScript 執行 | ⛔ 永不提供 |

右下角的 inspector(徽章)會顯示即時工具清單、每個 agent 動作與其參數、在 agent 觸碰目標時
高亮標記,並對重大操作彈出 **Approve / Decline** 確認對話框。敏感欄位會被排除在 schema
與探索結果之外,agents 永遠看不到它們的存在或值。

設定方式:

```js
window.AgentReadyConfig = {
  inspector: true,          // 頁面徽章 + 活動紀錄 + 確認對話框(false = 需核准的動作一律自動拒絕 — fail-closed)
  siteName: 'My Store',     // 徽章名稱
  maxResults: 8,            // find_on_page 結果上限
};
```

### 隱藏或自訂 Inspector

Inspector 徽章預設為開啟（`inspector: true`）。依據你的使用情境，有三種隱藏或調整的方式：

1. **完全停用 Inspector UI（透過全域設定）：**
   ```html
   <script>
     window.AgentReadyConfig = {
       inspector: false, // 停用徽章、活動紀錄與確認對話框
     };
   </script>
   <script src="agentready.js" defer></script>
   ```
   > **注意：** AgentReady 採用 fail-closed（預設安全拒絕）模型。若將 `inspector` 設為 `false`，任何需要人類核准的操作（例如送出表單、結帳）將會**自動拒絕**，因為畫面上沒有對話框供使用者點選核准。

2. **透過 CSS 隱藏整個 UI：**
   Inspector 的 host 元素帶有 `data-agentready-ui` 屬性，可在全域 CSS 中直接隱藏：
   ```css
   div[data-agentready-ui] {
     display: none !important;
   }
   ```
   *（注意：這會讓審核彈出視窗也一併隱藏在畫面之外）。*

3. **僅隱藏右下角徽章（保留人類審核確認對話框）：**
   由於 Inspector UI 使用開放式 Shadow DOM（`mode: 'open'`），你可以僅針對 `.badge` 元素隱藏，同時保留 **Approve / Decline** 確認對話框的正常運作：
   ```html
   <script>
     window.addEventListener('DOMContentLoaded', () => {
       const host = document.querySelector('div[data-agentready-ui]');
       if (host?.shadowRoot) {
         const style = document.createElement('style');
         style.textContent = '.badge { display: none !important; }';
         host.shadowRoot.appendChild(style);
       }
     });
   </script>
   ```

---

## 開發

工具鏈:**Bun**(安裝/打包/本機伺服器)+ **TypeScript 7**(strict)撰寫全部原始碼。

```bash
bun install        # 或:make install
make ci            # typecheck → lint → build → 單元測試 → size → E2E(真 Chrome)
make demo          # 在 http://localhost:8788 啟動
```

| URL | 說明 |
|---|---|
| `http://localhost:8788/demo/store/` | Legacy Store 展示站——刻意做得平平無奇的商店 |
| `http://localhost:8788/demo/test-page/` | 驗證頁:狀態儀表板、測試 fixtures、情境 console |

### 測試分層

| 層級 | 執行方式 | 涵蓋範圍 |
|---|---|---|
| 單元測試 | `bun test tests/agentready.test.ts`(happy-dom) | 政策分類、語意探索/比對、控制項事件、表單合成、runtime shim |
| E2E | `bun test tests/e2e`(Playwright + 真 Chrome) | 啟動、inspector UI、核准/拒絕閘、合成工具、MutationObserver 重合成、輸出預算、完整購物流程、零 console 錯誤 |
| 手動 | `/demo/test-page/` | 即時工具清單、遮蔽示範、DevTools console 的 `AgentReady.executeTool(...)` |

E2E 會使用你安裝的 Chrome(`channel: 'chrome'`),找不到時退回 Playwright 內建的 Chromium。

### 專案結構

```
src/
  index.ts            啟動流程、MutationObserver、公開 API
  runtime.ts          document.modelContext 轉接器 + 頁內 shim(getTools/executeTool)
  semantic.ts         DOM 探索、穩定 refs(WeakRef)、自然語言比對
  policy.ts           暴露等級、輸出預算、敏感欄位遮蔽
  inspector.ts        shadow-DOM 活動 UI + 人類核准對話框
  env.ts              共用型別:AgentEnv、AgentReadyConfig、FormInfo、Activity
  tools/              page.ts · interact.ts · forms.ts · controls.ts
demo/store/           Legacy Store 展示站(自包含、可直接部署)
demo/test-page/       驗證頁
tests/                bun:test 單元測試 + Playwright E2E
```

### 在 WebMCP 瀏覽器中測試

- **ChatGPT 桌面版** — 內建瀏覽器預設支援 WebMCP(僅 registerTool 的 client;AgentReady 會偵測
  並把 `getTools`/`executeTool` 保留在頁內)。
- **Chrome 149+** — 開啟 `chrome://flags/#enable-webmcp-testing`,重新啟動即可。
- **Firefox** — AgentReady 也會偵測 `navigator.modelContext`。
- 沒有原生 API 時,AgentReady 會跑頁內 shim:所有工具仍可透過 `window.AgentReady` 使用——
  適合本機開發(`http://localhost`)與非 WebMCP 瀏覽器。

### 部署 demo

`demo/store/` 是自包含的(建置時 bundle 會複製到 `vendor/agentready.js`)——直接拖進
Netlify,或 `vercel deploy`、`npx wrangler pages deploy`,或任何靜態主機。

---

## 授權

[MIT](./LICENSE) © 2026 Will Huang