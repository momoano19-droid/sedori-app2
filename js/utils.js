function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function clampNonNeg(n){
  return Math.max(0, Number(n) || 0);
}

function ensureId(){
  return (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + "_" + Math.random().toString(16).slice(2));
}

function tokyoDateStr(d=new Date()){
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone:'Asia/Tokyo',
    year:'numeric',
    month:'2-digit',
    day:'2-digit'
  }).formatToParts(d);
  const y = parts.find(p=>p.type==='year').value;
  const m = parts.find(p=>p.type==='month').value;
  const day = parts.find(p=>p.type==='day').value;
  return `${y}-${m}-${day}`;
}

function parseDateLocal(dateStr){
  if(!dateStr) return null;
  const parts = String(dateStr).split("-");
  if(parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if(!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function formatDate(y,m,d){
  return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

function getWeekdayJa(dateStr){
  const d = parseDateLocal(dateStr);
  if(!d) return "";
  return ["日","月","火","水","木","金","土"][d.getDay()];
}

function daysBetween(a, b){
  const da = parseDateLocal(a);
  const db = parseDateLocal(b);
  if(!da || !db) return null;
  return Math.abs(db - da) / (1000 * 60 * 60 * 24);
}