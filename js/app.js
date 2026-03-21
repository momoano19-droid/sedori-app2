const PRIMARY_STORE_KEY = "stores";
const PRIMARY_LOG_KEY = "logs";
const PRIMARY_LAYOUT_KEY = "layout";
const PRIMARY_AUTO_BACKUP_KEY = "auto_backup";

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

const LAYOUT_KEYS = [
  "layout",
  "sedori_layout_v2",
  "sedori_layout_v1",
  "sedori_layout_v3",
  "sedori_layout"
];

const AUTO_BACKUP_KEYS = [
  "auto_backup",
  "sedori_auto_backup_v2",
  "sedori_auto_backup_v1",
  "sedori_auto_backup_v3",
  "sedori_auto_backup"
];

let stores = loadStores();
let logs = loadLogs();
let layout = loadLayout();

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

function loadLayout() {
  const parsed = readFirstAvailable(LAYOUT_KEYS);
  return typeof parsed === "string" ? parsed : "detail";
}

function saveLayout(v) {
  localStorage.setItem(PRIMARY_LAYOUT_KEY, String(v || "detail"));
}

function saveAutoBackup() {
  try {
    localStorage.setItem(PRIMARY_AUTO_BACKUP_KEY, JSON.stringify({
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
        layout: parsed.layout || "detail"
      };
    } catch (e) {
      console.error("backup read error:", key, e);
    }
  }
  return null;
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

  return {
    visits,
    success,
    items,
    profit,
    rate,
    avgProfit,
    avgItems,
    expected
  };
}

/* =========================
   データ0件案内
========================= */
function showEmptyDataGuide() {
  const list = document.getElementById("storeList");
  if (!list) return;
  if (Array.isArray(stores) && stores.length > 0) return;

  list.innerHTML = `
    <div class="store" style="border:2px solid #ffd59a; background:#fffaf0;">
      <div class="storeTitle">データが見つかりません</div>

      <div class="mini" style="font-size:14px; line-height:1.7; color:#444; margin-top:8px;">
        iPhoneでは、Safariとホーム画面アプリで保存領域が分かれることがあります。<br>
        Safariで使っていたデータは、自動では引き継がれない場合があります。
      </div>

      <div class="row2" style="margin-top:12px;">
        <button onclick="document.getElementById('backupFile').click()">📥 バックアップ読込</button>
        <button class="secondary" onclick="restoreAutoBackup()">♻ 自動バックアップ復元</button>
      </div>

      <div class="mini" style="margin-top:10px;">
        ※ backup.json / sedori-backup-xxxx.json を読み込むと復元できます
      </div>
    </div>
  `;
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
        throw new Error("invalid backup");
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
    alert("このアプリ内に復元できる自動バックアップがありません。");
    return;
  }

  if (!confirm("自動バックアップで現在のデータを上書きします。よろしいですか？")) return;

  stores = Array.isArray(data.stores) ? data.stores.map(normalizeStore) : [];
  logs = Array.isArray(data.logs) ? data.logs : [];
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
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = text.match(/[?&](?:q|query|destination)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
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

  const n = clampNonNeg(parseInt(prompt("追加する個数", "1"), 10));
  if (!n) return;

  s.items += n;
  s.buyDays += 1;
  if (s.buyDays > s.visits) s.visits = s.buyDays;
  s.lastVisitDate = tokyoDateStr();

  addLog(s.id, "success", 1);
  addLog(s.id, "items", n);

  const cat = prompt("カテゴリ名（空なら未分類）", s.defaultCategory || "未分類");
  const useCat = String(cat || "未分類").trim() || "未分類";
  s.defaultCategory = useCat;
  s.categoryCounts[useCat] = (s.categoryCounts[useCat] || 0) + n;
  addLog(s.id, "category", n, useCat);

  saveAll();
  render();
}

function itemsMinus(i) {
  const s = stores[i];
  if (!s) return;

  const n = clampNonNeg(parseInt(prompt("減らす個数", "1"), 10));
  if (!n) return;

  s.items = clampNonNeg(s.items - n);
  addLog(s.id, "items", -n);

  saveAll();
  render();
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
   今日ルート
========================= */
function toggleToday(i, checked) {
  stores[i].today = !!checked;
  saveAll();
  buildTodayRoute(false);
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

function autoDetectNearbyStores() {
  if (!navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(
    pos => {
      window.lastPos = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      };
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

  let list = stores
    .map(s => ({ ...s, _m: getMetrics(s) }))
    .filter(s => typeof s.lat === "number" && typeof s.lng === "number")
    .filter(s => matchesQuery(s, q))
    .filter(s => prefFilter === "__ALL__" || s.pref === prefFilter);

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

function renderStoreCard(s, idx) {
  const m = getMetrics(s);

  let dist = null;
  if (window.lastPos && typeof s.lat === "number" && typeof s.lng === "number") {
    dist = distanceKm(window.lastPos.lat, window.lastPos.lng, s.lat, s.lng);
  }

  // 補充頻度（訪問間隔）
  const freq = m.visits > 0 ? (30 / m.visits).toFixed(1) : "-";

  const categorySummary = Object.entries(s.categoryCounts || {})
    .filter(([, qty]) => Number(qty) > 0)
    .map(([cat, qty]) => `${cat}:${qty}`)
    .join(" / ");

  return `
    <div class="store">

      <!-- タイトル -->
      <div class="storeTitle">${escapeHtml(s.name)}</div>

      <!-- バッジ -->
      <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">

        <span class="pill">${escapeHtml(s.pref || "未設定")}</span>

        ${typeof dist === "number" ? `
          <span class="pill" style="background:#e6f4ff; color:#1677ff;">
            📍 ${dist.toFixed(1)}km
          </span>
        ` : ""}

        ${s.mapUrl ? `
          <span class="pill" style="background:#e6fffb; color:#13c2c2;">
            🗺 MAPあり
          </span>
        ` : ""}

        ${s.today ? `
          <span class="pill" style="background:#fff1f0; color:#ff4d4f;">
            今日行く
          </span>
        ` : ""}

        ${s.defaultCategory ? `
          <span class="pill" style="background:#f9f0ff; color:#722ed1;">
            ${escapeHtml(s.defaultCategory)}
          </span>
        ` : ""}
      </div>

      <!-- 住所 -->
      ${s.address ? `
        <div class="mini" style="margin-top:8px;">
          📍 ${escapeHtml(s.address)}
        </div>
      ` : ""}

      <!-- メイン情報 -->
      <div style="
        margin-top:10px;
        padding:10px;
        border-radius:10px;
        background:#f7f9fc;
      ">
        <div style="font-size:16px; font-weight:800; color:#1677ff;">
          期待値：${Math.round(m.expected).toLocaleString()}円
        </div>

        <div class="mini" style="margin-top:6px; line-height:1.6;">
          利益：${m.profit.toLocaleString()}円 / 成功率：${m.rate.toFixed(1)}%<br>
          平均利益：${Math.round(m.avgProfit).toLocaleString()}円 / 平均個数：${m.avgItems.toFixed(1)}個<br>
          補充頻度：約 ${freq} 日に1回
        </div>
      </div>

      <!-- サブ情報 -->
      <div class="mini" style="margin-top:8px;">
        訪問：${m.visits}回 / 成功：${m.success}回 / 個数：${m.items}個
      </div>

      ${categorySummary ? `
        <div class="mini" style="margin-top:6px;">
          📦 ${escapeHtml(categorySummary)}
        </div>
      ` : ""}

      <!-- チェック -->
      <div class="checkline">
        <input type="checkbox" id="today_${idx}" ${s.today ? "checked" : ""} onchange="toggleToday(${idx}, this.checked)">
        <label for="today_${idx}">今日行く</label>
      </div>

      <!-- 操作 -->
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

  const q = document.getElementById("q")?.value?.trim() || "";
  const prefFilter = document.getElementById("prefFilter")?.value || "__ALL__";

  let list = stores.map((s, idx) => {
    const m = getMetrics(s);
    let dist = null;

    if (window.lastPos && typeof s.lat === "number" && typeof s.lng === "number") {
      dist = distanceKm(window.lastPos.lat, window.lastPos.lng, s.lat, s.lng);
    }

    return { ...s, _idx: idx, _m: m, _dist: dist };
  });

  list = list
    .filter(s => matchesQuery(s, q))
    .filter(s => prefFilter === "__ALL__" || s.pref === prefFilter);

  if (nearbyMode) {
    list = list.filter(s => nearbyStoreIds.has(s.id));
  }

  list.sort((a, b) => {
    const ad = typeof a._dist === "number" ? a._dist : Infinity;
    const bd = typeof b._dist === "number" ? b._dist : Infinity;
    if (nearbyMode && ad !== bd) return ad - bd;
    return b._m.expected - a._m.expected;
  });

  const wrap = document.getElementById("storeList");
  if (!wrap) return;

  wrap.innerHTML = list.length
    ? list.map(s => renderStoreCard(s, s._idx)).join("")
    : `<div class="gray">${nearbyMode ? "近くの店舗は見つかりませんでした。" : "該当する店舗がありません。"}</div>`;

  renderMapMarkers();
  buildTodayRoute(false);

  if (!stores.length) {
    showEmptyDataGuide();
  }
}
