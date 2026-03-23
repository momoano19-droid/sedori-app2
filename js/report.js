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
let selectedDay = null;

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

function shortMoney(n) {
  return Number(n || 0).toLocaleString();
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
  selectedDay = null;
  bootReport();
}

function goCurrentMonth() {
  selectedMonth = currentMonthStr();
  selectedDay = null;
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
      if (cat) {
        d.categories[cat] = (d.categories[cat] || 0) + Number(log.delta || 0);
      }
    }
  });

  return daily;
}

function buildCategorySummary(stores, logs, targetMonth) {
  const monthMap = {};
  const storeCurrentMap = {};

  logs.forEach(log => {
    if (ym(log.date) !== targetMonth) return;
    if (log.type !== "category") return;

    const name = String(log.category || "").trim();
    if (!name) return;

    monthMap[name] = (monthMap[name] || 0) + Number(log.delta || 0);
  });

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

    const fallback = String(store.defaultCategory || "").trim();
    const items = Number(store.items || 0);

    if (!hasAny && fallback && items > 0) {
      storeCurrentMap[fallback] = (storeCurrentMap[fallback] || 0) + items;
    }
  });

  const merged = {};
  const names = new Set([
    ...Object.keys(monthMap),
    ...Object.keys(storeCurrentMap)
  ]);

  names.forEach(name => {
    const monthQty = Number(monthMap[name] || 0);
    const currentQty = Number(storeCurrentMap[name] || 0);
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

function getPieChartParts(categories) {
  const top = categories.slice(0, 7);
  const rest = categories.slice(7);
  const restSum = rest.reduce((sum, [, qty]) => sum + Number(qty || 0), 0);

  const parts = [...top];
  if (restSum > 0) {
    parts.push(["その他", restSum]);
  }
  return parts;
}

function getChartColors() {
  return [
    "#356AE6",
    "#16A34A",
    "#F59E0B",
    "#DC2626",
    "#0EA5E9",
    "#8B5CF6",
    "#D97706",
    "#64748B"
  ];
}

function drawCategoryPieChart(canvasId, categories, monthLabel = "") {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const ratio = window.devicePixelRatio || 1;
  const cssSize = Math.min(290, canvas.parentElement.clientWidth || 290);

  canvas.width = cssSize * ratio;
  canvas.height = cssSize * ratio;
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, cssSize, cssSize);

  if (!categories.length) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = "15px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("カテゴリデータなし", cssSize / 2, cssSize / 2);
    return;
  }

  const parts = getPieChartParts(categories);
  const total = parts.reduce((sum, [, qty]) => sum + Number(qty || 0), 0);
  const colors = getChartColors();

  const cx = cssSize / 2;
  const cy = cssSize / 2;
  const r = Math.min(cssSize * 0.35, 108);

  let start = -Math.PI / 2;

  parts.forEach(([, qty], idx) => {
    const value = Number(qty || 0);
    const angle = total > 0 ? (value / total) * Math.PI * 2 : 0;

    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + angle);
    ctx.strokeStyle = colors[idx % colors.length];
    ctx.lineWidth = Math.max(18, r * 0.34);
    ctx.lineCap = "butt";
    ctx.stroke();

    start += angle;
  });

  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.56, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  ctx.fillStyle = "#6b7280";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(monthLabel || "月間", cx, cy - 20);

  ctx.fillStyle = "#1f2340";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText("合計", cx, cy - 2);

  ctx.fillStyle = "#356AE6";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(`${total}個`, cx, cy + 22);
}

function buildCategoryLegendHtml(categories) {
  const parts = getPieChartParts(categories);
  const colors = getChartColors();
  const total = parts.reduce((sum, [, qty]) => sum + Number(qty || 0), 0);

  return parts.map(([name, qty], idx) => {
    const rate = total > 0 ? ((Number(qty || 0) / total) * 100).toFixed(1) : "0.0";
    return `
      <div class="legendItem">
        <div class="legendColor" style="background:${colors[idx % colors.length]};"></div>
        <div class="legendName">${escapeHtml(name)}</div>
        <div class="legendQty">${qty}個</div>
        <div class="legendRate">${rate}%</div>
      </div>
    `;
  }).join("");
}

