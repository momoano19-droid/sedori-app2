function toggleBackupAccordion(forceOpen = null) {
  const body = document.getElementById("backupAccordionBody");
  const header = document.getElementById("backupAccordionHeader");
  const chevron = document.getElementById("backupAccordionChevron");
  if (!body || !header || !chevron) return;

  const willOpen =
    forceOpen === null
      ? body.style.display === "none"
      : !!forceOpen;

  body.style.display = willOpen ? "block" : "none";
  header.setAttribute("aria-expanded", willOpen ? "true" : "false");
  chevron.textContent = willOpen ? "▲" : "▼";
}

function exportBackup() {
  const data = {
    version: 3,
    exportedAt: new Date().toISOString(),
    stores,
    logs,
    savedRoutes,
    todayRouteOrder
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json"
  });
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
      logs = Array.isArray(parsed.logs) ? parsed.logs.map(normalizeLog) : [];
      savedRoutes = Array.isArray(parsed.savedRoutes)
        ? parsed.savedRoutes.map(normalizeRoute)
        : [];
      todayRouteOrder = Array.isArray(parsed.todayRouteOrder)
        ? normalizeTodayRouteOrder(parsed.todayRouteOrder)
        : [];

      nearbyMode = false;
      noCoordsOnlyMode = false;
      nearbyStoreIds = new Set();
      clearSplitRouteCache();
      openSavedRouteId = null;
      todayRouteVisitedIds = [];

      syncTodayRouteOrder();
      saveTodayRouteVisitedIds();
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
  logs = Array.isArray(data.logs) ? data.logs.map(normalizeLog) : [];
  savedRoutes = Array.isArray(data.savedRoutes)
    ? data.savedRoutes.map(normalizeRoute)
    : [];
  todayRouteOrder = Array.isArray(data.todayRouteOrder)
    ? normalizeTodayRouteOrder(data.todayRouteOrder)
    : [];

  nearbyMode = false;
  noCoordsOnlyMode = false;
  nearbyStoreIds = new Set();
  clearSplitRouteCache();
  openSavedRouteId = null;
  todayRouteVisitedIds = [];

  syncTodayRouteOrder();
  saveTodayRouteVisitedIds();
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

  alert(
    `保存日時: ${data.savedAt || "不明"}\n店舗数: ${data.stores.length}件\nログ数: ${data.logs.length}件\n保存ルート数: ${data.savedRoutes.length}件`
  );
}

function syncTodayRouteOrder() {
  const todayIds = stores.filter(s => s.today).map(s => s.id);
  const todaySet = new Set(todayIds);

  todayRouteOrder = todayRouteOrder.filter(id => todaySet.has(id));

  todayIds.forEach(id => {
    if (!todayRouteOrder.includes(id)) {
      todayRouteOrder.push(id);
    }
  });
}

function getTodayRouteStores() {
  syncTodayRouteOrder();

  return todayRouteOrder
    .map(id => stores.find(s => s.id === id))
    .filter(s => s && s.today)
    .filter(s => hasCoords(s) || s.address);
}

function getPendingTodayRouteStores() {
  syncTodayRouteOrder();
  syncTodayRouteVisitedIds();

  return todayRouteOrder
    .map(id => stores.find(s => s.id === id))
    .filter(s => s && s.today)
    .filter(s => !isTodayRouteVisited(s.id))
    .filter(s => hasCoords(s) || s.address);
}

function clearSplitRouteCache() {
  splitRouteCache = null;
}

function chunkRouteStores(routeStores, chunkSize = 9) {
  const chunks = [];
  for (let i = 0; i < routeStores.length; i += chunkSize) {
    chunks.push(routeStores.slice(i, i + chunkSize));
  }
  return chunks;
}

function moveTodayRouteItem(index, delta) {
  syncTodayRouteOrder();

  const nextIndex = index + delta;
  if (
    index < 0 ||
    nextIndex < 0 ||
    index >= todayRouteOrder.length ||
    nextIndex >= todayRouteOrder.length
  ) return;

  const arr = [...todayRouteOrder];
  const temp = arr[index];
  arr[index] = arr[nextIndex];
  arr[nextIndex] = temp;
  todayRouteOrder = arr;

  clearSplitRouteCache();
  saveAll();
  render();
}

