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

/* =========================
   保存ルート巡回履歴
========================= */
const ROUTE_RUN_HISTORY_KEYS = [
  "route_run_history",
  "sedori_route_run_history_v2",
  "sedori_route_run_history_v1",
  "sedori_route_run_history"
];

const PRIMARY_STORE_KEY = "stores";
const PRIMARY_LOG_KEY = "logs";
const PRIMARY_AUTO_BACKUP_KEY = "auto_backup";
const PRIMARY_ROUTE_KEY = "saved_routes";
const PRIMARY_TODAY_ROUTE_ORDER_KEY = "today_route_order";
const PRIMARY_ROUTE_RUN_HISTORY_KEY = "route_run_history";
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

function normalizeClosedDays(v) {
  const allowed = ["月", "火", "水", "木", "金", "土", "日"];

  if (!Array.isArray(v)) return [];

  return [
    ...new Set(
      v
        .map(x => String(x || "").trim())
        .filter(x => allowed.includes(x))
    )
  ];
}

function normalizeStore(s) {
  return {
    id: String(s?.id || ensureId()),
    name: String(s?.name || "店舗"),
    pref: String(s?.pref || "").trim(),
    address: String(s?.address || "").trim(),
    mapUrl: String(s?.mapUrl || "").trim(),
    openTime: String(s?.openTime || "").trim(),
    closeTime: String(s?.closeTime || "").trim(),
    regularClosedDays: normalizeClosedDays(s?.regularClosedDays),
    memo: String(s?.memo || "").trim(),

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
      s?.categoryCounts &&
      typeof s.categoryCounts === "object" &&
      !Array.isArray(s.categoryCounts)
        ? { ...s.categoryCounts }
        : {},

    lastVisitDate: String(s?.lastVisitDate || "").trim(),
    today: !!s?.today
  };
}

function normalizeRoute(route) {
  return {
    id: String(route?.id || ensureId()),
    name:
      String(route?.name || "保存ルート").trim() ||
      "保存ルート",

    note: String(route?.note || "").trim(),

    createdAt: String(
      route?.createdAt ||
      new Date().toISOString()
    ),

    updatedAt: String(
      route?.updatedAt ||
      route?.createdAt ||
      new Date().toISOString()
    ),

    favorite: !!route?.favorite,

    storeIds: Array.isArray(route?.storeIds)
      ? route.storeIds
          .map(x => String(x || "").trim())
          .filter(Boolean)
      : []
  };
}

function normalizeTodayRouteOrder(v) {
  if (!Array.isArray(v)) return [];

  return v
    .map(x => String(x || "").trim())
    .filter(Boolean);
}

function normalizeLog(x) {
  return {
    id: String(x?.id || ""),
    date: String(x?.date || "").trim(),
    storeId: String(x?.storeId || "").trim(),
    type: String(x?.type || "").trim(),
    delta: Number(x?.delta || 0),
    category: String(x?.category || "").trim(),
    note: String(x?.note || "").trim()
  };
}

