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

const PRIMARY_STORE_KEY = "stores";
const PRIMARY_LOG_KEY = "logs";
const PRIMARY_AUTO_BACKUP_KEY = "auto_backup";

let stores = loadStores();
let logs = loadLogs();

let nearbyMode = false;
let nearbyStoreIds = new Set();
let noCoordsOnlyMode = false;
let currentLayoutMode = localStorage.getItem("store_layout_mode") || "compact";

let map = null;
let mapMarkers = [];
let mapInitialized = false;
window.lastPos = null;

/* =========================
   個数＋カテゴリモーダル状態
========================= */
let qtyCategoryModalResolver = null;
let qtyCategoryCurrentQty = 1;
let qtyCategorySelected = {};

/* =========================
   起動
========================= */
window.addEventListener("load", () => {
  initMap();
  updateLayoutButtons();
  render();
  setTimeout(() => autoDetectNearbyStores(), 800);
  setupButtonPressEffect();
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
    mapUrl: String(s.mapUrl || "").trim(),
    lat: (s.lat !== null && s.lat !== "" && !isNaN(Number(s.lat))) ? Number(s.lat) : null,
    lng: (s.lng !== null && s.lng !== "" && !isNaN(Number(s.lng))) ? Number(s.lng) : null,
    visits: Number(s.visits || 0),
    buyDays: Number(s.buyDays || 0),
    items: Number(s.items || 0),
    profit: Number(s.profit || 0),
    defaultCategory: String(s.defaultCategory || "").trim(),
    categoryCounts: (s.categoryCounts && typeof s.categoryCounts === "object") ? s.categoryCounts : {},
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

function saveAutoBackup() {
  try {
    localStorage.setItem(PRIMARY_AUTO_BACKUP_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      stores,
      logs
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
        logs: Array.isArray(parsed.logs) ? parsed.logs : []
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
  const freq = visits > 0 ? (30 / visits) : 0;

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
  const n = Number(v || 0);
  if (!n) return "0日";
  if (Number.isInteger(n)) return `${n}日`;
  return `${n.toFixed(1).replace(/\.0$/, "")}日`;
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

function getCategoryHistory() {
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

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .map(([cat]) => cat)
    .slice(0, 12);
}

function resolveCategorySelectionInput(input, qty, history, defaultCategory) {
  const raw = String(input || "").trim();
  if (!raw) {
    const fallback = defaultCategory || "未分類";
    return { [fallback]: qty };
  }

  if (/^\d+$/.test(raw)) {
    const idx = Number(raw) - 1;
    if (history[idx]) {
      return { [history[idx]]: qty };
    }
  }

  if (!raw.includes(":") && !raw.includes(",")) {
    return { [raw]: qty };
  }

  const parsed = parseCategoryInput(raw);
  const total = sumCategoryCounts(parsed);

  if (total !== qty) {
    alert(`カテゴリ個数の合計(${total})と追加個数(${qty})が一致しません。`);
    return null;
  }

  return parsed;
}

/* =========================
   詳細 / 表示強化
========================= */
function updateLayoutButtons() {
  const detailBtn = document.getElementById("detailLayoutBtn");
  const compactBtn = document.getElementById("compactLayoutBtn");

  if (detailBtn) {
    detailBtn.classList.toggle("activeLayout", currentLayoutMode === "detail");
    if (currentLayoutMode === "detail") {
      detailBtn.classList.remove("ghostBtn");
      detailBtn.classList.add("primaryBtn");
    } else {
      detailBtn.classList.remove("primaryBtn");
      detailBtn.classList.add("ghostBtn");
    }
  }

  if (compactBtn) {
    compactBtn.classList.toggle("activeLayout", currentLayoutMode === "compact");
    if (currentLayoutMode === "compact") {
      compactBtn.classList.remove("ghostBtn");
      compactBtn.classList.add("primaryBtn");
    } else {
      compactBtn.classList.remove("primaryBtn");
      compactBtn.classList.add("ghostBtn");
    }
  }
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
  if (!lastVisitDate) return "";
  const today = new Date(tokyoDateStr());
  const last = new Date(lastVisitDate);
  const diff = Math.floor((today - last) / (1000 * 60 * 60 * 24));

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

  const recentVisitCount = recentVisitLogs.reduce((sum, l) => sum + Math.max(1, Number(l.delta || 1)), 0);

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

/* =========================
   バックアップ
========================= */
function exportBackup() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    stores,
    logs
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
      if (!Array.isArray(parsed.stores)) throw new Error("invalid backup");

      if (!confirm("現在のデータをバックアップで上書きします。よろしいですか？")) {
        event.target.value = "";
        return;
      }

      stores = parsed.stores.map(normalizeStore);
      logs = Array.isArray(parsed.logs) ? parsed.logs : [];
      nearbyMode = false;
      noCoordsOnlyMode = false;
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
  nearbyMode = false;
  noCoordsOnlyMode = false;
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
async function expandShortUrlIfNeeded(url) {
  try {
    const text = String(url || "").trim();
    if (!text) return text;

    const lower = text.toLowerCase();
    if (
      lower.includes("maps.app.goo.gl") ||
      lower.includes("goo.gl/maps") ||
      lower.includes("g.co/kgs")
    ) {
      const res = await fetch(text, { redirect: "follow", mode: "cors" });
      return res.url || text;
    }

    return text;
  } catch {
    return url;
  }
}

function extractLatLngFromMapUrl(url) {
  const text = String(url || "").trim();
  if (!text) return null;

  let m = text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = text.match(/[?&](?:q|query|destination)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = text.match(/[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = text.match(/[?&]sll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = text.match(/\/search\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = text.match(/\/place\/.*?\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
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
    const expanded = await expandShortUrlIfNeeded(mapUrl);
    const fromUrl = extractLatLngFromMapUrl(expanded);
    if (fromUrl) return fromUrl;

    if (showFailMessage) {
      alert("共有URLから座標を取得できませんでした。住所から取得を試します。");
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
    lastVisitDate: "",
    today: false
  }));

  document.getElementById("storeName").value = "";
  document.getElementById("prefName").value = "";
  document.getElementById("address").value = "";
  document.getElementById("mapUrl").value = "";

  saveAll();
  render();
}

async function editStore(i) {
  const s = stores[i];
  if (!s) return;

  const menu = prompt(
`設定メニュー
1: 基本情報編集
2: カテゴリを追加
3: カテゴリを減らす
4: 成功を増やす
5: 成功を減らす
6: デフォルトカテゴリ変更

番号を入力してください`,
    "1"
  );

  if (menu === null) return;

  if (menu === "1") {
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
  }

  if (menu === "2") {
    const text = prompt("追加するカテゴリを入力\n例: 楽器:2, 家電:1", "");
    if (text !== null) {
      const deltaMap = parseCategoryInput(text);
      applyCategoryDelta(s, deltaMap, 1);
      s.items = sumCategoryCounts(s.categoryCounts);
      Object.entries(deltaMap).forEach(([cat, qty]) => addLog(s.id, "category", qty, cat));
    }
  }

  if (menu === "3") {
    const text = prompt("減らすカテゴリを入力\n例: 楽器:1, 家電:1", "");
    if (text !== null) {
      const deltaMap = parseCategoryInput(text);
      applyCategoryDelta(s, deltaMap, -1);
      s.items = sumCategoryCounts(s.categoryCounts);
      Object.entries(deltaMap).forEach(([cat, qty]) => addLog(s.id, "category", -qty, cat));
    }
  }

  if (menu === "4") {
    const n = clampNonNeg(parseInt(prompt("増やす成功回数", "1"), 10));
    if (n) {
      s.buyDays += n;
      if (s.buyDays > s.visits) s.visits = s.buyDays;
      addLog(s.id, "success", n);
    }
  }

  if (menu === "5") {
    const n = clampNonNeg(parseInt(prompt("減らす成功回数", "1"), 10));
    if (n) {
      s.buyDays = Math.max(0, s.buyDays - n);
      addLog(s.id, "success", -n);
    }
  }

  if (menu === "6") {
    const cat = prompt("デフォルトカテゴリ", s.defaultCategory || "");
    if (cat !== null) {
      s.defaultCategory = String(cat).trim();
    }
  }

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

  if (hasCoords(s)) {
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

async function refreshAllCoordinates() {
  const targets = stores.filter(s => !hasCoords(s));
  if (!targets.length) {
    alert("座標なし店舗はありません。");
    return;
  }

  if (!confirm(`座標なし店舗 ${targets.length} 件の座標を再取得します。よろしいですか？`)) return;

  for (const s of targets) {
    const pos = await resolveStoreLatLng(s.pref, s.address, s.name, s.mapUrl, false);
    s.lat = pos.lat;
    s.lng = pos.lng;
  }

  saveAll();
  render();
  alert("座標再取得が完了しました。");
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

  const history = getCategoryHistory();

  openQtyCategoryModal({
    history,
    defaultCategory: s.defaultCategory
  }).then(result => {
    if (!result) return;

    const n = clampNonNeg(parseInt(result.qty || "0", 10));
    const catMap = result.categoryMap && typeof result.categoryMap === "object"
      ? result.categoryMap
      : null;

    if (!n || !catMap) return;

    const keys = Object.keys(catMap);
    if (!keys.length) return;

    const total = Object.values(catMap).reduce((sum, v) => sum + Number(v || 0), 0);
    if (total !== n) {
      alert("カテゴリ個数の合計が一致していません。");
      return;
    }

    s.items += n;
    s.buyDays += 1;
    if (s.buyDays > s.visits) s.visits = s.buyDays;
    s.lastVisitDate = tokyoDateStr();

    addLog(s.id, "success", 1);
    addLog(s.id, "items", n);

    keys.forEach(cat => {
      const addQty = clampNonNeg(catMap[cat] || 0);
      if (!addQty) return;

      s.categoryCounts[cat] = (s.categoryCounts[cat] || 0) + addQty;
      addLog(s.id, "category", addQty, cat);
    });

    const firstCat = keys[0];
    if (firstCat) s.defaultCategory = firstCat;

    saveAll();
    render();
  });
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
   今日行く / ルート
========================= */
function toggleToday(i, checked) {
  const s = stores[i];
  if (!s) return;
  s.today = !!checked;
  saveAll();
  render();
}

function clearTodayChecks() {
  stores.forEach(s => {
    s.today = false;
  });
  saveAll();
  render();
}

function buildTodayRoute() {
  const targets = stores.filter(s => s.today);

  if (!targets.length) {
    alert("「今日行く」にチェックした店舗がありません。");
    return;
  }

  const usable = targets.filter(s => hasCoords(s) || s.address);
  if (!usable.length) {
    alert("ルートに使える住所または座標がある店舗がありません。");
    return;
  }

  let sorted = [...usable];

  if (window.lastPos) {
    sorted.sort((a, b) => {
      const ad = hasCoords(a) ? distanceKm(window.lastPos.lat, window.lastPos.lng, a.lat, a.lng) : Infinity;
      const bd = hasCoords(b) ? distanceKm(window.lastPos.lat, window.lastPos.lng, b.lat, b.lng) : Infinity;
      return ad - bd;
    });
  }

  const makeDest = s => {
    if (hasCoords(s)) return `${s.lat},${s.lng}`;
    return s.address;
  };

  const origin = "Current Location";
  const destination = makeDest(sorted[sorted.length - 1]);
  const waypoints = sorted.slice(0, -1).map(makeDest).slice(0, 8);

  const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving${waypoints.length ? `&waypoints=${encodeURIComponent(waypoints.join("|"))}` : ""}`;

  window.open(url, "_blank");
}

/* =========================
   近くの店舗 / 現在地
========================= */
function clearNearbyMode() {
  nearbyMode = false;
  noCoordsOnlyMode = false;
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
        if (!hasCoords(s)) return;
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
      noCoordsOnlyMode = false;
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

function moveToCurrentLocation() {
  if (!map || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      window.lastPos = { lat, lng };
      map.setView([lat, lng], 15);
    },
    () => alert("現在地を取得できませんでした。")
  );
}

function showNoCoordsOnly() {
  noCoordsOnlyMode = true;
  nearbyMode = false;
  render();
}

function setLayoutMode(mode) {
  currentLayoutMode = mode === "compact" ? "compact" : "detail";
  localStorage.setItem("store_layout_mode", currentLayoutMode);
  updateLayoutButtons();
  render();
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
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.25);"></div>`,
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
    .filter(s => hasCoords(s))
    .filter(s => matchesQuery(s, q))
    .filter(s => prefFilter === "__ALL__" || s.pref === prefFilter)
    .filter(s => s._m.expected >= minExpected)
    .filter(s => s._m.rate >= minRate);

  if (nearbyMode) {
    list = list.filter(s => nearbyStoreIds.has(s.id));
  }

  if (noCoordsOnlyMode) {
    list = [];
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
    map.fitBounds(bounds, { padding: [20, 20] });
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
    `<option value="__ALL__">全て（都道府県ごと）</option>` +
    prefs.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");

  if (["__ALL__", ...prefs].includes(current)) {
    sel.value = current;
  }
}

function renderStoreCard(s, idx) {
  const m = getMetrics(s);
  const evalData = getStoreEvaluationLabel(m);
  const rateClass = getRateClass(m.rate);
  const expectedClass = getExpectedCardClass(m.expected);
  const staleClass = getStaleCardClass(s.lastVisitDate);
  const recent = getRecentStats(s.id);
  const streak = getNoSuccessStreak(s.id);

  let dist = null;
  if (window.lastPos && hasCoords(s)) {
    dist = distanceKm(window.lastPos.lat, window.lastPos.lng, s.lat, s.lng);
  }

  const categorySummary = Object.entries(s.categoryCounts || {})
    .filter(([, qty]) => Number(qty) > 0)
    .map(([cat, qty]) => `${cat}:${qty}`)
    .join(" / ");

  const compact = currentLayoutMode === "compact";

  return `
    <div class="item ${expectedClass} ${staleClass}">
      <div class="evalLabel ${evalData.class}">
        ${evalData.label}
      </div>

      <div class="name">${escapeHtml(s.name)}</div>

      <div style="margin-top:6px;">
        <span class="badge">${escapeHtml(s.pref || "未設定")}</span>
        ${typeof dist === "number" ? `<span class="badge near">📍 ${dist.toFixed(1)}km</span>` : ``}
        ${s.mapUrl ? `<span class="badge map">🗺 MAPあり</span>` : ``}
        ${hasCoords(s) ? `<span class="badge" style="background:#eef8ff;color:#2563eb;">📡 座標あり</span>` : ``}
        <span class="badge freq">補充頻度 ${formatRestockDays(m.freq)}</span>
      </div>

      ${s.address ? `<div class="mini mt8">📍 ${escapeHtml(s.address)}</div>` : ``}

      ${compact ? `
        <div class="mini mt8">
          期待値 ${Math.round(m.expected).toLocaleString()}円 / 利益 ${m.profit.toLocaleString()}円 /
          <span class="${rateClass}">成功率 ${m.rate.toFixed(1)}%</span>
        </div>

        <div class="mini mt8">
          訪問 ${m.visits}回 / 成功 ${m.success}回 / 個数 ${m.items}個
        </div>
      ` : `
        <div class="mini mt8">
          期待値：${Math.round(m.expected).toLocaleString()}円
        </div>

        <div class="mini mt8" style="line-height:1.6;">
          利益：${m.profit.toLocaleString()}円 / <span class="${rateClass}">成功率：${m.rate.toFixed(1)}%</span><br>
          平均利益：${Math.round(m.avgProfit).toLocaleString()}円 / 平均個数：${m.avgItems.toFixed(1)}個
        </div>

        <div class="mini mt8">
          訪問：${m.visits}回 / 成功：${m.success}回 / 個数：${m.items}個
        </div>

        ${categorySummary ? `<div class="mini mt8">📦 ${escapeHtml(categorySummary)}</div>` : ``}

        <div class="detailBox">
          <div class="detailLine">📅 最終訪問：${s.lastVisitDate ? escapeHtml(s.lastVisitDate) : "なし"}</div>
          <div class="detailLine">📊 直近3回：成功 ${recent.recentSuccess}回 / ${recent.recentVisitCount}訪問（${recent.recentRate.toFixed(1)}%）</div>
          <div class="detailLine">💰 訪問あたり期待値：${Math.round(m.expected).toLocaleString()}円</div>
          ${streak >= 3 ? `<div class="detailLine detailWarn">⚠️ ${streak}回連続成功なし</div>` : ``}
        </div>
      `}

      <div class="mt8">
        <label style="font-size:13px;">
          <input type="checkbox" ${s.today ? "checked" : ""} onchange="toggleToday(${idx}, this.checked)">
          今日行く
        </label>
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#dff7e8", "#129b52")} onclick="visit(${idx})">訪問＋</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="visitMinus(${idx})">訪問−</button>
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#e7f0ff", "#2563eb")} onclick="itemsPlus(${idx})">個数＋</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="itemsMinus(${idx})">個数−</button>
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#fff0e1", "#ea580c")} onclick="profitPlus(${idx})">利益＋</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="profitMinus(${idx})">利益−</button>
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="navigateToStore(${idx})">ナビ</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="refreshStoreCoordinates(${idx})">座標再取得</button>
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="editStore(${idx})">設定</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="deleteStore(${idx})">削除</button>
      </div>
    </div>
  `;
}

function showEmptyDataGuide() {
  const list = document.getElementById("storeList");
  if (!list) return;
  if (stores.length > 0) return;

  list.innerHTML = `
    <div class="card">
      <div class="sectionTitle">データが見つかりません</div>
      <div class="mini" style="font-size:14px; line-height:1.7; color:#444;">
        iPhoneでは、Safariとホーム画面アプリで保存領域が分かれることがあります。<br>
        backup.json / sedori-backup-xxxx.json を読み込むと復元できます。
      </div>
      <div class="row2 mt8">
        <button onclick="document.getElementById('backupFile').click()">📥 バックアップ読込</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="restoreAutoBackup()">♻ 自動バックアップ復元</button>
      </div>
    </div>
  `;
}

function render() {
  updateLayoutButtons();
  buildPrefFilter();

  const q = document.getElementById("q")?.value?.trim() || "";
  const prefFilter = document.getElementById("prefFilter")?.value || "__ALL__";
  const minExpected = clampNonNeg(parseFloat(document.getElementById("minExpected")?.value || "0"));
  const minRate = clampNonNeg(parseFloat(document.getElementById("minRate")?.value || "0"));
  const sortType = document.getElementById("sortType")?.value || "expected";

  let list = stores.map((s, idx) => {
    const m = getMetrics(s);
    let dist = null;
    if (window.lastPos && hasCoords(s)) {
      dist = distanceKm(window.lastPos.lat, window.lastPos.lng, s.lat, s.lng);
    }
    return { ...s, _idx: idx, _m: m, _dist: dist };
  });

  list = list
    .filter(s => matchesQuery(s, q))
    .filter(s => prefFilter === "__ALL__" || s.pref === prefFilter)
    .filter(s => s._m.expected >= minExpected)
    .filter(s => s._m.rate >= minRate);

  if (nearbyMode) {
    list = list.filter(s => nearbyStoreIds.has(s.id));
  }

  if (noCoordsOnlyMode) {
    list = list.filter(s => !hasCoords(s));
  }

  list.sort((a, b) => {
    if (sortType === "rate") return b._m.rate - a._m.rate;
    if (sortType === "avgProfit") return b._m.avgProfit - a._m.avgProfit;
    if (sortType === "visits") return b._m.visits - a._m.visits;
    if (sortType === "route") {
      const ad = typeof a._dist === "number" ? a._dist : Infinity;
      const bd = typeof b._dist === "number" ? b._dist : Infinity;
      return ad - bd;
    }
    return b._m.expected - a._m.expected;
  });

  const wrap = document.getElementById("storeList");
  if (!wrap) return;

  wrap.innerHTML = list.length
    ? list.map(s => renderStoreCard(s, s._idx)).join("")
    : `<div class="mini">${nearbyMode ? "近くの店舗は見つかりませんでした。" : "該当する店舗がありません。"}</div>`;

  renderMapMarkers();
  renderTodayRouteList();

  if (!stores.length) {
    showEmptyDataGuide();
  }
}

function renderTodayRouteList() {
  const el = document.getElementById("todayRouteList");
  if (!el) return;

  const checkedStores = stores.filter(s => s.today);

  if (!checkedStores.length) {
    el.innerHTML = "チェックした店舗はまだありません。";
    return;
  }

  const names = checkedStores.map((s, i) => {
    return `${i + 1}. ${escapeHtml(s.name)}`;
  });

  el.innerHTML = `
    <div style="font-weight:700; margin-bottom:6px;">今日行く店舗</div>
    <div style="line-height:1.8;">${names.join("<br>")}</div>
  `;
}

/* =========================
   使い方ガイド
========================= */
let helpStep = 0;

const helpData = [
  {
    title: "📘 このツールでできること",
    content: `
      <b>このツールは、せどり店舗を記録・分析して、行く価値の高い店舗を見つけるための管理ツールです。</b><br><br>
      ・店舗ごとの実績を記録できる<br>
      ・期待値、成功率、利益を自動で見られる<br>
      ・近くの店舗をすぐ探せる<br>
      ・今日行く店舗でルートを作れる<br>
      ・分析画面で月別 / 日別の振り返りができる
    `
  },
  {
    title: "🚀 基本の使い方",
    content: `
      <b>まずはこの流れだけ覚えればOKです。</b><br><br>
      ① 店舗を登録する<br>
      ② 店に行ったら「訪問＋」を押す<br>
      ③ 仕入れできたら「個数＋」を押す<br>
      ④ 利益が分かったら「利益＋」を押す<br><br>
      → これだけで店舗ごとの実績がたまり、自動で分析されます。
    `
  },
  {
    title: "🏪 店舗登録のやり方",
    content: `
      <b>登録時は次の4つを入れます。</b><br><br>
      ・店舗名<br>
      ・都道府県<br>
      ・住所<br>
      ・GoogleマップURL（あれば便利）<br><br>
      <b>ポイント</b><br>
      ・住所だけでも登録できます<br>
      ・GoogleマップURLがあると座標を取りやすくなります<br>
      ・座標が取れると「近くの店舗」や地図表示に使えます
    `
  },
  {
    title: "📊 店舗カードの見方",
    content: `
      <b>店舗カードには、その店の強さがまとまっています。</b><br><br>
      ・期待値 → その店に行った時の価値<br>
      ・利益 → その店で出た累計利益<br>
      ・成功率 → 行った時に仕入れできる割合<br>
      ・訪問 / 成功 / 個数 → 実績の回数<br><br>
      <b>見方のコツ</b><br>
      ・期待値が高い店ほど優先<br>
      ・成功率が高い店ほど安定<br>
      ・利益が大きい店は主力候補
    `
  },
  {
    title: "🧭 コンパクトと詳細の違い",
    content: `
      <b>表示モードは2種類あります。</b><br><br>
      <b>【コンパクト】</b><br>
      一覧でサッと見る用です。<br>
      店舗を多く並べて、素早く判断したい時に向いています。<br><br>
      <b>【詳細】</b><br>
      その店舗を行くべきか判断するための情報を多く表示します。<br><br>
      <b>詳細で追加される情報</b><br>
      ・最終訪問日<br>
      ・直近3回の成績<br>
      ・訪問あたり期待値<br>
      ・連敗アラート
    `
  },
  {
    title: "📍 近くの店舗機能",
    content: `
      <b>現在地を使って近くの店舗を探せます。</b><br><br>
      ・「近くの店舗（3km）」で現在地の近くを表示<br>
      ・3km以内が無い時は近い順で表示<br>
      ・「現在地へ移動」で地図を今いる場所に移動<br><br>
      <b>座標が入っている店舗ほど便利に使えます。</b>
    `
  },
  {
    title: "🛣 今日ルート機能",
    content: `
      <b>今日回る店舗をまとめてルート化できます。</b><br><br>
      ① 店舗カードの「今日行く」にチェック<br>
      ② 「今日ルート作成」を押す<br>
      ③ Googleマップでルートを開く
    `
  },
  {
    title: "📦 バックアップ",
    content: `
      <b>バックアップはかなり重要です。</b><br><br>
      ・「手動バックアップ」でJSON保存<br>
      ・「バックアップ読込」で復元<br>
      ・「自動バックアップ」で内部保存
    `
  }
];

function openHelp() {
  helpStep = 0;
  const el = document.getElementById("helpUI");
  if (!el) return;
  el.classList.add("show");
  renderHelp();
}

function closeHelp() {
  const el = document.getElementById("helpUI");
  if (!el) return;
  el.classList.remove("show");
}

function renderHelp() {
  const data = helpData[helpStep];
  const titleEl = document.getElementById("helpTitle");
  const contentEl = document.getElementById("helpContent");
  if (!titleEl || !contentEl) return;
  titleEl.innerHTML = data.title;
  contentEl.innerHTML = data.content;
}

function nextHelp() {
  if (helpStep < helpData.length - 1) {
    helpStep++;
    renderHelp();
  }
}

function prevHelp() {
  if (helpStep > 0) {
    helpStep--;
    renderHelp();
  }
}

/* =========================
   個数＋カテゴリモーダル
========================= */
function ensureQtyCategoryModal() {
  if (document.getElementById("qtyCategoryModal")) return;

  const modal = document.createElement("div");
  modal.id = "qtyCategoryModal";
  modal.className = "qtyCategoryModal";
  modal.innerHTML = `
    <div class="qtyCategoryCard">
      <div class="qtyCategoryTitle">個数とカテゴリを選択</div>
      <div class="qtyCategorySub">合計個数を決めて、カテゴリごとに個数を調整してください</div>

      <div class="qtyCategorySectionTitle">合計個数を選択</div>
      <div class="qtyQuickButtons">
        <button type="button" class="qtyQuickBtn" data-qty="1" onclick="selectQuickQty(1)">1</button>
        <button type="button" class="qtyQuickBtn" data-qty="2" onclick="selectQuickQty(2)">2</button>
        <button type="button" class="qtyQuickBtn" data-qty="3" onclick="selectQuickQty(3)">3</button>
        <button type="button" class="qtyQuickBtn" data-qty="4" onclick="selectQuickQty(4)">4</button>
        <button type="button" class="qtyQuickBtn" data-qty="5" onclick="selectQuickQty(5)">5</button>
      </div>

      <div class="qtyManualRow">
        <input id="qtyManualInput" class="qtyManualInput" type="number" min="1" step="1" placeholder="5以上はここに入力">
        <button type="button" class="qtyManualBtn" onclick="applyManualQty()">手入力反映</button>
      </div>

      <div class="qtySelectedBox">
        合計個数: <span id="qtySelectedValue">1</span>個
      </div>

      <div class="qtyCategorySectionTitle">履歴カテゴリ</div>
      <div id="qtyCategoryChipWrap" class="categoryChipWrap"></div>

      <div class="qtyCategorySectionTitle">新しいカテゴリを追加</div>
      <div class="categoryAddRow">
        <input id="qtyNewCategoryInput" class="categoryTextInput" placeholder="新しいカテゴリ名を入力">
        <button type="button" class="categoryAddBtn" onclick="addNewQtyCategoryChip()">追加</button>
      </div>

      <div class="qtyCategorySectionTitle">カテゴリごとの個数</div>
      <div id="qtyCategoryCountEditor" class="qtyCategoryCountEditor">
        <div class="qtyCategoryEmpty">カテゴリを選択してください</div>
      </div>

      <div class="qtyRemainPanel" id="qtyRemainPanel">
        <div class="qtyRemainLabel">残り</div>
        <div class="qtyRemainValue" id="qtyRemainValue">1</div>
        <div class="qtyRemainUnit">個</div>
      </div>

      <div class="qtySelectedBox qtyCategoryTotalCheck" id="qtyCategoryTotalCheck">
        入力合計: <span id="qtyAssignedTotal">0</span> / <span id="qtyAssignedTarget">1</span>個
      </div>

      <div class="categoryPickerActions">
        <button type="button" class="ghostBtn" onclick="closeQtyCategoryModal(null)">キャンセル</button>
        <button type="button" class="primaryBtn" onclick="confirmQtyCategoryModal()">OK</button>
      </div>
    </div>
  `;

  modal.addEventListener("click", e => {
    if (e.target === modal) closeQtyCategoryModal(null);
  });

  document.body.appendChild(modal);
}

function openQtyCategoryModal({ history = [], defaultCategory = "" }) {
  ensureQtyCategoryModal();

  const modal = document.getElementById("qtyCategoryModal");
  const chipWrap = document.getElementById("qtyCategoryChipWrap");
  const manualInput = document.getElementById("qtyManualInput");

  qtyCategoryCurrentQty = 1;
  qtyCategorySelected = {};

  let categories = [...history];
  if (defaultCategory && !categories.includes(defaultCategory)) {
    categories.unshift(defaultCategory);
  }
  if (!categories.length) {
    categories = ["未分類"];
  }

  chipWrap.innerHTML = categories.map(cat => `
    <button
      type="button"
      class="categoryChip"
      data-cat="${escapeHtml(cat)}"
      onclick="toggleQtyCategoryChip('${escapeJsString(cat)}')"
    >
      ${escapeHtml(cat)}
    </button>
  `).join("");

  manualInput.value = "";
  updateQtySelectedValue();
  renderQtyQuickButtons();
  renderQtyCategoryChipState();
  renderQtyCategoryCountEditor();
  updateQtyAssignedSummary();

  modal.classList.add("show");

  return new Promise(resolve => {
    qtyCategoryModalResolver = resolve;
  });
}

function selectQuickQty(n) {
  qtyCategoryCurrentQty = Number(n || 1);
  updateQtySelectedValue();
  renderQtyQuickButtons();
  updateQtyAssignedSummary();
}

function applyManualQty() {
  const input = document.getElementById("qtyManualInput");
  if (!input) return;

  const n = clampNonNeg(parseInt(input.value || "0", 10));
  if (!n) {
    alert("1以上の個数を入力してください。");
    return;
  }

  qtyCategoryCurrentQty = n;
  updateQtySelectedValue();
  renderQtyQuickButtons();
  updateQtyAssignedSummary();
}

function updateQtySelectedValue() {
  const valueEl = document.getElementById("qtySelectedValue");
  const targetEl = document.getElementById("qtyAssignedTarget");
  if (valueEl) valueEl.textContent = String(qtyCategoryCurrentQty);
  if (targetEl) targetEl.textContent = String(qtyCategoryCurrentQty);
}

function renderQtyQuickButtons() {
  document.querySelectorAll(".qtyQuickBtn").forEach(btn => {
    const n = Number(btn.getAttribute("data-qty") || "0");
    btn.classList.toggle("active", n === qtyCategoryCurrentQty);
  });
}

function toggleQtyCategoryChip(cat) {
  if (qtyCategorySelected[cat]) {
    delete qtyCategorySelected[cat];
  } else {
    qtyCategorySelected[cat] = 1;
  }
  renderQtyCategoryChipState();
  renderQtyCategoryCountEditor();
  updateQtyAssignedSummary();
}

function renderQtyCategoryChipState() {
  document.querySelectorAll("#qtyCategoryChipWrap .categoryChip").forEach(el => {
    const cat = el.getAttribute("data-cat");
    el.classList.toggle("active", !!qtyCategorySelected[cat]);
  });
}

function renderQtyCategoryCountEditor() {
  const wrap = document.getElementById("qtyCategoryCountEditor");
  if (!wrap) return;

  const keys = Object.keys(qtyCategorySelected);
  if (!keys.length) {
    wrap.innerHTML = `<div class="qtyCategoryEmpty">カテゴリを選択してください</div>`;
    return;
  }

  wrap.innerHTML = keys.map(cat => {
    const value = clampNonNeg(qtyCategorySelected[cat] || 0);
    return `
      <div class="qtyCategoryCountRow">
        <div class="qtyCategoryCountName">${escapeHtml(cat)}</div>
        <div class="qtyStepper">
          <button type="button" class="qtyStepBtn minus" onclick="changeQtyCategoryCount('${escapeJsString(cat)}', -1)">−</button>
          <div class="qtyStepValue">${value}</div>
          <button type="button" class="qtyStepBtn plus" onclick="changeQtyCategoryCount('${escapeJsString(cat)}', 1)">＋</button>
        </div>
      </div>
    `;
  }).join("");
}

function changeQtyCategoryCount(cat, delta) {
  const current = clampNonNeg(qtyCategorySelected[cat] || 0);
  const next = Math.max(0, current + Number(delta || 0));
  qtyCategorySelected[cat] = next;
  renderQtyCategoryCountEditor();
  updateQtyAssignedSummary();
}

function updateQtyAssignedSummary() {
  const total = Object.values(qtyCategorySelected).reduce((sum, v) => sum + Number(v || 0), 0);
  const remain = qtyCategoryCurrentQty - total;

  const totalEl = document.getElementById("qtyAssignedTotal");
  const remainValueEl = document.getElementById("qtyRemainValue");
  const remainPanelEl = document.getElementById("qtyRemainPanel");
  const totalCheckEl = document.getElementById("qtyCategoryTotalCheck");

  if (totalEl) totalEl.textContent = String(total);
  if (remainValueEl) remainValueEl.textContent = String(remain);

  if (remainPanelEl) {
    remainPanelEl.classList.remove("is-ok", "is-over", "is-under");
    if (remain === 0) remainPanelEl.classList.add("is-ok");
    else if (remain < 0) remainPanelEl.classList.add("is-over");
    else remainPanelEl.classList.add("is-under");
  }

  if (totalCheckEl) {
    totalCheckEl.classList.remove("is-ok", "is-over", "is-under");
    if (remain === 0) totalCheckEl.classList.add("is-ok");
    else if (remain < 0) totalCheckEl.classList.add("is-over");
    else totalCheckEl.classList.add("is-under");
  }
}

function addNewQtyCategoryChip() {
  const input = document.getElementById("qtyNewCategoryInput");
  const chipWrap = document.getElementById("qtyCategoryChipWrap");
  if (!input || !chipWrap) return;

  const cat = String(input.value || "").trim();
  if (!cat) return;

  const exists = [...chipWrap.querySelectorAll(".categoryChip")]
    .some(el => el.getAttribute("data-cat") === cat);

  if (!exists) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "categoryChip active";
    btn.setAttribute("data-cat", cat);
    btn.textContent = cat;
    btn.onclick = () => toggleQtyCategoryChip(cat);
    chipWrap.appendChild(btn);
  }

  qtyCategorySelected[cat] = qtyCategorySelected[cat] || 1;
  input.value = "";
  renderQtyCategoryChipState();
  renderQtyCategoryCountEditor();
  updateQtyAssignedSummary();
}

function confirmQtyCategoryModal() {
  const keys = Object.keys(qtyCategorySelected);

  if (!qtyCategoryCurrentQty || qtyCategoryCurrentQty < 1) {
    alert("合計個数を選択してください。");
    return;
  }

  if (!keys.length) {
    alert("カテゴリを1つ以上選択してください。");
    return;
  }

  const resultMap = {};
  keys.forEach(cat => {
    resultMap[cat] = clampNonNeg(qtyCategorySelected[cat] || 0);
  });

  const total = Object.values(resultMap).reduce((sum, v) => sum + Number(v || 0), 0);

  if (total !== qtyCategoryCurrentQty) {
    alert(`カテゴリ個数の合計(${total})と合計個数(${qtyCategoryCurrentQty})を一致させてください。`);
    return;
  }

  const hasZero = Object.values(resultMap).some(v => Number(v || 0) <= 0);
  if (hasZero) {
    alert("選択したカテゴリには1個以上を割り当ててください。");
    return;
  }

  closeQtyCategoryModal({
    qty: qtyCategoryCurrentQty,
    categoryMap: resultMap
  });
}

function closeQtyCategoryModal(result) {
  const modal = document.getElementById("qtyCategoryModal");
  if (modal) modal.classList.remove("show");

  if (qtyCategoryModalResolver) {
    qtyCategoryModalResolver(result);
    qtyCategoryModalResolver = null;
  }
}

/* =========================
   ボタン押下エフェクト
========================= */
function setupButtonPressEffect() {
  const apply = () => {
    document.querySelectorAll("button").forEach(btn => {
      if (btn.dataset.pressReady === "1") return;
      btn.dataset.pressReady = "1";

      const on = () => btn.classList.add("is-pressed");
      const off = () => btn.classList.remove("is-pressed");

      btn.addEventListener("touchstart", on, { passive: true });
      btn.addEventListener("touchend", off, { passive: true });
      btn.addEventListener("touchcancel", off, { passive: true });

      btn.addEventListener("mousedown", on);
      btn.addEventListener("mouseup", off);
      btn.addEventListener("mouseleave", off);
    });
  };

  apply();

  new MutationObserver(apply).observe(document.body, {
    childList: true,
    subtree: true
  });
}
