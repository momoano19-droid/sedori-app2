const REPORT_STORE_KEYS = [
  "sedori_stores_v2",
  "sedori_stores_v1",
  "sedori_stores_v3",
  "sedori_stores",
  "stores"
];

const REPORT_LOG_KEYS = [
  "sedori_logs_v2",
  "sedori_logs_v1",
  "sedori_logs_v3",
  "sedori_logs",
  "logs"
];

/* =========================
   共通
========================= */
function reportEscapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function reportClampNonNeg(n) {
  const x = Number(n);
  if (isNaN(x) || x < 0) return 0;
  return x;
}

function reportFormatYmd(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function reportFormatYm(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function reportGetMonthRange(baseDate = new Date()) {
  const first = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  const last = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0);
  return { first, last };
}

/* =========================
   読込
========================= */
function reportReadFirstAvailable(keys) {
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed) return parsed;
    } catch (e) {
      console.error(`read failed: ${key}`, e);
    }
  }
  return null;
}

function normalizeReportStore(s) {
  return {
    id: String(s.id || ""),
    name: String(s.name || "店舗"),
    pref: String(s.pref || "").trim(),
    address: String(s.address || "").trim(),
    visits: Number(s.visits || 0),
    buyDays: Number(s.buyDays || 0),
    items: Number(s.items || 0),
    profit: Number(s.profit || 0),
    mapUrl: String(s.mapUrl || "").trim(),
    lat: (s.lat !== null && s.lat !== "" && !isNaN(Number(s.lat))) ? Number(s.lat) : null,
    lng: (s.lng !== null && s.lng !== "" && !isNaN(Number(s.lng))) ? Number(s.lng) : null,
    defaultCategory: String(s.defaultCategory || "").trim(),
    categoryCounts: (s.categoryCounts && typeof s.categoryCounts === "object") ? s.categoryCounts : {},
    quickCategories: Array.isArray(s.quickCategories) ? s.quickCategories.filter(Boolean) : [],
    lastVisitDate: String(s.lastVisitDate || "").trim(),
    today: !!s.today
  };
}

function getStoresSafe() {
  const parsed = reportReadFirstAvailable(REPORT_STORE_KEYS);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeReportStore);
}

function getLogsSafe() {
  const parsed = reportReadFirstAvailable(REPORT_LOG_KEYS);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(l => ({
    date: String(l.date || "").trim(),
    storeId: String(l.storeId || "").trim(),
    type: String(l.type || "").trim(),
    delta: Number(l.delta || 0),
    category: String(l.category || "").trim()
  }));
}

/* =========================
   集計
========================= */
function buildDailyFromLogs(logs, baseDate = new Date()) {
  const { last } = reportGetMonthRange(baseDate);
  const days = {};

  for (let d = 1; d <= last.getDate(); d++) {
    const key = reportFormatYmd(new Date(baseDate.getFullYear(), baseDate.getMonth(), d));
    days[key] = {
      profit: 0,
      items: 0,
      visits: 0,
      success: 0
    };
  }

  logs.forEach(log => {
    const date = String(log.date || "").trim();
    if (!days[date]) return;

    if (log.type === "profit") days[date].profit += Number(log.delta || 0);
    if (log.type === "items") days[date].items += Number(log.delta || 0);
    if (log.type === "visit") days[date].visits += Number(log.delta || 0);
    if (log.type === "success") days[date].success += Number(log.delta || 0);
  });

  return days;
}

function buildFallbackDailyFromStores(stores, baseDate = new Date()) {
  const { last } = reportGetMonthRange(baseDate);
  const days = {};

  for (let d = 1; d <= last.getDate(); d++) {
    const key = reportFormatYmd(new Date(baseDate.getFullYear(), baseDate.getMonth(), d));
    days[key] = {
      profit: 0,
      items: 0,
      visits: 0,
      success: 0
    };
  }

  stores.forEach(store => {
    const date = String(store.lastVisitDate || "").trim();
    if (!date || !days[date]) return;

    days[date].profit += Number(store.profit || 0);
    days[date].items += Number(store.items || 0);
    days[date].visits += Number(store.visits || 0);
    days[date].success += Number(store.buyDays || 0);
  });

  return days;
}

