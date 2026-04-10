function toggleBackupAccordion(forceOpen = null) {
  const body = document.getElementById("backupAccordionBody");
  const header = document.getElementById("backupAccordionHeader");
  const chevron = document.getElementById("backupAccordionChevron");
  if (!body || !header || !chevron) return;

  const willOpen = forceOpen === null
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
      savedRoutes = Array.isArray(parsed.savedRoutes) ? parsed.savedRoutes.map(normalizeRoute) : [];
      todayRouteOrder = Array.isArray(parsed.todayRouteOrder) ? normalizeTodayRouteOrder(parsed.todayRouteOrder) : [];
      nearbyMode = false;
      noCoordsOnlyMode = false;
      nearbyStoreIds = new Set();
      clearSplitRouteCache();
      openSavedRouteId = null;

      syncTodayRouteOrder();
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
  savedRoutes = Array.isArray(data.savedRoutes) ? data.savedRoutes.map(normalizeRoute) : [];
  todayRouteOrder = Array.isArray(data.todayRouteOrder) ? normalizeTodayRouteOrder(data.todayRouteOrder) : [];
  nearbyMode = false;
  noCoordsOnlyMode = false;
  nearbyStoreIds = new Set();
  clearSplitRouteCache();
  openSavedRouteId = null;

  syncTodayRouteOrder();
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

  alert(`保存日時: ${data.savedAt || "不明"}\n店舗数: ${data.stores.length}件\nログ数: ${data.logs.length}件\n保存ルート数: ${data.savedRoutes.length}件`);
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

function clearSplitRouteCache() {
  splitRouteCache = null;
}

function buildTodayRoute() {
  const routeStores = getTodayRouteStores();

  if (!routeStores.length) {
    alert("「今日行く」にチェックした店舗がありません。");
    return;
  }

  openRouteInGoogleMaps(routeStores);
}
function moveTodayRouteItem(index, delta) {
  syncTodayRouteOrder();

  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || index >= todayRouteOrder.length || nextIndex >= todayRouteOrder.length) return;

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
  const first = routeStores.slice(0, 9);
  const second = routeStores.slice(9, 18);

  splitRouteCache = {
    first,
    second,
    firstUrl: buildGoogleMapsRouteUrl(first),
    secondUrl: buildGoogleMapsRouteUrl(second)
  };
}

function openSplitRoutePart(part) {
  if (!splitRouteCache) {
    alert("分割ルートがありません。もう一度「この順番でルート作成」を押してください。");
    return;
  }

  const url = part === 2 ? splitRouteCache.secondUrl : splitRouteCache.firstUrl;
  if (!url) {
    alert(`ルート${part}を開けませんでした。`);
    return;
  }

  window.open(url, "_blank");
}
function getNearestNeighborRoute(routeStores, startPos = null) {
  const remaining = [...routeStores];
  const ordered = [];

  let currentPoint = startPos && typeof startPos.lat === "number" && typeof startPos.lng === "number"
    ? { lat: startPos.lat, lng: startPos.lng }
    : null;

  while (remaining.length) {
    let bestIndex = 0;

    if (currentPoint) {
      let bestDist = Infinity;

      remaining.forEach((store, idx) => {
        if (!hasCoords(store)) return;
        const dist = distanceKm(currentPoint.lat, currentPoint.lng, store.lat, store.lng);
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

  if (routeStores.length <= 18) {
    setSplitRouteCache(routeStores);
    render();
    alert(`店舗数が ${routeStores.length} 件あるため、ルートを2本に分けました。今日のルート欄の「ルート1を開く」「ルート2を開く」から開いてください。`);
    return;
  }

  clearSplitRouteCache();
  render();
  alert(`店舗数が ${routeStores.length} 件あります。Googleマップで安定して使うため、18件以下に絞ってください。`);
}

function autoOptimizeTodayRoute() {
  const routeStores = getTodayRouteStores();
  if (!routeStores.length) {
    alert("今日のルートに店舗がありません。");
    return;
  }

  const optimized = getNearestNeighborRoute(routeStores, window.lastPos);
  todayRouteOrder = optimized.map(s => s.id);

  clearSplitRouteCache();
  saveAll();
  render();
  alert("今日のルートを自動最適化しました。");
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

  todayRouteOrder = route.storeIds.filter(id => stores.some(s => s.id === id && s.today));
  clearSplitRouteCache();
  syncTodayRouteOrder();

  saveAll();
  render();
  alert(`「${route.name}」を今日のルートに読み込みました。`);
}

function openSavedRouteInMaps(routeId) {
  const route = savedRoutes.find(r => r.id === routeId);
  if (!route) return;

  const routeStores = buildSavedRouteStores(route).filter(s => hasCoords(s) || s.address);
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
