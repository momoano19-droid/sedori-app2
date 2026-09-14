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
let selectedPrefName = "";
let selectedPrefStoreSort = "expected"; // expected | rate | profit

/* =========================
   軽量化キャッシュ
========================= */
let cachedStores = null;
let cachedLogs = null;
let cachedMonthData = new Map();
let cachedTotalData = null;

/* =========================
   カレンダー記録追加 1画面モーダル用
========================= */
let reportRecordModalState = null;
let reportRecordAvailableCategories = [];

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

function reportToNonNegInt(value) {
  const n = parseInt(String(value ?? "").replaceAll(",", "").trim(), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function sumReportCategoryMap(map) {
  return Object.values(map || {}).reduce((sum, v) => sum + Number(v || 0), 0);
}

/* =========================
   カレンダー記録追加 1画面モーダル
========================= */
function getReportRecordStore() {
  const stores = loadStores();
  return stores.find(s => String(s.id || "") === String(reportRecordModalState?.storeId || ""));
}

function getReportRecordCategoryHistory(storeId = "") {
  const stores = loadStores();
  const logs = loadLogs();
  const set = new Set();

  const addCat = value => {
    const cat = String(value || "").trim();
    if (cat) set.add(cat);
  };

  const selectedStore = stores.find(s => String(s.id || "") === String(storeId || ""));
  if (selectedStore) {
    addCat(selectedStore.defaultCategory);
    Object.keys(selectedStore.categoryCounts || {}).forEach(addCat);
  }

  stores.forEach(store => {
    addCat(store.defaultCategory);
    Object.keys(store.categoryCounts || {}).forEach(addCat);
  });

  logs.forEach(log => {
    if (log.type === "category") addCat(log.category);
  });

  const list = [...set];
  list.sort((a, b) => String(a).localeCompare(String(b), "ja"));

  return list.slice(0, 40);
}

function refreshReportRecordAvailableCategories() {
  if (!reportRecordModalState) return;

  const storeId = reportRecordModalState.storeId || "";
  reportRecordAvailableCategories = getReportRecordCategoryHistory(storeId);

  // デフォルトではカテゴリを自動選択しない
  // 店舗を選んだ後も、ユーザーがカテゴリをタップするまで未選択のままにする
}

function ensureReportRecordModal() {
  if (document.getElementById("reportRecordModal")) return;

  const modal = document.createElement("div");
  modal.id = "reportRecordModal";
  modal.className = "qtyCategoryModal";
  modal.innerHTML = `
    <div class="qtyCategoryCard reportRecordCard">
      <div id="reportRecordTitle" class="qtyCategoryTitle">記録追加</div>
      <div class="qtyCategorySub">
        店舗を選んで、訪問・成功・個数・カテゴリ・利益をまとめて入力できます
      </div>

      <div class="qtyCategorySectionTitle">店舗を選択</div>

      <input
        id="reportRecordStoreSearch"
        class="categoryTextInput"
        type="text"
        placeholder="店舗名 / 都道府県 / 住所で検索"
        oninput="renderReportRecordStoreSelectOptions()"
      >

      <div class="mt12">
        <select id="reportRecordStoreSelect" onchange="handleReportRecordStoreChange()"></select>
      </div>

      <div class="qtyCategorySectionTitle">記録内容</div>
      <div class="row2">
        <button
          id="reportRecordVisitBtn"
          type="button"
          class="primaryBtn"
          onclick="toggleReportRecordVisit()"
        >訪問 +1</button>

        <button
          id="reportRecordSuccessBtn"
          type="button"
          class="primaryBtn"
          onclick="toggleReportRecordSuccess()"
        >成功 +1</button>
      </div>

      <div class="qtyCategorySectionTitle">合計個数を選択</div>
      <div id="reportInlineQtyQuickWrap" class="qtyQuickButtons"></div>

      <div class="qtyManualRow">
        <input
          id="reportQtyManualInput"
          class="qtyManualInput"
          type="number"
          min="1"
          step="1"
          placeholder="5以上はここに入力"
        >
        <button type="button" class="qtyManualBtn" onclick="applyReportInlineManualQty()">
          手入力反映
        </button>
      </div>

      <div class="qtySelectedBox">
        合計個数: <span id="reportInlineQtySelectedValue">1</span>個
      </div>

      <div class="qtyCategorySectionTitle">履歴カテゴリ</div>
      <div id="reportInlineCategoryChipWrap" class="categoryChipWrap"></div>

      <div class="qtyCategorySectionTitle">新しいカテゴリを追加</div>
      <div class="categoryAddRow">
        <input
          id="reportQtyNewCategoryInput"
          class="categoryTextInput"
          type="text"
          placeholder="新しいカテゴリ名を入力"
        >
        <button type="button" class="categoryAddBtn" onclick="addReportInlineNewCategory()">
          追加
        </button>
      </div>

      <div class="qtyCategorySectionTitle">カテゴリごとの個数</div>
      <div id="reportInlineCategoryCountEditor" class="qtyCategoryCountEditor"></div>

      <div class="qtyRemainPanel" id="reportInlineRemainPanel">
        <div class="qtyRemainLabel">残り</div>
        <div class="qtyRemainValue" id="reportInlineRemainValue">1</div>
        <div class="qtyRemainUnit">個</div>
      </div>

      <div class="qtySelectedBox qtyCategoryTotalCheck" id="reportInlineCategoryTotalCheck">
        入力合計: <span id="reportInlineAssignedTotal">0</span> /
        <span id="reportInlineAssignedTarget">1</span>個
      </div>

      <div class="qtyCategorySectionTitle">利益入力</div>

      <div id="reportInlineProfitQuickWrap" class="qtyQuickButtons"></div>

      <div class="qtyManualRow">
        <input
          id="reportQtyProfitInput"
          class="qtyManualInput"
          type="number"
          min="0"
          step="100"
          value="0"
          placeholder="利益を入力"
          oninput="syncReportInlineProfitInput()"
        >
        <button type="button" class="qtyManualBtn" onclick="applyReportInlineProfitInput()">
          利益反映
        </button>
      </div>

      <div class="qtySelectedBox">
        利益: <span id="reportInlineProfitValue">0</span>円
      </div>

      <div class="categoryPickerActions">
        <button type="button" class="ghostBtn" onclick="closeReportRecordModal()">キャンセル</button>
        <button type="button" class="primaryBtn" onclick="saveReportRecordWithItems()">保存</button>
      </div>

      <div class="mt8">
        <button
          type="button"
          class="ghostBtn"
          style="width:100%;"
          onclick="saveReportRecordVisitOnly()"
        >
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
  openReportRecordModal(dayStr);
}

function openReportRecordModal(dayStr) {
  const stores = loadStores();

  if (!stores.length) {
    alert("店舗が登録されていません。");
    return;
  }

  ensureReportRecordModal();

  reportRecordModalState = {
    day: String(dayStr || todayStr()),
    storeId: "",
    visit: true,
    success: true,
    qty: 1,
    categoryMap: {},
    profit: 0
  };

  reportRecordAvailableCategories = getReportRecordCategoryHistory("");

  const title = document.getElementById("reportRecordTitle");
  if (title) {
    title.textContent = `${reportRecordModalState.day} に記録追加`;
  }

  const searchEl = document.getElementById("reportRecordStoreSearch");
  const manualQtyEl = document.getElementById("reportQtyManualInput");
  const newCatEl = document.getElementById("reportQtyNewCategoryInput");
  const profitEl = document.getElementById("reportQtyProfitInput");

  if (searchEl) searchEl.value = "";
  if (manualQtyEl) manualQtyEl.value = "";
  if (newCatEl) newCatEl.value = "";
  if (profitEl) profitEl.value = "0";

  renderReportRecordStoreSelectOptions();
  renderReportRecordMainButtons();
  renderReportInlineAll();

  const modal = document.getElementById("reportRecordModal");
  if (modal) modal.classList.add("show");
}

function closeReportRecordModal() {
  const modal = document.getElementById("reportRecordModal");
  if (modal) modal.classList.remove("show");

  reportRecordModalState = null;
  reportRecordAvailableCategories = [];
}

function getFilteredReportRecordStores() {
  const stores = loadStores();
  const keyword = String(
    document.getElementById("reportRecordStoreSearch")?.value || ""
  ).trim().toLowerCase();

  const filtered = stores.filter(store => {
    if (!keyword) return true;

    const name = String(store.name || "").toLowerCase();
    const pref = String(store.pref || "").toLowerCase();
    const address = String(store.address || "").toLowerCase();

    return (
      name.includes(keyword) ||
      pref.includes(keyword) ||
      address.includes(keyword)
    );
  });

  return filtered.sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), "ja")
  );
}

function renderReportRecordStoreSelectOptions() {
  if (!reportRecordModalState) return;

  const select = document.getElementById("reportRecordStoreSelect");
  if (!select) return;

  const filtered = getFilteredReportRecordStores();

  if (!filtered.length) {
    select.innerHTML = `<option value="">該当する店舗がありません</option>`;
    reportRecordModalState.storeId = "";
    reportRecordModalState.categoryMap = {};
    reportRecordAvailableCategories = getReportRecordCategoryHistory("");
    renderReportRecordStoreInfo();
    renderReportInlineAll();
    return;
  }

  const currentId = String(reportRecordModalState.storeId || "");
  const hasCurrent = filtered.some(s => String(s.id || "") === currentId);

  if (currentId && !hasCurrent) {
    reportRecordModalState.storeId = "";
    reportRecordModalState.categoryMap = {};
  }

  select.innerHTML =
    `<option value="">店舗を選択してください</option>` +
    filtered.map(store => {
      const name = String(store.name || "店舗名なし");
      const pref = String(store.pref || "");
      return `<option value="${escapeHtml(String(store.id || ""))}">${escapeHtml(name)}${pref ? `（${escapeHtml(pref)}）` : ""}</option>`;
    }).join("");

  select.value = String(reportRecordModalState.storeId || "");

  refreshReportRecordAvailableCategories();
  renderReportRecordStoreInfo();
  renderReportInlineAll();
}

function handleReportRecordStoreChange() {
  if (!reportRecordModalState) return;

  const select = document.getElementById("reportRecordStoreSelect");
  if (!select) return;

  reportRecordModalState.storeId = String(select.value || "");
  reportRecordModalState.categoryMap = {};

  refreshReportRecordAvailableCategories();
  renderReportRecordStoreInfo();
  renderReportInlineAll();
}

function renderReportRecordStoreInfo() {
  // 店舗選択欄の下に表示していた「店舗名・住所プレビュー」は非表示にしています。
}

function renderReportRecordMainButtons() {
  if (!reportRecordModalState) return;

  const visitBtn = document.getElementById("reportRecordVisitBtn");
  const successBtn = document.getElementById("reportRecordSuccessBtn");

  if (visitBtn) {
    visitBtn.className = reportRecordModalState.visit ? "primaryBtn" : "ghostBtn";
    visitBtn.textContent = reportRecordModalState.visit ? "訪問 +1" : "訪問なし";
  }

  if (successBtn) {
    successBtn.className = reportRecordModalState.success ? "primaryBtn" : "ghostBtn";
    successBtn.textContent = reportRecordModalState.success ? "成功 +1" : "成功なし";
  }
}

function toggleReportRecordVisit() {
  if (!reportRecordModalState) return;

  reportRecordModalState.visit = !reportRecordModalState.visit;

  if (!reportRecordModalState.visit && reportRecordModalState.success) {
    reportRecordModalState.success = false;
  }

  renderReportRecordMainButtons();
}

function toggleReportRecordSuccess() {
  if (!reportRecordModalState) return;

  reportRecordModalState.success = !reportRecordModalState.success;

  if (reportRecordModalState.success) {
    reportRecordModalState.visit = true;
  }

  renderReportRecordMainButtons();
}

/* =========================
   1画面内：個数・カテゴリ・利益入力
========================= */
function renderReportInlineAll() {
  renderReportInlineQtyQuickButtons();
  renderReportInlineQtyValues();
  renderReportInlineCategoryChips();
  renderReportInlineCategoryCountEditor();
  renderReportInlineAssignedSummary();
  renderReportInlineProfitQuickButtons();
  renderReportInlineProfitValue();
}

function renderReportInlineQtyQuickButtons() {
  const wrap = document.getElementById("reportInlineQtyQuickWrap");
  if (!wrap || !reportRecordModalState) return;

  const currentQty = Number(reportRecordModalState.qty || 1);

  wrap.innerHTML = [1, 2, 3, 4, 5].map(n => `
    <button
      type="button"
      class="qtyQuickBtn ${currentQty === n ? "active" : ""}"
      onclick="setReportInlineQty(${n})"
    >${n}</button>
  `).join("");
}

function renderReportInlineQtyValues() {
  if (!reportRecordModalState) return;

  const qty = Number(reportRecordModalState.qty || 1);

  const selectedEl = document.getElementById("reportInlineQtySelectedValue");
  const targetEl = document.getElementById("reportInlineAssignedTarget");

  if (selectedEl) selectedEl.textContent = String(qty);
  if (targetEl) targetEl.textContent = String(qty);
}

function setReportInlineQty(n) {
  if (!reportRecordModalState) return;

  const nextQty = Math.max(1, reportToNonNegInt(n || 1));
  reportRecordModalState.qty = nextQty;

  const keys = Object.keys(reportRecordModalState.categoryMap || {});
  if (keys.length === 1) {
    reportRecordModalState.categoryMap[keys[0]] = nextQty;
  }

  renderReportInlineAll();
}

function applyReportInlineManualQty() {
  const input = document.getElementById("reportQtyManualInput");
  if (!input || !reportRecordModalState) return;

  const qty = reportToNonNegInt(input.value);
  if (qty < 1) {
    alert("1以上の個数を入力してください。");
    return;
  }

  setReportInlineQty(qty);
}

function renderReportInlineCategoryChips() {
  const wrap = document.getElementById("reportInlineCategoryChipWrap");
  if (!wrap || !reportRecordModalState) return;

  if (!reportRecordAvailableCategories.length) {
    wrap.innerHTML = `<div class="qtyCategoryEmpty">カテゴリ履歴がありません。新しいカテゴリを追加してください。</div>`;
    return;
  }

  wrap.innerHTML = reportRecordAvailableCategories.map(cat => `
    <button
      type="button"
      class="categoryChip ${reportRecordModalState.categoryMap[cat] ? "active" : ""}"
      data-cat="${escapeHtml(cat)}"
      onclick="toggleReportInlineCategoryFromElement(this)"
    >
      ${escapeHtml(cat)}
    </button>
  `).join("");
}

function toggleReportInlineCategoryFromElement(el) {
  if (!reportRecordModalState || !el) return;

  const cat = String(el.getAttribute("data-cat") || "").trim();
  if (!cat) return;

  if (reportRecordModalState.categoryMap[cat]) {
    delete reportRecordModalState.categoryMap[cat];
  } else {
    const currentAssigned = sumReportCategoryMap(reportRecordModalState.categoryMap);
    const remain = Math.max(1, Number(reportRecordModalState.qty || 1) - currentAssigned);
    reportRecordModalState.categoryMap[cat] = remain;
  }

  renderReportInlineAll();
}

function addReportInlineNewCategory() {
  if (!reportRecordModalState) return;

  const input = document.getElementById("reportQtyNewCategoryInput");
  if (!input) return;

  const cat = String(input.value || "").trim();
  if (!cat) return;

  if (!reportRecordAvailableCategories.includes(cat)) {
    reportRecordAvailableCategories.unshift(cat);
  }

  if (!reportRecordModalState.categoryMap[cat]) {
    const currentAssigned = sumReportCategoryMap(reportRecordModalState.categoryMap);
    const remain = Math.max(1, Number(reportRecordModalState.qty || 1) - currentAssigned);
    reportRecordModalState.categoryMap[cat] = remain;
  }

  input.value = "";
  renderReportInlineAll();
}

function renderReportInlineCategoryCountEditor() {
  const wrap = document.getElementById("reportInlineCategoryCountEditor");
  if (!wrap || !reportRecordModalState) return;

  const keys = Object.keys(reportRecordModalState.categoryMap || {});
  if (!keys.length) {
    wrap.innerHTML = `<div class="qtyCategoryEmpty">カテゴリを選択してください</div>`;
    return;
  }

  wrap.innerHTML = keys.map(cat => {
    const qty = Math.max(0, Number(reportRecordModalState.categoryMap[cat] || 0));
    return `
      <div class="qtyCategoryCountRow">
        <div class="qtyCategoryCountName">${escapeHtml(cat)}</div>
        <div class="qtyStepper">
          <button
            type="button"
            class="qtyStepBtn minus"
            data-cat="${escapeHtml(cat)}"
            onclick="changeReportInlineCategoryCountFromElement(this, -1)"
          >−</button>
          <div class="qtyStepValue">${qty}</div>
          <button
            type="button"
            class="qtyStepBtn plus"
            data-cat="${escapeHtml(cat)}"
            onclick="changeReportInlineCategoryCountFromElement(this, 1)"
          >＋</button>
        </div>
      </div>
    `;
  }).join("");
}

function changeReportInlineCategoryCountFromElement(el, delta) {
  if (!reportRecordModalState || !el) return;

  const cat = String(el.getAttribute("data-cat") || "").trim();
  if (!cat) return;

  const current = Math.max(0, Number(reportRecordModalState.categoryMap[cat] || 0));
  const next = Math.max(0, current + Number(delta || 0));

  if (next <= 0) {
    delete reportRecordModalState.categoryMap[cat];
  } else {
    reportRecordModalState.categoryMap[cat] = next;
  }

  renderReportInlineAll();
}

function renderReportInlineAssignedSummary() {
  if (!reportRecordModalState) return;

  const qty = Number(reportRecordModalState.qty || 1);
  const total = sumReportCategoryMap(reportRecordModalState.categoryMap);
  const remain = qty - total;

  const remainPanel = document.getElementById("reportInlineRemainPanel");
  const remainValue = document.getElementById("reportInlineRemainValue");
  const totalEl = document.getElementById("reportInlineAssignedTotal");
  const totalCheck = document.getElementById("reportInlineCategoryTotalCheck");

  if (remainValue) remainValue.textContent = String(remain);
  if (totalEl) totalEl.textContent = String(total);

  if (remainPanel) {
    remainPanel.classList.remove("is-ok", "is-over", "is-under");
    if (remain === 0) remainPanel.classList.add("is-ok");
    else if (remain < 0) remainPanel.classList.add("is-over");
    else remainPanel.classList.add("is-under");
  }

  if (totalCheck) {
    totalCheck.classList.remove("is-ok", "is-over", "is-under");
    if (remain === 0) totalCheck.classList.add("is-ok");
    else if (remain < 0) totalCheck.classList.add("is-over");
    else totalCheck.classList.add("is-under");
  }
}

function renderReportInlineProfitQuickButtons() {
  const wrap = document.getElementById("reportInlineProfitQuickWrap");
  if (!wrap || !reportRecordModalState) return;

  wrap.innerHTML = [1000, 3000, 5000, 10000].map(amount => `
    <button
      type="button"
      class="qtyQuickBtn profitQuickBtn"
      onclick="addReportInlineQuickProfit(${amount})"
    >${amount}</button>
  `).join("");
}

function addReportInlineQuickProfit(amount) {
  if (!reportRecordModalState) return;

  reportRecordModalState.profit =
    Number(reportRecordModalState.profit || 0) + reportToNonNegInt(amount || 0);

  const input = document.getElementById("reportQtyProfitInput");
  if (input) input.value = String(reportRecordModalState.profit);

  renderReportInlineProfitValue();
}

function syncReportInlineProfitInput() {
  if (!reportRecordModalState) return;

  const input = document.getElementById("reportQtyProfitInput");
  if (!input) return;

  reportRecordModalState.profit = reportToNonNegInt(input.value);
  renderReportInlineProfitValue();
}

function applyReportInlineProfitInput() {
  if (!reportRecordModalState) return;

  const input = document.getElementById("reportQtyProfitInput");
  if (!input) return;

  reportRecordModalState.profit = reportToNonNegInt(input.value);
  input.value = String(reportRecordModalState.profit);
  renderReportInlineProfitValue();
}

function renderReportInlineProfitValue() {
  const valueEl = document.getElementById("reportInlineProfitValue");
  if (valueEl) {
    valueEl.textContent = Number(reportRecordModalState?.profit || 0).toLocaleString();
  }
}

/* =========================
   カレンダーから記録追加・削除
========================= */
function buildReportRecordItemPayload() {
  if (!reportRecordModalState) {
    throw new Error("記録データがありません。");
  }

  const qty = Math.max(1, reportToNonNegInt(reportRecordModalState.qty || 1));
  const profit = reportToNonNegInt(reportRecordModalState.profit || 0);

  const categoryMap = {};
  Object.entries(reportRecordModalState.categoryMap || {}).forEach(([cat, rawQty]) => {
    const name = String(cat || "").trim();
    const n = reportToNonNegInt(rawQty || 0);
    if (name && n > 0) {
      categoryMap[name] = n;
    }
  });

  if (!Object.keys(categoryMap).length) {
    throw new Error("カテゴリを選択してください。");
  }

  const total = sumReportCategoryMap(categoryMap);
  if (total !== qty) {
    throw new Error(`カテゴリ個数の合計(${total})と合計個数(${qty})を一致させてください。`);
  }

  return { qty, profit, categoryMap };
}

function saveReportRecordWithItems() {
  if (!reportRecordModalState) return;

  const store = getReportRecordStore();
  if (!store) {
    alert("店舗を選択してください。");
    return;
  }

  let payload;
  try {
    payload = buildReportRecordItemPayload();
  } catch (e) {
    alert(e?.message || "入力内容を確認してください。");
    return;
  }

  const categoryText = Object.entries(payload.categoryMap)
    .map(([cat, qty]) => `${cat}:${qty}`)
    .join(" / ");

  const ok = confirm(
    [
      `${reportRecordModalState.day} に記録を追加します。`,
      "",
      `店舗：${store.name || "店舗名なし"}`,
      `訪問：${reportRecordModalState.visit ? "+1" : "なし"}`,
      `成功：${reportRecordModalState.success ? "+1" : "なし"}`,
      `個数：${payload.qty}個`,
      `カテゴリ：${categoryText}`,
      `利益：${yen(payload.profit)}`,
      "",
      "この内容で保存しますか？"
    ].join("\n")
  );

  if (!ok) return;

  const saved = addCalendarRecordToStoreAndLogs(reportRecordModalState.day, {
    storeId: store.id,
    visit: reportRecordModalState.visit || reportRecordModalState.success,
    success: reportRecordModalState.success,
    items: payload.qty,
    profit: payload.profit,
    categoryMap: payload.categoryMap
  });

  if (!saved) return;

  const dayStr = reportRecordModalState.day;

  closeReportRecordModal();

  alert("記録を追加しました。店舗カードにも反映されます。");

  bootReport();
  showDayDetail(dayStr);
}

function saveReportRecordVisitOnly() {
  if (!reportRecordModalState) return;

  const store = getReportRecordStore();
  if (!store) {
    alert("店舗を選択してください。");
    return;
  }

  const ok = confirm(
    [
      `${reportRecordModalState.day} に訪問記録を追加します。`,
      "",
      `店舗：${store.name || "店舗名なし"}`,
      `訪問：+1`,
      `成功：なし`,
      `個数：0個`,
      `利益：0円`,
      "",
      "この内容で保存しますか？"
    ].join("\n")
  );

  if (!ok) return;

  const saved = addCalendarRecordToStoreAndLogs(reportRecordModalState.day, {
    storeId: store.id,
    visit: true,
    success: false,
    items: 0,
    profit: 0,
    categoryMap: {}
  });

  if (!saved) return;

  const dayStr = reportRecordModalState.day;

  closeReportRecordModal();

  alert("訪問記録を追加しました。店舗カードにも反映されます。");

  bootReport();
  showDayDetail(dayStr);
}

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

  const targetStoreIds = new Set();

  const daily = {};
  const perStore = {};

  targetLogs.forEach(log => {
    const date = ymd(log.date);
    const storeId = String(log.storeId || "").trim();
    const type = String(log.type || "");
    const delta = Number(log.delta || 0);

    const isMainActivityLog = [
      "profit",
      "profit_adjust",
      "visit",
      "success",
      "items"
    ].includes(type);

    if (storeId && isMainActivityLog) {
      targetStoreIds.add(storeId);
    }

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

    if (type === "profit" || type === "profit_adjust") {
      profit += delta;
      if (daily[date]) daily[date].profit += delta;
      if (perStore[storeId]) perStore[storeId].profit += delta;
    }

    if (type === "visit") {
      visits += delta;
      if (daily[date]) daily[date].visits += delta;
      if (perStore[storeId]) perStore[storeId].visits += delta;
    }

    if (type === "success") {
      success += delta;
      if (daily[date]) daily[date].success += delta;
      if (perStore[storeId]) perStore[storeId].success += delta;
    }

    if (type === "items") {
      items += delta;
      if (daily[date]) daily[date].items += delta;
      if (perStore[storeId]) perStore[storeId].items += delta;
    }

    if (daily[date] && storeId && isMainActivityLog) {
      daily[date].storeIds.add(storeId);
    }

    if (type === "category" && log.category) {
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

  Object.keys(daily).forEach(date => {
    const day = daily[date];

    day.profit = Number(day.profit || 0);
    day.visits = Math.max(0, Number(day.visits || 0));
    day.success = Math.max(0, Number(day.success || 0));
    day.items = Math.max(0, Number(day.items || 0));

    Object.keys(day.categories || {}).forEach(cat => {
      if (Number(day.categories[cat] || 0) <= 0) {
        delete day.categories[cat];
      }
    });
  });

  const activeDayCount = Object.values(daily).filter(day => {
    const profit = Number(day.profit || 0);
    const visits = Number(day.visits || 0);
    const success = Number(day.success || 0);
    const items = Number(day.items || 0);

    return (
      profit !== 0 ||
      visits > 0 ||
      success > 0 ||
      items > 0
    );
  }).length;

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
    activeDayCount,
    profit,
    visits: Math.max(0, visits),
    success: Math.max(0, success),
    items: Math.max(0, items),
    rate: visits > 0 ? (success / visits) * 100 : 0,
    categories: mergedCategories,
    profitPerStore: safeDivide(profit, targetStoreIds.size),
    profitPerVisit: safeDivide(profit, visits),
    profitPerSuccess: safeDivide(profit, success),
    profitPerDay: safeDivide(profit, activeDayCount)
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
function changePrefStoreSort(prefName, sortType) {
  const allowed = ["expected", "rate", "profit"];
  selectedPrefName = String(prefName || "");
  selectedPrefStoreSort = allowed.includes(sortType) ? sortType : "expected";

  showPrefDetail(selectedPrefName);
}

function showPrefDetail(prefName) {
  const bundle = getCurrentPrefBundle();
  const pref = bundle.prefStats.find(x => x.pref === prefName);

  const body = document.getElementById("detailBody");
  const title = document.getElementById("detailTitle");
  if (!body || !title) return;

  selectedPrefName = String(prefName || "");

  const modeLabel = getRangeLabel(
    selectedRangeMode,
    selectedMonth || currentMonthStr()
  );

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

  const storeRows = pref.stores.map(store => {
    const visits = Number(store.visits || 0);
    const success = Number(store.success || 0);
    const profit = Number(store.profit || 0);

    return {
      ...store,
      rate: visits > 0 ? (success / visits) * 100 : 0,
      expected: visits > 0 ? profit / visits : 0
    };
  });

  storeRows.sort((a, b) => {
    if (selectedPrefStoreSort === "rate") {
      return (
        b.rate - a.rate ||
        b.success - a.success ||
        b.expected - a.expected
      );
    }

    if (selectedPrefStoreSort === "profit") {
      return (
        b.profit - a.profit ||
        b.expected - a.expected
      );
    }

    return (
      b.expected - a.expected ||
      b.rate - a.rate ||
      b.profit - a.profit
    );
  });

  html += `
    <div class="detailBlock">
      <div class="detailTitle">店舗の並び替え</div>

      <div style="
        display:grid;
        grid-template-columns:repeat(3, 1fr);
        gap:8px;
        margin-top:10px;
      ">
        <button
          type="button"
          class="${selectedPrefStoreSort === "expected" ? "primaryBtn" : "ghostBtn"}"
          onclick="changePrefStoreSort('${escapeJsString(prefName)}', 'expected')"
        >
          期待値順
        </button>

        <button
          type="button"
          class="${selectedPrefStoreSort === "rate" ? "primaryBtn" : "ghostBtn"}"
          onclick="changePrefStoreSort('${escapeJsString(prefName)}', 'rate')"
        >
          成功率順
        </button>

        <button
          type="button"
          class="${selectedPrefStoreSort === "profit" ? "primaryBtn" : "ghostBtn"}"
          onclick="changePrefStoreSort('${escapeJsString(prefName)}', 'profit')"
        >
          利益順
        </button>
      </div>
    </div>
  `;

  html += storeRows.map((store, index) => {
    return `
      <div class="detailBlock">
        <div class="detailTitle">
          ${index + 1}. ${escapeHtml(store.name)}
        </div>

        <div class="detailText">
          利益：${yen(store.profit)}<br>
          訪問：${store.visits}回 / 成功：${store.success}回 / 個数：${store.items}個<br>
          成功率：${store.rate.toFixed(1)}%<br>
          期待値：${Math.round(store.expected).toLocaleString()}円
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
  renderAiSourcingSummary(dayStr);
  const card = document.getElementById("aiSourcingSummaryCard");
  if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
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
        店舗・訪問・成功・個数・カテゴリ・利益を1画面で入力できます。<br>
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
            記録削除
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

/* =========================
   今日の仕入れ総評：AI接続前の集計エンジン
========================= */
const REPORT_SOURCING_SESSIONS_KEY = "sourcing_sessions_v1";
const REPORT_ACTIVE_SOURCING_SESSION_KEY = "active_sourcing_session_v1";

function loadReportSourcingSessions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(REPORT_SOURCING_SESSIONS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function loadReportActiveSourcingSession() {
  try {
    const parsed = JSON.parse(localStorage.getItem(REPORT_ACTIVE_SOURCING_SESSION_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch { return null; }
}

function reportSessionMinutes(session, nowMs = Date.now()) {
  if (!session?.startAt) return 0;
  if (Number(session.durationMinutes) >= 0 && session.endAt) return Math.max(0, Number(session.durationMinutes || 0));
  const start = new Date(session.startAt).getTime();
  const end = session.endAt ? new Date(session.endAt).getTime() : nowMs;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60000));
}

function formatReportActivityTime(minutes) {
  const m = Math.max(0, Math.round(Number(minutes || 0)));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return h ? `${h}時間${rest}分` : `${rest}分`;
}

function getDayActivityMetrics(dayStr, logs) {
  const bundle = buildBundle(loadStores(), (logs || []).filter(x => ymd(x.date) === dayStr), dayStr);
  const s = bundle.summary;
  return {
    profit: Number(s.profit || 0), visits: Number(s.visits || 0), success: Number(s.success || 0),
    items: Number(s.items || 0), rate: Number(s.rate || 0), storeCount: Number(s.activeStoreCount || 0)
  };
}

function buildRecentDayBenchmark(logs, targetDay) {
  const byDay = {};
  (logs || []).forEach(log => {
    const d = ymd(log.date);
    if (!d || d >= targetDay) return;
    const type = String(log.type || "");
    if (!["visit","success","items","profit","profit_adjust"].includes(type)) return;
    if (!byDay[d]) byDay[d] = {profit:0,visits:0,success:0,items:0};
    const n = Number(log.delta || 0);
    if (type === "visit") byDay[d].visits += n;
    if (type === "success") byDay[d].success += n;
    if (type === "items") byDay[d].items += n;
    if (type === "profit" || type === "profit_adjust") byDay[d].profit += n;
  });
  const days = Object.entries(byDay).filter(([,x]) => x.visits > 0 || x.success > 0 || x.items > 0 || x.profit !== 0).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,30).map(([,x])=>x);
  if (!days.length) return null;
  const avg = key => days.reduce((sum,x)=>sum+Number(x[key]||0),0)/days.length;
  const visits=avg("visits"), success=avg("success");
  return {days:days.length, profit:avg("profit"), visits, success, items:avg("items"), rate:visits>0?(success/visits)*100:0};
}

function buildSourcingAutoComment(m, benchmark, minutes, active) {
  if (m.visits <= 0 && m.items <= 0 && m.profit === 0) {
    return active ? "仕入れは開始されています。店舗の記録が増えると、ここに効率と傾向を表示します。" : "今日はまだ仕入れ記録がありません。最初の「訪問＋」から自動で集計されます。";
  }
  const parts=[];
  if (benchmark && benchmark.days >= 3) {
    const pd = m.profit - benchmark.profit;
    if (pd > Math.max(3000, Math.abs(benchmark.profit)*0.15)) parts.push(`利益は直近${benchmark.days}回の仕入れ日の平均より高いペースです。`);
    else if (pd < -Math.max(3000, Math.abs(benchmark.profit)*0.15)) parts.push(`利益は直近${benchmark.days}回の仕入れ日の平均を下回っています。`);
    else parts.push(`利益は直近${benchmark.days}回の仕入れ日の平均に近い水準です。`);
    if (m.rate >= benchmark.rate + 8) parts.push("成功率も普段より高く、店舗選びが効率よく当たっています。");
    else if (m.rate <= benchmark.rate - 8) parts.push("成功率は普段より低めなので、後半は期待値の高い店舗を優先すると改善しやすそうです。");
  } else {
    parts.push(m.rate >= 35 ? "成功率はまずまず高い水準です。" : "成功率はまだ低めなので、期待値の高い店舗を優先して回る余地があります。");
  }
  if (minutes >= 30) {
    const ph = m.profit / (minutes/60);
    if (ph >= 5000) parts.push("利益時給は5,000円を超えており、時間効率も良好です。");
    else if (ph > 0 && ph < 2500) parts.push("利益時給は低めなので、移動時間や空振り店舗を減らせると効率改善につながります。");
  }
  if (active) parts.push("現在も仕入れ中なので、終了後に最終結果へ更新されます。");
  return parts.join("");
}

function renderAiSourcingSummary(dayStr) {
  const metricsEl=document.getElementById("aiSourcingMetrics"), commentEl=document.getElementById("aiSourcingComment"), stateEl=document.getElementById("aiSourcingSummaryState");
  const titleEl=document.getElementById("aiSourcingSummaryTitle");
  if (!metricsEl || !commentEl) return;

  const targetDay=dayStr || selectedDay || todayStr();
  const today=todayStr();
  const isToday=targetDay===today;
  const logs=loadLogs();
  const m=getDayActivityMetrics(targetDay, logs);
  const sessions=loadReportSourcingSessions().filter(x=>String(x.date||"")===targetDay);
  const active=loadReportActiveSourcingSession();
  const activeForDay=!!(isToday && active && String(active.date||"")===targetDay);
  let minutes=sessions.reduce((sum,x)=>sum+reportSessionMinutes(x),0);
  if (activeForDay) minutes += reportSessionMinutes(active);

  const hours=minutes/60;
  const profitPerHour=hours>0?m.profit/hours:0, visitsPerHour=hours>0?m.visits/hours:0, itemsPerHour=hours>0?m.items/hours:0;
  const cards=[
    ["活動時間", minutes>0?formatReportActivityTime(minutes):"未記録"], ["訪問",`${m.visits}回`], ["成功",`${m.success}回`],
    ["成功率",`${m.rate.toFixed(1)}%`], ["仕入れ個数",`${m.items}個`], ["利益",yen(m.profit)],
    ["利益時給",minutes>0?`${Math.round(profitPerHour).toLocaleString()}円/h`:"-"], ["訪問効率",minutes>0?`${visitsPerHour.toFixed(1)}店/h`:"-"], ["個数効率",minutes>0?`${itemsPerHour.toFixed(1)}個/h`:"-"]
  ];
  metricsEl.innerHTML=cards.map(([label,value])=>`<div class="aiSourcingMetric"><div class="aiSourcingMetricLabel">${escapeHtml(label)}</div><div class="aiSourcingMetricValue">${escapeHtml(value)}</div></div>`).join("");

  const benchmark=buildRecentDayBenchmark(logs,targetDay);
  let comment=buildSourcingAutoComment(m,benchmark,minutes,activeForDay);
  if (!minutes && targetDay < today && (m.visits>0 || m.success>0 || m.items>0 || m.profit!==0)) {
    comment += " この日は仕入れ時間の記録がないため、利益時給・訪問効率・個数効率は表示していません。";
  }
  commentEl.innerHTML=`<div class="aiSourcingCommentTitle">自動分析</div>${escapeHtml(comment)}`;

  if (titleEl) titleEl.textContent=isToday?"🤖 今日の仕入れ総評":`🤖 ${targetDay} の仕入れ総評`;
  if (stateEl) stateEl.textContent=activeForDay?"🟢 仕入れ中":(isToday?"本日集計":"過去日集計");
}

// 既存のbootReportを壊さず、描画後に総評カードだけ更新する
const originalBootReportForAiSummary = bootReport;
bootReport = function() {
  originalBootReportForAiSummary();
  renderAiSourcingSummary(selectedDay || todayStr());
};

/* =========================
   AI分析用データ生成エンジン v1
   - AIには計算済みの数値だけを渡す
   - 選択日 / 直近30日 / 同曜日 / 店舗別 / 時間帯別 / 訪問間隔を生成
========================= */
const AI_ANALYSIS_PAYLOAD_KEY = "ai_analysis_payload_v1";

function aiSafeIsoMs(value) {
  const ms = new Date(value || "").getTime();
  return Number.isFinite(ms) ? ms : null;
}

function aiWeekdayLabel(dayStr) {
  const d = new Date(`${dayStr}T12:00:00+09:00`);
  return ["日","月","火","水","木","金","土"][d.getDay()] || "";
}

function aiDateDiffDays(fromDay, toDay) {
  const a = new Date(`${fromDay}T12:00:00+09:00`).getTime();
  const b = new Date(`${toDay}T12:00:00+09:00`).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b-a)/86400000) : null;
}

function aiTimeBand(iso) {
  const ms = aiSafeIsoMs(iso);
  if (ms == null) return "unknown";
  const hour = Number(new Intl.DateTimeFormat("ja-JP", { timeZone:"Asia/Tokyo", hour:"2-digit", hour12:false }).format(new Date(ms)));
  if (hour < 10) return "before10";
  if (hour < 12) return "10-12";
  if (hour < 15) return "12-15";
  if (hour < 18) return "15-18";
  return "after18";
}

function aiDayRawStats(logs, dayStr) {
  const x = { date:dayStr, weekday:aiWeekdayLabel(dayStr), profit:0, visits:0, success:0, items:0 };
  (logs || []).forEach(log => {
    if (ymd(log.date) !== dayStr) return;
    const n = Number(log.delta || 0);
    if (log.type === "visit") x.visits += n;
    else if (log.type === "success") x.success += n;
    else if (log.type === "items") x.items += n;
    else if (log.type === "profit" || log.type === "profit_adjust") x.profit += n;
  });
  x.rate = x.visits > 0 ? (x.success / x.visits) * 100 : 0;
  x.profitPerVisit = x.visits > 0 ? x.profit / x.visits : 0;
  return x;
}

function aiSessionMinutesForDay(dayStr) {
  const sessions = loadReportSourcingSessions().filter(x => String(x.date || "") === dayStr);
  let minutes = sessions.reduce((sum,x) => sum + reportSessionMinutes(x), 0);
  const active = loadReportActiveSourcingSession();
  if (active && String(active.date || "") === dayStr) minutes += reportSessionMinutes(active);
  return minutes;
}

function aiEnrichDay(stats) {
  const minutes = aiSessionMinutesForDay(stats.date);
  const hours = minutes / 60;
  return {
    ...stats,
    activityMinutes: minutes,
    profitPerHour: hours > 0 ? stats.profit / hours : null,
    visitsPerHour: hours > 0 ? stats.visits / hours : null,
    itemsPerHour: hours > 0 ? stats.items / hours : null
  };
}

function aiAverageDays(days) {
  if (!days.length) return null;
  const avg = key => days.reduce((s,x)=>s+Number(x[key] || 0),0) / days.length;
  const withTime = days.filter(x => Number(x.activityMinutes || 0) > 0);
  const avgTimed = key => withTime.length ? withTime.reduce((s,x)=>s+Number(x[key] || 0),0)/withTime.length : null;
  return {
    sampleDays: days.length,
    timedSampleDays: withTime.length,
    profit: avg("profit"), visits: avg("visits"), success: avg("success"), items: avg("items"), rate: avg("rate"),
    activityMinutes: withTime.length ? avgTimed("activityMinutes") : null,
    profitPerHour: avgTimed("profitPerHour"), visitsPerHour: avgTimed("visitsPerHour"), itemsPerHour: avgTimed("itemsPerHour")
  };
}

function aiStoreAnalysis(logs, stores, targetDay) {
  const storeMap = new Map((stores || []).map(s => [String(s.id), s]));
  const grouped = new Map();
  (logs || []).forEach(log => {
    const d = ymd(log.date);
    if (!d || d > targetDay) return;
    const id = String(log.storeId || "");
    if (!id) return;
    if (!grouped.has(id)) grouped.set(id, { storeId:id, visits:0, success:0, items:0, profit:0, visitDates:[] });
    const g = grouped.get(id), n = Number(log.delta || 0);
    if (log.type === "visit") { g.visits += n; if (n > 0) g.visitDates.push(d); }
    else if (log.type === "success") g.success += n;
    else if (log.type === "items") g.items += n;
    else if (log.type === "profit" || log.type === "profit_adjust") g.profit += n;
  });
  return Array.from(grouped.values()).map(g => {
    const s = storeMap.get(g.storeId) || {};
    const dates = Array.from(new Set(g.visitDates)).sort();
    const last = dates.filter(d=>d<=targetDay).at(-1) || null;
    const prev = dates.filter(d=>d<targetDay).at(-1) || null;
    return {
      storeId:g.storeId, name:String(s.name || "不明店舗"), pref:String(s.pref || ""),
      visits:g.visits, success:g.success, successRate:g.visits>0?(g.success/g.visits)*100:0,
      items:g.items, profit:g.profit, profitPerVisit:g.visits>0?g.profit/g.visits:0,
      lastVisitDate:last, daysSincePreviousVisit: prev ? aiDateDiffDays(prev,targetDay) : null
    };
  }).filter(x=>x.visits>0 || x.success>0 || x.items>0 || x.profit!==0).sort((a,b)=>b.profit-a.profit);
}

function aiTimeBandAnalysis(logs, targetDay) {
  const result = {};
  ["before10","10-12","12-15","15-18","after18","unknown"].forEach(k => result[k] = { visits:0, success:0, items:0, profit:0 });
  (logs || []).forEach(log => {
    const d = ymd(log.date);
    if (!d || d > targetDay || !log.createdAt) return;
    const band = aiTimeBand(log.createdAt), n=Number(log.delta || 0), r=result[band];
    if (log.type === "visit") r.visits += n;
    else if (log.type === "success") r.success += n;
    else if (log.type === "items") r.items += n;
    else if (log.type === "profit" || log.type === "profit_adjust") r.profit += n;
  });
  Object.values(result).forEach(r => { r.successRate = r.visits>0 ? (r.success/r.visits)*100 : 0; r.profitPerVisit = r.visits>0 ? r.profit/r.visits : 0; });
  return result;
}

function buildAiAnalysisPayload(targetDay = selectedDay || todayStr()) {
  const logs = loadLogs(), stores = loadStores();
  const day = targetDay || todayStr();
  const target = aiEnrichDay(aiDayRawStats(logs, day));
  const activeDays = Array.from(new Set((logs || []).map(x=>ymd(x.date)).filter(d=>d && d<day))).sort().reverse();
  const recent30 = activeDays.slice(0,30).map(d=>aiEnrichDay(aiDayRawStats(logs,d))).filter(x=>x.visits>0 || x.success>0 || x.items>0 || x.profit!==0);
  const weekday = aiWeekdayLabel(day);
  const sameWeekday = activeDays.filter(d=>aiWeekdayLabel(d)===weekday).slice(0,12).map(d=>aiEnrichDay(aiDayRawStats(logs,d))).filter(x=>x.visits>0 || x.success>0 || x.items>0 || x.profit!==0);
  const storesAll = aiStoreAnalysis(logs, stores, day);
  const todayStoreIds = new Set((logs || []).filter(x=>ymd(x.date)===day && x.type==="visit" && Number(x.delta||0)>0).map(x=>String(x.storeId||"")));
  const payload = {
    schemaVersion:1,
    generatedAt:new Date().toISOString(),
    targetDate:day,
    targetWeekday:weekday,
    target,
    comparisons:{ recent30:aiAverageDays(recent30), sameWeekday:aiAverageDays(sameWeekday) },
    targetDayStores:storesAll.filter(x=>todayStoreIds.has(x.storeId)),
    topStoresByProfit:storesAll.slice(0,10),
    timeBands:aiTimeBandAnalysis(logs,day),
    dataQuality:{
      totalLogCount:(logs||[]).length,
      recentSampleDays:recent30.length,
      sameWeekdaySampleDays:sameWeekday.length,
      targetHasActivityTime:target.activityMinutes>0,
      logsWithTimestamp:(logs||[]).filter(x=>x.createdAt).length,
      note:"時間帯分析はcreatedAtを持つ新しい記録ほど精度が高く、導入前の過去ログは時間帯分析に含まれません。"
    }
  };
  try { localStorage.setItem(AI_ANALYSIS_PAYLOAD_KEY, JSON.stringify(payload)); } catch {}
  return payload;
}

window.buildAiAnalysisPayload = buildAiAnalysisPayload;

// レポート描画のたびに、選択日のAI分析用データも最新化する
const originalRenderAiSourcingSummaryForPayload = renderAiSourcingSummary;
renderAiSourcingSummary = function(dayStr) {
  originalRenderAiSourcingSummaryForPayload(dayStr);
  buildAiAnalysisPayload(dayStr || selectedDay || todayStr());
};


/* =========================
   OpenAI 詳細分析接続 v1
   Cloudflare Worker 経由。APIキーはブラウザに置かない。
========================= */
const AI_WORKER_URL = "https://sedori-gps-ai.momo-ano19.workers.dev";
const AI_DEEP_CACHE_KEY = "ai_deep_analysis_cache_v1";

function loadAiDeepCache() {
  try {
    const x = JSON.parse(localStorage.getItem(AI_DEEP_CACHE_KEY) || "{}");
    return x && typeof x === "object" && !Array.isArray(x) ? x : {};
  } catch { return {}; }
}

function saveAiDeepCache(cache) {
  try { localStorage.setItem(AI_DEEP_CACHE_KEY, JSON.stringify(cache || {})); } catch {}
}

function aiPayloadFingerprint(payload) {
  const copy = JSON.parse(JSON.stringify(payload || {}));
  delete copy.generatedAt;
  const text = JSON.stringify(copy);
  let h = 2166136261;
  for (let i=0;i<text.length;i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8,"0");
}

function formatAiDeepSavedAt(iso) {
  const d = new Date(iso || "");
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {timeZone:"Asia/Tokyo", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit"}).format(d);
}

function aiDeepSectionKind(title) {
  const t = String(title || "");
  if (/総合評価|総評|結論|全体/.test(t)) return { cls:"overall", icon:"📊", label:"総合評価・今日の結論" };
  if (/良かった|強み|評価できる|プラス/.test(t)) return { cls:"good", icon:"👍", label:"良かった点" };
  if (/改善|課題|注意|弱み/.test(t)) return { cls:"improve", icon:"⚠️", label:"改善ポイント" };
  if (/店舗|時間帯|訪問間隔|傾向/.test(t)) return { cls:"store", icon:"🏪", label:"店舗・時間帯分析" };
  if (/次回|提案|アドバイス|行動|意識/.test(t)) return { cls:"next", icon:"🎯", label:"次回のアドバイス" };
  return { cls:"detail", icon:"🔎", label:t.replace(/^#+\s*|^\d+[\.．、)]\s*/g, "").trim() || "詳しい分析" };
}

function renderAiDeepAnalysisHtml(text) {
  const raw = String(text || "").replace(/\r/g, "").trim();
  if (!raw) return "";
  const lines = raw.split("\n");
  const sections = [];
  let current = { title:"", lines:[] };
  const isHeading = (line) => {
    const x = line.trim();
    if (!x) return false;
    if (/^#{1,4}\s+/.test(x)) return true;
    if (/^(?:\d+|[①-⑩])[\.．、):：]\s*/.test(x) && x.length < 80) return true;
    if (/^(?:【.+】|[■◆●]\s*.+)$/.test(x) && x.length < 80) return true;
    if (/^(?:総合評価|今日の結論|良かった点|改善(?:ポイント|点)|店舗・時間帯分析|店舗分析|時間帯分析|次回(?:の)?(?:提案|アドバイス|行動))\s*[：:]?/.test(x) && x.length < 100) return true;
    return false;
  };
  const push = () => {
    if (current.title || current.lines.some(x=>x.trim())) sections.push(current);
    current = { title:"", lines:[] };
  };
  for (const line of lines) {
    if (isHeading(line)) {
      push();
      current.title = line.trim().replace(/^#{1,4}\s*/, "").replace(/^【|】$/g, "");
    } else current.lines.push(line);
  }
  push();
  if (!sections.length) sections.push({title:"総合評価・今日の結論", lines:[raw]});

  return `<details class="aiDeepAccordion" open><summary class="aiDeepAccordionSummary"><span>🤖 AI仕入れ総評</span></summary><div class="aiDeepAccordionSub">タップで開閉できます｜蓄積データをもとにAIが分析した結果です</div><div class="aiDeepAnalysisCards">${sections.map((sec, idx)=>{
    const kind = aiDeepSectionKind(sec.title || (idx===0 ? "総合評価" : ""));
    const body = sec.lines.join("\n").trim();
    const displayTitle = sec.title ? sec.title.replace(/^\d+[\.．、):：]\s*/, "").trim() : kind.label;
    const safeBody = escapeHtml(body).replace(/^[-・]\s*/gm, "• ").replace(/\n/g,"<br>");
    return `<section class="aiDeepCard aiDeepCard--${kind.cls}"><div class="aiDeepCardTitle"><span>${kind.icon}</span><span>${escapeHtml(displayTitle || kind.label)}</span></div><div class="aiDeepCardBody">${safeBody || "データ不足"}</div></section>`;
  }).join("")}</div></details>`;
}

function showAiDeepAnalysis(resultEl, analysis) {
  if (!resultEl) return;
  resultEl.hidden = false;
  resultEl.innerHTML = renderAiDeepAnalysisHtml(analysis);
}

function renderAiDeepAnalysisForDay(dayStr) {
  const resultEl = document.getElementById("aiDeepAnalysisResult");
  const metaEl = document.getElementById("aiDeepAnalysisMeta");
  const btn = document.getElementById("aiDeepAnalysisBtn");
  if (!resultEl || !btn) return;
  const day = dayStr || selectedDay || todayStr();
  const payload = buildAiAnalysisPayload(day);
  const fp = aiPayloadFingerprint(payload);
  const cached = loadAiDeepCache()[day];
  if (cached && cached.fingerprint === fp && cached.analysis) {
    showAiDeepAnalysis(resultEl, cached.analysis);
    btn.textContent = "🤖 AIで再分析";
    if (metaEl) metaEl.textContent = `保存済み分析：${formatAiDeepSavedAt(cached.createdAt)}（データが変わるまで再利用）`;
  } else {
    resultEl.hidden = true;
    resultEl.innerHTML = "";
    btn.textContent = "🤖 AIで詳しく分析";
    if (metaEl) metaEl.textContent = cached ? "記録が更新されています。AI分析を更新できます。" : "ボタンを押した時だけAPIを使用します。";
  }
}

async function requestAiDeepAnalysis() {
  const btn = document.getElementById("aiDeepAnalysisBtn");
  const resultEl = document.getElementById("aiDeepAnalysisResult");
  const metaEl = document.getElementById("aiDeepAnalysisMeta");
  if (!btn || !resultEl) return;
  const day = selectedDay || todayStr();
  const payload = buildAiAnalysisPayload(day);
  const fp = aiPayloadFingerprint(payload);
  const cache = loadAiDeepCache();
  const cached = cache[day];

  if (cached && cached.fingerprint === fp && cached.analysis) {
    showAiDeepAnalysis(resultEl, cached.analysis);
    if (metaEl) metaEl.textContent = `保存済み分析：${formatAiDeepSavedAt(cached.createdAt)}。再分析する場合はもう一度ボタンを押してください。`;
    // 2回目の明示クリックは再分析を許可
    if (btn.dataset.cacheShown !== "1") { btn.dataset.cacheShown = "1"; return; }
  }

  btn.disabled = true;
  btn.textContent = "AI分析中…";
  if (metaEl) metaEl.textContent = "仕入れデータをAIが分析しています。";
  resultEl.hidden = false;
  resultEl.innerHTML = `<div class="aiDeepAnalysisLoading">🤖 分析中です…</div>`;

  try {
    const res = await fetch(AI_WORKER_URL, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({mode:"summary",analysisData:payload})
    });
    const data = await res.json().catch(()=>({}));
    if (!res.ok || !data.ok || !data.analysis) throw new Error(data.details || data.error || `HTTP ${res.status}`);

    cache[day] = { fingerprint:fp, analysis:String(data.analysis), createdAt:new Date().toISOString() };
    saveAiDeepCache(cache);
    showAiDeepAnalysis(resultEl, data.analysis);
    if (metaEl) metaEl.textContent = `分析結果を保存しました：${formatAiDeepSavedAt(cache[day].createdAt)}`;
    btn.dataset.cacheShown = "0";
  } catch (e) {
    resultEl.innerHTML = `<div class="aiDeepAnalysisError">AI分析に接続できませんでした。<br>${escapeHtml(String(e?.message || e))}</div>`;
    if (metaEl) metaEl.textContent = "Worker・APIキー・OpenAIの課金設定を確認してください。";
  } finally {
    btn.disabled = false;
    btn.textContent = "🤖 AIで再分析";
  }
}
window.requestAiDeepAnalysis = requestAiDeepAnalysis;

const originalRenderAiSourcingSummaryForDeepAi = renderAiSourcingSummary;
renderAiSourcingSummary = function(dayStr) {
  originalRenderAiSourcingSummaryForDeepAi(dayStr);
  const btn = document.getElementById("aiDeepAnalysisBtn");
  if (btn) btn.dataset.cacheShown = "0";
  renderAiDeepAnalysisForDay(dayStr || selectedDay || todayStr());
};


/* =========================
   月間AI総評 v1
   - 選択月の実績を月単位で集計
   - 日次AIとは別キャッシュ
========================= */
const AI_MONTHLY_CACHE_KEY = "ai_monthly_analysis_cache_v1";

function loadAiMonthlyCache() {
  try {
    const x = JSON.parse(localStorage.getItem(AI_MONTHLY_CACHE_KEY) || "{}");
    return x && typeof x === "object" && !Array.isArray(x) ? x : {};
  } catch { return {}; }
}
function saveAiMonthlyCache(cache) {
  try { localStorage.setItem(AI_MONTHLY_CACHE_KEY, JSON.stringify(cache || {})); } catch {}
}
function aiMonthDays(monthStr) {
  const logs = loadLogs();
  const set = new Set((logs || []).map(x=>ymd(x.date)).filter(d=>d && ym(d)===monthStr));
  return Array.from(set).sort().map(d=>aiEnrichDay(aiDayRawStats(logs,d))).filter(x=>x.visits>0 || x.success>0 || x.items>0 || x.profit!==0);
}
function aiMonthlyStoreAnalysis(logs, stores, monthStr) {
  const storeMap = new Map((stores || []).map(s=>[String(s.id),s]));
  const grouped = new Map();
  (logs || []).forEach(log=>{
    const d=ymd(log.date); if(!d || ym(d)!==monthStr) return;
    const id=String(log.storeId||""); if(!id) return;
    if(!grouped.has(id)) grouped.set(id,{storeId:id,visits:0,success:0,items:0,profit:0,visitDates:new Set()});
    const g=grouped.get(id), n=Number(log.delta||0);
    if(log.type==="visit"){g.visits+=n;if(n>0)g.visitDates.add(d);}
    else if(log.type==="success")g.success+=n;
    else if(log.type==="items")g.items+=n;
    else if(log.type==="profit"||log.type==="profit_adjust")g.profit+=n;
  });
  return Array.from(grouped.values()).map(g=>{
    const st=storeMap.get(g.storeId)||{};
    return {storeId:g.storeId,name:String(st.name||"不明店舗"),pref:String(st.pref||""),visits:g.visits,success:g.success,successRate:g.visits>0?g.success/g.visits*100:0,items:g.items,profit:g.profit,profitPerVisit:g.visits>0?g.profit/g.visits:0,visitDays:g.visitDates.size};
  }).filter(x=>x.visits>0||x.success>0||x.items>0||x.profit!==0).sort((a,b)=>b.profit-a.profit);
}
function buildAiMonthlyAnalysisPayload(monthStr = selectedMonth || currentMonthStr()) {
  const month=monthStr||currentMonthStr(), logs=loadLogs(), stores=loadStores();
  const days=aiMonthDays(month);
  const totals=days.reduce((a,x)=>{a.profit+=Number(x.profit||0);a.visits+=Number(x.visits||0);a.success+=Number(x.success||0);a.items+=Number(x.items||0);a.activityMinutes+=Number(x.activityMinutes||0);return a;},{profit:0,visits:0,success:0,items:0,activityMinutes:0});
  totals.successRate=totals.visits>0?totals.success/totals.visits*100:0;
  totals.profitPerVisit=totals.visits>0?totals.profit/totals.visits:0;
  totals.profitPerHour=totals.activityMinutes>0?totals.profit/(totals.activityMinutes/60):null;
  totals.visitsPerHour=totals.activityMinutes>0?totals.visits/(totals.activityMinutes/60):null;
  totals.itemsPerHour=totals.activityMinutes>0?totals.items/(totals.activityMinutes/60):null;
  totals.sourcingDays=days.length;
  const prevDate=new Date(`${month}-01T00:00:00`);prevDate.setMonth(prevDate.getMonth()-1);
  const prevMonth=`${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,"0")}`;
  const prevDays=aiMonthDays(prevMonth);
  const payload={schemaVersion:1,periodType:"month",generatedAt:new Date().toISOString(),targetMonth:month,totals,averagePerSourcingDay:aiAverageDays(days),dailyResults:days,topStores:aiMonthlyStoreAnalysis(logs,stores,month).slice(0,15),previousMonth:{month:prevMonth,averagePerSourcingDay:aiAverageDays(prevDays),sourcingDays:prevDays.length},dataQuality:{totalLogCount:(logs||[]).length,sourcingDays:days.length,timedSourcingDays:days.filter(x=>Number(x.activityMinutes||0)>0).length,logsWithTimestamp:(logs||[]).filter(x=>x.createdAt && ym(ymd(x.date))===month).length,note:"時間効率は仕入れセッション記録がある日のみ正確に評価できます。"}};
  return payload;
}
window.buildAiMonthlyAnalysisPayload=buildAiMonthlyAnalysisPayload;

function renderAiMonthlyAnalysisForMonth(monthStr) {
  const resultEl=document.getElementById("aiMonthlyAnalysisResult"),metaEl=document.getElementById("aiMonthlyAnalysisMeta"),btn=document.getElementById("aiMonthlyAnalysisBtn"),title=document.getElementById("aiMonthlySummaryTitle");
  if(!resultEl||!btn)return;
  const month=monthStr||selectedMonth||currentMonthStr();
  if(title)title.textContent=`📅 ${month} のAI月間総評`;
  const payload=buildAiMonthlyAnalysisPayload(month),fp=aiPayloadFingerprint(payload),cached=loadAiMonthlyCache()[month];
  btn.dataset.cacheShown="0";
  if(cached&&cached.fingerprint===fp&&cached.analysis){showAiDeepAnalysis(resultEl,cached.analysis);btn.textContent="📅 この月をAIで再分析";if(metaEl)metaEl.textContent=`保存済み月間総評：${formatAiDeepSavedAt(cached.createdAt)}（データが変わるまで再利用）`;}
  else{resultEl.hidden=true;resultEl.innerHTML="";btn.textContent="📅 この月をAIで総評";if(metaEl)metaEl.textContent=cached?"この月の記録が更新されています。月間総評を更新できます。":"ボタンを押した時だけAPIを使用します。";}
}

async function requestAiMonthlyAnalysis(){
  const btn=document.getElementById("aiMonthlyAnalysisBtn"),resultEl=document.getElementById("aiMonthlyAnalysisResult"),metaEl=document.getElementById("aiMonthlyAnalysisMeta");
  if(!btn||!resultEl)return;
  const month=selectedMonth||currentMonthStr(),payload=buildAiMonthlyAnalysisPayload(month),fp=aiPayloadFingerprint(payload),cache=loadAiMonthlyCache(),cached=cache[month];
  if(cached&&cached.fingerprint===fp&&cached.analysis){showAiDeepAnalysis(resultEl,cached.analysis);if(metaEl)metaEl.textContent=`保存済み月間総評：${formatAiDeepSavedAt(cached.createdAt)}。再分析する場合はもう一度押してください。`;if(btn.dataset.cacheShown!=="1"){btn.dataset.cacheShown="1";return;}}
  btn.disabled=true;btn.textContent="月間AI分析中…";resultEl.hidden=false;resultEl.innerHTML='<div class="aiDeepAnalysisLoading">🤖 1か月分を分析中です…</div>';if(metaEl)metaEl.textContent="選択月の仕入れデータをAIが分析しています。";
  try{
    const res=await fetch(AI_WORKER_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"monthly_summary",analysisData:payload})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok||!data.ok||!data.analysis)throw new Error(data.details||data.error||`HTTP ${res.status}`);
    cache[month]={fingerprint:fp,analysis:String(data.analysis),createdAt:new Date().toISOString()};saveAiMonthlyCache(cache);showAiDeepAnalysis(resultEl,data.analysis);if(metaEl)metaEl.textContent=`月間総評を保存しました：${formatAiDeepSavedAt(cache[month].createdAt)}`;btn.dataset.cacheShown="0";
  }catch(e){resultEl.innerHTML=`<div class="aiDeepAnalysisError">月間AI分析に接続できませんでした。<br>${escapeHtml(String(e?.message||e))}</div>`;if(metaEl)metaEl.textContent="Workerが月間分析対応版か確認してください。";}
  finally{btn.disabled=false;btn.textContent="📅 この月をAIで再分析";}
}
window.requestAiMonthlyAnalysis=requestAiMonthlyAnalysis;

const originalBootReportForMonthlyAi=bootReport;
bootReport=function(){originalBootReportForMonthlyAi();renderAiMonthlyAnalysisForMonth(selectedMonth||currentMonthStr());};

/* =========================
   AI次回仕入れプラン v1
========================= */
const AI_NEXT_PLAN_CACHE_KEY = "ai_next_plan_cache_v1";

function aiPlanTomorrowStr() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Tokyo", year:"numeric", month:"2-digit", day:"2-digit"}).formatToParts(now);
  const y=Number(parts.find(x=>x.type==="year")?.value), m=Number(parts.find(x=>x.type==="month")?.value), d=Number(parts.find(x=>x.type==="day")?.value);
  const dt = new Date(Date.UTC(y,m-1,d+1,3));
  return new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Tokyo", year:"numeric", month:"2-digit", day:"2-digit"}).format(dt);
}

function initAiNextPlanInputs() {
  // 入力欄は初期値を入れず、ユーザーが使う時に指定する。
}

function loadAiNextPlanCache() {
  try { const x=JSON.parse(localStorage.getItem(AI_NEXT_PLAN_CACHE_KEY)||"{}"); return x&&typeof x==="object"&&!Array.isArray(x)?x:{}; } catch { return {}; }
}
function saveAiNextPlanCache(x) { try { localStorage.setItem(AI_NEXT_PLAN_CACHE_KEY, JSON.stringify(x||{})); } catch {} }

function buildAiNextPlanPayload() {
  const plannedDate=document.getElementById("aiPlanDate")?.value || "";
  const startTime=document.getElementById("aiPlanStartTime")?.value || "";
  const hoursRaw=document.getElementById("aiPlanHours")?.value || "";
  const targetRaw=document.getElementById("aiPlanTargetProfit")?.value || "";
  const hours=hoursRaw === "" ? null : Math.max(.5, Math.min(16, Number(hoursRaw)));
  const targetProfit=targetRaw === "" ? null : Math.max(0, Number(targetRaw));
  const cutoff = plannedDate > todayStr() ? todayStr() : plannedDate;
  const logs=loadLogs(), stores=loadStores();
  const history=aiStoreAnalysis(logs, stores, cutoff);
  const historyMap=new Map(history.map(x=>[String(x.storeId),x]));
  const candidates=(stores||[]).map(s=>{
    const h=historyMap.get(String(s.id)) || {visits:0,success:0,successRate:0,items:0,profit:0,profitPerVisit:0,lastVisitDate:null};
    const daysSince=h.lastVisitDate ? aiDateDiffDays(h.lastVisitDate, plannedDate) : null;
    return {
      storeId:String(s.id||""), name:String(s.name||""), pref:String(s.pref||""), address:String(s.address||""),
      visits:Number(h.visits||0), success:Number(h.success||0), successRate:Number(h.successRate||0), items:Number(h.items||0),
      totalProfit:Number(h.profit||0), expectedProfitPerVisit:Number(h.profitPerVisit||0), lastVisitDate:h.lastVisitDate||null,
      daysSinceLastVisit:daysSince,
      hasCoordinates:Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)),
      lat:Number.isFinite(Number(s.lat))?Number(s.lat):null, lng:Number.isFinite(Number(s.lng))?Number(s.lng):null
    };
  }).filter(x=>x.name).sort((a,b)=>b.expectedProfitPerVisit-a.expectedProfitPerVisit || b.successRate-a.successRate).slice(0,80);

  const activeDays=Array.from(new Set((logs||[]).map(x=>ymd(x.date)).filter(d=>d && d<plannedDate))).sort().reverse();
  const recent30=activeDays.slice(0,30).map(d=>aiEnrichDay(aiDayRawStats(logs,d))).filter(x=>x.visits>0||x.success>0||x.items>0||x.profit!==0);
  const wd=aiWeekdayLabel(plannedDate);
  const sameWd=activeDays.filter(d=>aiWeekdayLabel(d)===wd).slice(0,12).map(d=>aiEnrichDay(aiDayRawStats(logs,d))).filter(x=>x.visits>0||x.success>0||x.items>0||x.profit!==0);
  return {
    schemaVersion:1, generatedAt:new Date().toISOString(), requestType:"next_sourcing_plan",
    conditions:{plannedDate, weekday:wd, startTime, plannedHours:hours, targetProfit},
    benchmarks:{recent30:aiAverageDays(recent30), sameWeekday:aiAverageDays(sameWd)},
    timeBands:aiTimeBandAnalysis(logs, cutoff), candidates,
    dataQuality:{totalStores:(stores||[]).length, candidateStores:candidates.length, totalLogCount:(logs||[]).length, recentSampleDays:recent30.length, sameWeekdaySampleDays:sameWd.length, note:"訪問時刻の記録開始前は時間帯データが不足します。未訪問店舗は実績0として候補に含まれます。"}
  };
}

