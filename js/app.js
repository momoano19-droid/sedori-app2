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

  if (!openTime && !closeTime) return "æªè¨­å®";
  if (openTime && closeTime) return `${openTime}ã${closeTime}`;
  return `${openTime || "--:--"}ã${closeTime || "--:--"}`;
}

function formatClosedDays(store) {
  const days = Array.isArray(store?.regularClosedDays) ? store.regularClosedDays : [];
  return days.length ? days.join("ã»") : "ãªã";
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
        <div class="businessInfoLabel">ð å¶æ¥­æé</div>
        <div class="businessInfoValue">${escapeHtml(hoursText)}</div>
      </div>

      ${showClosedDays ? `
        <div class="businessInfoRow">
          <div class="businessInfoLabel">ð å®ä¼æ¥</div>
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
        <div class="businessInfoLabel">ð å¶æ¥­æé</div>
        <div class="businessInfoValue">${escapeHtml(formatStoreHours(store))}</div>
      </div>

      ${hasRegularClosedDays(store) ? `
        <div class="businessInfoRow">
          <div class="businessInfoLabel">ð å®ä¼æ¥</div>
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
      label: "ð å®ä¼æ¥",
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
      label: "ð æªè¨­å®",
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
      label: `ð éåºåï¼${store.openTime}éåºï¼`,
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
      label: `ð« éåºæ¸ã¿ï¼${store.closeTime}éåºï¼`,
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
      label: `â ï¸ ã¾ããªãéåºï¼ãã¨${remainingMinutes}åï¼`,
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
    label: "â å¶æ¥­ä¸­",
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
      return `ã»${store.name}ï¼${formatStoreHours(store)} / ãã¨${status.remainingMinutes}åï¼`;
    })
    .join("\n");

  alert(`éåº1æéåã®åºèãããã¾ãã\n\n${message}`);
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
  chevron.textContent = willOpen ? "â²" : "â¼";

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
  chevron.textContent = willOpen ? "â²" : "â¼";
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
    `<option value="__ALL__">å¨ã¦ï¼é½éåºçãã¨ï¼</option>` +
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
    `<span class="badge">${escapeHtml(s.pref || "æªè¨­å®")}</span>`,
    typeof dist === "number" ? `<span class="badge near">ð ${dist.toFixed(1)}km</span>` : ``,
    s.mapUrl ? `<span class="badge map">ðº MAPãã</span>` : ``,
    hasCoords(s) ? `<span class="badge">ð¡ åº§æ¨ãã</span>` : ``,
    `<span class="badge freq">è£åé »åº¦ ${formatRestockDays(m.freq)}</span>`
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
          ð ${escapeHtml(s.memo)}
        </div>
      ` : ``}

      <div class="mini compactMainRow">
        <span>æå¾å¤ <span class="mainExpected ${expectedHighClass}">${Math.round(m.expected).toLocaleString()}å</span></span>
        <span class="${rateClass}">æåç ${m.rate.toFixed(1)}%</span>
        <span>å©ç <span class="mainProfit">${m.profit.toLocaleString()}å</span></span>
      </div>

      <div class="mini compactSubRow">
        <span>è¨ªå ${m.visits}å</span>
        <span>æå ${m.success}å</span>
        <span>åæ° ${m.items}å</span>
      </div>

      <div class="mt10">
        ${renderTodayToggleButton(idx, s.today)}
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#dff7e8", "#129b52")} onclick="visit(${idx})">è¨ªåï¼</button>
        <button ${makeButtonStyle("#e7f0ff", "#2563eb")} onclick="itemsPlus(${idx})">åæ°ï¼</button>
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="navigateToStore(${idx})">ãã</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="editStore(${idx})">è¨­å®</button>
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
        <span class="badge">${escapeHtml(s.pref || "æªè¨­å®")}</span>
        ${typeof dist === "number" ? `<span class="badge near">ð ${dist.toFixed(1)}km</span>` : ``}
        ${s.mapUrl ? `<span class="badge map">ðº MAPãã</span>` : ``}
        ${hasCoords(s) ? `<span class="badge">ð¡ åº§æ¨ãã</span>` : ``}
        <span class="badge freq">è£åé »åº¦ ${formatRestockDays(m.freq)}</span>
      </div>

      ${renderBusinessInfoHtml(s)}

      ${s.memo ? `<div class="mini mt8">ð ${escapeHtml(s.memo)}</div>` : ``}
      ${s.address ? `<div class="mini mt8">ð ${escapeHtml(s.address)}</div>` : ``}

      <div class="mini mt8">
        æå¾å¤ï¼${Math.round(m.expected).toLocaleString()}å
      </div>

      <div class="mini mt8" style="line-height:1.6;">
        å©çï¼${m.profit.toLocaleString()}å / <span class="${rateClass}">æåçï¼${m.rate.toFixed(1)}%</span><br>
        å¹³åå©çï¼${Math.round(m.avgProfit).toLocaleString()}å / å¹³ååæ°ï¼${m.avgItems.toFixed(1)}å
      </div>

      <div class="mini mt8">
        è¨ªåï¼${m.visits}å / æåï¼${m.success}å / åæ°ï¼${m.items}å
      </div>

      ${categorySummary ? `<div class="mini mt8">ð¦ ${escapeHtml(categorySummary)}</div>` : ``}

      <div class="detailBox">
        <div class="detailLine">ð æçµè¨ªåï¼${s.lastVisitDate ? escapeHtml(s.lastVisitDate) : "ãªã"}</div>
        <div class="detailLine">ð æçµè¨ªåããï¼${escapeHtml(sinceVisitText)}</div>
        <div class="detailLine">ð ç´è¿3åï¼æå ${recent.recentSuccess}å / ${recent.recentVisitCount}è¨ªåï¼${recent.recentRate.toFixed(1)}%ï¼</div>
        <div class="detailLine">ð° è¨ªåãããæå¾å¤ï¼${Math.round(m.expected).toLocaleString()}å</div>
        ${streak >= 3 ? `<div class="detailLine detailWarn">â ï¸ ${streak}åé£ç¶æåãªã</div>` : ``}
      </div>

      <div class="mt10">
        ${renderTodayToggleButton(idx, s.today)}
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#dff7e8", "#129b52")} onclick="visit(${idx})">è¨ªåï¼</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="visitMinus(${idx})">è¨ªåâ</button>
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#e7f0ff", "#2563eb")} onclick="itemsPlus(${idx})">åæ°ï¼</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="itemsMinus(${idx})">åæ°â</button>
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="navigateToStore(${idx})">ãã</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="refreshStoreCoordinates(${idx})">åº§æ¨ååå¾</button>
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="editStore(${idx})">è¨­å®</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="deleteStore(${idx})">åé¤</button>
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
   ä¿å­ã«ã¼ãå·¡åå®ç¸¾è¡¨ç¤º
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

function renderRouteRunMetricsHtml(summary, title = "å·¡åå®ç¸¾") {
  return `
    <div class="routeRunSummaryCard">
      <div class="routeRunSummaryTitle">${escapeHtml(title)}</div>

      <div class="routeRunMetricGrid">
        <div class="routeRunMetric">
          <div class="routeRunMetricLabel">å·¡ååæ°</div>
          <div class="routeRunMetricValue">${summary.runCount}å</div>
        </div>

        <div class="routeRunMetric">
          <div class="routeRunMetricLabel">åè¨å©ç</div>
          <div class="routeRunMetricValue">${Math.round(summary.totalProfit).toLocaleString()}å</div>
        </div>

        <div class="routeRunMetric">
          <div class="routeRunMetricLabel">å¹³åå©ç</div>
          <div class="routeRunMetricValue">${Math.round(summary.averageProfit).toLocaleString()}å</div>
        </div>

        <div class="routeRunMetric">
          <div class="routeRunMetricLabel">åè¨åæ°</div>
          <div class="routeRunMetricValue">${Math.round(summary.totalItems).toLocaleString()}å</div>
        </div>

        <div class="routeRunMetric">
          <div class="routeRunMetricLabel">å¹³ååæ°</div>
          <div class="routeRunMetricValue">${summary.averageItems.toFixed(1)}å</div>
        </div>

        <div class="routeRunMetric">
          <div class="routeRunMetricLabel">å¹³åè¨ªååºè</div>
          <div class="routeRunMetricValue">${summary.averageVisitedStores.toFixed(1)}ä»¶</div>
        </div>

        <div class="routeRunMetric">
          <div class="routeRunMetricLabel">å¹³åæååºè</div>
          <div class="routeRunMetricValue">${summary.averageSuccessStores.toFixed(1)}ä»¶</div>
        </div>

        <div class="routeRunMetric">
          <div class="routeRunMetricLabel">è¨ªå1åºèæå¾å¤</div>
          <div class="routeRunMetricValue">${Math.round(summary.profitPerVisitedStore).toLocaleString()}å</div>
        </div>
      </div>
    </div>
  `;
}

function renderRouteRunHistoryHtml(summary) {
  if (!summary.history.length) {
    return `
      <div class="routeRunHistoryEmpty">
        å·¡åå±¥æ­´ã¯ã¾ã ããã¾ããããä»åã®å·¡åãè¨é²ãããè¿½å ã§ãã¾ãã
      </div>
    `;
  }

  return `
    <div class="routeRunHistoryList">
      ${summary.history.map(item => `
        <div class="routeRunHistoryItem">
          <div class="routeRunHistoryTop">
            <div>
              <div class="routeRunHistoryDate">${escapeHtml(item.date || "æ¥ä»ä¸æ")}</div>
              <div class="routeRunHistoryMeta">
                å©ç ${Number(item.profit || 0).toLocaleString()}å /
                åæ° ${Number(item.items || 0).toLocaleString()}å
              </div>
            </div>

            <div class="routeRunHistoryVisit">
              è¨ªå ${Number(item.visitedStoreCount || 0)}ä»¶
            </div>
          </div>

          <div class="routeRunHistorySub">
            æååºè ${Number(item.successStoreCount || 0)}ä»¶ /
            è¨ªåè¨é² ${Number(item.visitCount || 0)}å /
            æåè¨é² ${Number(item.successCount || 0)}å
          </div>

          <div class="routeRunHistoryActions">
            <button
              type="button"
              class="ghostBtn"
              onclick="recalculateSavedRouteRun('${escapeJsString(item.id)}')"
            >åéè¨</button>

            <button
              type="button"
              class="dangerBtn"
              onclick="deleteSavedRouteRun('${escapeJsString(item.id)}')"
            >åé¤</button>
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
          <div class="routeCombinedTitle">é¸æã«ã¼ãåç®</div>
          <div class="routeCombinedSub">
            ${summary.selectedRouteCount}ã«ã¼ããé¸æä¸­
          </div>
        </div>

        <button
          type="button"
          class="ghostBtn routeCombinedClearBtn"
          onclick="clearSavedRouteSummarySelection()"
        >é¸æè§£é¤</button>
      </div>

      ${renderRouteRunMetricsHtml(summary, "åç®å®ç¸¾")}
    </div>
  `;
}

function renderSavedRoutesList() {
  const el = document.getElementById("savedRoutesList");
  if (!el) return;

  if (!savedRoutes.length) {
    el.innerHTML = "ä¿å­æ¸ã¿ã«ã¼ãã¯ã¾ã ããã¾ããã";
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
                  ${route.favorite ? `<span class="savedRouteFavBadge">â ãæ°ã«å¥ã</span>` : ``}
                  ${isSelected ? `<span class="savedRouteSelectedBadge">â åç®å¯¾è±¡</span>` : ``}
                </div>

                <div class="savedRouteMeta">
                  æ´æ°: ${escapeHtml(formatDateTimeText(route.updatedAt || route.createdAt))}
                </div>
              </div>

              <div class="savedRouteChevron">${isOpen ? "â²" : "â¼"}</div>
            </div>

            <div class="savedRouteCompactInfo">
              <div class="savedRouteCount">
                åºèæ°: ${route.storeIds.length}ä»¶ /
                å·¡å: ${runSummary.runCount}å /
                å¹³åå©ç: ${Math.round(runSummary.averageProfit).toLocaleString()}å
              </div>
            </div>
          </button>

          <div class="savedRouteDetail" style="display:${isOpen ? "block" : "none"};">
            <div class="detailBlock" style="margin-bottom:12px;">
              <div class="detailTitle">ã«ã¼ãæå ±</div>
              <div class="detailText">
                ${dueSummary.emoji} ${escapeHtml(dueSummary.label)}<br>
                åãé : ${dueSummary.dueCount}ä»¶ / ãããã: ${dueSummary.soonCount}ä»¶<br>
                å¹³åè£åé »åº¦: ${dueSummary.avgFreq !== null ? escapeHtml(formatRestockDays(dueSummary.avgFreq)) : "ãã¼ã¿ãªã"}
                ${route.note ? `<br>ã¡ã¢: ${escapeHtml(route.note)}` : ""}
              </div>
            </div>

            ${renderRouteRunMetricsHtml(runSummary)}

            <div class="routeRunMainActions">
              <button
                type="button"
                class="primaryBtn"
                onclick="recordSavedRouteRun('${escapeJsString(route.id)}')"
              >ä»åã®å·¡åãè¨é²</button>

              <button
                type="button"
                class="${isSelected ? "btnGreen" : "ghostBtn"}"
                onclick="toggleSavedRouteSummarySelection('${escapeJsString(route.id)}')"
              >${isSelected ? "â åç®å¯¾è±¡ããå¤ã" : "åç®å¯¾è±¡ã«é¸æ"}</button>
            </div>

            <div class="routeRunHistoryTitle">å·¡åå±¥æ­´</div>
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
                            è£åé »åº¦: ${formatRestockDays(m.freq)} / æåç: ${m.rate.toFixed(1)}% / æå¾å¤: ${Math.round(m.expected).toLocaleString()}å
                          </div>
                        </div>
                      `;
                    }).join("")}
                  </div>
                `
                : `<div class="mini">ãã®ã«ã¼ãã®åºèãè¦ã¤ããã¾ããã</div>`
            }

            <div class="savedRouteActionGrid">
              <button ${makeButtonStyle("#e7f0ff", "#2563eb")} class="savedRouteActionBtn" onclick="openSavedRoute('${escapeJsString(route.id)}')">ä»æ¥ã«èª­è¾¼</button>
              <button ${makeButtonStyle("#dff7e8", "#129b52")} class="savedRouteActionBtn" onclick="openSavedRouteInMaps('${escapeJsString(route.id)}')">MAPã§éã</button>
              <button ${makeButtonStyle("#fff4d8", "#b7791f")} class="savedRouteActionBtn" onclick="toggleFavoriteRoute('${escapeJsString(route.id)}')">${route.favorite ? "â ãæ°ã«å¥ãè§£é¤" : "â ãæ°ã«å¥ã"}</button>
              <button ${makeButtonStyle("#eef1f7", "#1f2340")} class="savedRouteActionBtn" onclick="editSavedRoute('${escapeJsString(route.id)}')">ç·¨é</button>
              <button ${makeButtonStyle("#fef2f2", "#dc2626")} class="savedRouteActionBtn" onclick="deleteSavedRoute('${escapeJsString(route.id)}')">åé¤</button>
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
    el.innerHTML = `<div class="mini emptyRouteText">ãã§ãã¯ããåºèã¯ã¾ã ããã¾ããã</div>`;
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
                  ã«ã¼ã${part.index}ãéã
                </button>
                <div class="routeSplitEta">
                  æ¨å® ç´${formatEstimatedMinutes(part.estimatedMinutes)}
                </div>
              </div>
              <div class="mini routeSplitSub">
                å¯¾è±¡: ${part.start}ã${part.end}åºèç®
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
            ${visited ? `<span class="badge" style="margin-left:8px;">è¨ªåæ¸ã¿</span>` : ``}
          </div>

          <div class="mini">
            ${escapeHtml(s.pref || "")}${s.address ? ` / ${escapeHtml(s.address)}` : ""}
          </div>

          ${renderTodayRouteBusinessInfoHtml(s, visited)}

          ${s.memo ? `
            <div class="mini mt6">
              ð ${escapeHtml(s.memo)}
            </div>
          ` : ``}

          <div class="row2 mt8">
            <button class="ghostBtn" onclick="moveTodayRouteItem(${idx}, -1)">â ä¸ã¸</button>
            <button class="ghostBtn" onclick="moveTodayRouteItem(${idx}, 1)">â ä¸ã¸</button>
          </div>

          <div class="row2 mt8">
            <button class="dangerBtn" onclick="removeTodayRouteItem(${idx})">ã«ã¼ãããå¤ã</button>
            <button class="ghostBtn" onclick="unmarkTodayRouteVisited('${escapeJsString(s.id)}')">è¨ªåæ¸ã¿è§£é¤</button>
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
      : `<div class="mini">${nearbyMode ? "è¿ãã®åºèã¯è¦ã¤ããã¾ããã§ããã" : "è©²å½ããåºèãããã¾ããã"}</div>`;
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
    title: "ð ãã®ã¢ããªã§ã§ãããã¨",
    content: `
      <b>ãã©ãåºèãè¨é²ã»åæãã¦ãåãä¾¡å¤ã®é«ãåºèãè¦ã¤ããããã®ç®¡çã¢ããªã§ãã</b><br><br>
      ä¸»ã«ã§ãããã¨ã¯æ¬¡ã®éãã§ãã<br><br>
      ã»åºèåãé½éåºçãä½æãGoogleãããURLãç»é²<br>
      ã»è¨ªååæ°ãæååæ°ãåæ°ãå©çãè¨é²<br>
      ã»æå¾å¤ãæåçãå¹³åå©çãèªåè¨ç®<br>
      ã»ç¾å¨å°ããè¿ãåºèãè¡¨ç¤º<br>
      ã»ä»æ¥è¡ãåºèãé¸ãã§ã«ã¼ãä½æ<br>
      ã»ä¿å­æ¸ã¿ã«ã¼ãã®åå©ç¨<br>
      ã»ã¬ãã¼ãç»é¢ã§æå¥ / æ¥å¥ã®æ¯ãè¿ã<br><br>
      <b>åºæ¬ã¯ãåºèç»é² â è¨ªåè¨é² â æåè¨é² â ã¬ãã¼ãç¢ºèªãã®æµãã§ãã</b>
    `
  },
  {
    title: "ðª ã¾ãæåã«ãããã¨",
    content: `
      <b>æåã¯åºèãç»é²ãã¾ãã</b><br><br>
      å¥åããé ç®ã¯æ¬¡ã®4ã¤ã§ãã<br><br>
      ã»åºèå<br>
      ã»é½éåºç<br>
      ã»ä½æ<br>
      ã»GoogleãããURLï¼ããã°ä¾¿å©ï¼<br><br>
      <b>GoogleãããURLãããã¨ãåº§æ¨ãåãããããªãã¾ãã</b><br>
      URLããªãã¦ããä½æãå¥ã£ã¦ããã°ç»é²ã§ãã¾ãã<br><br>
      åºèè¿½å å¾ã«å°å³ã¸åºãªãå ´åã¯ã<br>
      <b>ãåº§æ¨ä¸æ¬ååå¾ã</b> ãæ¼ãã¨ç´ããã¨ãããã¾ãã
    `
  },
  {
    title: "ð£ è¨ªåï¼ ã¨ åæ°ï¼ ã®ä½¿ãæ¹",
    content: `
      <b>åºèã«è¡ã£ããã¾ããè¨ªåï¼ããæ¼ãã¾ãã</b><br><br>
      è¨ªåï¼ã§è¨é²ãããåå®¹<br>
      ã»è¨ªååæ° +1<br>
      ã»æçµè¨ªåæ¥ã®æ´æ°<br>
      ã»ä»æ¥ã®ã«ã¼ãä¸­ãªãè¨ªåæ¸ã¿æ±ã<br><br>
      <b>ä»å¥ãã§ããæã¯ãåæ°ï¼ããæ¼ãã¾ãã</b><br><br>
      åæ°ï¼ã§ã§ãããã¨<br>
      ã»ä»å¥ãåæ°ã®å¥å<br>
      ã»ã«ãã´ãªãã¨ã®åæ°å¥å<br>
      ã»å©çå¥å<br><br>
      ä¾ï¼<br>
      åè¨3åä»å¥ããå ´å<br>
      ã»ã²ã¼ã  2å<br>
      ã»å®¶é» 1å<br>
      ã»å©ç 5000å<br><br>
      ãã®åå®¹ãã¾ã¨ãã¦è¨é²ã§ãã¾ãã
    `
  },
  {
    title: "ð° å©çå¥åã¨ã«ãã´ãªå¥åã®ãã¤ã³ã",
    content: `
      <b>åæ°ï¼ãæ¼ãã¨ãã«ãã´ãªã¨å©çãä¸ç·ã«å¥ãããã¾ãã</b><br><br>
      å©çãã¿ã³ã¯ç¾å¨ã<b>æ¼ããåã ãå ç®</b>ããã¾ãã<br><br>
      ä¾ï¼<br>
      ã»1000 ã2åæ¼ã â 2000å<br>
      ã»10000 ã¨ 3000 ãæ¼ã â 13000å<br><br>
      æå¥åãã§ãã¾ãã<br><br>
      ã«ãã´ãªã¯å±¥æ­´ããé¸ã¹ãã®ã§ãããä½¿ãã«ãã´ãªã¯å¥åãããããªãã¾ãã<br>
      æ°ããã«ãã´ãªããã®å ´ã§è¿½å ã§ãã¾ãã<br><br>
      <b>ã«ãã´ãªåæ°ã®åè¨ã¨ãåè¨åæ°ã¯ä¸è´ãããå¿è¦ãããã¾ãã</b>
    `
  },
  {
    title: "ð æ°å­ã®è¦æ¹",
    content: `
      <b>åºèã«ã¼ãã§ã¯ãä¸»ã«æ¬¡ã®æ°å­ãè¦ã¾ãã</b><br><br>
      ã»æå¾å¤<br>
      â ãã®åºèã«1åè¡ã£ãæã®å¹³åå©çã®ç®å®ã§ãã<br><br>
      ã»æåç<br>
      â è¨ªåããä¸­ã§ãä»å¥ãæåã«ãªã£ãå²åã§ãã<br><br>
      ã»å©ç<br>
      â ãã®åºèã§è¨é²ããç´¯è¨å©çã§ãã<br><br>
      ã»å¹³åå©ç<br>
      â æå1åãããã®å¹³åå©çã§ãã<br><br>
      <b>ç®å®ã¨ãã¦ã¯ãæå¾å¤ãé«ããæåçãé«ãåºèã»ã©åªååº¦ãä¸ããã¾ãã</b>
    `
  },
  {
    title: "ðº å°å³ã»è¿ãã®åºèã»ç¾å¨å°",
    content: `
      <b>å°å³ã§ã¯åºèã®ä½ç½®ãã¾ã¨ãã¦ç¢ºèªã§ãã¾ãã</b><br><br>
      ã§ãããã¨<br>
      ã»åºèãã¼ã«ã¼ãã¿ãããã¦è©³ç´°ãè¦ã<br>
      ã»ãã®å ´ã§ãä»æ¥è¡ãããä»ãã<br>
      ã»ãããéã<br><br>
      <b>ãç¾å¨å°ã¸ç§»åã</b> ãæ¼ãã¨ãä»ããå ´æä»è¿ã¸å°å³ãç§»åãã¾ãã<br>
      ç¾å¨å°ã¯ããç¢å°é¢¨ãã¼ã«ã¼ã§è¡¨ç¤ºããã¾ãã<br><br>
      <b>ãè¿ãã®åºèã</b> ãæ¼ãã¨ãç¾å¨å°ããè¿ãåºèãçµã£ã¦è¦ãããã§ãã¾ãã<br>
      è¿ãã®åºèç¢ºèªã¨ãä»æ¥ã®å·¡ååè£æ¢ãã«ä¾¿å©ã§ãã
    `
  },
  {
    title: "ð£ ä»æ¥ã®ã«ã¼ãã®ä½¿ãæ¹",
    content: `
      <b>è¡ãäºå®ã®åºèã«ã¯ãä»æ¥è¡ãããä»ãã¾ãã</b><br><br>
      ãã®å¾ã<b>ããã®é çªã§ã«ã¼ãä½æã</b> ãæ¼ãã¨Googleãããã§ã«ã¼ããéãã¾ãã<br><br>
      ä¾¿å©ãªæ©è½<br>
      ã»èªåæé©å<br>
      â é çªãä¸¦ã³æ¿ãã¦åãããããã¾ãã<br><br>
      ã»è¨ªåæ¸ã¿ç®¡ç<br>
      â ä»æ¥ã®ã«ã¼ãä¸­ã®åºèã§ãè¨ªåï¼ããæ¼ãã¨ããã®åºèã¯è¨ªåæ¸ã¿ã«ãªãã¾ãã<br><br>
      ã»éä¸­ããåé<br>
      â ã«ã¼ããåãã¦ããæªè¨ªåã®åºèã ãã§åä½æã§ãã¾ãã<br><br>
      <b>ä¿å­åã«åã®ãä»æ¥è¡ãããæ®ã£ã¦ããã¨ãæ¬¡ã®ã«ã¼ãã«ãå«ã¾ããã®ã§æ³¨æãã¦ãã ããã</b>
    `
  },
  {
    title: "â­ ä¿å­æ¸ã¿ã«ã¼ãã®ä½¿ãæ¹",
    content: `
      <b>ä»æ¥ã®ã«ã¼ãã¯ä¿å­ã§ãã¾ãã</b><br><br>
      ä¿å­ããã¨ã§ãããã¨<br>
      ã»åãå·¡åã«ã¼ãããã¨ã§åå©ç¨<br>
      ã»MAPã§ååº¦éã<br>
      ã»ãæ°ã«å¥ãå<br>
      ã»ã«ã¼ãåãã¡ã¢ç·¨é<br><br>
      ä¿å­æ¸ã¿ã«ã¼ãã«ã¯ãè£åé »åº¦ãåãé ã®ç®å®ãè¡¨ç¤ºããã¾ãã<br><br>
      <b>ããåãå°åãã¨ã«ä¿å­ãã¦ããã¨ä¾¿å©ã§ãã</b><br>
      ä¾ï¼<br>
      ã»æ°æ½å¸ã«ã¼ã<br>
      ã»é·å²¡ã«ã¼ã<br>
      ã»çå¤é å¾ã«ã¼ã
    `
  },
  {
    title: "ð ã¬ãã¼ãç»é¢ã®è¦æ¹",
    content: `
      <b>ã¬ãã¼ãç»é¢ã§ã¯æå¥ / æ¥å¥ã®æ¯ãè¿ããã§ãã¾ãã</b><br><br>
      è¦ãããåå®¹<br>
      ã»æéå©ç<br>
      ã»è¨ªååæ°<br>
      ã»æååæ°<br>
      ã»åæ°<br>
      ã»ã«ãã´ãªéè¨<br>
      ã»æå¾å¤TOP5 / æåçTOP5 / å©çTOP5<br><br>
      ã«ã¬ã³ãã¼ã§ã¯ããã®æ¥ã®å©çãç¢ºèªã§ãã¾ãã<br><br>
      ãã¼ã¯ã®æå³<br>
      ã»<b>ð</b> = 1æ¥ã®å©çã5ä¸åä»¥ä¸<br>
      ã»<b>ð</b> = 1æ¥ã®å©çã10ä¸åä»¥ä¸<br><br>
      <b>å©çãåºãæ¥ãå¼·ãåºèãæ¯ãè¿ãæã«ä½¿ãã¾ãã</b>
    `
  },
  {
    title: "ð å®ç¸¾æ©è½ã®è¦æ¹",
    content: `
      <b>ãããç»é¢ã«ã¯å®ç¸¾ã«ã¼ããããã¾ãã</b><br><br>
      è¡¨ç¤ºãããåå®¹<br>
      ã»è§£é¤æ¸ã¿å®ç¸¾æ°<br>
      ã»ææ°ã§åã£ãå®ç¸¾<br>
      ã»æ¬¡ã«è¿ãå®ç¸¾<br><br>
      å®ç¸¾ä¸è¦§ã§ã¯ãéææ¸ã¿ / æªéæãç¢ºèªã§ãã¾ãã<br><br>
      ä¾ï¼<br>
      ã»è¨ªååæ°ç³»<br>
      ã»æååæ°ç³»<br>
      ã»å©çç³»<br>
      ã»ã«ã¼ãéæç³»<br><br>
      <b>å®ç¸¾ä¸è¦§ã¯ã¢ã³ã¼ãã£ãªã³ã§ééã§ãã¾ãã</b>
    `
  },
  {
    title: "ð§ å°ã£ãæã®è¦æ¹",
    content: `
      <b>ãã¾ãè¡¨ç¤ºãããªãæã¯æ¬¡ãç¢ºèªãã¦ãã ããã</b><br><br>
      ã»å°å³ã«åºãªã<br>
      â ä½æãGoogleãããURLãç¢ºèªãã¦ãåº§æ¨ä¸æ¬ååå¾ãè©¦ã<br><br>
      ã»ã«ã¼ãã«åã®åºèãæ··ãã<br>
      â ä»æ¥è¡ãã®ãã§ãã¯ãæ®ã£ã¦ããªããç¢ºèªãã<br><br>
      ã»è¿ãã®åºèãåºãªã<br>
      â ä½ç½®æå ±ã®è¨±å¯ãç¢ºèªãã<br><br>
    `
  }
];

