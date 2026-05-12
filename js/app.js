let stores = loadStores();
let logs = loadLogs();
let savedRoutes = loadSavedRoutes();
let todayRouteOrder = loadTodayRouteOrder();

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
let storeEditTargetIndex = -1;

let todayRouteAccordionOpen = true;

const TODAY_ROUTE_VISITED_KEY = "today_route_visited_ids";
const STORE_ALERTED_STATUS_KEY = "store_closing_alerted_v1";
const STORE_ADD_ACCORDION_KEY = "store_add_accordion_open";

function syncStoreProfitsFromLogs() {
  stores.forEach(store => {
    store.profit = getStoreProfitFromLogs(store.id);
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

function getStoreBusinessStatus(store) {
  if (isRegularClosedToday(store)) {
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

  localStorage.setItem(STORE_ADD_ACCORDION_KEY, willOpen ? "open" : "closed");
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

  const businessStatus = getStoreBusinessStatus(s);
  const hoursText = formatStoreHours(s);
  const showBusinessStatus = businessStatus.code !== "unknown";
  const closedDaysText = formatClosedDays(s);

  return `
    <div class="item compactCard ${expectedClass} ${staleClass}">
      <div class="evalLabel ${evalData.class}">
        ${evalData.label}
      </div>

      <div class="name">${escapeHtml(s.name)}</div>

      <div class="mt8">
        ${compactBadges}
      </div>

      <div class="mini mt8">
        🕒 営業時間 ${escapeHtml(hoursText)}
      </div>

      <div class="mini mt6">
        📌 定休日 ${escapeHtml(closedDaysText)}
      </div>

      ${showBusinessStatus ? `
        <div class="mini mt6 ${businessStatus.className}">
          ${escapeHtml(businessStatus.label)}
        </div>
      ` : ``}

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

  const businessStatus = getStoreBusinessStatus(s);
  const hoursText = formatStoreHours(s);
  const showBusinessStatus = businessStatus.code !== "unknown";
  const closedDaysText = formatClosedDays(s);

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

      <div class="mini mt8">
        🕒 営業時間 ${escapeHtml(hoursText)}
      </div>

      <div class="mini mt6">
        📌 定休日 ${escapeHtml(closedDaysText)}
      </div>

      ${showBusinessStatus ? `
        <div class="mini mt6 ${businessStatus.className}">
          ${escapeHtml(businessStatus.label)}
        </div>
      ` : ``}

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

function renderSavedRoutesList() {
  const el = document.getElementById("savedRoutesList");
  if (!el) return;

  if (!savedRoutes.length) {
    el.innerHTML = "保存済みルートはまだありません。";
    return;
  }

  sortSavedRoutes();

  el.innerHTML = savedRoutes.map(route => {
    const routeStores = buildSavedRouteStores(route);
    const isOpen = openSavedRouteId === route.id;
    const dueSummary = calcSavedRouteDueSummary(route);

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
              </div>

              <div class="savedRouteMeta">
                更新: ${escapeHtml(formatDateTimeText(route.updatedAt || route.createdAt))}
              </div>
            </div>

            <div class="savedRouteChevron">${isOpen ? "▲" : "▼"}</div>
          </div>

          <div class="savedRouteCompactInfo">
            <div class="savedRouteCount">
              店舗数: ${route.storeIds.length}件
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

          ${
            routeStores.length
              ? `
                <div class="savedRouteFullList">
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
  }).join("");
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
      const businessStatus = getStoreBusinessStatus(s);
      const hoursText = formatStoreHours(s);
      const showBusinessStatus = businessStatus.code !== "unknown";
      const closedDaysText = formatClosedDays(s);

      return `
        <div class="item todayRouteItem ${visited ? "todayRouteItemVisited" : ""}">
          <div class="name todayRouteName">
            ${idx + 1}. ${escapeHtml(s.name)}
            ${visited ? `<span class="badge" style="margin-left:8px;">訪問済み</span>` : ``}
          </div>

          <div class="mini">
            ${escapeHtml(s.pref || "")}${s.address ? ` / ${escapeHtml(s.address)}` : ""}
          </div>

          <div class="mini mt6">
            🕒 営業時間 ${escapeHtml(hoursText)}
          </div>

          <div class="mini mt6">
            📌 定休日 ${escapeHtml(closedDaysText)}
          </div>

          ${!visited && showBusinessStatus ? `
            <div class="mini mt6 ${businessStatus.className}">
              ${escapeHtml(businessStatus.label)}
            </div>
          ` : ``}

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
  scheduleRenderMapMarkers();
  renderCurrentLocationMarker();
  syncTodayRouteAccordionUI();
  renderBadgesIfExists();
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

function toggleBackupAccordion(forceOpen = null) {
  const body = document.getElementById("backupAccordionBody");
  const header = document.getElementById("backupAccordionHeader");
  const chevron = document.getElementById("backupAccordionChevron");
  if (!body || !header || !chevron) return;

  const willOpen =
    forceOpen === null
      ? body.style.display === "none"
      : !!forceOpen;

  body.style.display = willOpen ? "block" : "none";
  header.setAttribute("aria-expanded", willOpen ? "true" : "false");
  chevron.textContent = willOpen ? "▲" : "▼";
}

function exportBackup() {
  const data = {
    version: 3,
    exportedAt: new Date().toISOString(),
    stores,
    logs,
    savedRoutes,
    todayRouteOrder
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `sedori-backup-${tokyoDateStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(String(e.target?.result || ""));
      if (!Array.isArray(parsed.stores)) throw new Error("invalid backup");

      if (!confirm("現在のデータをバックアップで上書きします。よろしいですか？")) {
        event.target.value = "";
        return;
      }

      stores = parsed.stores.map(normalizeStore);
      logs = Array.isArray(parsed.logs) ? parsed.logs.map(normalizeLog) : [];
      savedRoutes = Array.isArray(parsed.savedRoutes)
        ? parsed.savedRoutes.map(normalizeRoute)
        : [];
      todayRouteOrder = Array.isArray(parsed.todayRouteOrder)
        ? normalizeTodayRouteOrder(parsed.todayRouteOrder)
        : [];

      syncStoreProfitsFromLogs();

      nearbyMode = false;
      noCoordsOnlyMode = false;
      nearbyStoreIds = new Set();
      clearSplitRouteCache();
      openSavedRouteId = null;
      todayRouteVisitedIds = [];

      syncTodayRouteOrder();
      saveTodayRouteVisitedIds();
      saveAll();
      render();
      alert("バックアップを読み込みました。");
    } catch (e) {
      console.error(e);
      alert("バックアップの読込に失敗しました。");
    } finally {
      event.target.value = "";
    }
  };

  reader.readAsText(file, "utf-8");
}

function restoreAutoBackup() {
  const data = getAutoBackup();
  if (!data) {
    alert("このアプリ内に復元できる自動バックアップがありません。");
    return;
  }

  if (!confirm("自動バックアップで現在のデータを上書きします。よろしいですか？")) return;

  stores = Array.isArray(data.stores) ? data.stores.map(normalizeStore) : [];
  logs = Array.isArray(data.logs) ? data.logs.map(normalizeLog) : [];
  savedRoutes = Array.isArray(data.savedRoutes)
    ? data.savedRoutes.map(normalizeRoute)
    : [];
  todayRouteOrder = Array.isArray(data.todayRouteOrder)
    ? normalizeTodayRouteOrder(data.todayRouteOrder)
    : [];

  syncStoreProfitsFromLogs();

  nearbyMode = false;
  noCoordsOnlyMode = false;
  nearbyStoreIds = new Set();
  clearSplitRouteCache();
  openSavedRouteId = null;
  todayRouteVisitedIds = [];

  syncTodayRouteOrder();
  saveTodayRouteVisitedIds();
  saveAll();
  render();
  alert("自動バックアップから復元しました。");
}

function showAutoBackupInfo() {
  const data = getAutoBackup();
  if (!data) {
    alert("自動バックアップはありません。");
    return;
  }

  alert(
    `保存日時: ${data.savedAt || "不明"}\n店舗数: ${data.stores.length}件\nログ数: ${data.logs.length}件\n保存ルート数: ${data.savedRoutes.length}件`
  );
}

function syncTodayRouteOrder() {
  const todayIds = stores.filter(s => s.today).map(s => s.id);
  const todaySet = new Set(todayIds);

  todayRouteOrder = todayRouteOrder.filter(id => todaySet.has(id));

  todayIds.forEach(id => {
    if (!todayRouteOrder.includes(id)) {
      todayRouteOrder.push(id);
    }
  });
}

function getTodayRouteStores() {
  syncTodayRouteOrder();

  return todayRouteOrder
    .map(id => stores.find(s => s.id === id))
    .filter(s => s && s.today)
    .filter(s => hasCoords(s) || s.address);
}

function getPendingTodayRouteStores() {
  syncTodayRouteOrder();
  syncTodayRouteVisitedIds();

  return todayRouteOrder
    .map(id => stores.find(s => s.id === id))
    .filter(s => s && s.today)
    .filter(s => !isTodayRouteVisited(s.id))
    .filter(s => hasCoords(s) || s.address);
}

function clearSplitRouteCache() {
  splitRouteCache = null;
}

function chunkRouteStores(routeStores, chunkSize = 9) {
  const chunks = [];
  for (let i = 0; i < routeStores.length; i += chunkSize) {
    chunks.push(routeStores.slice(i, i + chunkSize));
  }
  return chunks;
}

function moveTodayRouteItem(index, delta) {
  syncTodayRouteOrder();

  const nextIndex = index + delta;
  if (
    index < 0 ||
    nextIndex < 0 ||
    index >= todayRouteOrder.length ||
    nextIndex >= todayRouteOrder.length
  ) return;

  const arr = [...todayRouteOrder];
  const temp = arr[index];
  arr[index] = arr[nextIndex];
  arr[nextIndex] = temp;
  todayRouteOrder = arr;

  clearSplitRouteCache();
  saveAll();
  render();
}

function removeTodayRouteItem(index) {
  syncTodayRouteOrder();

  const id = todayRouteOrder[index];
  if (!id) return;

  const store = stores.find(s => s.id === id);
  if (store) store.today = false;

  todayRouteOrder = todayRouteOrder.filter((_, i) => i !== index);
  unmarkTodayRouteVisited(id);
  clearSplitRouteCache();

  saveAll();
  render();
}

function buildGoogleMapsRouteUrl(routeStores) {
  if (!routeStores.length) return "";

  const makeDest = s => {
    if (hasCoords(s)) return `${s.lat},${s.lng}`;
    return s.address;
  };

  const destination = makeDest(routeStores[routeStores.length - 1]);
  const waypoints = routeStores.slice(0, -1).map(makeDest).slice(0, 8);
  const origin = "Current Location";

  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving${waypoints.length ? `&waypoints=${encodeURIComponent(waypoints.join("|"))}` : ""}`;
}

function setSplitRouteCache(routeStores) {
  const chunks = chunkRouteStores(routeStores, 9);

  let carryStartPos =
    window.lastPos &&
    typeof window.lastPos.lat === "number" &&
    typeof window.lastPos.lng === "number"
      ? { lat: window.lastPos.lat, lng: window.lastPos.lng }
      : null;

  splitRouteCache = {
    parts: chunks.map((storesPart, idx) => {
      const estimatedMinutes = estimateRouteMinutes(storesPart, carryStartPos);

      const lastStoreWithCoords = [...storesPart]
        .reverse()
        .find(store => hasCoords(store));

      if (lastStoreWithCoords) {
        carryStartPos = {
          lat: lastStoreWithCoords.lat,
          lng: lastStoreWithCoords.lng
        };
      } else {
        carryStartPos = null;
      }

      return {
        index: idx + 1,
        stores: storesPart,
        url: buildGoogleMapsRouteUrl(storesPart),
        start: idx * 9 + 1,
        end: idx * 9 + storesPart.length,
        estimatedMinutes
      };
    })
  };
}

function openSplitRoutePart(part) {
  if (!splitRouteCache?.parts?.length) {
    alert("分割ルートがありません。もう一度「この順番でルート作成」を押してください。");
    return;
  }

  const target = splitRouteCache.parts.find(p => p.index === part);
  if (!target || !target.url) {
    alert(`ルート${part}を開けませんでした。`);
    return;
  }

  window.open(target.url, "_blank");
}

function getNearestNeighborRoute(routeStores, startPos = null) {
  const remaining = [...routeStores];
  const ordered = [];

  let currentPoint =
    startPos &&
    typeof startPos.lat === "number" &&
    typeof startPos.lng === "number"
      ? { lat: startPos.lat, lng: startPos.lng }
      : null;

  while (remaining.length) {
    let bestIndex = 0;

    if (currentPoint) {
      let bestDist = Infinity;

      remaining.forEach((store, idx) => {
        if (!hasCoords(store)) return;
        const dist = distanceKm(
          currentPoint.lat,
          currentPoint.lng,
          store.lat,
          store.lng
        );
        if (dist < bestDist) {
          bestDist = dist;
          bestIndex = idx;
        }
      });
    }

    const nextStore = remaining.splice(bestIndex, 1)[0];
    ordered.push(nextStore);

    if (hasCoords(nextStore)) {
      currentPoint = { lat: nextStore.lat, lng: nextStore.lng };
    } else {
      currentPoint = null;
    }
  }

  return ordered;
}

function openRouteInGoogleMaps(routeStores) {
  if (!routeStores.length) {
    alert("ルートに使える店舗がありません。");
    return;
  }

  if (routeStores.length <= 9) {
    clearSplitRouteCache();
    const url = buildGoogleMapsRouteUrl(routeStores);
    if (!url) {
      alert("ルートに使える店舗がありません。");
      return;
    }
    window.open(url, "_blank");
    render();
    return;
  }

  setSplitRouteCache(routeStores);
  render();

  const parts = splitRouteCache?.parts || [];
  alert(`店舗数が ${routeStores.length} 件あるため、ルートを ${parts.length} 本に分けました。今日のルート欄の各ルートボタンから開いてください。`);
}

function autoOptimizeTodayRoute() {
  const routeStores = getPendingTodayRouteStores();
  if (!routeStores.length) {
    alert("未訪問の今日ルート店舗がありません。");
    return;
  }

  const optimized = getNearestNeighborRoute(routeStores, window.lastPos);

  const pendingIds = optimized.map(s => s.id);
  const visitedIdsInOrder = todayRouteOrder.filter(id => isTodayRouteVisited(id));
  todayRouteOrder = [...visitedIdsInOrder, ...pendingIds];

  clearSplitRouteCache();
  saveAll();
  render();
  alert("未訪問の今日ルートを自動最適化しました。");
}

function buildTodayRoute() {
  const routeStores = getPendingTodayRouteStores();

  if (!routeStores.length) {
    alert("未訪問の「今日行く」店舗がありません。");
    return;
  }

  openRouteInGoogleMaps(routeStores);
}

function sortSavedRoutes() {
  savedRoutes.sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });
}

function toggleSavedRouteOpen(routeId) {
  openSavedRouteId = openSavedRouteId === routeId ? null : routeId;
  renderSavedRoutesList();
}

function buildSavedRouteStores(route) {
  const ids = Array.isArray(route?.storeIds) ? route.storeIds : [];
  return ids
    .map(id => stores.find(s => s.id === id))
    .filter(Boolean);
}

function getSavedRoutePreviewText(route, count = 3) {
  const routeStores = buildSavedRouteStores(route);
  return routeStores
    .slice(0, count)
    .map(s => s?.name || "店舗名なし")
    .filter(Boolean)
    .join(" / ");
}

function saveCurrentRoute() {
  const routeStores = getTodayRouteStores();
  if (!routeStores.length) {
    alert("保存できる今日のルートがありません。");
    return;
  }

  const defaultName = `ルート ${tokyoDateStr()}`;
  const name = prompt("保存するルート名", defaultName);
  if (name === null) return;

  const note = prompt("メモ（任意）", "") ?? "";

  const newRoute = normalizeRoute({
    id: ensureId(),
    name: String(name).trim() || defaultName,
    note: String(note).trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    favorite: false,
    storeIds: routeStores.map(s => s.id)
  });

  savedRoutes.unshift(newRoute);

  if (savedRoutes.length > 50) {
    savedRoutes = savedRoutes.slice(0, 50);
  }

  sortSavedRoutes();
  openSavedRouteId = newRoute.id;
  saveAll();
  render();
  alert("ルートを保存しました。");
}

function openSavedRoute(routeId) {
  const route = savedRoutes.find(r => r.id === routeId);
  if (!route) return;

  const routeStores = buildSavedRouteStores(route);
  if (!routeStores.length) {
    alert("このルートの店舗が見つかりません。");
    return;
  }

  stores.forEach(s => {
    s.today = route.storeIds.includes(s.id);
  });

  todayRouteOrder = route.storeIds.filter(id =>
    stores.some(s => s.id === id && s.today)
  );

  todayRouteVisitedIds = [];
  saveTodayRouteVisitedIds();

  clearSplitRouteCache();
  syncTodayRouteOrder();

  saveAll();
  render();
  alert(`「${route.name}」を今日のルートに読み込みました。`);
}

function openSavedRouteInMaps(routeId) {
  const route = savedRoutes.find(r => r.id === routeId);
  if (!route) return;

  const routeStores = buildSavedRouteStores(route).filter(
    s => hasCoords(s) || s.address
  );
  if (!routeStores.length) {
    alert("このルートの店舗が見つかりません。");
    return;
  }

  openRouteInGoogleMaps(routeStores);
}

function toggleFavoriteRoute(routeId) {
  const route = savedRoutes.find(r => r.id === routeId);
  if (!route) return;

  route.favorite = !route.favorite;
  route.updatedAt = new Date().toISOString();

  sortSavedRoutes();
  openSavedRouteId = routeId;
  saveAll();
  render();
}

function editSavedRoute(routeId) {
  const route = savedRoutes.find(r => r.id === routeId);
  if (!route) return;

  const name = prompt("ルート名を変更", route.name || "");
  if (name === null) return;

  const note = prompt("メモを変更", route.note || "");
  if (note === null) return;

  route.name = String(name).trim() || route.name || "保存ルート";
  route.note = String(note).trim();
  route.updatedAt = new Date().toISOString();

  sortSavedRoutes();
  openSavedRouteId = routeId;
  saveAll();
  render();
}

function deleteSavedRoute(routeId) {
  const route = savedRoutes.find(r => r.id === routeId);
  if (!route) return;
  if (!confirm(`「${route.name}」を削除しますか？`)) return;

  savedRoutes = savedRoutes.filter(r => r.id !== routeId);
  if (openSavedRouteId === routeId) {
    openSavedRouteId = null;
  }
  saveAll();
  render();
}

function getSelectedRegularClosedDaysFromForm() {
  return [...document.querySelectorAll('input[name="regularClosedDays"]:checked')]
    .map(el => String(el.value || "").trim())
    .filter(Boolean);
}

function clearRegularClosedDaysForm() {
  document.querySelectorAll('input[name="regularClosedDays"]').forEach(el => {
    el.checked = false;
  });
}

function parseClosedDaysInput(text) {
  const allowed = ["月", "火", "水", "木", "金", "土", "日"];
  return [...new Set(
    String(text || "")
      .split(",")
      .map(x => String(x || "").trim())
      .filter(x => allowed.includes(x))
  )];
}

function ensureStoreEditModal() {
  if (document.getElementById("storeEditModal")) return;

  const modal = document.createElement("div");
  modal.id = "storeEditModal";
  modal.className = "qtyCategoryModal";
  modal.innerHTML = `
    <div class="qtyCategoryCard">
      <div class="qtyCategoryTitle">店舗情報を編集</div>
      <div class="qtyCategorySub">基本情報・営業時間・定休日・メモをまとめて編集できます</div>

      <div class="formGrid" style="margin-top:12px;">
        <input id="editStoreName" type="text" placeholder="店舗名">
        <input id="editPrefName" type="text" placeholder="都道府県">
        <input id="editAddress" type="text" placeholder="住所">
        <input id="editMapUrl" type="text" placeholder="GoogleマップURL（任意）">
      </div>

      <div class="storeHoursGrid">
        <input id="editOpenTime" type="text" inputmode="numeric" placeholder="開店時間（例 10:00）">
        <input id="editCloseTime" type="text" inputmode="numeric" placeholder="閉店時間（例 21:00）">
      </div>

      <div class="mt12">
        <div class="mini" style="font-weight:700; margin-bottom:8px;">📅 定休日</div>
        <div class="closedDaysGrid" id="editClosedDaysGrid">
          ${["月", "火", "水", "木", "金", "土", "日"].map(day => `
            <label class="closedDayChip">
              <input type="checkbox" name="editRegularClosedDays" value="${day}">
              <span>${day}</span>
            </label>
          `).join("")}
        </div>
      </div>

      <div class="mt12">
        <textarea
          id="editStoreMemo"
          class="storeMemoInput"
          placeholder="メモ（例: 5/20 棚卸し休み、入口は裏側 など）"
          rows="4"
        ></textarea>
      </div>

      <div class="categoryPickerActions">
        <button type="button" class="ghostBtn" onclick="closeStoreEditModal()">キャンセル</button>
        <button type="button" class="primaryBtn" onclick="saveStoreEditModal()">保存</button>
      </div>
    </div>
  `;

  modal.addEventListener("click", e => {
    if (e.target === modal) closeStoreEditModal();
  });

  document.body.appendChild(modal);
}

function openStoreEditModal(index) {
  const s = stores[index];
  if (!s) return;

  ensureStoreEditModal();
  storeEditTargetIndex = index;

  const nameEl = document.getElementById("editStoreName");
  const prefEl = document.getElementById("editPrefName");
  const addressEl = document.getElementById("editAddress");
  const mapUrlEl = document.getElementById("editMapUrl");
  const openEl = document.getElementById("editOpenTime");
  const closeEl = document.getElementById("editCloseTime");
  const memoEl = document.getElementById("editStoreMemo");

  if (nameEl) nameEl.value = s.name || "";
  if (prefEl) prefEl.value = s.pref || "";
  if (addressEl) addressEl.value = s.address || "";
  if (mapUrlEl) mapUrlEl.value = s.mapUrl || "";
  if (openEl) openEl.value = s.openTime || "";
  if (closeEl) closeEl.value = s.closeTime || "";
  if (memoEl) memoEl.value = s.memo || "";

  const selectedDays = Array.isArray(s.regularClosedDays) ? s.regularClosedDays : [];
  document.querySelectorAll('input[name="editRegularClosedDays"]').forEach(el => {
    el.checked = selectedDays.includes(el.value);
  });

  const modal = document.getElementById("storeEditModal");
  if (modal) modal.classList.add("show");
}

function closeStoreEditModal() {
  const modal = document.getElementById("storeEditModal");
  if (modal) modal.classList.remove("show");
  storeEditTargetIndex = -1;
}

async function saveStoreEditModal() {
  if (storeEditTargetIndex < 0) return;

  const s = stores[storeEditTargetIndex];
  if (!s) {
    closeStoreEditModal();
    return;
  }

  const name = document.getElementById("editStoreName")?.value?.trim() || "";
  const pref = document.getElementById("editPrefName")?.value?.trim() || "";
  const address = document.getElementById("editAddress")?.value?.trim() || "";
  const mapUrl = document.getElementById("editMapUrl")?.value?.trim() || "";
  const openTime = document.getElementById("editOpenTime")?.value?.trim() || "";
  const closeTime = document.getElementById("editCloseTime")?.value?.trim() || "";
  const memo = document.getElementById("editStoreMemo")?.value?.trim() || "";
  const regularClosedDays = [...document.querySelectorAll('input[name="editRegularClosedDays"]:checked')]
    .map(el => String(el.value || "").trim())
    .filter(Boolean);

  if (!name) {
    alert("店舗名を入れてください。");
    return;
  }

  s.name = name;
  s.pref = pref;
  s.address = address;
  s.mapUrl = mapUrl;
  s.openTime = openTime;
  s.closeTime = closeTime;
  s.memo = memo;
  s.regularClosedDays = regularClosedDays;

  const pos = await resolveStoreLatLng(s.pref, s.address, s.name, s.mapUrl, true);
  s.lat = pos.lat;
  s.lng = pos.lng;

  saveAll();
  render();
  closeStoreEditModal();
}

async function addStore() {
  const name = document.getElementById("storeName")?.value?.trim() || "";
  const pref = document.getElementById("prefName")?.value?.trim() || "";
  const address = document.getElementById("address")?.value?.trim() || "";
  const mapUrl = document.getElementById("mapUrl")?.value?.trim() || "";
  const openTime = document.getElementById("openTime")?.value?.trim() || "";
  const closeTime = document.getElementById("closeTime")?.value?.trim() || "";
  const regularClosedDays = getSelectedRegularClosedDaysFromForm();
  const memo = document.getElementById("storeMemo")?.value?.trim() || "";

  if (!name) {
    alert("店舗名を入れてください。");
    return;
  }

  const pos = await resolveStoreLatLng(pref, address, name, mapUrl, true);

  stores.push(normalizeStore({
    id: ensureId(),
    name,
    pref,
    address,
    mapUrl,
    openTime,
    closeTime,
    regularClosedDays,
    memo,
    lat: pos.lat,
    lng: pos.lng,
    visits: 0,
    buyDays: 0,
    items: 0,
    profit: 0,
    defaultCategory: "",
    categoryCounts: {},
    lastVisitDate: "",
    today: false
  }));

  document.getElementById("storeName").value = "";
  document.getElementById("prefName").value = "";
  document.getElementById("address").value = "";
  document.getElementById("mapUrl").value = "";
  if (document.getElementById("openTime")) document.getElementById("openTime").value = "";
  if (document.getElementById("closeTime")) document.getElementById("closeTime").value = "";
  if (document.getElementById("storeMemo")) document.getElementById("storeMemo").value = "";
  clearRegularClosedDaysForm();

  saveAll();
  render();
}

async function editStore(i) {
  const s = stores[i];
  if (!s) return;

  const menu = prompt(
`設定メニュー
1: 基本情報編集
2: カテゴリを追加
3: カテゴリを減らす
4: 成功を増やす
5: 成功を減らす
6: デフォルトカテゴリ変更
7: 利益を修正

番号を入力してください`,
    "1"
  );

  if (menu === null) return;

  if (menu === "1") {
    openStoreEditModal(i);
    return;
  }

  if (menu === "2") {
    const text = prompt("追加するカテゴリを入力\n例: 楽器:2, 家電:1", "");
    if (text !== null) {
      const deltaMap = parseCategoryInput(text);
      applyCategoryDelta(s, deltaMap, 1);
      s.items = sumCategoryCounts(s.categoryCounts);
      Object.entries(deltaMap).forEach(([cat, qty]) => addLog(s.id, "category", qty, cat));
    }
  }

  if (menu === "3") {
    const text = prompt("減らすカテゴリを入力\n例: 楽器:1, 家電:1", "");
    if (text !== null) {
      const deltaMap = parseCategoryInput(text);
      applyCategoryDelta(s, deltaMap, -1);
      s.items = sumCategoryCounts(s.categoryCounts);
      Object.entries(deltaMap).forEach(([cat, qty]) => addLog(s.id, "category", -qty, cat));
    }
  }

  if (menu === "4") {
    const n = clampNonNeg(parseInt(prompt("増やす成功回数", "1"), 10));
    if (n) {
      s.buyDays += n;
      if (s.buyDays > s.visits) s.visits = s.buyDays;
      addLog(s.id, "success", n);
    }
  }

  if (menu === "5") {
    const n = clampNonNeg(parseInt(prompt("減らす成功回数", "1"), 10));
    if (n) {
      s.buyDays = Math.max(0, s.buyDays - n);
      addLog(s.id, "success", -n);
    }
  }

  if (menu === "6") {
    const cat = prompt("デフォルトカテゴリ", s.defaultCategory || "");
    if (cat !== null) {
      s.defaultCategory = String(cat).trim();
      categoryHistoryDirty = true;
    }
  }

  if (menu === "7") {
    openProfitEditModal(i);
    return;
  }

  saveAll();
  render();
}

function deleteStore(i) {
  const s = stores[i];
  if (!s) return;
  if (!confirm(`「${s.name}」を削除しますか？`)) return;

  stores.splice(i, 1);
  todayRouteOrder = todayRouteOrder.filter(id => id !== s.id);
  unmarkTodayRouteVisited(s.id);
  clearSplitRouteCache();
  saveAll();
  render();
}

function navigateToStore(i) {
  const s = stores[i];
  if (!s) return;

  if (hasCoords(s)) {
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${s.lat},${s.lng}`)}&travelmode=driving`,
      "_blank"
    );
    return;
  }

  if (s.address) {
    window.open(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}`,
      "_blank"
    );
    return;
  }

  alert("住所または座標が登録されていません。");
}