function aiPlanFingerprint(payload) { return aiPayloadFingerprint(payload); }

let currentAiNextPlanText = "";

function extractAiPlanStoreIds(planText) {
  const text=String(planText||"");
  const stores=loadStores();
  const hits=[];
  for (const s of stores) {
    const name=String(s?.name||"").trim();
    if (!name || !s?.id) continue;
    const pos=text.indexOf(name);
    if (pos>=0) hits.push({id:String(s.id),name,pos,len:name.length});
  }
  // 同じ位置で名称が重なる場合は長い店舗名を優先し、同一IDは1回だけにする
  hits.sort((a,b)=>a.pos-b.pos || b.len-a.len);
  const used=new Set(), out=[];
  for (const h of hits) {
    if (used.has(h.id)) continue;
    used.add(h.id); out.push(h);
  }
  return out;
}

function updateAiPlanRouteAction(planText) {
  currentAiNextPlanText=String(planText||"");
  const wrap=document.getElementById("aiNextPlanRouteActions");
  const meta=document.getElementById("aiApplyRouteMeta");
  const btn=document.getElementById("aiApplyRouteBtn");
  if (!wrap || !btn) return;
  const hits=extractAiPlanStoreIds(currentAiNextPlanText);
  wrap.hidden=false;
  btn.disabled=hits.length===0;
  if (meta) meta.textContent=hits.length
    ? `登録店舗と ${hits.length} 店舗一致しました。AIの提案順で「今日行く」に反映します。`
    : "AIプラン内の店舗名と登録店舗が一致しませんでした。ルートへの自動反映は行いません。";
}

