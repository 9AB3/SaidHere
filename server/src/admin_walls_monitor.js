import { hashToken } from './auth.js';
import { pool } from './db.js';

const ADMIN_COOKIE = 'the_wall_admin';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value) { return typeof value === 'string' ? value.trim() : ''; }
function validUuid(value) { return UUID_RE.test(String(value || '')); }
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function parseCookies(req) {
  const result = {};
  for (const part of (req.get('cookie') || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const key = part.slice(0, at).trim();
    if (!key) continue;
    try { result[key] = decodeURIComponent(part.slice(at + 1).trim()); }
    catch (_) { result[key] = part.slice(at + 1).trim(); }
  }
  return result;
}
async function requireAdmin(req, res, next) {
  try {
    const raw = parseCookies(req)[ADMIN_COOKIE] || '';
    if (!raw) return res.redirect(303, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
    const result = await pool.query(
      `select s.id as session_id, u.id, u.username, u.display_name, u.role
         from admin_sessions s
         join admin_users u on u.id = s.admin_user_id
        where s.token_hash = $1 and s.expires_at > now() and u.active = true
        limit 1`,
      [hashToken(raw)],
    );
    if (result.rowCount === 0) return res.redirect(303, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
    req.wallsAdmin = result.rows[0];
    return next();
  } catch (error) { return next(error); }
}

function roleLabel(role) { return role === 'owner' ? 'Main Admin' : 'Moderator'; }
function fmt(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}
function ownerLabel(row) {
  return clean(row.owner_name) || clean(row.owner_email) || clean(row.purchaser_email) || 'Unassigned';
}
function accessSql(admin, alias = 'w') {
  if (admin.role === 'owner') return { sql: '', params: [] };
  return {
    sql: `join admin_wall_assignments awa on awa.wall_id = ${alias}.id and awa.admin_user_id = $1`,
    params: [admin.id],
  };
}

async function listWalls(admin) {
  const access = accessSql(admin);
  const result = await pool.query(
    `select w.id, w.display_name, w.active,
            c.email as owner_email, c.display_name as owner_name,
            o.purchaser_email
       from walls w
       ${access.sql}
       left join wall_ownerships wo on wo.wall_id = w.id and wo.ended_at is null
       left join customer_accounts c on c.id = wo.customer_id
       left join commerce_orders o on o.id = wo.order_id
      order by lower(w.display_name), w.created_at`,
    access.params,
  );
  return result.rows;
}

async function getWall(admin, wallId) {
  if (!validUuid(wallId)) return null;
  const access = accessSql(admin);
  const offset = access.params.length;
  const result = await pool.query(
    `select w.id, w.slug, w.display_name, w.location_hint, w.active, w.created_at,
            c.email as owner_email, c.display_name as owner_name,
            o.purchaser_email,
            (select count(*)::int from wall_visits v where v.wall_id = w.id) as unique_visitors,
            (select count(*)::int from wall_posts p where p.wall_id = w.id and p.hidden_at is null) as post_count,
            (select count(*)::int from wall_visit_events e where e.wall_id = w.id) as scan_count
       from walls w
       ${access.sql}
       left join wall_ownerships wo on wo.wall_id = w.id and wo.ended_at is null
       left join customer_accounts c on c.id = wo.customer_id
       left join commerce_orders o on o.id = wo.order_id
      where w.id = $${offset + 1}
      limit 1`,
    [...access.params, wallId],
  );
  return result.rows[0] || null;
}

async function listPosts(wallId) {
  const result = await pool.query(
    `select id, parent_id, body, created_at
       from wall_posts
      where wall_id = $1 and hidden_at is null
      order by created_at asc`,
    [wallId],
  );
  return result.rows;
}

async function analyticsRows(admin, wallIds, days, metric) {
  const accessible = await listWalls(admin);
  const allowed = new Set(accessible.map((wall) => String(wall.id)));
  const ids = wallIds.filter((id) => validUuid(id) && allowed.has(String(id))).slice(0, 12);
  if (ids.length === 0) return { walls: [], points: [] };
  const safeDays = [7, 30, 90].includes(days) ? days : 30;
  const table = metric === 'posts' ? 'wall_posts' : 'wall_visit_events';
  const timeColumn = metric === 'posts' ? 'created_at' : 'visited_at';
  const hidden = metric === 'posts' ? 'and hidden_at is null' : '';
  const result = await pool.query(
    `select wall_id,
            to_char(date_trunc('day', ${timeColumn}), 'YYYY-MM-DD') as day,
            count(*)::int as count
       from ${table}
      where wall_id = any($1::uuid[])
        and ${timeColumn} >= now() - ($2::text || ' days')::interval
        ${hidden}
      group by wall_id, date_trunc('day', ${timeColumn})
      order by day asc`,
    [ids, safeDays],
  );
  const names = accessible.filter((wall) => ids.includes(String(wall.id))).map((wall) => ({ id: wall.id, name: wall.display_name }));
  return { walls: names, points: result.rows };
}

function shell({ admin, title, subtitle, content, script = '' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHtml(title)} · SaidHere Admin</title><style>
  .wm{max-width:1080px;margin:auto}.wm-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 0 13px}.wm-toolbar h2{margin:0;font-size:20px}.wm-toolbar p{margin:4px 0 0;color:#6b7280;font-size:10px}.wm-btn{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:8px 11px;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#20242a;text-decoration:none;font-size:8px;text-transform:uppercase;letter-spacing:.45px;font-weight:900}.wm-list{overflow:hidden;border:1px solid #dfe3e8;border-radius:11px;background:#fff}.wm-head,.wm-row{display:grid;grid-template-columns:minmax(220px,1.4fr) minmax(220px,1.5fr) 110px 24px;gap:12px;align-items:center}.wm-head{padding:8px 13px;background:#f8f9fa;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:7px;text-transform:uppercase;letter-spacing:.6px;font-weight:900}.wm-row{min-height:58px;padding:10px 13px;border-bottom:1px solid #eef0f2;color:#17191d;text-decoration:none}.wm-row:last-child{border-bottom:0}.wm-row:hover{background:#fbfcfd}.wm-name{font-size:11px;font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wm-owner{font-size:9px;color:#5f6670;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wm-status{display:inline-flex;width:max-content;padding:5px 7px;border-radius:99px;font-size:7px;text-transform:uppercase;letter-spacing:.45px;font-weight:900}.wm-status.on{background:#eaf5ed;color:#356d48}.wm-status.off{background:#faecea;color:#a13e35}.wm-chevron{color:#9aa0a8;font-size:18px}.wm-search{width:100%;min-height:40px;margin:0 0 10px;padding:9px 11px;border:1px solid #d1d5db;border-radius:8px;background:#fff;font-size:11px}.wm-empty{padding:28px;text-align:center;color:#6b7280;font-size:10px}.wm-back{display:inline-block;margin:0 0 10px;color:#5f6670;text-decoration:none;font-size:9px;font-weight:800}.wm-card{background:#fff;border:1px solid #dfe3e8;border-radius:11px;padding:14px;margin-bottom:11px}.wm-title{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.wm-title h2{margin:0;font-size:21px}.wm-title p{margin:4px 0 0;color:#6b7280;font-size:9px}.wm-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:12px}.wm-stat{padding:10px;border-radius:8px;background:#f7f8fa}.wm-stat b{display:block;font-size:18px}.wm-stat span{display:block;margin-top:3px;color:#707782;font-size:7px;text-transform:uppercase;letter-spacing:.55px;font-weight:900}.wm-chat{display:flex;flex-direction:column;gap:7px}.wm-post{padding:11px 12px;border:1px solid #e7eaee;border-radius:9px;background:#fff}.wm-post.reply{margin-left:26px;background:#fafbfc}.wm-post time{display:block;margin-bottom:5px;color:#8a9098;font-size:7px}.wm-post p{margin:0;font-size:11px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}.wm-readonly{padding:9px 11px;border-radius:8px;background:#f5f6f7;color:#6b7280;font-size:8px}.wm-analytics{display:grid;grid-template-columns:220px minmax(0,1fr);gap:11px}.wm-controls{background:#fff;border:1px solid #dfe3e8;border-radius:11px;padding:12px}.wm-controls h3{margin:0 0 8px;font-size:12px}.wm-selects{display:flex;gap:5px;margin-bottom:10px}.wm-selects button{flex:1;min-height:31px;border:1px solid #d5d9de;border-radius:7px;background:#fff;font-size:8px;font-weight:850;cursor:pointer}.wm-selects button.active{background:#17191d;color:#fff;border-color:#17191d}.wm-wall-picks{max-height:410px;overflow:auto;border-top:1px solid #edf0f2}.wm-pick{display:flex;align-items:center;gap:8px;padding:8px 2px;border-bottom:1px solid #f0f1f2;font-size:9px}.wm-pick input{width:17px;height:17px}.wm-chart-card{min-height:390px;background:#fff;border:1px solid #dfe3e8;border-radius:11px;padding:13px}.wm-chart-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.wm-chart-head h3{margin:0;font-size:14px}.wm-chart-head p{margin:4px 0 0;color:#6b7280;font-size:8px}.wm-chart{width:100%;min-height:300px;margin-top:10px}.wm-chart svg{display:block;width:100%;height:auto}.wm-legend{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.wm-legend span{font-size:8px}.wm-dot{display:inline-block;width:8px;height:8px;margin-right:4px;border-radius:50%}
  @media(max-width:720px){.wm-head{display:none}.wm-row{grid-template-columns:minmax(0,1fr) auto;gap:5px;margin-bottom:7px;border:1px solid #e1e4e8!important;border-radius:9px}.wm-row .wm-owner{grid-column:1}.wm-row .wm-status{grid-column:2;grid-row:1}.wm-row .wm-chevron{display:none}.wm-stats{grid-template-columns:repeat(3,1fr)}.wm-analytics{grid-template-columns:1fr}.wm-wall-picks{max-height:220px}.wm-toolbar{align-items:flex-start}.wm-post.reply{margin-left:14px}}
  </style>${script ? `<script src="${escapeHtml(script)}" defer></script>` : ''}</head><body><main class="shell"><header class="top"><div><h1>SaidHere</h1><small>Admin console</small></div><div>${escapeHtml(admin.display_name || admin.username)} · ${escapeHtml(roleLabel(admin.role))}</div></header><nav class="nav"><a class="active" href="/admin/walls">Walls</a>${admin.role === 'owner' ? '<a href="/admin/orders">Orders</a><a href="/admin/users">Users</a><a href="/admin/audit">Activity</a>' : '<a href="/admin/reports">Reports</a>'}</nav><section class="wm">${content}</section></main></body></html>`;
}

function listPage(admin, walls) {
  const rows = walls.map((wall) => `<a class="wm-row" href="/admin/walls/${encodeURIComponent(wall.id)}" data-search="${escapeHtml((wall.display_name + ' ' + ownerLabel(wall)).toLowerCase())}"><div class="wm-name">${escapeHtml(wall.display_name)}</div><div class="wm-owner">${escapeHtml(ownerLabel(wall))}</div><span class="wm-status ${wall.active ? 'on' : 'off'}">${wall.active ? 'Active' : 'Inactive'}</span><span class="wm-chevron">›</span></a>`).join('');
  const content = `<div class="wm-toolbar"><div><h2>Walls</h2><p>Read-only overview of deployed Walls.</p></div><a class="wm-btn" href="/admin/walls/analytics">Analytics</a></div><input id="wmWallSearch" class="wm-search" type="search" placeholder="Search Wall or owner"><div class="wm-list"><div class="wm-head"><span>Wall</span><span>Owner</span><span>Status</span><span></span></div>${rows || '<div class="wm-empty">No Walls available.</div>'}</div>`;
  return shell({ admin, title: 'Walls', subtitle: '', content, script: '/admin/walls-monitor.js' });
}

function postsHtml(posts) {
  const replies = new Map();
  const roots = [];
  for (const post of posts) {
    if (post.parent_id) {
      const key = String(post.parent_id);
      if (!replies.has(key)) replies.set(key, []);
      replies.get(key).push(post);
    } else roots.push(post);
  }
  const card = (post, reply = false) => `<article class="wm-post${reply ? ' reply' : ''}"><time>${escapeHtml(fmt(post.created_at))}</time><p>${escapeHtml(post.body)}</p></article>`;
  const blocks = [];
  for (const post of roots) {
    blocks.push(card(post));
    for (const reply of replies.get(String(post.id)) || []) blocks.push(card(reply, true));
  }
  return blocks.join('') || '<div class="wm-empty">No messages have been posted to this Wall yet.</div>';
}

function detailPage(admin, wall, posts) {
  const content = `<a class="wm-back" href="/admin/walls">← All Walls</a><div class="wm-card"><div class="wm-title"><div><h2>${escapeHtml(wall.display_name)}</h2><p>${escapeHtml(ownerLabel(wall))}${wall.location_hint ? ` · ${escapeHtml(wall.location_hint)}` : ''}</p></div><span class="wm-status ${wall.active ? 'on' : 'off'}">${wall.active ? 'Active' : 'Inactive'}</span></div><div class="wm-stats"><div class="wm-stat"><b>${escapeHtml(wall.unique_visitors)}</b><span>Unique visitors</span></div><div class="wm-stat"><b>${escapeHtml(wall.post_count)}</b><span>Posts</span></div><div class="wm-stat"><b>${escapeHtml(wall.scan_count)}</b><span>Tracked scans</span></div></div></div><div class="wm-toolbar"><div><h2>Conversation</h2><p>Read-only view of the public Wall chat.</p></div><a class="wm-btn" href="/admin/walls/analytics?wall=${encodeURIComponent(wall.id)}">View analytics</a></div><div class="wm-readonly">Admin viewing is read-only. Posting remains available only through an in-person Wall scan.</div><div class="wm-chat" style="margin-top:9px">${postsHtml(posts)}</div>`;
  return shell({ admin, title: wall.display_name, subtitle: '', content });
}

function analyticsPage(admin, walls, selectedWallId = '') {
  const picks = walls.map((wall, index) => `<label class="wm-pick"><input type="checkbox" value="${escapeHtml(wall.id)}" ${selectedWallId ? (String(wall.id) === selectedWallId ? 'checked' : '') : (index < 3 ? 'checked' : '')}><span>${escapeHtml(wall.display_name)}</span></label>`).join('');
  const content = `<a class="wm-back" href="/admin/walls">← All Walls</a><div class="wm-toolbar"><div><h2>Wall analytics</h2><p>Compare activity between Walls. Add or remove Walls at any time.</p></div></div><div class="wm-analytics"><aside class="wm-controls"><h3>Metric</h3><div class="wm-selects" data-group="metric"><button type="button" class="active" data-value="scans">Scans</button><button type="button" data-value="posts">Posts</button></div><h3>Range</h3><div class="wm-selects" data-group="days"><button type="button" data-value="7">7d</button><button type="button" class="active" data-value="30">30d</button><button type="button" data-value="90">90d</button></div><h3>Walls</h3><div class="wm-wall-picks" id="wmWallPicks">${picks || '<div class="wm-empty">No Walls available.</div>'}</div></aside><section class="wm-chart-card"><div class="wm-chart-head"><div><h3 id="wmChartTitle">Scans over time</h3><p id="wmChartNote">Scan history is recorded from this deployment onward. Historical unique visitor counts are still retained.</p></div></div><div id="wmChart" class="wm-chart"></div><div id="wmLegend" class="wm-legend"></div></section></div>`;
  return shell({ admin, title: 'Wall analytics', subtitle: '', content, script: '/admin/walls-monitor.js' });
}

const clientScript = String.raw`(() => {
  const search = document.getElementById('wmWallSearch');
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      document.querySelectorAll('.wm-row[data-search]').forEach((row) => {
        row.hidden = q && !(row.dataset.search || '').includes(q);
      });
    });
  }

  const picks = document.getElementById('wmWallPicks');
  const chart = document.getElementById('wmChart');
  if (!picks || !chart) return;

  const state = { metric: 'scans', days: 30 };
  const colours = ['#2f6f9f','#4d7d55','#9b633b','#755c9a','#9b4650','#3a817f','#9a7d34','#526277','#8a5682','#46705f','#805b3f','#586e9d'];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  document.querySelectorAll('.wm-selects button').forEach((button) => {
    button.addEventListener('click', () => {
      const group = button.closest('.wm-selects');
      group.querySelectorAll('button').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      if (group.dataset.group === 'metric') state.metric = button.dataset.value;
      if (group.dataset.group === 'days') state.days = Number(button.dataset.value || 30);
      load();
    });
  });
  picks.addEventListener('change', load);

  function chosenIds() {
    return [...picks.querySelectorAll('input:checked')].map((input) => input.value).slice(0, 12);
  }
  function dates(days) {
    const rows = [];
    const today = new Date();
    today.setHours(0,0,0,0);
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      rows.push(d.toISOString().slice(0,10));
    }
    return rows;
  }
  function shortDate(value) {
    const d = new Date(value + 'T00:00:00');
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  function render(payload) {
    const dayKeys = dates(state.days);
    const maps = new Map();
    (payload.walls || []).forEach((wall) => maps.set(String(wall.id), new Map()));
    (payload.points || []).forEach((point) => {
      const map = maps.get(String(point.wall_id));
      if (map) map.set(String(point.day), Number(point.count || 0));
    });
    const series = (payload.walls || []).map((wall, index) => ({
      id: String(wall.id), name: wall.name, colour: colours[index % colours.length], values: dayKeys.map((day) => maps.get(String(wall.id))?.get(day) || 0),
    }));
    const max = Math.max(1, ...series.flatMap((item) => item.values));
    const width = 820, height = 310, left = 38, right = 14, top = 15, bottom = 34;
    const iw = width-left-right, ih = height-top-bottom;
    const x = (i) => left + (dayKeys.length <= 1 ? 0 : i * iw / (dayKeys.length - 1));
    const y = (v) => top + ih - (v / max) * ih;
    let svg = '<svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Wall activity chart">';
    for (let i=0;i<=4;i+=1) {
      const value = Math.round(max * (4-i) / 4);
      const yy = top + ih * i / 4;
      svg += '<line x1="'+left+'" y1="'+yy+'" x2="'+(width-right)+'" y2="'+yy+'" stroke="#e8ebee" stroke-width="1"/><text x="'+(left-7)+'" y="'+(yy+3)+'" text-anchor="end" fill="#8a9098" font-size="9">'+value+'</text>';
    }
    const labelStep = state.days <= 7 ? 1 : state.days <= 30 ? 5 : 15;
    dayKeys.forEach((day, i) => {
      if (i % labelStep !== 0 && i !== dayKeys.length-1) return;
      svg += '<text x="'+x(i)+'" y="'+(height-9)+'" text-anchor="middle" fill="#8a9098" font-size="8">'+esc(shortDate(day))+'</text>';
    });
    series.forEach((item) => {
      const path = item.values.map((value, i) => (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ' ' + y(value).toFixed(1)).join(' ');
      svg += '<path d="'+path+'" fill="none" stroke="'+item.colour+'" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>';
      item.values.forEach((value, i) => {
        if (value === 0) return;
        svg += '<circle cx="'+x(i)+'" cy="'+y(value)+'" r="3" fill="'+item.colour+'"><title>'+esc(item.name)+' · '+esc(shortDate(dayKeys[i]))+': '+value+'</title></circle>';
      });
    });
    svg += '</svg>';
    chart.innerHTML = series.length ? svg : '<div class="wm-empty">Select at least one Wall to chart.</div>';
    const legend = document.getElementById('wmLegend');
    legend.innerHTML = series.map((item) => '<span><i class="wm-dot" style="background:'+item.colour+'"></i>'+esc(item.name)+'</span>').join('');
    const title = document.getElementById('wmChartTitle');
    title.textContent = (state.metric === 'posts' ? 'Posts' : 'Scans') + ' over time';
    const note = document.getElementById('wmChartNote');
    note.textContent = state.metric === 'scans'
      ? 'Scan event tracking starts from this deployment. Historical unique visitor totals are retained separately.'
      : 'Visible posts created during the selected period.';
  }
  async function load() {
    const ids = chosenIds();
    if (!ids.length) return render({ walls: [], points: [] });
    chart.innerHTML = '<div class="wm-empty">Loading activity…</div>';
    const query = new URLSearchParams({ ids: ids.join(','), days: String(state.days), metric: state.metric });
    try {
      const response = await fetch('/admin/walls/analytics-data?' + query.toString(), { credentials: 'same-origin' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      render(await response.json());
    } catch (_) {
      chart.innerHTML = '<div class="wm-empty">Could not load analytics.</div>';
    }
  }
  load();
})();`;

function readonlyBlock(req, res) {
  return res.status(403).type('html').send('<!doctype html><html><body style="font-family:Arial;padding:32px"><h1>Walls are read-only in Admin.</h1><p>Wall configuration is managed by the customer ownership flow. Admin can view Wall status, chat and analytics only.</p><p><a href="/admin/walls">Back to Walls</a></p></body></html>');
}

export function mountAdminWallsMonitor(app) {
  app.get('/admin/walls-monitor.js', (_req, res) => {
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.send(clientScript);
  });

  app.get('/admin/walls', requireAdmin, async (req, res, next) => {
    try { return res.type('html').send(listPage(req.wallsAdmin, await listWalls(req.wallsAdmin))); }
    catch (error) { return next(error); }
  });

  app.get('/admin/walls/analytics', requireAdmin, async (req, res, next) => {
    try {
      const walls = await listWalls(req.wallsAdmin);
      const selected = validUuid(req.query?.wall) ? String(req.query.wall) : '';
      return res.type('html').send(analyticsPage(req.wallsAdmin, walls, selected));
    } catch (error) { return next(error); }
  });

  app.get('/admin/walls/analytics-data', requireAdmin, async (req, res, next) => {
    try {
      const ids = clean(req.query?.ids).split(',').map((value) => value.trim()).filter(Boolean);
      const days = Number(req.query?.days || 30);
      const metric = clean(req.query?.metric) === 'posts' ? 'posts' : 'scans';
      return res.json(await analyticsRows(req.wallsAdmin, ids, days, metric));
    } catch (error) { return next(error); }
  });

  app.get('/admin/walls/:wallId', requireAdmin, async (req, res, next) => {
    try {
      const wall = await getWall(req.wallsAdmin, req.params.wallId);
      if (!wall) return res.sendStatus(404);
      return res.type('html').send(detailPage(req.wallsAdmin, wall, await listPosts(wall.id)));
    } catch (error) { return next(error); }
  });

  // Production plaques are expected to use locked NFC tags. Keep the platform
  // administrator surface deliberately observational: no NFC replacement, message
  // deletion, Wall deletion, renaming or active-state mutation from this portal.
  app.post('/admin/walls/create', requireAdmin, readonlyBlock);
  app.all('/admin/walls/:wallId/edit', requireAdmin, readonlyBlock);
  app.all('/admin/walls/:wallId/status', requireAdmin, readonlyBlock);
  app.all('/admin/walls/:wallId/replace-nfc', requireAdmin, readonlyBlock);
  app.all('/admin/walls/:wallId/clear', requireAdmin, readonlyBlock);
  app.all('/admin/walls/:wallId/delete', requireAdmin, readonlyBlock);
}
