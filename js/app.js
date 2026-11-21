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
      <div class="storeCardTopLine">
        <div class="evalLabel ${evalData.class}">
          ${evalData.label}
        </div>

        <button
          type="button"
          class="storeMiniMemoBtn ${getStoreMiniMemo(s.id) ? "hasMemo" : "isEmpty"}"
          onclick="editStoreMiniMemo('${escapeJsString(s.id)}')"
          aria-label="ミニメモを入力・編集"
          title="タップしてミニメモを入力・編集"
        >
          <span class="storeMiniMemoScroll">${escapeHtml(getStoreMiniMemo(s.id) || "ミニメモ")}</span>
        </button>
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

      ${renderStoreDwellInfo(s.id)}
      <div class="row2 mt10 storeDwellActionRow">
        ${renderTodayToggleButton(idx, s.today)}
        ${renderStoreExitButton(idx, s.id)}
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
      <div class="storeCardTopLine">
        <div class="evalLabel ${evalData.class}">
          ${evalData.label}
        </div>

        <button
          type="button"
          class="storeMiniMemoBtn ${getStoreMiniMemo(s.id) ? "hasMemo" : "isEmpty"}"
          onclick="editStoreMiniMemo('${escapeJsString(s.id)}')"
          aria-label="ミニメモを入力・編集"
          title="タップしてミニメモを入力・編集"
        >
          <span class="storeMiniMemoScroll">${escapeHtml(getStoreMiniMemo(s.id) || "ミニメモ")}</span>
        </button>
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

      ${renderStoreDwellInfo(s.id)}
      <div class="row2 mt10 storeDwellActionRow">
        ${renderTodayToggleButton(idx, s.today)}
        ${renderStoreExitButton(idx, s.id)}
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
  const m = getMetrics(s);

  return `
        <div class="item todayRouteItem ${visited ? "todayRouteItemVisited" : ""}">
          <div class="name todayRouteName">
            ${idx + 1}. ${escapeHtml(s.name)}
            ${visited ? `<span class="badge" style="margin-left:8px;">訪問済み</span>` : ``}
          </div>

          <div class="mini">
  ${escapeHtml(s.pref || "")}${s.address ? ` / ${escapeHtml(s.address)}` : ""}
</div>

<div class="mini mt6" style="display:flex; align-items:center; gap:18px; flex-wrap:wrap;">
  <span>
    💰 期待値：
    <strong>${Math.round(m.expected).toLocaleString()}円</strong>
  </span>

  <span>
    🎯 成功率：
    <strong>${m.rate.toFixed(1)}%</strong>
  </span>
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
  if (typeof renderSourcingSessionStatus === "function") renderSourcingSessionStatus();
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
    activeStoreDwell: typeof loadActiveStoreDwell === "function" ? loadActiveStoreDwell() : null,
    storeDwellHistoryCount: typeof loadStoreDwellHistory === "function" ? loadStoreDwellHistory().length : 0,
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
    storeMiniMemos: stores.map(s => `${s.id}:${getStoreMiniMemo(s.id)}`).join("|"),
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
  { title: "🌟 はじめに｜このアプリの特徴", content: "<p class=\"guideLead\">店舗仕入れの「どこへ行く・何を仕入れた・次はどこを優先する」をひとつにまとめる、せどり専用の店舗管理アプリです。</p><div class=\"guideFeatures\"><div>📍 <b>GPSで店舗探し</b><small>近くの店舗や地図を確認</small></div><div>📈 <b>実績を自動分析</b><small>利益・成功率・期待値を比較</small></div><div>🛣️ <b>巡回ルート管理</b><small>今日行く店舗と保存ルート</small></div><div>🤖 <b>AIで振り返り</b><small>日次・月次・次回プラン</small></div></div><p>店舗を訪問するたびに記録が蓄積され、<b>経験や勘だけに頼らない仕入れ判断</b>をサポートします。iPhoneから操作しやすい設計です。</p>" },
  { title: "🚀 はじめての方｜基本の5ステップ", content: "<ol><li><b>店舗を登録</b>：店舗名・都道府県・住所・GoogleマップURLを入力。</li><li><b>行く店舗を選ぶ</b>：店舗カードの「今日行く」をチェック。</li><li><b>店舗を訪問</b>：入店・退店を記録し、必要に応じて「訪問＋」を利用。</li><li><b>仕入れを記録</b>：「個数＋」から個数・カテゴリ・見込み利益を登録。</li><li><b>振り返る</b>：レポートのカレンダーや店舗分析・AI分析を見る。</li></ol><p class=\"guideTip\">最初からすべての機能を使う必要はありません。まずは「店舗登録→訪問→個数＋」から始めましょう。</p>" },
  { title: "🏪 店舗登録と設定", content: "<p><b>店舗追加</b>から店舗名・都道府県・住所・GoogleマップURLを入力します。住所だけでも登録できますが、地図やナビを使うなら位置情報の取得状態を確認しましょう。</p><p>登録後は<b>「設定」</b>から営業時間・定休日・メモなどを管理できます。座標がない店舗は地図に表示されない場合があるため、住所・URLを確認し、必要に応じて「座標一括再取得」を試してください。</p><p class=\"guideTip\">GoogleマップURLは店舗の場所を開いて共有したリンクを利用すると便利です。</p>" },
  { title: "🏷️ 店舗カードの見方", content: "<p>店舗カードには、都道府県・距離・MAP情報・営業時間・定休日・営業状況・最終訪問・補充頻度などが表示されます（設定や取得状況によって一部は非表示）。</p><ul><li><b>営業中／開店前／まもなく閉店／閉店済み／定休日</b>：登録した営業時間や定休日に基づく目安。</li><li><b>MAPあり／座標あり</b>：地図や位置情報を使えるかの目安。</li><li><b>補充頻度</b>：過去の記録から次に訪問する時期を考える参考。</li><li><b>ミニメモ</b>：狙う商品や注意点を残せます。</li></ul><p class=\"guideTip\">営業時間は店舗側の急な変更まで保証するものではありません。遠征前には公式情報も確認しましょう。</p>" },
  { title: "📊 期待値・成功率・利益の読み方", content: "<p><b>期待値</b>：累計見込み利益 ÷ 訪問回数。1回の訪問で期待できる利益の参考値です。</p><p><b>成功率</b>：成功回数 ÷ 訪問回数 × 100。仕入れに成功した割合です。</p><p><b>累計利益</b>：その店舗で記録した見込み利益の合計。実際の販売確定利益とは異なります。</p><p><b>成功1回あたりの平均利益</b>：累計見込み利益 ÷ 成功回数。</p><p><b>例：</b>5回訪問・2回成功・見込み利益10,000円なら、期待値2,000円／回、成功率40%です。</p><p class=\"guideTip\">訪問回数が少ない店舗の数字は大きく変動します。期待値だけでなく成功率・訪問数・滞在時間を合わせて判断しましょう。</p>" },
  { title: "👣 訪問＋・入店・退店の使い分け", content: "<p><b>「訪問＋」</b>は訪問回数などの実績を記録する操作です。<b>入店・退店</b>は実際の滞在時間を計測する操作です。役割が異なるので、店舗カードの表示に沿って使ってください。</p><ol><li>入店時に入店記録を開始。</li><li>退店時に退店を記録し、滞在時間を確定。</li><li>仕入れできたら「個数＋」で内容を登録。</li></ol><p>入店・退店時刻は記録され、レポートで店舗別の滞在履歴を確認できます。短いテスト滞在も履歴に残るため、実績分析に混ぜないよう注意しましょう。</p>" },
  { title: "🛒 個数＋・カテゴリ・見込み利益", content: "<p>「個数＋」では<b>合計個数・カテゴリごとの個数・見込み利益</b>をまとめて入力します。</p><p><b>例：</b>ベビー用品1個、家電2個、合計3個、見込み利益5,000円。</p><p>よく使うカテゴリは履歴から選択でき、新しいカテゴリも追加できます。利益の金額ボタンは押した分だけ加算されるため、登録前に合計を確認しましょう。</p><p class=\"guideTip\">合計個数とカテゴリ別の個数が一致しているか確認してください。見込み利益は販売前の予測であり、売上確定額ではありません。</p>" },
  { title: "⏱️ 仕入れと入退店の自動紐付け", content: "<p>入退店記録と仕入れを<b>訪問単位</b>で結び付け、時間効率を分析する仕組みです。</p><ul><li><b>入店中</b>の「個数＋」：現在の訪問に紐付け。</li><li><b>退店後15分以内</b>の「個数＋」：同じ店舗の直前の訪問に自動紐付け。</li><li><b>15分を超えた場合</b>：対象の訪問を選択して紐付け。</li><li><b>再入店</b>：新しい訪問として扱います。</li></ul><p>過去の記録は日時が近くても、確定できないものを勝手に利益時給へ加算しません。「照合候補」は確認用であり、確定済みの紐付けとは異なります。</p>" },
  { title: "🗺️ GPS・地図・近くの店舗", content: "<p>地図では登録店舗の位置をまとめて確認できます。マーカーから店舗を確認し、「今日行く」やナビの操作に進めます。</p><p><b>現在地</b>を使うにはiPhone／Safariで位置情報を許可してください。「近くの店舗」は現在地から<b>約3km以内</b>の店舗を探すための機能です。</p><p>距離は目安であり、実際の道路の走行距離や所要時間とは異なる場合があります。位置が表示されないときは座標の登録状態も確認しましょう。</p>" },
  { title: "🛣️ 今日行く・今日のルート", content: "<p>訪問予定の店舗で<b>「今日行く」</b>をオンにすると、巡回候補に追加できます。今日のルートで順番を確認・調整し、Googleマップのナビへ進みます。</p><ul><li><b>自動最適化</b>：回る順番を調整する機能。</li><li><b>訪問済み</b>：訪問記録を付けた店舗の進捗確認。</li><li><b>途中から再開</b>：未訪問店舗を中心にルートを組み直すときに便利。</li></ul><p class=\"guideTip\">以前の「今日行く」が残っていると、今回のルートにも含まれることがあります。出発前にチェックを確認してください。</p>" },
  { title: "⭐ 保存済みルート", content: "<p>よく回る地域や遠征コースは<b>保存済みルート</b>として再利用できます。</p><ul><li>ルート名・メモを付けて保存。</li><li>保存した店舗の組み合わせを呼び出す。</li><li>「編集」で店舗の追加・削除・順番変更。</li><li>ナビを開いて再度巡回。</li></ul><p><b>例：</b>長岡周辺／新潟市周辺／県外遠征など。ルートの保存と、今日の訪問実績の記録は別なので、巡回時の記録も忘れずに行いましょう。</p>" },
  { title: "📅 レポート｜カレンダーと今日の総評", content: "<p>「AI分析・レポート」画面の<b>上部</b>には、カレンダーと<b>今日の仕入れ総評</b>があります。</p><ul><li><b>カレンダー</b>：日付を選び、その日の訪問・仕入れ・利益を確認。記録の追加や過去日の振り返りにも使用。</li><li><b>今日の総評</b>：当日の実績を確認し、必要なときに「AIで詳しく分析」を実行。</li></ul><p>AIボタンは押したときに通信します。訪問の記録がない日は、分析できる情報が少ない場合があります。</p>" },
  { title: "📊 レポート｜概要タブ", content: "<p>上部のカレンダーと今日の総評の<b>下に3つのタブ</b>があります。</p><p><b>「📊 概要」</b>には月間・期間サマリー、カテゴリ集計、都道府県別分析などをまとめています。項目名をタップすると開閉できます。</p><p>利益・訪問・成功・個数・成功率などの全体傾向を把握し、仕入れが増えているカテゴリや地域を確認するのに便利です。</p><p class=\"guideTip\">対象月や集計期間を切り替えたら、どの期間の数値を見ているか確認しましょう。</p>" },
  { title: "🏬 レポート｜店舗分析タブ", content: "<p><b>「🏬 店舗分析」</b>には、店舗ランキングと「店舗別・仕入れ時間効率」があります。</p><p><b>利益時給</b>は、紐付け済みの見込み利益を対象の滞在時間で割って1時間換算した参考指標です。移動・出品・販売までの時間は含みません。</p><p>ランキングは<b>滞在3分以上・紐付け済み3訪問以上</b>を基準にしています。対象店舗がないときも店舗別の訪問履歴は確認できます。</p><p><b>累計見込み利益</b>は過去ログ全体の合計、<b>紐付け済み利益</b>は訪問と対応した分、<b>未紐付けの差額</b>は参考値です。「照合候補」は未確定のため利益時給に加算しません。</p>" },
  { title: "🤖 レポート｜AI分析タブ", content: "<p><b>「🤖 AI分析」</b>では、月のAI総評・指定期間のAI総評・AI次回仕入れプランを開閉して使えます。</p><ul><li><b>月のAI総評</b>：その月の利益・訪問・成功などを振り返る。</li><li><b>指定期間のAI総評</b>：複数月や選択期間の傾向を見る。</li><li><b>AI次回仕入れプラン</b>：過去実績や予定条件から巡回案を考える。</li></ul><p>分析後は「この店舗を優先した理由は？」「滞在時間が長い店舗は？」など追加質問もできます。AIの提案は参考情報なので、営業時間・道路状況・実際の在庫は出発前に確認してください。</p>" },
  { title: "🏅 実績・バッジの楽しみ方", content: "<p>実績カードや実績一覧では、訪問回数・成功回数・利益・ルート達成などの積み重ねを確認できます。</p><p>達成済みと未達成を見比べると、次の目標が分かります。実績一覧はアコーディオンで開閉できます。</p><p>店舗カードの距離・都道府県・MAP・補充頻度などのバッジは、巡回先を絞り込むときの補助情報です。</p>" },
  { title: "💾 バックアップとデータの注意点", content: "<p>店舗や仕入れの記録は端末側の保存領域を利用します。<b>ブラウザのサイトデータ削除、端末変更、別ブラウザでの利用</b>には注意してください。</p><p>トップ画面の<b>「バックアップ」</b>から「バックアップ書き出し」でファイルを保存し、大切に保管しましょう。「バックアップ読込」は現在のデータを上書きするため、実行前に確認してください。</p><p>自動バックアップの復元機能もありますが、端末のデータ消去に備えるには<b>書き出したバックアップを端末外にも保存</b>することをおすすめします。</p>" },
  { title: "🧰 困ったとき・よくある質問", content: "<p><b>地図に店舗が出ない</b>：住所・GoogleマップURL・座標を確認し、必要に応じて座標を再取得。</p><p><b>近くの店舗が出ない</b>：位置情報の許可と現在地の取得状態を確認。</p><p><b>ルートに前回の店舗が混ざる</b>：「今日行く」のチェックを見直す。</p><p><b>利益時給ランキングが空</b>：滞在3分以上・紐付け済み3訪問以上の条件を確認。</p><p><b>AIが古い結果を示す</b>：対象日・対象期間と記録の反映状況を確認して再分析。</p><p><b>画面更新後に表示がおかしい</b>：再読み込みを試す。データを消す操作は避け、必要ならバックアップを取ってから対処してください。</p>" }
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

  titleEl.textContent = data.title;
  contentEl.innerHTML = data.content;
  const progressEl = document.getElementById("helpProgress");
  if (progressEl) progressEl.textContent = `${helpStep + 1} / ${helpData.length}`;
  const prevBtn = document.getElementById("helpPrevBtn");
  const nextBtn = document.getElementById("helpNextBtn");
  if (prevBtn) prevBtn.disabled = helpStep === 0;
  if (nextBtn) { nextBtn.disabled = helpStep === helpData.length - 1; nextBtn.textContent = helpStep === helpData.length - 1 ? "最後のページ" : "次へ"; }
  const card = document.querySelector("#helpUI .helpCard");
  if (card) card.scrollTop = 0;
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
    if (typeof resolveStaleSourcingSession === "function") resolveStaleSourcingSession();
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
    setInterval(() => {
      if (typeof renderSourcingSessionStatus === "function") renderSourcingSessionStatus();
    }, 30000);
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
