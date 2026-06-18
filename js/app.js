let stores = loadStores();
let logs = loadLogs();
let savedRoutes = loadSavedRoutes();
let todayRouteOrder = loadTodayRouteOrder();
let routeRunHistory = loadRouteRunHistory();

let nearbyMode = false;
let nearbyStoreIds = new Set();
let noCoordsOnlyMode = false;
let currentLayoutMode = localStorage.getItem("store_layout_mode") || "compact";

let map = null;
let mapMarkers = [];
let mapInitialized = false;
let preserveMapViewOnNextRender = false;
let splitRouteCache = null;
let currentLocationMarker = null;
window.lastPos = null;

let openSavedRouteId = null;

let categoryHistoryCache = null;
let categoryHistoryDirty = true;

let lastListRenderSignature = "";
let lastMapRenderSignature = "";
let mapRenderRafId = null;

let qtyCategoryModalResolver = null;
let qtyCategoryCurrentQty = 1;
let qtyCategorySelected = {};
let qtyCategoryProfit = 0;

let profitEditTargetIndex = -1;

let todayRouteAccordionOpen = true;

const TODAY_ROUTE_VISITED_KEY = "today_route_visited_ids";
const STORE_ALERTED_STATUS_KEY = "store_closing_alerted_v1";
const STORE_ADD_ACCORDION_KEY = "store_add_accordion_open";

function syncStoreProfitsFromLogs() {
  if (typeof getStoreProfitFromLogs !== "function") return;

  stores.forEach(store => {
    try {
      store.profit = getStoreProfitFromLogs(store.id);
    } catch (e) {
      console.error("getStoreProfitFromLogs error:", e);
    }
  });
}

