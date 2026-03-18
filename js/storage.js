const KEY_STORES = "stores";
const KEY_LOGS = "logs";
const KEY_LAYOUT = "layout";

function loadStores(){
  return JSON.parse(localStorage.getItem(KEY_STORES) || "[]");
}

function saveStores(stores){
  localStorage.setItem(KEY_STORES, JSON.stringify(stores));
}

function loadLogs(){
  return JSON.parse(localStorage.getItem(KEY_LOGS) || "[]");
}

function saveLogs(logs){
  localStorage.setItem(KEY_LOGS, JSON.stringify(logs));
}

function loadLayout(){
  return localStorage.getItem(KEY_LAYOUT) || "detail";
}

function saveLayout(layout){
  localStorage.setItem(KEY_LAYOUT, layout);
}

function addLog(logs, storeId, type, delta, category=null){
  const rec = {
    date: tokyoDateStr(),
    storeId,
    type,
    delta: Number(delta) || 0
  };
  if(category){
    rec.category = String(category).trim();
  }
  logs.push(rec);
  saveLogs(logs);
}