function removeTodayRouteItem(index) {
  syncTodayRouteOrder();

  const id = todayRouteOrder[index];
  if (!id) return;

  const store = stores.find(s => s.id === id);
  if (store) store.today = false;

  todayRouteOrder = todayRouteOrder.filter((_, i) => i !== index);
  unmarkTodayRouteVisited(id);
  clearSplitRouteCache();

  saveAll();
  render();
}

function buildGoogleMapsRouteUrl(routeStores) {
  if (!routeStores.length) return "";

  const makeDest = s => {
    if (hasCoords(s)) return `${s.lat},${s.lng}`;
    return s.address;
  };

  const destination = makeDest(routeStores[routeStores.length - 1]);
  const waypoints = routeStores.slice(0, -1).map(makeDest).slice(0, 8);
  const origin = "Current Location";

  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving${waypoints.length ? `&waypoints=${encodeURIComponent(waypoints.join("|"))}` : ""}`;
}

function setSplitRouteCache(routeStores) {
  const chunks = chunkRouteStores(routeStores, 9);

  let carryStartPos =
    window.lastPos &&
    typeof window.lastPos.lat === "number" &&
    typeof window.lastPos.lng === "number"
      ? { lat: window.lastPos.lat, lng: window.lastPos.lng }
      : null;

  splitRouteCache = {
    parts: chunks.map((storesPart, idx) => {
      const estimatedMinutes = estimateRouteMinutes(storesPart, carryStartPos);

      const lastStoreWithCoords = [...storesPart]
        .reverse()
        .find(store => hasCoords(store));

      if (lastStoreWithCoords) {
        carryStartPos = {
          lat: lastStoreWithCoords.lat,
          lng: lastStoreWithCoords.lng
        };
      } else {
        carryStartPos = null;
      }

      return {
        index: idx + 1,
        stores: storesPart,
        url: buildGoogleMapsRouteUrl(storesPart),
        start: idx * 9 + 1,
        end: idx * 9 + storesPart.length,
        estimatedMinutes
      };
    })
  };
}

function openSplitRoutePart(part) {
  if (!splitRouteCache?.parts?.length) {
    alert("分割ルートがありません。もう一度「この順番でルート作成」を押してください。");
    return;
  }

  const target = splitRouteCache.parts.find(p => p.index === part);
  if (!target || !target.url) {
    alert(`ルート${part}を開けませんでした。`);
    return;
  }

  window.open(target.url, "_blank");
}

function getNearestNeighborRoute(routeStores, startPos = null) {
  const remaining = [...routeStores];
  const ordered = [];

  let currentPoint =
    startPos &&
    typeof startPos.lat === "number" &&
    typeof startPos.lng === "number"
      ? { lat: startPos.lat, lng: startPos.lng }
      : null;

  while (remaining.length) {
    let bestIndex = 0;

    if (currentPoint) {
      let bestDist = Infinity;

      remaining.forEach((store, idx) => {
        if (!hasCoords(store)) return;
        const dist = distanceKm(
          currentPoint.lat,
          currentPoint.lng,
          store.lat,
          store.lng
        );
        if (dist < bestDist) {
          bestDist = dist;
          bestIndex = idx;
        }
      });
    }

    const nextStore = remaining.splice(bestIndex, 1)[0];
    ordered.push(nextStore);

    if (hasCoords(nextStore)) {
      currentPoint = { lat: nextStore.lat, lng: nextStore.lng };
    } else {
      currentPoint = null;
    }
  }

  return ordered;
}

function openRouteInGoogleMaps(routeStores) {
  if (!routeStores.length) {
    alert("ルートに使える店舗がありません。");
    return;
  }

  if (routeStores.length <= 9) {
    clearSplitRouteCache();
    const url = buildGoogleMapsRouteUrl(routeStores);
    if (!url) {
      alert("ルートに使える店舗がありません。");
      return;
    }
    window.open(url, "_blank");
    render();
    return;
  }

  setSplitRouteCache(routeStores);
  render();

  const parts = splitRouteCache?.parts || [];
  alert(`店舗数が ${routeStores.length} 件あるため、ルートを ${parts.length} 本に分けました。今日のルート欄の各ルートボタンから開いてください。`);
}

function autoOptimizeTodayRoute() {
  const routeStores = getPendingTodayRouteStores();
  if (!routeStores.length) {
    alert("未訪問の今日ルート店舗がありません。");
    return;
  }

  const optimized = getNearestNeighborRoute(routeStores, window.lastPos);

  const pendingIds = optimized.map(s => s.id);
  const visitedIdsInOrder = todayRouteOrder.filter(id => isTodayRouteVisited(id));
  todayRouteOrder = [...visitedIdsInOrder, ...pendingIds];

  clearSplitRouteCache();
  saveAll();
  render();
  alert("未訪問の今日ルートを自動最適化しました。");
}

function buildTodayRoute() {
  const routeStores = getPendingTodayRouteStores();

  if (!routeStores.length) {
    alert("未訪問の「今日行く」店舗がありません。");
    return;
  }

  openRouteInGoogleMaps(routeStores);
}

function sortSavedRoutes() {
  savedRoutes.sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });
}

function toggleSavedRouteOpen(routeId) {
  openSavedRouteId = openSavedRouteId === routeId ? null : routeId;
  renderSavedRoutesList();
}

function buildSavedRouteStores(route) {
  const ids = Array.isArray(route?.storeIds) ? route.storeIds : [];
  return ids
    .map(id => stores.find(s => s.id === id))
    .filter(Boolean);
}

function getSavedRoutePreviewText(route, count = 3) {
  const routeStores = buildSavedRouteStores(route);
  return routeStores
    .slice(0, count)
    .map(s => s?.name || "店舗名なし")
    .filter(Boolean)
    .join(" / ");
}

function saveCurrentRoute() {
  const routeStores = getTodayRouteStores();
  if (!routeStores.length) {
    alert("保存できる今日のルートがありません。");
    return;
  }

  const defaultName = `ルート ${tokyoDateStr()}`;
  const name = prompt("保存するルート名", defaultName);
  if (name === null) return;

  const note = prompt("メモ（任意）", "") ?? "";

  const newRoute = normalizeRoute({
    id: ensureId(),
    name: String(name).trim() || defaultName,
    note: String(note).trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    favorite: false,
    storeIds: routeStores.map(s => s.id)
  });

  savedRoutes.unshift(newRoute);

  if (savedRoutes.length > 50) {
    savedRoutes = savedRoutes.slice(0, 50);
  }

  sortSavedRoutes();
  openSavedRouteId = newRoute.id;
  saveAll();
  render();
  alert("ルートを保存しました。");
}

function openSavedRoute(routeId) {
  const route = savedRoutes.find(r => r.id === routeId);
  if (!route) return;

  const routeStores = buildSavedRouteStores(route);
  if (!routeStores.length) {
    alert("このルートの店舗が見つかりません。");
    return;
  }

  stores.forEach(s => {
    s.today = route.storeIds.includes(s.id);
  });

  todayRouteOrder = route.storeIds.filter(id =>
    stores.some(s => s.id === id && s.today)
  );

  todayRouteVisitedIds = [];
  saveTodayRouteVisitedIds();

  clearSplitRouteCache();
  syncTodayRouteOrder();

  saveAll();
  render();
  alert(`「${route.name}」を今日のルートに読み込みました。`);
}

function openSavedRouteInMaps(routeId) {
  const route = savedRoutes.find(r => r.id === routeId);
  if (!route) return;

  const routeStores = buildSavedRouteStores(route).filter(
    s => hasCoords(s) || s.address
  );
  if (!routeStores.length) {
    alert("このルートの店舗が見つかりません。");
    return;
  }

  openRouteInGoogleMaps(routeStores);
}

function toggleFavoriteRoute(routeId) {
  const route = savedRoutes.find(r => r.id === routeId);
  if (!route) return;

  route.favorite = !route.favorite;
  route.updatedAt = new Date().toISOString();

  sortSavedRoutes();
  openSavedRouteId = routeId;
  saveAll();
  render();
}

function editSavedRoute(routeId) {
  const route = savedRoutes.find(r => r.id === routeId);
  if (!route) return;

  const name = prompt("ルート名を変更", route.name || "");
  if (name === null) return;

  const note = prompt("メモを変更", route.note || "");
  if (note === null) return;

  route.name = String(name).trim() || route.name || "保存ルート";
  route.note = String(note).trim();
  route.updatedAt = new Date().toISOString();

  sortSavedRoutes();
  openSavedRouteId = routeId;
  saveAll();
  render();
}

function deleteSavedRoute(routeId) {
  const route = savedRoutes.find(r => r.id === routeId);
  if (!route) return;
  if (!confirm(`「${route.name}」を削除しますか？`)) return;

  savedRoutes = savedRoutes.filter(r => r.id !== routeId);
  if (openSavedRouteId === routeId) {
    openSavedRouteId = null;
  }
  saveAll();
  render();
}

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
7: 利益を修正

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
      categoryHistoryDirty = true;
    }
  }

  if (menu === "7") {
    openProfitEditModal(i);
    return;
  }

  saveAll();
  render();
}

function deleteStore(i) {
  const s = stores[i];
  if (!s) return;
  if (!confirm(`「${s.name}」を削除しますか？`)) return;

  stores.splice(i, 1);
  todayRouteOrder = todayRouteOrder.filter(id => id !== s.id);
  unmarkTodayRouteVisited(s.id);
  clearSplitRouteCache();
  saveAll();
  render();
}

function navigateToStore(i) {
  const s = stores[i];
  if (!s) return;

  if (hasCoords(s)) {
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${s.lat},${s.lng}`)}&travelmode=driving`,
      "_blank"
    );
    return;
  }

  if (s.address) {
    window.open(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}`,
      "_blank"
    );
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

  for (let idx = 0; idx < targets.length; idx++) {
    const s = targets[idx];
    const pos = await resolveStoreLatLng(s.pref, s.address, s.name, s.mapUrl, false);
    s.lat = pos.lat;
    s.lng = pos.lng;

    if (idx < targets.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 180));
    }
  }

  saveAll();
  render();
  alert("座標再取得が完了しました。");
}

