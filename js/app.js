let stores = loadStores();
let logs = loadLogs();
let savedRoutes = loadSavedRoutes();
let todayRouteOrder = loadTodayRouteOrder();

let nearbyMode = false;
let nearbyStoreIds = new Set();
let noCoordsOnlyMode = false;
let currentLayoutMode = localStorage.getItem("store_layout_mode") || "compact";

let map = null;
let mapMarkers = [];
let mapInitialized = false;
let preserveMapViewOnNextRender = false;
let splitRouteCache = null;
window.lastPos = null;

let openSavedRouteId = null;

let categoryHistoryCache = null;
let categoryHistoryDirty = true;

let lastListRenderSignature = "";
let lastMapRenderSignature = "";
let mapRenderRafId = null;

let qtyCategoryModalResolver = null;
let qtyCategoryCurrentQty = 1;
let qtyCategorySelected = {};
let qtyCategoryProfit = 0;

let profitEditTargetIndex = -1;

/* =========================
   フィルタ / 描画
========================= */
function buildFilteredStoreList() {
  const { q, prefFilter, minExpected, minRate, sortType } = getFilterValues();

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

  return list;
}

function renderActiveFilterChips() {
  const wrap = document.getElementById("activeFilterChips");
  if (!wrap) return;

  const { q, prefFilter, minExpected, minRate, sortType } = getFilterValues();
  const chips = [];

  chips.push(`<span class="activeFilterChip activeSortChip">${escapeHtml(getSortLabel(sortType))}</span>`);

  if (prefFilter && prefFilter !== "__ALL__") {
    chips.push(`<span class="activeFilterChip">${escapeHtml(prefFilter)}</span>`);
  }

  if (minExpected > 0) {
    chips.push(`<span class="activeFilterChip">期待値 ${Math.round(minExpected).toLocaleString()}円以上</span>`);
  }

  if (minRate > 0) {
    chips.push(`<span class="activeFilterChip">成功率 ${Number(minRate).toLocaleString()}%以上</span>`);
  }

  if (q) {
    chips.push(`<span class="activeFilterChip">検索: ${escapeHtml(q)}</span>`);
  }

  if (nearbyMode) {
    chips.push(`<span class="activeFilterChip activeModeChip">近くの店舗</span>`);
  }

  if (noCoordsOnlyMode) {
    chips.push(`<span class="activeFilterChip activeModeChip">座標なし店舗</span>`);
  }

  if (
    chips.length === 1 &&
    !q &&
    prefFilter === "__ALL__" &&
    minExpected <= 0 &&
    minRate <= 0 &&
    !nearbyMode &&
    !noCoordsOnlyMode
  ) {
    chips.push(`<span class="activeFilterChip">全店舗表示</span>`);
  }

  wrap.innerHTML = chips.join("");
}

