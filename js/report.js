function renderCalendar() {
  const area = document.getElementById("calendarArea");
  if (!area) return;

  const now = new Date();
  const sum = getMonthlySummarySmart(now);
  const { first, last } = reportGetMonthRange(now);

  let html = `
    <div class="sectionTitle">🗓 月カレンダー</div>
    <div class="store">
  `;

  for (let d = 1; d <= last.getDate(); d++) {
    const key = reportFormatYmd(new Date(now.getFullYear(), now.getMonth(), d));
    const data = sum.daily[key] || {};

    html += `
      <div class="calendarItem">
        <div class="calendarDate">${d}</div>
        ${
          data.profit
            ? `<div>利益 ${Math.round(data.profit).toLocaleString()}円</div>`
            : `<div class="mini">-</div>`
        }
        ${
          data.items
            ? `<div>個数 ${Math.round(data.items)}個</div>`
            : ``
        }
        ${
          data.visits
            ? `<div>訪問 ${Math.round(data.visits)}回</div>`
            : ``
        }
      </div>
    `;
  }

  html += `</div>`;
  area.innerHTML = html;
}