function visit(i) {
  const s = stores[i];
  if (!s) return;

  s.visits += 1;
  s.lastVisitDate = tokyoDateStr();

  if (s.today) {
    markTodayRouteVisited(s.id);
  }

  addLog(s.id, "visit", 1);

  checkAndCountCompletedRoute();

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
    const catMap =
      result.categoryMap && typeof result.categoryMap === "object"
        ? result.categoryMap
        : null;
    const profit = clampNonNeg(parseInt(result.profit || "0", 10));

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

    if (profit > 0) {
      s.profit += profit;
      addLog(s.id, "profit", profit);
    }

    const firstCat = keys[0];
    if (firstCat) s.defaultCategory = firstCat;

    saveAll();
    render();
  });
}

function itemsMinus(i) {
  const s = stores[i];
  if (!s) return;

  const currentTotal = Number(s.items || 0);
  if (currentTotal <= 0) {
    alert("減らせる個数がありません。");
    return;
  }

  const history =
    Object.keys(s.categoryCounts || {}).length
      ? Object.keys(s.categoryCounts || {})
      : getCategoryHistory();

  openQtyCategoryModal({
    history,
    defaultCategory: s.defaultCategory
  }).then(result => {
    if (!result) return;

    const n = clampNonNeg(parseInt(result.qty || "0", 10));
    const catMap =
      result.categoryMap && typeof result.categoryMap === "object"
        ? result.categoryMap
        : null;

    if (!n || !catMap) return;

    const total = Object.values(catMap).reduce((sum, v) => sum + Number(v || 0), 0);
    if (total !== n) {
      alert("カテゴリ個数の合計が一致していません。");
      return;
    }

    if (n > currentTotal) {
      alert(`現在個数 ${currentTotal} 個を超えて減らすことはできません。`);
      return;
    }

    for (const [cat, qty] of Object.entries(catMap)) {
      const current = Number(s.categoryCounts[cat] || 0);
      if (qty > current) {
        alert(`カテゴリ「${cat}」は現在 ${current} 個です。`);
        return;
      }
    }

    s.items = clampNonNeg(s.items - n);

    Object.entries(catMap).forEach(([cat, qty]) => {
      const current = Number(s.categoryCounts[cat] || 0);
      const next = Math.max(0, current - qty);

      if (next <= 0) delete s.categoryCounts[cat];
      else s.categoryCounts[cat] = next;

      addLog(s.id, "category", -qty, cat);
    });

    addLog(s.id, "items", -n);

    if (!Object.keys(s.categoryCounts || {}).length && s.items === 0) {
      s.defaultCategory = "";
    } else if (s.defaultCategory && !s.categoryCounts[s.defaultCategory]) {
      const remainCats = Object.keys(s.categoryCounts || {});
      s.defaultCategory = remainCats[0] || s.defaultCategory || "";
    }

    saveAll();
    render();
  });
}

