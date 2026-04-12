function ensureId() {
  return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

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

function estimateRouteMinutes(routeStores, startPos = null) {
  if (!Array.isArray(routeStores) || routeStores.length === 0) return null;

  const AVG_SPEED_KMH = 38;
  const ROAD_FACTOR = 1.05;
  const PER_STORE_STOP_MIN = 0;

  let totalStraightKm = 0;
  let prevPoint = null;
  let validStopCount = 0;

  if (
    startPos &&
    typeof startPos.lat === "number" &&
    typeof startPos.lng === "number"
  ) {
    prevPoint = { lat: startPos.lat, lng: startPos.lng };
  }

  routeStores.forEach(store => {
    if (!hasCoords(store)) {
      prevPoint = null;
      return;
    }

    validStopCount += 1;

    if (prevPoint) {
      totalStraightKm += distanceKm(
        prevPoint.lat,
        prevPoint.lng,
        store.lat,
        store.lng
      );
    }

    prevPoint = { lat: store.lat, lng: store.lng };
  });

  if (validStopCount === 0) return null;

  const adjustedRoadKm = totalStraightKm * ROAD_FACTOR;
  const driveMinutes = (adjustedRoadKm / AVG_SPEED_KMH) * 60;
  const stopMinutes = validStopCount * PER_STORE_STOP_MIN;

  const totalMinutes = driveMinutes + stopMinutes;

  return Math.max(1, Math.round(totalMinutes));
}

function formatEstimatedMinutes(minutes) {
  if (minutes === null || minutes === undefined || Number.isNaN(Number(minutes))) {
    return "算出中";
  }

  const n = Math.max(1, Math.round(Number(minutes)));
  if (n >= 60) {
    const h = Math.floor(n / 60);
    const m = n % 60;
    return m === 0 ? `${h}時間` : `${h}時間${m}分`;
  }
  return `${n}分`;
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

function getStoreSuccessDates(storeId) {
  const dates = logs
    .filter(l =>
      l.storeId === storeId &&
      l.type === "success" &&
      Number(l.delta || 0) > 0 &&
      l.date
    )
    .map(l => l.date);

  return [...new Set(dates)].sort((a, b) => String(a).localeCompare(String(b)));
}

function calcSuccessRestockCycleDays(storeId) {
  const dates = getStoreSuccessDates(storeId);
  if (dates.length < 2) return null;

  const diffs = [];

  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1]);
    const next = new Date(dates[i]);

    if (Number.isNaN(prev.getTime()) || Number.isNaN(next.getTime())) continue;

    const diff = Math.floor((next - prev) / (1000 * 60 * 60 * 24));
    if (diff > 0) diffs.push(diff);
  }

  if (!diffs.length) return null;

  return diffs.reduce((a, b) => a + b, 0) / diffs.length;
}

function calcRateAdjustedRestockCycleDays(storeId, rate) {
  const baseCycle = calcSuccessRestockCycleDays(storeId);
  if (baseCycle === null) return null;

  const safeRate = Math.max(5, Math.min(80, Number(rate || 0)));
  const rateAdjust = 1 + ((40 - safeRate) / 100) * 0.9;
  const clampedAdjust = Math.max(0.7, Math.min(1.35, rateAdjust));

  const adjusted = baseCycle * clampedAdjust;
  return adjusted > 0 ? adjusted : baseCycle;
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

  const freq = s?.id ? calcRateAdjustedRestockCycleDays(s.id, rate) : null;

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
  if (v === null || v === undefined || Number.isNaN(Number(v))) {
    return "算出中";
  }

  const n = Number(v);
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

function calcStoreDueStatus(store) {
  const m = getMetrics(store);
  const freq = m.freq;
  const daysSince = getDaysSinceLastVisit(store.lastVisitDate);

  if (freq === null || daysSince === null) {
    return {
      code: "insufficient",
      emoji: "📝",
      label: "データ不足",
      daysSince,
      freq,
      remainingDays: null,
      isDue: false,
      isSoon: false
    };
  }

  const remainingDays = freq - daysSince;

  if (daysSince >= freq) {
    return {
      code: "due",
      emoji: "🔥",
      label: "回り頃",
      daysSince,
      freq,
      remainingDays,
      isDue: true,
      isSoon: false
    };
  }

  if (remainingDays <= 2) {
    return {
      code: "soon",
      emoji: "⏰",
      label: "もうすぐ",
      daysSince,
      freq,
      remainingDays,
      isDue: false,
      isSoon: true
    };
  }

  return {
    code: "early",
    emoji: "🌱",
    label: "まだ早い",
    daysSince,
    freq,
    remainingDays,
    isDue: false,
    isSoon: false
    };
}

function calcSavedRouteDueSummary(route) {
  const routeStores = buildSavedRouteStores(route);

  if (!routeStores.length) {
    return {
      emoji: "📝",
      label: "データ不足",
      dueCount: 0,
      soonCount: 0,
      earlyCount: 0,
      insufficientCount: 0,
      avgFreq: null,
      totalStores: 0
    };
  }

  let dueCount = 0;
  let soonCount = 0;
  let earlyCount = 0;
  let insufficientCount = 0;
  const validFreqs = [];

  routeStores.forEach(store => {
    const status = calcStoreDueStatus(store);
    if (status.code === "due") dueCount += 1;
    else if (status.code === "soon") soonCount += 1;
    else if (status.code === "early") earlyCount += 1;
    else insufficientCount += 1;

    if (status.freq !== null && !Number.isNaN(Number(status.freq))) {
      validFreqs.push(Number(status.freq));
    }
  });

  const avgFreq = validFreqs.length
    ? validFreqs.reduce((a, b) => a + b, 0) / validFreqs.length
    : null;

  let emoji = "📝";
  let label = "データ不足";

  if (dueCount > 0) {
    emoji = "🔥";
    label = "回り頃";
  } else if (soonCount > 0) {
    emoji = "⏰";
    label = "もうすぐ";
  } else if (earlyCount > 0) {
    emoji = "🌱";
    label = "まだ早い";
  }

  return {
    emoji,
    label,
    dueCount,
    soonCount,
    earlyCount,
    insufficientCount,
    avgFreq,
    totalStores: routeStores.length
  };
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

function renderTodayToggleButton(idx, checked) {
  return `
    <label class="todayToggleBtn ${checked ? "checked" : ""}">
      <input
        type="checkbox"
        class="todayToggleNative"
        ${checked ? "checked" : ""}
        onchange="toggleToday(${idx}, this.checked)"
      >
      <span class="todayToggleBox">✓</span>
      <span class="todayToggleText">今日行く</span>
    </label>
  `;
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

function getSortLabel(sortType) {
  if (sortType === "rate") return "成功率順";
  if (sortType === "avgProfit") return "平均利益順";
  if (sortType === "visits") return "訪問回数順";
  if (sortType === "route") return "距離順";
  return "期待値順";
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

  const recentVisitCount = recentVisitLogs.reduce(
    (sum, l) => sum + Math.max(1, Number(l.delta || 1)),
    0
  );

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