function loadTodayRouteVisitedIds() {
  try {
    const raw = localStorage.getItem(TODAY_ROUTE_VISITED_KEY);
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveTodayRouteVisitedIds() {
  localStorage.setItem(
    TODAY_ROUTE_VISITED_KEY,
    JSON.stringify(todayRouteVisitedIds)
  );
}

function loadClosingAlertedMap() {
  try {
    const raw = localStorage.getItem(STORE_ALERTED_STATUS_KEY);
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveClosingAlertedMap(mapObj) {
  localStorage.setItem(STORE_ALERTED_STATUS_KEY, JSON.stringify(mapObj || {}));
}

function getTodayAlertKey(storeId) {
  return `${tokyoDateStr()}__${String(storeId || "")}`;
}

function hasClosingAlertedToday(storeId) {
  const mapObj = loadClosingAlertedMap();
  return mapObj[getTodayAlertKey(storeId)] === true;
}

function markClosingAlertedToday(storeId) {
  const mapObj = loadClosingAlertedMap();
  mapObj[getTodayAlertKey(storeId)] = true;
  saveClosingAlertedMap(mapObj);
}

function cleanupOldClosingAlerts() {
  const mapObj = loadClosingAlertedMap();
  const today = tokyoDateStr();
  const next = {};

  Object.entries(mapObj).forEach(([key, value]) => {
    if (String(key).startsWith(`${today}__`) && value === true) {
      next[key] = true;
    }
  });

  saveClosingAlertedMap(next);
}

function parseTimeToMinutes(timeStr) {
  const text = String(timeStr || "").trim();
  if (!/^\d{2}:\d{2}$/.test(text)) return null;

  const [hh, mm] = text.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;

  return hh * 60 + mm;
}

function getNowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function formatStoreHours(store) {
  const openTime = String(store?.openTime || "").trim();
  const closeTime = String(store?.closeTime || "").trim();

  if (!openTime && !closeTime) return "未設定";
  if (openTime && closeTime) return `${openTime}〜${closeTime}`;
  return `${openTime || "--:--"}〜${closeTime || "--:--"}`;
}

function formatClosedDays(store) {
  const days = Array.isArray(store?.regularClosedDays) ? store.regularClosedDays : [];
  return days.length ? days.join("・") : "なし";
}

function hasRegularClosedDays(store) {
  const days = Array.isArray(store?.regularClosedDays)
    ? store.regularClosedDays
    : [];

  return days.some(day => String(day || "").trim());
}

function renderBusinessInfoHtml(store, options = {}) {
  const businessStatus = getStoreBusinessStatus(store);
  const hoursText = formatStoreHours(store);
  const closedDaysText = formatClosedDays(store);
  const showClosedDays = hasRegularClosedDays(store);
  const showBusinessStatus = businessStatus.code !== "unknown";

  return `
    <div class="businessInfo ${options.className || ""}">
      <div class="businessInfoRow">
        <div class="businessInfoLabel">🕒 営業時間</div>
        <div class="businessInfoValue">${escapeHtml(hoursText)}</div>
      </div>

      ${showClosedDays ? `
        <div class="businessInfoRow">
          <div class="businessInfoLabel">📌 定休日</div>
          <div class="businessInfoValue">${escapeHtml(closedDaysText)}</div>
        </div>
      ` : ``}

      ${showBusinessStatus ? `
        <div class="businessStatusOnly ${businessStatus.className}">
          ${escapeHtml(businessStatus.label)}
        </div>
      ` : ``}
    </div>
  `;
}

function renderTodayRouteBusinessInfoHtml(store, visited) {
  if (!visited) {
    return renderBusinessInfoHtml(store, { className: "todayRouteBusinessInfo" });
  }

  return `
    <div class="businessInfo todayRouteBusinessInfo">
      <div class="businessInfoRow">
        <div class="businessInfoLabel">🕒 営業時間</div>
        <div class="businessInfoValue">${escapeHtml(formatStoreHours(store))}</div>
      </div>

      ${hasRegularClosedDays(store) ? `
        <div class="businessInfoRow">
          <div class="businessInfoLabel">📌 定休日</div>
          <div class="businessInfoValue">${escapeHtml(formatClosedDays(store))}</div>
        </div>
      ` : ``}
    </div>
  `;
}

function getStoreBusinessStatus(store) {
  if (typeof isRegularClosedToday === "function" && isRegularClosedToday(store)) {
    return {
      code: "regular_closed",
      label: "📅 定休日",
      className: "statusClosedDay",
      isBeforeOpen: false,
      isOpen: false,
      isClosingSoon: false,
      isClosed: true,
      remainingMinutes: null
    };
  }

  const openMinutes = parseTimeToMinutes(store?.openTime);
  const closeMinutes = parseTimeToMinutes(store?.closeTime);

  if (openMinutes === null || closeMinutes === null) {
    return {
      code: "unknown",
      label: "📝 未設定",
      className: "statusUnknown",
      isBeforeOpen: false,
      isOpen: false,
      isClosingSoon: false,
      isClosed: false,
      remainingMinutes: null
    };
  }

  const nowMinutes = getNowMinutes();

  if (nowMinutes < openMinutes) {
    return {
      code: "before_open",
      label: `🕒 開店前（${store.openTime}開店）`,
      className: "statusBeforeOpen",
      isBeforeOpen: true,
      isOpen: false,
      isClosingSoon: false,
      isClosed: false,
      remainingMinutes: openMinutes - nowMinutes
    };
  }

  if (nowMinutes >= closeMinutes) {
    return {
      code: "closed",
      label: `🚫 閉店済み（${store.closeTime}閉店）`,
      className: "statusClosed",
      isBeforeOpen: false,
      isOpen: false,
      isClosingSoon: false,
      isClosed: true,
      remainingMinutes: 0
    };
  }

  const remainingMinutes = closeMinutes - nowMinutes;

  if (remainingMinutes <= 60) {
    return {
      code: "closing_soon",
      label: `⚠️ まもなく閉店（あと${remainingMinutes}分）`,
      className: "statusClosingSoon",
      isBeforeOpen: false,
      isOpen: true,
      isClosingSoon: true,
      isClosed: false,
      remainingMinutes
    };
  }

  return {
    code: "open",
    label: "✅ 営業中",
    className: "statusOpen",
    isBeforeOpen: false,
    isOpen: true,
    isClosingSoon: false,
    isClosed: false,
    remainingMinutes
  };
}

function maybeNotifyClosingSoonStores() {
  cleanupOldClosingAlerts();

  const targets = stores.filter(store =>
    store &&
    store.today &&
    !isTodayRouteVisited(store.id)
  );

  const notifyTargets = targets.filter(store => {
    const status = getStoreBusinessStatus(store);
    if (status.code === "regular_closed") return false;
    if (!status.isClosingSoon) return false;
    if (hasClosingAlertedToday(store.id)) return false;
    return true;
  });

  if (!notifyTargets.length) return;

  notifyTargets.forEach(store => markClosingAlertedToday(store.id));

  const message = notifyTargets
    .map(store => {
      const status = getStoreBusinessStatus(store);
      return `・${store.name}（${formatStoreHours(store)} / あと${status.remainingMinutes}分）`;
    })
    .join("\n");

  alert(`閉店1時間前の店舗があります。\n\n${message}`);
}

let todayRouteVisitedIds = loadTodayRouteVisitedIds();

function toggleStoreAddAccordion(forceOpen = null) {
  const body = document.getElementById("storeAddAccordionBody");
  const header = document.getElementById("storeAddAccordionHeader");
  const chevron = document.getElementById("storeAddAccordionChevron");
  if (!body || !header || !chevron) return;

  const currentOpen = body.style.display !== "none";
  const willOpen = forceOpen === null ? !currentOpen : !!forceOpen;

  body.style.display = willOpen ? "block" : "none";
  header.setAttribute("aria-expanded", willOpen ? "true" : "false");
  chevron.textContent = willOpen ? "▲" : "▼";

  localStorage.setItem(
    STORE_ADD_ACCORDION_KEY,
    willOpen ? "open" : "closed"
  );
}

function restoreStoreAddAccordion() {
  const saved = localStorage.getItem(STORE_ADD_ACCORDION_KEY);

  if (saved === "closed") {
    toggleStoreAddAccordion(false);
    return;
  }

  toggleStoreAddAccordion(true);
}

function toggleTodayRouteAccordion(forceOpen = null) {
  const body = document.getElementById("todayRouteAccordionBody");
  const header = document.getElementById("todayRouteAccordionHeader");
  const chevron = document.getElementById("todayRouteAccordionChevron");
  if (!body || !header || !chevron) return;

  const willOpen = forceOpen === null ? !todayRouteAccordionOpen : !!forceOpen;
  todayRouteAccordionOpen = willOpen;

  body.style.display = willOpen ? "block" : "none";
  header.setAttribute("aria-expanded", willOpen ? "true" : "false");
  chevron.textContent = willOpen ? "▲" : "▼";
}

function syncTodayRouteAccordionUI() {
  toggleTodayRouteAccordion(todayRouteAccordionOpen);
}

function scrollToStoreList() {
  const target = document.getElementById("storeListSection");
  if (!target) return;

  target.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function scrollToTopArea() {
  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function isTodayRouteVisited(storeId) {
  return todayRouteVisitedIds.includes(storeId);
}

function markTodayRouteVisited(storeId) {
  if (!storeId) return;
  if (!todayRouteVisitedIds.includes(storeId)) {
    todayRouteVisitedIds.push(storeId);
    saveTodayRouteVisitedIds();
  }
}

function unmarkTodayRouteVisited(storeId) {
  todayRouteVisitedIds = todayRouteVisitedIds.filter(id => id !== storeId);
  saveTodayRouteVisitedIds();
}

function syncTodayRouteVisitedIds() {
  const todayIds = stores.filter(s => s.today).map(s => s.id);
  const todaySet = new Set(todayIds);
  todayRouteVisitedIds = todayRouteVisitedIds.filter(id => todaySet.has(id));
  saveTodayRouteVisitedIds();
}

function buildFilteredStoreList() {
  const { q, prefFilter, minExpected, minRate, sortType } = getFilterValues();

  let list = stores.map((s, idx) => {
    const m = getMetrics(s);
    let dist = null;
    if (window.lastPos && hasCoords(s)) {
      dist = distanceKm(window.lastPos.lat, window.lastPos.lng, s.lat, s.lng);
    }
    return { ...s, _idx: idx, _m: m, _dist: dist };
  });

  list = list
    .filter(s => matchesQuery(s, q))
    .filter(s => prefFilter === "__ALL__" || s.pref === prefFilter)
    .filter(s => s._m.expected >= minExpected)
    .filter(s => s._m.rate >= minRate);

  if (nearbyMode) {
    list = list.filter(s => nearbyStoreIds.has(s.id));
  }

  if (noCoordsOnlyMode) {
    list = list.filter(s => !hasCoords(s));
  }

  list.sort((a, b) => {
    if (sortType === "rate") return b._m.rate - a._m.rate;
    if (sortType === "avgProfit") return b._m.avgProfit - a._m.avgProfit;
    if (sortType === "visits") return b._m.visits - a._m.visits;
    if (sortType === "route") {
      const ad = typeof a._dist === "number" ? a._dist : Infinity;
      const bd = typeof b._dist === "number" ? b._dist : Infinity;
      return ad - bd;
    }
    return b._m.expected - a._m.expected;
  });

  return list;
}

function buildPrefFilter() {
  const prefs = [...new Set(stores.map(s => s.pref).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ja")
  );

  const sel = document.getElementById("prefFilter");
  if (!sel) return;

  const current = sel.value || "__ALL__";
  sel.innerHTML =
    `<option value="__ALL__">全て（都道府県ごと）</option>` +
    prefs.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");

  if (["__ALL__", ...prefs].includes(current)) {
    sel.value = current;
  }
}

function updateLayoutButtons() {
  const detailBtn = document.getElementById("detailLayoutBtn");
  const compactBtn = document.getElementById("compactLayoutBtn");

  if (detailBtn) {
    detailBtn.classList.toggle("primaryBtn", currentLayoutMode === "detail");
    detailBtn.classList.toggle("ghostBtn", currentLayoutMode !== "detail");
    detailBtn.classList.toggle("activeLayout", currentLayoutMode === "detail");
  }

  if (compactBtn) {
    compactBtn.classList.toggle("primaryBtn", currentLayoutMode === "compact");
    compactBtn.classList.toggle("ghostBtn", currentLayoutMode !== "compact");
    compactBtn.classList.toggle("activeLayout", currentLayoutMode === "compact");
  }
}

function renderCompactStoreCard(s, idx, m, dist, evalData, rateClass, expectedClass, staleClass) {
  const expectedHighClass = m.expected >= 10000 ? "high" : "";
  const compactBadges = [
    `<span class="badge">${escapeHtml(s.pref || "未設定")}</span>`,
    typeof dist === "number" ? `<span class="badge near">📍 ${dist.toFixed(1)}km</span>` : ``,
    s.mapUrl ? `<span class="badge map">🗺 MAPあり</span>` : ``,
    hasCoords(s) ? `<span class="badge">📡 座標あり</span>` : ``,
    `<span class="badge freq">補充頻度 ${formatRestockDays(m.freq)}</span>`
  ].filter(Boolean).join("");

  return `
    <div class="item compactCard ${expectedClass} ${staleClass}">
      <div class="evalLabel ${evalData.class}">
        ${evalData.label}
      </div>

      <div class="name">${escapeHtml(s.name)}</div>

      <div class="mt8">
        ${compactBadges}
      </div>

      ${renderBusinessInfoHtml(s)}

      ${s.memo ? `
        <div class="mini mt6">
          📝 ${escapeHtml(s.memo)}
        </div>
      ` : ``}

      <div class="mini compactMainRow">
        <span>期待値 <span class="mainExpected ${expectedHighClass}">${Math.round(m.expected).toLocaleString()}円</span></span>
        <span class="${rateClass}">成功率 ${m.rate.toFixed(1)}%</span>
        <span>利益 <span class="mainProfit">${m.profit.toLocaleString()}円</span></span>
      </div>

      <div class="mini compactSubRow">
        <span>訪問 ${m.visits}回</span>
        <span>成功 ${m.success}回</span>
        <span>個数 ${m.items}個</span>
      </div>

      <div class="mt10">
        ${renderTodayToggleButton(idx, s.today)}
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#dff7e8", "#129b52")} onclick="visit(${idx})">訪問＋</button>
        <button ${makeButtonStyle("#e7f0ff", "#2563eb")} onclick="itemsPlus(${idx})">個数＋</button>
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="navigateToStore(${idx})">ナビ</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="editStore(${idx})">設定</button>
      </div>
    </div>
  `;
}

function renderDetailStoreCard(s, idx, m, dist, evalData, rateClass, expectedClass, staleClass) {
  const recent = getRecentStats(s.id);
  const streak = getNoSuccessStreak(s.id);
  const sinceVisitText = formatDaysSinceLastVisit(s.lastVisitDate);

  const categorySummary = Object.entries(s.categoryCounts || {})
    .filter(([, qty]) => Number(qty) > 0)
    .map(([cat, qty]) => `${cat}:${qty}`)
    .join(" / ");

  return `
    <div class="item ${expectedClass} ${staleClass}">
      <div class="evalLabel ${evalData.class}">
        ${evalData.label}
      </div>

      <div class="name">${escapeHtml(s.name)}</div>

      <div class="mt8">
        <span class="badge">${escapeHtml(s.pref || "未設定")}</span>
        ${typeof dist === "number" ? `<span class="badge near">📍 ${dist.toFixed(1)}km</span>` : ``}
        ${s.mapUrl ? `<span class="badge map">🗺 MAPあり</span>` : ``}
        ${hasCoords(s) ? `<span class="badge">📡 座標あり</span>` : ``}
        <span class="badge freq">補充頻度 ${formatRestockDays(m.freq)}</span>
      </div>

      ${renderBusinessInfoHtml(s)}

      ${s.memo ? `<div class="mini mt8">📝 ${escapeHtml(s.memo)}</div>` : ``}
      ${s.address ? `<div class="mini mt8">📍 ${escapeHtml(s.address)}</div>` : ``}

      <div class="mini mt8">
        期待値：${Math.round(m.expected).toLocaleString()}円
      </div>

      <div class="mini mt8" style="line-height:1.6;">
        利益：${m.profit.toLocaleString()}円 / <span class="${rateClass}">成功率：${m.rate.toFixed(1)}%</span><br>
        平均利益：${Math.round(m.avgProfit).toLocaleString()}円 / 平均個数：${m.avgItems.toFixed(1)}個
      </div>

      <div class="mini mt8">
        訪問：${m.visits}回 / 成功：${m.success}回 / 個数：${m.items}個
      </div>

      ${categorySummary ? `<div class="mini mt8">📦 ${escapeHtml(categorySummary)}</div>` : ``}

      <div class="detailBox">
        <div class="detailLine">📅 最終訪問：${s.lastVisitDate ? escapeHtml(s.lastVisitDate) : "なし"}</div>
        <div class="detailLine">🕒 最終訪問から：${escapeHtml(sinceVisitText)}</div>
        <div class="detailLine">📊 直近3回：成功 ${recent.recentSuccess}回 / ${recent.recentVisitCount}訪問（${recent.recentRate.toFixed(1)}%）</div>
        <div class="detailLine">💰 訪問あたり期待値：${Math.round(m.expected).toLocaleString()}円</div>
        ${streak >= 3 ? `<div class="detailLine detailWarn">⚠️ ${streak}回連続成功なし</div>` : ``}
      </div>

      <div class="mt10">
        ${renderTodayToggleButton(idx, s.today)}
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#dff7e8", "#129b52")} onclick="visit(${idx})">訪問＋</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="visitMinus(${idx})">訪問−</button>
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#e7f0ff", "#2563eb")} onclick="itemsPlus(${idx})">個数＋</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="itemsMinus(${idx})">個数−</button>
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="navigateToStore(${idx})">ナビ</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="refreshStoreCoordinates(${idx})">座標再取得</button>
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="editStore(${idx})">設定</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="deleteStore(${idx})">削除</button>
      </div>
    </div>
  `;
}

function renderStoreCard(s, idx) {
  const m = getMetrics(s);
  const evalData = getStoreEvaluationLabel(m);
  const rateClass = getRateClass(m.rate);
  const expectedClass = getExpectedCardClass(m.expected);
  const staleClass = getStaleCardClass(s.lastVisitDate);

  let dist = null;
  if (window.lastPos && hasCoords(s)) {
    dist = distanceKm(window.lastPos.lat, window.lastPos.lng, s.lat, s.lng);
  }

  if (currentLayoutMode === "compact") {
    return renderCompactStoreCard(s, idx, m, dist, evalData, rateClass, expectedClass, staleClass);
  }

  return renderDetailStoreCard(s, idx, m, dist, evalData, rateClass, expectedClass, staleClass);
}


/* =========================
   保存ルート巡回実績表示
========================= */
function getRouteRunSummary(routeId) {
  const id = String(routeId || "");
  const history = Array.isArray(routeRunHistory)
    ? routeRunHistory.filter(item => String(item.routeId || "") === id)
    : [];

  const runCount = history.length;
  const totalProfit = history.reduce(
    (sum, item) => sum + Number(item.profit || 0),
    0
  );
  const totalItems = history.reduce(
    (sum, item) => sum + Number(item.items || 0),
    0
  );
  const totalVisitedStores = history.reduce(
    (sum, item) => sum + Number(item.visitedStoreCount || 0),
    0
  );
  const totalSuccessStores = history.reduce(
    (sum, item) => sum + Number(item.successStoreCount || 0),
    0
  );

  return {
    history: [...history].sort((a, b) => {
      const dateDiff = String(b.date || "").localeCompare(String(a.date || ""));
      if (dateDiff !== 0) return dateDiff;
      return String(b.updatedAt || b.createdAt || "")
        .localeCompare(String(a.updatedAt || a.createdAt || ""));
    }),
    runCount,
    totalProfit,
    averageProfit: runCount > 0 ? totalProfit / runCount : 0,
    totalItems,
    averageItems: runCount > 0 ? totalItems / runCount : 0,
    totalVisitedStores,
    averageVisitedStores: runCount > 0 ? totalVisitedStores / runCount : 0,
    totalSuccessStores,
    averageSuccessStores: runCount > 0 ? totalSuccessStores / runCount : 0,
    profitPerVisitedStore:
      totalVisitedStores > 0 ? totalProfit / totalVisitedStores : 0
  };
}

function getSelectedRouteRunSummary() {
  const selectedIds =
    typeof selectedRouteRunIds !== "undefined" &&
    selectedRouteRunIds instanceof Set
      ? [...selectedRouteRunIds]
      : [];

  const validIds = selectedIds.filter(id =>
    savedRoutes.some(route => String(route.id || "") === String(id || ""))
  );

  const selectedHistory = (Array.isArray(routeRunHistory) ? routeRunHistory : [])
    .filter(item => validIds.includes(String(item.routeId || "")));

  const runCount = selectedHistory.length;
  const totalProfit = selectedHistory.reduce(
    (sum, item) => sum + Number(item.profit || 0),
    0
  );
  const totalItems = selectedHistory.reduce(
    (sum, item) => sum + Number(item.items || 0),
    0
  );
  const totalVisitedStores = selectedHistory.reduce(
    (sum, item) => sum + Number(item.visitedStoreCount || 0),
    0
  );
  const totalSuccessStores = selectedHistory.reduce(
    (sum, item) => sum + Number(item.successStoreCount || 0),
    0
  );

  return {
    selectedRouteCount: validIds.length,
    selectedIds: validIds,
    runCount,
    totalProfit,
    averageProfit: runCount > 0 ? totalProfit / runCount : 0,
    totalItems,
    averageItems: runCount > 0 ? totalItems / runCount : 0,
    totalVisitedStores,
    averageVisitedStores: runCount > 0 ? totalVisitedStores / runCount : 0,
    totalSuccessStores,
    averageSuccessStores: runCount > 0 ? totalSuccessStores / runCount : 0,
    profitPerVisitedStore:
      totalVisitedStores > 0 ? totalProfit / totalVisitedStores : 0
  };
}

function renderRouteRunMetricsHtml(summary, title = "巡回実績") {
  return `
    <div class="routeRunSummaryCard">
      <div class="routeRunSummaryTitle">${escapeHtml(title)}</div>

      <div class="routeRunMetricGrid">
        <div class="routeRunMetric">
          <div class="routeRunMetricLabel">巡回回数</div>
          <div class="routeRunMetricValue">${summary.runCount}回</div>
        </div>

        <div class="routeRunMetric">
          <div class="routeRunMetricLabel">合計利益</div>
          <div class="routeRunMetricValue">${Math.round(summary.totalProfit).toLocaleString()}円</div>
        </div>

        <div class="routeRunMetric">
          <div class="routeRunMetricLabel">平均利益</div>
          <div class="routeRunMetricValue">${Math.round(summary.averageProfit).toLocaleString()}円</div>
        </div>

        <div class="routeRunMetric">
          <div class="routeRunMetricLabel">合計個数</div>
          <div class="routeRunMetricValue">${Math.round(summary.totalItems).toLocaleString()}個</div>
        </div>

        <div class="routeRunMetric">
          <div class="routeRunMetricLabel">平均個数</div>
          <div class="routeRunMetricValue">${summary.averageItems.toFixed(1)}個</div>
        </div>

        <div class="routeRunMetric">
          <div class="routeRunMetricLabel">平均訪問店舗</div>
          <div class="routeRunMetricValue">${summary.averageVisitedStores.toFixed(1)}件</div>
        </div>

        <div class="routeRunMetric">
          <div class="routeRunMetricLabel">平均成功店舗</div>
          <div class="routeRunMetricValue">${summary.averageSuccessStores.toFixed(1)}件</div>
        </div>

        <div class="routeRunMetric">
          <div class="routeRunMetricLabel">訪問1店舗期待値</div>
          <div class="routeRunMetricValue">${Math.round(summary.profitPerVisitedStore).toLocaleString()}円</div>
        </div>
      </div>
    </div>
  `;
}

function renderRouteRunHistoryHtml(summary) {
  if (!summary.history.length) {
    return `
      <div class="routeRunHistoryEmpty">
        巡回履歴はまだありません。「今回の巡回を記録」から追加できます。
      </div>
    `;
  }

  return `
    <div class="routeRunHistoryList">
      ${summary.history.map(item => `
        <div class="routeRunHistoryItem">
          <div class="routeRunHistoryTop">
            <div>
              <div class="routeRunHistoryDate">${escapeHtml(item.date || "日付不明")}</div>
              <div class="routeRunHistoryMeta">
                利益 ${Number(item.profit || 0).toLocaleString()}円 /
                個数 ${Number(item.items || 0).toLocaleString()}個
              </div>
            </div>

            <div class="routeRunHistoryVisit">
              訪問 ${Number(item.visitedStoreCount || 0)}件
            </div>
          </div>

          <div class="routeRunHistorySub">
            成功店舗 ${Number(item.successStoreCount || 0)}件 /
            訪問記録 ${Number(item.visitCount || 0)}回 /
            成功記録 ${Number(item.successCount || 0)}回
          </div>

          <div class="routeRunHistoryActions">
            <button
              type="button"
              class="ghostBtn"
              onclick="recalculateSavedRouteRun('${escapeJsString(item.id)}')"
            >再集計</button>

            <button
              type="button"
              class="dangerBtn"
              onclick="deleteSavedRouteRun('${escapeJsString(item.id)}')"
            >削除</button>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderSelectedRouteRunSummaryHtml() {
  const summary = getSelectedRouteRunSummary();

  if (!summary.selectedRouteCount) return "";

  return `
    <div class="routeCombinedSummary">
      <div class="routeCombinedHeader">
        <div>
          <div class="routeCombinedTitle">選択ルート合算</div>
          <div class="routeCombinedSub">
            ${summary.selectedRouteCount}ルートを選択中
          </div>
        </div>

        <button
          type="button"
          class="ghostBtn routeCombinedClearBtn"
          onclick="clearSavedRouteSummarySelection()"
        >選択解除</button>
      </div>

      ${renderRouteRunMetricsHtml(summary, "合算実績")}
    </div>
  `;
}

function renderSavedRoutesList() {
  const el = document.getElementById("savedRoutesList");
  if (!el) return;

  if (!savedRoutes.length) {
    el.innerHTML = "保存済みルートはまだありません。";
    return;
  }

  sortSavedRoutes();

  const combinedSummaryHtml = renderSelectedRouteRunSummaryHtml();

  el.innerHTML = `
    ${combinedSummaryHtml}

    ${savedRoutes.map(route => {
      const routeStores = buildSavedRouteStores(route);
      const isOpen = openSavedRouteId === route.id;
      const dueSummary = calcSavedRouteDueSummary(route);
      const runSummary = getRouteRunSummary(route.id);
      const isSelected =
        typeof isSavedRouteSelectedForSummary === "function"
          ? isSavedRouteSelectedForSummary(route.id)
          : false;

      return `
        <div class="savedRouteAccordion ${isOpen ? "open" : ""}" style="margin-top:12px;">
          <button
            type="button"
            class="savedRouteSummary"
            onclick="toggleSavedRouteOpen('${escapeJsString(route.id)}')"
          >
            <div class="savedRouteSummaryTop">
              <div class="savedRouteTitleWrap">
                <div class="savedRouteTitleRow">
                  <span class="savedRouteTitle">${escapeHtml(route.name)}</span>
                  <span class="savedRouteFavBadge">${dueSummary.emoji} ${dueSummary.label}</span>
                  ${route.favorite ? `<span class="savedRouteFavBadge">★ お気に入り</span>` : ``}
                  ${isSelected ? `<span class="savedRouteSelectedBadge">✓ 合算対象</span>` : ``}
                </div>

                <div class="savedRouteMeta">
                  更新: ${escapeHtml(formatDateTimeText(route.updatedAt || route.createdAt))}
                </div>
              </div>

              <div class="savedRouteChevron">${isOpen ? "▲" : "▼"}</div>
            </div>

            <div class="savedRouteCompactInfo">
              <div class="savedRouteCount">
                店舗数: ${route.storeIds.length}件 /
                巡回: ${runSummary.runCount}回 /
                平均利益: ${Math.round(runSummary.averageProfit).toLocaleString()}円
              </div>
            </div>
          </button>

          <div class="savedRouteDetail" style="display:${isOpen ? "block" : "none"};">
            <div class="detailBlock" style="margin-bottom:12px;">
              <div class="detailTitle">ルート情報</div>
              <div class="detailText">
                ${dueSummary.emoji} ${escapeHtml(dueSummary.label)}<br>
                回り頃: ${dueSummary.dueCount}件 / もうすぐ: ${dueSummary.soonCount}件<br>
                平均補充頻度: ${dueSummary.avgFreq !== null ? escapeHtml(formatRestockDays(dueSummary.avgFreq)) : "データなし"}
                ${route.note ? `<br>メモ: ${escapeHtml(route.note)}` : ""}
              </div>
            </div>

            ${renderRouteRunMetricsHtml(runSummary)}

            <div class="routeRunMainActions">
              <button
                type="button"
                class="primaryBtn"
                onclick="recordSavedRouteRun('${escapeJsString(route.id)}')"
              >今回の巡回を記録</button>

              <button
                type="button"
                class="${isSelected ? "btnGreen" : "ghostBtn"}"
                onclick="toggleSavedRouteSummarySelection('${escapeJsString(route.id)}')"
              >${isSelected ? "✓ 合算対象から外す" : "合算対象に選択"}</button>
            </div>

            <div class="routeRunHistoryTitle">巡回履歴</div>
            ${renderRouteRunHistoryHtml(runSummary)}

            ${
              routeStores.length
                ? `
                  <div class="savedRouteFullList routeRunStoreList">
                    ${routeStores.map(s => {
                      const m = getMetrics(s);
                      const status = calcStoreDueStatus(s);
                      return `
                        <div class="savedRouteStoreLine" style="display:block;">
                          <div style="font-weight:700;">${status.emoji} ${escapeHtml(s.name)}</div>
                          <div class="mini" style="margin-top:4px;">
                            補充頻度: ${formatRestockDays(m.freq)} / 成功率: ${m.rate.toFixed(1)}% / 期待値: ${Math.round(m.expected).toLocaleString()}円
                          </div>
                        </div>
                      `;
                    }).join("")}
                  </div>
                `
                : `<div class="mini">このルートの店舗が見つかりません。</div>`
            }

            <div class="savedRouteActionGrid">
              <button ${makeButtonStyle("#e7f0ff", "#2563eb")} class="savedRouteActionBtn" onclick="openSavedRoute('${escapeJsString(route.id)}')">今日に読込</button>
              <button ${makeButtonStyle("#dff7e8", "#129b52")} class="savedRouteActionBtn" onclick="openSavedRouteInMaps('${escapeJsString(route.id)}')">MAPで開く</button>
              <button ${makeButtonStyle("#fff4d8", "#b7791f")} class="savedRouteActionBtn" onclick="toggleFavoriteRoute('${escapeJsString(route.id)}')">${route.favorite ? "★ お気に入り解除" : "☆ お気に入り"}</button>
              <button ${makeButtonStyle("#eef1f7", "#1f2340")} class="savedRouteActionBtn" onclick="editSavedRoute('${escapeJsString(route.id)}')">編集</button>
              <button ${makeButtonStyle("#fef2f2", "#dc2626")} class="savedRouteActionBtn" onclick="deleteSavedRoute('${escapeJsString(route.id)}')">削除</button>
            </div>
          </div>
        </div>
      `;
    }).join("")}
  `;
}

function renderTodayRouteList() {
  const el = document.getElementById("todayRouteList");
  if (!el) return;

  syncTodayRouteOrder();
  syncTodayRouteVisitedIds();

  const routeStores = todayRouteOrder
    .map(id => stores.find(s => s.id === id))
    .filter(s => s && s.today);

  if (!routeStores.length) {
    el.innerHTML = `<div class="mini emptyRouteText">チェックした店舗はまだありません。</div>`;
    return;
  }

  const splitButtonsHtml =
    splitRouteCache?.parts?.length
      ? `
        <div class="routeSplitBtns">
          ${splitRouteCache.parts.map(part => `
            <div class="routeSplitBlock mt8">
              <div class="routeSplitRow">
                <button class="primaryBtn routeSplitOpenBtn" onclick="openSplitRoutePart(${part.index})">
                  ルート${part.index}を開く
                </button>
                <div class="routeSplitEta">
                  推定 約${formatEstimatedMinutes(part.estimatedMinutes)}
                </div>
              </div>
              <div class="mini routeSplitSub">
                対象: ${part.start}〜${part.end}店舗目
              </div>
            </div>
          `).join("")}
        </div>
      `
      : "";

  el.innerHTML = `
    ${splitButtonsHtml}
    ${routeStores.map((s, idx) => {
      const visited = isTodayRouteVisited(s.id);

      return `
        <div class="item todayRouteItem ${visited ? "todayRouteItemVisited" : ""}">
          <div class="name todayRouteName">
            ${idx + 1}. ${escapeHtml(s.name)}
            ${visited ? `<span class="badge" style="margin-left:8px;">訪問済み</span>` : ``}
          </div>

          <div class="mini">
            ${escapeHtml(s.pref || "")}${s.address ? ` / ${escapeHtml(s.address)}` : ""}
          </div>

          ${renderTodayRouteBusinessInfoHtml(s, visited)}

          ${s.memo ? `
            <div class="mini mt6">
              📝 ${escapeHtml(s.memo)}
            </div>
          ` : ``}

          <div class="row2 mt8">
            <button class="ghostBtn" onclick="moveTodayRouteItem(${idx}, -1)">↑ 上へ</button>
            <button class="ghostBtn" onclick="moveTodayRouteItem(${idx}, 1)">↓ 下へ</button>
          </div>

          <div class="row2 mt8">
            <button class="dangerBtn" onclick="removeTodayRouteItem(${idx})">ルートから外す</button>
            <button class="ghostBtn" onclick="unmarkTodayRouteVisited('${escapeJsString(s.id)}')">訪問済み解除</button>
          </div>
        </div>
      `;
    }).join("")}
  `;
}

function render() {
  syncStoreProfitsFromLogs();
  updateLayoutButtons();
  buildPrefFilter();
  syncTodayRouteOrder();
  syncTodayRouteVisitedIds();

  const list = buildFilteredStoreList();
  const wrap = document.getElementById("storeList");
  if (!wrap) return;

  const filterValues = getFilterValues();
  const signature = JSON.stringify({
    ids: list.map(s => s.id),
    q: filterValues.q,
    prefFilter: filterValues.prefFilter,
    minExpected: filterValues.minExpected,
    minRate: filterValues.minRate,
    sortType: filterValues.sortType,
    nearbyMode,
    noCoordsOnlyMode,
    layout: currentLayoutMode,
    todayMarks: stores.filter(s => s.today).map(s => s.id),
    todayRouteOrder,
    todayRouteVisitedIds,
    splitRouteCacheExists: !!splitRouteCache,
    splitRouteParts: splitRouteCache?.parts?.map(p => `${p.index}:${p.start}-${p.end}:${p.estimatedMinutes}`).join("|") || "",
    lastVisitDates: stores.map(s => `${s.id}:${s.lastVisitDate}`),
    storeProfits: stores.map(s => `${s.id}:${Number(s.profit || 0)}`).join("|"),
    storeHours: stores.map(s => `${s.id}:${s.openTime || ""}-${s.closeTime || ""}`).join("|"),
    storeClosedDays: stores.map(s => `${s.id}:${(s.regularClosedDays || []).join(",")}`).join("|"),
    storeMemos: stores.map(s => `${s.id}:${s.memo || ""}`).join("|"),
    savedRoutes: savedRoutes.map(r => `${r.id}:${r.updatedAt}:${r.favorite}`).join("|"),
    routeRunHistory: routeRunHistory.map(h => `${h.id}:${h.routeId}:${h.date}:${h.profit}:${h.items}:${h.visitedStoreCount}:${h.updatedAt}`).join("|"),
    selectedRouteRunIds: typeof selectedRouteRunIds !== "undefined" ? [...selectedRouteRunIds].sort().join("|") : "",
    openSavedRouteId,
    todayRouteAccordionOpen,
    currentLocation: window.lastPos ? `${window.lastPos.lat},${window.lastPos.lng}` : ""
  });

  if (signature !== lastListRenderSignature) {
    wrap.innerHTML = list.length
      ? list.map(s => renderStoreCard(s, s._idx)).join("")
      : `<div class="mini">${nearbyMode ? "近くの店舗は見つかりませんでした。" : "該当する店舗がありません。"}</div>`;
    lastListRenderSignature = signature;
  }

  renderSavedRoutesList();
  renderTodayRouteList();

  if (typeof scheduleRenderMapMarkers === "function") {
    scheduleRenderMapMarkers();
  }

  if (typeof renderCurrentLocationMarker === "function") {
    renderCurrentLocationMarker();
  }

  syncTodayRouteAccordionUI();

  if (typeof renderBadgesIfExists === "function") {
    try {
      renderBadgesIfExists();
    } catch (e) {
      console.error("renderBadgesIfExists error:", e);
    }
  }

  maybeNotifyClosingSoonStores();
}

let helpStep = 0;

const helpData = [
  {
    title: "📘 このアプリでできること",
    content: `
      <b>せどり店舗を記録・分析して、回る価値の高い店舗を見つけるための管理アプリです。</b><br><br>
      主にできることは次の通りです。<br><br>
      ・店舗名、都道府県、住所、GoogleマップURLを登録<br>
      ・訪問回数、成功回数、個数、利益を記録<br>
      ・期待値、成功率、平均利益を自動計算<br>
      ・現在地から近い店舗を表示<br>
      ・今日行く店舗を選んでルート作成<br>
      ・保存済みルートの再利用<br>
      ・レポート画面で月別 / 日別の振り返り<br><br>
      <b>基本は「店舗登録 → 訪問記録 → 成功記録 → レポート確認」の流れです。</b>
    `
  },
  {
    title: "🏪 まず最初にやること",
    content: `
      <b>最初は店舗を登録します。</b><br><br>
      入力する項目は次の4つです。<br><br>
      ・店舗名<br>
      ・都道府県<br>
      ・住所<br>
      ・GoogleマップURL（あれば便利）<br><br>
      <b>GoogleマップURLがあると、座標を取りやすくなります。</b><br>
      URLがなくても、住所が入っていれば登録できます。<br><br>
      店舗追加後に地図へ出ない場合は、<br>
      <b>「座標一括再取得」</b> を押すと直ることがあります。
    `
  },
  {
    title: "👣 訪問＋ と 個数＋ の使い方",
    content: `
      <b>店舗に行ったらまず「訪問＋」を押します。</b><br><br>
      訪問＋で記録される内容<br>
      ・訪問回数 +1<br>
      ・最終訪問日の更新<br>
      ・今日のルート中なら訪問済み扱い<br><br>
      <b>仕入れできた時は「個数＋」を押します。</b><br><br>
      個数＋でできること<br>
      ・仕入れ個数の入力<br>
      ・カテゴリごとの個数入力<br>
      ・利益入力<br><br>
      例：<br>
      合計3個仕入れた場合<br>
      ・ゲーム 2個<br>
      ・家電 1個<br>
      ・利益 5000円<br><br>
      この内容をまとめて記録できます。
    `
  },
  {
    title: "💰 利益入力とカテゴリ入力のポイント",
    content: `
      <b>個数＋を押すと、カテゴリと利益を一緒に入れられます。</b><br><br>
      利益ボタンは現在、<b>押した分だけ加算</b>されます。<br><br>
      例：<br>
      ・1000 を2回押す → 2000円<br>
      ・10000 と 3000 を押す → 13000円<br><br>
      手入力もできます。<br><br>
      カテゴリは履歴から選べるので、よく使うカテゴリは入力しやすくなります。<br>
      新しいカテゴリもその場で追加できます。<br><br>
      <b>カテゴリ個数の合計と、合計個数は一致させる必要があります。</b>
    `
  },
  {
    title: "📊 数字の見方",
    content: `
      <b>店舗カードでは、主に次の数字を見ます。</b><br><br>
      ・期待値<br>
      → その店舗に1回行った時の平均利益の目安です。<br><br>
      ・成功率<br>
      → 訪問した中で、仕入れ成功になった割合です。<br><br>
      ・利益<br>
      → その店舗で記録した累計利益です。<br><br>
      ・平均利益<br>
      → 成功1回あたりの平均利益です。<br><br>
      <b>目安としては、期待値が高く、成功率も高い店舗ほど優先度が上がります。</b>
    `
  },
  {
    title: "🗺 地図・近くの店舗・現在地",
    content: `
      <b>地図では店舗の位置をまとめて確認できます。</b><br><br>
      できること<br>
      ・店舗マーカーをタップして詳細を見る<br>
      ・その場で「今日行く」を付ける<br>
      ・ナビを開く<br><br>
      <b>「現在地へ移動」</b> を押すと、今いる場所付近へ地図が移動します。<br>
      現在地はナビ矢印風マーカーで表示されます。<br><br>
      <b>「近くの店舗」</b> を押すと、現在地から近い店舗を絞って見やすくできます。<br>
      近くの店舗確認と、今日の巡回候補探しに便利です。
    `
  },
  {
    title: "🛣 今日のルートの使い方",
    content: `
      <b>行く予定の店舗には「今日行く」を付けます。</b><br><br>
      その後、<b>「この順番でルート作成」</b> を押すとGoogleマップでルートを開けます。<br><br>
      便利な機能<br>
      ・自動最適化<br>
      → 順番を並び替えて回りやすくします。<br><br>
      ・訪問済み管理<br>
      → 今日のルート中の店舗で「訪問＋」を押すと、その店舗は訪問済みになります。<br><br>
      ・途中から再開<br>
      → ルートが切れても、未訪問の店舗だけで再作成できます。<br><br>
      <b>保存前に前の「今日行く」が残っていると、次のルートにも含まれるので注意してください。</b>
    `
  },
  {
    title: "⭐ 保存済みルートの使い方",
    content: `
      <b>今日のルートは保存できます。</b><br><br>
      保存するとできること<br>
      ・同じ巡回ルートをあとで再利用<br>
      ・MAPで再度開く<br>
      ・お気に入り化<br>
      ・ルート名やメモ編集<br><br>
      保存済みルートには、補充頻度や回り頃の目安も表示されます。<br><br>
      <b>よく回る地域ごとに保存しておくと便利です。</b><br>
      例：<br>
      ・新潟市ルート<br>
      ・長岡ルート<br>
      ・県外遠征ルート
    `
  },
  {
    title: "📈 レポート画面の見方",
    content: `
      <b>レポート画面では月別 / 日別の振り返りができます。</b><br><br>
      見られる内容<br>
      ・月間利益<br>
      ・訪問回数<br>
      ・成功回数<br>
      ・個数<br>
      ・カテゴリ集計<br>
      ・期待値TOP5 / 成功率TOP5 / 利益TOP5<br><br>
      カレンダーでは、その日の利益も確認できます。<br><br>
      マークの意味<br>
      ・<b>🎉</b> = 1日の利益が5万円以上<br>
      ・<b>🏆</b> = 1日の利益が10万円以上<br><br>
      <b>利益が出た日や強い店舗を振り返る時に使います。</b>
    `
  },
  {
    title: "🏅 実績機能の見方",
    content: `
      <b>トップ画面には実績カードがあります。</b><br><br>
      表示される内容<br>
      ・解除済み実績数<br>
      ・最新で取った実績<br>
      ・次に近い実績<br><br>
      実績一覧では、達成済み / 未達成を確認できます。<br><br>
      例：<br>
      ・訪問回数系<br>
      ・成功回数系<br>
      ・利益系<br>
      ・ルート達成系<br><br>
      <b>実績一覧はアコーディオンで開閉できます。</b>
    `
  },
  {
    title: "🔧 困った時の見方",
    content: `
      <b>うまく表示されない時は次を確認してください。</b><br><br>
      ・地図に出ない<br>
      → 住所やGoogleマップURLを確認して、座標一括再取得を試す<br><br>
      ・ルートに前の店舗が混ざる<br>
      → 今日行くのチェックが残っていないか確認する<br><br>
      ・近くの店舗が出ない<br>
      → 位置情報の許可を確認する<br><br>
    `
  }
];

function openHelp() {
  const el = document.getElementById("helpUI");
  const titleEl = document.getElementById("helpTitle");
  const contentEl = document.getElementById("helpContent");

  if (!el || !titleEl || !contentEl) {
    alert("使い方表示の読み込みに失敗しました。");
    return;
  }

  helpStep = 0;
  renderHelp();

  el.classList.add("show");
  el.setAttribute("aria-hidden", "false");
}

function closeHelp() {
  const el = document.getElementById("helpUI");
  if (!el) return;
  el.classList.remove("show");
  el.setAttribute("aria-hidden", "true");
}

function renderHelp() {
  const data = helpData[helpStep];
  const titleEl = document.getElementById("helpTitle");
  const contentEl = document.getElementById("helpContent");
  if (!data || !titleEl || !contentEl) return;

  titleEl.innerHTML = data.title;
  contentEl.innerHTML = data.content;
}

function nextHelp() {
  if (helpStep < helpData.length - 1) {
    helpStep++;
    renderHelp();
  }
}

function prevHelp() {
  if (helpStep > 0) {
    helpStep--;
    renderHelp();
  }
}

function setupButtonPressEffect() {
  const getButton = target => target?.closest?.("button");
  if (!document.body.dataset.pressReady) {
    document.body.dataset.pressReady = "1";

    const on = e => {
      const btn = getButton(e.target);
      if (btn) btn.classList.add("is-pressed");
    };

    const off = e => {
      const btn = getButton(e.target);
      if (btn) btn.classList.remove("is-pressed");
    };

    document.body.addEventListener("touchstart", on, { passive: true });
    document.body.addEventListener("touchend", off, { passive: true });
    document.body.addEventListener("touchcancel", off, { passive: true });

    document.body.addEventListener("mousedown", on);
    document.body.addEventListener("mouseup", off);
    document.body.addEventListener("mouseleave", off, true);
  }
}

function formatTimeInputValue(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 4);

  if (!digits) return "";

  if (digits.length <= 2) {
    const hour = Number(digits);
    if (Number.isNaN(hour) || hour > 23) return "";
    return `${String(hour).padStart(2, "0")}:00`;
  }

  const padded = digits.length === 3 ? `0${digits}` : digits;
  const hour = Number(padded.slice(0, 2));
  const minute = Number(padded.slice(2, 4));

  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    hour > 23 ||
    minute > 59
  ) {
    return "";
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/* =========================
   APIキーなし：Googleマップ店舗検索補助
   店舗検索 / マップURL貼付 / 住所候補自動入力
========================= */
function getStoreAddSearchAreaText() {
  const pref = document.getElementById("prefName")?.value?.trim() || "";
  const address = document.getElementById("address")?.value?.trim() || "";

  return [pref, address]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function openGoogleMapsSearch(query) {
  const text = String(query || "").trim() || "店舗";
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;

  const opened = window.open(url, "_blank");

  if (!opened) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

function openStoreSearchFromForm() {
  const pref = document.getElementById("prefName")?.value?.trim() || "";
  const address = document.getElementById("address")?.value?.trim() || "";
  const storeName = document.getElementById("storeName")?.value?.trim() || "";

  const keyword = [pref, address, storeName]
    .filter(Boolean)
    .join(" ")
    .trim();

  openGoogleMapsSearch(keyword || "リサイクルショップ");
}

/* 旧ボタン名が残っていても動くようにする保険 */
function openRecycleShopSearchFromForm() {
  openStoreSearchFromForm();
}

function extractStoreNameFromGoogleMapUrl(url) {
  const text = String(url || "").trim();
  if (!text) return "";

  try {
    const decoded = decodeURIComponent(text);

    const placeMatch = decoded.match(/\/maps\/place\/([^/]+)/);
    if (placeMatch && placeMatch[1]) {
      const name = String(placeMatch[1])
        .replaceAll("+", " ")
        .trim();

      if (name && name !== "リサイクルショップ") return name;
    }

    const searchMatch = decoded.match(/\/maps\/search\/([^/@]+)/);
    if (searchMatch && searchMatch[1]) {
      const name = String(searchMatch[1])
        .replaceAll("+", " ")
        .trim();

      if (name && name !== "リサイクルショップ") return name;
    }
  } catch (e) {
    console.error("extractStoreNameFromGoogleMapUrl error:", e);
  }

  return "";
}

function hasGoogleMapCoordinateHint(url) {
  const text = String(url || "");

  return (
    /@-?\d+(\.\d+)?,-?\d+(\.\d+)?/.test(text) ||
    /!3d-?\d+(\.\d+)?!4d-?\d+(\.\d+)?/.test(text)
  );
}

function extractPrefFromAddressText(text) {
  const value = String(text || "").trim();

  const prefs = [
    "北海道",
    "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
    "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
    "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
    "岐阜県", "静岡県", "愛知県", "三重県",
    "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
    "鳥取県", "島根県", "岡山県", "広島県", "山口県",
    "徳島県", "香川県", "愛媛県", "高知県",
    "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県",
    "沖縄県"
  ];

  return prefs.find(pref => value.includes(pref)) || "";
}

function buildJapaneseAddressFromNominatimAddress(addr) {
  if (!addr || typeof addr !== "object") return "";

  const parts = [
    addr.province || addr.state || "",
    addr.city || addr.town || addr.village || addr.county || "",
    addr.city_district || addr.suburb || addr.quarter || "",
    addr.neighbourhood || "",
    addr.road || "",
    addr.house_number || ""
  ]
    .map(x => String(x || "").trim())
    .filter(Boolean);

  return [...new Set(parts)].join("");
}

async function reverseGeocodeLatLng(lat, lng) {
  const safeLat = Number(lat);
  const safeLng = Number(lng);

  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng)) {
    return null;
  }

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(safeLat)}&lon=${encodeURIComponent(safeLng)}&zoom=18&addressdetails=1`;

    const res = await fetch(url, {
      headers: {
        Accept: "application/json"
      }
    });

    if (!res.ok) return null;

    const data = await res.json();
    const displayName = String(data?.display_name || "").trim();
    const addressText = buildJapaneseAddressFromNominatimAddress(data?.address) || displayName;

    if (!addressText) return null;

    return {
      pref: extractPrefFromAddressText(addressText),
      address: addressText,
      raw: data
    };
  } catch (e) {
    console.error("reverseGeocodeLatLng error:", e);
    return null;
  }
}

async function pasteGoogleMapUrlToForm() {
  const input = prompt(
    "Googleマップの共有URLを貼り付けてください。\n\nGoogleマップで店舗を開く → 共有 → リンクをコピー",
    ""
  );

  if (input === null) return;

  const url = String(input || "").trim();

  if (!url) {
    alert("URLが入力されていません。");
    return;
  }

  const mapUrlEl = document.getElementById("mapUrl");
  const storeNameEl = document.getElementById("storeName");
  const prefEl = document.getElementById("prefName");
  const addressEl = document.getElementById("address");

  if (mapUrlEl) {
    mapUrlEl.value = url;
  }

  const extractedName = extractStoreNameFromGoogleMapUrl(url);

  if (
    extractedName &&
    storeNameEl &&
    !String(storeNameEl.value || "").trim()
  ) {
    storeNameEl.value = extractedName;
  }

  let coord = null;
  let expandedUrl = url;

  try {
    if (typeof expandShortUrlIfNeeded === "function") {
      expandedUrl = await expandShortUrlIfNeeded(url);
    }
  } catch (e) {
    console.error("expandShortUrlIfNeeded error:", e);
    expandedUrl = url;
  }

  try {
    if (typeof extractLatLngFromMapUrl === "function") {
      coord = extractLatLngFromMapUrl(expandedUrl) || extractLatLngFromMapUrl(url);
    }
  } catch (e) {
    console.error("extractLatLngFromMapUrl error:", e);
  }

  if (!coord) {
    alert(
      "GoogleマップURLを入力しました。\n\nただし、このURLから座標を取得できませんでした。\nURL内に @緯度,経度 または !3d緯度!4d経度 が含まれているか確認してください。"
    );
    return;
  }

  const result = await reverseGeocodeLatLng(coord.lat, coord.lng);

  if (!result || !result.address) {
    alert(
      `GoogleマップURLを入力しました。\n\n座標は取得できました。\n緯度: ${coord.lat}\n経度: ${coord.lng}\n\nただし、住所の自動取得に失敗しました。`
    );
    return;
  }

  const nextPref = result.pref || extractPrefFromAddressText(result.address);
  const nextAddress = result.address;

  const currentPref = prefEl ? String(prefEl.value || "").trim() : "";
  const currentAddress = addressEl ? String(addressEl.value || "").trim() : "";

  if (prefEl && nextPref) {
    if (!currentPref) {
      prefEl.value = nextPref;
    } else if (currentPref !== nextPref) {
      const ok = confirm(
        `都道府県を自動取得しました。\n\n現在: ${currentPref}\n取得: ${nextPref}\n\n取得した都道府県で上書きしますか？`
      );
      if (ok) prefEl.value = nextPref;
    }
  }

  if (addressEl && nextAddress) {
    if (!currentAddress) {
      addressEl.value = nextAddress;
    } else if (currentAddress !== nextAddress) {
      const ok = confirm(
        `住所候補を自動取得しました。\n\n現在:\n${currentAddress}\n\n取得:\n${nextAddress}\n\n取得した住所で上書きしますか？`
      );
      if (ok) addressEl.value = nextAddress;
    }
  }

  alert(
    `GoogleマップURLを入力しました。\n\n座標と住所候補を取得しました。\n\n緯度: ${coord.lat}\n経度: ${coord.lng}\n\n住所:\n${nextAddress}\n\n内容を確認してから店舗追加してください。`
  );
}

function setupTimeInputAutoFormat() {
  const ids = ["openTime", "closeTime"];

  ids.forEach(id => {
    const input = document.getElementById(id);
    if (!input || input.dataset.timeAutoFormatReady === "1") return;

    input.dataset.timeAutoFormatReady = "1";

    input.addEventListener("input", () => {
      input.value = String(input.value || "").replace(/\D/g, "").slice(0, 4);
    });

    input.addEventListener("blur", () => {
      input.value = formatTimeInputValue(input.value);
    });
  });
}

window.addEventListener("load", () => {
  try {
    syncStoreProfitsFromLogs();
    syncTodayRouteOrder();
    syncTodayRouteVisitedIds();
    cleanupOldClosingAlerts();

    if (typeof initMap === "function") {
      initMap();
    }

    updateLayoutButtons();
    restoreStoreAddAccordion();
    restoreSortType();
    render();

    if (typeof renderBadgesIfExists === "function") {
      try {
        renderBadgesIfExists();
      } catch (e) {
        console.error("renderBadgesIfExists load error:", e);
      }
    }

    if (typeof autoDetectNearbyStores === "function") {
      setTimeout(() => autoDetectNearbyStores(), 800);
    }

    setTimeout(() => maybeNotifyClosingSoonStores(), 1200);
    setInterval(() => maybeNotifyClosingSoonStores(), 60000);
    setupButtonPressEffect();
    setupTimeInputAutoFormat();
  } catch (e) {
    console.error("load init error:", e);
  }
});

window.addEventListener("keydown", e => {
  const el = document.getElementById("helpUI");
  if (!el || !el.classList.contains("show")) return;
  if (e.key === "Escape") closeHelp();
});

window.addEventListener("load", () => {
  const el = document.getElementById("helpUI");
  if (!el) return;

  el.addEventListener("click", e => {
    if (e.target === el) closeHelp();
  });
});
