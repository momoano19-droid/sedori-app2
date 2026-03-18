let stores = loadStores();
let logs = loadLogs();
let selectedDate = "";

function buildMonthSelect(){
  const sel = document.getElementById("monthSelect");
  if(!sel) return;

  const set = new Set();

  logs.forEach(l=>{
    if(l.date && String(l.date).length >= 7){
      set.add(String(l.date).slice(0,7));
    }
  });

  if(set.size === 0){
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    set.add(month);
  }

  const months = Array.from(set).sort().reverse();
  const current = sel.value || months[0] || "";

  sel.innerHTML = months.map(m => `<option value="${m}">${m}</option>`).join("");

  if(months.includes(current)){
    sel.value = current;
  }else if(months.length){
    sel.value = months[0];
  }
}

function buildPrefFilter(){
  const sel = document.getElementById("prefFilter");
  if(!sel) return;

  const prefSet = new Set();
  stores.forEach(s=>{
    const p = String(s.pref || "").trim();
    if(p) prefSet.add(p);
  });

  const prefs = Array.from(prefSet).sort((a,b)=>a.localeCompare(b,'ja'));
  const current = sel.value || "__ALL__";

  sel.innerHTML =
    `<option value="__ALL__">全都道府県</option>` +
    prefs.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");

  if(["__ALL__", ...prefs].includes(current)){
    sel.value = current;
  }else{
    sel.value = "__ALL__";
  }
}

function getFilteredStores(){
  const prefEl = document.getElementById("prefFilter");
  const pref = prefEl ? prefEl.value : "__ALL__";
  if(pref === "__ALL__") return stores.slice();
  return stores.filter(s => String(s.pref || "").trim() === pref);
}

function getMonthLogs(month, storeIdsSet){
  return logs.filter(l => String(l.date || "").startsWith(month) && storeIdsSet.has(l.storeId));
}

function getCellClass(d){
  if(!d) return "dayCell";
  if((d.profit || 0) >= 100000) return "dayCell big";
  if((d.success || 0) > 0 || (d.profit || 0) > 0) return "dayCell good";
  if((d.visits || 0) > 0 || (d.items || 0) > 0) return "dayCell hasData";
  return "dayCell";
}

function renderCalendar(month, dailyMap){
  const [year, mon] = month.split("-").map(Number);
  const first = new Date(year, mon - 1, 1);
  const lastDay = new Date(year, mon, 0).getDate();
  const firstWeekday = first.getDay();

  let html = `
    <div class="sectionTitle">🗓 月カレンダー</div>
    <div class="card">
      <div class="calendarHead">
        <div>日</div><div>月</div><div>火</div><div>水</div><div>木</div><div>金</div><div>土</div>
      </div>
      <div class="calendarGrid">
  `;

  for(let i=0;i<firstWeekday;i++){
    html += `<div class="dayCell empty"></div>`;
  }

  for(let day=1; day<=lastDay; day++){
    const date = formatDate(year, mon, day);
    const d = dailyMap[date];
    let cls = getCellClass(d);
    if(selectedDate === date) cls += " selected";

    const mini = d
      ? `<div class="dayMini">利益 ${Number(d.profit || 0).toLocaleString()}円</div>`
      : "";

    html += `
      <button class="${cls}" onclick="selectDate('${date}')">
        <div class="dayNum">${day}</div>
        ${mini}
      </button>
    `;
  }

  html += `
      </div>
      <div class="legend">
        <div class="legendItem"><span class="legendBox"></span> データなし</div>
        <div class="legendItem"><span class="legendBox hasData"></span> 訪問あり</div>
        <div class="legendItem"><span class="legendBox good"></span> 成功・利益あり</div>
        <div class="legendItem"><span class="legendBox big"></span> 利益10万円以上</div>
      </div>
    </div>
  `;
  return html;
}

function selectDate(date){
  selectedDate = date;
  renderReport();
}

