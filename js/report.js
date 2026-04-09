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
let selectedPrefMode = "month"; // month | total

/* =========================
   軽量化キャッシュ
========================= */
let cachedStores = null;
let cachedLogs = null;
let cachedMonthData = new Map();
let cachedTotalData = null;

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

function yen(n) {
  return `${Number(n || 0).toLocaleString()}円`;
}

function shortMoney(n) {
  return Number(n || 0).toLocaleString();
}

function safeDivide(a, b) {
  const x = Number(a || 0);
  const y = Number(b || 0);
  return y > 0 ? x / y : 0;
}

function ym(dateStr) {
  return String(dateStr || "").slice(0, 7);
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

function renderMonthPicker(logs) {
  const el = document.getElementById("monthPicker");
  if (!el) return;

  const months = getAvailableMonths(logs);
  if (!selectedMonth) selectedMonth = months[0] || currentMonthStr();

  el.innerHTML = months
    .map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
    .join("");

  el.value = selectedMonth;
}

function changeReportMonth(month) {
  selectedMonth = month;
  selectedDay = null;
  bootReport();
}

function goCurrentMonth() {
  selectedMonth = currentMonthStr();
  selectedDay = null;
  bootReport();
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
    const date = String(log.date || "").slice(0, 10);
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

    if (log.type === "profit") {
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
      .slice(0, 10),
    rate: [...normalized]
      .filter(x => Number(x.visits || 0) > 0)
      .sort((a, b) => b.rate - a.rate || b.success - a.success)
      .slice(0, 10),
    profit: [...normalized]
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 10)
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
  if (selectedPrefMode === "total") {
    return getTotalBundle(stores, logs);
  }
  return getMonthBundle(stores, logs, selectedMonth || currentMonthStr());
}

function renderPrefAnalysis() {
  const el = document.getElementById("prefAnalysisWrap");
  if (!el) return;

  const bundle = getCurrentPrefBundle();
  const list = bundle.prefStats || [];

  const modeLabel = selectedPrefMode === "total" ? "トータル" : (selectedMonth || currentMonthStr());

  if (!list.length) {
    el.innerHTML = `
      <div class="row2" style="margin-bottom:12px;">
        <button class="${selectedPrefMode === "month" ? "primaryBtn" : "ghostBtn"}" onclick="changePrefMode('month')">今月</button>
        <button class="${selectedPrefMode === "total" ? "primaryBtn" : "ghostBtn"}" onclick="changePrefMode('total')">トータル</button>
      </div>
      <div class="emptyText">都道府県データがありません。</div>
    `;
    return;
  }

  el.innerHTML = `
    <div class="row2" style="margin-bottom:12px;">
      <button class="${selectedPrefMode === "month" ? "primaryBtn" : "ghostBtn"}" onclick="changePrefMode('month')">今月</button>
      <button class="${selectedPrefMode === "total" ? "primaryBtn" : "ghostBtn"}" onclick="changePrefMode('total')">トータル</button>
    </div>

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

function changePrefMode(mode) {
  selectedPrefMode = mode === "total" ? "total" : "month";
  renderPrefAnalysis();
}

function showPrefDetail(prefName) {
  const bundle = getCurrentPrefBundle();
  const pref = bundle.prefStats.find(x => x.pref === prefName);

  const body = document.getElementById("detailBody");
  const title = document.getElementById("detailTitle");
  if (!body || !title) return;

  const modeLabel = selectedPrefMode === "total" ? "トータル" : (selectedMonth || currentMonthStr());
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

function buildMiniCategoryTableHtml(categories) {
  const top = categories.slice(0, 10);
  const total = top.reduce((sum, [, qty]) => sum + Number(qty || 0), 0);

  if (!top.length) {
    return `
      <div class="miniTable">
        <div class="miniTableRow">
          <div class="miniCell name" style="color:#6b7280;">カテゴリデータなし</div>
          <div class="miniCell qty">-</div>
          <div class="miniCell rate">-</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="miniTable">
      <div class="miniTableHead">
        <div class="miniCell">カテゴリ</div>
        <div class="miniCell qty">個数</div>
        <div class="miniCell rate">割合</div>
      </div>
      ${top.map(([name, qty]) => {
        const rate = total > 0 ? ((Number(qty || 0) / total) * 100).toFixed(1) : "0.0";
        return `
          <div class="miniTableRow">
            <div class="miniCell name">${escapeHtml(name)}</div>
            <div class="miniCell qty">${qty}個</div>
            <div class="miniCell rate">${rate}%</div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

/* =========================
   サマリー
========================= */
function renderMonthSummary(monthBundle, totalBundle) {
  const el = document.getElementById("monthSummaryCard");
  if (!el) return;

  const summary = monthBundle.summary;
  const totalSummary = totalBundle.summary;

  el.innerHTML = `
    <h2 class="sectionTitle" style="margin-bottom:16px;">📌 ${escapeHtml(summary.label)} サマリー</h2>

    <div class="chipRow" onclick="showMonthDetail('${escapeHtml(summary.label)}')" style="cursor:pointer;">
      <div class="chip">現在登録店舗 ${summary.registeredStoreCount}件</div>
      <div class="chip">対象店舗 ${summary.activeStoreCount}件</div>
      <div class="chip">今月利益 ${yen(summary.profit)}</div>
      <div class="chip">今月訪問 ${summary.visits}回</div>
      <div class="chip">今月成功 ${summary.success}回</div>
      <div class="chip">今月個数 ${summary.items}個</div>
      <div class="chip">今月成功率 ${summary.rate.toFixed(1)}%</div>
      <div class="chip">1店舗あたり利益 ${yen(Math.round(summary.profitPerStore))}</div>
      <div class="chip">1訪問あたり利益 ${yen(Math.round(summary.profitPerVisit))}</div>
      <div class="chip">成功単価 ${yen(Math.round(summary.profitPerSuccess))}</div>
      <div class="chip">稼働日数 ${summary.activeDayCount}日</div>
      <div class="chip">1日あたり利益 ${yen(Math.round(summary.profitPerDay))}</div>
    </div>

    <div class="summarySubTitle">月間カテゴリ集計</div>

    <div class="chartWrap">
      <div class="chartCanvasBox">
        <canvas id="categoryPieChart"></canvas>
      </div>
      <div class="chartLegend">
        ${buildCategoryLegendHtml(summary.categories)}
      </div>
    </div>

    <div class="summarySubTitle">月間カテゴリ表</div>
    ${buildMiniCategoryTableHtml(summary.categories)}

    <div class="summarySubTitle">トータルカテゴリ表</div>
    ${buildMiniCategoryTableHtml(totalSummary.categories)}
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

    const isBigSuccess = profit >= 100000;
    const hasProfit = profit > 0;
    const hasVisitOnly = !hasProfit && (visits > 0 || success > 0 || items > 0);
    const isToday = ds === today;
    const isSelected = ds === selectedDay;

    let cls = "dayCell";
    if (isBigSuccess) cls += " hasData bigSuccess";
    else if (hasProfit) cls += " hasData";
    else if (hasVisitOnly) cls += " visitOnly";
    if (isToday) cls += " today";
    if (isSelected) cls += " selected";

    let valueText = "-";
    if (hasProfit) valueText = shortMoney(profit);
    else if (hasVisitOnly) valueText = "0";

    html += `
      <div class="${cls}" onclick="handleDayTap('${ds}')">
        <div class="dayNum">${day}</div>
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
        <div class="emptyText">この月のデータがありません。</div>
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
    ${renderOneTopList("🏆 期待値TOP10", topLists.expected, "expected")}
    ${renderOneTopList("🎯 成功率TOP10", topLists.rate, "rate")}
    ${renderOneTopList("💰 利益TOP10", topLists.profit, "profit")}
  `;
}

/* =========================
   カテゴリ集計
========================= */
function renderCategorySummary(monthCategories, totalCategories) {
  const el = document.getElementById("categoryWrap");
  if (!el) return;

  if (!monthCategories.length && !totalCategories.length) {
    el.innerHTML = `<div class="emptyText">カテゴリデータがありません。</div>`;
    return;
  }

  el.innerHTML = `
    <div class="summarySubTitle" style="margin-top:0;">月間カテゴリ集計</div>
    ${
      monthCategories.length
        ? `<div class="catList">
            ${monthCategories.map(([name, qty]) => `
              <div class="catItem">
                <div class="catName">${escapeHtml(name)}</div>
                <div class="catQty">${qty}個</div>
              </div>
            `).join("")}
          </div>`
        : `<div class="emptyText">今月のカテゴリデータがありません。</div>`
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

function showMonthDetail(targetMonth) {
  const stores = loadStores();
  const logs = loadLogs();
  const bundle = getMonthBundle(stores, logs, targetMonth);
  const grouped = bundle.perStore;
  const summary = buildDetailSummaryFromStoreStats(grouped);

  const body = document.getElementById("detailBody");
  const title = document.getElementById("detailTitle");
  if (!body || !title) return;

  title.textContent = `${targetMonth} 詳細`;

  const rows = Object.values(grouped).sort((a, b) => {
    return Number(b.profit || 0) - Number(a.profit || 0);
  });

  let html = `
    <div class="detailBlock">
      <div class="detailTitle">月サマリー</div>
      <div class="detailText">
        対象店舗：${summary.storeCount}件<br>
        利益：${yen(summary.profit)}<br>
        訪問：${summary.visits}回 / 成功：${summary.success}回 / 個数：${summary.items}個<br>
        成功率：${summary.rate.toFixed(1)}%
      </div>
    </div>
  `;

  if (!rows.length) {
    html += `<div class="emptyText">この月のデータはありません。</div>`;
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
  const dayLogs = logs.filter(l => l.date === dayStr);

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

    if (log.type === "profit") grouped[id].profit += delta;
    if (log.type === "visit") grouped[id].visits += delta;
    if (log.type === "success") grouped[id].success += delta;
    if (log.type === "items") grouped[id].items += delta;
    if (log.type === "category" && log.category) {
      const cat = String(log.category).trim();
      if (cat) grouped[id].categories[cat] = (grouped[id].categories[cat] || 0) + delta;
    }
  });

  const summary = buildDetailSummaryFromStoreStats(grouped);

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
  `;

  if (!rows.length) {
    html += `<div class="emptyText">この日のデータはありません。</div>`;
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

    return `
      <div class="detailBlock">
        <div class="detailTitle">${escapeHtml(x.name)}</div>
        <div class="detailText">
          利益：${yen(x.profit)}<br>
          訪問：${x.visits}回 / 成功：${x.success}回 / 個数：${x.items}個<br>
          成功率：${rate.toFixed(1)}%<br>
          ${cats ? `カテゴリ：${cats}` : "カテゴリ：なし"}
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

  const targetMonth = selectedMonth || currentMonthStr();
  const monthBundle = getMonthBundle(stores, logs, targetMonth);
  const totalBundle = getTotalBundle(stores, logs);

  renderMonthSummary(monthBundle, totalBundle);
  renderCalendar(targetMonth, monthBundle.daily);
  renderTopStores(monthBundle.topLists);
  renderCategorySummary(monthBundle.categories, totalBundle.categories);
  renderPrefAnalysis();
}

window.addEventListener("load", bootReport);
window.addEventListener("resize", () => {
  const stores = loadStores();
  const logs = loadLogs();
  const targetMonth = selectedMonth || currentMonthStr();
  const bundle = getMonthBundle(stores, logs, targetMonth);
  drawCategoryPieChart("categoryPieChart", bundle.summary.categories || [], bundle.summary.label || "");
});