function buildPrefFilter() {
  const prefs = [...new Set(stores.map(s => s.pref).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ja")
  );

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

/* =========================
   店舗カード描画
========================= */
function renderCompactStoreCard(s, idx, m, dist, evalData, rateClass, expectedClass, staleClass) {
  const expectedHighClass = m.expected >= 10000 ? "high" : "";
  const compactBadges = [
    `<span class="badge">${escapeHtml(s.pref || "未設定")}</span>`,
    typeof dist === "number" ? `<span class="badge near">📍 ${dist.toFixed(1)}km</span>` : ``,
    s.mapUrl ? `<span class="badge map">🗺 MAPあり</span>` : ``,
    hasCoords(s) ? `<span class="badge" style="background:#eef8ff;color:#2563eb;">📡 座標あり</span>` : ``,
    `<span class="badge freq">補充頻度 ${formatRestockDays(m.freq)}</span>`
  ].filter(Boolean).join("");

  return `
    <div class="item compactCard ${expectedClass} ${staleClass}">
      <div class="evalLabel ${evalData.class}">
        ${evalData.label}
      </div>

      <div class="name">${escapeHtml(s.name)}</div>

      <div style="margin-top:6px;">
        ${compactBadges}
      </div>

      <div class="mini compactMainRow">
        <span>期待値 <span class="mainExpected ${expectedHighClass}">${Math.round(m.expected).toLocaleString()}円</span></span>
        <span class="${rateClass}">成功率 ${m.rate.toFixed(1)}%</span>
        <span>利益 <span class="mainProfit">${m.profit.toLocaleString()}円</span></span>
      </div>

      <div class="mini compactSubRow">
        <span>訪問 ${m.visits}回</span>
        <span>成功 ${m.success}回</span>
        <span>個数 ${m.items}個</span>
      </div>

      <div class="mt10">
        ${renderTodayToggleButton(idx, s.today)}
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#dff7e8", "#129b52")} onclick="visit(${idx})">訪問＋</button>
        <button ${makeButtonStyle("#e7f0ff", "#2563eb")} onclick="itemsPlus(${idx})">個数＋</button>
      </div>

      <div class="row2 mt8">
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="navigateToStore(${idx})">ナビ</button>
        <button ${makeButtonStyle("#eef1f7", "#1f2340")} onclick="editStore(${idx})">設定</button>
      </div>
    </div>
  `;
}

function renderDetailStoreCard(s, idx, m, dist, evalData, rateClass, expectedClass, staleClass) {
  const recent = getRecentStats(s.id);
  const streak = getNoSuccessStreak(s.id);
  const sinceVisitText = formatDaysSinceLastVisit(s.lastVisitDate);

  const categorySummary = Object.entries(s.categoryCounts || {})
    .filter(([, qty]) => Number(qty) > 0)
    .map(([cat, qty]) => `${cat}:${qty}`)
    .join(" / ");

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
        <div class="detailLine">🕒 最終訪問から：${escapeHtml(sinceVisitText)}</div>
        <div class="detailLine">📊 直近3回：成功 ${recent.recentSuccess}回 / ${recent.recentVisitCount}訪問（${recent.recentRate.toFixed(1)}%）</div>
        <div class="detailLine">💰 訪問あたり期待値：${Math.round(m.expected).toLocaleString()}円</div>
        ${streak >= 3 ? `<div class="detailLine detailWarn">⚠️ ${streak}回連続成功なし</div>` : ``}
      </div>

      <div class="mt10">
        ${renderTodayToggleButton(idx, s.today)}
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

function renderStoreCard(s, idx) {
  const m = getMetrics(s);
  const evalData = getStoreEvaluationLabel(m);
  const rateClass = getRateClass(m.rate);
  const expectedClass = getExpectedCardClass(m.expected);
  const staleClass = getStaleCardClass(s.lastVisitDate);

  let dist = null;
  if (window.lastPos && hasCoords(s)) {
    dist = distanceKm(window.lastPos.lat, window.lastPos.lng, s.lat, s.lng);
  }

  if (currentLayoutMode === "compact") {
    return renderCompactStoreCard(s, idx, m, dist, evalData, rateClass, expectedClass, staleClass);
  }

  return renderDetailStoreCard(s, idx, m, dist, evalData, rateClass, expectedClass, staleClass);
}

/* =========================
   補助表示
========================= */
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

function renderTodayRouteList() {
  const el = document.getElementById("todayRouteList");
  if (!el) return;

  syncTodayRouteOrder();

  const routeStores = todayRouteOrder
    .map(id => stores.find(s => s.id === id))
    .filter(s => s && s.today);

  if (!routeStores.length) {
    el.innerHTML = `<div class="mini emptyRouteText">チェックした店舗はまだありません。</div>`;
    return;
  }

  const splitButtonsHtml =
    splitRouteCache && routeStores.length >= 10 && routeStores.length <= 18
      ? `
        <div class="row2 mt8 routeSplitBtns">
          <button class="primaryBtn" onclick="openSplitRoutePart(1)">ルート1を開く</button>
          <button class="primaryBtn" onclick="openSplitRoutePart(2)">ルート2を開く</button>
        </div>
        <div class="mini routeSplitSub">
          ルート1：1〜9店舗目 / ルート2：10〜18店舗目
        </div>
      `
      : "";

  el.innerHTML = `
    ${splitButtonsHtml}
    ${routeStores.map((s, idx) => `
      <div class="item todayRouteItem">
        <div class="name todayRouteName">${idx + 1}. ${escapeHtml(s.name)}</div>
        <div class="mini">${escapeHtml(s.pref || "")}${s.address ? ` / ${escapeHtml(s.address)}` : ""}</div>

        <div class="row2 mt8">
          <button class="ghostBtn" onclick="moveTodayRouteItem(${idx}, -1)">↑ 上へ</button>
          <button class="ghostBtn" onclick="moveTodayRouteItem(${idx}, 1)">↓ 下へ</button>
        </div>

        <div class="row2 mt8">
          <button class="dangerBtn" onclick="removeTodayRouteItem(${idx})">ルートから外す</button>
          <div></div>
        </div>
      </div>
    `).join("")}
  `;
}

function renderSavedRoutesList() {
  const el = document.getElementById("savedRoutesList");
  if (!el) return;

  if (!savedRoutes.length) {
    el.innerHTML = "保存済みルートはまだありません。";
    return;
  }

  sortSavedRoutes();

  el.innerHTML = savedRoutes.map(route => {
    const routeStores = buildSavedRouteStores(route);
    const missingCount = Math.max(0, route.storeIds.length - routeStores.length);
    const preview = getSavedRoutePreviewText(route, 3);
    const isOpen = openSavedRouteId === route.id;

    return `
      <div class="savedRouteAccordion ${isOpen ? "open" : ""}" style="margin-top:12px;">
        <button
          type="button"
          class="savedRouteSummary"
          onclick="toggleSavedRouteOpen('${escapeJsString(route.id)}')"
        >
          <div class="savedRouteSummaryTop">
            <div class="savedRouteTitleWrap">
              <div class="savedRouteTitleRow">
                <span class="savedRouteTitle">${escapeHtml(route.name)}</span>
                ${route.favorite ? `<span class="savedRouteFavBadge">★ お気に入り</span>` : ``}
              </div>

              <div class="savedRouteMeta">
                作成: ${escapeHtml(formatDateTimeText(route.createdAt))}
                ${route.updatedAt ? ` / 更新: ${escapeHtml(formatDateTimeText(route.updatedAt))}` : ""}
              </div>
            </div>

            <div class="savedRouteChevron">${isOpen ? "▲" : "▼"}</div>
          </div>

          <div class="savedRouteCompactInfo">
            <div class="savedRouteCount">
              店舗数: ${route.storeIds.length}件
              ${missingCount > 0 ? ` / 削除済み店舗あり: ${missingCount}件` : ""}
            </div>

            ${route.note ? `<div class="savedRoutePreview">📝 ${escapeHtml(route.note)}</div>` : ``}
            ${preview ? `<div class="savedRoutePreview">📍 ${escapeHtml(preview)}${routeStores.length > 3 ? " / …" : ""}</div>` : ``}
          </div>
        </button>

        <div class="savedRouteDetail" style="display:${isOpen ? "block" : "none"};">
          ${
            routeStores.length
              ? `
                <div class="savedRouteFullList">
                  ${routeStores.map(s => `
                    <div class="savedRouteStoreLine">
                      <span class="savedRouteStoreDot">📍</span>
                      <span class="savedRouteStoreName">${escapeHtml(s.name)}</span>
                    </div>
                  `).join("")}
                </div>
              `
              : `<div class="mini">このルートの店舗が見つかりません。</div>`
          }

          <div class="savedRouteActionGrid">
            <button class="savedRouteActionBtn btnBlue" onclick="openSavedRoute('${escapeJsString(route.id)}')">今日に読込</button>
            <button class="savedRouteActionBtn btnGreen" onclick="openSavedRouteInMaps('${escapeJsString(route.id)}')">MAPで開く</button>
            <button class="savedRouteActionBtn btnWarn" onclick="toggleFavoriteRoute('${escapeJsString(route.id)}')">${route.favorite ? "★ お気に入り解除" : "☆ お気に入り"}</button>
            <button class="savedRouteActionBtn btnSoft" onclick="editSavedRoute('${escapeJsString(route.id)}')">編集</button>
            <button class="savedRouteActionBtn btnDanger" onclick="deleteSavedRoute('${escapeJsString(route.id)}')">削除</button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function render() {
  updateLayoutButtons();
  buildPrefFilter();
  syncTodayRouteOrder();

  const list = buildFilteredStoreList();
  const wrap = document.getElementById("storeList");
  if (!wrap) return;

  const filterValues = getFilterValues();
  const signature = JSON.stringify({
    ids: list.map(s => s.id),
    q: filterValues.q,
    prefFilter: filterValues.prefFilter,
    minExpected: filterValues.minExpected,
    minRate: filterValues.minRate,
    sortType: filterValues.sortType,
    nearbyMode,
    noCoordsOnlyMode,
    layout: currentLayoutMode,
    todayMarks: stores.filter(s => s.today).map(s => s.id),
    todayRouteOrder,
    splitRouteCacheExists: !!splitRouteCache,
    lastVisitDates: stores.map(s => `${s.id}:${s.lastVisitDate}`),
    savedRoutes: savedRoutes.map(r => `${r.id}:${r.updatedAt}:${r.favorite}`).join("|"),
    openSavedRouteId
  });

  if (signature !== lastListRenderSignature) {
    wrap.innerHTML = list.length
      ? list.map(s => renderStoreCard(s, s._idx)).join("")
      : `<div class="mini">${nearbyMode ? "近くの店舗は見つかりませんでした。" : "該当する店舗がありません。"}</div>`;
    lastListRenderSignature = signature;
  }

  renderActiveFilterChips();
  scheduleRenderMapMarkers();
  renderTodayRouteList();
  renderSavedRoutesList();

  if (!stores.length) {
    showEmptyDataGuide();
  }
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
      ・保存したルートを再利用できる<br>
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
      ④ 個数＋の中でカテゴリと利益もまとめて入力できる<br><br>
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
      ・住所だけでも登録できます<br>
      ・GoogleマップURLがあると座標を取りやすくなります
    `
  },
  {
    title: "🛣 今日のルート機能",
    content: `
      <b>今日行く店舗をまとめてルート化できます。</b><br><br>
      ① 店舗カードの「今日行く」にチェック<br>
      ② 下の今日のルート順に並ぶ<br>
      ③ ↑↓で順番変更<br>
      ④ 「この順番でルート作成」を押す<br><br>
      10〜18店舗のときは、ルート1 / ルート2 に分けて開けます。
    `
  },
  {
    title: "⭐ 保存済みルート",
    content: `
      <b>よく使うルートを保存できます。</b><br><br>
      ・ルート保存で保存<br>
      ・後から今日のルートに読込可能<br>
      ・お気に入り登録可能<br>
      ・ルート名やメモも変更できます
    `
  },
  {
    title: "📍 近くの店舗機能",
    content: `
      <b>現在地を使って近くの店舗を探せます。</b><br><br>
      ・近くの店舗（3km）で現在地近くを表示<br>
      ・3km以内が無い時は近い順で表示<br>
      ・現在地へ移動で地図を今いる位置へ移動できます
    `
  },
  {
    title: "💾 バックアップ",
    content: `
      <b>バックアップはかなり重要です。</b><br><br>
      ・手動バックアップでJSON保存<br>
      ・バックアップ読込で復元<br>
      ・自動バックアップも保存されます
    `
  }
];

function openHelp() {
  const el = document.getElementById("helpUI");
  const titleEl = document.getElementById("helpTitle");
  const contentEl = document.getElementById("helpContent");

  if (!el || !titleEl || !contentEl) {
    alert("使い方表示の読み込みに失敗しました。");
    return;
  }

  helpStep = 0;
  renderHelp();

  el.classList.add("show");
  el.setAttribute("aria-hidden", "false");
}

function closeHelp() {
  const el = document.getElementById("helpUI");
  if (!el) return;
  el.classList.remove("show");
  el.setAttribute("aria-hidden", "true");
}

function renderHelp() {
  const data = helpData[helpStep];
  const titleEl = document.getElementById("helpTitle");
  const contentEl = document.getElementById("helpContent");
  if (!data || !titleEl || !contentEl) return;

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
   ボタン押下エフェクト
========================= */
function setupButtonPressEffect() {
  const getButton = target => target?.closest?.("button");
  if (!document.body.dataset.pressReady) {
    document.body.dataset.pressReady = "1";

    const on = e => {
      const btn = getButton(e.target);
      if (btn) btn.classList.add("is-pressed");
    };

    const off = e => {
      const btn = getButton(e.target);
      if (btn) btn.classList.remove("is-pressed");
    };

    document.body.addEventListener("touchstart", on, { passive: true });
    document.body.addEventListener("touchend", off, { passive: true });
    document.body.addEventListener("touchcancel", off, { passive: true });

    document.body.addEventListener("mousedown", on);
    document.body.addEventListener("mouseup", off);
    document.body.addEventListener("mouseleave", off, true);
  }
}

/* =========================
   起動
========================= */
window.addEventListener("load", () => {
  syncTodayRouteOrder();
  initMap();
  updateLayoutButtons();
  restoreSortType();
  render();
  setTimeout(() => autoDetectNearbyStores(), 800);
  setupButtonPressEffect();
});

window.addEventListener("keydown", e => {
  const el = document.getElementById("helpUI");
  if (!el || !el.classList.contains("show")) return;
  if (e.key === "Escape") closeHelp();
});

window.addEventListener("load", () => {
  const el = document.getElementById("helpUI");
  if (!el) return;

  el.addEventListener("click", e => {
    if (e.target === el) closeHelp();
  });
});