function getMonthlySummarySmart(baseDate = new Date()) {
  const stores = getStoresSafe();
  const logs = getLogsSafe();

  if (logs.length > 0) {
    const daily = buildDailyFromLogs(logs, baseDate);
    let profit = 0;
    let items = 0;
    let visits = 0;
    let success = 0;

    Object.values(daily).forEach(v => {
      profit += Number(v.profit || 0);
      items += Number(v.items || 0);
      visits += Number(v.visits || 0);
      success += Number(v.success || 0);
    });

    return {
      source: "logs",
      stores,
      logs,
      storesCount: stores.length,
      profit,
      items,
      visits,
      success,
      rate: visits > 0 ? (success / visits) * 100 : 0,
      daily
    };
  }

  const daily = buildFallbackDailyFromStores(stores, baseDate);

  let profit = 0;
  let items = 0;
  let visits = 0;
  let success = 0;

  stores.forEach(store => {
    profit += Number(store.profit || 0);
    items += Number(store.items || 0);
    visits += Number(store.visits || 0);
    success += Number(store.buyDays || 0);
  });

  return {
    source: "stores",
    stores,
    logs,
    storesCount: stores.length,
    profit,
    items,
    visits,
    success,
    rate: visits > 0 ? (success / visits) * 100 : 0,
    daily
  };
}

function getTopStores(stores, limit = 20) {
  return [...stores]
    .map(store => {
      const visits = Number(store.visits || 0);
      const buyDays = Number(store.buyDays || 0);
      const profit = Number(store.profit || 0);
      const items = Number(store.items || 0);

      return {
        ...store,
        expected: visits > 0 ? profit / visits : 0,
        rate: visits > 0 ? (buyDays / visits) * 100 : 0,
        avgProfit: buyDays > 0 ? profit / buyDays : 0,
        avgItems: buyDays > 0 ? items / buyDays : 0
      };
    })
    .sort((a, b) => b.expected - a.expected)
    .slice(0, limit);
}

/* =========================
   描画
========================= */
function renderSummary() {
  const target = document.getElementById("monthlySummary");
  if (!target) return;

  const now = new Date();
  const ym = reportFormatYm(now);
  const sum = getMonthlySummarySmart(now);

  target.innerHTML = `
    <div class="store">
      <div class="storeTitle">📌 ${ym} サマリー</div>
      <div class="kv">
        <div class="pill">対象店舗 ${sum.storesCount}件</div>
        <div class="pill">今月利益 ${Math.round(sum.profit).toLocaleString()}円</div>
        <div class="pill">今月訪問 ${Math.round(sum.visits).toLocaleString()}回</div>
        <div class="pill">今月成功 ${Math.round(sum.success).toLocaleString()}回</div>
        <div class="pill">今月個数 ${Math.round(sum.items).toLocaleString()}個</div>
        <div class="pill">今月成功率 ${sum.rate.toFixed(1)}%</div>
      </div>
      ${
        sum.source === "stores"
          ? `<div class="mini" style="margin-top:8px;">※ 履歴ログが無いため、現在の店舗集計から表示しています</div>`
          : ""
      }
    </div>
  `;
}

