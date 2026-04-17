const BADGE_DEFINITIONS = [
  {
    id: "first_visit",
    icon: "👣",
    name: "はじめの一歩",
    category: "visit",
    description: "訪問1回達成",
    condition: stats => stats.totalVisits >= 1,
    progress: stats => stats.totalVisits,
    target: 1
  },
  {
    id: "visit_10",
    icon: "👣",
    name: "巡回スタート",
    category: "visit",
    description: "訪問10回達成",
    condition: stats => stats.totalVisits >= 10,
    progress: stats => stats.totalVisits,
    target: 10
  },
  {
    id: "visit_50",
    icon: "👣",
    name: "巡回職人",
    category: "visit",
    description: "訪問50回達成",
    condition: stats => stats.totalVisits >= 50,
    progress: stats => stats.totalVisits,
    target: 50
  },
  {
    id: "visit_100",
    icon: "👣",
    name: "遠征マスター",
    category: "visit",
    description: "訪問100回達成",
    condition: stats => stats.totalVisits >= 100,
    progress: stats => stats.totalVisits,
    target: 100
  },

  {
    id: "first_success",
    icon: "🎯",
    name: "初仕入れ",
    category: "success",
    description: "成功1回達成",
    condition: stats => stats.totalSuccess >= 1,
    progress: stats => stats.totalSuccess,
    target: 1
  },
  {
    id: "success_10",
    icon: "🎯",
    name: "仕入れ上昇中",
    category: "success",
    description: "成功10回達成",
    condition: stats => stats.totalSuccess >= 10,
    progress: stats => stats.totalSuccess,
    target: 10
  },
  {
    id: "success_30",
    icon: "🎯",
    name: "仕入れ名人",
    category: "success",
    description: "成功30回達成",
    condition: stats => stats.totalSuccess >= 30,
    progress: stats => stats.totalSuccess,
    target: 30
  },
  {
    id: "success_50",
    icon: "🎯",
    name: "爆仕入れ職人",
    category: "success",
    description: "成功50回達成",
    condition: stats => stats.totalSuccess >= 50,
    progress: stats => stats.totalSuccess,
    target: 50
  },

  {
    id: "profit_10k",
    icon: "💰",
    name: "初利益達成",
    category: "profit",
    description: "累計利益1万円達成",
    condition: stats => stats.totalProfit >= 10000,
    progress: stats => stats.totalProfit,
    target: 10000
  },
  {
    id: "profit_100k",
    icon: "💰",
    name: "利益職人",
    category: "profit",
    description: "累計利益10万円達成",
    condition: stats => stats.totalProfit >= 100000,
    progress: stats => stats.totalProfit,
    target: 100000
  },
  {
    id: "profit_500k",
    icon: "💰",
    name: "月間エース級",
    category: "profit",
    description: "累計利益50万円達成",
    condition: stats => stats.totalProfit >= 500000,
    progress: stats => stats.totalProfit,
    target: 500000
  },
  {
    id: "profit_1000k",
    icon: "💰",
    name: "伝説級プレイヤー",
    category: "profit",
    description: "累計利益100万円達成",
    condition: stats => stats.totalProfit >= 1000000,
    progress: stats => stats.totalProfit,
    target: 1000000
  },

  {
    id: "items_10",
    icon: "📦",
    name: "収集家",
    category: "items",
    description: "累計個数10個達成",
    condition: stats => stats.totalItems >= 10,
    progress: stats => stats.totalItems,
    target: 10
  },
  {
    id: "items_50",
    icon: "📦",
    name: "大量仕入れ",
    category: "items",
    description: "累計個数50個達成",
    condition: stats => stats.totalItems >= 50,
    progress: stats => stats.totalItems,
    target: 50
  },
  {
    id: "items_100",
    icon: "📦",
    name: "在庫マスター",
    category: "items",
    description: "累計個数100個達成",
    condition: stats => stats.totalItems >= 100,
    progress: stats => stats.totalItems,
    target: 100
  },

  {
    id: "high_expected_1",
    icon: "🏪",
    name: "高期待値発見",
    category: "store",
    description: "期待値3000円以上の店舗を1件作成",
    condition: stats => stats.highExpectedStoreCount >= 1,
    progress: stats => stats.highExpectedStoreCount,
    target: 1
  },
  {
    id: "high_expected_3",
    icon: "🏪",
    name: "優良店舗ハンター",
    category: "store",
    description: "期待値3000円以上の店舗を3件作成",
    condition: stats => stats.highExpectedStoreCount >= 3,
    progress: stats => stats.highExpectedStoreCount,
    target: 3
  },
  {
    id: "stable_store_3",
    icon: "🏪",
    name: "安定運用中",
    category: "store",
    description: "成功率30%以上の店舗を3件作成",
    condition: stats => stats.stableStoreCount >= 3,
    progress: stats => stats.stableStoreCount,
    target: 3
  },

  {
    id: "route_complete_1",
    icon: "🗺",
    name: "ルート初制覇",
    category: "route",
    description: "今日のルートを1回すべて訪問",
    condition: stats => stats.completedRouteCount >= 1,
    progress: stats => stats.completedRouteCount,
    target: 1
  },
  {
    id: "route_complete_5",
    icon: "🗺",
    name: "ルートマスター",
    category: "route",
    description: "今日のルートを5回すべて訪問",
    condition: stats => stats.completedRouteCount >= 5,
    progress: stats => stats.completedRouteCount,
    target: 5
  }
];