/* =========================
   保存ルート巡回履歴の正規化
========================= */
function normalizeRouteRunHistoryItem(item) {
  const nowIso = new Date().toISOString();

  return {
    id: String(item?.id || ensureId()),

    routeId: String(item?.routeId || "").trim(),

    /*
      記録時点のルート名も保存します。
      後から保存ルート名を変更しても、
      過去履歴の元の名称を確認できます。
    */
    routeName:
      String(item?.routeName || "保存ルート").trim() ||
      "保存ルート",

    /*
      巡回対象日
      例: 2026-06-18
    */
    date: String(item?.date || "").slice(0, 10),

    /*
      カレンダーと同じ計算基準
      profit + profit_adjust の合計
    */
    profit: Number(item?.profit || 0),

    /*
      itemsログの合計
    */
    items: Math.max(
      0,
      Number(item?.items || 0)
    ),

    /*
      対象日にvisitログがある店舗の重複なし件数
    */
    visitedStoreCount: Math.max(
      0,
      Number(item?.visitedStoreCount || 0)
    ),

    /*
      対象日にsuccessログがある店舗の重複なし件数
    */
    successStoreCount: Math.max(
      0,
      Number(item?.successStoreCount || 0)
    ),

    /*
      参考用のログ合計回数
      同じ店舗へ複数回訪問した場合も記録できます。
    */
    visitCount: Math.max(
      0,
      Number(
        item?.visitCount ??
        item?.visitedStoreCount ??
        0
      )
    ),

    successCount: Math.max(
      0,
      Number(
        item?.successCount ??
        item?.successStoreCount ??
        0
      )
    ),

    /*
      記録時点で保存ルートに含まれていた店舗
    */
    storeIds: Array.isArray(item?.storeIds)
      ? item.storeIds
          .map(x => String(x || "").trim())
          .filter(Boolean)
      : [],

    /*
      実際に訪問ログがあった店舗
    */
    visitedStoreIds: Array.isArray(item?.visitedStoreIds)
      ? item.visitedStoreIds
          .map(x => String(x || "").trim())
          .filter(Boolean)
      : [],

    /*
      実際に成功ログがあった店舗
    */
    successStoreIds: Array.isArray(item?.successStoreIds)
      ? item.successStoreIds
          .map(x => String(x || "").trim())
          .filter(Boolean)
      : [],

    createdAt: String(
      item?.createdAt ||
      nowIso
    ),

    updatedAt: String(
      item?.updatedAt ||
      item?.createdAt ||
      nowIso
    )
  };
}

function normalizeRouteRunHistory(v) {
  if (!Array.isArray(v)) return [];

  return v
    .map(normalizeRouteRunHistoryItem)
    .filter(item => item.routeId && item.date);
}

/* =========================
   通常データの読込・保存
========================= */
function loadStores() {
  const parsed = readFirstAvailable(STORE_KEYS);

  if (!Array.isArray(parsed)) return [];

  return parsed.map(normalizeStore);
}

function saveStores(v) {
  localStorage.setItem(
    PRIMARY_STORE_KEY,
    JSON.stringify(
      Array.isArray(v) ? v : []
    )
  );
}

function loadLogs() {
  const parsed = readFirstAvailable(LOG_KEYS);

  if (!Array.isArray(parsed)) return [];

  return parsed.map(normalizeLog);
}

function saveLogs(v) {
  localStorage.setItem(
    PRIMARY_LOG_KEY,
    JSON.stringify(
      Array.isArray(v) ? v : []
    )
  );
}

function loadSavedRoutes() {
  const parsed = readFirstAvailable(ROUTE_KEYS);

  if (!Array.isArray(parsed)) return [];

  return parsed.map(normalizeRoute);
}

function saveRoutes(v) {
  localStorage.setItem(
    PRIMARY_ROUTE_KEY,
    JSON.stringify(
      Array.isArray(v) ? v : []
    )
  );
}

function loadTodayRouteOrder() {
  const parsed = readFirstAvailable(
    TODAY_ROUTE_ORDER_KEYS
  );

  return normalizeTodayRouteOrder(parsed);
}

function saveTodayRouteOrder(v) {
  localStorage.setItem(
    PRIMARY_TODAY_ROUTE_ORDER_KEY,
    JSON.stringify(
      normalizeTodayRouteOrder(v)
    )
  );
}

/* =========================
   保存ルート巡回履歴の読込・保存
========================= */
function loadRouteRunHistory() {
  const parsed = readFirstAvailable(
    ROUTE_RUN_HISTORY_KEYS
  );

  return normalizeRouteRunHistory(parsed);
}

function saveRouteRunHistory(v) {
  const normalized = normalizeRouteRunHistory(v);

  localStorage.setItem(
    PRIMARY_ROUTE_RUN_HISTORY_KEY,
    JSON.stringify(normalized)
  );
}

