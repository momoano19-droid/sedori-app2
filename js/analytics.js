function calcMetrics(s){
  const visits = clampNonNeg(s.visits);
  const success = clampNonNeg(s.buyDays);
  const items = clampNonNeg(s.items);
  const profit = clampNonNeg(s.profit);

  const rate = visits > 0 ? (success / visits) * 100 : 0;
  const avgProfit = success > 0 ? (profit / success) : 0;
  const expected = (rate / 100) * avgProfit;
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