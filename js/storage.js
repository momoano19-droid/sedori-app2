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

function normalizeStore(s) {
  return {
    id: String(s?.id || ensureId()),
    name: String(s?.name || "店舗"),
    pref: String(s?.pref || "").trim(),
    address: String(s?.address || "").trim(),
    mapUrl: String(s?.mapUrl || "").trim(),
    lat:
      s?.lat !== null &&
      s?.lat !== "" &&
      !isNaN(Number(s?.lat))
        ? Number(s.lat)
        : null,
    lng:
      s?.lng !== null &&
      s?.lng !== "" &&
      !isNaN(Number(s?.lng))
        ? Number(s.lng)
        : null,
    visits: Number(s?.visits || 0),
    buyDays: Number(s?.buyDays || 0),
    items: Number(s?.items || 0),
    profit: Number(s?.profit || 0),
    defaultCategory: String(s?.defaultCategory || "").trim(),
    categoryCounts:
      s?.categoryCounts && typeof s.categoryCounts === "object"
        ? { ...s.categoryCounts }
        : {},
    lastVisitDate: String(s?.lastVisitDate || "").trim(),
    today: !!s?.today
  };
}

function normalizeRoute(route) {
  return {
    id: String(route?.id || ensureId()),
    name: String(route?.name || "保存ルート").trim() || "保存ルート",
    note: String(route?.note || "").trim(),
    createdAt: String(route?.createdAt || new Date().toISOString()),
    updatedAt: String(
      route?.updatedAt || route?.createdAt || new Date().toISOString()
    ),
    favorite: !!route?.favorite,
    storeIds: Array.isArray(route?.storeIds)
      ? route.storeIds.map(x => String(x))
      : []
  };
}

function normalizeTodayRouteOrder(v) {
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x)).filter(Boolean);
}

function normalizeLog(x) {
  return {
    date: String(x?.date || "").trim(),
    storeId: String(x?.storeId || "").trim(),
    type: String(x?.type || "").trim(),
    delta: Number(x?.delta || 0),
    category: String(x?.category || "").trim()
  };
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
  return parsed.map(normalizeLog);
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
  localStorage.setItem(
    PRIMARY_TODAY_ROUTE_ORDER_KEY,
    JSON.stringify(normalizeTodayRouteOrder(v))
  );
}

function saveAutoBackup() {
  try {
    localStorage.setItem(
      PRIMARY_AUTO_BACKUP_KEY,
      JSON.stringify({
        savedAt: new Date().toISOString(),
        stores,
        logs,
        savedRoutes,
        todayRouteOrder
      })
    );
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
        todayRouteOrder: Array.isArray(parsed.todayRouteOrder)
          ? parsed.todayRouteOrder
          : []
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