function applyAiNextPlanToTodayRoute() {
  const hits=extractAiPlanStoreIds(currentAiNextPlanText);
  if (!hits.length) { alert("AIプラン内で登録店舗と一致する店舗が見つかりませんでした。"); return; }
  const stores=loadStores();
  const current=(stores||[]).filter(s=>s.today).length;
  const names=hits.map(x=>x.name);
  const preview=names.slice(0,8).map((n,i)=>`${i+1}. ${n}`).join("\n") + (names.length>8?`\n…ほか${names.length-8}店舗`:"");
  const msg=(current>0
    ? `現在の「今日行く」${current}店舗をAIプランに置き換えます。\n\n`
    : "AIプランを「今日のルート」に設定します。\n\n")
    + preview + "\n\nこの内容で反映しますか？";
  if (!confirm(msg)) return;

  const idSet=new Set(hits.map(x=>x.id));
  for (const s of stores) s.today=idSet.has(String(s.id));
  saveStores(stores);
  const order=hits.map(x=>x.id);
  try {
    localStorage.setItem("today_route_order", JSON.stringify(order));
    // 旧キーが残っている環境でも同じ順番になるよう同期
    ["sedori_today_route_order_v2","sedori_today_route_order_v1","sedori_today_route_order"].forEach(k=>localStorage.setItem(k,JSON.stringify(order)));
    localStorage.setItem("today_route_visited_ids", JSON.stringify([]));
  } catch(e) { console.error("AI route save error",e); }
  invalidateReportCache();
  const meta=document.getElementById("aiApplyRouteMeta");
  if (meta) meta.textContent=`✅ ${order.length}店舗をAI推奨順で今日のルートに設定しました。トップ画面で確認できます。`;
  alert(`AIプランの${order.length}店舗を「今日のルート」に設定しました。`);
}
window.applyAiNextPlanToTodayRoute=applyAiNextPlanToTodayRoute;