const BADGE_ROUTE_COMPLETE_KEY = "badge_route_complete_count";
const BADGE_UNLOCKED_HISTORY_KEY = "badge_unlocked_history_v1";

function loadBadgeRouteCompleteCount() {
  try {
    return Number(localStorage.getItem(BADGE_ROUTE_COMPLETE_KEY) || "0");
  } catch {
    return 0;
  }
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

function getBadgeStats() {
  const storesList = getBadgeStores();
  const logsList = getBadgeLogs();

  let totalVisits = 0;
  let totalSuccess = 0;
  let totalItems = 0;
  let totalProfit = 0;

  logsList.forEach(log => {
    const delta = badgeSafeNumber(log?.delta);

    if (log?.type === "visit") totalVisits += delta;
    if (log?.type === "success") totalSuccess += delta;
    if (log?.type === "items") totalItems += delta;
    if (log?.type === "profit") totalProfit += delta;
  });

  totalVisits = Math.max(0, totalVisits);
  totalSuccess = Math.max(0, totalSuccess);
  totalItems = Math.max(0, totalItems);

  const highExpectedStoreCount = storesList.filter(store => {
    const m = getBadgeMetricsForStore(store);
    return m.expected >= 3000;
  }).length;

  const stableStoreCount = storesList.filter(store => {
    const m = getBadgeMetricsForStore(store);
    return m.visits > 0 && m.rate >= 30;
  }).length;

  const completedRouteCount = loadBadgeRouteCompleteCount();

  return {
    totalVisits,
    totalSuccess,
    totalItems,
    totalProfit,
    highExpectedStoreCount,
    stableStoreCount,
    completedRouteCount,
    totalStoreCount: storesList.length
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

  if (badge.category === "profit") {
    return `あと${remain.toLocaleString()}円`;
  }
  if (badge.category === "store" || badge.category === "route") {
    return `あと${remain}件`;
  }
  return `あと${remain}回`;
}

function getNextBadge() {
  const locked = getLockedBadges();

  if (!locked.length) return null;

  const ranked = locked
    .map(badge => {
      const target = Math.max(1, badgeSafeNumber(badge.target));
      const current = Math.max(0, badgeSafeNumber(badge.current));
      const ratio = current / target;
      return {
        ...badge,
        ratio,
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

function renderBadgeMiniCard() {
  const el = document.getElementById("badgeMiniCard");
  if (!el) return;

  const unlocked = getUnlockedBadges();
  const total = BADGE_DEFINITIONS.length;
  const latest = getLatestUnlockedBadge();
  const next = getNextBadge();

  const latestText = latest
    ? `${latest.icon} ${latest.name}`
    : "なし";

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

  const key = `badge_route_completed_date_${today}`;
  const alreadyCounted = localStorage.getItem(key) === "1";

  if (alreadyCounted) return false;

  const nextCount = loadBadgeRouteCompleteCount() + 1;
  saveBadgeRouteCompleteCount(nextCount);
  localStorage.setItem(key, "1");
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

  const unlocked = list.filter(b => b.unlocked);
  const locked = list.filter(b => !b.unlocked);
  const ordered = [...unlocked, ...locked];

  el.innerHTML = `
    <div class="badgeListWrap">
      ${ordered.map(badge => {
        const stateText = badge.unlocked ? "達成" : "未達成";
        const progressText = badge.unlocked
          ? "解除済み"
          : (badge.progressText || "");

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

function renderBadgesIfExists() {
  renderBadgeMiniCardIfExists();
  renderBadgeList();
  toggleBadgeAccordion(badgeAccordionOpen);
}
let badgeAccordionOpen = true;

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
  renderBadgeMiniCardIfExists();
  renderBadgeList();
  syncBadgeAccordionUI();
}