async function refreshStoreCoordinates(i) {
  const s = stores[i];
  if (!s) return;

  const pos = await resolveStoreLatLng(s.pref, s.address, s.name, s.mapUrl, true);
  s.lat = pos.lat;
  s.lng = pos.lng;

  saveAll();
  render();
}

async function refreshAllCoordinates() {
  const targets = stores.filter(s => !hasCoords(s));
  if (!targets.length) {
    alert("座標なし店舗はありません。");
    return;
  }

  if (!confirm(`座標なし店舗 ${targets.length} 件の座標を再取得します。よろしいですか？`)) return;

  for (let idx = 0; idx < targets.length; idx++) {
    const s = targets[idx];
    const pos = await resolveStoreLatLng(s.pref, s.address, s.name, s.mapUrl, false);
    s.lat = pos.lat;
    s.lng = pos.lng;

    if (idx < targets.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 180));
    }
  }

  saveAll();
  render();
  alert("座標再取得が完了しました。");
}

function visit(i) {
  const s = stores[i];
  if (!s) return;

  s.visits += 1;
  s.lastVisitDate = tokyoDateStr();

  if (s.today) {
    markTodayRouteVisited(s.id);
  }

  addLog(s.id, "visit", 1);

  checkAndCountCompletedRoute();

  saveAll();
  render();
}