/*
  app.jsを更新する前でもstorage.js単体で
  エラーにならないための安全取得です。
*/
function getCurrentRouteRunHistoryForStorage() {
  try {
    if (
      typeof routeRunHistory !== "undefined" &&
      Array.isArray(routeRunHistory)
    ) {
      return normalizeRouteRunHistory(
        routeRunHistory
      );
    }
  } catch (e) {
    console.error(
      "routeRunHistory reference error:",
      e
    );
  }

  return loadRouteRunHistory();
}

/* =========================
   自動バックアップ
========================= */
function saveAutoBackup() {
  try {
    localStorage.setItem(
      PRIMARY_AUTO_BACKUP_KEY,
      JSON.stringify({
        version: 4,
        savedAt: new Date().toISOString(),
        stores:
          typeof stores !== "undefined" &&
          Array.isArray(stores)
            ? stores
            : loadStores(),

        logs:
          typeof logs !== "undefined" &&
          Array.isArray(logs)
            ? logs
            : loadLogs(),

        savedRoutes:
          typeof savedRoutes !== "undefined" &&
          Array.isArray(savedRoutes)
            ? savedRoutes
            : loadSavedRoutes(),

        todayRouteOrder:
          typeof todayRouteOrder !== "undefined" &&
          Array.isArray(todayRouteOrder)
            ? todayRouteOrder
            : loadTodayRouteOrder(),

        routeRunHistory:
          getCurrentRouteRunHistoryForStorage()
      })
    );
  } catch (e) {
    console.error(
      "saveAutoBackup error:",
      e
    );
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
        version: Number(parsed.version || 1),
        savedAt: String(parsed.savedAt || ""),

        stores: Array.isArray(parsed.stores)
          ? parsed.stores.map(normalizeStore)
          : [],

        logs: Array.isArray(parsed.logs)
          ? parsed.logs.map(normalizeLog)
          : [],

        savedRoutes: Array.isArray(parsed.savedRoutes)
          ? parsed.savedRoutes.map(normalizeRoute)
          : [],

        todayRouteOrder: Array.isArray(parsed.todayRouteOrder)
          ? normalizeTodayRouteOrder(
              parsed.todayRouteOrder
            )
          : [],

        /*
          旧バックアップには存在しないため、
          なければ空配列として安全に復元します。
        */
        routeRunHistory:
          Array.isArray(parsed.routeRunHistory)
            ? normalizeRouteRunHistory(
                parsed.routeRunHistory
              )
            : []
      };
    } catch (e) {
      console.error(
        "backup read error:",
        key,
        e
      );
    }
  }

  return null;
}

/* =========================
   キャッシュ無効化
========================= */
function invalidateDerivedCaches() {
  if (
    typeof categoryHistoryDirty !==
    "undefined"
  ) {
    categoryHistoryDirty = true;
  }

  if (
    typeof lastListRenderSignature !==
    "undefined"
  ) {
    lastListRenderSignature = "";
  }

  if (
    typeof lastMapRenderSignature !==
    "undefined"
  ) {
    lastMapRenderSignature = "";
  }
}

/* =========================
   全データ保存
========================= */
function saveAll() {
  if (
    typeof stores !== "undefined" &&
    Array.isArray(stores)
  ) {
    saveStores(stores);
  }

  if (
    typeof logs !== "undefined" &&
    Array.isArray(logs)
  ) {
    saveLogs(logs);
  }

  if (
    typeof savedRoutes !== "undefined" &&
    Array.isArray(savedRoutes)
  ) {
    saveRoutes(savedRoutes);
  }

  if (
    typeof todayRouteOrder !== "undefined" &&
    Array.isArray(todayRouteOrder)
  ) {
    saveTodayRouteOrder(
      todayRouteOrder
    );
  }

  saveRouteRunHistory(
    getCurrentRouteRunHistoryForStorage()
  );

  saveAutoBackup();
  invalidateDerivedCaches();
}