/* =========================
   AI × 移動効率 ルート最適化 v1
   - ブラウザ現在地を開始地点として使用
   - 道路距離ではなく座標間の直線距離
   - AIが選んだ店舗だけを対象に並べ替える
========================= */
function aiRouteHaversineKm(aLat,aLng,bLat,bLng) {
  const R=6371, rad=x=>Number(x)*Math.PI/180;
  const dLat=rad(bLat-aLat), dLng=rad(bLng-aLng);
  const q=Math.sin(dLat/2)**2 + Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(q));
}

function aiRouteCandidateMap() {
  try {
    const payload=buildAiNextPlanPayload();
    return new Map((payload.candidates||[]).map(x=>[String(x.storeId),x]));
  } catch { return new Map(); }
}

function aiRouteValueScore(c) {
  if (!c) return 1;
  const expected=Math.max(0,Number(c.expectedProfitPerVisit||0));
  const rate=Math.max(0,Math.min(100,Number(c.successRate||0)));
  const visits=Math.max(0,Number(c.visits||0));
  const days=c.daysSinceLastVisit==null ? 21 : Math.max(0,Number(c.daysSinceLastVisit||0));
  // 金額の極端な差を抑えつつ、成功率・データ信頼度・再訪余地を加味
  const profitScore=Math.log1p(expected/1000);
  const rateScore=rate/100;
  const confidence=Math.min(1,visits/5);
  const recency=Math.min(1.35,0.75+days/60);
  return Math.max(.35,(1+profitScore*1.35+rateScore*.8)*(0.72+confidence*.28)*recency);
}

