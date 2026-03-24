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

const LAYOUT_KEY = "storeCardLayout";

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

function writePrimary(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadStores() {
  const parsed = readFirstAvailable(STORE_KEYS);
  return Array.isArray(parsed) ? parsed : [];
}

function saveStores(stores) {
  writePrimary(STORE_KEYS[0], stores);
}

function loadLogs() {
  const parsed = readFirstAvailable(LOG_KEYS);
  return Array.isArray(parsed) ? parsed : [];
}

function saveLogs(logs) {
  writePrimary(LOG_KEYS[0], logs);
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function yen(n) {
  return `${Math.round(Number(n || 0)).toLocaleString()}円`;
}

function safeDivide(a, b) {
  const x = Number(a || 0);
  const y = Number(b || 0);
  return y > 0 ? x / y : 0;
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function diffDaysFromToday(dateStr) {
  if (!dateStr) return null;
  const d1 = new Date(dateStr + "T00:00:00");
  const d2 = new Date(todayStr() + "T00:00:00");
  return Math.floor((d2 - d1) / 86400000);
}

function getLayoutMode() {
  return localStorage.getItem(LAYOUT_KEY) || "compact";
}

function setLayoutMode(mode) {
  localStorage.setItem(LAYOUT_KEY, mode);
  updateLayoutButtons();
  renderStores();
}

function updateLayoutButtons() {
  const mode = getLayoutMode();
  const detailBtn = document.getElementById("detailLayoutBtn");
  const compactBtn = document.getElementById("compactLayoutBtn");

  if (detailBtn) {
    detailBtn.className = mode === "detail" ? "primaryBtn" : "ghostBtn";
  }
  if (compactBtn) {
    compactBtn.className = mode === "compact" ? "primaryBtn" : "ghostBtn";
  }
}

function appendLog(storeId, type, delta, extra = {}) {
  const logs = loadLogs();
  logs.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    storeId: String(storeId),
    type,
    delta: Number(delta || 0),
    date: todayStr(),
    createdAt: new Date().toISOString(),
    ...extra
  });
  saveLogs(logs);
}

function getStoreStats(store) {
  const logs = loadLogs().filter(l => String(l.storeId) === String(store.id));
  let profit = 0;
  let visits = 0;
  let success = 0;
  let items = 0;

  const visitDates = [];
  const visitMap = {};

  logs.forEach(log => {
    const date = String(log.date || "").slice(0, 10);

    if (log.type === "profit") profit += Number(log.delta || 0);
    if (log.type === "visit") {
      visits += Number(log.delta || 0);
      if (date) {
        visitDates.push(date);
        if (!visitMap[date]) visitMap[date] = { visit: 0, success: 0 };
        visitMap[date].visit += Number(log.delta || 0);
      }
    }
    if (log.type === "success") {
      success += Number(log.delta || 0);
      if (date) {
        if (!visitMap[date]) visitMap[date] = { visit: 0, success: 0 };
        visitMap[date].success += Number(log.delta || 0);
      }
    }
    if (log.type === "items") items += Number(log.delta || 0);
  });

  const successRate = safeDivide(success * 100, visits);
  const avgProfit = safeDivide(profit, success);
  const avgItems = safeDivide(items, success);
  const perVisitExpected = safeDivide(profit, visits);

  const uniqueVisitDates = [...new Set(visitDates)].sort().reverse();
  const lastVisitDate = uniqueVisitDates[0] || "";
  const daysSinceLastVisit = diffDaysFromToday(lastVisitDate);

  const recent3Dates = uniqueVisitDates.slice(0, 3);
  let recent3Visits = 0;
  let recent3Success = 0;

  recent3Dates.forEach(date => {
    recent3Visits += Number(visitMap[date]?.visit || 0);
    recent3Success += Number(visitMap[date]?.success || 0);
  });

  const recent3Rate = safeDivide(recent3Success * 100, recent3Visits);

  let consecutiveNoSuccess = 0;
  for (const date of uniqueVisitDates) {
    const x = visitMap[date];
    if ((x?.visit || 0) <= 0) continue;
    if ((x?.success || 0) > 0) break;
    consecutiveNoSuccess += 1;
  }

  const expectedValue = Number(
    store.expectedValue ??
    store.expected ??
    safeDivide(profit, visits) ??
    0
  );

  return {
    profit,
    visits,
    success,
    items,
    successRate,
    avgProfit,
    avgItems,
    perVisitExpected,
    lastVisitDate,
    daysSinceLastVisit,
    recent3Visits,
    recent3Success,
    recent3Rate,
    consecutiveNoSuccess,
    expectedValue
  };
}

function getSuccessClass(rate) {
  if (rate >= 70) return "successGood";
  if (rate >= 30) return "successMid";
  if (rate > 0) return "successLow";
  return "successBad";
}

function getExpectedCardClass(expectedValue) {
  if (expectedValue >= 15000) return "expected-high";
  if (expectedValue >= 8000) return "expected-mid";
  return "";
}

function getStaleCardClass(daysSinceLastVisit) {
  if (daysSinceLastVisit == null) return "";
  if (daysSinceLastVisit >= 60) return "stale-60";
  if (daysSinceLastVisit >= 30) return "stale-30";
  return "";
}

function hasCoords(store) {
  return Number.isFinite(Number(store.lat)) && Number.isFinite(Number(store.lng));
}

function mapLabel(store) {
  if (store.mapUrl || hasCoords(store) || store.address) return "🗺 MAPあり";
  return "🗺 MAPなし";
}

function coordLabel(store) {
  return hasCoords(store) ? "📡 座標あり" : "📡 座標なし";
}

function distanceLabel(store) {
  const km = Number(store.distanceKm || store.distance || 0);
  return km > 0 ? `📍${km.toFixed(1)}km` : "📍-";
}

function restockLabel(store) {
  const days = Number(store.restockDays || store.replenishDays || store.frequencyDays || 0);
  return days > 0 ? `補充頻度 ${days}日` : "補充頻度 -";
}

function buildCommonStatsHtml(stats) {
  const successCls = getSuccessClass(stats.successRate);

  return `
    <div class="statsGrid">
      <div class="statBox">
        <div class="statLabel">期待値</div>
        <div class="statValue">${yen(stats.expectedValue)}</div>
      </div>
      <div class="statBox">
        <div class="statLabel">利益 / 成功率</div>
        <div class="statValue">${yen(stats.profit)} / <span class="${successCls}">${stats.successRate.toFixed(1)}%</span></div>
      </div>
      <div class="statBox">
        <div class="statLabel">平均利益 / 平均個数</div>
        <div class="statValue">${yen(stats.avgProfit)} / ${stats.avgItems.toFixed(1)}個</div>
      </div>
      <div class="statBox">
        <div class="statLabel">訪問 / 成功 / 個数</div>
        <div class="statValue">${stats.visits} / ${stats.success} / ${stats.items}</div>
      </div>
    </div>
  `;
}

function buildDetailExtraHtml(stats) {
  const lastVisitText = stats.lastVisitDate
    ? `${stats.lastVisitDate}${stats.daysSinceLastVisit != null ? `（${stats.daysSinceLastVisit}日前）` : ""}`
    : "なし";

  const warnText = stats.consecutiveNoSuccess >= 3
    ? `⚠️ ${stats.consecutiveNoSuccess}回連続成功なし`
    : "";

  return `
    <div class="detailExtra">
      <div class="detailRow"><strong>📅 最終訪問：</strong>${escapeHtml(lastVisitText)}</div>
      <div class="detailRow"><strong>📊 直近3回：</strong>成功 ${stats.recent3Success}回 / ${stats.recent3Visits}訪問（${stats.recent3Rate.toFixed(1)}%）</div>
      <div class="detailRow"><strong>💰 訪問あたり期待値：</strong>${yen(stats.perVisitExpected)}</div>
      ${warnText ? `<div class="detailRow warnLine">${escapeHtml(warnText)}</div>` : ""}
    </div>
  `;
}

function buildActionsHtml(store) {
  return `
    <div class="actions">
      <button class="miniBtn success" onclick="changeVisit('${store.id}', 1)">訪問＋</button>
      <button class="miniBtn" onclick="changeVisit('${store.id}', -1)">訪問−</button>

      <button class="miniBtn success" onclick="changeItems('${store.id}', 1)">個数＋</button>
      <button class="miniBtn" onclick="changeItems('${store.id}', -1)">個数−</button>

      <button class="miniBtn warn" onclick="changeProfitPrompt('${store.id}', 1)">利益＋</button>
      <button class="miniBtn" onclick="changeProfitPrompt('${store.id}', -1)">利益−</button>

      <button class="miniBtn primary" onclick="openNavigation('${store.id}')">ナビ</button>
      <button class="miniBtn" onclick="openStoreSettings('${store.id}')">設定</button>

      <button class="miniBtn danger" onclick="deleteStore('${store.id}')">削除</button>
    </div>
  `;
}

function buildStoreCard(store) {
  const layoutMode = getLayoutMode();
  const stats = getStoreStats(store);
  const expectedClass = getExpectedCardClass(stats.expectedValue);
  const staleClass = getStaleCardClass(stats.daysSinceLastVisit);

  const cardClass = ["storeCard", expectedClass, staleClass].filter(Boolean).join(" ");
  const isToday = !!store.todayVisit;

  return `
    <div class="${cardClass}">
      <div class="storeCardBody">
        <div class="storeTop">
          <h3 class="storeName">${escapeHtml(store.name || "無名店舗")}</h3>
          ${isToday ? `<div class="todayBadge">今日行く</div>` : ""}
        </div>

        <div class="metaLine">
          <span class="metaChip">${escapeHtml(store.pref || "都道府県未設定")}</span>
          <span class="metaChip">${escapeHtml(distanceLabel(store))}</span>
          <span class="metaChip">${escapeHtml(mapLabel(store))}</span>
          <span class="metaChip">${escapeHtml(coordLabel(store))}</span>
          <span class="metaChip">${escapeHtml(restockLabel(store))}</span>
        </div>

        <div class="addr">${escapeHtml(store.address || "住所なし")}</div>

        ${buildCommonStatsHtml(stats)}

        ${layoutMode === "detail" ? buildDetailExtraHtml(stats) : ""}

        <label class="todayRow">
          <input type="checkbox" ${store.todayVisit ? "checked" : ""} onchange="toggleTodayVisit('${store.id}', this.checked)">
          <span>今日行く</span>
        </label>

        ${buildActionsHtml(store)}
      </div>
    </div>
  `;
}

function renderStores() {
  updateLayoutButtons();

  const stores = loadStores();
  const listEl = document.getElementById("storeList");
  const q = String(document.getElementById("searchInput")?.value || "").trim().toLowerCase();

  if (!listEl) return;

  const filtered = stores.filter(store => {
    const text = [
      store.name,
      store.pref,
      store.address
    ].join(" ").toLowerCase();
    return !q || text.includes(q);
  });

  if (!filtered.length) {
    listEl.innerHTML = `<div class="card"><div class="emptyText">店舗がありません。</div></div>`;
    return;
  }

  listEl.innerHTML = filtered.map(buildStoreCard).join("");
}

function updateStoreById(storeId, updater) {
  const stores = loadStores();
  const idx = stores.findIndex(s => String(s.id) === String(storeId));
  if (idx < 0) return;

  const updated = updater({ ...stores[idx] });
  stores[idx] = updated;
  saveStores(stores);
}

function toggleTodayVisit(storeId, checked) {
  updateStoreById(storeId, store => {
    store.todayVisit = !!checked;
    return store;
  });
  renderStores();
}

function changeVisit(storeId, delta) {
  appendLog(storeId, "visit", delta > 0 ? 1 : -1);
  renderStores();
}

function changeItems(storeId, delta) {
  appendLog(storeId, "items", delta > 0 ? 1 : -1);
  renderStores();
}

function changeProfitPrompt(storeId, sign) {
  const input = prompt(sign > 0 ? "追加する利益額を入力" : "減らす利益額を入力", "1000");
  if (input == null) return;

  const amount = Number(String(input).replaceAll(",", ""));
  if (!Number.isFinite(amount) || amount <= 0) return;

  appendLog(storeId, "profit", sign > 0 ? amount : -amount);
  renderStores();
}

function openNavigation(storeId) {
  const stores = loadStores();
  const store = stores.find(s => String(s.id) === String(storeId));
  if (!store) return;

  let url = "";
  if (hasCoords(store)) {
    url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${store.lat},${store.lng}`)}`;
  } else if (store.address) {
    url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(store.address)}`;
  } else if (store.name) {
    url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(store.name)}`;
  }

  if (url) window.open(url, "_blank");
}