function buildMiniCategoryTableHtml(categories) {
  const top = categories.slice(0, 10);
  const total = top.reduce((sum, [, qty]) => sum + Number(qty || 0), 0);

  if (!top.length) {
    return `
      <div class="miniTable">
        <div class="miniTableRow">
          <div class="miniCell name" style="color:#6b7280;">カテゴリデータなし</div>
          <div class="miniCell qty">-</div>
          <div class="miniCell rate">-</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="miniTable">
      <div class="miniTableHead">
        <div class="miniCell">カテゴリ</div>
        <div class="miniCell qty">個数</div>
        <div class="miniCell rate">割合</div>
      </div>
      ${top.map(([name, qty]) => {
        const rate = total > 0 ? ((Number(qty || 0) / total) * 100).toFixed(1) : "0.0";
        return `
          <div class="miniTableRow">
            <div class="miniCell name">${escapeHtml(name)}</div>
            <div class="miniCell qty">${qty}個</div>
            <div class="miniCell rate">${rate}%</div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderMonthSummary(summary) {
  const el = document.getElementById("monthSummaryCard");
  if (!el) return;

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

    <div class="summarySubTitle">月間カテゴリ集計</div>

    <div class="chartWrap">
      <div class="chartCanvasBox">
        <canvas id="categoryPieChart"></canvas>
      </div>
      <div class="chartLegend">
        ${buildCategoryLegendHtml(summary.categories)}
      </div>
    </div>

    <div class="summarySubTitle">カテゴリ表</div>
    ${buildMiniCategoryTableHtml(summary.categories)}
  `;

  drawCategoryPieChart("categoryPieChart", summary.categories, summary.ym);
}

function renderSelectedDayBar(dayStr, info) {
  const bar = document.getElementById("selectedDayBar");
  if (!bar) return;

  if (!dayStr) {
    bar.innerHTML = `
      <div class="dayStickyLabel">日付をタップするとここに表示されます</div>
      <div class="dayStickyValue">その日の合計利益 <strong>-</strong></div>
    `;
    return;
  }

  const profit = Number(info?.profit || 0);

  bar.innerHTML = `
    <div class="dayStickyLabel">${escapeHtml(dayStr)} の合計利益</div>
    <div class="dayStickyValue"><strong>${escapeHtml(yen(profit))}</strong></div>
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

  if (!selectedDay || ym(selectedDay) !== targetMonth) {
    selectedDay = today.startsWith(targetMonth) ? today : `${targetMonth}-01`;
  }

  let html = `<div class="calendarGrid">`;

  dowNames.forEach(d => {
    html += `<div class="dow">${d}</div>`;
  });

  for (let i = 0; i < startDow; i++) {
    html += `<div class="dayCell empty"></div>`;
  }

  for (let day = 1; day <= lastDate; day++) {
    const ds = `${targetMonth}-${String(day).padStart(2, "0")}`;
    const info = dailyStats[ds] || {
      profit: 0,
      visits: 0,
      success: 0,
      items: 0
    };

    const profit = Number(info.profit || 0);
    const visits = Number(info.visits || 0);
    const success = Number(info.success || 0);
    const items = Number(info.items || 0);

    const hasProfit = profit > 0;
    const hasVisitOnly = !hasProfit && (visits > 0 || success > 0 || items > 0);
    const isToday = ds === today;
    const isSelected = ds === selectedDay;

    let cls = "dayCell";
    if (hasProfit) cls += " hasData";
    else if (hasVisitOnly) cls += " visitOnly";
    if (isToday) cls += " today";
    if (isSelected) cls += " selected";

    let valueText = "-";
    if (hasProfit) {
      valueText = shortMoney(profit);
    } else if (hasVisitOnly) {
      valueText = "0";
    }

    html += `
      <div class="${cls}" onclick="handleDayTap('${ds}')">
        <div class="dayNum">${day}</div>
        <div class="dayValue">${escapeHtml(valueText)}</div>
      </div>
    `;
  }

  html += `</div>`;
  wrap.innerHTML = html;

  renderSelectedDayBar(selectedDay, dailyStats[selectedDay] || { profit: 0 });
}

function handleDayTap(dayStr) {
  selectedDay = dayStr;
  const targetMonth = ym(dayStr);
  const daily = buildDailyStats(loadLogs(), targetMonth);
  renderCalendar(targetMonth, daily);
  showDayDetail(dayStr);
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
      if (cat) {
        map[name].categories[cat] = (map[name].categories[cat] || 0) + Number(log.delta || 0);
      }
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
window.addEventListener("resize", () => {
  const stores = loadStores();
  const logs = loadLogs();
  const targetMonth = selectedMonth || currentMonthStr();
  const summary = buildMonthSummary(stores, logs, targetMonth);
  drawCategoryPieChart("categoryPieChart", summary.categories || [], summary.ym || "");
});