function tableForStores(rows, columns){
  return `
    <table>
      <thead>
        <tr>${columns.map(c=>`<th>${c.label}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows.map(r=>`
          <tr>
            ${columns.map(c=>`<td>${c.render(r)}</td>`).join("")}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderReport(){
  stores = loadStores();
  logs = loadLogs();

  buildMonthSelect();
  buildPrefFilter();

  const monthEl = document.getElementById("monthSelect");
  const reportArea = document.getElementById("reportArea");
  if(!monthEl || !reportArea) return;

  const month = monthEl.value;
  const filteredStores = getFilteredStores();
  const storeIdsSet = new Set(filteredStores.map(s => s.id));
  const monthLogs = getMonthLogs(month, storeIdsSet);
  const storeMap = new Map(filteredStores.map(s => [s.id, s]));

  let monthProfit = 0;
  let monthVisits = 0;
  let monthSuccess = 0;
  let monthItems = 0;

  monthLogs.forEach(l=>{
    if(l.type === "profit") monthProfit += Number(l.delta) || 0;
    if(l.type === "visit" && Number(l.delta) > 0) monthVisits += Number(l.delta) || 0;
    if(l.type === "success" && Number(l.delta) > 0) monthSuccess += Number(l.delta) || 0;
    if(l.type === "items" && Number(l.delta) > 0) monthItems += Number(l.delta) || 0;
  });

  const monthRate = monthVisits > 0 ? (monthSuccess / monthVisits) * 100 : 0;

  const weekdayMap = {
    "月": {profit:0, visits:0, success:0},
    "火": {profit:0, visits:0, success:0},
    "水": {profit:0, visits:0, success:0},
    "木": {profit:0, visits:0, success:0},
    "金": {profit:0, visits:0, success:0},
    "土": {profit:0, visits:0, success:0},
    "日": {profit:0, visits:0, success:0}
  };

  const dailyMap = {};
  monthLogs.forEach(l=>{
    const d = String(l.date || "");
    if(!d) return;

    if(!dailyMap[d]){
      dailyMap[d] = {profit:0, visits:0, success:0, items:0, storeIds:new Set()};
    }

    if(l.type === "profit") dailyMap[d].profit += Number(l.delta) || 0;
    if(l.type === "visit" && Number(l.delta) > 0) dailyMap[d].visits += Number(l.delta) || 0;
    if(l.type === "success" && Number(l.delta) > 0) dailyMap[d].success += Number(l.delta) || 0;
    if(l.type === "items" && Number(l.delta) > 0) dailyMap[d].items += Number(l.delta) || 0;
    dailyMap[d].storeIds.add(l.storeId);

    const w = getWeekdayJa(l.date);
    if(weekdayMap[w]){
      if(l.type === "profit") weekdayMap[w].profit += Number(l.delta) || 0;
      if(l.type === "visit" && Number(l.delta) > 0) weekdayMap[w].visits += Number(l.delta) || 0;
      if(l.type === "success" && Number(l.delta) > 0) weekdayMap[w].success += Number(l.delta) || 0;
    }
  });

  const categoryMap = {};
  monthLogs.forEach(l=>{
    if(l.type === "items" && Number(l.delta) > 0 && l.category){
      const c = String(l.category).trim();
      if(!c) return;
      categoryMap[c] = (categoryMap[c] || 0) + (Number(l.delta) || 0);
    }
  });

  const enrichedStores = filteredStores.map(s=>{
    const m = getStoreAdvancedMetrics(logs, s);
    return {
      ...s,
      _m: m,
      _restock: m.restockCycle,
      _strongWeekdays: m.strongWeekdays
    };
  });

  const topExpected = enrichedStores.slice().sort((a,b)=>b._m.expected - a._m.expected).slice(0,10);

  if(!selectedDate || !String(selectedDate).startsWith(month)){
    const dates = Object.keys(dailyMap).sort();
    selectedDate = dates.length ? dates[dates.length - 1] : "";
  }

  const selected = selectedDate ? dailyMap[selectedDate] : null;
  const selectedStores = selected
    ? Array.from(selected.storeIds).map(id => storeMap.get(id)).filter(Boolean)
    : [];

  reportArea.innerHTML = `
    <div class="card">
      <div class="sectionTitle">📌 ${escapeHtml(month)} サマリー</div>
      <div class="kv">
        <div class="pill"><b>対象店舗</b> ${filteredStores.length}件</div>
        <div class="pill"><b>今月利益</b> ${monthProfit.toLocaleString()}円</div>
        <div class="pill"><b>今月訪問</b> ${monthVisits}回</div>
        <div class="pill"><b>今月成功</b> ${monthSuccess}回</div>
        <div class="pill"><b>今月個数</b> ${monthItems}個</div>
        <div class="pill"><b>今月成功率</b> ${monthRate.toFixed(1)}%</div>
      </div>
    </div>

    ${renderCalendar(month, dailyMap)}

    <div class="sectionTitle">📝 選択日の詳細 ${selectedDate ? `(${escapeHtml(selectedDate)} ${getWeekdayJa(selectedDate)})` : ""}</div>
    <div class="card">
      ${selected ? `
        <div class="kv">
          <div class="pill"><b>利益</b> ${selected.profit.toLocaleString()}円</div>
          <div class="pill"><b>訪問</b> ${selected.visits}回</div>
          <div class="pill"><b>成功</b> ${selected.success}回</div>
          <div class="pill"><b>個数</b> ${selected.items}個</div>
        </div>
        ${selectedStores.length ? `
          <table>
            <thead><tr><th>店舗</th><th>都道府県</th></tr></thead>
            <tbody>
              ${selectedStores.map(s=>`
                <tr>
                  <td>${escapeHtml(s.name)}</td>
                  <td>${escapeHtml(String(s.pref || "").trim() || "未設定")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        ` : `<div class="gray">店舗データがありません。</div>`}
      ` : `<div class="gray">この日のデータはありません。</div>`}
    </div>

    <div class="sectionTitle">📅 曜日分析</div>
    <table>
      <thead>
        <tr><th>曜日</th><th>利益</th><th>訪問</th><th>成功</th><th>成功率</th></tr>
      </thead>
      <tbody>
        ${["月","火","水","木","金","土","日"].map(w=>{
          const row = weekdayMap[w];
          const rate = row.visits > 0 ? (row.success / row.visits) * 100 : 0;
          return `
            <tr>
              <td>${w}</td>
              <td>${row.profit.toLocaleString()}円</td>
              <td>${row.visits}回</td>
              <td>${row.success}回</td>
              <td>${rate.toFixed(1)}%</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>

    <div class="sectionTitle">🏆 期待値TOP10</div>
    ${tableForStores(topExpected, [
      {label:"店舗", render:r=>escapeHtml(r.name)},
      {label:"都道府県", render:r=>escapeHtml(String(r.pref || "").trim() || "未設定")},
      {label:"期待値", render:r=>`${Math.round(r._m.expected).toLocaleString()}円`},
      {label:"成功率", render:r=>`${r._m.rate.toFixed(1)}%`}
    ])}

    <div class="sectionTitle">🗂 カテゴリ集計（今月個数）</div>
    ${Object.keys(categoryMap).length ? `
      <table>
        <thead><tr><th>カテゴリ</th><th>個数</th></tr></thead>
        <tbody>
          ${Object.entries(categoryMap)
            .sort((a,b)=>b[1]-a[1])
            .map(([k,v])=>`
              <tr>
                <td>${escapeHtml(k)}</td>
                <td>${v}</td>
              </tr>
            `).join("")}
        </tbody>
      </table>
    ` : `<div class="card"><div class="gray">今月のカテゴリ個数ログはまだありません。</div></div>`}
  `;
}

(function init(){
  buildMonthSelect();
  buildPrefFilter();
  renderReport();
})();