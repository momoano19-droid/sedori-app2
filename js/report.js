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
   カレンダー追加用カテゴリモーダル
========================= */
let reportCategoryModalResolver = null;
let reportCategoryTargetQty = 0;
let reportCategorySelected = {};
let reportCategoryHistory = [];

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
  const months = [...new Set(logs.map(l => ym(l.date)).filter(Boolean))].sort().reverse();
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

function sumReportCategoryMap(map) {
  return Object.values(map || {}).reduce((sum, v) => sum + Number(v || 0), 0);
}

/* =========================
   カテゴリ選択モーダル
========================= */
function getReportCategoryHistory(store = null) {
  const stores = loadStores();
  const logs = loadLogs();
  const set = new Set();

  if (store?.defaultCategory) {
    set.add(String(store.defaultCategory).trim());
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

function ensureReportCategoryModal() {
  if (document.getElementById("reportCategoryModal")) return;

  const modal = document.createElement("div");
  modal.id = "reportCategoryModal";
  modal.className = "qtyCategoryModal";
  modal.innerHTML = `
    <div class="qtyCategoryCard">
      <div class="qtyCategoryTitle">カテゴリ内訳を選択</div>
      <div class="qtyCategorySub">
        カテゴリをタップして、＋ / − で個数を調整してください
      </div>

      <div class="qtySelectedBox">
        仕入れ個数: <span id="reportCategoryTargetQty">0</span>個
      </div>

      <div class="qtyCategorySectionTitle">カテゴリ履歴</div>
      <div id="reportCategoryChipWrap" class="categoryChipWrap"></div>

      <div class="qtyCategorySectionTitle">新しいカテゴリを追加</div>
      <div class="categoryAddRow">
        <input id="reportNewCategoryInput" class="categoryTextInput" placeholder="新しいカテゴリ名">
        <button type="button" class="categoryAddBtn" onclick="addReportCategoryChip()">追加</button>
      </div>

      <div class="qtyCategorySectionTitle">カテゴリごとの個数</div>
      <div id="reportCategoryCountEditor" class="qtyCategoryCountEditor"></div>

      <div class="qtySelectedBox qtyCategoryTotalCheck" id="reportCategoryTotalCheck">
        入力合計: <span id="reportCategoryAssignedTotal">0</span> / <span id="reportCategoryAssignedTarget">0</span>個
      </div>

      <div class="categoryPickerActions">
        <button type="button" class="ghostBtn" onclick="closeReportCategoryModal(null)">キャンセル</button>
        <button type="button" class="primaryBtn" onclick="confirmReportCategoryModal()">OK</button>
      </div>
    </div>
  `;

  modal.addEventListener("click", e => {
    if (e.target === modal) closeReportCategoryModal(null);
  });

  document.body.appendChild(modal);
}

function openReportCategoryPicker({ totalItems = 0, store = null }) {
  ensureReportCategoryModal();

  reportCategoryTargetQty = Math.max(0, Number(totalItems || 0));
  reportCategorySelected = {};
  reportCategoryHistory = getReportCategoryHistory(store);

  const defaultCat = String(store?.defaultCategory || reportCategoryHistory[0] || "未分類").trim() || "未分類";

  if (reportCategoryTargetQty > 0) {
    reportCategorySelected[defaultCat] = reportCategoryTargetQty;
    if (!reportCategoryHistory.includes(defaultCat)) {
      reportCategoryHistory.unshift(defaultCat);
    }
  }

  const modal = document.getElementById("reportCategoryModal");
  const targetQtyEl = document.getElementById("reportCategoryTargetQty");
  const assignedTargetEl = document.getElementById("reportCategoryAssignedTarget");
  const newInput = document.getElementById("reportNewCategoryInput");

  if (targetQtyEl) targetQtyEl.textContent = String(reportCategoryTargetQty);
  if (assignedTargetEl) assignedTargetEl.textContent = String(reportCategoryTargetQty);
  if (newInput) newInput.value = "";

  renderReportCategoryChips();
  renderReportCategoryCountEditor();
  updateReportCategorySummary();

  if (modal) modal.classList.add("show");

  return new Promise(resolve => {
    reportCategoryModalResolver = resolve;
  });
}

function renderReportCategoryChips() {
  const wrap = document.getElementById("reportCategoryChipWrap");
  if (!wrap) return;

  wrap.innerHTML = reportCategoryHistory.map(cat => {
    const active = !!reportCategorySelected[cat];
    return `
      <button
        type="button"
        class="categoryChip ${active ? "active" : ""}"
        onclick="toggleReportCategoryChip('${escapeJsString(cat)}')"
      >
        ${escapeHtml(cat)}
      </button>
    `;
  }).join("");
}

function toggleReportCategoryChip(cat) {
  const name = String(cat || "").trim();
  if (!name) return;

  if (reportCategorySelected[name]) {
    delete reportCategorySelected[name];
  } else {
    const currentTotal = sumReportCategoryMap(reportCategorySelected);
    const remain = Math.max(0, reportCategoryTargetQty - currentTotal);
    reportCategorySelected[name] = remain > 0 ? remain : 1;
  }

  renderReportCategoryChips();
  renderReportCategoryCountEditor();
  updateReportCategorySummary();
}

function addReportCategoryChip() {
  const input = document.getElementById("reportNewCategoryInput");
  if (!input) return;

  const cat = String(input.value || "").trim();
  if (!cat) return;

  if (!reportCategoryHistory.includes(cat)) {
    reportCategoryHistory.unshift(cat);
  }

  const currentTotal = sumReportCategoryMap(reportCategorySelected);
  const remain = Math.max(0, reportCategoryTargetQty - currentTotal);
  reportCategorySelected[cat] = remain > 0 ? remain : 1;

  input.value = "";

  renderReportCategoryChips();
  renderReportCategoryCountEditor();
  updateReportCategorySummary();
}

function renderReportCategoryCountEditor() {
  const wrap = document.getElementById("reportCategoryCountEditor");
  if (!wrap) return;

  const keys = Object.keys(reportCategorySelected || {});

  if (!keys.length) {
    wrap.innerHTML = `<div class="qtyCategoryEmpty">カテゴリを選択してください</div>`;
    return;
  }

  wrap.innerHTML = keys.map(cat => {
    const qty = Math.max(0, Number(reportCategorySelected[cat] || 0));

    return `
      <div class="qtyCategoryCountRow">
        <div class="qtyCategoryCountName">${escapeHtml(cat)}</div>
        <div class="qtyStepper">
          <button type="button" class="qtyStepBtn minus" onclick="changeReportCategoryQty('${escapeJsString(cat)}', -1)">−</button>
          <div class="qtyStepValue">${qty}</div>
          <button type="button" class="qtyStepBtn plus" onclick="changeReportCategoryQty('${escapeJsString(cat)}', 1)">＋</button>
        </div>
      </div>
    `;
  }).join("");
}

function changeReportCategoryQty(cat, delta) {
  const name = String(cat || "").trim();
  if (!name || !reportCategorySelected[name]) return;

  const current = Math.max(0, Number(reportCategorySelected[name] || 0));
  const next = Math.max(0, current + Number(delta || 0));

  if (next <= 0) {
    delete reportCategorySelected[name];
  } else {
    reportCategorySelected[name] = next;
  }

  renderReportCategoryChips();
  renderReportCategoryCountEditor();
  updateReportCategorySummary();
}

function updateReportCategorySummary() {
  const total = sumReportCategoryMap(reportCategorySelected);
  const totalEl = document.getElementById("reportCategoryAssignedTotal");
  const checkEl = document.getElementById("reportCategoryTotalCheck");

  if (totalEl) totalEl.textContent = String(total);

  if (checkEl) {
    checkEl.classList.remove("is-ok", "is-over", "is-under");

    if (total === reportCategoryTargetQty) {
      checkEl.classList.add("is-ok");
    } else if (total > reportCategoryTargetQty) {
      checkEl.classList.add("is-over");
    } else {
      checkEl.classList.add("is-under");
    }
  }
}

function confirmReportCategoryModal() {
  const total = sumReportCategoryMap(reportCategorySelected);

  if (reportCategoryTargetQty <= 0) {
    closeReportCategoryModal({});
    return;
  }

  if (!Object.keys(reportCategorySelected).length) {
    alert("カテゴリを1つ以上選択してください。");
    return;
  }

  if (total !== reportCategoryTargetQty) {
    alert(`カテゴリ個数の合計を仕入れ個数と一致させてください。\n\n入力合計：${total}個\n仕入れ個数：${reportCategoryTargetQty}個`);
    return;
  }

  const result = {};
  Object.entries(reportCategorySelected).forEach(([cat, qty]) => {
    const name = String(cat || "").trim();
    const n = Math.max(0, Number(qty || 0));
    if (name && n > 0) result[name] = n;
  });

  closeReportCategoryModal(result);
}

function closeReportCategoryModal(result) {
  const modal = document.getElementById("reportCategoryModal");
  if (modal) modal.classList.remove("show");

  if (reportCategoryModalResolver) {
    reportCategoryModalResolver(result);
    reportCategoryModalResolver = null;
  }
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

async function openAddDayRecord(dayStr) {
  const stores = loadStores();

  if (!stores.length) {
    alert("店舗が登録されていません。");
    return;
  }

  const keyword = prompt(
    `${dayStr} に記録を追加します。\n\n店舗名の一部を入力してください。\n空欄のままOKを押すと、登録店舗一覧を表示します。`,
    ""
  );

  if (keyword === null) return;

  const q = String(keyword || "").trim().toLowerCase();

  let candidates = stores.filter(s => {
    if (!q) return true;

    const text = [
      s.name,
      s.pref,
      s.address
    ].map(x => String(x || "").toLowerCase()).join(" ");

    return text.includes(q);
  });

  if (!candidates.length) {
    alert("該当する店舗が見つかりませんでした。");
    return;
  }

  candidates = candidates.slice(0, 30);

  const storeListText = candidates
    .map((s, idx) => `${idx + 1}: ${s.name || "店舗名なし"}${s.pref ? `（${s.pref}）` : ""}`)
    .join("\n");

  const selected = prompt(
    `店舗を番号で選んでください。\n\n${storeListText}`,
    "1"
  );

  if (selected === null) return;

  const selectedIndex = Number(selected) - 1;
  const store = candidates[selectedIndex];

  if (!store) {
    alert("店舗番号が正しくありません。");
    return;
  }

  let visit = confirm(`${store.name}\n\n訪問を +1 しますか？`);
  const success = confirm(`${store.name}\n\n仕入れ成功を +1 しますか？`);

  if (success && !visit) {
    const ok = confirm("成功を追加する場合、訪問も +1 します。よろしいですか？");
    if (!ok) return;
    visit = true;
  }

  const itemsInput = prompt(
    `${store.name}\n\n仕入れ個数を入力してください。\n仕入れなしの場合は 0`,
    success ? "1" : "0"
  );

  if (itemsInput === null) return;

  const items = Math.max(0, Number(String(itemsInput).replaceAll(",", "").trim() || 0));

  if (!Number.isFinite(items)) {
    alert("個数は数値で入力してください。");
    return;
  }

  let categoryMap = {};

  if (items > 0) {
    const picked = await openReportCategoryPicker({
      totalItems: items,
      store
    });

    if (!picked) return;

    categoryMap = picked;

    const categoryTotal = sumReportCategoryMap(categoryMap);

    if (categoryTotal !== items) {
      alert(`カテゴリ個数の合計が一致していません。\n\n入力合計：${categoryTotal}個\n仕入れ個数：${items}個`);
      return;
    }
  }

  const profitInput = prompt(
    `${store.name}\n\n利益を入力してください。\n利益なしの場合は 0`,
    "0"
  );

  if (profitInput === null) return;

  const profit = Math.max(0, Number(String(profitInput).replaceAll(",", "").trim() || 0));

  if (!Number.isFinite(profit)) {
    alert("利益は数値で入力してください。");
    return;
  }

  if (!visit && !success && items <= 0 && profit <= 0) {
    alert("追加する内容がありません。");
    return;
  }

  const confirmText = [
    `${dayStr} に記録を追加します。`,
    "",
    `店舗：${store.name}`,
    `訪問：${visit ? "+1" : "なし"}`,
    `成功：${success ? "+1" : "なし"}`,
    `個数：${items}個`,
    `カテゴリ：${
      Object.keys(categoryMap).length
        ? Object.entries(categoryMap).map(([cat, qty]) => `${cat}:${qty}`).join(" / ")
        : "なし"
    }`,
    `利益：${yen(profit)}`,
    "",
    "この内容で追加しますか？"
  ].join("\n");

  if (!confirm(confirmText)) return;

  const ok = addCalendarRecordToStoreAndLogs(dayStr, {
    storeId: store.id,
    visit,
    success,
    items,
    profit,
    categoryMap
  });

  if (!ok) return;

  alert("記録を追加しました。店舗カードにも反映されます。");

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
        <div class="catItem" style="grid-template-columns:1fr; cursor:pointer;" onclick="showPrefDetail('${escapeHtml(item.pref)}')">
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

    <div class="chipRow" onclick="showMonthDetail('${escapeHtml(summary.label)}')" style="cursor:pointer;">
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
        過去日付に、訪問・成功・個数・カテゴリ・利益を追加できます。<br>
        カテゴリはタップ式で入力できます。<br>
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
