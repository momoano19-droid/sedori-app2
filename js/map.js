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

function renderCurrentLocationMarker() {
  if (!map || !window.lastPos) return;

  const { lat, lng } = window.lastPos;
  if (typeof lat !== "number" || typeof lng !== "number") return;

  const currentLocationIcon = L.divIcon({
    className: "current-location-marker-wrap",
    html: `
      <div class="current-location-nav-marker">
        <div class="current-location-nav-ring"></div>
        <div class="current-location-nav-arrow"></div>
        <div class="current-location-nav-dot"></div>
      </div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });

  if (currentLocationMarker) {
    currentLocationMarker.setLatLng([lat, lng]);
    currentLocationMarker.setIcon(currentLocationIcon);
    return;
  }

  currentLocationMarker = L.marker([lat, lng], {
    icon: currentLocationIcon,
    zIndexOffset: 1000
  }).addTo(map);

  currentLocationMarker.bindPopup("現在地");
}

function renderMapMarkersNow() {
  if (!mapInitialized || !map) return;

  const filterValues = getFilterValues();
  const list = buildFilteredStoreList().filter(s => hasCoords(s));
  const signature = JSON.stringify({
    ids: list.map(s => s.id),
    nearbyMode,
    noCoordsOnlyMode,
    q: filterValues.q,
    prefFilter: filterValues.prefFilter,
    minExpected: filterValues.minExpected,
    minRate: filterValues.minRate,
    todayMarks: stores.filter(s => s.today).map(s => s.id),
    currentPos: window.lastPos ? `${window.lastPos.lat},${window.lastPos.lng}` : ""
  });

  if (signature === lastMapRenderSignature) return;
  lastMapRenderSignature = signature;

  const shouldPreserveView = preserveMapViewOnNextRender;
  const currentCenter = shouldPreserveView ? map.getCenter() : null;
  const currentZoom = shouldPreserveView ? map.getZoom() : null;

  clearMapMarkers();

  if (noCoordsOnlyMode || !list.length) {
    renderCurrentLocationMarker();
    preserveMapViewOnNextRender = false;
    return;
  }

  const bounds = [];

  list.forEach(s => {
    const marker = L.marker([s.lat, s.lng], {
      icon: makeMarkerIcon(getMarkerColor(s._m.expected))
    }).addTo(map);

    const navUrl = hasCoords(s)
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${s.lat},${s.lng}`)}&travelmode=driving`
      : (s.address
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}`
          : "");

    marker.bindPopup(`
      <div style="min-width:170px; max-width:200px;">
        <div style="font-weight:800; font-size:14px; margin-bottom:4px; line-height:1.35;">
          ${escapeHtml(s.name)}
        </div>
        <div style="font-size:11px; color:#6b7280; margin-bottom:6px;">
          ${escapeHtml(s.pref || "未設定")}
        </div>
        <div style="font-size:12px; margin-bottom:3px; line-height:1.4;">
          期待値：${Math.round(s._m.expected).toLocaleString()}円
        </div>
        <div style="font-size:12px; margin-bottom:8px; line-height:1.4;">
          成功率：${s._m.rate.toFixed(1)}%
        </div>

        <label style="
          display:flex;
          align-items:center;
          gap:6px;
          font-size:11px;
          font-weight:700;
          margin-bottom:8px;
          cursor:pointer;
          line-height:1.1;
        ">
          <input
            type="checkbox"
            ${s.today ? "checked" : ""}
            onchange="toggleTodayByStoreId('${escapeJsString(s.id)}', this.checked)"
            style="
              width:20px;
              height:20px;
              min-width:20px;
              min-height:20px;
              margin:0;
              padding:0;
              vertical-align:middle;
            "
          >
          今日行く
        </label>

        ${
          navUrl
            ? `<button
                 type="button"
                 onclick="window.open('${navUrl}','_blank')"
                 style="
                   width:100%;
                   min-height:30px;
                   height:30px;
                   border:none;
                   border-radius:10px;
                   background:#3976f6;
                   color:#fff;
                   font-size:12px;
                   font-weight:800;
                   cursor:pointer;
                   padding:0 10px;
                 "
               >ナビ</button>`
            : `<div style="font-size:11px; color:#9ca3af;">住所または座標なし</div>`
        }
      </div>
    `);

    mapMarkers.push(marker);
    bounds.push([s.lat, s.lng]);
  });

  renderCurrentLocationMarker();

  if (shouldPreserveView && currentCenter && typeof currentZoom === "number") {
    map.setView(currentCenter, currentZoom);
  } else if (window.lastPos && bounds.length) {
    const allBounds = [...bounds, [window.lastPos.lat, window.lastPos.lng]];
    map.fitBounds(allBounds, { padding: [20, 20] });
  } else if (bounds.length === 1) {
    map.setView(bounds[0], 15);
  } else {
    map.fitBounds(bounds, { padding: [20, 20] });
  }

  preserveMapViewOnNextRender = false;
}

function scheduleRenderMapMarkers() {
  if (mapRenderRafId) cancelAnimationFrame(mapRenderRafId);
  mapRenderRafId = requestAnimationFrame(() => {
    mapRenderRafId = null;
    renderMapMarkersNow();
  });
}

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
    const res = await fetch(url, {
      headers: { Accept: "application/json" }
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