function optimizeAiRouteFromPoint(hits,startLat,startLng) {
  const stores=loadStores(), storeMap=new Map(stores.map(s=>[String(s.id),s]));
  const candidateMap=aiRouteCandidateMap();
  const withCoords=[], withoutCoords=[];
  for (const h of hits) {
    const s=storeMap.get(String(h.id));
    const lat=Number(s?.lat), lng=Number(s?.lng);
    if (Number.isFinite(lat)&&Number.isFinite(lng)) withCoords.push({...h,lat,lng,c:candidateMap.get(String(h.id))});
    else withoutCoords.push(h);
  }
  const remaining=[...withCoords], ordered=[];
  let lat=Number(startLat),lng=Number(startLng),totalKm=0;
  while (remaining.length) {
    let bestI=0,bestScore=-Infinity,bestDist=0;
    remaining.forEach((x,i)=>{
      const dist=aiRouteHaversineKm(lat,lng,x.lat,x.lng);
      const value=aiRouteValueScore(x.c);
      // 近さを強くしすぎず、高期待値店舗なら多少遠くても選べるバランス
      const score=value/Math.pow(Math.max(.7,dist+1),.72);
      if (score>bestScore) { bestScore=score; bestI=i; bestDist=dist; }
    });
    const [pick]=remaining.splice(bestI,1);
    totalKm+=bestDist; ordered.push({...pick,legKm:bestDist}); lat=pick.lat;lng=pick.lng;
  }
  return {ordered:[...ordered,...withoutCoords], optimizedCount:ordered.length, noCoordsCount:withoutCoords.length, straightKm:totalKm};
}

