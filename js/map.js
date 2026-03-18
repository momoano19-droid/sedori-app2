let map = null;
let mapMarkers = [];
let mapInitialized = false;
let mapPanelOpen = false;

function getMarkerLevel(expected){
  if(expected >= 10000) return "red";
  if(expected >= 3000) return "orange";
  if(expected >= 1000) return "yellow";
  return "blue";
}

function makeMarkerIcon(level){
  return L.divIcon({
    html: `<div class="marker-pin marker-${level}"></div>`,
    className: "",
    iconSize: [18,18],
    iconAnchor: [9,9],
    popupAnchor: [0,-10]
  });
}

function initMap(){
  if(mapInitialized) return;
  map = L.map("map", { zoomControl: true }).setView([35.681236, 139.767125], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);
  mapInitialized = true;
}

function clearMapMarkers(){
  mapMarkers.forEach(m => map.removeLayer(m));
  mapMarkers = [];
}

function toggleMapPanel(){
  const wrap = document.getElementById("mapWrap");
  mapPanelOpen = !mapPanelOpen;
  wrap.classList.toggle("show", mapPanelOpen);

  if(mapPanelOpen){
    initMap();
    setTimeout(()=>{
      if(map) map.invalidateSize();
      if(typeof renderMapMarkers === "function") renderMapMarkers();
    }, 80);
  }
}

function moveMapToCurrentLocation(){
  if(!navigator.geolocation){
    alert("この端末では位置情報が使えません。");
    return;
  }
  if(!mapInitialized){
    mapPanelOpen = true;
    document.getElementById("mapWrap").classList.add("show");
    initMap();
    setTimeout(()=>map.invalidateSize(), 80);
  }

  navigator.geolocation.getCurrentPosition(
    pos=>{
      window.lastPos = {lat: pos.coords.latitude, lng: pos.coords.longitude};
      map.setView([window.lastPos.lat, window.lastPos.lng], 15);
      if(typeof renderMapMarkers === "function") renderMapMarkers();
    },
    ()=> alert("現在地を取得できませんでした。"),
    {enableHighAccuracy:true, timeout:10000}
  );
}