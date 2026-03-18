const QUICK_LIMIT = 12;

const KEY_AUTO_BACKUP = "sedori_auto_backup_v1";

let stores = loadStores().map(s => ({
  id: s.id || ensureId(),
  name: (s.name ?? "店舗").toString(),
  pref: (s.pref ?? "").toString().trim(),
  address: (s.address ?? "").toString().trim(),
  visits: Number(s.visits ?? 0),
  buyDays: Number(s.buyDays ?? 0),
  items: Number(s.items ?? 0),
  profit: Number(s.profit ?? 0),
  mapUrl: (s.mapUrl ?? "").toString().trim(),
  lat: (typeof s.lat === "number") ? s.lat : null,
  lng: (typeof s.lng === "number") ? s.lng : null,
  defaultCategory: (s.defaultCategory ?? "").toString().trim(),
  categoryCounts: (s.categoryCounts && typeof s.categoryCounts === "object") ? s.categoryCounts : {},
  quickCategories: Array.isArray(s.quickCategories) ? s.quickCategories.filter(Boolean).slice(0, QUICK_LIMIT) : [],
  lastVisitDate: (s.lastVisitDate ?? "").toString().trim(),
  today: !!s.today
}));

let logs = loadLogs();
let layout = loadLayout();
window.lastPos = null;
let nearbyMode = false;
let nearbyStoreIds = new Set();

function saveAll(){
  saveStores(stores);
  saveLogs(logs);
  saveLayout(layout);
  saveAutoBackup();
}