function saveAiRouteOrder(hits) {
  const stores=loadStores(), idSet=new Set(hits.map(x=>String(x.id)));
  for (const s of stores) s.today=idSet.has(String(s.id));
  saveStores(stores);
  const order=hits.map(x=>String(x.id));
  try {
    localStorage.setItem("today_route_order",JSON.stringify(order));
    ["sedori_today_route_order_v2","sedori_today_route_order_v1","sedori_today_route_order"].forEach(k=>localStorage.setItem(k,JSON.stringify(order)));
    localStorage.setItem("today_route_visited_ids",JSON.stringify([]));
  } catch(e) { console.error("AI optimized route save error",e); }
  invalidateReportCache();
  return order;
}

function applyAiOptimizedPlanToTodayRoute() {
  const hits=extractAiPlanStoreIds(currentAiNextPlanText);
  if (!hits.length) { alert("AIプラン内で登録店舗と一致する店舗が見つかりませんでした。"); return; }
  if (!navigator.geolocation) { alert("この端末では現在地を取得できないため、AI提案順で反映します。"); applyAiNextPlanToTodayRoute(); return; }
  const btn=document.getElementById("aiOptimizeRouteBtn"),meta=document.getElementById("aiApplyRouteMeta");
  if (btn) { btn.disabled=true; btn.textContent="📍 現在地を取得中…"; }
  if (meta) meta.textContent="現在地を取得して、AI店舗評価と移動距離を組み合わせています…";
  navigator.geolocation.getCurrentPosition(pos=>{
    if (btn) { btn.disabled=false; btn.textContent="⚡ 現在地から移動効率も含めて最適化"; }
    const result=optimizeAiRouteFromPoint(hits,pos.coords.latitude,pos.coords.longitude);
    const preview=result.ordered.slice(0,8).map((x,i)=>`${i+1}. ${x.name}${Number.isFinite(x.legKm)?`（直線 約${x.legKm.toFixed(1)}km）`:"（座標未登録）"}`).join("\n");
    const current=loadStores().filter(s=>s.today).length;
    const warning=result.noCoordsCount?`\n\n※ 座標未登録 ${result.noCoordsCount}店舗は最適化後の末尾に配置します。`:"";
    const msg=`${current?`現在の「今日行く」${current}店舗を置き換えます。\n\n`:""}現在地からAI×移動効率で並べ替えました。\n\n${preview}${result.ordered.length>8?`\n…ほか${result.ordered.length-8}店舗`:""}${warning}\n\n※距離は道路距離ではなく直線距離です。\nこの順番で反映しますか？`;
    if (!confirm(msg)) { if(meta) meta.textContent="最適化ルートの反映をキャンセルしました。"; return; }
    const order=saveAiRouteOrder(result.ordered);
    if (meta) meta.textContent=`✅ ${order.length}店舗を移動効率込みで設定しました。座標あり${result.optimizedCount}店舗${result.noCoordsCount?`／座標なし${result.noCoordsCount}店舗`:""}。`;
    alert(`AI×移動効率ルートを設定しました。\n${order.length}店舗を「今日のルート」に反映しました。`);
  },err=>{
    if (btn) { btn.disabled=false; btn.textContent="⚡ 現在地から移動効率も含めて最適化"; }
    if (meta) meta.textContent="現在地を取得できませんでした。位置情報を許可すると移動効率最適化を使えます。";
    alert("現在地を取得できませんでした。\nブラウザの位置情報を許可して再度お試しください。\n\nAI提案順の反映ボタンはそのまま使用できます。");
  },{enableHighAccuracy:true,timeout:10000,maximumAge:60000});
}
window.applyAiOptimizedPlanToTodayRoute=applyAiOptimizedPlanToTodayRoute;
function aiPlanSectionKind(title) {
  const t=String(title||"");
  if (/おすすめプラン|プラン概要|結論/.test(t)) return {cls:"summary",icon:"🧭",label:"おすすめプラン"};
  if (/店舗順|優先店舗|回る順|スケジュール/.test(t)) return {cls:"route",icon:"🏪",label:"優先店舗・時間配分"};
  if (/理由|選定/.test(t)) return {cls:"reason",icon:"🔎",label:"選定理由"};
  if (/期待利益|目標|見込み/.test(t)) return {cls:"target",icon:"💰",label:"期待利益・目標"};
  if (/戦略|狙い|アドバイス/.test(t)) return {cls:"strategy",icon:"🎯",label:"AI戦略"};
  return {cls:"caution",icon:"💡",label:t||"補足"};
}
function renderAiNextPlanHtml(text) {
  const raw=String(text||"").replace(/\r/g,"").trim(); if(!raw)return "";
  const lines=raw.split("\n"), sections=[]; let cur={title:"",lines:[]};
  const isHead=line=>{const x=line.trim();return /^#{1,4}\s+/.test(x)||/^(?:\d+|[①-⑩])[\.．、):：]\s*/.test(x)&&x.length<90||/^【.+】$/.test(x)||/^(?:おすすめプラン|プラン概要|優先店舗|店舗順|回る順|スケジュール|選定理由|期待利益|目標|AI戦略|戦略|注意点)\s*[：:]?/.test(x)&&x.length<100;};
  const push=()=>{if(cur.title||cur.lines.some(x=>x.trim()))sections.push(cur);cur={title:"",lines:[]};};
  for(const line of lines){if(isHead(line)){push();cur.title=line.trim().replace(/^#{1,4}\s*/,"").replace(/^【|】$/g,"");}else cur.lines.push(line);} push();
  if(!sections.length)sections.push({title:"おすすめプラン",lines:[raw]});
  return `<div class="aiDeepAnalysisHeader"><div class="aiDeepAnalysisTitle">🧭 AI次回仕入れプラン</div><div class="aiDeepAnalysisSub">蓄積データと入力条件からAIが作成したプランです</div></div><div class="aiPlanCards">${sections.map((s,i)=>{const k=aiPlanSectionKind(s.title||(i===0?"おすすめプラン":""));const body=escapeHtml(s.lines.join("\n").trim()).replace(/^[-・]\s*/gm,"• ").replace(/\n/g,"<br>");return `<section class="aiPlanCard aiPlanCard--${k.cls}"><div class="aiPlanCardTitle"><span>${k.icon}</span><span>${escapeHtml(s.title||k.label)}</span></div><div class="aiPlanCardBody">${body||"データ不足"}</div></section>`;}).join("")}</div>`;
}

async function requestAiNextPlan() {
  const btn=document.getElementById("aiNextPlanBtn"), result=document.getElementById("aiNextPlanResult"), meta=document.getElementById("aiNextPlanMeta");
  if(!btn||!result)return;
  const plannedDate=document.getElementById("aiPlanDate")?.value || "";
  const startTime=document.getElementById("aiPlanStartTime")?.value || "";
  const hoursRaw=document.getElementById("aiPlanHours")?.value || "";
  if(!plannedDate || !startTime || !hoursRaw){
    result.hidden=false;
    result.innerHTML='<div class="aiDeepAnalysisError">予定日・開始予定・仕入れ予定時間を入力してください。<br>目標利益は未入力でも作成できます。</div>';
    if(meta)meta.textContent="条件を入力してからAIプランを作成してください。";
    return;
  }
  const payload=buildAiNextPlanPayload(), fp=aiPlanFingerprint(payload), cache=loadAiNextPlanCache(), cached=cache[fp];
  if(cached?.plan && btn.dataset.cacheShown!=="1") { result.hidden=false; result.innerHTML=renderAiNextPlanHtml(cached.plan); updateAiPlanRouteAction(cached.plan); btn.dataset.cacheShown="1"; if(meta)meta.textContent=`保存済みプラン：${formatAiDeepSavedAt(cached.createdAt)}。条件が同じなら再利用します。`; return; }
  btn.disabled=true; btn.textContent="AIプラン作成中…"; result.hidden=false; result.innerHTML='<div class="aiDeepAnalysisLoading">🤖 店舗実績を分析してプランを作成しています…</div>'; if(meta)meta.textContent="AIが次回の仕入れ候補を分析しています。";
  try {
    const res=await fetch(AI_WORKER_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"next_plan",analysisData:payload,conditions:payload.conditions})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok||!data.ok||!data.analysis)throw new Error(data.details||data.error||`HTTP ${res.status}`);
    cache[fp]={plan:String(data.analysis),createdAt:new Date().toISOString(),conditions:payload.conditions}; saveAiNextPlanCache(cache);
    result.innerHTML=renderAiNextPlanHtml(data.analysis); updateAiPlanRouteAction(data.analysis); btn.dataset.cacheShown="0"; if(meta)meta.textContent=`プランを保存しました：${formatAiDeepSavedAt(cache[fp].createdAt)}`;
  } catch(e) { result.innerHTML=`<div class="aiDeepAnalysisError">AIプランを作成できませんでした。<br>${escapeHtml(String(e?.message||e))}</div>`; if(meta)meta.textContent="Workerを最新版に更新しているか確認してください。"; }
  finally {btn.disabled=false;btn.textContent="🤖 次回の仕入れプランを作る";}
}
window.requestAiNextPlan=requestAiNextPlan;

// AI UI initialization must run independently because the original load listener
// was registered before later bootReport wrappers were assigned.
window.addEventListener("load", () => {
  try {
    renderAiSourcingSummary(selectedDay || todayStr());
    initAiNextPlanInputs();
  } catch (e) {
    console.error("AI UI init error", e);
  }
});

const originalBootReportForAiPlan=bootReport;
bootReport=function(){originalBootReportForAiPlan();initAiNextPlanInputs();};


/* =========================
   レポート 上下ジャンプ v1
========================= */
function scrollReportToTop(){
  window.scrollTo({top:0, behavior:"smooth"});
}
function scrollReportToBottom(){
  const bottom = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
  window.scrollTo({top:bottom, behavior:"smooth"});
}
window.scrollReportToTop = scrollReportToTop;
window.scrollReportToBottom = scrollReportToBottom;
