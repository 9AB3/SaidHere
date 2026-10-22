(() => {
  'use strict';

  const path = location.pathname;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const text = (node) => (node?.textContent || '').trim();
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);

  const page = path.startsWith('/admin/orders') ? 'orders'
    : path.startsWith('/admin/reports') ? 'moderation'
      : path.startsWith('/admin/users') ? 'users'
        : path === '/admin/audit' ? 'activity'
          : path.startsWith('/admin/account') ? 'account'
            : 'walls';

  const pageMeta = {
    walls: ['Walls', 'Places, plaques and Wall activity'],
    orders: ['Orders', 'Payment, NFC setup and fulfilment'],
    moderation: ['Moderation', 'Reported posts waiting for a decision'],
    users: ['Users', 'Administrator access and Wall assignments'],
    activity: ['Activity', 'Recent administrator actions'],
    account: ['Account', 'Password and security'],
  };

  const css = `
    :root{--admin-bg:#f5f6f8;--admin-card:#fff;--admin-line:#e2e5e9;--admin-text:#17191d;--admin-muted:#6b7280;--admin-dark:#171717;--admin-green:#356d48;--admin-red:#a13e35;--admin-amber:#8b651b;--admin-blue:#345f8c;--admin-radius:12px}
    *{box-sizing:border-box}
    html,body{margin:0!important;min-height:100%;background:var(--admin-bg)!important;color:var(--admin-text)!important;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important}
    body.nav-open,body.modal-open{overflow:hidden}
    button,input,select{font:inherit}
    .admin-app{min-height:100vh;display:grid;grid-template-columns:232px minmax(0,1fr)}
    .admin-side{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;padding:18px 13px;background:var(--admin-dark);color:#fff;z-index:80}
    .admin-brand{display:flex;align-items:center;gap:10px;padding:0 7px 18px;border-bottom:1px solid #2d2d2d}
    .admin-brand img{width:40px;height:40px;object-fit:contain}
    .admin-brand b{display:block;font-size:16px;line-height:1}
    .admin-brand small{display:block;margin-top:4px;color:#8e8e8e;font-size:8px;text-transform:uppercase;letter-spacing:1px;font-weight:800}
    .admin-nav{display:flex!important;flex-direction:column!important;gap:3px!important;margin:13px 0!important;padding:0!important;background:none!important;border:0!important;box-shadow:none!important;position:static!important;overflow:visible!important}
    .nav-label{margin:11px 9px 5px;color:#777;font-size:8px;text-transform:uppercase;letter-spacing:1px;font-weight:900}
    .admin-nav a{display:flex!important;align-items:center!important;min-height:41px!important;padding:9px 11px!important;border:0!important;border-radius:8px!important;background:transparent!important;color:#c8c8c8!important;text-decoration:none!important;font-size:11px!important;font-weight:750!important;text-transform:none!important;letter-spacing:0!important}
    .admin-nav a:hover{background:#262626!important;color:#fff!important}.admin-nav a.active{background:#f5f5f3!important;color:#171717!important}
    .admin-profile{margin-top:auto;padding:12px 7px 0;border-top:1px solid #2d2d2d}.admin-profile b{display:block;font-size:10px}.admin-profile small{display:block;margin:3px 0 8px;color:#888;font-size:8px;text-transform:uppercase;letter-spacing:.7px}.admin-profile form{margin:0!important}.admin-profile button{width:100%;min-height:35px;border:1px solid #3b3b3b!important;border-radius:8px!important;background:#222!important;color:#ddd!important;font-size:9px!important;text-transform:uppercase!important;font-weight:850!important;cursor:pointer}
    .admin-main{min-width:0;padding:0 30px 50px}.admin-head{position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:12px;min-height:74px;margin:0 -30px 22px;padding:0 30px;background:rgba(245,246,248,.94);border-bottom:1px solid var(--admin-line);backdrop-filter:blur(12px)}.admin-head h1{margin:0!important;font-size:23px!important;letter-spacing:-.5px!important}.admin-head p{margin:4px 0 0!important;color:var(--admin-muted)!important;font-size:10px!important}.menu{display:none;width:38px;height:38px;border:1px solid var(--admin-line);border-radius:8px;background:#fff;font-size:18px;cursor:pointer}.admin-content{width:min(1160px,100%);margin:auto}.overlay{display:none}
    .panel,.report-card,.stat,.smtp,.nfc,.empty{background:#fff!important;border:1px solid var(--admin-line)!important;border-left:1px solid var(--admin-line)!important;border-radius:var(--admin-radius)!important;box-shadow:none!important}.panel{padding:19px!important;margin-bottom:13px!important}.panel h2{margin:0 0 7px!important;font-size:18px!important}.panel h3{font-size:14px!important}.help{color:var(--admin-muted)!important;font-size:11px!important;line-height:1.5!important}.grid{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:11px!important}.stack{display:flex!important;flex-direction:column!important;gap:11px!important}.field{display:flex!important;flex-direction:column!important;gap:5px!important}.field label{color:#555b64!important;font-size:8px!important;text-transform:uppercase!important;letter-spacing:.8px!important;font-weight:900!important}.field input,.field select,.search input{width:100%!important;min-height:41px!important;padding:9px 10px!important;border:1px solid #d1d5db!important;border-radius:8px!important;background:#fff!important;color:var(--admin-text)!important;font-size:12px!important;outline:none!important}.field input:focus,.field select:focus,.search input:focus{border-color:#6b7280!important;box-shadow:0 0 0 3px rgba(17,24,39,.06)!important}
    .actions,.report-actions,.primary-actions,.controls,.item-actions{display:flex!important;gap:7px!important;align-items:center!important;flex-wrap:wrap!important}.button,button.button,.link-action{display:inline-flex!important;align-items:center!important;justify-content:center!important;min-height:37px!important;padding:8px 11px!important;border:1px solid #17191d!important;border-radius:8px!important;background:#17191d!important;color:#fff!important;text-decoration:none!important;font-size:8px!important;text-transform:uppercase!important;letter-spacing:.5px!important;font-weight:900!important;cursor:pointer!important}.button.secondary,.link-action{background:#fff!important;color:#262a30!important;border-color:#d1d5db!important;text-decoration:none!important}.button.good{background:var(--admin-green)!important;border-color:var(--admin-green)!important}.button.warn{background:var(--admin-red)!important;border-color:var(--admin-red)!important}.button:disabled{opacity:.45!important;cursor:not-allowed!important}
    .notice,.error,.warning,.alert{padding:11px 13px!important;margin:0 0 12px!important;border:1px solid var(--admin-line)!important;border-left-width:4px!important;border-radius:9px!important;font-size:10px!important;font-weight:750!important}.notice,.alert.good{background:#edf7ef!important;border-left-color:var(--admin-green)!important;color:#31553b!important}.error,.alert.bad{background:#faecea!important;border-left-color:var(--admin-red)!important;color:#7d342e!important}.warning{background:#fff5d8!important;border-left-color:#c18f2c!important;color:#735513!important}
    .badge,.pill,.role{display:inline-flex!important;width:max-content!important;padding:5px 7px!important;border:0!important;border-radius:99px!important;font-size:7px!important;text-transform:uppercase!important;letter-spacing:.5px!important;font-weight:900!important}.badge.active,.pill.good{background:#eaf5ed!important;color:var(--admin-green)!important}.badge.inactive,.pill.bad{background:#faecea!important;color:var(--admin-red)!important}.pill.warn{background:#fff1c9!important;color:var(--admin-amber)!important}.pill.muted,.role{background:#eef0f2!important;color:#666!important}.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px!important;color:var(--admin-muted)!important}.back{display:none!important}
    .toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 13px}.toolbar b{display:block;font-size:12px}.toolbar span{display:block;margin-top:3px;color:var(--admin-muted);font-size:9px}.kpis,.stats{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:8px!important;margin-bottom:12px!important}.kpi,.stat{padding:12px!important;background:#fff!important;border:1px solid var(--admin-line)!important;border-radius:10px!important}.kpi b,.stat b{display:block;font-size:18px!important}.kpi span,.stat span{display:block;margin-top:4px;color:var(--admin-muted)!important;font-size:7px!important;text-transform:uppercase;letter-spacing:.6px;font-weight:900}
    .wall-grid{display:block!important}.wall-list{overflow:visible;border:1px solid var(--admin-line);border-radius:11px;background:#fff}.wall-list-head,.wall-row{display:grid;grid-template-columns:minmax(240px,1.8fr) 90px 90px 100px 150px;align-items:center;gap:10px}.wall-list-head{padding:8px 13px;background:#f8f9fa;border-bottom:1px solid var(--admin-line);color:var(--admin-muted);font-size:7px;text-transform:uppercase;letter-spacing:.65px;font-weight:900}.wall-row{min-height:72px;padding:10px 13px;border-bottom:1px solid #eef0f2}.wall-row:last-child{border-bottom:0}.wall-row:hover{background:#fbfcfd}.wall-main{min-width:0}.wall-main b{display:block;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wall-main>span{display:block;margin-top:3px;color:var(--admin-muted);font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wall-sub{margin-top:4px;color:#9298a1;font-size:7px}.wall-number{font-size:12px;font-weight:850}.wall-actions{display:flex;justify-content:flex-end;align-items:center;gap:6px}.wall-actions .button{min-height:34px!important}.more-menu{position:relative}.more-menu>summary{list-style:none;display:grid;place-items:center;width:35px;height:34px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:18px;line-height:1}.more-menu>summary::-webkit-details-marker{display:none}.more-menu[open]>summary{background:#f3f4f6}.more-pop{position:absolute;right:0;top:40px;z-index:30;width:185px;padding:6px;background:#fff;border:1px solid var(--admin-line);border-radius:9px;box-shadow:0 14px 35px rgba(17,24,39,.14)}.more-pop>*{width:100%!important;margin:0 0 4px!important}.more-pop>*:last-child{margin-bottom:0!important}.more-pop form button,.more-pop .button{width:100%!important;justify-content:flex-start!important;background:#fff!important;color:#262a30!important;border-color:transparent!important;text-align:left!important}.more-pop .warn{color:var(--admin-red)!important}
    .table-wrap{overflow:auto!important;border:1px solid var(--admin-line)!important;border-radius:9px!important;background:#fff}.table{width:100%!important;border-collapse:collapse!important;background:#fff!important}.table th{padding:9px 10px!important;background:#f7f8fa!important;color:var(--admin-muted)!important;font-size:7px!important;text-transform:uppercase!important;letter-spacing:.6px!important}.table td{padding:10px!important;border-top:1px solid #eef0f2!important;font-size:9px!important;vertical-align:middle!important}.table tbody tr:hover{background:#fbfcfd}.users-panel{padding:0!important;overflow:hidden}.users-panel>.help{padding:12px 14px;margin:0!important;border-top:1px solid #eef0f2}.user-primary strong{display:block;font-size:11px}.user-primary .handle{display:block;margin-top:3px;color:var(--admin-muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:8px}.user-primary .assignment{display:block;margin-top:4px;color:#8a9099;font-size:8px}.temp-password{display:block;margin-top:4px;color:var(--admin-amber);font-size:7px;font-weight:850}.user-actions{white-space:nowrap}.user-actions .button{min-height:32px!important;padding:7px 9px!important}
    .report-list{display:flex!important;flex-direction:column!important;gap:8px!important}.report-card{padding:14px!important}.report-body{margin:10px 0!important;font-size:13px!important;line-height:1.45!important}.report-meta{color:var(--admin-muted)!important;font-size:8px!important}.report-top{display:flex!important;justify-content:space-between!important;gap:12px!important}.report-intro{padding:0 0 11px!important;background:transparent!important;border:0!important}.report-intro h2{display:none!important}.report-intro .help{margin:0!important}
    .activity-panel{padding:0!important;background:transparent!important;border:0!important}.activity-panel>h2,.activity-panel>.help,.activity-panel>.table-wrap{display:none!important}.activity-intro{margin:0 0 14px}.activity-intro b{display:block;font-size:12px}.activity-intro span{display:block;margin-top:3px;color:var(--admin-muted);font-size:9px}.audit-timeline{position:relative;background:#fff;border:1px solid var(--admin-line);border-radius:11px;padding:14px 16px 2px}.audit-timeline:before{content:"";position:absolute;top:22px;bottom:22px;left:23px;width:1px;background:#e0e3e7}.audit-item{position:relative;display:grid;grid-template-columns:16px minmax(0,1fr);gap:13px;padding:0 0 16px}.audit-dot{position:relative;z-index:2;width:15px;height:15px;margin-top:3px;border:4px solid #fff;border-radius:50%;background:#79808a;box-shadow:0 0 0 1px #d7dbe0}.audit-dot.order{background:var(--admin-blue)}.audit-dot.wall{background:var(--admin-green)}.audit-dot.report{background:var(--admin-red)}.audit-dot.auth{background:#6b5f8f}.audit-main{padding-bottom:14px;border-bottom:1px solid #eef0f2}.audit-item:last-child .audit-main{border-bottom:0}.audit-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.audit-top strong{font-size:11px}.audit-top time{color:var(--admin-muted);font-size:8px;white-space:nowrap}.audit-sub{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;color:var(--admin-muted);font-size:8px}.audit-details-toggle{margin-top:8px}.audit-details-toggle summary{cursor:pointer;color:var(--admin-muted);font-size:7px;text-transform:uppercase;letter-spacing:.55px;font-weight:900}.audit-details-toggle pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:7px 0 0;padding:8px;border-radius:7px;background:#f5f6f7;font-size:8px}
    .pagehead{display:none!important}.smtp{display:inline-flex!important;align-items:center!important;gap:6px!important;padding:7px 9px!important;margin-bottom:11px!important;font-size:8px!important}.dot{width:7px!important;height:7px!important;border-radius:50%;background:var(--admin-red)!important}.dot.ok{background:var(--admin-green)!important}.order-sticky{position:sticky;top:74px;z-index:35;margin:0 0 10px;padding:8px 0 9px;background:linear-gradient(var(--admin-bg) 78%,rgba(245,246,248,0));}.order-sticky .search{display:flex!important;gap:7px!important;margin:0 0 7px!important}.tabs{display:flex!important;gap:5px!important;overflow:auto!important;margin:0!important;padding:0!important;background:none!important;border:0!important;box-shadow:none!important;position:static!important}.tab{display:flex!important;align-items:center!important;gap:5px!important;min-height:31px!important;padding:7px 9px!important;border:1px solid var(--admin-line)!important;border-radius:8px!important;background:#fff!important;color:#5f646c!important;text-decoration:none!important;font-size:8px!important;font-weight:900!important;text-transform:none!important;letter-spacing:0!important;white-space:nowrap!important}.tab span{display:grid!important;place-items:center!important;min-width:18px!important;height:18px!important;border-radius:99px!important;background:#f0f1f3!important}.tab.active{background:#17191d!important;color:#fff!important;border-color:#17191d!important}.tab.active span{background:#303238!important;color:#fff!important}
    .orders{display:flex!important;flex-direction:column!important;gap:0!important;border:1px solid var(--admin-line)!important;border-radius:11px!important;background:#fff!important;overflow:visible!important}.order-list-head,.order-summary{display:grid;grid-template-columns:minmax(220px,1.55fr) 145px 100px 165px 105px 22px;align-items:center;gap:10px}.order-list-head{padding:8px 12px;background:#f8f9fa;border:1px solid var(--admin-line);border-bottom:0;border-radius:11px 11px 0 0;color:var(--admin-muted);font-size:7px;text-transform:uppercase;letter-spacing:.65px;font-weight:900}.order-row{background:#fff;border-bottom:1px solid #eef0f2}.order-row:last-child{border-bottom:0}.order-row[open]{margin:6px;border:1px solid #ccd2d9;border-radius:10px;box-shadow:0 7px 24px rgba(17,24,39,.06)}.order-row[open]+.order-row{border-top:1px solid #eef0f2}.order-summary{list-style:none;min-height:65px;padding:10px 12px;cursor:pointer}.order-summary::-webkit-details-marker{display:none}.order-summary:hover{background:#fafbfc}.order-row[open]>.order-summary{background:#f8fafb;border-radius:10px 10px 0 0}.order-customer,.order-id{min-width:0}.order-customer b,.order-id b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:10px}.order-customer small,.order-id small{display:block;margin-top:3px;color:var(--admin-muted);font-size:7px}.order-cell small{display:none}.order-cell b{display:block;font-size:9px}.chev{font-size:18px;color:#999;transition:.18s}.order-row[open] .chev{transform:rotate(90deg)}.order-body{padding:0 13px 13px;border-top:1px solid #eef0f2}.order-body>.head{display:none!important}.order-expanded-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin:12px 0 8px}.order-expanded-head b{font-size:11px}.order-expanded-head span{display:block;margin-top:3px;color:var(--admin-muted);font-size:8px}.facts{display:grid!important;grid-template-columns:2fr 1fr 1fr!important;gap:6px!important;margin:8px 0!important}.facts>div{padding:8px!important;background:#f7f8fa!important;border-radius:7px!important}.facts span,.tech span{display:block!important;color:var(--admin-muted)!important;font-size:6px!important;text-transform:uppercase!important;font-weight:900!important}.facts b{display:block;margin-top:4px!important;font-size:8px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.email{padding:8px!important;margin:7px 0!important;border-radius:7px!important;font-size:8px!important}.drawer{margin-top:6px!important;border-top:1px solid #eef0f2!important}.drawer summary{display:flex!important;justify-content:space-between!important;align-items:center!important;min-height:36px!important;list-style:none!important;cursor:pointer!important;color:#5b6068!important;font-size:7px!important;text-transform:uppercase!important;font-weight:900!important}.drawer summary::-webkit-details-marker{display:none}.item-row{display:grid!important;grid-template-columns:1fr 1fr auto!important;gap:8px!important;align-items:center!important;padding:8px 0!important;border-bottom:1px solid #eef0f2!important}.item-row b{font-size:9px!important}.item-row span,.item-row small{font-size:7px!important}.tech{display:grid!important;grid-template-columns:repeat(3,1fr)!important;gap:6px!important}.tech>div{padding:7px!important;background:#f7f8fa!important;border-radius:7px!important}.tech code{font-size:7px!important;overflow-wrap:anywhere}.nfc{padding:13px!important;margin-bottom:11px!important}.nfc code{display:block;margin-top:7px;padding:8px;background:#f7f8fa;border-radius:7px;font-size:8px;word-break:break-all}
    body[data-admin-page="account"] .admin-content>.panel,body[data-admin-page="users"][data-subpage="edit"] .admin-content>.panel,body[data-admin-page="users"][data-subpage="password"] .admin-content>.panel,body[data-admin-page="walls"][data-subpage="detail"] .admin-content>.panel{max-width:620px;margin-left:0!important}.danger-zone{border-color:#f1d4d0!important;background:#fffafa!important}
    .modal{position:fixed;inset:0;z-index:120;display:none;place-items:center;padding:16px}.modal.open{display:grid}.modal:before{content:"";position:absolute;inset:0;background:rgba(15,17,20,.55);backdrop-filter:blur(4px)}.modal-card{position:relative;width:min(620px,100%);max-height:88vh;overflow:auto;padding:20px;background:#fff;border-radius:13px;box-shadow:0 24px 70px rgba(0,0,0,.22)}.modal-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:12px}.modal-head h2{margin:0!important;font-size:18px!important}.modal-head p{margin:4px 0 0;color:var(--admin-muted);font-size:9px}.modal-close{width:32px;height:32px;border:1px solid var(--admin-line);border-radius:8px;background:#fff;font-size:18px;cursor:pointer}.modal-card .panel{padding:0!important;margin:0!important;border:0!important}.modal-card .panel>h2:first-child{display:none!important}
    .login-shell{width:min(420px,calc(100% - 28px))!important;margin:7vh auto!important;padding:0!important}.login-title{text-align:left!important}.login-title .plaque-logo{width:60px!important;height:60px!important;margin:0 0 10px!important}.login-title h1{font-size:24px!important}.login-title p{font-size:10px!important}
    @media(max-width:1000px){.wall-list-head,.wall-row{grid-template-columns:minmax(210px,1.8fr) 70px 70px 92px 130px}.order-list-head,.order-summary{grid-template-columns:minmax(190px,1.5fr) 125px 90px 145px 95px 20px}}
    @media(max-width:900px){.admin-app{display:block}.admin-side{position:fixed;left:0;top:0;width:232px;transform:translateX(-103%);transition:.2s}.nav-open .admin-side{transform:none}.overlay{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.35)}.nav-open .overlay{display:block}.admin-main{padding:0 16px 40px}.admin-head{margin:0 -16px 18px;padding:0 16px;min-height:68px}.menu{display:block}.order-sticky{top:68px}}
    @media(max-width:720px){.grid{grid-template-columns:1fr!important}.kpis,.stats{grid-template-columns:repeat(2,1fr)!important}.wall-list-head,.order-list-head{display:none}.wall-list{border:0;background:transparent}.wall-row{grid-template-columns:minmax(0,1fr) auto;gap:9px;margin-bottom:8px;border:1px solid var(--admin-line)!important;border-radius:10px;background:#fff}.wall-row>.wall-number{display:none}.wall-row>.badge{grid-column:2;grid-row:1}.wall-actions{grid-column:1/-1;justify-content:flex-start;padding-top:8px;border-top:1px solid #eef0f2}.order-list-head+.orders{border-radius:11px}.order-summary{grid-template-columns:minmax(0,1fr) 82px 20px}.order-summary>.order-id,.order-summary>.order-cell:nth-of-type(2),.order-summary>.order-cell:nth-of-type(3){display:none}.order-row{border-bottom:1px solid #eef0f2}.facts{grid-template-columns:1fr 1fr!important}.facts>div:first-child{grid-column:1/-1}.item-row{grid-template-columns:1fr!important}.tech{grid-template-columns:1fr!important}.table{min-width:680px}.search{display:grid!important;grid-template-columns:1fr auto}.audit-top{display:block}.audit-top time{display:block;margin-top:4px}.toolbar{align-items:flex-start}.toolbar>.button{flex:0 0 auto}}
  `;

  const style = document.createElement('style');
  style.id = 'saidhere-admin-ui';
  style.textContent = css;
  document.head.appendChild(style);
  document.body.dataset.adminPage = page;
  document.title = `SaidHere Admin — ${pageMeta[page][0]}`;

  if ($('.login-shell') && !$('.shell')) {
    const heading = $('.login-title h1');
    const sub = $('.login-title p');
    if (heading) heading.textContent = 'SaidHere Admin';
    if (sub) sub.textContent = 'Manage Walls, orders and moderation.';
    document.documentElement.classList.remove('admin-preload');
    return;
  }

  const shell = $('.shell');
  if (!shell) {
    document.documentElement.classList.remove('admin-preload');
    return;
  }

  const accountText = $('.account>span') || $('.top>div:last-child>span');
  const parts = text(accountText).split('·').map((item) => item.trim());
  const owner = /main admin/i.test(parts[1] || '') || path.startsWith('/admin/orders');
  const logout = $('.account form[action="/admin/logout"]') || $('.top form[action="/admin/logout"]');
  const oldNav = $('nav:not(.tabs)', shell) || $('.nav', shell);
  const oldHead = $('.topbar', shell) || $('.top', shell);
  const nodes = [...shell.children].filter((node) => node !== oldNav && node !== oldHead);

  const app = document.createElement('div');
  app.className = 'admin-app';
  const side = document.createElement('aside');
  side.className = 'admin-side';
  side.innerHTML = '<div class="admin-brand"><img src="/admin/plaque.png" alt="SaidHere"><div><b>SaidHere</b><small>Admin</small></div></div>';
  const nav = document.createElement('nav');
  nav.className = 'admin-nav';

  const addGroup = (label, items) => {
    if (!items.length) return;
    const title = document.createElement('div');
    title.className = 'nav-label';
    title.textContent = label;
    nav.append(title);
    items.forEach(([href, name, active]) => {
      const link = document.createElement('a');
      link.href = href;
      link.textContent = name;
      if (active) link.className = 'active';
      nav.append(link);
    });
  };

  addGroup('Manage', [
    ['/admin/walls', 'Walls', page === 'walls'],
    ...(owner ? [['/admin/orders', 'Orders', page === 'orders']] : []),
    ['/admin/reports', 'Moderation', page === 'moderation'],
  ]);
  if (owner) addGroup('Administration', [
    ['/admin/users', 'Users', page === 'users'],
    ['/admin/audit', 'Activity', page === 'activity'],
  ]);
  addGroup('Your account', [['/admin/account/password', 'Account', page === 'account']]);
  side.append(nav);

  const profile = document.createElement('div');
  profile.className = 'admin-profile';
  profile.innerHTML = `<b>${esc(parts[0] || 'Admin')}</b><small>${esc(parts[1] || 'Admin')}</small>`;
  if (logout) {
    const button = $('button', logout);
    if (button) button.textContent = 'Log out';
    profile.append(logout);
  }
  side.append(profile);

  const main = document.createElement('main');
  main.className = 'admin-main';
  const head = document.createElement('header');
  head.className = 'admin-head';
  const [title, subtitle] = pageMeta[page];
  head.innerHTML = `<button class="menu" type="button" aria-label="Open menu">☰</button><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>`;
  const content = document.createElement('div');
  content.className = 'admin-content';
  nodes.forEach((node) => content.append(node));
  main.append(head, content);
  const overlay = document.createElement('button');
  overlay.className = 'overlay';
  overlay.type = 'button';
  overlay.setAttribute('aria-label', 'Close menu');
  app.append(side, main, overlay);
  shell.replaceWith(app);

  $('.menu', head).addEventListener('click', () => document.body.classList.toggle('nav-open'));
  overlay.addEventListener('click', () => document.body.classList.remove('nav-open'));
  $$('.admin-nav a', side).forEach((link) => link.addEventListener('click', () => document.body.classList.remove('nav-open')));

  const makeModal = (titleText, subtitleText = '') => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    const card = document.createElement('div');
    card.className = 'modal-card';
    card.innerHTML = `<div class="modal-head"><div><h2>${esc(titleText)}</h2>${subtitleText ? `<p>${esc(subtitleText)}</p>` : ''}</div><button class="modal-close" type="button" aria-label="Close">×</button></div>`;
    const body = document.createElement('div');
    card.append(body);
    modal.append(card);
    document.body.append(modal);
    const close = () => {
      modal.classList.remove('open');
      document.body.classList.remove('modal-open');
    };
    const open = () => {
      modal.classList.add('open');
      document.body.classList.add('modal-open');
    };
    $('.modal-close', modal).addEventListener('click', close);
    modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && modal.classList.contains('open')) close(); });
    return { modal, body, open, close };
  };

  const modalizeExisting = (panel, titleText, buttonText, subtitleText = '') => {
    if (!panel) return null;
    $('h2', panel)?.remove();
    const modal = makeModal(titleText, subtitleText);
    while (panel.firstChild) modal.body.append(panel.firstChild);
    panel.remove();
    return { ...modal, label: buttonText };
  };

  const toolbar = (heading, subheading, modal) => {
    const bar = document.createElement('div');
    bar.className = 'toolbar';
    bar.innerHTML = `<div><b>${esc(heading)}</b><span>${esc(subheading)}</span></div>`;
    if (modal) {
      const button = document.createElement('button');
      button.className = 'button';
      button.type = 'button';
      button.textContent = modal.label;
      button.addEventListener('click', modal.open);
      bar.append(button);
    }
    content.prepend(bar);
    return bar;
  };

  const bindRemoteModalLinks = (selector, titleForLink) => {
    $$(selector, content).forEach((link) => {
      link.addEventListener('click', async (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        const modal = makeModal(titleForLink(link), 'Changes save normally and return you to this section.');
        modal.body.innerHTML = '<p class="help">Loading…</p>';
        modal.open();
        try {
          const response = await fetch(link.href, { credentials: 'same-origin' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const html = await response.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const panel = $('.panel', doc);
          if (!panel) throw new Error('Form not found');
          panel.querySelector('.back')?.remove();
          const heading = panel.querySelector('h2');
          if (heading) heading.remove();
          modal.body.replaceChildren(...[...panel.childNodes].map((node) => document.importNode(node, true)));
        } catch (_) {
          location.href = link.href;
        }
      });
    });
  };

  const closeOtherMenus = () => {
    document.addEventListener('click', (event) => {
      $$('.more-menu[open]').forEach((menu) => {
        if (!menu.contains(event.target)) menu.removeAttribute('open');
      });
    });
  };

  if (page === 'walls') {
    if (path !== '/admin' && path !== '/admin/walls') document.body.dataset.subpage = 'detail';
    if (path === '/admin' || path === '/admin/walls') {
      const createPanel = $$('.panel', content).find((panel) => text($('h2', panel)) === 'Create a Wall');
      const createModal = owner ? modalizeExisting(createPanel, 'New Wall', 'New Wall', 'Create the place, then program the one-time NFC URL onto the physical plaque.') : null;
      const wallSection = $$('section', content).find((section) => /^Walls\b/i.test(text($('h2', section))));
      if (wallSection) $('h2', wallSection)?.remove();
      toolbar('Wall inventory', 'All physical Walls and their current status.', createModal);

      const cards = $$('.wall-card', content);
      if (cards.length) {
        const counts = { walls: cards.length, active: 0, messages: 0, visitors: 0 };
        cards.forEach((card) => {
          if (!card.classList.contains('inactive')) counts.active += 1;
          const metrics = $$('.metric strong', card);
          counts.messages += Number(text(metrics[0]).replace(/[^0-9.-]/g, '')) || 0;
          counts.visitors += Number(text(metrics[1]).replace(/[^0-9.-]/g, '')) || 0;
        });
        const kpis = document.createElement('div');
        kpis.className = 'kpis';
        [['Walls', counts.walls], ['Active', counts.active], ['Messages', counts.messages], ['Visitors', counts.visitors]].forEach(([label, value]) => {
          kpis.insertAdjacentHTML('beforeend', `<div class="kpi"><b>${value}</b><span>${label}</span></div>`);
        });
        $('.toolbar', content)?.after(kpis);

        const list = document.createElement('div');
        list.className = 'wall-list';
        list.innerHTML = '<div class="wall-list-head"><span>Wall</span><span>Messages</span><span>Visitors</span><span>Status</span><span></span></div>';
        cards.forEach((card) => {
          const name = text($('h3', card));
          const locationText = text($('.location', card));
          const status = $('.badge', card)?.cloneNode(true);
          const metrics = $$('.metric', card);
          const messages = text($('strong', metrics[0])) || '0';
          const visitors = text($('strong', metrics[1])) || '0';
          const created = text($('strong', metrics[2]));
          const publicId = text($('.code', card)).replace(/^Public ID:\s*/i, '');
          const actions = $('.actions', card);
          const row = document.createElement('div');
          row.className = 'wall-row';
          const primary = actions ? $('a[href*="/edit"]', actions) : null;
          if (primary) {
            primary.textContent = 'Manage';
            primary.className = 'button secondary';
          }
          const actionWrap = document.createElement('div');
          actionWrap.className = 'wall-actions';
          if (primary) actionWrap.append(primary);
          if (actions) {
            const remainder = [...actions.children].filter((node) => node !== primary);
            if (remainder.length) {
              const more = document.createElement('details');
              more.className = 'more-menu';
              more.innerHTML = '<summary aria-label="More actions">•••</summary><div class="more-pop"></div>';
              const pop = $('.more-pop', more);
              remainder.forEach((node) => pop.append(node));
              actionWrap.append(more);
            }
          }
          row.innerHTML = `<div class="wall-main"><b>${esc(name)}</b><span>${esc(locationText)}</span><div class="wall-sub">Created ${esc(created)} · ID ${esc(publicId)}</div></div><div class="wall-number">${esc(messages)}</div><div class="wall-number">${esc(visitors)}</div><div class="wall-status"></div>`;
          $('.wall-status', row).append(status || document.createTextNode('—'));
          row.append(actionWrap);
          list.append(row);
          card.remove();
        });
        const oldGrid = $('.wall-grid', content);
        if (oldGrid) oldGrid.replaceWith(list);
        else wallSection?.append(list);
        closeOtherMenus();
        bindRemoteModalLinks('.wall-actions a[href*="/edit"]', () => 'Edit Wall');
      }
    }
  }

  if (page === 'users') {
    if (/\/edit$/.test(path)) document.body.dataset.subpage = 'edit';
    if (/\/password$/.test(path)) document.body.dataset.subpage = 'password';
    if (path === '/admin/users') {
      const addPanel = $$('.panel', content).find((panel) => text($('h2', panel)) === 'Add admin user');
      const addModal = modalizeExisting(addPanel, 'Add Moderator', 'Add Moderator', 'Moderators are limited to their assigned Wall and moderation queue.');
      toolbar('Administrator access', 'Main Admins and Moderators, with their assigned Wall.', addModal);
      const usersPanel = $$('.panel', content).find((panel) => /Admin users/i.test(text($('h2', panel))));
      if (usersPanel) {
        usersPanel.classList.add('users-panel');
        $('h2', usersPanel)?.remove();
        const table = $('.table', usersPanel);
        if (table) {
          $$('tbody tr', table).forEach((row) => {
            const cells = $$('td', row);
            const first = cells[0];
            if (!first) return;
            const display = text($('strong', first));
            const codes = $$('.code', first);
            const username = text(codes[0]);
            const assignment = text(codes[1]).replace(/^Wall:\s*/i, '');
            first.innerHTML = `<div class="user-primary"><strong>${esc(display)}</strong><span class="handle">${esc(username)}</span><span class="assignment">${esc(assignment)}</span></div>`;
            if (/Temporary password/i.test(text(cells[2]))) {
              const badge = $('.badge', cells[2]);
              cells[2].innerHTML = '';
              if (badge) cells[2].append(badge);
              cells[2].insertAdjacentHTML('beforeend', '<span class="temp-password">Password change required</span>');
            }
            if (cells[4]) cells[4].classList.add('user-actions');
          });
        }
      }
      bindRemoteModalLinks('.user-actions a[href$="/edit"]', (link) => `Edit ${text(link.closest('tr')?.querySelector('.user-primary strong')) || 'user'}`);
      bindRemoteModalLinks('.user-actions a[href$="/password"]', (link) => `Reset password — ${text(link.closest('tr')?.querySelector('.user-primary strong')) || 'user'}`);
    }
  }

  if (page === 'moderation') {
    const intro = $$('.panel', content).find((panel) => /Reported posts/i.test(text($('h2', panel))));
    if (intro) intro.classList.add('report-intro');
  }

  if (page === 'activity') {
    const panel = $('.panel', content);
    const table = $('.table', panel);
    if (panel && table) {
      panel.classList.add('activity-panel');
      const intro = document.createElement('div');
      intro.className = 'activity-intro';
      intro.innerHTML = '<b>Administrator activity</b><span>Human-readable actions are shown below. Technical details are available only when needed.</span>';
      content.insertBefore(intro, panel);
      const timeline = document.createElement('div');
      timeline.className = 'audit-timeline';
      const actionNames = {
        'auth.login': 'Signed in', 'auth.logout': 'Signed out',
        'wall.create': 'Created a Wall', 'wall.edit': 'Updated a Wall', 'wall.activate': 'Activated a Wall', 'wall.deactivate': 'Deactivated a Wall', 'wall.delete': 'Deleted a Wall', 'wall.clear_messages': 'Cleared Wall messages', 'wall.replace_nfc': 'Replaced a Wall NFC',
        'report.remove_post': 'Removed a reported post', 'report.keep_post': 'Kept a reported post',
        'admin.create': 'Created a Moderator', 'admin.edit': 'Updated an administrator', 'admin.reset_password': 'Reset an administrator password',
        'order.nfc_assigned': 'Assigned NFC to an order item', 'order.nfc_replaced': 'Replaced an order NFC', 'order.wall_shipped': 'Marked a Wall shipped', 'order.customer_email_resent': 'Resent customer confirmation', 'order.owner_email_resent': 'Resent owner notification', 'order.reconciled': 'Rechecked Stripe payment',
      };
      const prettyAction = (raw) => actionNames[raw] || raw.split(/[._-]+/).filter(Boolean).map((word) => word[0]?.toUpperCase() + word.slice(1)).join(' ');
      $$('tbody tr', table).forEach((row) => {
        const cells = $$('td', row);
        if (cells.length < 5) return;
        const when = text(cells[0]);
        const username = text(cells[1]);
        const rawAction = text(cells[2]);
        const wall = text(cells[3]);
        const rawDetails = text(cells[4]);
        let details = rawDetails;
        try { details = JSON.stringify(JSON.parse(rawDetails), null, 2); } catch (_) {}
        const kind = rawAction.split('.')[0] || 'other';
        const item = document.createElement('div');
        item.className = 'audit-item';
        item.innerHTML = `<span class="audit-dot ${esc(kind)}"></span><div class="audit-main"><div class="audit-top"><strong>${esc(prettyAction(rawAction))}</strong><time>${esc(when)}</time></div><div class="audit-sub"><span>${esc(username)}</span>${wall && wall !== '—' ? `<span>·</span><span>${esc(wall)}</span>` : ''}</div>${rawDetails && rawDetails !== '{}' ? `<details class="audit-details-toggle"><summary>Technical details</summary><pre>${esc(details)}</pre></details>` : ''}</div>`;
        timeline.append(item);
      });
      panel.after(timeline);
    }
  }

  if (page === 'orders') {
    const smtp = $('.smtp', content);
    const stats = $('.stats', content);
    if (smtp && stats) stats.before(smtp);
    $$('.drawer[open]', content).forEach((drawer) => drawer.removeAttribute('open'));

    const search = $('.search', content);
    const tabs = $('.tabs', content);
    if (search || tabs) {
      const sticky = document.createElement('div');
      sticky.className = 'order-sticky';
      if (search) sticky.append(search);
      if (tabs) sticky.append(tabs);
      const orders = $('.orders', content);
      if (orders) orders.before(sticky);
      else content.append(sticky);
    }

    const cards = $$('.order-card', content);
    if (cards.length) {
      const ordersContainer = $('.orders', content);
      const header = document.createElement('div');
      header.className = 'order-list-head';
      header.innerHTML = '<span>Customer</span><span>Order</span><span>Status</span><span>Fulfilment</span><span>Total</span><span></span>';
      if (ordersContainer) ordersContainer.before(header);

      cards.forEach((card) => {
        const oldHead = $('.head', card);
        const email = text($('h3', oldHead));
        const metaText = text($('p', oldHead));
        const orderLabel = text($('.eyebrow', oldHead)).replace(/^Order\s*/i, '') || '—';
        const status = $('.pill', oldHead)?.cloneNode(true);
        const facts = $$('.facts>div', card);
        const progress = text($('b', facts[2])) || '—';
        const metaParts = metaText.split('·').map((part) => part.trim()).filter(Boolean);
        const date = metaParts[0] || '—';
        const qty = metaParts[1] || 'Order';
        const total = metaParts[2] || '—';

        const detail = document.createElement('details');
        detail.className = 'order-row';
        const summary = document.createElement('summary');
        summary.className = 'order-summary';
        summary.innerHTML = `<div class="order-customer"><b>${esc(email)}</b><small>${esc(date)}</small></div><div class="order-id"><b>${esc(orderLabel)}</b><small>${esc(qty)}</small></div><div class="order-cell order-status"></div><div class="order-cell"><small>Fulfilment</small><b>${esc(progress)}</b></div><div class="order-cell"><small>Total</small><b>${esc(total)}</b></div><div class="chev">›</div>`;
        $('.order-status', summary).append(status || document.createTextNode('—'));

        const body = document.createElement('div');
        body.className = 'order-body';
        body.innerHTML = `<div class="order-expanded-head"><div><b>Order details</b><span>${esc(email)} · ${esc(orderLabel)}</span></div><span>${esc(date)}</span></div>`;
        while (card.firstChild) body.append(card.firstChild);
        const firstDrawer = $('.drawer', body);
        if (firstDrawer) {
          const sum = $('summary', firstDrawer);
          if (sum) {
            const count = text($('span', sum));
            sum.innerHTML = `Order items <span>${esc(count)}</span>`;
          }
        }
        detail.append(summary, body);
        card.replaceWith(detail);
      });
    }
  }

  if (page === 'account') {
    $$('.back', content).forEach((node) => node.remove());
    const panel = $('.panel', content);
    if (panel) {
      const heading = $('h2', panel);
      if (heading && /password/i.test(text(heading))) heading.textContent = 'Change password';
    }
  }

  if (page === 'users' && path !== '/admin/users') $$('.back', content).forEach((node) => node.remove());
  if (page === 'walls' && path !== '/admin/walls' && path !== '/admin') $$('.back', content).forEach((node) => node.remove());

  requestAnimationFrame(() => document.documentElement.classList.remove('admin-preload'));
})();