function visitMinus(i) {
  const s = stores[i];
  if (!s) return;
  s.visits = clampNonNeg(s.visits - 1);
  if (s.buyDays > s.visits) s.buyDays = s.visits;
  addLog(s.id, "visit", -1);
  saveAll();
  render();
}

function itemsPlus(i) {
  const s = stores[i];
  if (!s) return;

  const history = getCategoryHistory();

  openQtyCategoryModal({
    history,
    defaultCategory: s.defaultCategory
  }).then(result => {
    if (!result) return;

    const n = clampNonNeg(parseInt(result.qty || "0", 10));
    const catMap =
      result.categoryMap && typeof result.categoryMap === "object"
        ? result.categoryMap
        : null;
    const profit = clampNonNeg(parseInt(result.profit || "0", 10));

    if (!n || !catMap) return;

    const keys = Object.keys(catMap);
    if (!keys.length) return;

    const total = Object.values(catMap).reduce((sum, v) => sum + Number(v || 0), 0);
    if (total !== n) {
      alert("カテゴリ個数の合計が一致していません。");
      return;
    }

    s.items += n;
    s.buyDays += 1;
    if (s.buyDays > s.visits) s.visits = s.buyDays;
    s.lastVisitDate = tokyoDateStr();

    addLog(s.id, "success", 1);
    addLog(s.id, "items", n);

    keys.forEach(cat => {
      const addQty = clampNonNeg(catMap[cat] || 0);
      if (!addQty) return;

      s.categoryCounts[cat] = (s.categoryCounts[cat] || 0) + addQty;
      addLog(s.id, "category", addQty, cat);
    });

    if (profit > 0) {
      s.profit += profit;
      addLog(s.id, "profit", profit);
    }

    const firstCat = keys[0];
    if (firstCat) s.defaultCategory = firstCat;

    saveAll();
    render();
  });
}

