(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const formatter = new Intl.NumberFormat('en-AU');
  const money = (value) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 }).format(Number(value || 0));
  const names = {
    scans: 'NFC opens', first_opens: 'First app opens',
    posts: 'Visible posts', paid_orders: 'Paid orders', revenue: 'Gross revenue', store_click: 'Store clicks',
  };
  let current = null;

  function format(value) { return formatter.format(Number(value) || 0); }
  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function barList(host, rows, colour = false) {
    host.replaceChildren();
    if (!rows.length) { host.append(make('div', 'ana-empty', 'No events recorded yet.')); return; }
    const maximum = Math.max(1, ...rows.map((r) => Number(r.value || 0)));
    for (const item of rows) {
      const group = make('div', '');
      const label = make('div', 'ana-row');
      label.append(make('span', '', item.label), make('strong', '', format(item.value)));
      const track = make('div', 'ana-track');
      const fill = make('div', 'ana-fill' + (colour ? ' alt' : ''));
      fill.style.width = String(Math.max(0, Math.min(100, (Number(item.value || 0) / maximum) * 100))) + '%';
      track.append(fill);
      group.append(label, track);
      host.append(group);
    }
  }

  function dateKeys(days) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((item) => [item.type, item.value]));
    const now = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
    return Array.from({ length: days }, (_, index) => {
      const date = new Date(now - (days - index - 1) * 86400000);
      return date.toISOString().slice(0, 10);
    });
  }

  function showChart(data) {
    const metric = $('anaMetric').value;
    const keys = dateKeys(data.days);
    const byDate = new Map(
      (data.trend || []).filter((p) => p.metric === metric)
        .map((p) => [String(p.day), Number(p.value) || 0]),
    );
    const values = keys.map((key) => byDate.get(key) || 0);
    const maximum = Math.max(1, ...values);
    const W = 900, H = 275, L = 58, R = 12, T = 17, B = 35;
    const chartW = W - L - R, chartH = H - T - B;
    const x = (i) => L + chartW * i / Math.max(1, keys.length - 1);
    const y = (v) => T + chartH * (1 - v / maximum);
    const tickText = (value) => metric === 'revenue' ? '$' + format(Math.round(value)) : format(Math.round(value));
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H +
      '" role="img" aria-label="Daily ' + names[metric] + ' chart">';
    for (let i = 0; i <= 4; i += 1) {
      const value = maximum * (4 - i) / 4;
      const yy = T + chartH * i / 4;
      svg += '<line x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy +
        '" stroke="#e8ebef" stroke-width="1"/><text x="' + (L - 8) + '" y="' + (yy + 4) +
        '" text-anchor="end" fill="#78818b" font-size="11">' + tickText(value) + '</text>';
    }
    const ticks = data.days === 7 ? 1 : data.days === 30 ? 5 : 15;
    keys.forEach((key, i) => {
      if (i % ticks !== 0 && i !== keys.length - 1) return;
      const date = new Date(key + 'T00:00:00Z');
      const label = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(date);
      svg += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" fill="#78818b" font-size="11">' + label + '</text>';
    });
    const points = values.map((value, i) => x(i).toFixed(2) + ',' + y(value).toFixed(2)).join(' ');
    const area = L + ',' + (T + chartH) + ' ' + points + ' ' + (W - R) + ',' + (T + chartH);
    svg += '<polygon points="' + area + '" fill="#dcece5" opacity=".68"/>';
    svg += '<polyline points="' + points + '" fill="none" stroke="#3b7560" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>';
    keys.forEach((key, i) => {
      if (!values[i]) return;
      svg += '<circle cx="' + x(i).toFixed(2) + '" cy="' + y(values[i]).toFixed(2) +
        '" r="3" fill="#32735a"><title>' + key + ': ' + tickText(values[i]) + '</title></circle>';
    });
    svg += '</svg>';
    $('anaChart').innerHTML = svg;
    $('anaLegend').textContent = names[metric] + ' · ' + data.days + ' calendar days · Sydney time';
  }

  function render(data) {
    current = data;
    for (const [key, value] of Object.entries(data.metrics || {})) {
      const target = document.querySelector('[data-kpi="' + key + '"]');
      if (target) target.textContent = key === 'revenue_cents' ? money(value / 100) : format(value);
    }
    barList($('anaPlatforms'), [
      { label: 'iPhone / iOS', value: data.platforms.ios },
      { label: 'Android', value: data.platforms.android },
    ], true);
    barList($('anaSources'), (data.sources || []).map((row) => ({
      label: String(row.source).replace(/^./, (letter) => letter.toUpperCase()),
      value: row.views,
    })));
    barList($('anaAppJourney'), [
      { label: 'NFC landing views (web)', value: data.web.nfc_views },
      { label: 'Store link clicks', value: data.web.store_clicks },
      { label: 'Tracked first app opens', value: data.metrics.first_opens },
      { label: 'Successful NFC tag opens', value: data.metrics.scans },
      { label: 'Visible posts and replies', value: data.metrics.posts },
    ], true);
    barList($('anaSalesJourney'), [
      { label: 'Shop page views', value: data.web.shop_views },
      { label: 'Checkout sessions created', value: data.web.checkouts },
      { label: 'Paid Wall orders', value: data.metrics.paid_orders },
    ]);
    const tbody = $('anaWalls');
    tbody.replaceChildren();
    if (!(data.top_walls || []).length) {
      const row = make('tr', '');
      const cell = make('td', '', 'No Walls available.');
      cell.colSpan = 4;
      row.append(cell);
      tbody.append(row);
    } else {
      for (const wall of data.top_walls) {
        const row = make('tr', '');
        [wall.name, format(wall.scans), format(wall.visitors), format(wall.posts)]
          .forEach((value) => row.append(make('td', '', value)));
        tbody.append(row);
      }
    }
    const note = $('anaNote');
    let noteText = 'Coverage: Web landing and store-click events start after deployment; old web events cannot be backfilled. ' +
      'First opens require updated iOS/Android builds and are not App Store or Play Store download totals. ' +
      'NFC opens are successful backend events, not every physical tap. ' +
      'Visitor counts are anonymous sessions, not verified people. Revenue is gross paid AUD, before fees and refunds. ' +
      'Journey numbers come from different visitors and time windows and must not be treated as attributable conversion rates.';
    if (data.metrics.other_currency_orders) noteText += ' Some non-AUD orders are excluded from the AUD revenue total.';
    note.textContent = noteText;
    showChart(data);
  }

  async function load() {
    const days = $('anaRange').value;
    $('anaStatus').textContent = 'Loading analytics…';
    $('anaExport').href = '/admin/analytics/export.csv?days=' + days;
    try {
      const response = await fetch('/admin/analytics/data?days=' + days, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      render(await response.json());
      $('anaStatus').textContent = '';
    } catch (error) {
      $('anaStatus').textContent = 'Could not load analytics (' + error.message + '). Please refresh.';
    }
  }

  $('anaRange')?.addEventListener('change', load);
  $('anaRefresh')?.addEventListener('click', load);
  $('anaMetric')?.addEventListener('change', () => { if (current) showChart(current); });
  load();
})();