function openHelp() {
  const el = document.getElementById("helpUI");
  const titleEl = document.getElementById("helpTitle");
  const contentEl = document.getElementById("helpContent");

  if (!el || !titleEl || !contentEl) {
    alert("ä½¿ãæ¹è¡¨ç¤ºã®èª­ã¿è¾¼ã¿ã«å¤±æãã¾ããã");
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
   APIã­ã¼ãªãï¼Googleãããåºèæ¤ç´¢è£å©
   åºèæ¤ç´¢ / ãããURLè²¼ä» / ä½æåè£èªåå¥å
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
  const text = String(query || "").trim() || "åºè";
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

  openGoogleMapsSearch(keyword || "ãªãµã¤ã¯ã«ã·ã§ãã");
}

/* æ§ãã¿ã³åãæ®ã£ã¦ãã¦ãåãããã«ããä¿éº */
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

      if (name && name !== "ãªãµã¤ã¯ã«ã·ã§ãã") return name;
    }

    const searchMatch = decoded.match(/\/maps\/search\/([^/@]+)/);
    if (searchMatch && searchMatch[1]) {
      const name = String(searchMatch[1])
        .replaceAll("+", " ")
        .trim();

      if (name && name !== "ãªãµã¤ã¯ã«ã·ã§ãã") return name;
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
    "åæµ·é",
    "éæ£®ç", "å²©æç", "å®®åç", "ç§ç°ç", "å±±å½¢ç", "ç¦å³¶ç",
    "è¨åç", "æ æ¨ç", "ç¾¤é¦¬ç", "å¼çç", "åèç", "æ±äº¬é½", "ç¥å¥å·ç",
    "æ°æ½ç", "å¯å±±ç", "ç³å·ç", "ç¦äºç", "å±±æ¢¨ç", "é·éç",
    "å²éç", "éå²¡ç", "æç¥ç", "ä¸éç",
    "æ»è³ç", "äº¬é½åº", "å¤§éªåº", "åµåº«ç", "å¥è¯ç", "åæ­å±±ç",
    "é³¥åç", "å³¶æ ¹ç", "å²¡å±±ç", "åºå³¶ç", "å±±å£ç",
    "å¾³å³¶ç", "é¦å·ç", "æåªç", "é«ç¥ç",
    "ç¦å²¡ç", "ä½è³ç", "é·å´ç", "çæ¬ç", "å¤§åç", "å®®å´ç", "é¹¿åå³¶ç",
    "æ²ç¸ç"
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
    "Googleãããã®å±æURLãè²¼ãä»ãã¦ãã ããã\n\nGoogleãããã§åºèãéã â å±æ â ãªã³ã¯ãã³ãã¼",
    ""
  );

  if (input === null) return;

  const url = String(input || "").trim();

  if (!url) {
    alert("URLãå¥åããã¦ãã¾ããã");
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
      "GoogleãããURLãå¥åãã¾ããã\n\nãã ãããã®URLããåº§æ¨ãåå¾ã§ãã¾ããã§ããã\nURLåã« @ç·¯åº¦,çµåº¦ ã¾ãã¯ !3dç·¯åº¦!4dçµåº¦ ãå«ã¾ãã¦ãããç¢ºèªãã¦ãã ããã"
    );
    return;
  }

  const result = await reverseGeocodeLatLng(coord.lat, coord.lng);

  if (!result || !result.address) {
    alert(
      `GoogleãããURLãå¥åãã¾ããã\n\nåº§æ¨ã¯åå¾ã§ãã¾ããã\nç·¯åº¦: ${coord.lat}\nçµåº¦: ${coord.lng}\n\nãã ããä½æã®èªååå¾ã«å¤±æãã¾ããã`
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
        `é½éåºçãèªååå¾ãã¾ããã\n\nç¾å¨: ${currentPref}\nåå¾: ${nextPref}\n\nåå¾ããé½éåºçã§ä¸æ¸ããã¾ããï¼`
      );
      if (ok) prefEl.value = nextPref;
    }
  }

  if (addressEl && nextAddress) {
    if (!currentAddress) {
      addressEl.value = nextAddress;
    } else if (currentAddress !== nextAddress) {
      const ok = confirm(
        `ä½æåè£ãèªååå¾ãã¾ããã\n\nç¾å¨:\n${currentAddress}\n\nåå¾:\n${nextAddress}\n\nåå¾ããä½æã§ä¸æ¸ããã¾ããï¼`
      );
      if (ok) addressEl.value = nextAddress;
    }
  }

  alert(
    `GoogleãããURLãå¥åãã¾ããã\n\nåº§æ¨ã¨ä½æåè£ãåå¾ãã¾ããã\n\nç·¯åº¦: ${coord.lat}\nçµåº¦: ${coord.lng}\n\nä½æ:\n${nextAddress}\n\nåå®¹ãç¢ºèªãã¦ããåºèè¿½å ãã¦ãã ããã`
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