function itemsMinus(i) {
  const s = stores[i];
  if (!s) return;

  const currentTotal = Number(s.items || 0);
  if (currentTotal <= 0) {
    alert("減らせる個数がありません。");
    return;
  }

  const history =
    Object.keys(s.categoryCounts || {}).length
      ? Object.keys(s.categoryCounts || {})
      : getCategoryHistory();

  openQtyCategoryModal({
    history,
    defaultCategory: s.defaultCategory
  }).then(result => {
    if (!result) return;

    const n = clampNonNeg(parseInt(result.qty || "0", 10));
    const catMap =
      result.categoryMap && typeof result.categoryMap === "object"
        ? result.categoryMap
        : null;

    if (!n || !catMap) return;

    const total = Object.values(catMap).reduce((sum, v) => sum + Number(v || 0), 0);
    if (total !== n) {
      alert("カテゴリ個数の合計が一致していません。");
      return;
    }

    if (n > currentTotal) {
      alert(`現在個数 ${currentTotal} 個を超えて減らすことはできません。`);
      return;
    }

    for (const [cat, qty] of Object.entries(catMap)) {
      const current = Number(s.categoryCounts[cat] || 0);
      if (qty > current) {
        alert(`カテゴリ「${cat}」は現在 ${current} 個です。`);
        return;
      }
    }

    s.items = clampNonNeg(s.items - n);

    Object.entries(catMap).forEach(([cat, qty]) => {
      const current = Number(s.categoryCounts[cat] || 0);
      const next = Math.max(0, current - qty);

      if (next <= 0) delete s.categoryCounts[cat];
      else s.categoryCounts[cat] = next;

      addLog(s.id, "category", -qty, cat);
    });

    addLog(s.id, "items", -n);

    if (!Object.keys(s.categoryCounts || {}).length && s.items === 0) {
      s.defaultCategory = "";
    } else if (s.defaultCategory && !s.categoryCounts[s.defaultCategory]) {
      const remainCats = Object.keys(s.categoryCounts || {});
      s.defaultCategory = remainCats[0] || s.defaultCategory || "";
    }

    saveAll();
    render();
  });
}

