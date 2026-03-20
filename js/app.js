const STORE_KEY = "sedori_stores_v1";
const LOG_KEY = "sedori_logs_v1";
const LAYOUT_KEY = "sedori_layout_v1";
const AUTO_BACKUP_KEY = "sedori_auto_backup_v1";
const QUICK_LIMIT = 12;

let stores = loadStores();
let logs = loadLogs();
let layout = loadLayout();

let qtyResolver = null;
let categoryResolver = null;

let nearbyMode = false;
let nearbyStoreIds = new Set();

let map = null;
let mapMarkers = [];
let mapInitialized = false;

window.lastPos = null;

/* =========================
   起動
========================= */
window.addEventListener("load", () => {
  initMap();
  render();
  setTimeout(() => autoDetectNearbyStores(true), 800);
});

/* =========================
   保存系
========================= */
function ensureId() {
  return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function normalizeStore(s) {
  return {
    id: s.id || ensureId(),
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
    quickCategories: Array.isArray(s.quickCategories) ? s.quickCategories.filter(Boolean).slice(0, QUICK_LIMIT) : [],
    lastVisitDate: String(s.lastVisitDate || "").trim(),
    today: !!s.today
  };
}

function loadStores() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeStore);
  } catch {
    return [];
  }
}

function saveStores(v) {
  localStorage.setItem(STORE_KEY, JSON.stringify(v));
}

function loadLogs() {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLogs(v) {
  localStorage.setItem(LOG_KEY, JSON.stringify(v));
}

function loadLayout() {
  return localStorage.getItem(LAYOUT_KEY) || "detail";
}

function saveLayout(v) {
  localStorage.setItem(LAYOUT_KEY, v);
}

function saveAutoBackup() {
  try {
    localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      stores,
      logs,
      layout
    }));
  } catch (e) {
    console.error(e);
  }
}