function openStoreSettings(storeId) {
  const stores = loadStores();
  const store = stores.find(s => String(s.id) === String(storeId));
  if (!store) return;

  const name = prompt("店舗名", store.name || "");
  if (name == null) return;

  const pref = prompt("都道府県", store.pref || "");
  if (pref == null) return;

  const address = prompt("住所", store.address || "");
  if (address == null) return;

  const expectedValue = prompt("期待値（円）", String(store.expectedValue || store.expected || 0));
  if (expectedValue == null) return;

  const restockDays = prompt("補充頻度（日）", String(store.restockDays || store.replenishDays || 0));
  if (restockDays == null) return;

  updateStoreById(storeId, s => {
    s.name = name.trim();
    s.pref = pref.trim();
    s.address = address.trim();
    s.expectedValue = Number(expectedValue || 0);
    s.restockDays = Number(restockDays || 0);
    return s;
  });

  renderStores();
}

function deleteStore(storeId) {
  if (!confirm("この店舗を削除しますか？")) return;

  const stores = loadStores().filter(s => String(s.id) !== String(storeId));
  saveStores(stores);
  renderStores();
}

function seedDemoIfEmpty() {
  const stores = loadStores();
  if (stores.length) {
    alert("すでに店舗があります。");
    return;
  }

  const demoStores = [
    {
      id: "s1",
      name: "ハードオフ 南魚沼店",
      pref: "新潟県",
      distanceKm: 10.4,
      lat: 37.066,
      lng: 138.877,
      restockDays: 30,
      address: "新潟県南魚沼市サンプル1-2-3",
      expectedValue: 10000,
      todayVisit: false
    },
    {
      id: "s2",
      name: "ブックオフ 六日町店",
      pref: "新潟県",
      distanceKm: 6.8,
      lat: "",
      lng: "",
      restockDays: 21,
      address: "新潟県南魚沼市サンプル4-5-6",
      expectedValue: 16000,
      todayVisit: true
    }
  ];

  const demoLogs = [
    { id:"l1", storeId:"s1", type:"visit", delta:1, date:"2026-03-01" },
    { id:"l2", storeId:"s1", type:"success", delta:1, date:"2026-03-01" },
    { id:"l3", storeId:"s1", type:"items", delta:2, date:"2026-03-01" },
    { id:"l4", storeId:"s1", type:"profit", delta:8000, date:"2026-03-01" },

    { id:"l5", storeId:"s1", type:"visit", delta:1, date:"2026-03-10" },
    { id:"l6", storeId:"s1", type:"items", delta:0, date:"2026-03-10" },
    { id:"l7", storeId:"s1", type:"profit", delta:0, date:"2026-03-10" },

    { id:"l8", storeId:"s2", type:"visit", delta:1, date:"2026-03-15" },
    { id:"l9", storeId:"s2", type:"success", delta:1, date:"2026-03-15" },
    { id:"l10", storeId:"s2", type:"items", delta:3, date:"2026-03-15" },
    { id:"l11", storeId:"s2", type:"profit", delta:15000, date:"2026-03-15" },

    { id:"l12", storeId:"s2", type:"visit", delta:1, date:"2026-03-18" },
    { id:"l13", storeId:"s2", type:"visit", delta:1, date:"2026-03-20" }
  ];

  saveStores(demoStores);
  saveLogs(demoLogs);
  renderStores();
}

window.addEventListener("load", () => {
  updateLayoutButtons();
  renderStores();
});