function toggleToday(i, checked) {
  const s = stores[i];
  if (!s) return;

  s.today = !!checked;

  if (s.today) {
    if (!todayRouteOrder.includes(s.id)) {
      todayRouteOrder.push(s.id);
    }
  } else {
    todayRouteOrder = todayRouteOrder.filter(id => id !== s.id);
    unmarkTodayRouteVisited(s.id);
  }

  clearSplitRouteCache();
  syncTodayRouteOrder();
  saveAll();
  render();
}

function toggleTodayByStoreId(storeId, checked) {
  const idx = stores.findIndex(s => s.id === storeId);
  if (idx < 0) return;

  preserveMapViewOnNextRender = true;
  toggleToday(idx, checked);
}

function clearTodayChecks() {
  stores.forEach(s => {
    s.today = false;
  });
  todayRouteOrder = [];
  todayRouteVisitedIds = [];
  saveTodayRouteVisitedIds();
  clearSplitRouteCache();
  saveAll();
  render();
}

function clearNearbyMode() {
  nearbyMode = false;
  noCoordsOnlyMode = false;
  nearbyStoreIds = new Set();
  lastListRenderSignature = "";
  lastMapRenderSignature = "";
}

function showNearbyStores() {
  if (!navigator.geolocation) {
    alert("この端末では位置情報が使えません。");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      window.lastPos = { lat, lng };
      renderCurrentLocationMarker();

      nearbyStoreIds = new Set();
      const distances = [];

      stores.forEach(s => {
        if (!hasCoords(s)) return;
        const dist = distanceKm(lat, lng, s.lat, s.lng);
        distances.push({ id: s.id, dist });
        if (dist <= 3) nearbyStoreIds.add(s.id);
      });

      if (!distances.length) {
        alert("座標入りの店舗がありません。");
        return;
      }

      if (!nearbyStoreIds.size) {
        distances.sort((a, b) => a.dist - b.dist);
        nearbyStoreIds = new Set(distances.map(x => x.id));
        alert(`3km以内の店舗はありません。最寄りは ${distances[0].dist.toFixed(1)}km です。近い順で表示します。`);
      }

      nearbyMode = true;
      noCoordsOnlyMode = false;
      lastListRenderSignature = "";
      lastMapRenderSignature = "";
      render();
    },
    () => alert("現在地を取得できませんでした。"),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function autoDetectNearbyStores() {
  if (!navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(
    pos => {
      window.lastPos = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      };

      renderCurrentLocationMarker();

      lastListRenderSignature = "";
      lastMapRenderSignature = "";

      const sortType = document.getElementById("sortType")?.value || "expected";

      if (sortType === "route" || nearbyMode) {
        render();
      } else {
        scheduleRenderMapMarkers();
      }
    },
    () => {},
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function moveToCurrentLocation() {
  if (!navigator.geolocation) {
    alert("この端末では位置情報が使えません。");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      window.lastPos = { lat, lng };

      if (map) {
        map.setView([lat, lng], 15);
      }

      renderCurrentLocationMarker();

      lastListRenderSignature = "";
      lastMapRenderSignature = "";
      preserveMapViewOnNextRender = true;

      render();

      setTimeout(() => {
        preserveMapViewOnNextRender = false;
      }, 300);
    },
    err => {
      console.error(err);
      alert("現在地を取得できませんでした。位置情報の許可を確認してください。");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
}

function showNoCoordsOnly() {
  noCoordsOnlyMode = true;
  nearbyMode = false;
  lastListRenderSignature = "";
  lastMapRenderSignature = "";
  render();
}

function setLayoutMode(mode) {
  currentLayoutMode = mode === "compact" ? "compact" : "detail";
  localStorage.setItem("store_layout_mode", currentLayoutMode);
  updateLayoutButtons();
  lastListRenderSignature = "";
  render();
}

function ensureQtyCategoryModal() {
  if (document.getElementById("qtyCategoryModal")) return;

  const modal = document.createElement("div");
  modal.id = "qtyCategoryModal";
  modal.className = "qtyCategoryModal";
  modal.innerHTML = `
    <div class="qtyCategoryCard">
      <div class="qtyCategoryTitle">個数・カテゴリ・利益を入力</div>
      <div class="qtyCategorySub">合計個数、カテゴリごとの個数、利益をまとめて入力できます</div>

      <div class="qtyCategorySectionTitle">合計個数を選択</div>
      <div class="qtyQuickButtons">
        <button type="button" class="qtyQuickBtn" data-qty="1" onclick="selectQuickQty(1)">1</button>
        <button type="button" class="qtyQuickBtn" data-qty="2" onclick="selectQuickQty(2)">2</button>
        <button type="button" class="qtyQuickBtn" data-qty="3" onclick="selectQuickQty(3)">3</button>
        <button type="button" class="qtyQuickBtn" data-qty="4" onclick="selectQuickQty(4)">4</button>
        <button type="button" class="qtyQuickBtn" data-qty="5" onclick="selectQuickQty(5)">5</button>
      </div>

      <div class="qtyManualRow">
        <input id="qtyManualInput" class="qtyManualInput" type="number" min="1" step="1" placeholder="5以上はここに入力">
        <button type="button" class="qtyManualBtn" onclick="applyManualQty()">手入力反映</button>
      </div>

      <div class="qtySelectedBox">
        合計個数: <span id="qtySelectedValue">1</span>個
      </div>

      <div class="qtyCategorySectionTitle">履歴カテゴリ</div>
      <div id="qtyCategoryChipWrap" class="categoryChipWrap"></div>

      <div class="qtyCategorySectionTitle">新しいカテゴリを追加</div>
      <div class="categoryAddRow">
        <input id="qtyNewCategoryInput" class="categoryTextInput" placeholder="新しいカテゴリ名を入力">
        <button type="button" class="categoryAddBtn" onclick="addNewQtyCategoryChip()">追加</button>
      </div>

      <div class="qtyCategorySectionTitle">カテゴリごとの個数</div>
      <div id="qtyCategoryCountEditor" class="qtyCategoryCountEditor">
        <div class="qtyCategoryEmpty">カテゴリを選択してください</div>
      </div>

      <div class="qtyRemainPanel" id="qtyRemainPanel">
        <div class="qtyRemainLabel">残り</div>
        <div class="qtyRemainValue" id="qtyRemainValue">1</div>
        <div class="qtyRemainUnit">個</div>
      </div>

      <div class="qtySelectedBox qtyCategoryTotalCheck" id="qtyCategoryTotalCheck">
        入力合計: <span id="qtyAssignedTotal">0</span> / <span id="qtyAssignedTarget">1</span>個
      </div>

      <div class="qtyCategorySectionTitle">利益入力</div>

      <div class="qtyQuickButtons">
        <button type="button" class="qtyQuickBtn profitQuickBtn" data-profit="1000" onclick="setQuickProfit(1000)">1000</button>
        <button type="button" class="qtyQuickBtn profitQuickBtn" data-profit="3000" onclick="setQuickProfit(3000)">3000</button>
        <button type="button" class="qtyQuickBtn profitQuickBtn" data-profit="5000" onclick="setQuickProfit(5000)">5000</button>
        <button type="button" class="qtyQuickBtn profitQuickBtn" data-profit="10000" onclick="setQuickProfit(10000)">10000</button>
      </div>

      <div class="qtyManualRow">
        <input
          id="qtyProfitInput"
          class="qtyManualInput"
          type="number"
          min="0"
          step="100"
          value="0"
          placeholder="利益を入力"
          oninput="syncProfitInput()"
        >
        <button type="button" class="qtyManualBtn" onclick="applyManualProfit()">利益反映</button>
      </div>

      <div class="qtySelectedBox">
        利益: <span id="qtyProfitValue">0</span>円
      </div>

      <div class="categoryPickerActions">
        <button type="button" class="ghostBtn" onclick="closeQtyCategoryModal(null)">キャンセル</button>
        <button type="button" class="primaryBtn" onclick="confirmQtyCategoryModal()">OK</button>
      </div>
    </div>
  `;

  modal.addEventListener("click", e => {
    if (e.target === modal) closeQtyCategoryModal(null);
  });

  document.body.appendChild(modal);
}

function openQtyCategoryModal({ history = [], defaultCategory = "" }) {
  ensureQtyCategoryModal();

  const modal = document.getElementById("qtyCategoryModal");
  const chipWrap = document.getElementById("qtyCategoryChipWrap");
  const manualInput = document.getElementById("qtyManualInput");
  const newCategoryInput = document.getElementById("qtyNewCategoryInput");
  const profitInput = document.getElementById("qtyProfitInput");

  qtyCategoryCurrentQty = 1;
  qtyCategorySelected = {};
  qtyCategoryProfit = 0;

  let categories = [...history];
  if (defaultCategory && !categories.includes(defaultCategory)) {
    categories.unshift(defaultCategory);
  }
  if (!categories.length) {
    categories = ["未分類"];
  }

  chipWrap.innerHTML = categories.map(cat => `
    <button
      type="button"
      class="categoryChip"
      data-cat="${escapeHtml(cat)}"
      onclick="toggleQtyCategoryChip('${escapeJsString(cat)}')"
    >
      ${escapeHtml(cat)}
    </button>
  `).join("");

  manualInput.value = "";
  if (newCategoryInput) newCategoryInput.value = "";
  if (profitInput) profitInput.value = "0";

  updateQtySelectedValue();
  renderQtyQuickButtons();
  renderQtyCategoryChipState();
  renderQtyCategoryCountEditor();
  updateQtyAssignedSummary();
  updateProfitView();

  modal.classList.add("show");

  return new Promise(resolve => {
    qtyCategoryModalResolver = resolve;
  });
}

function selectQuickQty(n) {
  qtyCategoryCurrentQty = Number(n || 1);
  updateQtySelectedValue();
  renderQtyQuickButtons();
  updateQtyAssignedSummary();
}

function applyManualQty() {
  const input = document.getElementById("qtyManualInput");
  if (!input) return;

  const n = clampNonNeg(parseInt(input.value || "0", 10));
  if (!n) {
    alert("1以上の個数を入力してください。");
    return;
  }

  qtyCategoryCurrentQty = n;
  updateQtySelectedValue();
  renderQtyQuickButtons();
  updateQtyAssignedSummary();
}

function setQuickProfit(amount) {
  qtyCategoryProfit += clampNonNeg(Number(amount || 0));

  const input = document.getElementById("qtyProfitInput");
  if (input) input.value = String(qtyCategoryProfit);

  updateProfitView();
}

function syncProfitInput() {
  const input = document.getElementById("qtyProfitInput");
  if (!input) return;

  qtyCategoryProfit = clampNonNeg(parseInt(input.value || "0", 10));
  updateProfitView();
}

function applyManualProfit() {
  const input = document.getElementById("qtyProfitInput");
  if (!input) return;

  qtyCategoryProfit = clampNonNeg(parseInt(input.value || "0", 10));
  input.value = String(qtyCategoryProfit);
  updateProfitView();
}

function updateProfitView() {
  const valueEl = document.getElementById("qtyProfitValue");
  if (valueEl) {
    valueEl.textContent = String(qtyCategoryProfit.toLocaleString());
  }

  document.querySelectorAll(".profitQuickBtn").forEach(btn => {
    btn.classList.remove("active");
  });
}

function updateQtySelectedValue() {
  const valueEl = document.getElementById("qtySelectedValue");
  const targetEl = document.getElementById("qtyAssignedTarget");
  if (valueEl) valueEl.textContent = String(qtyCategoryCurrentQty);
  if (targetEl) targetEl.textContent = String(qtyCategoryCurrentQty);
}

function renderQtyQuickButtons() {
  document.querySelectorAll(".qtyQuickBtn").forEach(btn => {
    if (btn.classList.contains("profitQuickBtn")) return;
    const n = Number(btn.getAttribute("data-qty") || "0");
    btn.classList.toggle("active", n === qtyCategoryCurrentQty);
  });
}

function toggleQtyCategoryChip(cat) {
  if (qtyCategorySelected[cat]) {
    delete qtyCategorySelected[cat];
  } else {
    qtyCategorySelected[cat] = 1;
  }
  renderQtyCategoryChipState();
  renderQtyCategoryCountEditor();
  updateQtyAssignedSummary();
}

function renderQtyCategoryChipState() {
  document.querySelectorAll("#qtyCategoryChipWrap .categoryChip").forEach(el => {
    const cat = el.getAttribute("data-cat");
    el.classList.toggle("active", !!qtyCategorySelected[cat]);
  });
}

function renderQtyCategoryCountEditor() {
  const wrap = document.getElementById("qtyCategoryCountEditor");
  if (!wrap) return;

  const keys = Object.keys(qtyCategorySelected);
  if (!keys.length) {
    wrap.innerHTML = `<div class="qtyCategoryEmpty">カテゴリを選択してください</div>`;
    return;
  }

  wrap.innerHTML = keys.map(cat => {
    const value = clampNonNeg(qtyCategorySelected[cat] || 0);
    return `
      <div class="qtyCategoryCountRow">
        <div class="qtyCategoryCountName">${escapeHtml(cat)}</div>
        <div class="qtyStepper">
          <button type="button" class="qtyStepBtn minus" onclick="changeQtyCategoryCount('${escapeJsString(cat)}', -1)">−</button>
          <div class="qtyStepValue">${value}</div>
          <button type="button" class="qtyStepBtn plus" onclick="changeQtyCategoryCount('${escapeJsString(cat)}', 1)">＋</button>
        </div>
      </div>
    `;
  }).join("");
}

function changeQtyCategoryCount(cat, delta) {
  const current = clampNonNeg(qtyCategorySelected[cat] || 0);
  const next = Math.max(0, current + Number(delta || 0));
  qtyCategorySelected[cat] = next;
  renderQtyCategoryCountEditor();
  updateQtyAssignedSummary();
}

function updateQtyAssignedSummary() {
  const total = Object.values(qtyCategorySelected).reduce((sum, v) => sum + Number(v || 0), 0);
  const remain = qtyCategoryCurrentQty - total;

  const totalEl = document.getElementById("qtyAssignedTotal");
  const remainValueEl = document.getElementById("qtyRemainValue");
  const remainPanelEl = document.getElementById("qtyRemainPanel");
  const totalCheckEl = document.getElementById("qtyCategoryTotalCheck");

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

function addNewQtyCategoryChip() {
  const input = document.getElementById("qtyNewCategoryInput");
  const chipWrap = document.getElementById("qtyCategoryChipWrap");
  if (!input || !chipWrap) return;

  const cat = String(input.value || "").trim();
  if (!cat) return;

  const exists = [...chipWrap.querySelectorAll(".categoryChip")]
    .some(el => el.getAttribute("data-cat") === cat);

  if (!exists) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "categoryChip active";
    btn.setAttribute("data-cat", cat);
    btn.textContent = cat;
    btn.onclick = () => toggleQtyCategoryChip(cat);
    chipWrap.appendChild(btn);
  }

  qtyCategorySelected[cat] = qtyCategorySelected[cat] || 1;
  input.value = "";
  renderQtyCategoryChipState();
  renderQtyCategoryCountEditor();
  updateQtyAssignedSummary();
}

function confirmQtyCategoryModal() {
  const keys = Object.keys(qtyCategorySelected);

  if (!qtyCategoryCurrentQty || qtyCategoryCurrentQty < 1) {
    alert("合計個数を選択してください。");
    return;
  }

  if (!keys.length) {
    alert("カテゴリを1つ以上選択してください。");
    return;
  }

  const resultMap = {};
  keys.forEach(cat => {
    resultMap[cat] = clampNonNeg(qtyCategorySelected[cat] || 0);
  });

  const total = Object.values(resultMap).reduce((sum, v) => sum + Number(v || 0), 0);

  if (total !== qtyCategoryCurrentQty) {
    alert(`カテゴリ個数の合計(${total})と合計個数(${qtyCategoryCurrentQty})を一致させてください。`);
    return;
  }

  const hasZero = Object.values(resultMap).some(v => Number(v || 0) <= 0);
  if (hasZero) {
    alert("選択したカテゴリには1個以上を割り当ててください。");
    return;
  }

  closeQtyCategoryModal({
    qty: qtyCategoryCurrentQty,
    categoryMap: resultMap,
    profit: clampNonNeg(qtyCategoryProfit || 0)
  });
}

function closeQtyCategoryModal(result) {
  const modal = document.getElementById("qtyCategoryModal");
  if (modal) modal.classList.remove("show");

  if (qtyCategoryModalResolver) {
    qtyCategoryModalResolver(result);
    qtyCategoryModalResolver = null;
  }
}

function ensureProfitEditModal() {
  if (document.getElementById("profitEditModal")) return;

  const modal = document.createElement("div");
  modal.id = "profitEditModal";
  modal.className = "qtyCategoryModal";
  modal.innerHTML = `
    <div class="qtyCategoryCard">
      <div class="qtyCategoryTitle">利益を修正</div>
      <div class="qtyCategorySub">現在の利益を確認して、新しい利益金額に修正できます</div>

      <div class="qtySelectedBox">
        現在の利益: <span id="profitEditCurrentValue">0</span>円
      </div>

      <div class="qtyCategorySectionTitle">よく使う金額</div>
      <div class="qtyQuickButtons">
        <button type="button" class="qtyQuickBtn profitEditQuickBtn" data-profit="1000" onclick="setProfitEditValue(1000)">1000</button>
        <button type="button" class="qtyQuickBtn profitEditQuickBtn" data-profit="3000" onclick="setProfitEditValue(3000)">3000</button>
        <button type="button" class="qtyQuickBtn profitEditQuickBtn" data-profit="5000" onclick="setProfitEditValue(5000)">5000</button>
        <button type="button" class="qtyQuickBtn profitEditQuickBtn" data-profit="10000" onclick="setProfitEditValue(10000)">10000</button>
      </div>

      <div class="qtyCategorySectionTitle">利益を入力</div>
      <div class="qtyManualRow">
        <input
          id="profitEditInput"
          class="qtyManualInput"
          type="number"
          min="0"
          step="100"
          value="0"
          placeholder="利益を入力"
          oninput="syncProfitEditInput()"
        >
        <button type="button" class="qtyManualBtn" onclick="applyProfitEditInput()">反映</button>
      </div>

      <div class="qtySelectedBox">
        修正後の利益: <span id="profitEditNextValue">0</span>円
      </div>

      <div class="categoryPickerActions">
        <button type="button" class="ghostBtn" onclick="closeProfitEditModal()">キャンセル</button>
        <button type="button" class="primaryBtn" onclick="saveProfitEditModal()">保存</button>
      </div>
    </div>
  `;

  modal.addEventListener("click", e => {
    if (e.target === modal) closeProfitEditModal();
  });

  document.body.appendChild(modal);
}

function openProfitEditModal(index) {
  const s = stores[index];
  if (!s) return;

  ensureProfitEditModal();
  profitEditTargetIndex = index;

  const current = clampNonNeg(Number(s.profit || 0));
  const currentEl = document.getElementById("profitEditCurrentValue");
  const nextEl = document.getElementById("profitEditNextValue");
  const input = document.getElementById("profitEditInput");
  const modal = document.getElementById("profitEditModal");

  if (currentEl) currentEl.textContent = current.toLocaleString();
  if (nextEl) nextEl.textContent = current.toLocaleString();
  if (input) input.value = String(current);

  updateProfitEditQuickState(current);

  if (modal) modal.classList.add("show");
}

function closeProfitEditModal() {
  const modal = document.getElementById("profitEditModal");
  if (modal) modal.classList.remove("show");
  profitEditTargetIndex = -1;
}

function getProfitEditValue() {
  const input = document.getElementById("profitEditInput");
  return clampNonNeg(parseInt(input?.value || "0", 10));
}

function setProfitEditValue(amount) {
  const value = clampNonNeg(Number(amount || 0));
  const input = document.getElementById("profitEditInput");
  const nextEl = document.getElementById("profitEditNextValue");

  if (input) input.value = String(value);
  if (nextEl) nextEl.textContent = value.toLocaleString();

  updateProfitEditQuickState(value);
}

function syncProfitEditInput() {
  const value = getProfitEditValue();
  const nextEl = document.getElementById("profitEditNextValue");
  if (nextEl) nextEl.textContent = value.toLocaleString();
  updateProfitEditQuickState(value);
}

function applyProfitEditInput() {
  const input = document.getElementById("profitEditInput");
  if (!input) return;

  const value = clampNonNeg(parseInt(input.value || "0", 10));
  input.value = String(value);

  const nextEl = document.getElementById("profitEditNextValue");
  if (nextEl) nextEl.textContent = value.toLocaleString();

  updateProfitEditQuickState(value);
}

function updateProfitEditQuickState(value) {
  document.querySelectorAll(".profitEditQuickBtn").forEach(btn => {
    const n = Number(btn.getAttribute("data-profit") || "0");
    btn.classList.toggle("active", n === value);
  });
}

function saveProfitEditModal() {
  if (profitEditTargetIndex < 0) return;

  const s = stores[profitEditTargetIndex];
  if (!s) {
    closeProfitEditModal();
    return;
  }

  const current = clampNonNeg(Number(s.profit || 0));
  const next = getProfitEditValue();
  const diff = next - current;

  s.profit = next;
  if (diff !== 0) {
    addLog(s.id, "profit", diff);
  }

  saveAll();
  render();
  closeProfitEditModal();
}

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

window.addEventListener("load", () => {
  syncStoreProfitsFromLogs();
  syncTodayRouteOrder();
  syncTodayRouteVisitedIds();
  cleanupOldClosingAlerts();
  initMap();
  updateLayoutButtons();
  restoreStoreAddAccordion();
  restoreSortType();
  render();
  renderBadgesIfExists();
  setTimeout(() => autoDetectNearbyStores(), 800);
  setTimeout(() => maybeNotifyClosingSoonStores(), 1200);
  setInterval(() => maybeNotifyClosingSoonStores(), 60000);
  setupButtonPressEffect();
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
