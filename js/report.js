const STORE_KEYS = [
  "stores",
  "sedori_stores_v2",
  "sedori_stores_v1",
  "sedori_stores_v3",
  "sedori_stores"
];

const LOG_KEYS = [
  "logs",
  "sedori_logs_v2",
  "sedori_logs_v1",
  "sedori_logs_v3",
  "sedori_logs"
];

let selectedMonth = null;
let selectedDay = null;
let selectedRangeMode = "month"; // month | 3m | 6m | 12m | total

/* =========================
   軽量化キャッシュ
========================= */
let cachedStores = null;
let cachedLogs = null;
let cachedMonthData = new Map();
let cachedTotalData = null;

/* =========================
   カレンダー記録追加用
========================= */
let reportRecordDayStr = "";
let reportRecordStoreId = "";
let reportRecordVisit = true;
let reportRecordSuccess = true;
let reportRecordStoreKeyword = "";

/* =========================
   個数・カテゴリ・利益モーダル用
========================= */
let reportQtyModalResolver = null;
let reportQtyCurrentQty = 1;
let reportQtySelectedCategories = {};
let reportQtyProfit = 0;
let reportQtyCategoryHistory = [];

/* =========================
   共通
========================= */
function readFirstAvailable(keys) {
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      return JSON.parse(raw);
    } catch (e) {
      console.error("read error:", key, e);
    }
  }
  return null;
}

function saveLogs(logs) {
  const json = JSON.stringify(Array.isArray(logs) ? logs : []);
  LOG_KEYS.forEach(key => {
    try {
      localStorage.setItem(key, json);
    } catch (e) {
      console.error("save error:", key, e);
    }
  });
}

function saveStores(stores) {
  const json = JSON.stringify(Array.isArray(stores) ? stores : []);
  STORE_KEYS.forEach(key => {
    try {
      localStorage.setItem(key, json);
    } catch (e) {
      console.error("save store error:", key, e);
    }
  });
}

function saveReportData(stores, logs) {
  saveStores(stores);
  saveLogs(logs);
  invalidateReportCache();
}

function loadStores() {
  if (cachedStores) return cachedStores;
  const parsed = readFirstAvailable(STORE_KEYS);
  cachedStores = Array.isArray(parsed) ? parsed : [];
  return cachedStores;
}

function loadLogs() {
  if (cachedLogs) return cachedLogs;
  const parsed = readFirstAvailable(LOG_KEYS);
  cachedLogs = Array.isArray(parsed) ? parsed : [];
  return cachedLogs;
}

function invalidateReportCache() {
  cachedStores = null;
  cachedLogs = null;
  cachedMonthData.clear();
  cachedTotalData = null;
}

window.addEventListener("storage", () => {
  invalidateReportCache();
  bootReport();
});

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeJsString(str) {
  return String(str || "")
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "");
}

function yen(n) {
  return `${Number(n || 0).toLocaleString()}円`;
}

function shortMoney(n) {
  return String(Number(n || 0));
}

function safeDivide(a, b) {
  const x = Number(a || 0);
  const y = Number(b || 0);
  return y > 0 ? x / y : 0;
}

function ym(dateStr) {
  return String(dateStr || "").slice(0, 7);
}

