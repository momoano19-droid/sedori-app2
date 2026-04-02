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

const AUTO_BACKUP_KEYS = [
  "auto_backup",
  "sedori_auto_backup_v2",
  "sedori_auto_backup_v1",
  "sedori_auto_backup_v3",
  "sedori_auto_backup"
];

const ROUTE_KEYS = [
  "saved_routes",
  "sedori_saved_routes_v2",
  "sedori_saved_routes_v1",
  "sedori_saved_routes"
];

const TODAY_ROUTE_ORDER_KEYS = [
  "today_route_order",
  "sedori_today_route_order_v2",
  "sedori_today_route_order_v1",
  "sedori_today_route_order"
];

const PRIMARY_STORE_KEY = "stores";
const PRIMARY_LOG_KEY = "logs";
const PRIMARY_AUTO_BACKUP_KEY = "auto_backup";
const PRIMARY_ROUTE_KEY = "saved_routes";
const PRIMARY_TODAY_ROUTE_ORDER_KEY = "today_route_order";
const SORT_TYPE_STORAGE_KEY = "store_sort_type";

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
window.lastPos = null;

/* =========================
   軽量化用キャッシュ
========================= */
let categoryHistoryCache = null;
let categoryHistoryDirty = true;

let lastListRenderSignature = "";
let lastMapRenderSignature = "";
let mapRenderRafId = null;

/* =========================
   個数＋カテゴリモーダル状態
========================= */
let qtyCategoryModalResolver = null;
let qtyCategoryCurrentQty = 1;
let qtyCategorySelected = {};

/* =========================
   起動
========================= */
window.addEventListener("load", () => {
  syncTodayRouteOrder();
  initMap();
  updateLayoutButtons();
  restoreSortType();
  render();
  setTimeout(() => autoDetectNearbyStores(), 800);
  setupButtonPressEffect();
});

/* =========================
   読込 / 保存
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

function ensureId() {
  return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function normalizeStore(s) {
  return {
    id: String(s.id || ensureId()),
    name: String(s.name || "店舗"),
    pref: String(s.pref || "").trim(),
    address: String(s.address || "").trim(),
    mapUrl: String(s.mapUrl || "").trim(),
    lat: (s.lat !== null && s.lat !== "" && !isNaN(Number(s.lat))) ? Number(s.lat) : null,
    lng: (s.lng !== null && s.lng !== "" && !isNaN(Number(s.lng))) ? Number(s.lng) : null,
    visits: Number(s.visits || 0),
    buyDays: Number(s.buyDays || 0),
    items: Number(s.items || 0),
    profit: Number(s.profit || 0),
    defaultCategory: String(s.defaultCategory || "").trim(),
    categoryCounts: (s.categoryCounts && typeof s.categoryCounts === "object") ? { ...s.categoryCounts } : {},
    lastVisitDate: String(s.lastVisitDate || "").trim(),
    today: !!s.today
  };
}

function normalizeRoute(route) {
  return {
    id: String(route?.id || ensureId()),
    name: String(route?.name || "保存ルート").trim() || "保存ルート",
    note: String(route?.note || "").trim(),
    createdAt: String(route?.createdAt || new Date().toISOString()),
    updatedAt: String(route?.updatedAt || route?.createdAt || new Date().toISOString()),
    favorite: !!route?.favorite,
    storeIds: Array.isArray(route?.storeIds) ? route.storeIds.map(x => String(x)) : []
  };
}

function normalizeTodayRouteOrder(v) {
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x)).filter(Boolean);
}

function loadStores() {
  const parsed = readFirstAvailable(STORE_KEYS);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeStore);
}

function saveStores(v) {
  localStorage.setItem(PRIMARY_STORE_KEY, JSON.stringify(v));
}

function loadLogs() {
  const parsed = readFirstAvailable(LOG_KEYS);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(x => ({
    date: String(x.date || "").trim(),
    storeId: String(x.storeId || "").trim(),
    type: String(x.type || "").trim(),
    delta: Number(x.delta || 0),
    category: String(x.category || "").trim()
  }));
}

function saveLogs(v) {
  localStorage.setItem(PRIMARY_LOG_KEY, JSON.stringify(v));
}

function loadSavedRoutes() {
  const parsed = readFirstAvailable(ROUTE_KEYS);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeRoute);
}

function saveRoutes(v) {
  localStorage.setItem(PRIMARY_ROUTE_KEY, JSON.stringify(v));
}

function loadTodayRouteOrder() {
  const parsed = readFirstAvailable(TODAY_ROUTE_ORDER_KEYS);
  return normalizeTodayRouteOrder(parsed);
}

function saveTodayRouteOrder(v) {
  localStorage.setItem(PRIMARY_TODAY_ROUTE_ORDER_KEY, JSON.stringify(normalizeTodayRouteOrder(v)));
}

function saveAutoBackup() {
  try {
    localStorage.setItem(PRIMARY_AUTO_BACKUP_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      stores,
      logs,
      savedRoutes,
      todayRouteOrder
    }));
  } catch (e) {
    console.error(e);
  }
}

function getAutoBackup() {
  for (const key of AUTO_BACKUP_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!parsed) continue;
      return {
        savedAt: parsed.savedAt || "",
        stores: Array.isArray(parsed.stores) ? parsed.stores : [],
        logs: Array.isArray(parsed.logs) ? parsed.logs : [],
        savedRoutes: Array.isArray(parsed.savedRoutes) ? parsed.savedRoutes : [],
        todayRouteOrder: Array.isArray(parsed.todayRouteOrder) ? parsed.todayRouteOrder : []
      };
    } catch (e) {
      console.error("backup read error:", key, e);
    }
  }
  return null;
}

function invalidateDerivedCaches() {
  categoryHistoryDirty = true;
  lastListRenderSignature = "";
  lastMapRenderSignature = "";
}

function saveAll() {
  saveStores(stores);
  saveLogs(logs);
  saveRoutes(savedRoutes);
  saveTodayRouteOrder(todayRouteOrder);
  saveAutoBackup();
  invalidateDerivedCaches();
}

/* =========================
   共通
========================= */
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeJsString(str) {
  return String(str)
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'");
}