function getAutoBackup() {
  try {
    const raw = localStorage.getItem(AUTO_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.stores) || !Array.isArray(parsed.logs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveAll() {
  saveStores(stores);
  saveLogs(logs);
  saveLayout(layout);
  saveAutoBackup();
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
  const quicks = (s.quickCategories || []).join(" ");
  const text = [
    s.name,
    s.pref,
    s.address,
    s.defaultCategory,
    cats,
    quicks
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
  const restockCycle = success > 1 ? visits / success : 0;

  return {
    visits,
    success,
    items,
    profit,
    rate,
    avgProfit,
    avgItems,
    expected,
    restockCycle,
    strongWeekdays: []
  };
}

/* =========================
   バックアップ
========================= */
function exportBackup() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    stores,
    logs,
    layout
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
      if (!Array.isArray(parsed.stores) || !Array.isArray(parsed.logs)) {
        throw new Error("invalid");
      }

      if (!confirm("現在のデータをバックアップで上書きします。よろしいですか？")) {
        event.target.value = "";
        return;
      }

      stores = parsed.stores.map(normalizeStore);
      logs = parsed.logs;
      layout = parsed.layout || "detail";
      nearbyMode = false;
      nearbyStoreIds = new Set();

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
    alert("復元できる自動バックアップがありません。");
    return;
  }

  if (!confirm("自動バックアップで現在のデータを上書きします。よろしいですか？")) return;

  stores = data.stores.map(normalizeStore);
  logs = data.logs;
  layout = data.layout || "detail";
  nearbyMode = false;
  nearbyStoreIds = new Set();

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

  alert(`保存日時: ${data.savedAt || "不明"}\n店舗数: ${data.stores.length}件\nログ数: ${data.logs.length}件`);
}

/* =========================
   座標取得
========================= */
function extractLatLngFromMapUrl(url) {
  const text = String(url || "").trim();
  if (!text) return null;

  let m = text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) {
    return { lat: Number(m[1]), lng: Number(m[2]) };
  }

  m = text.match(/[?&](?:q|query|destination)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) {
    return { lat: Number(m[1]), lng: Number(m[2]) };
  }

  m = text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (m) {
    return { lat: Number(m[1]), lng: Number(m[2]) };
  }

  return null;
}

async function geocodeAddress(pref, address, name) {
  const q = [pref, address, name].filter(Boolean).join(" ").trim();
  if (!q) return null;

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json" }
    });

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
    const fromUrl = extractLatLngFromMapUrl(mapUrl);
    if (fromUrl) return fromUrl;

    if (showFailMessage) {
      alert("GoogleマップURLから座標を取得できませんでした。住所から取得を試します。");
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

function openMapSearchFromAddress() {
  const address = document.getElementById("address")?.value?.trim() || "";
  const pref = document.getElementById("prefName")?.value?.trim() || "";
  const name = document.getElementById("storeName")?.value?.trim() || "";

  const q = [pref, address, name].filter(Boolean).join(" ");
  if (!q) {
    alert("住所か店舗名を入れてください。");
    return;
  }

  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`, "_blank");
}

/* =========================
   店舗 CRUD
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
    quickCategories: [],
    lastVisitDate: "",
    today: false
  }));

  const storeNameEl = document.getElementById("storeName");
  const prefNameEl = document.getElementById("prefName");
  const addressEl = document.getElementById("address");
  const mapUrlEl = document.getElementById("mapUrl");

  if (storeNameEl) storeNameEl.value = "";
  if (prefNameEl) prefNameEl.value = "";
  if (addressEl) addressEl.value = "";
  if (mapUrlEl) mapUrlEl.value = "";

  saveAll();
  render();
}

async function editStore(i) {
  const s = stores[i];
  if (!s) return;

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

  saveAll();
  render();
}

function deleteStore(i) {
  const s = stores[i];
  if (!s) return;

  if (!confirm(`「${s.name}」を削除しますか？`)) return;

  stores.splice(i, 1);
  saveAll();
  render();
}

function navigateToStore(i) {
  const s = stores[i];
  if (!s) return;

  if (typeof s.lat === "number" && typeof s.lng === "number") {
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

/* =========================
   カテゴリ
========================= */
function normalizeCategoryCounts(s) {
  if (!s.categoryCounts || typeof s.categoryCounts !== "object") {
    s.categoryCounts = {};
  }
}

function getCategoryCandidates(s) {
  const quicks = Array.isArray(s.quickCategories) ? s.quickCategories : [];
  const existing = Object.keys(s.categoryCounts || {});
  return [...new Set([
    ...(s.defaultCategory ? [s.defaultCategory] : []),
    ...quicks,
    ...existing
  ].filter(Boolean))];
}

function refreshQuickCategories(s) {
  normalizeCategoryCounts(s);

  const positiveCats = Object.entries(s.categoryCounts)
    .filter(([, qty]) => Number(qty) > 0)
    .map(([cat]) => cat);

  const currentQuick = Array.isArray(s.quickCategories) ? s.quickCategories : [];

  s.quickCategories = [...new Set([
    ...(s.defaultCategory ? [s.defaultCategory] : []),
    ...positiveCats,
    ...currentQuick
  ])].filter(Boolean).slice(0, QUICK_LIMIT);
}

/* =========================
   訪問 / 個数 / 利益
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

async function itemsPlus(i) {
  const s = stores[i];
  if (!s) return;

  const n = await askItemQtyModal("追加する仕入れ個数を選んでください");
  if (!n) return;

  s.items += n;
  s.buyDays += 1;
  if (s.buyDays > s.visits) s.visits = s.buyDays;
  s.lastVisitDate = tokyoDateStr();

  addLog(s.id, "success", 1);
  addLog(s.id, "items", n);

  let categories = getCategoryCandidates(s);
  if (!categories.length && s.defaultCategory) {
    categories = [s.defaultCategory];
  }

  let remain = n;
  const picked = {};

  while (remain > 0) {
    const cat = await askCategoryModal(`カテゴリを選んでください（残り ${remain} 個）`, categories);
    if (!cat) break;

    const cleanCat = String(cat).trim();
    if (!cleanCat) break;

    const qty = await askItemQtyModal(`「${cleanCat}」に入れる個数を選んでください（残り ${remain} 個）`);
    if (!qty) break;

    if (qty > remain) {
      alert("残り個数を超えています。");
      continue;
    }

    picked[cleanCat] = (picked[cleanCat] || 0) + qty;
    remain -= qty;

    if (!Array.isArray(s.quickCategories)) s.quickCategories = [];
    s.quickCategories = [...new Set([cleanCat, ...s.quickCategories])].slice(0, QUICK_LIMIT);

    if (!categories.includes(cleanCat)) {
      categories.unshift(cleanCat);
    }
  }

  if (remain > 0) {
    const fallback = (s.defaultCategory || categories[0] || "未分類").trim() || "未分類";
    picked[fallback] = (picked[fallback] || 0) + remain;

    if (!Array.isArray(s.quickCategories)) s.quickCategories = [];
    s.quickCategories = [...new Set([fallback, ...s.quickCategories])].slice(0, QUICK_LIMIT);
  }

  normalizeCategoryCounts(s);
  Object.entries(picked).forEach(([cat, qty]) => {
    s.categoryCounts[cat] = (s.categoryCounts[cat] || 0) + qty;
    addLog(s.id, "category", qty, cat);
  });

  const usedCats = Object.keys(picked);
  if (usedCats.length === 1) {
    s.defaultCategory = usedCats[0];
  }

  refreshQuickCategories(s);
  saveAll();
  render();
}

async function itemsMinus(i) {
  const s = stores[i];
  if (!s) return;

  if (Number(s.items || 0) <= 0) {
    alert("個数がありません。");
    return;
  }

  normalizeCategoryCounts(s);

  const active = Object.entries(s.categoryCounts)
    .filter(([, qty]) => Number(qty) > 0)
    .map(([cat, qty]) => ({ cat, qty: Number(qty) }));

  let remain = await askItemQtyModal(`減らす個数を選んでください（現在 ${s.items} 個）`);
  if (!remain) return;

  if (remain > s.items) {
    alert("現在の個数より多くは減らせません。");
    return;
  }

  if (!active.length) {
    s.items = clampNonNeg(s.items - remain);
    addLog(s.id, "items", -remain);
    saveAll();
    render();
    return;
  }

  while (remain > 0) {
    const current = Object.entries(s.categoryCounts)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([cat, qty]) => ({ cat, qty: Number(qty) }));

    if (!current.length) break;

    const cat = await askCategoryModal(
      `減らすカテゴリを選んでください（残り ${remain} 個）`,
      current.map(x => `${x.cat}（${x.qty}）`)
    );
    if (!cat) break;

    const cleanCat = cat.replace(/（\d+）$/, "").trim();
    const maxQty = Number(s.categoryCounts[cleanCat] || 0);

    if (maxQty <= 0) {
      alert("カテゴリが見つかりません。");
      continue;
    }

    const qty = await askItemQtyModal(`「${cleanCat}」を何個減らしますか？（最大 ${Math.min(maxQty, remain)} 個）`);
    if (!qty) break;

    if (qty > remain || qty > maxQty) {
      alert("個数が不正です。");
      continue;
    }

    s.categoryCounts[cleanCat] = clampNonNeg((s.categoryCounts[cleanCat] || 0) - qty);
    s.items = clampNonNeg(s.items - qty);

    addLog(s.id, "items", -qty);
    addLog(s.id, "category", -qty, cleanCat);

    remain -= qty;
  }

  Object.keys(s.categoryCounts).forEach(cat => {
    if (Number(s.categoryCounts[cat]) <= 0) delete s.categoryCounts[cat];
  });

  refreshQuickCategories(s);
  saveAll();
  render();
}

function profitPlus(i) {
  const s = stores[i];
  if (!s) return;

  const d = clampNonNeg(parseInt(prompt("追加する利益（円）は？", "1000"), 10));
  if (!d) return;

  s.profit += d;
  addLog(s.id, "profit", d);

  saveAll();
  render();
}

function profitMinus(i) {
  const s = stores[i];
  if (!s) return;

  const d = clampNonNeg(parseInt(prompt("利益減算（円）は？", "1000"), 10));
  if (!d) return;

  s.profit = clampNonNeg(s.profit - d);
  addLog(s.id, "profit", -d);

  saveAll();
  render();
}

/* =========================
   今日ルート
========================= */
function toggleToday(i, checked) {
  stores[i].today = !!checked;
  saveAll();
  buildTodayRoute(false);
}

function todayBulkOn() {
  const pref = document.getElementById("todayPrefSelect")?.value || "__ALL__";
  stores.forEach(s => {
    if (pref === "__ALL__" || s.pref === pref) s.today = true;
  });
  saveAll();
  render();
}

function todayBulkOff() {
  const pref = document.getElementById("todayPrefSelect")?.value || "__ALL__";
  stores.forEach(s => {
    if (pref === "__ALL__" || s.pref === pref) s.today = false;
  });
  saveAll();
  render();
}

function buildTodayRoute(showAlert = false) {
  const area = document.getElementById("todayPlanArea");
  if (!area) return;

  const list = stores
    .map((s, idx) => {
      const m = getMetrics(s);
      let dist = null;
      if (window.lastPos && typeof s.lat === "number" && typeof s.lng === "number") {
        dist = distanceKm(window.lastPos.lat, window.lastPos.lng, s.lat, s.lng);
      }
      return { ...s, _idx: idx, _m: m, _dist: dist };
    })
    .filter(s => s.today);

  if (!list.length) {
    area.innerHTML = `<div class="gray">「今日行く」にチェックした店舗がありません。</div>`;
    return;
  }

  list.sort((a, b) => {
    const ad = typeof a._dist === "number" ? a._dist : Infinity;
    const bd = typeof b._dist === "number" ? b._dist : Infinity;
    if (ad !== bd) return ad - bd;
    return b._m.expected - a._m.expected;
  });

  area.innerHTML = `
    <div class="card">
      <div class="sectionTitle">🗓 今日のおすすめルート</div>
      <table>
        <thead>
          <tr>
            <th>順番</th>
            <th>店舗</th>
            <th>都道府県</th>
            <th>距離</th>
            <th>期待値</th>
          </tr>
        </thead>
        <tbody>
          ${list.map((s, idx) => `
            <tr>
              <td>${idx + 1}</td>
              <td>${escapeHtml(s.name)}</td>
              <td>${escapeHtml(s.pref || "未設定")}</td>
              <td>${typeof s._dist === "number" ? s._dist.toFixed(1) + "km" : "—"}</td>
              <td>${Math.round(s._m.expected).toLocaleString()}円</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  if (showAlert) {
    alert(`今日のルートを作成しました（${list.length}店舗）`);
  }
}

/* =========================
   近くの店舗
========================= */
function clearNearbyMode() {
  nearbyMode = false;
  nearbyStoreIds = new Set();
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
        if (typeof s.lat !== "number" || typeof s.lng !== "number") return;
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
      render();
    },
    () => alert("現在地を取得できませんでした。"),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function autoDetectNearbyStores(silent = true) {
  if (!navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(
    pos => {
      window.lastPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (!silent) render();
    },
    () => {},
    { enableHighAccuracy: true, timeout: 10000 }
  );
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

function toggleMapPanel() {
  const wrap = document.getElementById("mapWrap");
  if (!wrap) return;

  wrap.classList.toggle("show");

  if (wrap.classList.contains("show") && map) {
    setTimeout(() => {
      map.invalidateSize();
      renderMapMarkers();
    }, 150);
  }
}

function moveMapToCurrentLocation() {
  if (!navigator.geolocation) {
    alert("この端末では位置情報が使えません。");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      window.lastPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };

      const wrap = document.getElementById("mapWrap");
      if (wrap && !wrap.classList.contains("show")) wrap.classList.add("show");

      if (map) {
        map.setView([window.lastPos.lat, window.lastPos.lng], 15);
      }

      renderMapMarkers();
    },
    () => alert("現在地を取得できませんでした。"),
    { enableHighAccuracy: true, timeout: 10000 }
  );
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
    html: `<div class="marker-pin" style="background:${color};"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

function renderMapMarkers() {
  if (!mapInitialized || !map) return;

  clearMapMarkers();

  const q = document.getElementById("q")?.value?.trim() || "";
  const prefFilter = document.getElementById("prefFilter")?.value || "__ALL__";
  const minExpected = clampNonNeg(parseFloat(document.getElementById("minExpected")?.value || "0"));
  const minRate = clampNonNeg(parseFloat(document.getElementById("minRate")?.value || "0"));

  let list = stores
    .map(s => ({ ...s, _m: getMetrics(s) }))
    .filter(s => typeof s.lat === "number" && typeof s.lng === "number")
    .filter(s => matchesQuery(s, q))
    .filter(s => prefFilter === "__ALL__" || s.pref === prefFilter)
    .filter(s => s._m.expected >= minExpected)
    .filter(s => s._m.rate >= minRate);

  if (nearbyMode) {
    list = list.filter(s => nearbyStoreIds.has(s.id));
  }

  if (!list.length) return;

  const bounds = [];

  list.forEach(s => {
    const marker = L.marker([s.lat, s.lng], {
      icon: makeMarkerIcon(getMarkerColor(s._m.expected))
    }).addTo(map);

    marker.bindPopup(`
      <div><b>${escapeHtml(s.name)}</b></div>
      <div>${escapeHtml(s.pref || "未設定")}</div>
      <div>期待値：${Math.round(s._m.expected).toLocaleString()}円</div>
      <div>成功率：${s._m.rate.toFixed(1)}%</div>
    `);

    mapMarkers.push(marker);
    bounds.push([s.lat, s.lng]);
  });

  if (bounds.length === 1) {
    map.setView(bounds[0], 15);
  } else {
    map.fitBounds(bounds, { padding: [30, 30] });
  }
}

/* =========================
   モーダル: 個数
========================= */
function openQtyModal(title = "個数を選択") {
  const modal = document.getElementById("qtyModal");
  const titleEl = document.getElementById("qtyModalTitle");
  const manualArea = document.getElementById("qtyManualArea");
  const manualInput = document.getElementById("qtyManualInput");

  if (titleEl) titleEl.textContent = title;
  if (manualArea) manualArea.classList.remove("show");
  if (manualInput) manualInput.value = "";

  if (modal) {
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
  }
}

function closeQtyModal() {
  const modal = document.getElementById("qtyModal");
  if (modal) {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
  }

  if (typeof qtyResolver === "function") {
    const r = qtyResolver;
    qtyResolver = null;
    r(0);
  }
}

function resolveQtyModal(value) {
  const modal = document.getElementById("qtyModal");
  if (modal) {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
  }

  if (typeof qtyResolver === "function") {
    const r = qtyResolver;
    qtyResolver = null;
    r(Number(value) || 0);
  }
}

function selectQtyQuick(n) {
  resolveQtyModal(n);
}

function toggleQtyManual() {
  const area = document.getElementById("qtyManualArea");
  const input = document.getElementById("qtyManualInput");
  if (area) area.classList.add("show");
  if (input) input.focus();
}

function confirmQtyManual() {
  const n = clampNonNeg(parseInt(document.getElementById("qtyManualInput")?.value || "0", 10));
  if (!n) {
    alert("個数を入力してください。");
    return;
  }
  resolveQtyModal(n);
}

function askItemQtyModal(title) {
  return new Promise(resolve => {
    qtyResolver = resolve;
    openQtyModal(title);
  });
}

/* =========================
   モーダル: カテゴリ
========================= */
function openCategoryModal(title = "カテゴリを選択", categories = []) {
  const modal = document.getElementById("categoryModal");
  const titleEl = document.getElementById("categoryModalTitle");
  const listEl = document.getElementById("categoryList");
  const manualArea = document.getElementById("categoryManualArea");
  const manualInput = document.getElementById("categoryManualInput");

  if (titleEl) titleEl.textContent = title;
  if (listEl) listEl.innerHTML = "";
  if (manualArea) manualArea.classList.remove("show");
  if (manualInput) manualInput.value = "";

  categories.forEach(cat => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "categoryChoiceBtn";
    btn.textContent = cat;
    btn.onclick = () => resolveCategoryModal(cat);
    if (listEl) listEl.appendChild(btn);
  });

  if (modal) {
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
  }
}

function closeCategoryModal() {
  const modal = document.getElementById("categoryModal");
  if (modal) {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
  }

  if (typeof categoryResolver === "function") {
    const r = categoryResolver;
    categoryResolver = null;
    r("");
  }
}

function resolveCategoryModal(value) {
  const modal = document.getElementById("categoryModal");
  if (modal) {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
  }

  if (typeof categoryResolver === "function") {
    const r = categoryResolver;
    categoryResolver = null;
    r(String(value || "").trim());
  }
}

function toggleCategoryManual() {
  const area = document.getElementById("categoryManualArea");
  const input = document.getElementById("categoryManualInput");
  if (area) area.classList.add("show");
  if (input) input.focus();
}

function confirmCategoryManual() {
  const value = String(document.getElementById("categoryManualInput")?.value || "").trim();
  if (!value) {
    alert("カテゴリ名を入力してください。");
    return;
  }
  resolveCategoryModal(value);
}

function askCategoryModal(title, categories) {
  return new Promise(resolve => {
    categoryResolver = resolve;
    openCategoryModal(title, categories);
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
    `<option value="__ALL__">全都道府県</option>` +
    prefs.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");

  if (["__ALL__", ...prefs].includes(current)) {
    sel.value = current;
  }
}

function buildTodayPrefSelect() {
  const prefs = [...new Set(stores.map(s => s.pref).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  const sel = document.getElementById("todayPrefSelect");
  if (!sel) return;

  const current = sel.value || "__ALL__";
  sel.innerHTML =
    `<option value="__ALL__">全都道府県</option>` +
    prefs.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");

  if (["__ALL__", ...prefs].includes(current)) {
    sel.value = current;
  }
}

function renderStoreCard(s, idx) {
  const m = getMetrics(s);
  const dist = (window.lastPos && typeof s.lat === "number" && typeof s.lng === "number")
    ? distanceKm(window.lastPos.lat, window.lastPos.lng, s.lat, s.lng)
    : null;

  const nearBadge = dist !== null ? `<span class="badge near">📍 ${dist.toFixed(1)}km</span>` : "";
  const categorySummary = Object.entries(s.categoryCounts || {})
    .filter(([, qty]) => Number(qty) > 0)
    .map(([cat, qty]) => `${cat}:${qty}`)
    .join(" / ");

  return `
    <div class="store">
      <div class="storeTitle">${escapeHtml(s.name)}</div>

      <div>
        <span class="badge">${escapeHtml(s.pref || "未設定")}</span>
        ${s.address ? `<span class="badge addr">📍 住所あり</span>` : ""}
        ${(typeof s.lat === "number" && typeof s.lng === "number")
          ? `<span class="badge map">MAP表示可</span>`
          : `<span class="badge noCoord">座標なし</span>`}
        ${s.defaultCategory ? `<span class="badge">カテゴリ:${escapeHtml(s.defaultCategory)}</span>` : ""}
        ${s.lastVisitDate ? `<span class="badge">最終訪問:${escapeHtml(s.lastVisitDate)}</span>` : ""}
        ${s.today ? `<span class="badge">今日行く</span>` : ""}
        ${nearBadge}
      </div>

      ${s.address ? `<div class="mini" style="margin-top:6px;">住所：${escapeHtml(s.address)}</div>` : ""}
      ${categorySummary ? `<div class="mini" style="margin-top:6px;">個数内訳：${escapeHtml(categorySummary)}</div>` : ""}

      <div class="checkline">
        <input type="checkbox" id="today_${idx}" ${s.today ? "checked" : ""} onchange="toggleToday(${idx}, this.checked)">
        <label for="today_${idx}">今日行く</label>
      </div>

      <div class="meta">
        訪問：${m.visits}回 / 成功：${m.success}回 / 個数：${m.items}個<br>
        利益：${m.profit.toLocaleString()}円 / 成功率：${m.rate.toFixed(1)}%<br>
        平均利益：${Math.round(m.avgProfit).toLocaleString()}円 / 平均個数：${m.avgItems.toFixed(1)}個<br>
        <b>期待値：${Math.round(m.expected).toLocaleString()}円</b><br>
        距離：${dist !== null ? dist.toFixed(1) + "km" : "—"}
      </div>

      <div class="actionGrid">
        <button class="actionBtn visit" onclick="visit(${idx})">訪問<br><small>＋</small></button>
        <button class="actionBtn visitMinus" onclick="visitMinus(${idx})">訪問<br><small>−</small></button>

        <button class="actionBtn items" onclick="itemsPlus(${idx})">個数<br><small>＋</small></button>
        <button class="actionBtn itemsMinus" onclick="itemsMinus(${idx})">個数<br><small>−</small></button>

        <button class="actionBtn profit" onclick="profitPlus(${idx})">利益<br><small>＋</small></button>
        <button class="actionBtn profitMinus" onclick="profitMinus(${idx})">利益<br><small>−</small></button>

        <button class="actionBtn setting" onclick="editStore(${idx})">設定</button>
        <button class="actionBtn delete" onclick="deleteStore(${idx})">削除</button>
      </div>

      <div class="row2" style="margin-top:10px;">
        <button class="secondary" onclick="navigateToStore(${idx})">ナビ</button>
        <button class="secondary" onclick="refreshStoreCoordinates(${idx})">座標再取得</button>
      </div>
    </div>
  `;
}

function render() {
  buildPrefFilter();
  buildTodayPrefSelect();

  const q = document.getElementById("q")?.value?.trim() || "";
  const prefFilter = document.getElementById("prefFilter")?.value || "__ALL__";
  const minExpected = clampNonNeg(parseFloat(document.getElementById("minExpected")?.value || "0"));
  const minRate = clampNonNeg(parseFloat(document.getElementById("minRate")?.value || "0"));
  const sortType = document.getElementById("sortType")?.value || "expected";

  let list = stores.map((s, idx) => {
    const m = getMetrics(s);
    let dist = null;
    let score = -Infinity;

    if (window.lastPos && typeof s.lat === "number" && typeof s.lng === "number") {
      dist = distanceKm(window.lastPos.lat, window.lastPos.lng, s.lat, s.lng);
      score = m.expected / (dist + 0.2);
    }

    return { ...s, _idx: idx, _m: m, _dist: dist, _score: score };
  });

  list = list
    .filter(s => matchesQuery(s, q))
    .filter(s => prefFilter === "__ALL__" || s.pref === prefFilter)
    .filter(s => s._m.expected >= minExpected)
    .filter(s => s._m.rate >= minRate);

  if (nearbyMode) {
    list = list.filter(s => nearbyStoreIds.has(s.id));
  }

  list.sort((a, b) => {
    if (sortType === "route") {
      const ad = typeof a._dist === "number" ? a._dist : Infinity;
      const bd = typeof b._dist === "number" ? b._dist : Infinity;
      if (ad !== bd) return ad - bd;
      return b._m.expected - a._m.expected;
    }
    if (sortType === "rate") return b._m.rate - a._m.rate;
    if (sortType === "avgProfit") return b._m.avgProfit - a._m.avgProfit;
    if (sortType === "visits") return b._m.visits - a._m.visits;
    return b._m.expected - a._m.expected;
  });

  const wrap = document.getElementById("storeList");
  if (!wrap) return;

  wrap.innerHTML = list.length
    ? list.map(s => renderStoreCard(s, s._idx)).join("")
    : `<div class="gray">${nearbyMode ? "近くの店舗は見つかりませんでした。" : "該当する店舗がありません。"}</div>`;

  renderMapMarkers();
  buildTodayRoute(false);
}