function ymd(dateStr) {
  return String(dateStr || "").slice(0, 10);
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function currentMonthStr() {
  return todayStr().slice(0, 7);
}

function shiftMonth(monthStr, offset) {
  const [y, m] = String(monthStr || currentMonthStr()).split("-").map(Number);
  const d = new Date(y, (m - 1) + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthsInRange(endMonth, count) {
  const months = [];
  for (let i = count - 1; i >= 0; i--) {
    months.push(shiftMonth(endMonth, -i));
  }
  return months;
}

function getStoreMap(stores) {
  const map = {};
  stores.forEach(s => {
    map[String(s.id || "")] = s;
  });
  return map;
}

function getAvailableMonths(logs) {
  const months = [...new Set(logs.map(l => ym(l.date)).filter(Boolean))]
    .sort()
    .reverse();

  if (!months.length) return [currentMonthStr()];
  if (!months.includes(currentMonthStr())) months.unshift(currentMonthStr());

  return [...new Set(months)];
}

function ensureLogId() {
  return `log_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeLog(log) {
  return {
    id: String(log?.id || ensureLogId()),
    storeId: String(log?.storeId || ""),
    type: String(log?.type || ""),
    delta: Number(log?.delta || 0),
    date: String(log?.date || ""),
    category: String(log?.category || ""),
    note: String(log?.note || "")
  };
}

function maxDateStr(a, b) {
  const aa = String(a || "").slice(0, 10);
  const bb = String(b || "").slice(0, 10);

  if (!aa) return bb;
  if (!bb) return aa;

  return aa >= bb ? aa : bb;
}

function clampReportNonNeg(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

function sumReportCategoryMap(map) {
  return Object.values(map || {}).reduce((sum, v) => sum + Number(v || 0), 0);
}

/* =========================
   記録追加：店舗選択モーダル
========================= */
function getReportRecordStore() {
  const stores = loadStores();
  return stores.find(s => String(s.id || "") === String(reportRecordStoreId || ""));
}

function getReportRecordStoreCandidates() {
  const stores = loadStores();
  const q = String(reportRecordStoreKeyword || "").trim().toLowerCase();

  return stores
    .filter(s => {
      if (!q) return true;

      const text = [
        s.name,
        s.pref,
        s.address
      ].map(x => String(x || "").toLowerCase()).join(" ");

      return text.includes(q);
    })
    .slice(0, 80);
}

function ensureReportRecordModal() {
  if (document.getElementById("reportRecordModal")) return;

  const modal = document.createElement("div");
  modal.id = "reportRecordModal";
  modal.className = "qtyCategoryModal";
  modal.innerHTML = `
    <div class="qtyCategoryCard reportRecordCard">
      <div class="qtyCategoryTitle" id="reportRecordTitle">記録追加</div>
      <div class="qtyCategorySub">
        店舗を選んで、訪問・成功を設定してから個数・カテゴリ・利益を入力します。
      </div>

      <div class="qtyCategorySectionTitle">店舗を選択</div>

      <input
        id="reportRecordStoreSearch"
        class="categoryTextInput"
        type="text"
        placeholder="店舗名 / 都道府県 / 住所で検索"
        oninput="setReportRecordStoreKeyword(this.value)"
      >

      <div class="mt8">
        <select id="reportRecordStoreSelect" onchange="selectReportRecordStore(this.value)"></select>
      </div>

      <div id="reportRecordStoreInfo" class="qtySelectedBox" style="margin-top:10px;">
        店舗を選択してください
      </div>

      <div class="qtyCategorySectionTitle">記録内容</div>

      <div class="row2">
        <button type="button" id="reportRecordVisitBtn" class="primaryBtn" onclick="toggleReportRecordVisit()">
          訪問 +1
        </button>
        <button type="button" id="reportRecordSuccessBtn" class="primaryBtn" onclick="toggleReportRecordSuccess()">
          成功 +1
        </button>
      </div>

      <div class="categoryPickerActions">
        <button type="button" class="ghostBtn" onclick="closeReportRecordModal()">キャンセル</button>
        <button type="button" class="primaryBtn" onclick="openReportQtyFromRecord()">
          個数・カテゴリ・利益を入力
        </button>
      </div>

      <div class="mt8">
        <button type="button" class="ghostBtn" style="width:100%;" onclick="saveVisitOnlyReportRecord()">
          仕入れなしで訪問のみ保存
        </button>
      </div>
    </div>
  `;

  modal.addEventListener("click", e => {
    if (e.target === modal) closeReportRecordModal();
  });

  document.body.appendChild(modal);
}

function openAddDayRecord(dayStr) {
  const stores = loadStores();

  if (!stores.length) {
    alert("店舗が登録されていません。");
    return;
  }

  ensureReportRecordModal();

  reportRecordDayStr = dayStr;
  reportRecordStoreKeyword = "";
  reportRecordStoreId = String(stores[0]?.id || "");
  reportRecordVisit = true;
  reportRecordSuccess = true;

  const titleEl = document.getElementById("reportRecordTitle");
  const searchEl = document.getElementById("reportRecordStoreSearch");

  if (titleEl) titleEl.textContent = `${dayStr} に記録追加`;
  if (searchEl) searchEl.value = "";

  renderReportRecordModal();

  const modal = document.getElementById("reportRecordModal");
  if (modal) modal.classList.add("show");
}

function closeReportRecordModal() {
  const modal = document.getElementById("reportRecordModal");
  if (modal) modal.classList.remove("show");
}

function setReportRecordStoreKeyword(value) {
  reportRecordStoreKeyword = String(value || "");

  const candidates = getReportRecordStoreCandidates();
  if (!candidates.some(s => String(s.id || "") === String(reportRecordStoreId || ""))) {
    reportRecordStoreId = String(candidates[0]?.id || "");
  }

  renderReportRecordStoreSelect();
  renderReportRecordStoreInfo();
}

function selectReportRecordStore(storeId) {
  reportRecordStoreId = String(storeId || "");
  renderReportRecordStoreInfo();
}

function renderReportRecordModal() {
  renderReportRecordStoreSelect();
  renderReportRecordStoreInfo();
  renderReportRecordToggleButtons();
}

function renderReportRecordStoreSelect() {
  const select = document.getElementById("reportRecordStoreSelect");
  if (!select) return;

  const candidates = getReportRecordStoreCandidates();

  if (!candidates.length) {
    select.innerHTML = `<option value="">該当する店舗がありません</option>`;
    reportRecordStoreId = "";
    return;
  }

  if (!reportRecordStoreId) {
    reportRecordStoreId = String(candidates[0].id || "");
  }

  select.innerHTML = candidates.map(s => {
    const label = `${s.name || "店舗名なし"}${s.pref ? `（${s.pref}）` : ""}`;
    return `<option value="${escapeHtml(s.id)}">${escapeHtml(label)}</option>`;
  }).join("");

  if (candidates.some(s => String(s.id || "") === String(reportRecordStoreId || ""))) {
    select.value = reportRecordStoreId;
  } else {
    reportRecordStoreId = String(candidates[0].id || "");
    select.value = reportRecordStoreId;
  }
}

function renderReportRecordStoreInfo() {
  const el = document.getElementById("reportRecordStoreInfo");
  if (!el) return;

  const store = getReportRecordStore();

  if (!store) {
    el.innerHTML = `店舗を選択してください`;
    return;
  }

  el.innerHTML = `
    <div style="font-weight:800;">${escapeHtml(store.name || "店舗名なし")}</div>
    <div class="mini" style="margin-top:4px;">
      ${escapeHtml(store.pref || "都道府県なし")}
      ${store.address ? ` / ${escapeHtml(store.address)}` : ""}
    </div>
  `;
}

function toggleReportRecordVisit() {
  reportRecordVisit = !reportRecordVisit;

  if (!reportRecordVisit && reportRecordSuccess) {
    reportRecordSuccess = false;
  }

  renderReportRecordToggleButtons();
}

function toggleReportRecordSuccess() {
  reportRecordSuccess = !reportRecordSuccess;

  if (reportRecordSuccess) {
    reportRecordVisit = true;
  }

  renderReportRecordToggleButtons();
}

function renderReportRecordToggleButtons() {
  const visitBtn = document.getElementById("reportRecordVisitBtn");
  const successBtn = document.getElementById("reportRecordSuccessBtn");

  if (visitBtn) {
    visitBtn.className = reportRecordVisit ? "primaryBtn" : "ghostBtn";
    visitBtn.textContent = reportRecordVisit ? "訪問 +1" : "訪問なし";
  }

  if (successBtn) {
    successBtn.className = reportRecordSuccess ? "primaryBtn" : "ghostBtn";
    successBtn.textContent = reportRecordSuccess ? "成功 +1" : "成功なし";
  }
}

function saveVisitOnlyReportRecord() {
  const store = getReportRecordStore();

  if (!store) {
    alert("店舗を選択してください。");
    return;
  }

  if (!reportRecordVisit && !reportRecordSuccess) {
    alert("追加する内容がありません。");
    return;
  }

  const ok = confirm(
    [
      `${reportRecordDayStr} に記録を追加します。`,
      "",
      `店舗：${store.name || "店舗名なし"}`,
      `訪問：${reportRecordVisit ? "+1" : "なし"}`,
      `成功：${reportRecordSuccess ? "+1" : "なし"}`,
      `個数：0個`,
      `利益：0円`,
      "",
      "この内容で保存しますか？"
    ].join("\n")
  );

  if (!ok) return;

  const saved = addCalendarRecordToStoreAndLogs(reportRecordDayStr, {
    storeId: store.id,
    visit: reportRecordVisit,
    success: reportRecordSuccess,
    items: 0,
    profit: 0,
    categoryMap: {}
  });

  if (!saved) return;

  closeReportRecordModal();
  alert("記録を追加しました。店舗カードにも反映されます。");

  bootReport();
  showDayDetail(reportRecordDayStr);
}

/* =========================
   画像仕様：個数・カテゴリ・利益モーダル
========================= */
function getReportCategoryHistory(store = null) {
  const stores = loadStores();
  const logs = loadLogs();
  const set = new Set();

  if (store?.defaultCategory) {
    const name = String(store.defaultCategory).trim();
    if (name) set.add(name);
  }

  Object.keys(store?.categoryCounts || {}).forEach(cat => {
    const name = String(cat || "").trim();
    if (name) set.add(name);
  });

  stores.forEach(s => {
    if (s.defaultCategory) {
      const name = String(s.defaultCategory).trim();
      if (name) set.add(name);
    }

    Object.keys(s.categoryCounts || {}).forEach(cat => {
      const name = String(cat || "").trim();
      if (name) set.add(name);
    });
  });

  logs.forEach(log => {
    if (log.type !== "category") return;
    const name = String(log.category || "").trim();
    if (name) set.add(name);
  });

  if (!set.size) set.add("未分類");

  return [...set].filter(Boolean).slice(0, 30);
}

function ensureReportQtyModal() {
  if (document.getElementById("reportQtyModal")) return;

  const modal = document.createElement("div");
  modal.id = "reportQtyModal";
  modal.className = "qtyCategoryModal";
  modal.innerHTML = `
    <div class="qtyCategoryCard reportQtyCard">
      <div class="qtyCategoryTitle">個数・カテゴリ・利益を入力</div>
      <div class="qtyCategorySub">
        合計個数、カテゴリごとの個数、利益をまとめて入力できます
      </div>

      <div class="qtyCategorySectionTitle">合計個数を選択</div>
      <div class="qtyQuickButtons">
        <button type="button" class="qtyQuickBtn reportQtyQuickBtn" data-qty="1" onclick="selectReportQuickQty(1)">1</button>
        <button type="button" class="qtyQuickBtn reportQtyQuickBtn" data-qty="2" onclick="selectReportQuickQty(2)">2</button>
        <button type="button" class="qtyQuickBtn reportQtyQuickBtn" data-qty="3" onclick="selectReportQuickQty(3)">3</button>
        <button type="button" class="qtyQuickBtn reportQtyQuickBtn" data-qty="4" onclick="selectReportQuickQty(4)">4</button>
        <button type="button" class="qtyQuickBtn reportQtyQuickBtn" data-qty="5" onclick="selectReportQuickQty(5)">5</button>
      </div>

      <div class="qtyManualRow">
        <input
          id="reportQtyManualInput"
          class="qtyManualInput"
          type="number"
          min="1"
          step="1"
          placeholder="5以上はここに入力"
        >
        <button type="button" class="qtyManualBtn" onclick="applyReportManualQty()">手入力反映</button>
      </div>

      <div class="qtySelectedBox">
        合計個数: <span id="reportQtySelectedValue">1</span>個
      </div>

      <div class="qtyCategorySectionTitle">履歴カテゴリ</div>
      <div id="reportQtyCategoryChipWrap" class="categoryChipWrap"></div>

      <div class="qtyCategorySectionTitle">新しいカテゴリを追加</div>
      <div class="categoryAddRow">
        <input id="reportQtyNewCategoryInput" class="categoryTextInput" placeholder="新しいカテゴリ名を入力">
        <button type="button" class="categoryAddBtn" onclick="addNewReportQtyCategoryChip()">追加</button>
      </div>

      <div class="qtyCategorySectionTitle">カテゴリごとの個数</div>
      <div id="reportQtyCategoryCountEditor" class="qtyCategoryCountEditor">
        <div class="qtyCategoryEmpty">カテゴリを選択してください</div>
      </div>

      <div class="qtyRemainPanel" id="reportQtyRemainPanel">
        <div class="qtyRemainLabel">残り</div>
        <div class="qtyRemainValue" id="reportQtyRemainValue">1</div>
        <div class="qtyRemainUnit">個</div>
      </div>

      <div class="qtySelectedBox qtyCategoryTotalCheck" id="reportQtyCategoryTotalCheck">
        入力合計: <span id="reportQtyAssignedTotal">0</span> / <span id="reportQtyAssignedTarget">1</span>個
      </div>

      <div class="qtyCategorySectionTitle">利益入力</div>

      <div class="qtyQuickButtons">
        <button type="button" class="qtyQuickBtn profitQuickBtn" onclick="addReportQuickProfit(1000)">1000</button>
        <button type="button" class="qtyQuickBtn profitQuickBtn" onclick="addReportQuickProfit(3000)">3000</button>
        <button type="button" class="qtyQuickBtn profitQuickBtn" onclick="addReportQuickProfit(5000)">5000</button>
        <button type="button" class="qtyQuickBtn profitQuickBtn" onclick="addReportQuickProfit(10000)">10000</button>
      </div>

      <div class="qtyManualRow">
        <input
          id="reportQtyProfitInput"
          class="qtyManualInput"
          type="number"
          min="0"
          step="100"
          value="0"
          placeholder="利益を入力"
          oninput="syncReportProfitInput()"
        >
        <button type="button" class="qtyManualBtn" onclick="applyReportManualProfit()">利益反映</button>
      </div>

      <div class="qtySelectedBox">
        利益: <span id="reportQtyProfitValue">0</span>円
      </div>

      <div class="categoryPickerActions">
        <button type="button" class="ghostBtn" onclick="closeReportQtyModal(null)">キャンセル</button>
        <button type="button" class="primaryBtn" onclick="confirmReportQtyModal()">OK</button>
      </div>
    </div>
  `;

  modal.addEventListener("click", e => {
    if (e.target === modal) closeReportQtyModal(null);
  });

  document.body.appendChild(modal);
}

function openReportQtyFromRecord() {
  const store = getReportRecordStore();

  if (!store) {
    alert("店舗を選択してください。");
    return;
  }

  openReportQtyModal({
    store
  }).then(result => {
    if (!result) return;

    saveReportRecordWithQty(result);
  });
}

function openReportQtyModal({ store = null } = {}) {
  ensureReportQtyModal();

  reportQtyCurrentQty = 1;
  reportQtyProfit = 0;
  reportQtySelectedCategories = {};
  reportQtyCategoryHistory = getReportCategoryHistory(store);

  const defaultCat = String(store?.defaultCategory || reportQtyCategoryHistory[0] || "未分類").trim() || "未分類";

  if (!reportQtyCategoryHistory.includes(defaultCat)) {
    reportQtyCategoryHistory.unshift(defaultCat);
  }

  reportQtySelectedCategories[defaultCat] = 1;

  const manualInput = document.getElementById("reportQtyManualInput");
  const newCategoryInput = document.getElementById("reportQtyNewCategoryInput");
  const profitInput = document.getElementById("reportQtyProfitInput");

  if (manualInput) manualInput.value = "";
  if (newCategoryInput) newCategoryInput.value = "";
  if (profitInput) profitInput.value = "0";

  updateReportQtySelectedValue();
  renderReportQtyQuickButtons();
  renderReportQtyCategoryChips();
  renderReportQtyCategoryCountEditor();
  updateReportQtyAssignedSummary();
  updateReportProfitView();

  const modal = document.getElementById("reportQtyModal");
  if (modal) modal.classList.add("show");

  return new Promise(resolve => {
    reportQtyModalResolver = resolve;
  });
}

function selectReportQuickQty(n) {
  const nextQty = Math.max(1, Number(n || 1));
  reportQtyCurrentQty = nextQty;

  const keys = Object.keys(reportQtySelectedCategories || {});
  if (keys.length === 1) {
    reportQtySelectedCategories[keys[0]] = nextQty;
  }

  updateReportQtySelectedValue();
  renderReportQtyQuickButtons();
  renderReportQtyCategoryCountEditor();
  updateReportQtyAssignedSummary();
}

function applyReportManualQty() {
  const input = document.getElementById("reportQtyManualInput");
  if (!input) return;

  const n = Math.max(0, parseInt(input.value || "0", 10));
  if (!n) {
    alert("1以上の個数を入力してください。");
    return;
  }

  reportQtyCurrentQty = n;

  const keys = Object.keys(reportQtySelectedCategories || {});
  if (keys.length === 1) {
    reportQtySelectedCategories[keys[0]] = n;
  }

  updateReportQtySelectedValue();
  renderReportQtyQuickButtons();
  renderReportQtyCategoryCountEditor();
  updateReportQtyAssignedSummary();
}

function updateReportQtySelectedValue() {
  const valueEl = document.getElementById("reportQtySelectedValue");
  const targetEl = document.getElementById("reportQtyAssignedTarget");

  if (valueEl) valueEl.textContent = String(reportQtyCurrentQty);
  if (targetEl) targetEl.textContent = String(reportQtyCurrentQty);
}

function renderReportQtyQuickButtons() {
  document.querySelectorAll(".reportQtyQuickBtn").forEach(btn => {
    const n = Number(btn.getAttribute("data-qty") || "0");
    btn.classList.toggle("active", n === reportQtyCurrentQty);
  });
}

function renderReportQtyCategoryChips() {
  const wrap = document.getElementById("reportQtyCategoryChipWrap");
  if (!wrap) return;

  wrap.innerHTML = reportQtyCategoryHistory.map(cat => {
    const active = !!reportQtySelectedCategories[cat];
    return `
      <button
        type="button"
        class="categoryChip ${active ? "active" : ""}"
        onclick="toggleReportQtyCategoryChip('${escapeJsString(cat)}')"
      >
        ${escapeHtml(cat)}
      </button>
    `;
  }).join("");
}

function toggleReportQtyCategoryChip(cat) {
  const name = String(cat || "").trim();
  if (!name) return;

  if (reportQtySelectedCategories[name]) {
    delete reportQtySelectedCategories[name];
  } else {
    const currentTotal = sumReportCategoryMap(reportQtySelectedCategories);
    const remain = Math.max(0, reportQtyCurrentQty - currentTotal);
    reportQtySelectedCategories[name] = remain > 0 ? remain : 1;
  }

  renderReportQtyCategoryChips();
  renderReportQtyCategoryCountEditor();
  updateReportQtyAssignedSummary();
}

function addNewReportQtyCategoryChip() {
  const input = document.getElementById("reportQtyNewCategoryInput");
  if (!input) return;

  const cat = String(input.value || "").trim();
  if (!cat) return;

  if (!reportQtyCategoryHistory.includes(cat)) {
    reportQtyCategoryHistory.unshift(cat);
  }

  const currentTotal = sumReportCategoryMap(reportQtySelectedCategories);
  const remain = Math.max(0, reportQtyCurrentQty - currentTotal);
  reportQtySelectedCategories[cat] = remain > 0 ? remain : 1;

  input.value = "";

  renderReportQtyCategoryChips();
  renderReportQtyCategoryCountEditor();
  updateReportQtyAssignedSummary();
}

function renderReportQtyCategoryCountEditor() {
  const wrap = document.getElementById("reportQtyCategoryCountEditor");
  if (!wrap) return;

  const keys = Object.keys(reportQtySelectedCategories || {});

  if (!keys.length) {
    wrap.innerHTML = `<div class="qtyCategoryEmpty">カテゴリを選択してください</div>`;
    return;
  }

  wrap.innerHTML = keys.map(cat => {
    const value = Math.max(0, Number(reportQtySelectedCategories[cat] || 0));

    return `
      <div class="qtyCategoryCountRow">
        <div class="qtyCategoryCountName">${escapeHtml(cat)}</div>
        <div class="qtyStepper">
          <button type="button" class="qtyStepBtn minus" onclick="changeReportQtyCategoryCount('${escapeJsString(cat)}', -1)">−</button>
          <div class="qtyStepValue">${value}</div>
          <button type="button" class="qtyStepBtn plus" onclick="changeReportQtyCategoryCount('${escapeJsString(cat)}', 1)">＋</button>
        </div>
      </div>
    `;
  }).join("");
}

function changeReportQtyCategoryCount(cat, delta) {
  const name = String(cat || "").trim();
  if (!name || !reportQtySelectedCategories[name]) return;

  const current = Math.max(0, Number(reportQtySelectedCategories[name] || 0));
  const next = Math.max(0, current + Number(delta || 0));

  if (next <= 0) {
    delete reportQtySelectedCategories[name];
  } else {
    reportQtySelectedCategories[name] = next;
  }

  renderReportQtyCategoryChips();
  renderReportQtyCategoryCountEditor();
  updateReportQtyAssignedSummary();
}

function updateReportQtyAssignedSummary() {
  const total = sumReportCategoryMap(reportQtySelectedCategories);
  const remain = reportQtyCurrentQty - total;

  const totalEl = document.getElementById("reportQtyAssignedTotal");
  const remainValueEl = document.getElementById("reportQtyRemainValue");
  const remainPanelEl = document.getElementById("reportQtyRemainPanel");
  const totalCheckEl = document.getElementById("reportQtyCategoryTotalCheck");

  if (totalEl) totalEl.textContent = String(total);
  if (remainValueEl) remainValueEl.textContent = String(remain);

  if (remainPanelEl) {
    remainPanelEl.classList.remove("is-ok", "is-over", "is-under");
    if (remain === 0) remainPanelEl.classList.add("is-ok");
    else if (remain < 0) remainPanelEl.classList.add("is-over");
    else remainPanelEl.classList.add("is-under");
  }

  if (totalCheckEl) {
    totalCheckEl.classList.remove("is-ok", "is-over", "is-under");
    if (remain === 0) totalCheckEl.classList.add("is-ok");
    else if (remain < 0) totalCheckEl.classList.add("is-over");
    else totalCheckEl.classList.add("is-under");
  }
}

function addReportQuickProfit(amount) {
  reportQtyProfit += Math.max(0, Number(amount || 0));

  const input = document.getElementById("reportQtyProfitInput");
  if (input) input.value = String(reportQtyProfit);

  updateReportProfitView();
}

function syncReportProfitInput() {
  const input = document.getElementById("reportQtyProfitInput");
  if (!input) return;

  reportQtyProfit = Math.max(0, parseInt(input.value || "0", 10));
  updateReportProfitView();
}

function applyReportManualProfit() {
  const input = document.getElementById("reportQtyProfitInput");
  if (!input) return;

  reportQtyProfit = Math.max(0, parseInt(input.value || "0", 10));
  input.value = String(reportQtyProfit);
  updateReportProfitView();
}

function updateReportProfitView() {
  const valueEl = document.getElementById("reportQtyProfitValue");
  if (valueEl) valueEl.textContent = reportQtyProfit.toLocaleString();
}

function confirmReportQtyModal() {
  const keys = Object.keys(reportQtySelectedCategories || {});

  if (!reportQtyCurrentQty || reportQtyCurrentQty < 1) {
    alert("合計個数を選択してください。");
    return;
  }

  if (!keys.length) {
    alert("カテゴリを1つ以上選択してください。");
    return;
  }

  const resultMap = {};
  keys.forEach(cat => {
    const name = String(cat || "").trim();
    const qty = Math.max(0, Number(reportQtySelectedCategories[cat] || 0));
    if (name && qty > 0) {
      resultMap[name] = qty;
    }
  });

  const total = sumReportCategoryMap(resultMap);

  if (total !== reportQtyCurrentQty) {
    alert(`カテゴリ個数の合計(${total})と合計個数(${reportQtyCurrentQty})を一致させてください。`);
    return;
  }

  closeReportQtyModal({
    qty: reportQtyCurrentQty,
    categoryMap: resultMap,
    profit: Math.max(0, Number(reportQtyProfit || 0))
  });
}

function closeReportQtyModal(result) {
  const modal = document.getElementById("reportQtyModal");
  if (modal) modal.classList.remove("show");

  if (reportQtyModalResolver) {
    reportQtyModalResolver(result);
    reportQtyModalResolver = null;
  }
}

function saveReportRecordWithQty(result) {
  const store = getReportRecordStore();

  if (!store) {
    alert("店舗を選択してください。");
    return;
  }

  const items = Math.max(0, Number(result?.qty || 0));
  const profit = Math.max(0, Number(result?.profit || 0));
  const categoryMap = result?.categoryMap || {};

  if (items <= 0) {
    alert("個数を1以上で入力してください。");
    return;
  }

  if (reportRecordSuccess && !reportRecordVisit) {
    reportRecordVisit = true;
  }

  const categoryText = Object.keys(categoryMap).length
    ? Object.entries(categoryMap).map(([cat, qty]) => `${cat}:${qty}`).join(" / ")
    : "なし";

  const ok = confirm(
    [
      `${reportRecordDayStr} に記録を追加します。`,
      "",
      `店舗：${store.name || "店舗名なし"}`,
      `訪問：${reportRecordVisit ? "+1" : "なし"}`,
      `成功：${reportRecordSuccess ? "+1" : "なし"}`,
      `個数：${items}個`,
      `カテゴリ：${categoryText}`,
      `利益：${yen(profit)}`,
      "",
      "この内容で保存しますか？"
    ].join("\n")
  );

  if (!ok) return;

  const saved = addCalendarRecordToStoreAndLogs(reportRecordDayStr, {
    storeId: store.id,
    visit: reportRecordVisit,
    success: reportRecordSuccess,
    items,
    profit,
    categoryMap
  });

  if (!saved) return;

  closeReportRecordModal();

  alert("記録を追加しました。店舗カードにも反映されます。");

  bootReport();
  showDayDetail(reportRecordDayStr);
}

/* =========================
   カレンダーから記録追加・削除
========================= */
function addCalendarRecordToStoreAndLogs(dayStr, payload) {
  const stores = loadStores();
  const logs = loadLogs();

  const storeId = String(payload.storeId || "");
  const store = stores.find(s => String(s.id || "") === storeId);

  if (!store) {
    alert("店舗が見つかりませんでした。");
    return false;
  }

  const visit = !!payload.visit;
  const success = !!payload.success;
  const items = Math.max(0, Number(payload.items || 0));
  const profit = Math.max(0, Number(payload.profit || 0));
  const categoryMap = payload.categoryMap || {};
  const note = "カレンダーから追加";

  if (visit) {
    logs.push(normalizeLog({
      id: ensureLogId(),
      storeId,
      type: "visit",
      delta: 1,
      date: dayStr,
      note
    }));

    store.visits = Number(store.visits || 0) + 1;
  }

  if (success) {
    logs.push(normalizeLog({
      id: ensureLogId(),
      storeId,
      type: "success",
      delta: 1,
      date: dayStr,
      note
    }));

    store.buyDays = Number(store.buyDays || 0) + 1;

    if (Number(store.buyDays || 0) > Number(store.visits || 0)) {
      store.visits = Number(store.buyDays || 0);
    }
  }

  if (items > 0) {
    logs.push(normalizeLog({
      id: ensureLogId(),
      storeId,
      type: "items",
      delta: items,
      date: dayStr,
      note
    }));

    store.items = Number(store.items || 0) + items;

    if (!store.categoryCounts || typeof store.categoryCounts !== "object") {
      store.categoryCounts = {};
    }

    Object.entries(categoryMap).forEach(([cat, qty]) => {
      const name = String(cat || "").trim();
      const n = Number(qty || 0);
      if (!name || n <= 0) return;

      logs.push(normalizeLog({
        id: ensureLogId(),
        storeId,
        type: "category",
        delta: n,
        date: dayStr,
        category: name,
        note
      }));

      store.categoryCounts[name] = Number(store.categoryCounts[name] || 0) + n;
    });

    const firstCategory = Object.keys(categoryMap)[0];
    if (firstCategory) {
      store.defaultCategory = firstCategory;
    }
  }

  if (profit > 0) {
    logs.push(normalizeLog({
      id: ensureLogId(),
      storeId,
      type: "profit",
      delta: profit,
      date: dayStr,
      note
    }));

    store.profit = Number(store.profit || 0) + profit;
  }

  if (visit || success || items > 0 || profit > 0) {
    store.lastVisitDate = maxDateStr(store.lastVisitDate, dayStr);
  }

  saveReportData(stores, logs);
  return true;
}

function recalcStoreLastVisitDate(store) {
  if (!store?.id) return;

  const logs = loadLogs();
  const storeId = String(store.id || "");

  const visitDates = logs
    .filter(log => String(log.storeId || "") === storeId)
    .filter(log => log.type === "visit" || log.type === "success" || log.type === "items")
    .map(log => ymd(log.date))
    .filter(Boolean)
    .sort();

  store.lastVisitDate = visitDates.length ? visitDates[visitDates.length - 1] : "";
}

function subtractStoreValuesFromLogs(store, targetLogs) {
  if (!store || !Array.isArray(targetLogs)) return;

  targetLogs.forEach(log => {
    const delta = Number(log.delta || 0);

    if (log.type === "visit") {
      store.visits = Math.max(0, Number(store.visits || 0) - delta);
    }

    if (log.type === "success") {
      store.buyDays = Math.max(0, Number(store.buyDays || 0) - delta);
    }

    if (log.type === "items") {
      store.items = Math.max(0, Number(store.items || 0) - delta);
    }

    if (log.type === "profit" || log.type === "profit_adjust") {
      store.profit = Math.max(0, Number(store.profit || 0) - delta);
    }

    if (log.type === "category" && log.category) {
      const cat = String(log.category || "").trim();
      if (!cat) return;

      if (!store.categoryCounts || typeof store.categoryCounts !== "object") {
        store.categoryCounts = {};
      }

      const current = Number(store.categoryCounts[cat] || 0);
      const next = Math.max(0, current - delta);

      if (next <= 0) {
        delete store.categoryCounts[cat];
      } else {
        store.categoryCounts[cat] = next;
      }
    }
  });

  if (Number(store.buyDays || 0) > Number(store.visits || 0)) {
    store.visits = Number(store.buyDays || 0);
  }
}

function deleteStoreDayRecords(dayStr, storeId) {
  const stores = loadStores();
  const logs = loadLogs();

  const targetStoreId = String(storeId || "");
  const store = stores.find(s => String(s.id || "") === targetStoreId);

  if (!store) {
    alert("店舗が見つかりませんでした。");
    return;
  }

  const removableTypes = ["visit", "success", "items", "category", "profit", "profit_adjust"];

  const targetLogs = logs.filter(log =>
    ymd(log.date) === dayStr &&
    String(log.storeId || "") === targetStoreId &&
    removableTypes.includes(log.type)
  );

  if (!targetLogs.length) {
    alert("削除できる記録がありません。");
    return;
  }

  const summary = targetLogs.reduce((acc, log) => {
    const delta = Number(log.delta || 0);

    if (log.type === "visit") acc.visits += delta;
    if (log.type === "success") acc.success += delta;
    if (log.type === "items") acc.items += delta;
    if (log.type === "profit" || log.type === "profit_adjust") acc.profit += delta;

    if (log.type === "category" && log.category) {
      const cat = String(log.category || "").trim();
      if (cat) {
        acc.categories[cat] = (acc.categories[cat] || 0) + delta;
      }
    }

    return acc;
  }, {
    visits: 0,
    success: 0,
    items: 0,
    profit: 0,
    categories: {}
  });

  const categoryText = Object.entries(summary.categories)
    .filter(([, qty]) => Number(qty) > 0)
    .map(([cat, qty]) => `${cat}:${qty}`)
    .join(" / ") || "なし";

  const ok = confirm(
    [
      `${dayStr} の記録を削除します。`,
      "",
      `店舗：${store.name || "店舗名なし"}`,
      `訪問：${summary.visits}回`,
      `成功：${summary.success}回`,
      `個数：${summary.items}個`,
      `カテゴリ：${categoryText}`,
      `利益：${yen(summary.profit)}`,
      "",
      "この日のこの店舗の記録をまとめて削除します。",
      "店舗カードの数字にも反映されます。",
      "",
      "よろしいですか？"
    ].join("\n")
  );

  if (!ok) return;

  const targetLogIds = new Set(targetLogs.map(log => String(log.id || "")));

  const nextLogs = logs.filter(log => {
    const id = String(log.id || "");

    if (id && targetLogIds.has(id)) {
      return false;
    }

    return !(
      ymd(log.date) === dayStr &&
      String(log.storeId || "") === targetStoreId &&
      removableTypes.includes(log.type)
    );
  });

  subtractStoreValuesFromLogs(store, targetLogs);
  saveLogs(nextLogs);
  invalidateReportCache();
  recalcStoreLastVisitDate(store);
  saveReportData(stores, nextLogs);

  alert("この日の記録を削除しました。店舗カードにも反映されます。");

  bootReport();
  showDayDetail(dayStr);
}

/* =========================
   月・期間選択
========================= */
function renderMonthPicker(logs) {
  const selectEl = document.getElementById("monthPicker");
  const rangeWrap = document.getElementById("reportRangeButtons");
  const currentMonthBtn = document.getElementById("goCurrentMonthBtn");
  if (!selectEl) return;

  const months = getAvailableMonths(logs);
  if (!selectedMonth) selectedMonth = months[0] || currentMonthStr();

  selectEl.innerHTML = months
    .map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
    .join("");

  selectEl.value = selectedMonth;

  if (currentMonthBtn) {
    const isCurrentMonth = selectedMonth === currentMonthStr() && selectedRangeMode === "month";
    currentMonthBtn.className = isCurrentMonth ? "primaryBtn" : "ghostBtn";
  }

  if (rangeWrap) {
    rangeWrap.innerHTML = `
      <button class="${selectedRangeMode === "3m" ? "primaryBtn" : "ghostBtn"}" onclick="changeReportRange('3m')">3か月</button>
      <button class="${selectedRangeMode === "6m" ? "primaryBtn" : "ghostBtn"}" onclick="changeReportRange('6m')">半年</button>
      <button class="${selectedRangeMode === "12m" ? "primaryBtn" : "ghostBtn"}" onclick="changeReportRange('12m')">1年</button>
      <button class="${selectedRangeMode === "total" ? "primaryBtn" : "ghostBtn"}" onclick="changeReportRange('total')">トータル</button>
    `;
  }
}

function changeReportMonth(month) {
  selectedMonth = month;
  selectedDay = null;
  selectedRangeMode = "month";
  bootReport();
}

function goCurrentMonth() {
  selectedMonth = currentMonthStr();
  selectedDay = null;
  selectedRangeMode = "month";
  bootReport();
}

function changeReportRange(mode) {
  const allowed = ["month", "3m", "6m", "12m", "total"];
  selectedRangeMode = allowed.includes(mode) ? mode : "month";
  selectedDay = null;
  bootReport();
}

function getRangeLabel(mode, baseMonth) {
  if (mode === "3m") return `直近3か月（〜${baseMonth}）`;
  if (mode === "6m") return `直近6か月（〜${baseMonth}）`;
  if (mode === "12m") return `直近1年（〜${baseMonth}）`;
  if (mode === "total") return "トータル";
  return baseMonth;
}

/* =========================
   利益修正ログ
========================= */
function getBaseStoreDayProfit(dayStr, storeId, logs) {
  return (logs || []).reduce((sum, log) => {
    if (ymd(log.date) !== dayStr) return sum;
    if (String(log.storeId || "") !== String(storeId)) return sum;
    if (log.type !== "profit") return sum;
    return sum + Number(log.delta || 0);
  }, 0);
}

function getAdjustStoreDayProfit(dayStr, storeId, logs) {
  return (logs || []).reduce((sum, log) => {
    if (ymd(log.date) !== dayStr) return sum;
    if (String(log.storeId || "") !== String(storeId)) return sum;
    if (log.type !== "profit_adjust") return sum;
    return sum + Number(log.delta || 0);
  }, 0);
}

function saveStoreDayProfitCorrection(dayStr, storeId, nextProfit) {
  const stores = loadStores();
  const logs = loadLogs();
  const baseProfit = getBaseStoreDayProfit(dayStr, storeId, logs);
  const adjustProfit = getAdjustStoreDayProfit(dayStr, storeId, logs);
  const currentShown = baseProfit + adjustProfit;

  const nextValue = Number(nextProfit || 0);
  if (!Number.isFinite(nextValue) || nextValue < 0) {
    alert("0以上の数値を入力してください。");
    return false;
  }

  const diff = nextValue - currentShown;
  if (diff === 0) return false;

  logs.push(normalizeLog({
    id: ensureLogId(),
    storeId,
    type: "profit_adjust",
    delta: diff,
    date: dayStr,
    note: "日次利益修正"
  }));

  const store = stores.find(s => String(s.id || "") === String(storeId || ""));
  if (store) {
    store.profit = Math.max(0, Number(store.profit || 0) + diff);
  }

  saveReportData(stores, logs);
  return true;
}

function editStoreDayProfit(dayStr, storeId) {
  const stores = loadStores();
  const logs = loadLogs();
  const storeMap = getStoreMap(stores);
  const storeName = storeMap[String(storeId)]?.name || "不明な店舗";

  const baseProfit = getBaseStoreDayProfit(dayStr, storeId, logs);
  const adjustProfit = getAdjustStoreDayProfit(dayStr, storeId, logs);
  const currentShown = baseProfit + adjustProfit;

  const input = prompt(
    `${dayStr}\n${storeName}\n現在の利益: ${yen(currentShown)}\n修正後の利益を入力してください`,
    String(currentShown)
  );

  if (input === null) return;

  const nextValue = Number(String(input).replaceAll(",", "").trim());
  if (!Number.isFinite(nextValue) || nextValue < 0) {
    alert("0以上の数値を入力してください。");
    return;
  }

  const changed = saveStoreDayProfitCorrection(dayStr, storeId, nextValue);
  if (!changed) return;

  bootReport();
  showDayDetail(dayStr);
}

function buildDayStoreProfitRows(dayStr, logs, storeMap) {
  const grouped = {};

  (logs || []).forEach(log => {
    if (ymd(log.date) !== dayStr) return;
    const id = String(log.storeId || "");
    if (!id) return;
    if (log.type !== "profit" && log.type !== "profit_adjust") return;

    if (!grouped[id]) {
      grouped[id] = {
        id,
        name: storeMap[id]?.name || "不明な店舗",
        baseProfit: 0,
        adjustProfit: 0,
        profit: 0
      };
    }

    const delta = Number(log.delta || 0);

    if (log.type === "profit") {
      grouped[id].baseProfit += delta;
    } else if (log.type === "profit_adjust") {
      grouped[id].adjustProfit += delta;
    }

    grouped[id].profit = grouped[id].baseProfit + grouped[id].adjustProfit;
  });

  return Object.values(grouped).sort((a, b) => Number(b.profit || 0) - Number(a.profit || 0));
}

/* =========================
   カテゴリ集計
========================= */
function sortCategoryEntries(obj) {
  return Object.entries(obj)
    .filter(([, qty]) => Number(qty) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]) || String(a[0]).localeCompare(String(b[0]), "ja"));
}

function buildCategorySummaryFromLogs(logs) {
  const map = {};

  logs.forEach(log => {
    if (log.type !== "category") return;
    const cat = String(log.category || "").trim();
    if (!cat) return;
    map[cat] = (map[cat] || 0) + Number(log.delta || 0);
  });

  Object.keys(map).forEach(cat => {
    if (map[cat] <= 0) delete map[cat];
  });

  return sortCategoryEntries(map);
}

function buildCurrentStoreCategorySummary(stores) {
  const map = {};

  stores.forEach(store => {
    const cc = store.categoryCounts || {};
    let used = false;

    Object.entries(cc).forEach(([name, qty]) => {
      const key = String(name || "").trim();
      const n = Number(qty || 0);
      if (!key || n <= 0) return;
      used = true;
      map[key] = (map[key] || 0) + n;
    });

    const fallback = String(store.defaultCategory || "").trim();
    const items = Number(store.items || 0);
    if (!used && fallback && items > 0) {
      map[fallback] = (map[fallback] || 0) + items;
    }
  });

  return sortCategoryEntries(map);
}

function mergeCategorySummaries(primaryList, fallbackList) {
  const out = {};
  primaryList.forEach(([name, qty]) => {
    out[name] = Number(qty || 0);
  });
  fallbackList.forEach(([name, qty]) => {
    if (!(name in out)) out[name] = Number(qty || 0);
  });
  return sortCategoryEntries(out);
}

/* =========================
   データ構築
========================= */
function buildBundle(stores, logs, label) {
  const targetLogs = Array.isArray(logs) ? logs : [];
  const storeMap = getStoreMap(stores);

  let profit = 0;
  let visits = 0;
  let success = 0;
  let items = 0;

  const activeDates = new Set();
  const targetStoreIds = new Set();

  const daily = {};
  const perStore = {};

  targetLogs.forEach(log => {
    const date = ymd(log.date);
    const storeId = String(log.storeId || "").trim();

    if (date) activeDates.add(date);
    if (storeId) targetStoreIds.add(storeId);

    if (date && !daily[date]) {
      daily[date] = {
        profit: 0,
        visits: 0,
        success: 0,
        items: 0,
        categories: {},
        storeIds: new Set()
      };
    }

    if (storeId && !perStore[storeId]) {
      perStore[storeId] = {
        id: storeId,
        name: storeMap[storeId]?.name || "不明な店舗",
        pref: String(storeMap[storeId]?.pref || "").trim(),
        profit: 0,
        visits: 0,
        success: 0,
        items: 0,
        categories: {}
      };
    }

    const delta = Number(log.delta || 0);

    if (log.type === "profit" || log.type === "profit_adjust") {
      profit += delta;
      if (daily[date]) daily[date].profit += delta;
      if (perStore[storeId]) perStore[storeId].profit += delta;
    }

    if (log.type === "visit") {
      visits += delta;
      if (daily[date]) daily[date].visits += delta;
      if (perStore[storeId]) perStore[storeId].visits += delta;
    }

    if (log.type === "success") {
      success += delta;
      if (daily[date]) daily[date].success += delta;
      if (perStore[storeId]) perStore[storeId].success += delta;
    }

    if (log.type === "items") {
      items += delta;
      if (daily[date]) daily[date].items += delta;
      if (perStore[storeId]) perStore[storeId].items += delta;
    }

    if (daily[date] && storeId) {
      daily[date].storeIds.add(storeId);
    }

    if (log.type === "category" && log.category) {
      const cat = String(log.category).trim();
      if (cat) {
        if (daily[date]) {
          daily[date].categories[cat] = (daily[date].categories[cat] || 0) + delta;
        }
        if (perStore[storeId]) {
          perStore[storeId].categories[cat] = (perStore[storeId].categories[cat] || 0) + delta;
        }
      }
    }
  });

  const categoriesFromLogs = buildCategorySummaryFromLogs(targetLogs);
  const storeCurrentCategories = buildCurrentStoreCategorySummary(stores);
  const mergedCategories =
    label === "トータル"
      ? mergeCategorySummaries(categoriesFromLogs, storeCurrentCategories)
      : categoriesFromLogs;

  const summary = {
    label,
    registeredStoreCount: stores.length,
    activeStoreCount: targetStoreIds.size,
    activeDayCount: activeDates.size,
    profit,
    visits,
    success,
    items,
    rate: visits > 0 ? (success / visits) * 100 : 0,
    categories: mergedCategories,
    profitPerStore: safeDivide(profit, targetStoreIds.size),
    profitPerVisit: safeDivide(profit, visits),
    profitPerSuccess: safeDivide(profit, success),
    profitPerDay: safeDivide(profit, activeDates.size)
  };

  const topLists = buildTopListsFromStoreStats(Object.values(perStore));
  const prefStats = buildPrefStats(stores, perStore);

  return {
    logs: targetLogs,
    summary,
    daily,
    perStore,
    topLists,
    categories: mergedCategories,
    prefStats
  };
}

function getMonthBundle(stores, logs, targetMonth) {
  const key = targetMonth;
  if (cachedMonthData.has(key)) return cachedMonthData.get(key);

  const monthLogs = logs.filter(l => ym(l.date) === targetMonth);
  const bundle = buildBundle(stores, monthLogs, targetMonth);
  cachedMonthData.set(key, bundle);
  return bundle;
}

function getTotalBundle(stores, logs) {
  if (cachedTotalData) return cachedTotalData;
  cachedTotalData = buildBundle(stores, logs, "トータル");
  return cachedTotalData;
}

function getRangeBundle(stores, logs, mode, baseMonth) {
  if (mode === "total") {
    return getTotalBundle(stores, logs);
  }

  if (mode === "month") {
    return getMonthBundle(stores, logs, baseMonth);
  }

  let count = 1;
  if (mode === "3m") count = 3;
  if (mode === "6m") count = 6;
  if (mode === "12m") count = 12;

  const months = getMonthsInRange(baseMonth, count);
  const filteredLogs = logs.filter(l => months.includes(ym(l.date)));
  return buildBundle(stores, filteredLogs, getRangeLabel(mode, baseMonth));
}

function buildTopListsFromStoreStats(storeStats) {
  const normalized = storeStats.map(stat => {
    const visits = Number(stat.visits || 0);
    const success = Number(stat.success || 0);
    const profit = Number(stat.profit || 0);

    return {
      ...stat,
      expected: visits > 0 ? profit / visits : 0,
      rate: visits > 0 ? (success / visits) * 100 : 0
    };
  });

  return {
    expected: [...normalized]
      .sort((a, b) => b.expected - a.expected)
      .slice(0, 5),
    rate: [...normalized]
      .filter(x => Number(x.visits || 0) > 0)
      .sort((a, b) => b.rate - a.rate || b.success - a.success)
      .slice(0, 5),
    profit: [...normalized]
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5)
  };
}

/* =========================
   都道府県別集計
========================= */
function buildPrefStats(stores, perStore) {
  const prefMap = {};

  stores.forEach(store => {
    const pref = String(store.pref || "").trim();
    if (!pref) return;

    if (!prefMap[pref]) {
      prefMap[pref] = {
        pref,
        registeredStoreCount: 0,
        activeStoreCount: 0,
        profit: 0,
        visits: 0,
        success: 0,
        items: 0,
        rate: 0,
        expected: 0,
        stores: []
      };
    }
    prefMap[pref].registeredStoreCount += 1;
  });

  Object.values(perStore).forEach(stat => {
    const pref = String(stat.pref || "").trim();
    if (!pref) return;

    if (!prefMap[pref]) {
      prefMap[pref] = {
        pref,
        registeredStoreCount: 0,
        activeStoreCount: 0,
        profit: 0,
        visits: 0,
        success: 0,
        items: 0,
        rate: 0,
        expected: 0,
        stores: []
      };
    }

    prefMap[pref].activeStoreCount += 1;
    prefMap[pref].profit += Number(stat.profit || 0);
    prefMap[pref].visits += Number(stat.visits || 0);
    prefMap[pref].success += Number(stat.success || 0);
    prefMap[pref].items += Number(stat.items || 0);
    prefMap[pref].stores.push({
      id: stat.id,
      name: stat.name,
      profit: Number(stat.profit || 0),
      visits: Number(stat.visits || 0),
      success: Number(stat.success || 0),
      items: Number(stat.items || 0)
    });
  });

  return Object.values(prefMap)
    .map(x => {
      const visits = Number(x.visits || 0);
      const success = Number(x.success || 0);
      const profit = Number(x.profit || 0);
      return {
        ...x,
        rate: visits > 0 ? (success / visits) * 100 : 0,
        expected: visits > 0 ? profit / visits : 0,
        stores: [...x.stores].sort((a, b) => b.profit - a.profit)
      };
    })
    .filter(x => x.pref)
    .sort((a, b) => b.expected - a.expected || b.profit - a.profit);
}

function getCurrentPrefBundle() {
  const stores = loadStores();
  const logs = loadLogs();
  const baseMonth = selectedMonth || currentMonthStr();
  return getRangeBundle(stores, logs, selectedRangeMode, baseMonth);
}

function renderPrefAnalysis() {
  const el = document.getElementById("prefAnalysisWrap");
  if (!el) return;

  const bundle = getCurrentPrefBundle();
  const list = bundle.prefStats || [];
  const modeLabel = getRangeLabel(selectedRangeMode, selectedMonth || currentMonthStr());

  if (!list.length) {
    el.innerHTML = `
      <div class="mini" style="margin-bottom:10px;">表示対象：${escapeHtml(modeLabel)}</div>
      <div class="emptyText">都道府県データがありません。</div>
    `;
    return;
  }

  el.innerHTML = `
    <div class="mini" style="margin-bottom:10px;">表示対象：${escapeHtml(modeLabel)}</div>

    <div class="catList">
      ${list.map(item => `
        <div class="catItem" style="grid-template-columns:1fr; cursor:pointer;" onclick="showPrefDetail('${escapeJsString(item.pref)}')">
          <div class="catName">${escapeHtml(item.pref)}</div>
          <div class="detailText" style="margin-top:6px;">
            登録店舗 ${item.registeredStoreCount}件 / 対象店舗 ${item.activeStoreCount}件<br>
            利益 ${yen(item.profit)} / 訪問 ${item.visits}回 / 成功 ${item.success}回 / 個数 ${item.items}個<br>
            成功率 ${item.rate.toFixed(1)}% / 期待値 ${Math.round(item.expected).toLocaleString()}円
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function showPrefDetail(prefName) {
  const bundle = getCurrentPrefBundle();
  const pref = bundle.prefStats.find(x => x.pref === prefName);

  const body = document.getElementById("detailBody");
  const title = document.getElementById("detailTitle");
  if (!body || !title) return;

  const modeLabel = getRangeLabel(selectedRangeMode, selectedMonth || currentMonthStr());
  title.textContent = `${prefName} 詳細（${modeLabel}）`;

  if (!pref) {
    body.innerHTML = `<div class="emptyText">都道府県データがありません。</div>`;
    showDetailModal();
    return;
  }

  let html = `
    <div class="detailBlock">
      <div class="detailTitle">${escapeHtml(pref.pref)} サマリー</div>
      <div class="detailText">
        登録店舗：${pref.registeredStoreCount}件<br>
        対象店舗：${pref.activeStoreCount}件<br>
        利益：${yen(pref.profit)}<br>
        訪問：${pref.visits}回 / 成功：${pref.success}回 / 個数：${pref.items}個<br>
        成功率：${pref.rate.toFixed(1)}%<br>
        期待値：${Math.round(pref.expected).toLocaleString()}円
      </div>
    </div>
  `;

  if (!pref.stores.length) {
    html += `<div class="emptyText">この都道府県の対象店舗データはありません。</div>`;
    body.innerHTML = html;
    showDetailModal();
    return;
  }

  html += pref.stores.map(store => {
    const rate = Number(store.visits || 0) > 0 ? (Number(store.success || 0) / Number(store.visits || 0)) * 100 : 0;
    const expected = Number(store.visits || 0) > 0 ? Number(store.profit || 0) / Number(store.visits || 0) : 0;

    return `
      <div class="detailBlock">
        <div class="detailTitle">${escapeHtml(store.name)}</div>
        <div class="detailText">
          利益：${yen(store.profit)}<br>
          訪問：${store.visits}回 / 成功：${store.success}回 / 個数：${store.items}個<br>
          成功率：${rate.toFixed(1)}%<br>
          期待値：${Math.round(expected).toLocaleString()}円
        </div>
      </div>
    `;
  }).join("");

  body.innerHTML = html;
  showDetailModal();
}

/* =========================
   円グラフ
========================= */
function getPieChartParts(categories) {
  const top = categories.slice(0, 7);
  const rest = categories.slice(7);
  const restSum = rest.reduce((sum, [, qty]) => sum + Number(qty || 0), 0);

  const parts = [...top];
  if (restSum > 0) {
    parts.push(["その他", restSum]);
  }
  return parts;
}

function getChartColors() {
  return [
    "#356AE6",
    "#16A34A",
    "#F59E0B",
    "#DC2626",
    "#0EA5E9",
    "#8B5CF6",
    "#D97706",
    "#64748B"
  ];
}

function drawCategoryPieChart(canvasId, categories, monthLabel = "") {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const ratio = window.devicePixelRatio || 1;
  const cssSize = Math.min(290, canvas.parentElement?.clientWidth || 290);

  canvas.width = cssSize * ratio;
  canvas.height = cssSize * ratio;
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, cssSize, cssSize);

  if (!categories.length) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = "15px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("カテゴリデータなし", cssSize / 2, cssSize / 2);
    return;
  }

  const parts = getPieChartParts(categories);
  const total = parts.reduce((sum, [, qty]) => sum + Number(qty || 0), 0);
  const colors = getChartColors();

  const cx = cssSize / 2;
  const cy = cssSize / 2;
  const r = Math.min(cssSize * 0.35, 108);

  let start = -Math.PI / 2;

  parts.forEach(([, qty], idx) => {
    const value = Number(qty || 0);
    const angle = total > 0 ? (value / total) * Math.PI * 2 : 0;

    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + angle);
    ctx.strokeStyle = colors[idx % colors.length];
    ctx.lineWidth = Math.max(18, r * 0.34);
    ctx.lineCap = "butt";
    ctx.stroke();

    start += angle;
  });

  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.56, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  ctx.fillStyle = "#6b7280";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(monthLabel || "月間", cx, cy - 20);

  ctx.fillStyle = "#1f2340";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText("合計", cx, cy - 2);

  ctx.fillStyle = "#356AE6";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(`${total}個`, cx, cy + 22);
}

function buildCategoryLegendHtml(categories) {
  const parts = getPieChartParts(categories);
  const colors = getChartColors();
  const total = parts.reduce((sum, [, qty]) => sum + Number(qty || 0), 0);

  return parts.map(([name, qty], idx) => {
    const rate = total > 0 ? ((Number(qty || 0) / total) * 100).toFixed(1) : "0.0";
    return `
      <div class="legendItem">
        <div class="legendColor" style="background:${colors[idx % colors.length]};"></div>
        <div class="legendName">${escapeHtml(name)}</div>
        <div class="legendQty">${qty}個</div>
        <div class="legendRate">${rate}%</div>
      </div>
    `;
  }).join("");
}

/* =========================
   サマリー
========================= */
function renderMonthSummary(currentBundle, totalBundle) {
  const el = document.getElementById("monthSummaryCard");
  if (!el) return;

  const summary = currentBundle.summary;

  el.innerHTML = `
    <h2 class="sectionTitle" style="margin-bottom:16px;">📌 ${escapeHtml(summary.label)} サマリー</h2>

    <div class="chipRow" onclick="showMonthDetail('${escapeJsString(summary.label)}')" style="cursor:pointer;">
      <div class="chip">現在登録店舗 ${summary.registeredStoreCount}件</div>
      <div class="chip">対象店舗 ${summary.activeStoreCount}件</div>
      <div class="chip">利益 ${yen(summary.profit)}</div>
      <div class="chip">訪問 ${summary.visits}回</div>
      <div class="chip">成功 ${summary.success}回</div>
      <div class="chip">個数 ${summary.items}個</div>
      <div class="chip">成功率 ${summary.rate.toFixed(1)}%</div>
      <div class="chip">1店舗あたり利益 ${yen(Math.round(summary.profitPerStore))}</div>
      <div class="chip">1訪問あたり利益 ${yen(Math.round(summary.profitPerVisit))}</div>
      <div class="chip">成功単価 ${yen(Math.round(summary.profitPerSuccess))}</div>
      <div class="chip">稼働日数 ${summary.activeDayCount}日</div>
      <div class="chip">1日あたり利益 ${yen(Math.round(summary.profitPerDay))}</div>
    </div>

    <div class="summarySubTitle">カテゴリ集計</div>

    <div class="chartWrap">
      <div class="chartCanvasBox">
        <canvas id="categoryPieChart"></canvas>
      </div>
      <div class="chartLegend">
        ${buildCategoryLegendHtml(summary.categories)}
      </div>
    </div>
  `;

  drawCategoryPieChart("categoryPieChart", summary.categories, summary.label);
}

/* =========================
   カレンダー
========================= */
function renderSelectedDayBar(dayStr, info) {
  const bar = document.getElementById("selectedDayBar");
  if (!bar) return;

  if (!dayStr) {
    bar.innerHTML = `
      <div class="dayStickyLabel">日付をタップするとここに表示されます</div>
      <div class="dayStickyValue">その日の合計利益 <strong>-</strong></div>
    `;
    return;
  }

  const profit = Number(info?.profit || 0);

  bar.innerHTML = `
    <div class="dayStickyLabel">${escapeHtml(dayStr)} の合計利益</div>
    <div class="dayStickyValue"><strong>${escapeHtml(yen(profit))}</strong></div>
  `;
}

function renderCalendar(targetMonth, dailyStats) {
  const wrap = document.getElementById("calendarWrap");
  if (!wrap) return;

  const [year, month] = targetMonth.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const lastDate = new Date(year, month, 0).getDate();
  const startDow = first.getDay();
  const dowNames = ["日", "月", "火", "水", "木", "金", "土"];
  const today = todayStr();

  if (!selectedDay || ym(selectedDay) !== targetMonth) {
    selectedDay = today.startsWith(targetMonth) ? today : `${targetMonth}-01`;
  }

  let html = `<div class="calendarGrid">`;

  dowNames.forEach(d => {
    html += `<div class="dow">${d}</div>`;
  });

  for (let i = 0; i < startDow; i++) {
    html += `<div class="dayCell empty"></div>`;
  }

  for (let day = 1; day <= lastDate; day++) {
    const ds = `${targetMonth}-${String(day).padStart(2, "0")}`;
    const info = dailyStats[ds] || {
      profit: 0,
      visits: 0,
      success: 0,
      items: 0
    };

    const profit = Number(info.profit || 0);
    const visits = Number(info.visits || 0);
    const success = Number(info.success || 0);
    const items = Number(info.items || 0);

    const isTrophy = profit >= 100000;
    const isParty = profit >= 50000 && profit < 100000;
    const hasProfit = profit > 0;
    const hasVisitOnly = !hasProfit && (visits > 0 || success > 0 || items > 0);
    const isToday = ds === today;
    const isSelected = ds === selectedDay;

    let cls = "dayCell";
    if (isTrophy) cls += " hasData bigSuccess";
    else if (hasProfit) cls += " hasData";
    else if (hasVisitOnly) cls += " visitOnly";
    if (isToday) cls += " today";
    if (isSelected) cls += " selected";

    let valueText = "-";
    if (hasProfit) valueText = shortMoney(profit);
    else if (hasVisitOnly) valueText = "0";

    const markHtml = isTrophy
      ? `<div class="dayMark trophy">🏆</div>`
      : isParty
        ? `<div class="dayMark party">🎉</div>`
        : "";

    html += `
      <div class="${cls}" onclick="handleDayTap('${ds}')">
        <div class="dayNum">${day}</div>
        ${markHtml}
        <div class="dayValue">${escapeHtml(valueText)}</div>
      </div>
    `;
  }

  html += `</div>`;
  wrap.innerHTML = html;

  renderSelectedDayBar(selectedDay, dailyStats[selectedDay] || { profit: 0 });
}

function handleDayTap(dayStr) {
  selectedDay = dayStr;
  const stores = loadStores();
  const logs = loadLogs();
  const bundle = getMonthBundle(stores, logs, ym(dayStr));
  renderCalendar(ym(dayStr), bundle.daily);
  showDayDetail(dayStr);
}

/* =========================
   上位店舗
========================= */
function renderOneTopList(title, list, type) {
  if (!list.length) {
    return `
      <div class="card" style="margin-bottom:12px;">
        <h2 class="sectionTitle">${escapeHtml(title)}</h2>
        <div class="emptyText">この期間のデータがありません。</div>
      </div>
    `;
  }

  const rows = list.map((item, idx) => {
    let valueHtml = "";
    if (type === "expected") {
      valueHtml = `期待値 ${Math.round(item.expected).toLocaleString()}円`;
    } else if (type === "rate") {
      valueHtml = `成功率 ${item.rate.toFixed(1)}%`;
    } else {
      valueHtml = `利益 ${yen(item.profit)}`;
    }

    return `
      <div class="rankItem">
        <div class="rankNo">${idx + 1}</div>
        <div>
          <div class="rankName">${escapeHtml(item.name)}</div>
          <div class="rankSub">${escapeHtml(item.pref)} / 利益 ${yen(item.profit)} / 訪問 ${item.visits}回 / 成功 ${item.success}回</div>
        </div>
        <div class="rankValue">${valueHtml}</div>
      </div>
    `;
  }).join("");

  return `
    <div class="card" style="margin-bottom:12px;">
      <h2 class="sectionTitle">${escapeHtml(title)}</h2>
      <div class="list">${rows}</div>
    </div>
  `;
}

function renderTopStores(topLists) {
  const el = document.getElementById("topStoresWrap");
  if (!el) return;

  el.innerHTML = `
    ${renderOneTopList("🏆 期待値TOP5", topLists.expected, "expected")}
    ${renderOneTopList("🎯 成功率TOP5", topLists.rate, "rate")}
    ${renderOneTopList("💰 利益TOP5", topLists.profit, "profit")}
  `;
}

/* =========================
   カテゴリ集計
========================= */
function renderCategorySummary(currentCategories, totalCategories) {
  const el = document.getElementById("categoryWrap");
  if (!el) return;

  if (!currentCategories.length && !totalCategories.length) {
    el.innerHTML = `<div class="emptyText">カテゴリデータがありません。</div>`;
    return;
  }

  const currentLabel = getRangeLabel(selectedRangeMode, selectedMonth || currentMonthStr());

  el.innerHTML = `
    <div class="summarySubTitle" style="margin-top:0;">${escapeHtml(currentLabel)} カテゴリ集計</div>
    ${
      currentCategories.length
        ? `<div class="catList">
            ${currentCategories.map(([name, qty]) => `
              <div class="catItem">
                <div class="catName">${escapeHtml(name)}</div>
                <div class="catQty">${qty}個</div>
              </div>
            `).join("")}
          </div>`
        : `<div class="emptyText">この期間のカテゴリデータがありません。</div>`
    }

    <div class="summarySubTitle">トータルカテゴリ集計</div>
    ${
      totalCategories.length
        ? `<div class="catList">
            ${totalCategories.map(([name, qty]) => `
              <div class="catItem">
                <div class="catName">${escapeHtml(name)}</div>
                <div class="catQty">${qty}個</div>
              </div>
            `).join("")}
          </div>`
        : `<div class="emptyText">トータルカテゴリデータがありません。</div>`
    }
  `;
}

/* =========================
   詳細モーダル
========================= */
function buildDetailSummaryFromStoreStats(storeStats) {
  let profit = 0;
  let visits = 0;
  let success = 0;
  let items = 0;
  let storeCount = 0;

  Object.values(storeStats).forEach(x => {
    storeCount += 1;
    profit += Number(x.profit || 0);
    visits += Number(x.visits || 0);
    success += Number(x.success || 0);
    items += Number(x.items || 0);
  });

  return {
    storeCount,
    profit,
    visits,
    success,
    items,
    rate: visits > 0 ? (success / visits) * 100 : 0
  };
}

function showMonthDetail(targetLabel) {
  const stores = loadStores();
  const logs = loadLogs();
  const baseMonth = selectedMonth || currentMonthStr();
  const bundle = getRangeBundle(stores, logs, selectedRangeMode, baseMonth);
  const grouped = bundle.perStore;
  const summary = buildDetailSummaryFromStoreStats(grouped);

  const body = document.getElementById("detailBody");
  const title = document.getElementById("detailTitle");
  if (!body || !title) return;

  title.textContent = `${targetLabel} 詳細`;

  const rows = Object.values(grouped).sort((a, b) => {
    return Number(b.profit || 0) - Number(a.profit || 0);
  });

  let html = `
    <div class="detailBlock">
      <div class="detailTitle">期間サマリー</div>
      <div class="detailText">
        対象店舗：${summary.storeCount}件<br>
        利益：${yen(summary.profit)}<br>
        訪問：${summary.visits}回 / 成功：${summary.success}回 / 個数：${summary.items}個<br>
        成功率：${summary.rate.toFixed(1)}%
      </div>
    </div>
  `;

  if (!rows.length) {
    html += `<div class="emptyText">この期間のデータはありません。</div>`;
    body.innerHTML = html;
    showDetailModal();
    return;
  }

  html += rows.map(x => {
    const cats = Object.entries(x.categories || {})
      .filter(([, qty]) => Number(qty) > 0)
      .map(([cat, qty]) => `${escapeHtml(cat)}:${qty}`)
      .join(" / ");

    const rate = Number(x.visits || 0) > 0 ? (Number(x.success || 0) / Number(x.visits || 0)) * 100 : 0;
    const expected = Number(x.visits || 0) > 0 ? Number(x.profit || 0) / Number(x.visits || 0) : 0;

    return `
      <div class="detailBlock">
        <div class="detailTitle">${escapeHtml(x.name)}</div>
        <div class="detailText">
          ${escapeHtml(x.pref || "都道府県なし")}<br>
          利益：${yen(x.profit)}<br>
          訪問：${x.visits}回 / 成功：${x.success}回 / 個数：${x.items}個<br>
          成功率：${rate.toFixed(1)}% / 期待値：${Math.round(expected).toLocaleString()}円<br>
          ${cats ? `カテゴリ：${cats}` : "カテゴリ：なし"}
        </div>
      </div>
    `;
  }).join("");

  body.innerHTML = html;
  showDetailModal();
}

function showDayDetail(dayStr) {
  const stores = loadStores();
  const logs = loadLogs();
  const storeMap = getStoreMap(stores);
  const dayLogs = logs.filter(l => ymd(l.date) === dayStr);

  const grouped = {};

  dayLogs.forEach(log => {
    const id = String(log.storeId || "");
    if (!id) return;

    if (!grouped[id]) {
      grouped[id] = {
        id,
        name: storeMap[id]?.name || "不明な店舗",
        profit: 0,
        visits: 0,
        success: 0,
        items: 0,
        categories: {}
      };
    }

    const delta = Number(log.delta || 0);

    if (log.type === "profit" || log.type === "profit_adjust") grouped[id].profit += delta;
    if (log.type === "visit") grouped[id].visits += delta;
    if (log.type === "success") grouped[id].success += delta;
    if (log.type === "items") grouped[id].items += delta;
    if (log.type === "category" && log.category) {
      const cat = String(log.category).trim();
      if (cat) grouped[id].categories[cat] = (grouped[id].categories[cat] || 0) + delta;
    }
  });

  const summary = buildDetailSummaryFromStoreStats(grouped);
  const profitRows = buildDayStoreProfitRows(dayStr, logs, storeMap);

  const body = document.getElementById("detailBody");
  const title = document.getElementById("detailTitle");
  if (!body || !title) return;

  title.textContent = `${dayStr} 詳細`;

  const rows = Object.values(grouped).sort((a, b) => {
    return Number(b.profit || 0) - Number(a.profit || 0);
  });

  let html = `
    <div class="detailBlock">
      <div class="detailTitle">日サマリー</div>
      <div class="detailText">
        回った店舗数：${summary.storeCount}件<br>
        利益：${yen(summary.profit)}<br>
        訪問：${summary.visits}回 / 成功：${summary.success}回 / 個数：${summary.items}個<br>
        成功率：${summary.rate.toFixed(1)}%
      </div>
    </div>

    <div class="detailBlock">
      <div class="detailTitle">この日に記録追加</div>
      <div class="detailText">
        店舗を選択後、個数・カテゴリ・利益を画像と同じ入力画面で登録できます。<br>
        追加した内容は店舗カードにも反映されます。
      </div>
      <div style="margin-top:10px;">
        <button class="primaryBtn" type="button" onclick="openAddDayRecord('${escapeHtml(dayStr)}')">
          この日に記録追加
        </button>
      </div>
    </div>
  `;

  if (!rows.length) {
    html += `<div class="emptyText">この日のデータはまだありません。</div>`;
    body.innerHTML = html;
    showDetailModal();
    return;
  }

  html += rows.map(x => {
    const cats = Object.entries(x.categories || {})
      .filter(([, qty]) => Number(qty) > 0)
      .map(([cat, qty]) => `${escapeHtml(cat)}:${qty}`)
      .join(" / ");

    const rate = Number(x.visits || 0) > 0
      ? (Number(x.success || 0) / Number(x.visits || 0)) * 100
      : 0;

    const pRow = profitRows.find(r => r.id === x.id);
    const baseProfit = Number(pRow?.baseProfit || 0);
    const adjustProfit = Number(pRow?.adjustProfit || 0);
    const shownProfit = Number(pRow?.profit || x.profit || 0);

    return `
      <div class="detailBlock">
        <div class="detailTitle">${escapeHtml(x.name)}</div>
        <div class="detailText">
          利益：${yen(shownProfit)}<br>
          元利益：${yen(baseProfit)} / 補正：${yen(adjustProfit)}<br>
          訪問：${x.visits}回 / 成功：${x.success}回 / 個数：${x.items}個<br>
          成功率：${rate.toFixed(1)}%<br>
          ${cats ? `カテゴリ：${cats}` : "カテゴリ：なし"}
        </div>
        <div class="row2" style="margin-top:8px;">
          <button class="ghostBtn" type="button" onclick="editStoreDayProfit('${escapeHtml(dayStr)}', '${escapeHtml(x.id)}')">
            利益を修正
          </button>
          <button class="dangerBtn" type="button" onclick="deleteStoreDayRecords('${escapeHtml(dayStr)}', '${escapeHtml(x.id)}')">
            この日の記録を削除
          </button>
        </div>
      </div>
    `;
  }).join("");

  body.innerHTML = html;
  showDetailModal();
}

function showDetailModal() {
  const el = document.getElementById("detailModal");
  if (el) {
    el.classList.add("show");
    el.setAttribute("aria-hidden", "false");
  }
}

function hideDetailModal() {
  const el = document.getElementById("detailModal");
  if (el) {
    el.classList.remove("show");
    el.setAttribute("aria-hidden", "true");
  }
}

function closeDetailModal(e) {
  if (e.target.id === "detailModal") hideDetailModal();
}

/* =========================
   起動
========================= */
function bootReport() {
  const stores = loadStores();
  const logs = loadLogs();

  renderMonthPicker(logs);

  const baseMonth = selectedMonth || currentMonthStr();
  const monthBundle = getMonthBundle(stores, logs, baseMonth);
  const currentBundle = getRangeBundle(stores, logs, selectedRangeMode, baseMonth);
  const totalBundle = getTotalBundle(stores, logs);

  renderCalendar(baseMonth, monthBundle.daily);
  renderMonthSummary(currentBundle, totalBundle);
  renderTopStores(currentBundle.topLists);
  renderCategorySummary(currentBundle.categories, totalBundle.categories);
  renderPrefAnalysis();
}

window.addEventListener("load", bootReport);

window.addEventListener("resize", () => {
  const stores = loadStores();
  const logs = loadLogs();
  const baseMonth = selectedMonth || currentMonthStr();
  const bundle = getRangeBundle(stores, logs, selectedRangeMode, baseMonth);
  drawCategoryPieChart("categoryPieChart", bundle.summary.categories || [], bundle.summary.label || "");
});
