const BADGE_ROUTE_COMPLETE_KEY = "badge_route_complete_count";
const BADGE_UNLOCKED_HISTORY_KEY = "badge_unlocked_history_v1";

function makeStatBadge({
  id,
  icon,
  name,
  category,
  tier,
  period,
  description,
  statKey,
  target
}) {
  return {
    id,
    icon,
    name,
    category,
    tier,
    period,
    description,
    condition: stats => badgeSafeNumber(stats?.[statKey]) >= target,
    progress: stats => badgeSafeNumber(stats?.[statKey]),
    target
  };
}

const BADGE_DEFINITIONS = [
  // =========================
  // 累計実績 / 初級（6個）
  // =========================
  makeStatBadge({
    id: "all_visit_1",
    icon: "👣",
    name: "はじめの一歩",
    category: "visit",
    tier: "初級",
    period: "all",
    description: "累計訪問1回達成",
    statKey: "totalVisits",
    target: 1
  }),
  makeStatBadge({
    id: "all_visit_10",
    icon: "👣",
    name: "巡回スタート",
    category: "visit",
    tier: "初級",
    period: "all",
    description: "累計訪問10回達成",
    statKey: "totalVisits",
    target: 10
  }),
  makeStatBadge({
    id: "all_success_1",
    icon: "🎯",
    name: "初仕入れ",
    category: "success",
    tier: "初級",
    period: "all",
    description: "累計成功1回達成",
    statKey: "totalSuccess",
    target: 1
  }),
  makeStatBadge({
    id: "all_profit_10k",
    icon: "💰",
    name: "初利益達成",
    category: "profit",
    tier: "初級",
    period: "all",
    description: "累計利益1万円達成",
    statKey: "totalProfit",
    target: 10000
  }),
  makeStatBadge({
    id: "all_items_10",
    icon: "📦",
    name: "収集家",
    category: "items",
    tier: "初級",
    period: "all",
    description: "累計個数10個達成",
    statKey: "totalItems",
    target: 10
  }),
  makeStatBadge({
    id: "all_route_1",
    icon: "🗺",
    name: "ルート初制覇",
    category: "route",
    tier: "初級",
    period: "all",
    description: "累計ルート制覇1回達成",
    statKey: "completedRouteCount",
    target: 1
  }),

  // =========================
  // 累計実績 / 中級（6個）
  // =========================
  makeStatBadge({
    id: "all_visit_50",
    icon: "👣",
    name: "巡回職人",
    category: "visit",
    tier: "中級",
    period: "all",
    description: "累計訪問50回達成",
    statKey: "totalVisits",
    target: 50
  }),
  makeStatBadge({
    id: "all_success_30",
    icon: "🎯",
    name: "仕入れ名人",
    category: "success",
    tier: "中級",
    period: "all",
    description: "累計成功30回達成",
    statKey: "totalSuccess",
    target: 30
  }),
  makeStatBadge({
    id: "all_profit_500k",
    icon: "💰",
    name: "利益エース",
    category: "profit",
    tier: "中級",
    period: "all",
    description: "累計利益50万円達成",
    statKey: "totalProfit",
    target: 500000
  }),
  makeStatBadge({
    id: "all_items_100",
    icon: "📦",
    name: "在庫マスター",
    category: "items",
    tier: "中級",
    period: "all",
    description: "累計個数100個達成",
    statKey: "totalItems",
    target: 100
  }),
  makeStatBadge({
    id: "all_high_expected_3",
    icon: "🏪",
    name: "優良店舗ハンター",
    category: "store",
    tier: "中級",
    period: "all",
    description: "期待値3000円以上の店舗を3件作成",
    statKey: "highExpectedStoreCount",
    target: 3
  }),
  makeStatBadge({
    id: "all_route_5",
    icon: "🗺",
    name: "ルートマスター",
    category: "route",
    tier: "中級",
    period: "all",
    description: "累計ルート制覇5回達成",
    statKey: "completedRouteCount",
    target: 5
  }),

  // =========================
  // 累計実績 / 上級（6個）
  // =========================
  makeStatBadge({
    id: "all_visit_200",
    icon: "👣",
    name: "巡回ベテラン",
    category: "visit",
    tier: "上級",
    period: "all",
    description: "累計訪問200回達成",
    statKey: "totalVisits",
    target: 200
  }),
  makeStatBadge({
    id: "all_success_100",
    icon: "🎯",
    name: "仕入れ達人",
    category: "success",
    tier: "上級",
    period: "all",
    description: "累計成功100回達成",
    statKey: "totalSuccess",
    target: 100
  }),
  makeStatBadge({
    id: "all_profit_3000k",
    icon: "💰",
    name: "利益王への道",
    category: "profit",
    tier: "上級",
    period: "all",
    description: "累計利益300万円達成",
    statKey: "totalProfit",
    target: 3000000
  }),
  makeStatBadge({
    id: "all_items_300",
    icon: "📦",
    name: "在庫キング",
    category: "items",
    tier: "上級",
    period: "all",
    description: "累計個数300個達成",
    statKey: "totalItems",
    target: 300
  }),
  makeStatBadge({
    id: "all_high_expected_5",
    icon: "🏪",
    name: "高期待値コレクター",
    category: "store",
    tier: "上級",
    period: "all",
    description: "期待値3000円以上の店舗を5件作成",
    statKey: "highExpectedStoreCount",
    target: 5
  }),
  makeStatBadge({
    id: "all_route_20",
    icon: "🗺",
    name: "ルート覇者",
    category: "route",
    tier: "上級",
    period: "all",
    description: "累計ルート制覇20回達成",
    statKey: "completedRouteCount",
    target: 20
  }),

  // =========================
  // 月間実績 / 初級（6個）
  // =========================
  makeStatBadge({
    id: "month_visit_1",
    icon: "📅",
    name: "今月の一歩",
    category: "visit",
    tier: "初級",
    period: "month",
    description: "今月の訪問1回達成",
    statKey: "monthVisits",
    target: 1
  }),
  makeStatBadge({
    id: "month_success_1",
    icon: "📅",
    name: "今月初成功",
    category: "success",
    tier: "初級",
    period: "month",
    description: "今月の成功1回達成",
    statKey: "monthSuccess",
    target: 1
  }),
  makeStatBadge({
    id: "month_profit_10k",
    icon: "📅",
    name: "今月利益1万",
    category: "profit",
    tier: "初級",
    period: "month",
    description: "今月の利益1万円達成",
    statKey: "monthProfit",
    target: 10000
  }),
  makeStatBadge({
    id: "month_items_10",
    icon: "📅",
    name: "今月10個達成",
    category: "items",
    tier: "初級",
    period: "month",
    description: "今月の個数10個達成",
    statKey: "monthItems",
    target: 10
  }),
  makeStatBadge({
    id: "month_high_expected_1",
    icon: "📅",
    name: "今月高期待値1",
    category: "store",
    tier: "初級",
    period: "month",
    description: "今月の期待値3000円以上店舗を1件作成",
    statKey: "monthHighExpectedStoreCount",
    target: 1
  }),
  makeStatBadge({
    id: "month_route_1",
    icon: "📅",
    name: "今月ルート1",
    category: "route",
    tier: "初級",
    period: "month",
    description: "今月のルート制覇1回達成",
    statKey: "monthCompletedRouteCount",
    target: 1
  }),

  // =========================
  // 月間実績 / 中級（6個）
  // =========================
  makeStatBadge({
    id: "month_visit_30",
    icon: "📅",
    name: "今月巡回30",
    category: "visit",
    tier: "中級",
    period: "month",
    description: "今月の訪問30回達成",
    statKey: "monthVisits",
    target: 30
  }),
  makeStatBadge({
    id: "month_success_10",
    icon: "📅",
    name: "今月成功10",
    category: "success",
    tier: "中級",
    period: "month",
    description: "今月の成功10回達成",
    statKey: "monthSuccess",
    target: 10
  }),
  makeStatBadge({
    id: "month_profit_100k",
    icon: "📅",
    name: "今月利益10万",
    category: "profit",
    tier: "中級",
    period: "month",
    description: "今月の利益10万円達成",
    statKey: "monthProfit",
    target: 100000
  }),
  makeStatBadge({
    id: "month_items_30",
    icon: "📅",
    name: "今月30個達成",
    category: "items",
    tier: "中級",
    period: "month",
    description: "今月の個数30個達成",
    statKey: "monthItems",
    target: 30
  }),
  makeStatBadge({
    id: "month_high_expected_3",
    icon: "📅",
    name: "今月高期待値3",
    category: "store",
    tier: "中級",
    period: "month",
    description: "今月の期待値3000円以上店舗を3件作成",
    statKey: "monthHighExpectedStoreCount",
    target: 3
  }),
  makeStatBadge({
    id: "month_route_3",
    icon: "📅",
    name: "今月ルート3",
    category: "route",
    tier: "中級",
    period: "month",
    description: "今月のルート制覇3回達成",
    statKey: "monthCompletedRouteCount",
    target: 3
  }),

  // =========================
  // 月間実績 / 上級（6個）
  // =========================
  makeStatBadge({
    id: "month_visit_100",
    icon: "📅",
    name: "今月巡回100",
    category: "visit",
    tier: "上級",
    period: "month",
    description: "今月の訪問100回達成",
    statKey: "monthVisits",
    target: 100
  }),
  makeStatBadge({
    id: "month_success_50",
    icon: "📅",
    name: "今月成功50",
    category: "success",
    tier: "上級",
    period: "month",
    description: "今月の成功50回達成",
    statKey: "monthSuccess",
    target: 50
  }),
  makeStatBadge({
    id: "month_profit_500k",
    icon: "📅",
    name: "今月利益50万",
    category: "profit",
    tier: "上級",
    period: "month",
    description: "今月の利益50万円達成",
    statKey: "monthProfit",
    target: 500000
  }),
  makeStatBadge({
    id: "month_items_150",
    icon: "📅",
    name: "今月150個達成",
    category: "items",
    tier: "上級",
    period: "month",
    description: "今月の個数150個達成",
    statKey: "monthItems",
    target: 150
  }),
  makeStatBadge({
    id: "month_high_expected_5",
    icon: "📅",
    name: "今月高期待値5",
    category: "store",
    tier: "上級",
    period: "month",
    description: "今月の期待値3000円以上店舗を5件作成",
    statKey: "monthHighExpectedStoreCount",
    target: 5
  }),
  makeStatBadge({
    id: "month_route_10",
    icon: "📅",
    name: "今月ルート10",
    category: "route",
    tier: "上級",
    period: "month",
    description: "今月のルート制覇10回達成",
    statKey: "monthCompletedRouteCount",
    target: 10
  }),

  // =========================
  // 年間実績 / 初級（6個）
  // =========================
  makeStatBadge({
    id: "year_visit_10",
    icon: "🎍",
    name: "今年巡回10",
    category: "visit",
    tier: "初級",
    period: "year",
    description: "今年の訪問10回達成",
    statKey: "yearVisits",
    target: 10
  }),
  makeStatBadge({
    id: "year_success_10",
    icon: "🎍",
    name: "今年成功10",
    category: "success",
    tier: "初級",
    period: "year",
    description: "今年の成功10回達成",
    statKey: "yearSuccess",
    target: 10
  }),
  makeStatBadge({
    id: "year_profit_100k",
    icon: "🎍",
    name: "年間利益10万",
    category: "profit",
    tier: "初級",
    period: "year",
    description: "今年の利益10万円達成",
    statKey: "yearProfit",
    target: 100000
  }),
  makeStatBadge({
    id: "year_items_30",
    icon: "🎍",
    name: "年間30個達成",
    category: "items",
    tier: "初級",
    period: "year",
    description: "今年の個数30個達成",
    statKey: "yearItems",
    target: 30
  }),
  makeStatBadge({
    id: "year_high_expected_1",
    icon: "🎍",
    name: "年間高期待値1",
    category: "store",
    tier: "初級",
    period: "year",
    description: "今年の期待値3000円以上店舗を1件作成",
    statKey: "yearHighExpectedStoreCount",
    target: 1
  }),
  makeStatBadge({
    id: "year_route_3",
    icon: "🎍",
    name: "年間ルート3",
    category: "route",
    tier: "初級",
    period: "year",
    description: "今年のルート制覇3回達成",
    statKey: "yearCompletedRouteCount",
    target: 3
  }),

  // =========================
  // 年間実績 / 中級（6個）
  // =========================
  makeStatBadge({
    id: "year_visit_100",
    icon: "🎍",
    name: "今年巡回100",
    category: "visit",
    tier: "中級",
    period: "year",
    description: "今年の訪問100回達成",
    statKey: "yearVisits",
    target: 100
  }),
  makeStatBadge({
    id: "year_success_50",
    icon: "🎍",
    name: "今年成功50",
    category: "success",
    tier: "中級",
    period: "year",
    description: "今年の成功50回達成",
    statKey: "yearSuccess",
    target: 50
  }),
  makeStatBadge({
    id: "year_profit_1000k",
    icon: "🎍",
    name: "年間利益100万",
    category: "profit",
    tier: "中級",
    period: "year",
    description: "今年の利益100万円達成",
    statKey: "yearProfit",
    target: 1000000
  }),
  makeStatBadge({
    id: "year_items_200",
    icon: "🎍",
    name: "年間200個達成",
    category: "items",
    tier: "中級",
    period: "year",
    description: "今年の個数200個達成",
    statKey: "yearItems",
    target: 200
  }),
  makeStatBadge({
    id: "year_high_expected_3",
    icon: "🎍",
    name: "年間高期待値3",
    category: "store",
    tier: "中級",
    period: "year",
    description: "今年の期待値3000円以上店舗を3件作成",
    statKey: "yearHighExpectedStoreCount",
    target: 3
  }),
  makeStatBadge({
    id: "year_route_10",
    icon: "🎍",
    name: "年間ルート10",
    category: "route",
    tier: "中級",
    period: "year",
    description: "今年のルート制覇10回達成",
    statKey: "yearCompletedRouteCount",
    target: 10
  }),

  // =========================
  // 年間実績 / 上級（6個）
  // =========================
  makeStatBadge({
    id: "year_visit_500",
    icon: "🎍",
    name: "今年巡回500",
    category: "visit",
    tier: "上級",
    period: "year",
    description: "今年の訪問500回達成",
    statKey: "yearVisits",
    target: 500
  }),
  makeStatBadge({
    id: "year_success_200",
    icon: "🎍",
    name: "今年成功200",
    category: "success",
    tier: "上級",
    period: "year",
    description: "今年の成功200回達成",
    statKey: "yearSuccess",
    target: 200
  }),
  makeStatBadge({
    id: "year_profit_3000k",
    icon: "🎍",
    name: "年間利益300万",
    category: "profit",
    tier: "上級",
    period: "year",
    description: "今年の利益300万円達成",
    statKey: "yearProfit",
    target: 3000000
  }),
  makeStatBadge({
    id: "year_items_500",
    icon: "🎍",
    name: "年間500個達成",
    category: "items",
    tier: "上級",
    period: "year",
    description: "今年の個数500個達成",
    statKey: "yearItems",
    target: 500
  }),
  makeStatBadge({
    id: "year_high_expected_5",
    icon: "🎍",
    name: "年間高期待値5",
    category: "store",
    tier: "上級",
    period: "year",
    description: "今年の期待値3000円以上店舗を5件作成",
    statKey: "yearHighExpectedStoreCount",
    target: 5
  }),
  makeStatBadge({
    id: "year_route_20",
    icon: "🎍",
    name: "年間ルート20",
    category: "route",
    tier: "上級",
    period: "year",
    description: "今年のルート制覇20回達成",
    statKey: "yearCompletedRouteCount",
    target: 20
  })
];