function clampNonNeg(n) {
  const x = Number(n);
  if (isNaN(x) || x < 0) return 0;
  return x;
}

function tokyoDateStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateTimeText(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function matchesQuery(s, q) {
  if (!q) return true;
  const cats = Object.keys(s.categoryCounts || {}).join(" ");
  const text = [
    s.name,
    s.pref,
    s.address,
    s.defaultCategory,
    cats
  ].join(" ").toLowerCase();
  return text.includes(String(q).toLowerCase());
}

function addLog(storeId, type, delta, category = "") {
  logs.push({
    date: tokyoDateStr(),
    storeId,
    type,
    delta: Number(delta || 0),
    category: String(category || "")
  });
  categoryHistoryDirty = true;
}

function getMetrics(s) {
  const visits = Number(s.visits || 0);
  const success = Number(s.buyDays || 0);
  const items = Number(s.items || 0);
  const profit = Number(s.profit || 0);

  const rate = visits > 0 ? (success / visits) * 100 : 0;
  const avgProfit = success > 0 ? profit / success : 0;
  const avgItems = success > 0 ? items / success : 0;
  const expected = visits > 0 ? profit / visits : 0;
  const freq = visits > 0 ? (30 / visits) : 0;

  return {
    visits,
    success,
    items,
    profit,
    rate,
    avgProfit,
    avgItems,
    expected,
    freq
  };
}

function formatRestockDays(v) {
  const n = Number(v || 0);
  if (!n) return "0日";
  if (Number.isInteger(n)) return `${n}日`;
  return `${n.toFixed(1).replace(/\.0$/, "")}日`;
}

function getDaysSinceLastVisit(lastVisitDate) {
  if (!lastVisitDate) return null;
  const today = new Date(tokyoDateStr());
  const last = new Date(lastVisitDate);
  if (Number.isNaN(last.getTime())) return null;
  return Math.floor((today - last) / (1000 * 60 * 60 * 24));
}

function formatDaysSinceLastVisit(lastVisitDate) {
  const diff = getDaysSinceLastVisit(lastVisitDate);
  if (diff === null) return "未訪問";
  if (diff <= 0) return "今日";
  return `${diff}日`;
}

function parseCategoryInput(text) {
  const result = {};
  const raw = String(text || "").trim();
  if (!raw) return result;

  raw.split(",").forEach(part => {
    const item = part.trim();
    if (!item) return;

    const pair = item.split(":");
    const name = String(pair[0] || "").trim();
    const qty = clampNonNeg(parseInt(pair[1] || "0", 10));

    if (!name || !qty) return;
    result[name] = (result[name] || 0) + qty;
  });

  return result;
}

function applyCategoryDelta(store, deltaMap, sign) {
  Object.entries(deltaMap).forEach(([cat, qty]) => {
    const current = Number(store.categoryCounts[cat] || 0);
    const next = sign > 0 ? current + qty : Math.max(0, current - qty);
    if (next <= 0) {
      delete store.categoryCounts[cat];
    } else {
      store.categoryCounts[cat] = next;
    }
  });
  categoryHistoryDirty = true;
}

function sumCategoryCounts(categoryCounts) {
  return Object.values(categoryCounts || {}).reduce((a, b) => a + Number(b || 0), 0);
}

function hasCoords(s) {
  return typeof s.lat === "number" && typeof s.lng === "number";
}

function makeButtonStyle(bg, color = "#fff") {
  return `style="background:${bg};color:${color};"`;
}

function getCategoryHistory() {
  if (!categoryHistoryDirty && Array.isArray(categoryHistoryCache)) {
    return categoryHistoryCache;
  }

  const freq = {};

  stores.forEach(s => {
    Object.entries(s.categoryCounts || {}).forEach(([cat, qty]) => {
      if (!cat) return;
      freq[cat] = (freq[cat] || 0) + Number(qty || 0);
    });
  });

  logs.forEach(l => {
    if (l.category) {
      freq[l.category] = (freq[l.category] || 0) + Math.max(1, Math.abs(Number(l.delta || 0)));
    }
  });

  categoryHistoryCache = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .map(([cat]) => cat)
    .slice(0, 12);

  categoryHistoryDirty = false;
  return categoryHistoryCache;
}

function restoreSortType() {
  const sel = document.getElementById("sortType");
  if (!sel) return;

  const saved = localStorage.getItem(SORT_TYPE_STORAGE_KEY);
  if (!saved) return;

  const exists = [...sel.options].some(opt => opt.value === saved);
  if (exists) {
    sel.value = saved;
  }
}

function saveSortType() {
  const sel = document.getElementById("sortType");
  if (!sel) return;
  localStorage.setItem(SORT_TYPE_STORAGE_KEY, sel.value || "expected");
}

function getFilterValues() {
  return {
    q: document.getElementById("q")?.value?.trim() || "",
    prefFilter: document.getElementById("prefFilter")?.value || "__ALL__",
    minExpected: clampNonNeg(parseFloat(document.getElementById("minExpected")?.value || "0")),
    minRate: clampNonNeg(parseFloat(document.getElementById("minRate")?.value || "0")),
    sortType: document.getElementById("sortType")?.value || "expected"
  };
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

/* =========================
   今日ルート順序
========================= */
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

function moveTodayRouteItem(index, delta) {
  syncTodayRouteOrder();

  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || index >= todayRouteOrder.length || nextIndex >= todayRouteOrder.length) return;

  const arr = [...todayRouteOrder];
  const temp = arr[index];
  arr[index] = arr[nextIndex];
  arr[nextIndex] = temp;
  todayRouteOrder = arr;

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

  saveAll();
  render();
}

function getNearestNeighborRoute(routeStores, startPos = null) {
  const remaining = [...routeStores];
  const ordered = [];

  let currentPoint = startPos && typeof startPos.lat === "number" && typeof startPos.lng === "number"
    ? { lat: startPos.lat, lng: startPos.lng }
    : null;

  while (remaining.length) {
    let bestIndex = 0;

    if (currentPoint) {
      let bestDist = Infinity;

      remaining.forEach((store, idx) => {
        if (!hasCoords(store)) return;
        const dist = distanceKm(currentPoint.lat, currentPoint.lng, store.lat, store.lng);
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

function autoOptimizeTodayRoute() {
  const routeStores = getTodayRouteStores();
  if (!routeStores.length) {
    alert("今日のルートに店舗がありません。");
    return;
  }

  const optimized = getNearestNeighborRoute(routeStores, window.lastPos);
  todayRouteOrder = optimized.map(s => s.id);

  saveAll();
  render();
  alert("今日のルートを自動最適化しました。");
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

function openSplitRoutes(routeStores) {
  const first = routeStores.slice(0, 9);
  const second = routeStores.slice(9, 18);

  const firstUrl = buildGoogleMapsRouteUrl(first);
  const secondUrl = buildGoogleMapsRouteUrl(second);

  if (firstUrl) window.open(firstUrl, "_blank");

  if (secondUrl) {
    setTimeout(() => {
      window.open(secondUrl, "_blank");
    }, 500);
  }
}

function openRouteInGoogleMaps(routeStores) {
  if (!routeStores.length) {
    alert("ルートに使える店舗がありません。");
    return;
  }

  if (routeStores.length <= 9) {
    const url = buildGoogleMapsRouteUrl(routeStores);
    if (!url) {
      alert("ルートに使える店舗がありません。");
      return;
    }
    window.open(url, "_blank");
    return;
  }

  if (routeStores.length <= 18) {
    alert(`店舗数が ${routeStores.length} 件あるため、ルートを2本に分けて開きます。`);
    openSplitRoutes(routeStores);
    return;
  }

  alert(`店舗数が ${routeStores.length} 件あります。Googleマップで安定して使うため、18件以下に絞ってください。`);
}

/* =========================
   保存済みルート
========================= */
function sortSavedRoutes() {
  savedRoutes.sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });
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

  savedRoutes.unshift(normalizeRoute({
    id: ensureId(),
    name: String(name).trim() || defaultName,
    note: String(note).trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    favorite: false,
    storeIds: routeStores.map(s => s.id)
  }));

  if (savedRoutes.length > 50) {
    savedRoutes = savedRoutes.slice(0, 50);
  }

  sortSavedRoutes();
  saveAll();
  render();
  alert("ルートを保存しました。");
}

function buildSavedRouteStores(route) {
  const ids = Array.isArray(route?.storeIds) ? route.storeIds : [];
  return ids
    .map(id => stores.find(s => s.id === id))
    .filter(Boolean);
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

  todayRouteOrder = route.storeIds.filter(id => stores.some(s => s.id === id && s.today));
  syncTodayRouteOrder();

  saveAll();
  render();
  alert(`「${route.name}」を今日のルートに読み込みました。`);
}

function openSavedRouteInMaps(routeId) {
  const route = savedRoutes.find(r => r.id === routeId);
  if (!route) return;

  const routeStores = buildSavedRouteStores(route).filter(s => hasCoords(s) || s.address);
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
  saveAll();
  render();
}

function deleteSavedRoute(routeId) {
  const route = savedRoutes.find(r => r.id === routeId);
  if (!route) return;
  if (!confirm(`「${route.name}」を削除しますか？`)) return;

  savedRoutes = savedRoutes.filter(r => r.id !== routeId);
  saveAll();
  render();
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
    const missingCount = Math.max(0, route.storeIds.length - routeStores.length);
    const names = routeStores.slice(0, 5).map(s => escapeHtml(s.name)).join(" / ");

    return `
      <div class="item" style="margin-top:12px; margin-bottom:0;">
        <div class="name" style="font-size:18px; margin-bottom:6px;">
          ${route.favorite ? "⭐ " : ""}${escapeHtml(route.name)}
        </div>

        <div class="mini">
          作成: ${escapeHtml(formatDateTimeText(route.createdAt))}
          ${route.updatedAt ? ` / 更新: ${escapeHtml(formatDateTimeText(route.updatedAt))}` : ""}
        </div>

        <div class="mini mt8">
          店舗数: ${route.storeIds.length}件
          ${missingCount > 0 ? ` / 削除済み店舗あり: ${missingCount}件` : ""}
        </div>

        ${route.note ? `<div class="mini mt8">📝 ${escapeHtml(route.note)}</div>` : ""}

        ${names ? `<div class="mini mt8">📍 ${names}${routeStores.length > 5 ? " / ..." : ""}</div>` : ""}

        <div class="row2 mt8">
          <button ${makeButtonStyle("#e7f0ff", "#2563eb")} onclick="openSavedRoute('${escapeJsString(route.id)}')">今日に読込</button>
          <button ${makeButtonStyle("#dff7e8", "#129b52")} onclick="openSavedRouteInMaps('${escapeJsString(route.id)}')">MAPで開く</button>
        </div>

        <div class="row2 mt8">
          <button ${makeButtonStyle("#fff4d8", "#b7791f")} onclick="toggleFavoriteRoute('${escapeJsString(route.id)}')">${route.favorite ? "★ お気に入り解除" : "☆ お気に入り"}</button>
          <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="editSavedRoute('${escapeJsString(route.id)}')">編集</button>
        </div>

        <div class="row2 mt8">
          <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="deleteSavedRoute('${escapeJsString(route.id)}')">削除</button>
          <div></div>
        </div>
      </div>
    `;
  }).join("");
}

/* =========================
   詳細 / 表示強化
========================= */
function updateLayoutButtons() {
  const detailBtn = document.getElementById("detailLayoutBtn");
  const compactBtn = document.getElementById("compactLayoutBtn");

  if (detailBtn) {
    detailBtn.classList.toggle("activeLayout", currentLayoutMode === "detail");
    if (currentLayoutMode === "detail") {
      detailBtn.classList.remove("ghostBtn");
      detailBtn.classList.add("primaryBtn");
    } else {
      detailBtn.classList.remove("primaryBtn");
      detailBtn.classList.add("ghostBtn");
    }
  }

  if (compactBtn) {
    compactBtn.classList.toggle("activeLayout", currentLayoutMode === "compact");
    if (currentLayoutMode === "compact") {
      compactBtn.classList.remove("ghostBtn");
      compactBtn.classList.add("primaryBtn");
    } else {
      compactBtn.classList.remove("primaryBtn");
      compactBtn.classList.add("ghostBtn");
    }
  }
}

function getRateClass(rate) {
  if (rate >= 70) return "rate-good";
  if (rate >= 30) return "rate-mid";
  if (rate > 0) return "rate-low";
  return "rate-bad";
}

function getExpectedCardClass(expected) {
  if (expected >= 10000) return "expected-high";
  if (expected >= 3000) return "expected-mid";
  return "";
}

function getStaleCardClass(lastVisitDate) {
  const diff = getDaysSinceLastVisit(lastVisitDate);
  if (diff === null) return "";
  if (diff >= 60) return "stale-60";
  if (diff >= 30) return "stale-30";
  return "";
}

function getRecentStats(storeId) {
  const visitLogs = logs
    .filter(l => l.storeId === storeId && l.type === "visit" && l.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const recentVisitLogs = visitLogs.slice(0, 3);
  const recentDates = recentVisitLogs.map(l => l.date);

  const recentVisitCount = recentVisitLogs.reduce((sum, l) => sum + Math.max(1, Number(l.delta || 1)), 0);

  const recentSuccess = logs
    .filter(l =>
      l.storeId === storeId &&
      l.type === "success" &&
      recentDates.includes(l.date) &&
      Number(l.delta || 0) > 0
    )
    .reduce((sum, l) => sum + Number(l.delta || 0), 0);

  const recentRate = recentVisitCount > 0 ? (recentSuccess / recentVisitCount) * 100 : 0;

  return {
    recentVisitCount,
    recentSuccess,
    recentRate
  };
}

function getNoSuccessStreak(storeId) {
  const visitLogs = logs
    .filter(l => l.storeId === storeId && l.type === "visit" && l.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  let streak = 0;

  for (const v of visitLogs) {
    const hasSuccess = logs.some(l =>
      l.storeId === storeId &&
      l.type === "success" &&
      l.date === v.date &&
      Number(l.delta || 0) > 0
    );

    if (hasSuccess) break;
    streak += Math.max(1, Number(v.delta || 1));
  }

  return streak;
}

function getStoreEvaluationLabel(m) {
  const visits = m.visits;
  const expected = m.expected;
  const rate = m.rate;

  if (visits < 3) {
    return { label: "🆕 未評価", class: "eval-new" };
  }

  if (expected >= 3000) {
    return { label: "🔥 行くべき店舗", class: "eval-good" };
  }

  if (rate >= 30) {
    return { label: "⚠️ 様子見店舗", class: "eval-mid" };
  }

  return { label: "❌ スキップ推奨", class: "eval-bad" };
}

/* =========================
   バックアップ
========================= */
function exportBackup() {
  const data = {
    version: 3,
    exportedAt: new Date().toISOString(),
    stores,
    logs,
    savedRoutes,
    todayRouteOrder
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
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
      logs = Array.isArray(parsed.logs) ? parsed.logs : [];
      savedRoutes = Array.isArray(parsed.savedRoutes) ? parsed.savedRoutes.map(normalizeRoute) : [];
      todayRouteOrder = Array.isArray(parsed.todayRouteOrder) ? normalizeTodayRouteOrder(parsed.todayRouteOrder) : [];
      nearbyMode = false;
      noCoordsOnlyMode = false;
      nearbyStoreIds = new Set();

      syncTodayRouteOrder();
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
  logs = Array.isArray(data.logs) ? data.logs : [];
  savedRoutes = Array.isArray(data.savedRoutes) ? data.savedRoutes.map(normalizeRoute) : [];
  todayRouteOrder = Array.isArray(data.todayRouteOrder) ? normalizeTodayRouteOrder(data.todayRouteOrder) : [];
  nearbyMode = false;
  noCoordsOnlyMode = false;
  nearbyStoreIds = new Set();

  syncTodayRouteOrder();
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

  alert(`保存日時: ${data.savedAt || "不明"}\n店舗数: ${data.stores.length}件\nログ数: ${data.logs.length}件\n保存ルート数: ${data.savedRoutes.length}件`);
}

/* =========================
   座標取得
========================= */
async function expandShortUrlIfNeeded(url) {
  try {
    const text = String(url || "").trim();
    if (!text) return text;

    const lower = text.toLowerCase();
    if (
      lower.includes("maps.app.goo.gl") ||
      lower.includes("goo.gl/maps") ||
      lower.includes("g.co/kgs")
    ) {
      const res = await fetch(text, { redirect: "follow", mode: "cors" });
      return res.url || text;
    }

    return text;
  } catch {
    return url;
  }
}

function extractLatLngFromMapUrl(url) {
  const text = String(url || "").trim();
  if (!text) return null;

  let m = text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = text.match(/[?&](?:q|query|destination)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = text.match(/[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = text.match(/[?&]sll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = text.match(/\/search\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = text.match(/\/place\/.*?\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  return null;
}

async function geocodeAddress(pref, address, name) {
  const q = [pref, address, name].filter(Boolean).join(" ").trim();
  if (!q) return null;

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) return null;

    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;

    const lat = Number(data[0].lat);
    const lng = Number(data[0].lon);
    if (isNaN(lat) || isNaN(lng)) return null;

    return { lat, lng };
  } catch {
    return null;
  }
}

async function resolveStoreLatLng(pref, address, name, mapUrl, showFailMessage = true) {
  if (mapUrl) {
    const expanded = await expandShortUrlIfNeeded(mapUrl);
    const fromUrl = extractLatLngFromMapUrl(expanded);
    if (fromUrl) return fromUrl;

    if (showFailMessage) {
      alert("共有URLから座標を取得できませんでした。住所から取得を試します。");
    }
  }

  if (address) {
    const fromAddress = await geocodeAddress(pref, address, name);
    if (fromAddress) return fromAddress;

    if (showFailMessage) {
      alert("住所から座標を取得できませんでした。");
    }
  }

  return { lat: null, lng: null };
}

/* =========================
   店舗CRUD
========================= */
async function addStore() {
  const name = document.getElementById("storeName")?.value?.trim() || "";
  const pref = document.getElementById("prefName")?.value?.trim() || "";
  const address = document.getElementById("address")?.value?.trim() || "";
  const mapUrl = document.getElementById("mapUrl")?.value?.trim() || "";

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

番号を入力してください`,
    "1"
  );

  if (menu === null) return;

  if (menu === "1") {
    const name = prompt("店舗名", s.name || "");
    if (name === null) return;
    s.name = String(name).trim() || s.name;

    const pref = prompt("都道府県", s.pref || "");
    if (pref !== null) s.pref = String(pref).trim();

    const address = prompt("住所", s.address || "");
    if (address !== null) s.address = String(address).trim();

    const mapUrl = prompt("GoogleマップURL", s.mapUrl || "");
    if (mapUrl !== null) s.mapUrl = String(mapUrl).trim();

    const pos = await resolveStoreLatLng(s.pref, s.address, s.name, s.mapUrl, true);
    s.lat = pos.lat;
    s.lng = pos.lng;
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

  saveAll();
  render();
}

function deleteStore(i) {
  const s = stores[i];
  if (!s) return;
  if (!confirm(`「${s.name}」を削除しますか？`)) return;

  stores.splice(i, 1);
  todayRouteOrder = todayRouteOrder.filter(id => id !== s.id);
  saveAll();
  render();
}

function navigateToStore(i) {
  const s = stores[i];
  if (!s) return;

  if (hasCoords(s)) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${s.lat},${s.lng}`)}&travelmode=driving`, "_blank");
    return;
  }

  if (s.address) {
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}`, "_blank");
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

/* =========================
   数値更新
========================= */
function visit(i) {
  const s = stores[i];
  if (!s) return;
  s.visits += 1;
  s.lastVisitDate = tokyoDateStr();
  addLog(s.id, "visit", 1);
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
    const catMap = result.categoryMap && typeof result.categoryMap === "object"
      ? result.categoryMap
      : null;

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

  const history = Object.keys(s.categoryCounts || {}).length
    ? Object.keys(s.categoryCounts || {})
    : getCategoryHistory();

  openQtyCategoryModal({
    history,
    defaultCategory: s.defaultCategory
  }).then(result => {
    if (!result) return;

    const n = clampNonNeg(parseInt(result.qty || "0", 10));
    const catMap = result.categoryMap && typeof result.categoryMap === "object"
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

function profitPlus(i) {
  const s = stores[i];
  if (!s) return;

  const d = clampNonNeg(parseInt(prompt("追加する利益（円）", "1000"), 10));
  if (!d) return;

  s.profit += d;
  addLog(s.id, "profit", d);

  saveAll();
  render();
}

function profitMinus(i) {
  const s = stores[i];
  if (!s) return;

  const d = clampNonNeg(parseInt(prompt("減らす利益（円）", "1000"), 10));
  if (!d) return;

  s.profit = clampNonNeg(s.profit - d);
  addLog(s.id, "profit", -d);

  saveAll();
  render();
}

/* =========================
   今日行く / ルート
========================= */
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
  }

  syncTodayRouteOrder();
  saveAll();
  render();
}

function toggleTodayByStoreId(storeId, checked) {
  const idx = stores.findIndex(s => s.id === storeId);
  if (idx < 0) return;
  toggleToday(idx, checked);
}

function clearTodayChecks() {
  stores.forEach(s => {
    s.today = false;
  });
  todayRouteOrder = [];
  saveAll();
  render();
}

function buildTodayRoute() {
  const routeStores = getTodayRouteStores();

  if (!routeStores.length) {
    alert("「今日行く」にチェックした店舗がありません。");
    return;
  }

  openRouteInGoogleMaps(routeStores);
}

/* =========================
   近くの店舗 / 現在地
========================= */
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
    { enableHighAccuracy: true, timeout: 10000 }
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
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function moveToCurrentLocation() {
  if (!map || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      window.lastPos = { lat, lng };
      map.setView([lat, lng], 15);
      lastListRenderSignature = "";
      lastMapRenderSignature = "";
      render();
    },
    () => alert("現在地を取得できませんでした。")
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

/* =========================
   地図
========================= */
function initMap() {
  if (typeof L === "undefined") return;
  const el = document.getElementById("map");
  if (!el) return;

  map = L.map("map").setView([35.681236, 139.767125], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  mapInitialized = true;
}

function clearMapMarkers() {
  if (!map) return;
  mapMarkers.forEach(m => map.removeLayer(m));
  mapMarkers = [];
}

function getMarkerColor(expected) {
  if (expected >= 10000) return "#ff4d4f";
  if (expected >= 3000) return "#fa8c16";
  if (expected >= 1000) return "#fadb14";
  return "#1677ff";
}

function makeMarkerIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.25);"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

function renderMapMarkersNow() {
  if (!mapInitialized || !map) return;

  const filterValues = getFilterValues();
  const list = buildFilteredStoreList().filter(s => hasCoords(s));
  const signature = JSON.stringify({
    ids: list.map(s => s.id),
    nearbyMode,
    noCoordsOnlyMode,
    q: filterValues.q,
    prefFilter: filterValues.prefFilter,
    minExpected: filterValues.minExpected,
    minRate: filterValues.minRate,
    todayMarks: stores.filter(s => s.today).map(s => s.id)
  });

  if (signature === lastMapRenderSignature) return;
  lastMapRenderSignature = signature;

  clearMapMarkers();

  if (noCoordsOnlyMode || !list.length) return;

  const bounds = [];

  list.forEach(s => {
    const marker = L.marker([s.lat, s.lng], {
      icon: makeMarkerIcon(getMarkerColor(s._m.expected))
    }).addTo(map);

    const navUrl = hasCoords(s)
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${s.lat},${s.lng}`)}&travelmode=driving`
      : (s.address
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}`
          : "");

    marker.bindPopup(`
      <div style="min-width:210px;">
        <div style="font-weight:800; font-size:15px; margin-bottom:4px;">
          ${escapeHtml(s.name)}
        </div>
        <div style="font-size:12px; color:#6b7280; margin-bottom:6px;">
          ${escapeHtml(s.pref || "未設定")}
        </div>
        <div style="font-size:13px; margin-bottom:4px;">
          期待値：${Math.round(s._m.expected).toLocaleString()}円
        </div>
        <div style="font-size:13px; margin-bottom:10px;">
          成功率：${s._m.rate.toFixed(1)}%
        </div>

        <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:700; margin-bottom:10px; cursor:pointer;">
          <input
            type="checkbox"
            ${s.today ? "checked" : ""}
            onchange="toggleTodayByStoreId('${escapeJsString(s.id)}', this.checked)"
          >
          今日行く
        </label>

        ${
          navUrl
            ? `<button
                 type="button"
                 onclick="window.open('${navUrl}','_blank')"
                 style="
                   width:100%;
                   min-height:40px;
                   border:none;
                   border-radius:12px;
                   background:#3976f6;
                   color:#fff;
                   font-size:13px;
                   font-weight:800;
                   cursor:pointer;
                 "
               >ナビ</button>`
            : `<div style="font-size:12px; color:#9ca3af;">住所または座標なし</div>`
        }
      </div>
    `);

    mapMarkers.push(marker);
    bounds.push([s.lat, s.lng]);
  });

  if (bounds.length === 1) {
    map.setView(bounds[0], 15);
  } else {
    map.fitBounds(bounds, { padding: [20, 20] });
  }
}

function scheduleRenderMapMarkers() {
  if (mapRenderRafId) cancelAnimationFrame(mapRenderRafId);
  mapRenderRafId = requestAnimationFrame(() => {
    mapRenderRafId = null;
    renderMapMarkersNow();
  });
}

/* =========================
   表示
========================= */
function buildPrefFilter() {
  const prefs = [...new Set(stores.map(s => s.pref).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
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

function renderCompactStoreCard(s, idx, m, dist, evalData, rateClass, expectedClass, staleClass) {
  const expectedHighClass = m.expected >= 10000 ? "high" : "";
  const compactBadges = [
    `<span class="badge">${escapeHtml(s.pref || "未設定")}</span>`,
    typeof dist === "number" ? `<span class="badge near">📍 ${dist.toFixed(1)}km</span>` : ``,
    s.mapUrl ? `<span class="badge map">🗺 MAPあり</span>` : ``,
    hasCoords(s) ? `<span class="badge" style="background:#eef8ff;color:#2563eb;">📡 座標あり</span>` : ``,
    `<span class="badge freq">補充頻度 ${formatRestockDays(m.freq)}</span>`
  ].filter(Boolean).join("");

  return `
    <div class="item compactCard ${expectedClass} ${staleClass}">
      <div class="evalLabel ${evalData.class}">
        ${evalData.label}
      </div>

      <div class="name">${escapeHtml(s.name)}</div>

      <div style="margin-top:6px;">
        ${compactBadges}
      </div>

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

      <div class="mt8">
        <label style="font-size:15px;">
          <input type="checkbox" ${s.today ? "checked" : ""} onchange="toggleToday(${idx}, this.checked)">
          今日行く
        </label>
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#dff7e8", "#129b52")} onclick="visit(${idx})">訪問＋</button>
        <button ${makeButtonStyle("#e7f0ff", "#2563eb")} onclick="itemsPlus(${idx})">個数＋</button>
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#fff0e1", "#ea580c")} onclick="profitPlus(${idx})">利益＋</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="navigateToStore(${idx})">ナビ</button>
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

      <div style="margin-top:6px;">
        <span class="badge">${escapeHtml(s.pref || "未設定")}</span>
        ${typeof dist === "number" ? `<span class="badge near">📍 ${dist.toFixed(1)}km</span>` : ``}
        ${s.mapUrl ? `<span class="badge map">🗺 MAPあり</span>` : ``}
        ${hasCoords(s) ? `<span class="badge" style="background:#eef8ff;color:#2563eb;">📡 座標あり</span>` : ``}
        <span class="badge freq">補充頻度 ${formatRestockDays(m.freq)}</span>
      </div>

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

      <div class="mt8">
        <label style="font-size:13px;">
          <input type="checkbox" ${s.today ? "checked" : ""} onchange="toggleToday(${idx}, this.checked)">
          今日行く
        </label>
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
        <button ${makeButtonStyle("#fff0e1", "#ea580c")} onclick="profitPlus(${idx})">利益＋</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="profitMinus(${idx})">利益−</button>
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

function showEmptyDataGuide() {
  const list = document.getElementById("storeList");
  if (!list) return;
  if (stores.length > 0) return;

  list.innerHTML = `
    <div class="card">
      <div class="sectionTitle">データが見つかりません</div>
      <div class="mini" style="font-size:14px; line-height:1.7; color:#444;">
        iPhoneでは、Safariとホーム画面アプリで保存領域が分かれることがあります。<br>
        backup.json / sedori-backup-xxxx.json を読み込むと復元できます。
      </div>
      <div class="row2 mt8">
        <button onclick="document.getElementById('backupFile').click()">📥 バックアップ読込</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="restoreAutoBackup()">♻ 自動バックアップ復元</button>
      </div>
    </div>
  `;
}

function renderTodayRouteList() {
  const el = document.getElementById("todayRouteList");
  if (!el) return;

  syncTodayRouteOrder();

  const routeStores = todayRouteOrder
    .map(id => stores.find(s => s.id === id))
    .filter(s => s && s.today);

  if (!routeStores.length) {
    el.innerHTML = "チェックした店舗はまだありません。";
    return;
  }

  el.innerHTML = `
    <div style="font-weight:700; margin-bottom:8px;">今日のルート順</div>
    ${routeStores.map((s, idx) => `
      <div class="item" style="margin-bottom:10px; padding:12px 14px;">
        <div class="name" style="font-size:16px; margin-bottom:6px;">${idx + 1}. ${escapeHtml(s.name)}</div>
        <div class="mini">${escapeHtml(s.pref || "")}${s.address ? ` / ${escapeHtml(s.address)}` : ""}</div>

        <div class="row2 mt8">
          <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="moveTodayRouteItem(${idx}, -1)">↑ 上へ</button>
          <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="moveTodayRouteItem(${idx}, 1)">↓ 下へ</button>
        </div>

        <div class="row2 mt8">
          <button ${makeButtonStyle("#fef2f2", "#dc2626")} onclick="removeTodayRouteItem(${idx})">ルートから外す</button>
          <div></div>
        </div>
      </div>
    `).join("")}
  `;
}

function render() {
  updateLayoutButtons();
  buildPrefFilter();
  syncTodayRouteOrder();

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
    lastVisitDates: stores.map(s => `${s.id}:${s.lastVisitDate}`),
    savedRoutes: savedRoutes.map(r => `${r.id}:${r.updatedAt}:${r.favorite}`).join("|")
  });

  if (signature !== lastListRenderSignature) {
    wrap.innerHTML = list.length
      ? list.map(s => renderStoreCard(s, s._idx)).join("")
      : `<div class="mini">${nearbyMode ? "近くの店舗は見つかりませんでした。" : "該当する店舗がありません。"}</div>`;
    lastListRenderSignature = signature;
  }

  scheduleRenderMapMarkers();
  renderTodayRouteList();
  renderSavedRoutesList();

  if (!stores.length) {
    showEmptyDataGuide();
  }
}

/* =========================
   使い方ガイド
========================= */
let helpStep = 0;

const helpData = [
  {
    title: "📘 このツールでできること",
    content: `
      <b>このツールは、せどり店舗を記録・分析して、行く価値の高い店舗を見つけるための管理ツールです。</b><br><br>
      ・店舗ごとの実績を記録できる<br>
      ・期待値、成功率、利益を自動で見られる<br>
      ・近くの店舗をすぐ探せる<br>
      ・今日行く店舗でルートを作れる<br>
      ・保存したルートを再利用できる<br>
      ・分析画面で月別 / 日別の振り返りができる
    `
  },
  {
    title: "🚀 基本の使い方",
    content: `
      <b>まずはこの流れだけ覚えればOKです。</b><br><br>
      ① 店舗を登録する<br>
      ② 店に行ったら「訪問＋」を押す<br>
      ③ 仕入れできたら「個数＋」を押す<br>
      ④ 利益が分かったら「利益＋」を押す<br><br>
      → これだけで店舗ごとの実績がたまり、自動で分析されます。
    `
  },
  {
    title: "🏪 店舗登録のやり方",
    content: `
      <b>登録時は次の4つを入れます。</b><br><br>
      ・店舗名<br>
      ・都道府県<br>
      ・住所<br>
      ・GoogleマップURL（あれば便利）<br><br>
      ・住所だけでも登録できます<br>
      ・GoogleマップURLがあると座標を取りやすくなります
    `
  },
  {
    title: "🛣 今日のルート機能",
    content: `
      <b>今日行く店舗をまとめてルート化できます。</b><br><br>
      ① 店舗カードの「今日行く」にチェック<br>
      ② 下の今日のルート順に並ぶ<br>
      ③ ↑↓で順番変更<br>
      ④ 「この順番でルート作成」を押す<br><br>
      自動最適化を押すと、近い順ベースに並び替えもできます。
    `
  },
  {
    title: "⭐ 保存済みルート",
    content: `
      <b>よく使うルートを保存できます。</b><br><br>
      ・ルート保存で保存<br>
      ・後から今日のルートに読込可能<br>
      ・お気に入り登録可能<br>
      ・ルート名やメモも変更できます
    `
  },
  {
    title: "📍 近くの店舗機能",
    content: `
      <b>現在地を使って近くの店舗を探せます。</b><br><br>
      ・近くの店舗（3km）で現在地近くを表示<br>
      ・3km以内が無い時は近い順で表示<br>
      ・現在地へ移動で地図を今いる位置へ移動できます
    `
  },
  {
    title: "💾 バックアップ",
    content: `
      <b>バックアップはかなり重要です。</b><br><br>
      ・手動バックアップでJSON保存<br>
      ・バックアップ読込で復元<br>
      ・自動バックアップも保存されます
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

/* =========================
   個数＋カテゴリモーダル
========================= */
function ensureQtyCategoryModal() {
  if (document.getElementById("qtyCategoryModal")) return;

  const modal = document.createElement("div");
  modal.id = "qtyCategoryModal";
  modal.className = "qtyCategoryModal";
  modal.innerHTML = `
    <div class="qtyCategoryCard">
      <div class="qtyCategoryTitle">個数とカテゴリを選択</div>
      <div class="qtyCategorySub">合計個数を決めて、カテゴリごとに個数を調整してください</div>

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

  qtyCategoryCurrentQty = 1;
  qtyCategorySelected = {};

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

  updateQtySelectedValue();
  renderQtyQuickButtons();
  renderQtyCategoryChipState();
  renderQtyCategoryCountEditor();
  updateQtyAssignedSummary();

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

function updateQtySelectedValue() {
  const valueEl = document.getElementById("qtySelectedValue");
  const targetEl = document.getElementById("qtyAssignedTarget");
  if (valueEl) valueEl.textContent = String(qtyCategoryCurrentQty);
  if (targetEl) targetEl.textContent = String(qtyCategoryCurrentQty);
}

function renderQtyQuickButtons() {
  document.querySelectorAll(".qtyQuickBtn").forEach(btn => {
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
    categoryMap: resultMap
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

/* =========================
   ボタン押下エフェクト
========================= */
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