function buildPrefFilter(){
  const prefSet = new Set();
  stores.forEach(s=>{
    if((s.pref || "").trim()) prefSet.add(s.pref.trim());
  });
  const prefs = Array.from(prefSet).sort((a,b)=>a.localeCompare(b,'ja'));
  const sel = document.getElementById("prefFilter");
  const current = sel.value || "__ALL__";
  sel.innerHTML = `<option value="__ALL__">全て（都道府県ごと表示）</option>` +
    prefs.map(p=>`<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
  if(["__ALL__", ...prefs].includes(current)) sel.value = current;
}

function buildTodayPrefSelect(){
  const sel = document.getElementById("todayPrefSelect");
  const set = new Set();
  stores.forEach(s=>{
    const p = (s.pref || "").trim();
    if(p) set.add(p);
  });
  const prefs = Array.from(set).sort((a,b)=>a.localeCompare(b,'ja'));
  const cur = sel.value || "__ALL__";

  sel.innerHTML = `<option value="__ALL__">（全都道府県）</option>` +
    prefs.map(p=>`<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");

  if(["__ALL__", ...prefs].includes(cur)) sel.value = cur;
}

function matchesQuery(s, q){
  if(!q) return true;
  const cats = Object.keys(s.categoryCounts || {}).join(" ");
  const qcats = (s.quickCategories || []).join(" ");
  const t = (s.name + " " + (s.pref || "") + " " + (s.address || "") + " " + (s.defaultCategory || "") + " " + qcats + " " + cats).toLowerCase();
  return t.includes(q.toLowerCase());
}

function distanceKm(lat1,lng1,lat2,lng2){
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
    Math.sin(dLng/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function clearNearbyMode(){
  nearbyMode = false;
  nearbyStoreIds = new Set();
}

function setLayout(v){
  layout = v;
  saveLayout(layout);
  render();
}

function applyLayoutButtonState(){
  const mapBtn = {
    detail: "layoutDetailBtn",
    compact: "layoutCompactBtn",
    list: "layoutListBtn",
    analysis: "layoutAnalysisBtn",
  };
  Object.entries(mapBtn).forEach(([k,id])=>{
    const el = document.getElementById(id);
    if(!el) return;
    if(layout === k) el.classList.remove("secondary");
    else el.classList.add("secondary");
  });
}

function openMapSearchFromAddress(){
  const address = (document.getElementById("address").value || "").trim();
  const pref = (document.getElementById("prefName").value || "").trim();
  const name = (document.getElementById("storeName").value || "").trim();
  const q = [pref, address, name].filter(Boolean).join(" ");
  if(!q){
    alert("住所か店舗名を入れてください。");
    return;
  }
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`, "_blank");
}

async function addStore(){
  const name = document.getElementById("storeName").value.trim();
  const pref = document.getElementById("prefName").value.trim();
  const address = document.getElementById("address").value.trim();
  const mapUrl = document.getElementById("mapUrl").value.trim();
  if(!name) return;

  stores.push({
    id: ensureId(),
    name,
    pref,
    address,
    visits:0,
    buyDays:0,
    items:0,
    profit:0,
    mapUrl,
    lat:null,
    lng:null,
    defaultCategory:"",
    categoryCounts:{},
    quickCategories:[],
    lastVisitDate:"",
    today:false
  });

  document.getElementById("storeName").value = "";
  document.getElementById("prefName").value = "";
  document.getElementById("address").value = "";
  document.getElementById("mapUrl").value = "";

  saveAll();
  render();
}

function editStore(i){
  const s = stores[i];
  const name = prompt("店舗名", s.name || "");
  if(name === null) return;
  s.name = String(name).trim() || s.name;

  const pref = prompt("都道府県", s.pref || "");
  if(pref !== null) s.pref = String(pref).trim();

  const address = prompt("住所", s.address || "");
  if(address !== null) s.address = String(address).trim();

  saveAll();
  render();
}

function deleteStore(i){
  if(!confirm(`「${stores[i].name}」を削除しますか？`)) return;
  stores.splice(i,1);
  saveAll();
  render();
}

function navigateToStore(i){
  const s = stores[i];
  if(typeof s.lat === "number" && typeof s.lng === "number"){
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.lat + "," + s.lng)}&travelmode=driving`, "_blank");
    return;
  }
  if((s.address || "").trim()){
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address.trim())}`, "_blank");
    return;
  }
  alert("住所または座標が登録されていません。");
}

function visit(i){
  const s = stores[i];
  s.visits++;
  s.lastVisitDate = tokyoDateStr();
  addLog(logs, s.id, "visit", 1);
  saveAll();
  render();
}

function visitMinus(i){
  const s = stores[i];
  s.visits = clampNonNeg(s.visits - 1);
  if(s.buyDays > s.visits) s.buyDays = s.visits;
  addLog(logs, s.id, "visit", -1);
  saveAll();
  render();
}

function itemsPlus(i){
  const s = stores[i];
  const n = clampNonNeg(parseInt(prompt("追加する個数は？", "1"), 10));
  if(!n) return;
  s.items += n;
  s.buyDays++;
  if(s.buyDays > s.visits) s.visits = s.buyDays;
  addLog(logs, s.id, "success", 1);
  addLog(logs, s.id, "items", n);
  saveAll();
  render();
}

function itemsMinus(i){
  const s = stores[i];
  const n = clampNonNeg(parseInt(prompt("減らす個数は？", "1"), 10));
  if(!n) return;
  s.items = clampNonNeg(s.items - n);
  addLog(logs, s.id, "items", -n);
  saveAll();
  render();
}

function profitPlus(i){
  const s = stores[i];
  const d = clampNonNeg(parseInt(prompt("追加する利益（円）は？", "1000"), 10));
  if(!d) return;
  s.profit += d;
  addLog(logs, s.id, "profit", d);
  saveAll();
  render();
}

function profitMinus(i){
  const s = stores[i];
  const d = clampNonNeg(parseInt(prompt("利益減算（円）は？", "1000"), 10));
  if(!d) return;
  s.profit = clampNonNeg(s.profit - d);
  addLog(logs, s.id, "profit", -d);
  saveAll();
  render();
}

function optimizeRoute(){
  if(!navigator.geolocation){
    alert("この端末では位置情報が使えません。");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos=>{
      window.lastPos = {lat: pos.coords.latitude, lng: pos.coords.longitude};
      clearNearbyMode();
      document.getElementById("sortType").value = "route";
      render();
      renderMapMarkers();
    },
    ()=> alert("位置情報が取得できませんでした。"),
    {enableHighAccuracy:true, timeout:10000}
  );
}

function showNearbyStores(){
  if(!navigator.geolocation){
    alert("この端末では位置情報が使えません。");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      window.lastPos = { lat, lng };

      nearbyStoreIds = new Set();

      let checkedCount = 0;

      stores.forEach(s => {
        if(typeof s.lat !== "number" || typeof s.lng !== "number") return;
        checkedCount++;

        const dist = distanceKm(lat, lng, s.lat, s.lng);
        if(dist <= 3){
          nearbyStoreIds.add(s.id);
        }
      });

      nearbyMode = true;
      render();
      renderMapMarkers();

      if(checkedCount === 0){
        alert("座標入りの店舗がありません。住所だけでは近く判定できないため、座標取得済みの店舗を登録してください。");
        return;
      }

      if(nearbyStoreIds.size === 0){
        alert("3km以内に店舗が見つかりませんでした。");
      } else {
        alert(`近くの店舗が ${nearbyStoreIds.size} 件見つかりました。`);
      }
    },
    err => {
      console.error(err);
      alert("現在地を取得できませんでした。Safariの位置情報設定を確認してください。");
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function toggleToday(i, checked){
  stores[i].today = !!checked;
  saveAll();
  renderTodayPlan();
}

function bulkSetTodayByPref(prefValue, on){
  const pref = prefValue || "__ALL__";
  stores.forEach(s=>{
    if(pref === "__ALL__" || (s.pref || "").trim() === pref){
      s.today = !!on;
    }
  });
  saveAll();
  render();
  renderTodayPlan();
}

function todayBulkOn(){
  bulkSetTodayByPref(document.getElementById("todayPrefSelect").value, true);
}
function todayBulkOff(){
  bulkSetTodayByPref(document.getElementById("todayPrefSelect").value, false);
}

function buildTodayRoute(){
  const area = document.getElementById("todayPlanArea");
  const todays = stores.map((s,idx)=>({...s,_idx:idx})).filter(s=>s.today);
  if(!todays.length){
    area.innerHTML = `<div class="gray">「今日行く」にチェックした店舗がありません。</div>`;
    return;
  }
  area.innerHTML = `
    <div class="kv">
      <div class="pill"><b>今日行く</b> ${todays.length}店舗</div>
    </div>
    <div class="gray">ルート最適化の詳細処理はこの後 app.js に追加していけます。</div>
  `;
}

function buildCardHeader(s, i, extraBadgesHtml=""){
  const addressBlock = (s.address || "").trim()
    ? `<div class="addrRow"><div class="mini addrText">住所：${escapeHtml(s.address.trim())}</div><button class="secondary addrCopyBtn" onclick="navigateToStore(${i})">ナビ</button></div>`
    : "";

  return `
    <div class="storeTitle">${escapeHtml(s.name)}</div>
    <div>
      <span class="badge">${escapeHtml((s.pref || "").trim() || "未設定")}</span>
      ${(s.address || "").trim() ? `<span class="badge addr">📍 住所あり</span>` : ""}
      ${!(typeof s.lat === "number" && typeof s.lng === "number") ? `<span class="badge noCoord">座標なし</span>` : `<span class="badge map">MAP表示可</span>`}
      ${s.lastVisitDate ? `<span class="badge">最終訪問:${escapeHtml(s.lastVisitDate)}</span>` : ""}
      ${s.today ? `<span class="badge">今日行く</span>` : ""}
      ${extraBadgesHtml}
    </div>
    ${addressBlock}
    <div class="checkline">
      <input type="checkbox" id="today_${i}" ${s.today ? "checked" : ""} onchange="toggleToday(${i}, this.checked)">
      <label for="today_${i}">今日行く</label>
    </div>
  `;
}

function renderStoreCard(s, forceNearbyBadge){
  const i = s._idx;
  const m = s._m;
  const distText = (typeof s._dist === "number") ? `${s._dist.toFixed(1)}km` : "—";
  const effText = (typeof s._score === "number") ? `${Math.round(s._score).toLocaleString()} 円/km` : "—";
  const restockText = m.restockCycle ? `${m.restockCycle.toFixed(1)}日` : "—";
  const weekdayText = m.strongWeekdays.length ? m.strongWeekdays.join("/") : "—";

  const nearBadge = (forceNearbyBadge || s._isNearby) && typeof s._dist === "number"
    ? `<span class="badge near">📍近い ${s._dist.toFixed(1)}km</span>`
    : "";

  const header = buildCardHeader(s, i, nearBadge);

  return `
    <div class="store">
      ${header}
      <div class="meta">
        訪問：${m.visits}回 / 成功：${m.success}回 / 個数：${m.items}個<br>
        利益：${m.profit.toLocaleString()}円 / 成功率：${m.rate.toFixed(1)}%<br>
        平均利益：${Math.round(m.avgProfit).toLocaleString()}円 / 平均個数：${m.avgItems.toFixed(1)}個<br>
        <b>期待値：${Math.round(m.expected).toLocaleString()}円</b><br>
        補充周期目安：${restockText} / 強い曜日：${weekdayText}<br>
        距離：${distText} / <b>ルート効率：${effText}</b>
      </div>

      <div class="actionGrid">
  <button class="actionBtn plus" onclick="visit(${i})">訪問＋</button>
  <button class="actionBtn minus" onclick="visitMinus(${i})">訪問−</button>

  <button class="actionBtn plus" onclick="itemsPlus(${i})">個数＋</button>
  <button class="actionBtn minus" onclick="itemsMinus(${i})">個数−</button>

  <button class="actionBtn plus" onclick="profitPlus(${i})">利益＋</button>
  <button class="actionBtn minus" onclick="profitMinus(${i})">利益−</button>

  <button class="actionBtn setting" onclick="editStore(${i})">設定</button>
  <button class="actionBtn delete" onclick="deleteStore(${i})">削除</button>
</div>
    </div>
  `;
}

function renderMapMarkers(){
  if(!mapInitialized) return;
  clearMapMarkers();

  const q = (document.getElementById("q").value || "").trim();
  const prefFilter = document.getElementById("prefFilter").value;
  const minExpected = clampNonNeg(parseFloat(document.getElementById("minExpected").value || "0"));
  const minRate = clampNonNeg(parseFloat(document.getElementById("minRate").value || "0"));

  const visibleStores = stores
    .map((s, idx)=>({ ...s, _idx:idx, _m:getStoreAdvancedMetrics(logs, s) }))
    .filter(s=>typeof s.lat === "number" && typeof s.lng === "number")
    .filter(s=>matchesQuery(s,q))
    .filter(s=>prefFilter === "__ALL__" ? true : (s.pref || "").trim() === prefFilter)
    .filter(s=>s._m.expected >= minExpected && s._m.rate >= minRate);

  if(!visibleStores.length) return;

  const bounds = [];
  visibleStores.forEach(s=>{
    const marker = L.marker([s.lat, s.lng], { icon: makeMarkerIcon(getMarkerLevel(s._m.expected)) });
    marker.bindPopup(`
      <div><b>${escapeHtml(s.name)}</b></div>
      <div>${escapeHtml((s.pref || "").trim() || "未設定")}</div>
      <div>期待値：${Math.round(s._m.expected).toLocaleString()}円</div>
      <div>成功率：${s._m.rate.toFixed(1)}%</div>
    `);
    marker.addTo(map);
    mapMarkers.push(marker);
    bounds.push([s.lat, s.lng]);
  });

  if(bounds.length === 1) map.setView(bounds[0], 15);
  else map.fitBounds(bounds, { padding:[30,30] });
}

function renderTodayPlan(){
  buildTodayRoute();
}

function render(){
  buildPrefFilter();
  buildTodayPrefSelect();
  applyLayoutButtonState();

  const filter = document.getElementById("prefFilter").value;
  const q = (document.getElementById("q").value || "").trim();
  const minExpected = clampNonNeg(parseFloat(document.getElementById("minExpected").value || "0"));
  const minRate = clampNonNeg(parseFloat(document.getElementById("minRate").value || "0"));
  const sortType = document.getElementById("sortType").value;

  let view = stores.map((s, idx)=>{
    const m = getStoreAdvancedMetrics(logs, s);
    let dist = null, score = null;
    if(window.lastPos && typeof s.lat === "number" && typeof s.lng === "number"){
      dist = distanceKm(window.lastPos.lat, window.lastPos.lng, s.lat, s.lng);
      score = m.expected / (dist + 0.2);
    }
    const isNearby = nearbyStoreIds.has(s.id);
    return {...s, _idx:idx, _m:m, _dist:dist, _score:score, _isNearby:isNearby};
  })
  .filter(s=>matchesQuery(s,q))
  .filter(s=>s._m.expected >= minExpected && s._m.rate >= minRate);

  if(!q && filter !== "__ALL__"){
    view = view.filter(s=>(s.pref || "").trim() === filter);
  }

  const list = document.getElementById("storeList");
  list.innerHTML = "";

  view.sort((a,b)=>{
    if(sortType === "route"){
      const as = (typeof a._score === "number") ? a._score : -Infinity;
      const bs = (typeof b._score === "number") ? b._score : -Infinity;
      if(bs !== as) return bs - as;
      return b._m.expected - a._m.expected;
    }
    if(sortType === "rate") return b._m.rate - a._m.rate;
    if(sortType === "avgProfit") return b._m.avgProfit - a._m.avgProfit;
    if(sortType === "visits") return b._m.visits - a._m.visits;
    return b._m.expected - a._m.expected;
  });

  if(!view.length){
    list.innerHTML = `<div class="gray" style="margin-top:14px;">該当する店舗がありません。</div>`;
  }else{
    view.forEach(s => list.innerHTML += renderStoreCard(s, false));
  }

  renderMapMarkers();
  renderTodayPlan();
}

render();

function exportBackup(){
  try{
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      stores: stores,
      logs: logs,
      layout: layout
    };

    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const fileName = `sedori-backup-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}.json`;

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
    alert("バックアップを書き出しました。");
  }catch(e){
    console.error(e);
    alert("バックアップ書き出しに失敗しました。");
  }
}

function importBackup(event){
  const file = event.target.files && event.target.files[0];
  if(!file) return;

  const reader = new FileReader();

  reader.onload = function(e){
    try{
      const text = e.target.result;
      const data = JSON.parse(text);

      if(!data || typeof data !== "object"){
        throw new Error("JSON形式が不正です");
      }

      if(!Array.isArray(data.stores) || !Array.isArray(data.logs)){
        throw new Error("stores または logs が見つかりません");
      }

      const ok = confirm("現在のデータをバックアップデータで上書きします。よろしいですか？");
      if(!ok){
        event.target.value = "";
        return;
      }

      stores = data.stores.map(s => ({
        id: s.id || ensureId(),
        name: (s.name ?? "店舗").toString(),
        pref: (s.pref ?? "").toString().trim(),
        address: (s.address ?? "").toString().trim(),
        visits: Number(s.visits ?? 0),
        buyDays: Number(s.buyDays ?? 0),
        items: Number(s.items ?? 0),
        profit: Number(s.profit ?? 0),
        mapUrl: (s.mapUrl ?? "").toString().trim(),
        lat: (typeof s.lat === "number") ? s.lat : null,
        lng: (typeof s.lng === "number") ? s.lng : null,
        defaultCategory: (s.defaultCategory ?? "").toString().trim(),
        categoryCounts: (s.categoryCounts && typeof s.categoryCounts === "object") ? s.categoryCounts : {},
        quickCategories: Array.isArray(s.quickCategories) ? s.quickCategories.filter(Boolean).slice(0, QUICK_LIMIT) : [],
        lastVisitDate: (s.lastVisitDate ?? "").toString().trim(),
        today: !!s.today
      }));

      logs = data.logs.map(l => ({
        date: (l.date ?? "").toString(),
        storeId: (l.storeId ?? "").toString(),
        type: (l.type ?? "").toString(),
        delta: Number(l.delta ?? 0),
        ...(l.category ? { category: String(l.category).trim() } : {})
      }));

      if(typeof data.layout === "string"){
        layout = data.layout;
      }

      saveAll();
      clearNearbyMode();
      render();
      renderTodayPlan();

      alert("バックアップを読み込みました。");
    }catch(err){
      console.error(err);
      alert("バックアップ読込に失敗しました。JSONファイルを確認してください。");
    }finally{
      event.target.value = "";
    }
  };

  reader.readAsText(file, "utf-8");
}

function saveAutoBackup(){
  try{
    const backup = {
      version: 1,
      savedAt: new Date().toISOString(),
      stores: stores,
      logs: logs,
      layout: layout
    };
    localStorage.setItem(KEY_AUTO_BACKUP, JSON.stringify(backup));
  }catch(e){
    console.error("自動バックアップ保存失敗", e);
  }
}

function getAutoBackup(){
  try{
    const raw = localStorage.getItem(KEY_AUTO_BACKUP);
    if(!raw) return null;
    const data = JSON.parse(raw);
    if(!data || typeof data !== "object") return null;
    if(!Array.isArray(data.stores) || !Array.isArray(data.logs)) return null;
    return data;
  }catch(e){
    console.error("自動バックアップ読込失敗", e);
    return null;
  }
}

function showAutoBackupInfo(){
  const backup = getAutoBackup();
  if(!backup){
    alert("自動バックアップはまだありません。");
    return;
  }

  const savedAt = backup.savedAt ? new Date(backup.savedAt) : null;
  const text = savedAt
    ? `自動バックアップあり\n保存日時: ${savedAt.getFullYear()}-${String(savedAt.getMonth()+1).padStart(2,"0")}-${String(savedAt.getDate()).padStart(2,"0")} ${String(savedAt.getHours()).padStart(2,"0")}:${String(savedAt.getMinutes()).padStart(2,"0")}\n店舗数: ${backup.stores.length}件\nログ数: ${backup.logs.length}件`
    : `自動バックアップあり\n店舗数: ${backup.stores.length}件\nログ数: ${backup.logs.length}件`;

  alert(text);
}

function restoreAutoBackup(){
  const backup = getAutoBackup();
  if(!backup){
    alert("復元できる自動バックアップがありません。");
    return;
  }

  const ok = confirm("自動バックアップで現在のデータを上書きします。よろしいですか？");
  if(!ok) return;

  try{
    stores = backup.stores.map(s => ({
      id: s.id || ensureId(),
      name: (s.name ?? "店舗").toString(),
      pref: (s.pref ?? "").toString().trim(),
      address: (s.address ?? "").toString().trim(),
      visits: Number(s.visits ?? 0),
      buyDays: Number(s.buyDays ?? 0),
      items: Number(s.items ?? 0),
      profit: Number(s.profit ?? 0),
      mapUrl: (s.mapUrl ?? "").toString().trim(),
      lat: (typeof s.lat === "number") ? s.lat : null,
      lng: (typeof s.lng === "number") ? s.lng : null,
      defaultCategory: (s.defaultCategory ?? "").toString().trim(),
      categoryCounts: (s.categoryCounts && typeof s.categoryCounts === "object") ? s.categoryCounts : {},
      quickCategories: Array.isArray(s.quickCategories) ? s.quickCategories.filter(Boolean).slice(0, QUICK_LIMIT) : [],
      lastVisitDate: (s.lastVisitDate ?? "").toString().trim(),
      today: !!s.today
    }));

    logs = backup.logs.map(l => ({
      date: (l.date ?? "").toString(),
      storeId: (l.storeId ?? "").toString(),
      type: (l.type ?? "").toString(),
      delta: Number(l.delta ?? 0),
      ...(l.category ? { category: String(l.category).trim() } : {})
    }));

    if(typeof backup.layout === "string"){
      layout = backup.layout;
    }

    saveStores(stores);
    saveLogs(logs);
    saveLayout(layout);

    clearNearbyMode();
    render();
    renderTodayPlan();

    alert("自動バックアップから復元しました。");
  }catch(e){
    console.error(e);
    alert("自動バックアップの復元に失敗しました。");
  }
}