function loadBadgeRoutePeriodCount(periodKey, fallback = "0") {
  try {
    return Number(localStorage.getItem(periodKey) || fallback);
  } catch {
    return Number(fallback || 0);
  }
}

function getBadgeRouteMonthKey(monthStr) {
  return `badge_route_complete_count_month_${monthStr}`;
}

function getBadgeRouteYearKey(yearStr) {
  return `badge_route_complete_count_year_${yearStr}`;
}

function loadBadgeRouteCompleteCount() {
  return loadBadgeRoutePeriodCount(BADGE_ROUTE_COMPLETE_KEY, "0");
}

function saveBadgeRouteCompleteCount(count) {
  localStorage.setItem(BADGE_ROUTE_COMPLETE_KEY, String(Number(count || 0)));
}

function loadBadgeUnlockedHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(BADGE_UNLOCKED_HISTORY_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveBadgeUnlockedHistory(list) {
  localStorage.setItem(BADGE_UNLOCKED_HISTORY_KEY, JSON.stringify(list));
}

function getBadgeStores() {
  try {
    if (typeof stores !== "undefined" && Array.isArray(stores)) return stores;
  } catch {}
  try {
    if (Array.isArray(window.stores)) return window.stores;
  } catch {}
  try {
    if (typeof loadStores === "function") return loadStores();
  } catch {}
  return [];
}

function getBadgeLogs() {
  try {
    if (typeof logs !== "undefined" && Array.isArray(logs)) return logs;
  } catch {}
  try {
    if (Array.isArray(window.logs)) return window.logs;
  } catch {}
  try {
    if (typeof loadLogs === "function") return loadLogs();
  } catch {}
  return [];
}

function badgeSafeNumber(n) {
  return Number(n || 0);
}

function getBadgeMetricsForStore(store) {
  const visits = badgeSafeNumber(store?.visits);
  const success = badgeSafeNumber(store?.buyDays);
  const profit = badgeSafeNumber(store?.profit);

  return {
    visits,
    success,
    profit,
    expected: visits > 0 ? profit / visits : 0,
    rate: visits > 0 ? (success / visits) * 100 : 0
  };
}

function getEmptyStorePeriodMetric() {
  return {
    visits: 0,
    success: 0,
    items: 0,
    profit: 0
  };
}

function ensureStoreMetric(map, storeId) {
  if (!storeId) return null;
  if (!map[storeId]) {
    map[storeId] = getEmptyStorePeriodMetric();
  }
  return map[storeId];
}

function calcPeriodStoreCounts(metricMap) {
  const metrics = Object.values(metricMap || {});
  const highExpectedStoreCount = metrics.filter(m => {
    const expected = m.visits > 0 ? m.profit / m.visits : 0;
    return expected >= 3000;
  }).length;

  const stableStoreCount = metrics.filter(m => {
    const rate = m.visits > 0 ? (m.success / m.visits) * 100 : 0;
    return m.visits > 0 && rate >= 30;
  }).length;

  return {
    highExpectedStoreCount,
    stableStoreCount
  };
}

function getBadgeStats() {
  const storesList = getBadgeStores();
  const logsList = getBadgeLogs();

  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const currentYear = now.toISOString().slice(0, 4);

  let totalVisits = 0;
  let totalSuccess = 0;
  let totalItems = 0;
  let totalProfit = 0;

  let monthVisits = 0;
  let monthSuccess = 0;
  let monthItems = 0;
  let monthProfit = 0;

  let yearVisits = 0;
  let yearSuccess = 0;
  let yearItems = 0;
  let yearProfit = 0;

  const monthStoreMetricMap = {};
  const yearStoreMetricMap = {};

  logsList.forEach(log => {
    const delta = badgeSafeNumber(log?.delta);
    const dateStr = String(log?.date || log?.createdAt || "");
    const logMonth = dateStr.slice(0, 7);
    const logYear = dateStr.slice(0, 4);
    const storeId = String(log?.storeId || "");

    if (log?.type === "visit") {
      totalVisits += delta;
      if (logMonth === currentMonth) {
        monthVisits += delta;
        const m = ensureStoreMetric(monthStoreMetricMap, storeId);
        if (m) m.visits += delta;
      }
      if (logYear === currentYear) {
        yearVisits += delta;
        const y = ensureStoreMetric(yearStoreMetricMap, storeId);
        if (y) y.visits += delta;
      }
    }

    if (log?.type === "success") {
      totalSuccess += delta;
      if (logMonth === currentMonth) {
        monthSuccess += delta;
        const m = ensureStoreMetric(monthStoreMetricMap, storeId);
        if (m) m.success += delta;
      }
      if (logYear === currentYear) {
        yearSuccess += delta;
        const y = ensureStoreMetric(yearStoreMetricMap, storeId);
        if (y) y.success += delta;
      }
    }

    if (log?.type === "items") {
      totalItems += delta;
      if (logMonth === currentMonth) {
        monthItems += delta;
        const m = ensureStoreMetric(monthStoreMetricMap, storeId);
        if (m) m.items += delta;
      }
      if (logYear === currentYear) {
        yearItems += delta;
        const y = ensureStoreMetric(yearStoreMetricMap, storeId);
        if (y) y.items += delta;
      }
    }

    if (log?.type === "profit") {
      totalProfit += delta;
      if (logMonth === currentMonth) {
        monthProfit += delta;
        const m = ensureStoreMetric(monthStoreMetricMap, storeId);
        if (m) m.profit += delta;
      }
      if (logYear === currentYear) {
        yearProfit += delta;
        const y = ensureStoreMetric(yearStoreMetricMap, storeId);
        if (y) y.profit += delta;
      }
    }
  });

  totalVisits = Math.max(0, totalVisits);
  totalSuccess = Math.max(0, totalSuccess);
  totalItems = Math.max(0, totalItems);

  monthVisits = Math.max(0, monthVisits);
  monthSuccess = Math.max(0, monthSuccess);
  monthItems = Math.max(0, monthItems);

  yearVisits = Math.max(0, yearVisits);
  yearSuccess = Math.max(0, yearSuccess);
  yearItems = Math.max(0, yearItems);

  const highExpectedStoreCount = storesList.filter(store => {
    const m = getBadgeMetricsForStore(store);
    return m.expected >= 3000;
  }).length;

  const stableStoreCount = storesList.filter(store => {
    const m = getBadgeMetricsForStore(store);
    return m.visits > 0 && m.rate >= 30;
  }).length;

  const monthStoreCounts = calcPeriodStoreCounts(monthStoreMetricMap);
  const yearStoreCounts = calcPeriodStoreCounts(yearStoreMetricMap);

  const completedRouteCount = loadBadgeRouteCompleteCount();
  const monthCompletedRouteCount = loadBadgeRoutePeriodCount(
    getBadgeRouteMonthKey(currentMonth),
    "0"
  );
  const yearCompletedRouteCount = loadBadgeRoutePeriodCount(
    getBadgeRouteYearKey(currentYear),
    "0"
  );

  return {
    totalVisits,
    totalSuccess,
    totalItems,
    totalProfit,

    monthVisits,
    monthSuccess,
    monthItems,
    monthProfit,

    yearVisits,
    yearSuccess,
    yearItems,
    yearProfit,

    highExpectedStoreCount,
    stableStoreCount,
    monthHighExpectedStoreCount: monthStoreCounts.highExpectedStoreCount,
    monthStableStoreCount: monthStoreCounts.stableStoreCount,
    yearHighExpectedStoreCount: yearStoreCounts.highExpectedStoreCount,
    yearStableStoreCount: yearStoreCounts.stableStoreCount,

    completedRouteCount,
    monthCompletedRouteCount,
    yearCompletedRouteCount,
    totalStoreCount: storesList.length,

    currentMonth,
    currentYear
  };
}

function getUnlockedBadges() {
  const stats = getBadgeStats();

  return BADGE_DEFINITIONS
    .filter(badge => {
      try {
        return !!badge.condition(stats);
      } catch {
        return false;
      }
    })
    .map(badge => ({
      ...badge,
      current: badgeSafeNumber(badge.progress?.(stats))
    }));
}

function getLockedBadges() {
  const stats = getBadgeStats();

  return BADGE_DEFINITIONS
    .filter(badge => {
      try {
        return !badge.condition(stats);
      } catch {
        return true;
      }
    })
    .map(badge => ({
      ...badge,
      current: badgeSafeNumber(badge.progress?.(stats))
    }));
}

function getBadgeProgressText(badge, current = 0) {
  if (!badge || !badge.target) return "";
  const cur = Math.max(0, badgeSafeNumber(current));
  const remain = Math.max(0, badge.target - cur);

  let suffix = "";
  if (badge.period === "month") suffix = "（今月）";
  if (badge.period === "year") suffix = "（今年）";

  if (badge.category === "profit") return `あと${remain.toLocaleString()}円${suffix}`;
  if (badge.category === "store" || badge.category === "route") return `あと${remain}件${suffix}`;
  return `あと${remain}回${suffix}`;
}

function getNextBadge() {
  const locked = getLockedBadges();
  if (!locked.length) return null;

  const ranked = locked
    .map(badge => {
      const target = Math.max(1, badgeSafeNumber(badge.target));
      const current = Math.max(0, badgeSafeNumber(badge.current));
      return {
        ...badge,
        ratio: current / target,
        remain: Math.max(0, target - current)
      };
    })
    .sort((a, b) => {
      if (b.ratio !== a.ratio) return b.ratio - a.ratio;
      if (a.remain !== b.remain) return a.remain - b.remain;
      return badgeSafeNumber(a.target) - badgeSafeNumber(b.target);
    });

  return ranked[0];
}

function getBadgeHistoryMap() {
  const history = loadBadgeUnlockedHistory();
  const map = {};
  history.forEach(item => {
    if (item?.id) map[item.id] = item.unlockedAt || "";
  });
  return map;
}

function syncUnlockedBadgeHistory() {
  const unlocked = getUnlockedBadges();
  const history = loadBadgeUnlockedHistory();
  const existingMap = {};

  history.forEach(item => {
    if (item?.id) existingMap[item.id] = item;
  });

  let changed = false;

  unlocked.forEach(badge => {
    if (!existingMap[badge.id]) {
      existingMap[badge.id] = {
        id: badge.id,
        unlockedAt: new Date().toISOString()
      };
      changed = true;
    }
  });

  const nextList = Object.values(existingMap).sort((a, b) =>
    String(a.unlockedAt || "").localeCompare(String(b.unlockedAt || ""))
  );

  if (changed) {
    saveBadgeUnlockedHistory(nextList);
  }

  return nextList;
}

function getLatestUnlockedBadge() {
  const history = syncUnlockedBadgeHistory();
  if (!history.length) return null;

  const latest = [...history].sort((a, b) =>
    String(b.unlockedAt || "").localeCompare(String(a.unlockedAt || ""))
  )[0];

  return BADGE_DEFINITIONS.find(b => b.id === latest.id) || null;
}

function getBadgeEvolutionState() {
  const unlocked = getUnlockedBadges();

  const totalUnlocked = unlocked.length;

  const allUnlocked = unlocked.filter(b => (b.period || "all") === "all").length;
  const monthUnlocked = unlocked.filter(b => b.period === "month").length;
  const yearUnlocked = unlocked.filter(b => b.period === "year").length;

  const beginnerUnlocked = unlocked.filter(b => b.tier === "初級").length;
  const intermediateUnlocked = unlocked.filter(b => b.tier === "中級").length;
  const advancedUnlocked = unlocked.filter(b => b.tier === "上級").length;

  let rank = 1;
  let title = "見習い探索者";

  if (totalUnlocked >= 6) {
    rank = 2;
    title = "巡回アタッカー";
  }
  if (totalUnlocked >= 12) {
    rank = 3;
    title = "仕入れハンター";
  }
  if (totalUnlocked >= 20) {
    rank = 4;
    title = "店舗攻略家";
  }
  if (totalUnlocked >= 28) {
    rank = 5;
    title = "ルートマスター";
  }
  if (advancedUnlocked >= 6) {
    rank = 6;
    title = "戦略の覇者";
  }
  if (advancedUnlocked >= 10 && yearUnlocked >= 6) {
    rank = 7;
    title = "伝説の商人";
  }
  if (advancedUnlocked >= 14 && intermediateUnlocked >= 12 && monthUnlocked >= 8) {
    rank = 8;
    title = "神域の仕入れ人";
  }
  if (advancedUnlocked >= 18 && yearUnlocked >= 12 && totalUnlocked >= 42) {
    rank = 9;
    title = "王冠の支配者";
  }
  if (
    advancedUnlocked >= 18 &&
    intermediateUnlocked >= 15 &&
    beginnerUnlocked >= 15 &&
    allUnlocked >= 12 &&
    monthUnlocked >= 12 &&
    yearUnlocked >= 12 &&
    totalUnlocked >= 50
  ) {
    rank = 10;
    title = "せどり皇帝";
  }

  return {
    rank,
    title,
    totalUnlocked,
    allUnlocked,
    monthUnlocked,
    yearUnlocked,
    beginnerUnlocked,
    intermediateUnlocked,
    advancedUnlocked
  };
}

function renderAppRankBadge() {
  const el = document.getElementById("appRankBadge");
  if (!el) return;

  const evo = getBadgeEvolutionState();

  el.className = "appRankBadge";
  el.classList.add(`rankTheme${evo.rank}`);

  el.innerHTML = `
    <div class="appRankLabel">現在ランク</div>
    <div class="appRankValue">Rank ${evo.rank}</div>
    <div class="appRankTitle">${escapeHtml(evo.title)}</div>
  `;
}

function renderBadgeMiniCard() {
  const el = document.getElementById("badgeMiniCard");
  if (!el) return;

  const unlocked = getUnlockedBadges();
  const total = BADGE_DEFINITIONS.length;
  const latest = getLatestUnlockedBadge();
  const next = getNextBadge();

  const latestText = latest ? `${latest.icon} ${latest.name}` : "なし";
  const nextText = next
    ? `${next.icon} ${next.name} ${getBadgeProgressText(next, next.current)}`
    : "全実績解除済み";

  el.innerHTML = `
    <div class="badgeMiniTitle">🏅 実績</div>
    <div class="badgeMiniProgress">${unlocked.length} / ${total} 解除</div>
    <div class="badgeMiniLatest">最新：${escapeHtml(latestText)}</div>
    <div class="badgeMiniNext">次：${escapeHtml(nextText)}</div>
  `;
}

function getBadgeListViewData() {
  const historyMap = getBadgeHistoryMap();
  const stats = getBadgeStats();

  return BADGE_DEFINITIONS.map(badge => {
    const unlocked = (() => {
      try {
        return !!badge.condition(stats);
      } catch {
        return false;
      }
    })();

    const current = badgeSafeNumber(badge.progress?.(stats));

    return {
      ...badge,
      unlocked,
      current,
      unlockedAt: historyMap[badge.id] || "",
      progressText: unlocked ? "達成済み" : getBadgeProgressText(badge, current)
    };
  });
}

function getCompletedTodayRouteCount() {
  let todayIds = [];
  let visitedIds = [];

  try {
    if (typeof todayRouteOrder !== "undefined" && Array.isArray(todayRouteOrder)) {
      todayIds = todayRouteOrder;
    } else if (Array.isArray(window.todayRouteOrder)) {
      todayIds = window.todayRouteOrder;
    }
  } catch {}

  try {
    if (typeof todayRouteVisitedIds !== "undefined" && Array.isArray(todayRouteVisitedIds)) {
      visitedIds = todayRouteVisitedIds;
    } else if (Array.isArray(window.todayRouteVisitedIds)) {
      visitedIds = window.todayRouteVisitedIds;
    }
  } catch {}

  const todaySet = new Set(todayIds);
  return visitedIds.filter(id => todaySet.has(id)).length;
}

function getTodayRouteTotalCount() {
  const storesList = getBadgeStores();
  return storesList.filter(store => !!store.today).length;
}

function checkAndCountCompletedRoute() {
  const total = getTodayRouteTotalCount();
  const done = getCompletedTodayRouteCount();

  if (!total || done !== total) return false;

  const today = typeof tokyoDateStr === "function"
    ? tokyoDateStr()
    : new Date().toISOString().slice(0, 10);

  const monthKey = today.slice(0, 7);
  const yearKey = today.slice(0, 4);
  const dayKey = `badge_route_completed_date_${today}`;
  const alreadyCounted = localStorage.getItem(dayKey) === "1";

  if (alreadyCounted) return false;

  const nextCount = loadBadgeRouteCompleteCount() + 1;
  saveBadgeRouteCompleteCount(nextCount);

  const currentMonthCount = loadBadgeRoutePeriodCount(getBadgeRouteMonthKey(monthKey), "0");
  localStorage.setItem(getBadgeRouteMonthKey(monthKey), String(currentMonthCount + 1));

  const currentYearCount = loadBadgeRoutePeriodCount(getBadgeRouteYearKey(yearKey), "0");
  localStorage.setItem(getBadgeRouteYearKey(yearKey), String(currentYearCount + 1));

  localStorage.setItem(dayKey, "1");
  syncUnlockedBadgeHistory();
  return true;
}

function resetRouteBadgeCompletionForTodayIfNeeded() {
  const total = getTodayRouteTotalCount();
  const done = getCompletedTodayRouteCount();
  if (total > 0 && done < total) {
    return;
  }
}

function renderBadgeMiniCardIfExists() {
  if (document.getElementById("badgeMiniCard")) {
    renderBadgeMiniCard();
  }
}

function renderBadgeGroupCards(badges) {
  if (!badges.length) {
    return `<div class="emptyText">この区分の実績はまだありません。</div>`;
  }

  const unlocked = badges.filter(b => b.unlocked);
  const locked = badges.filter(b => !b.unlocked);
  const ordered = [...unlocked, ...locked];

  return `
    <div class="badgeListWrap">
      ${ordered.map(badge => {
        const stateText = badge.unlocked ? "達成" : "未達成";
        const progressText = badge.unlocked ? "解除済み" : (badge.progressText || "");

        return `
          <div class="badgeItem ${badge.unlocked ? "unlocked" : "locked"}">
            <div class="badgeRowTop">
              <div class="badgeMain">
                <div class="badgeIcon">${badge.icon || "🏅"}</div>
                <div>
                  <div class="badgeName">${escapeHtml(badge.name || "実績")}</div>
                  <div class="badgeDesc">${escapeHtml(badge.description || "")}</div>
                </div>
              </div>
              <div class="badgeState ${badge.unlocked ? "unlocked" : "locked"}">
                ${stateText}
              </div>
            </div>

            <div class="badgeProgress">${escapeHtml(progressText)}</div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderBadgeTierSection(list, tierName) {
  const tierList = list.filter(b => (b.tier || "初級") === tierName);
  if (!tierList.length) return "";

  const unlockedCount = tierList.filter(b => b.unlocked).length;

  return `
    <div class="badgeTierSection">
      <div class="badgeTierHeader">
        <span class="badgeTierTitle">${tierName}</span>
        <span class="badgeTierCount">${unlockedCount} / ${tierList.length} 達成</span>
      </div>
      ${renderBadgeGroupCards(tierList)}
    </div>
  `;
}

function renderBadgePeriodSection(list, periodKey, periodLabel) {
  const periodList = list.filter(b => (b.period || "all") === periodKey);
  if (!periodList.length) return "";

  return `
    <div class="badgePeriodSection period-${periodKey}">
      <div class="badgePeriodHeader">
        <span class="badgePeriodTitle">${periodLabel}</span>
      </div>

      ${renderBadgeTierSection(periodList, "初級")}
      ${renderBadgeTierSection(periodList, "中級")}
      ${renderBadgeTierSection(periodList, "上級")}
    </div>
  `;
}

function renderBadgeList() {
  const el = document.getElementById("badgeListWrap");
  if (!el) return;

  let list = [];
  try {
    list = getBadgeListViewData();
  } catch (e) {
    console.error("renderBadgeList error:", e);
    el.innerHTML = `<div class="emptyText">実績一覧の読み込みに失敗しました。</div>`;
    return;
  }

  if (!Array.isArray(list) || !list.length) {
    el.innerHTML = `<div class="emptyText">実績データがありません。</div>`;
    return;
  }

  const html = [
    renderBadgePeriodSection(list, "all", "累計実績"),
    renderBadgePeriodSection(list, "month", "月間実績"),
    renderBadgePeriodSection(list, "year", "年間実績")
  ].join("");

  el.innerHTML = html || `<div class="emptyText">実績データがありません。</div>`;
}

let badgeAccordionOpen = false;

function syncBadgeAccordionUI() {
  const body = document.getElementById("badgeAccordionBody");
  const header = document.getElementById("badgeAccordionHeader");
  const chevron = document.getElementById("badgeAccordionChevron");
  if (!body || !header || !chevron) return;

  body.style.display = badgeAccordionOpen ? "block" : "none";
  header.setAttribute("aria-expanded", badgeAccordionOpen ? "true" : "false");
  chevron.textContent = badgeAccordionOpen ? "▲" : "▼";
}

function toggleBadgeAccordion(forceOpen = null) {
  badgeAccordionOpen =
    forceOpen === null ? !badgeAccordionOpen : !!forceOpen;

  syncBadgeAccordionUI();
}

function renderBadgesIfExists() {
  renderAppRankBadge();
  renderBadgeMiniCardIfExists();
  renderBadgeList();
  syncBadgeAccordionUI();
}
