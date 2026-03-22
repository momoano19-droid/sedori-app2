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

let selectedMonth = null;

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

function loadStores() {
  const parsed = readFirstAvailable(STORE_KEYS);
  return Array.isArray(parsed) ? parsed : [];
}

function loadLogs() {
  const parsed = readFirstAvailable(LOG_KEYS);
  return Array.isArray(parsed) ? parsed : [];
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function yen(n) {
  return `${Number(n || 0).toLocaleString()}円`;
}

function ym(dateStr) {
  return String(dateStr || "").slice(0, 7);
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function currentMonthStr() {
  return todayStr().slice(0, 7);
}

function getStoreMap(stores) {
  const map = {};
  stores.forEach(s => {
    map[String(s.id || "")] = s;
  });
  return map;
}

function getAvailableMonths(logs) {
  const months = [...new Set(logs.map(l => ym(l.date)).filter(Boolean))].sort().reverse();
  if (!months.length) return [currentMonthStr()];
  if (!months.includes(currentMonthStr())) months.unshift(currentMonthStr());
  return [...new Set(months)];
}

function renderMonthPicker(logs) {
  const el = document.getElementById("monthPicker");
  if (!el) return;

  const months = getAvailableMonths(logs);
  if (!selectedMonth) selectedMonth = months[0] || currentMonthStr();

  el.innerHTML = months
    .map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
    .join("");

  el.value = selectedMonth;
}

function changeReportMonth(month) {
  selectedMonth = month;
  bootReport();
}

function goCurrentMonth() {
  selectedMonth = currentMonthStr();
  bootReport();
}

function buildDailyStats(logs, targetMonth) {
  const daily = {};

  logs.forEach(log => {
    if (!log.date || ym(log.date) !== targetMonth) return;

    if (!daily[log.date]) {
      daily[log.date] = {
        profit: 0,
        visits: 0,
        success: 0,
        items: 0,
        categories: {},
        storeIds: new Set()
      };
    }

    const d = daily[log.date];
    const storeId = String(log.storeId || "");
    if (storeId) d.storeIds.add(storeId);

    if (log.type === "profit") d.profit += Number(log.delta || 0);
    if (log.type === "visit") d.visits += Number(log.delta || 0);
    if (log.type === "success") d.success += Number(log.delta || 0);
    if (log.type === "items") d.items += Number(log.delta || 0);

    if (log.type === "category" && log.category) {
      const cat = String(log.category).trim();
      if (cat) d.categories[cat] = (d.categories[cat] || 0) + Number(log.delta || 0);
    }
  });

  return daily;
}

function buildCategorySummary(stores, logs, targetMonth) {
  const monthMap = {};
  const storeCurrentMap = {};

  // 1) まず月ログからカテゴリを集計
  logs.forEach(log => {
    if (ym(log.date) !== targetMonth) return;
    if (log.type !== "category") return;

    const name = String(log.category || "").trim();
    if (!name) return;

    monthMap[name] = (monthMap[name] || 0) + Number(log.delta || 0);
  });

  // 2) 次に現在の店舗データからカテゴリを補完
  stores.forEach(store => {
    const cc = store.categoryCounts || {};
    let hasAny = false;

    Object.entries(cc).forEach(([name, qty]) => {
      const key = String(name || "").trim();
      const n = Number(qty || 0);
      if (!key || n <= 0) return;
      hasAny = true;
      storeCurrentMap[key] = (storeCurrentMap[key] || 0) + n;
    });

    // 複数カテゴリがないが defaultCategory と items がある場合の補完
    const fallback = String(store.defaultCategory || "").trim();
    const items = Number(store.items || 0);
    if (!hasAny && fallback && items > 0) {
      storeCurrentMap[fallback] = (storeCurrentMap[fallback] || 0) + items;
    }
  });

  // 3) 月ログ優先、月ログがないカテゴリは現在値で補完
  const merged = {};
  const names = new Set([
    ...Object.keys(monthMap),
    ...Object.keys(storeCurrentMap)
  ]);

  names.forEach(name => {
    const monthQty = Number(monthMap[name] || 0);
    const currentQty = Number(storeCurrentMap[name] || 0);

    // 月ログにカテゴリがあればそれを優先
    // なければ現在のカテゴリ数を出す
    merged[name] = monthQty > 0 ? monthQty : currentQty;
  });

  return Object.entries(merged)
    .filter(([, qty]) => Number(qty) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
}

function buildMonthSummary(stores, logs, targetMonth) {
  const monthLogs = logs.filter(l => ym(l.date) === targetMonth);

  let profit = 0;
  let visits = 0;
  let success = 0;
  let items = 0;

  monthLogs.forEach(log => {
    if (log.type === "profit") profit += Number(log.delta || 0);
    if (log.type === "visit") visits += Number(log.delta || 0);
    if (log.type === "success") success += Number(log.delta || 0);
    if (log.type === "items") items += Number(log.delta || 0);
  });

  const targetStoreIds = new Set(
    monthLogs.map(l => String(l.storeId || "")).filter(Boolean)
  );

  const rate = visits > 0 ? (success / visits) * 100 : 0;
  const categories = buildCategorySummary(stores, logs, targetMonth);

  return {
    ym: targetMonth,
    registeredStoreCount: stores.length,
    activeStoreCount: targetStoreIds.size,
    profit,
    visits,
    success,
    items,
    rate,
    categories
  };
}

function renderMonthSummary(summary) {
  const el = document.getElementById("monthSummaryCard");
  if (!el) return;

  const categoryTable = (summary.categories && summary.categories.length)
    ? `
      <div style="margin-top:14px;">
        <div style="font-size:15px;font-weight:900;color:#1d2240;margin-bottom:10px;">
          月間カテゴリ集計
        </div>

        <div style="background:#fafbfe;border-radius:18px;overflow:hidden;border:1px solid #eef1f7;">
          <div style="display:grid;grid-template-columns:1fr 88px;background:#eef1f7;font-weight:900;color:#1f2340;">
            <div style="padding:12px 14px;">カテゴリ</div>
            <div style="padding:12px 14px;text-align:right;">個数</div>
          </div>

          ${summary.categories.map(([name, qty], idx) => `
            <div style="
              display:grid;
              grid-template-columns:1fr 88px;
              background:#fff;
              ${idx !== summary.categories.length - 1 ? "border-bottom:1px solid #eef1f7;" : ""}
            ">
              <div style="padding:12px 14px;font-weight:700;color:#1f2340;word-break:break-word;">
                ${escapeHtml(name)}
              </div>
              <div style="padding:12px 14px;text-align:right;font-weight:900;color:#4b74ea;">
                ${qty}個
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `
    : `
      <div style="margin-top:14px;">
        <div style="font-size:15px;font-weight:900;color:#1d2240;margin-bottom:10px;">
          月間カテゴリ集計
        </div>
        <div style="background:#fafbfe;border-radius:18px;padding:14px;color:#6b7280;">
          カテゴリデータなし
        </div>
      </div>
    `;

  el.innerHTML = `
    <h2 class="sectionTitle" style="margin-bottom:16px;">📌 ${escapeHtml(summary.ym)} サマリー</h2>

    <div class="chipRow" onclick="showMonthDetail('${escapeHtml(summary.ym)}')" style="cursor:pointer;">
      <div class="chip">現在登録店舗 ${summary.registeredStoreCount}件</div>
      <div class="chip">対象店舗 ${summary.activeStoreCount}件</div>
      <div class="chip">今月利益 ${yen(summary.profit)}</div>
      <div class="chip">今月訪問 ${summary.visits}回</div>
      <div class="chip">今月成功 ${summary.success}回</div>
      <div class="chip">今月個数 ${summary.items}個</div>
      <div class="chip">今月成功率 ${summary.rate.toFixed(1)}%</div>
    </div>

    ${categoryTable}
  `;
}

function renderCalendar(targetMonth, dailyStats) {
  const wrap = document.getElementById("calendarWrap");
  if (!wrap) return;

  const [year, month] = targetMonth.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const lastDate = new Date(year, month, 0).getDate();
  const startDow = first.getDay();
  const dowNames = ["日", "月", "火", "水", "木", "金", "土"];
  const today = todayStr();

  let html = `<div class="calendarGrid">`;

  dowNames.forEach(d => {
    html += `<div class="dow">${d}</div>`;
  });

  for (let i = 0; i < startDow; i++) {
    html += `<div class="dayCell empty"></div>`;
  }

  for (let day = 1; day <= lastDate; day++) {
    const ds = `${targetMonth}-${String(day).padStart(2, "0")}`;
    const info = dailyStats[ds];
    const hasData = !!info && (info.profit || info.visits || info.success || info.items);
    const isToday = ds === today;

    let cls = "dayCell";
    if (hasData) cls += " hasData";
    if (isToday) cls += " today";

    const value = hasData ? yen(info.profit) : "-";

    html += `
      <div class="${cls}" onclick="showDayDetail('${ds}')">
        <div class="dayNum">${day}</div>
        <div class="dayValue">${escapeHtml(value)}</div>
      </div>
    `;
  }

  html += `</div>`;
  wrap.innerHTML = html;
}

function buildTopStores(stores, logs, targetMonth) {
  const map = {};

  logs.forEach(log => {
    if (ym(log.date) !== targetMonth) return;
    const id = String(log.storeId || "");
    if (!id) return;

    if (!map[id]) {
      map[id] = {
        profit: 0,
        visits: 0,
        success: 0,
        items: 0
      };
    }

    if (log.type === "profit") map[id].profit += Number(log.delta || 0);
    if (log.type === "visit") map[id].visits += Number(log.delta || 0);
    if (log.type === "success") map[id].success += Number(log.delta || 0);
    if (log.type === "items") map[id].items += Number(log.delta || 0);
  });

  const storeMap = getStoreMap(stores);

  return Object.entries(map)
    .map(([id, stat]) => ({
      id,
      name: storeMap[id]?.name || "不明な店舗",
      pref: storeMap[id]?.pref || "",
      profit: stat.profit,
      visits: stat.visits,
      success: stat.success,
      items: stat.items,
      expected: stat.visits > 0 ? stat.profit / stat.visits : 0
    }))
    .sort((a, b) => b.expected - a.expected)
    .slice(0, 10);
}

function renderTopStores(list) {
  const el = document.getElementById("topStoresWrap");
  if (!el) return;

  if (!list.length) {
    el.innerHTML = `<div class="emptyText">この月のデータがありません。</div>`;
    return;
  }

  el.innerHTML = `
    <div class="list">
      ${list.map((item, idx) => `
        <div class="rankItem">
          <div class="rankNo">${idx + 1}</div>
          <div>
            <div class="rankName">${escapeHtml(item.name)}</div>
            <div class="rankSub">${escapeHtml(item.pref)} / 利益 ${yen(item.profit)} / 訪問 ${item.visits}回</div>
            <div class="rankValue">期待値 ${Math.round(item.expected).toLocaleString()}円</div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderCategorySummary(list) {
  const el = document.getElementById("categoryWrap");
  if (!el) return;

  if (!list.length) {
    el.innerHTML = `<div class="emptyText">カテゴリデータがありません。</div>`;
    return;
  }

  el.innerHTML = `
    <div class="catList">
      ${list.map(([name, qty]) => `
        <div class="catItem">
          <div class="catName">${escapeHtml(name)}</div>
          <div class="catQty">${qty}個</div>
        </div>
      `).join("")}
    </div>
  `;
}

function getMonthLogs(targetMonth) {
  return loadLogs().filter(l => ym(l.date) === targetMonth);
}

function getDayLogs(dayStr) {
  return loadLogs().filter(l => l.date === dayStr);
}

function groupLogsByStore(logs) {
  const stores = loadStores();
  const storeMap = getStoreMap(stores);
  const map = {};

  logs.forEach(log => {
    const id = String(log.storeId || "");
    const name = storeMap[id]?.name || "不明な店舗";

    if (!map[name]) {
      map[name] = {
        profit: 0,
        visits: 0,
        success: 0,
        items: 0,
        categories: {}
      };
    }

    if (log.type === "profit") map[name].profit += Number(log.delta || 0);
    if (log.type === "visit") map[name].visits += Number(log.delta || 0);
    if (log.type === "success") map[name].success += Number(log.delta || 0);
    if (log.type === "items") map[name].items += Number(log.delta || 0);
    if (log.type === "category" && log.category) {
      const cat = String(log.category).trim();
      if (cat) map[name].categories[cat] = (map[name].categories[cat] || 0) + Number(log.delta || 0);
    }
  });

  return map;
}

function buildDetailSummary(logs) {
  let profit = 0;
  let visits = 0;
  let success = 0;
  let items = 0;
  const storeIds = new Set();

  logs.forEach(log => {
    if (log.storeId) storeIds.add(String(log.storeId));
    if (log.type === "profit") profit += Number(log.delta || 0);
    if (log.type === "visit") visits += Number(log.delta || 0);
    if (log.type === "success") success += Number(log.delta || 0);
    if (log.type === "items") items += Number(log.delta || 0);
  });

  const rate = visits > 0 ? (success / visits) * 100 : 0;

  return {
    storeCount: storeIds.size,
    profit,
    visits,
    success,
    items,
    rate
  };
}

function showMonthDetail(targetMonth) {
  const logs = getMonthLogs(targetMonth);
  const grouped = groupLogsByStore(logs);
  const summary = buildDetailSummary(logs);

  const body = document.getElementById("detailBody");
  const title = document.getElementById("detailTitle");

  title.textContent = `${targetMonth} 詳細`;

  const names = Object.keys(grouped);
  let html = `
    <div class="detailBlock">
      <div class="detailTitle">月サマリー</div>
      <div class="detailText">
        対象店舗：${summary.storeCount}件<br>
        利益：${yen(summary.profit)}<br>
        訪問：${summary.visits}回 / 成功：${summary.success}回 / 個数：${summary.items}個<br>
        成功率：${summary.rate.toFixed(1)}%
      </div>
    </div>
  `;

  if (!names.length) {
    html += `<div class="emptyText">この月のデータはありません。</div>`;
    body.innerHTML = html;
    showDetailModal();
    return;
  }

  html += names.map(name => {
    const x = grouped[name];
    const cats = Object.entries(x.categories)
      .filter(([, qty]) => qty > 0)
      .map(([cat, qty]) => `${escapeHtml(cat)}:${qty}`)
      .join(" / ");

    const rate = x.visits > 0 ? (x.success / x.visits) * 100 : 0;

    return `
      <div class="detailBlock">
        <div class="detailTitle">${escapeHtml(name)}</div>
        <div class="detailText">
          利益：${yen(x.profit)}<br>
          訪問：${x.visits}回 / 成功：${x.success}回 / 個数：${x.items}個<br>
          成功率：${rate.toFixed(1)}%<br>
          ${cats ? `カテゴリ：${cats}` : "カテゴリ：なし"}
        </div>
      </div>
    `;
  }).join("");

  body.innerHTML = html;
  showDetailModal();
}

function showDayDetail(dayStr) {
  const logs = getDayLogs(dayStr);
  const grouped = groupLogsByStore(logs);
  const summary = buildDetailSummary(logs);

  const body = document.getElementById("detailBody");
  const title = document.getElementById("detailTitle");

  title.textContent = `${dayStr} 詳細`;

  const names = Object.keys(grouped);
  let html = `
    <div class="detailBlock">
      <div class="detailTitle">日サマリー</div>
      <div class="detailText">
        回った店舗数：${summary.storeCount}件<br>
        利益：${yen(summary.profit)}<br>
        訪問：${summary.visits}回 / 成功：${summary.success}回 / 個数：${summary.items}個<br>
        成功率：${summary.rate.toFixed(1)}%
      </div>
    </div>
  `;

  if (!names.length) {
    html += `<div class="emptyText">この日のデータはありません。</div>`;
    body.innerHTML = html;
    showDetailModal();
    return;
  }

  html += names.map(name => {
    const x = grouped[name];
    const cats = Object.entries(x.categories)
      .filter(([, qty]) => qty > 0)
      .map(([cat, qty]) => `${escapeHtml(cat)}:${qty}`)
      .join(" / ");

    const rate = x.visits > 0 ? (x.success / x.visits) * 100 : 0;

    return `
      <div class="detailBlock">
        <div class="detailTitle">${escapeHtml(name)}</div>
        <div class="detailText">
          利益：${yen(x.profit)}<br>
          訪問：${x.visits}回 / 成功：${x.success}回 / 個数：${x.items}個<br>
          成功率：${rate.toFixed(1)}%<br>
          ${cats ? `カテゴリ：${cats}` : "カテゴリ：なし"}
        </div>
      </div>
    `;
  }).join("");

  body.innerHTML = html;
  showDetailModal();
}

function showDetailModal() {
  document.getElementById("detailModal").classList.add("show");
}

function hideDetailModal() {
  document.getElementById("detailModal").classList.remove("show");
}

function closeDetailModal(e) {
  if (e.target.id === "detailModal") hideDetailModal();
}

function bootReport() {
  const stores = loadStores();
  const logs = loadLogs();

  renderMonthPicker(logs);

  const targetMonth = selectedMonth || currentMonthStr();
  const summary = buildMonthSummary(stores, logs, targetMonth);
  const daily = buildDailyStats(logs, targetMonth);
  const topStores = buildTopStores(stores, logs, targetMonth);
  const categories = buildCategorySummary(stores, logs, targetMonth);

  renderMonthSummary(summary);
  renderCalendar(targetMonth, daily);
  renderTopStores(topStores);
  renderCategorySummary(categories);
}

window.addEventListener("load", bootReport);