function toggleToday(i, checked) {
  const s = stores[i];
  if (!s) return;

  s.today = !!checked;

  if (s.today) {
    if (!todayRouteOrder.includes(s.id)) {
      todayRouteOrder.push(s.id);
    }
  } else {
    todayRouteOrder = todayRouteOrder.filter(id => id !== s.id);
    unmarkTodayRouteVisited(s.id);
  }

  clearSplitRouteCache();
  syncTodayRouteOrder();
  saveAll();
  render();
}

function toggleTodayByStoreId(storeId, checked) {
  const idx = stores.findIndex(s => s.id === storeId);
  if (idx < 0) return;

  preserveMapViewOnNextRender = true;
  toggleToday(idx, checked);
}

function clearTodayChecks() {
  stores.forEach(s => {
    s.today = false;
  });
  todayRouteOrder = [];
  todayRouteVisitedIds = [];
  saveTodayRouteVisitedIds();
  clearSplitRouteCache();
  saveAll();
  render();
}

function clearNearbyMode() {
  nearbyMode = false;
  noCoordsOnlyMode = false;
  nearbyStoreIds = new Set();
  lastListRenderSignature = "";
  lastMapRenderSignature = "";
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
      renderCurrentLocationMarker();

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
      lastListRenderSignature = "";
      lastMapRenderSignature = "";
      render();
    },
    () => alert("現在地を取得できませんでした。"),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
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

      renderCurrentLocationMarker();

      lastListRenderSignature = "";
      lastMapRenderSignature = "";

      const sortType = document.getElementById("sortType")?.value || "expected";

      if (sortType === "route" || nearbyMode) {
        render();
      } else {
        scheduleRenderMapMarkers();
      }
    },
    () => {},
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function moveToCurrentLocation() {
  if (!navigator.geolocation) {
    alert("この端末では位置情報が使えません。");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      window.lastPos = { lat, lng };

      if (map) {
        map.setView([lat, lng], 15);
      }

      renderCurrentLocationMarker();

      lastListRenderSignature = "";
      lastMapRenderSignature = "";
      preserveMapViewOnNextRender = true;

      render();

      setTimeout(() => {
        preserveMapViewOnNextRender = false;
      }, 300);
    },
    err => {
      console.error(err);
      alert("現在地を取得できませんでした。位置情報の許可を確認してください。");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
}

function showNoCoordsOnly() {
  noCoordsOnlyMode = true;
  nearbyMode = false;
  lastListRenderSignature = "";
  lastMapRenderSignature = "";
  render();
}

function setLayoutMode(mode) {
  currentLayoutMode = mode === "compact" ? "compact" : "detail";
  localStorage.setItem("store_layout_mode", currentLayoutMode);
  updateLayoutButtons();
  lastListRenderSignature = "";
  render();
}

function ensureQtyCategoryModal() {
  if (document.getElementById("qtyCategoryModal")) return;

  const modal = document.createElement("div");
  modal.id = "qtyCategoryModal";
  modal.className = "qtyCategoryModal";
  modal.innerHTML = `
    <div class="qtyCategoryCard">
      <div class="qtyCategoryTitle">個数・カテゴリ・利益を入力</div>
      <div class="qtyCategorySub">合計個数、カテゴリごとの個数、利益をまとめて入力できます</div>

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

      <div class="qtyCategorySectionTitle">利益入力</div>

      <div class="qtyQuickButtons">
        <button type="button" class="qtyQuickBtn profitQuickBtn" data-profit="1000" onclick="setQuickProfit(1000)">1000</button>
        <button type="button" class="qtyQuickBtn profitQuickBtn" data-profit="3000" onclick="setQuickProfit(3000)">3000</button>
        <button type="button" class="qtyQuickBtn profitQuickBtn" data-profit="5000" onclick="setQuickProfit(5000)">5000</button>
        <button type="button" class="qtyQuickBtn profitQuickBtn" data-profit="10000" onclick="setQuickProfit(10000)">10000</button>
      </div>

      <div class="qtyManualRow">
        <input
          id="qtyProfitInput"
          class="qtyManualInput"
          type="number"
          min="0"
          step="100"
          value="0"
          placeholder="利益を入力"
          oninput="syncProfitInput()"
        >
        <button type="button" class="qtyManualBtn" onclick="applyManualProfit()">利益反映</button>
      </div>

      <div class="qtySelectedBox">
        利益: <span id="qtyProfitValue">0</span>円
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
  const newCategoryInput = document.getElementById("qtyNewCategoryInput");
  const profitInput = document.getElementById("qtyProfitInput");

  qtyCategoryCurrentQty = 1;
  qtyCategorySelected = {};
  qtyCategoryProfit = 0;

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
  if (newCategoryInput) newCategoryInput.value = "";
  if (profitInput) profitInput.value = "0";

  updateQtySelectedValue();
  renderQtyQuickButtons();
  renderQtyCategoryChipState();
  renderQtyCategoryCountEditor();
  updateQtyAssignedSummary();
  updateProfitView();

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

function setQuickProfit(amount) {
  qtyCategoryProfit = clampNonNeg(Number(amount || 0));

  const input = document.getElementById("qtyProfitInput");
  if (input) input.value = String(qtyCategoryProfit);

  updateProfitView();
}

function syncProfitInput() {
  const input = document.getElementById("qtyProfitInput");
  if (!input) return;

  qtyCategoryProfit = clampNonNeg(parseInt(input.value || "0", 10));
  updateProfitView();
}

function applyManualProfit() {
  const input = document.getElementById("qtyProfitInput");
  if (!input) return;

  qtyCategoryProfit = clampNonNeg(parseInt(input.value || "0", 10));
  input.value = String(qtyCategoryProfit);
  updateProfitView();
}

function updateProfitView() {
  const valueEl = document.getElementById("qtyProfitValue");
  if (valueEl) {
    valueEl.textContent = String(qtyCategoryProfit.toLocaleString());
  }

  document.querySelectorAll(".profitQuickBtn").forEach(btn => {
    const n = Number(btn.getAttribute("data-profit") || "0");
    btn.classList.toggle("active", n === qtyCategoryProfit);
  });
}

function updateQtySelectedValue() {
  const valueEl = document.getElementById("qtySelectedValue");
  const targetEl = document.getElementById("qtyAssignedTarget");
  if (valueEl) valueEl.textContent = String(qtyCategoryCurrentQty);
  if (targetEl) targetEl.textContent = String(qtyCategoryCurrentQty);
}

function renderQtyQuickButtons() {
  document.querySelectorAll(".qtyQuickBtn").forEach(btn => {
    if (btn.classList.contains("profitQuickBtn")) return;
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
    categoryMap: resultMap,
    profit: clampNonNeg(qtyCategoryProfit || 0)
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

function ensureProfitEditModal() {
  if (document.getElementById("profitEditModal")) return;

  const modal = document.createElement("div");
  modal.id = "profitEditModal";
  modal.className = "qtyCategoryModal";
  modal.innerHTML = `
    <div class="qtyCategoryCard">
      <div class="qtyCategoryTitle">利益を修正</div>
      <div class="qtyCategorySub">現在の利益を確認して、新しい利益金額に修正できます</div>

      <div class="qtySelectedBox">
        現在の利益: <span id="profitEditCurrentValue">0</span>円
      </div>

      <div class="qtyCategorySectionTitle">よく使う金額</div>
      <div class="qtyQuickButtons">
        <button type="button" class="qtyQuickBtn profitEditQuickBtn" data-profit="1000" onclick="setProfitEditValue(1000)">1000</button>
        <button type="button" class="qtyQuickBtn profitEditQuickBtn" data-profit="3000" onclick="setProfitEditValue(3000)">3000</button>
        <button type="button" class="qtyQuickBtn profitEditQuickBtn" data-profit="5000" onclick="setProfitEditValue(5000)">5000</button>
        <button type="button" class="qtyQuickBtn profitEditQuickBtn" data-profit="10000" onclick="setProfitEditValue(10000)">10000</button>
      </div>

      <div class="qtyCategorySectionTitle">利益を入力</div>
      <div class="qtyManualRow">
        <input
          id="profitEditInput"
          class="qtyManualInput"
          type="number"
          min="0"
          step="100"
          value="0"
          placeholder="利益を入力"
          oninput="syncProfitEditInput()"
        >
        <button type="button" class="qtyManualBtn" onclick="applyProfitEditInput()">反映</button>
      </div>

      <div class="qtySelectedBox">
        修正後の利益: <span id="profitEditNextValue">0</span>円
      </div>

      <div class="categoryPickerActions">
        <button type="button" class="ghostBtn" onclick="closeProfitEditModal()">キャンセル</button>
        <button type="button" class="primaryBtn" onclick="saveProfitEditModal()">保存</button>
      </div>
    </div>
  `;

  modal.addEventListener("click", e => {
    if (e.target === modal) closeProfitEditModal();
  });

  document.body.appendChild(modal);
}

function openProfitEditModal(index) {
  const s = stores[index];
  if (!s) return;

  ensureProfitEditModal();
  profitEditTargetIndex = index;

  const current = clampNonNeg(Number(s.profit || 0));
  const currentEl = document.getElementById("profitEditCurrentValue");
  const nextEl = document.getElementById("profitEditNextValue");
  const input = document.getElementById("profitEditInput");
  const modal = document.getElementById("profitEditModal");

  if (currentEl) currentEl.textContent = current.toLocaleString();
  if (nextEl) nextEl.textContent = current.toLocaleString();
  if (input) input.value = String(current);

  updateProfitEditQuickState(current);

  if (modal) modal.classList.add("show");
}

function closeProfitEditModal() {
  const modal = document.getElementById("profitEditModal");
  if (modal) modal.classList.remove("show");
  profitEditTargetIndex = -1;
}

function getProfitEditValue() {
  const input = document.getElementById("profitEditInput");
  return clampNonNeg(parseInt(input?.value || "0", 10));
}

function setProfitEditValue(amount) {
  const value = clampNonNeg(Number(amount || 0));
  const input = document.getElementById("profitEditInput");
  const nextEl = document.getElementById("profitEditNextValue");

  if (input) input.value = String(value);
  if (nextEl) nextEl.textContent = value.toLocaleString();

  updateProfitEditQuickState(value);
}

function syncProfitEditInput() {
  const value = getProfitEditValue();
  const nextEl = document.getElementById("profitEditNextValue");
  if (nextEl) nextEl.textContent = value.toLocaleString();
  updateProfitEditQuickState(value);
}

function applyProfitEditInput() {
  const input = document.getElementById("profitEditInput");
  if (!input) return;

  const value = clampNonNeg(parseInt(input.value || "0", 10));
  input.value = String(value);

  const nextEl = document.getElementById("profitEditNextValue");
  if (nextEl) nextEl.textContent = value.toLocaleString();

  updateProfitEditQuickState(value);
}

function updateProfitEditQuickState(value) {
  document.querySelectorAll(".profitEditQuickBtn").forEach(btn => {
    const n = Number(btn.getAttribute("data-profit") || "0");
    btn.classList.toggle("active", n === value);
  });
}

function saveProfitEditModal() {
  if (profitEditTargetIndex < 0) return;

  const s = stores[profitEditTargetIndex];
  if (!s) {
    closeProfitEditModal();
    return;
  }

  const current = clampNonNeg(Number(s.profit || 0));
  const next = getProfitEditValue();
  const diff = next - current;

  s.profit = next;
  if (diff !== 0) {
    addLog(s.id, "profit", diff);
  }

  saveAll();
  render();
  closeProfitEditModal();
}