function renderCalendar() {
  const area = document.getElementById("calendarArea");
  if (!area) return;

  const now = new Date();
  const sum = getMonthlySummarySmart(now);
  const { first, last } = reportGetMonthRange(now);

  const startWeekday = first.getDay();
  const totalDays = last.getDate();
  const weekLabels = ["日", "月", "火", "水", "木", "金", "土"];

  let html = `
    <div class="sectionTitle">🗓 月カレンダー</div>
    <div class="store">
      <div class="reportCalendarGrid reportCalendarHeader">
        ${weekLabels.map(w => `<div class="reportCalendarWeek">${w}</div>`).join("")}
      </div>
      <div class="reportCalendarGrid">
  `;

  for (let i = 0; i < startWeekday; i++) {
    html += `<div class="reportCalendarCell empty"></div>`;
  }

  for (let d = 1; d <= totalDays; d++) {
    const key = reportFormatYmd(new Date(now.getFullYear(), now.getMonth(), d));
    const raw = sum.daily[key] || {
      profit: 0,
      items: 0,
      visits: 0,
      success: 0
    };

    const profit = Math.max(0, Number(raw.profit || 0));
    const items = Math.max(0, Number(raw.items || 0));
    const visits = Math.max(0, Number(raw.visits || 0));

    const hasData = profit > 0 || items > 0 || visits > 0;

    html += `
      <div class="reportCalendarCell ${hasData ? "hasData" : ""}">
        <div class="reportCalendarDate">${d}</div>
        ${profit > 0 ? `<div class="reportCalendarLine">利益 ${profit.toLocaleString()}円</div>` : `<div class="reportCalendarDash">-</div>`}
        ${items > 0 ? `<div class="reportCalendarLine">個数 ${items}個</div>` : ``}
        ${visits > 0 ? `<div class="reportCalendarLine">訪問 ${visits}回</div>` : ``}
      </div>
    `;
  }

  const remain = (startWeekday + totalDays) % 7;
  if (remain !== 0) {
    for (let i = remain; i < 7; i++) {
      html += `<div class="reportCalendarCell empty"></div>`;
    }
  }

  html += `
      </div>
      ${
        sum.source === "stores"
          ? `<div class="mini" style="margin-top:8px;">※ 履歴ログが無い月は、最終訪問日ベースの簡易表示です</div>`
          : ""
      }
    </div>
  `;

  area.innerHTML = html;
}

function renderTopStores() {
  const area = document.getElementById("topStoresArea");
  if (!area) return;

  const stores = getStoresSafe();
  const top = getTopStores(stores, 20);

  if (!top.length) {
    area.innerHTML = `<div class="gray">店舗データがありません。</div>`;
    return;
  }

  area.innerHTML = `
    <div class="sectionTitle">🏆 上位店舗</div>
    <div class="store">
      <table>
        <thead>
          <tr>
            <th>順位</th>
            <th>店舗</th>
            <th>都道府県</th>
            <th>期待値</th>
            <th>成功率</th>
            <th>利益</th>
          </tr>
        </thead>
        <tbody>
          ${top.map((s, idx) => `
            <tr>
              <td>${idx + 1}</td>
              <td>${reportEscapeHtml(s.name)}</td>
              <td>${reportEscapeHtml(s.pref || "未設定")}</td>
              <td>${Math.round(s.expected).toLocaleString()}円</td>
              <td>${s.rate.toFixed(1)}%</td>
              <td>${Math.round(s.profit).toLocaleString()}円</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderCategorySummary() {
  const area = document.getElementById("categorySummaryArea");
  if (!area) return;

  const stores = getStoresSafe();
  const totals = {};

  stores.forEach(store => {
    const counts = store.categoryCounts || {};
    Object.entries(counts).forEach(([cat, qty]) => {
      const key = String(cat || "").trim();
      if (!key) return;
      totals[key] = (totals[key] || 0) + Number(qty || 0);
    });
  });

  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);

  if (!rows.length) {
    area.innerHTML = `<div class="gray">カテゴリ集計データがありません。</div>`;
    return;
  }

  area.innerHTML = `
    <div class="sectionTitle">📦 カテゴリ集計</div>
    <div class="store">
      <table>
        <thead>
          <tr>
            <th>カテゴリ</th>
            <th>個数</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(([cat, qty]) => `
            <tr>
              <td>${reportEscapeHtml(cat)}</td>
              <td>${Math.round(qty)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderReportPage() {
  renderSummary();
  renderCalendar();
  renderTopStores();
  renderCategorySummary();
}

/* =========================
   起動
========================= */
window.addEventListener("load", () => {
  renderReportPage();
});
