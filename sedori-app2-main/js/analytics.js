function calcMetrics(s){
  const storeId = String(s?.id || "");

  const visitsFromLogs = (logs || []).reduce((sum, log) => {
    if (String(log?.storeId || "") !== storeId) return sum;
    if (String(log?.type || "") !== "visit") return sum;
    return sum + Number(log?.delta || 0);
  }, 0);

  const successFromLogs = (logs || []).reduce((sum, log) => {
    if (String(log?.storeId || "") !== storeId) return sum;
    if (String(log?.type || "") !== "success") return sum;
    return sum + Number(log?.delta || 0);
  }, 0);

  const itemsFromLogs = (logs || []).reduce((sum, log) => {
    if (String(log?.storeId || "") !== storeId) return sum;
    if (String(log?.type || "") !== "items") return sum;
    return sum + Number(log?.delta || 0);
  }, 0);

  const profitFromLogs = (logs || []).reduce((sum, log) => {
    if (String(log?.storeId || "") !== storeId) return sum;
    const type = String(log?.type || "");
    if (type !== "profit" && type !== "profit_adjust") return sum;
    return sum + Number(log?.delta || 0);
  }, 0);

  const visits = Math.max(0, visitsFromLogs || clampNonNeg(s.visits));
  const success = Math.max(0, successFromLogs || clampNonNeg(s.buyDays));
  const items = Math.max(0, itemsFromLogs || clampNonNeg(s.items));
  const profit = Math.max(0, profitFromLogs);

  const rate = visits > 0 ? (success / visits) * 100 : 0;
  const avgProfit = success > 0 ? (profit / success) : 0;
  const expected = visits > 0 ? (profit / visits) : 0;
  const profitPerItem = items > 0 ? (profit / items) : 0;
  const avgItems = success > 0 ? (items / success) : 0;

  return { visits, success, items, profit, rate, avgProfit, expected, profitPerItem, avgItems };
}

function getStoreVisitDates(logs, storeId){
  const dates = logs
    .filter(x => x.storeId === storeId && x.type === "visit" && Number(x.delta) > 0 && x.date)
    .map(x => x.date)
    .sort();
  return [...new Set(dates)];
}

function calcRestockCycle(logs, storeId){
  const dates = getStoreVisitDates(logs, storeId);
  if(dates.length < 2) return null;
  const diffs = [];
  for(let i=1;i<dates.length;i++){
    const diff = daysBetween(dates[i-1], dates[i]);
    if(typeof diff === "number" && diff > 0) diffs.push(diff);
  }
  if(!diffs.length) return null;
  return diffs.reduce((a,b)=>a+b,0) / diffs.length;
}

function calcStrongWeekdays(logs, storeId){
  const visitDates = getStoreVisitDates(logs, storeId);
  if(!visitDates.length) return [];
  const countMap = {};
  visitDates.forEach(dateStr=>{
    const w = getWeekdayJa(dateStr);
    if(!w) return;
    countMap[w] = (countMap[w] || 0) + 1;
  });
  const entries = Object.entries(countMap).sort((a,b)=>b[1]-a[1]);
  if(!entries.length) return [];
  const max = entries[0][1];
  return entries.filter(x => x[1] === max).map(x => x[0]);
}

function getStoreAdvancedMetrics(logs, s){
  const m = calcMetrics(s);
  const restockCycle = calcRestockCycle(logs, s.id);
  const strongWeekdays = calcStrongWeekdays(logs, s.id);
  return {
    ...m,
    restockCycle,
    strongWeekdays
  };
}
