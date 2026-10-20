import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const plaquePath = path.resolve(here, '../../lib/267ABF9F-A613-4DD2-B026-87B6C2B6AEBD.png');
const wallBackgroundPath = path.resolve(here, '../../lib/12CA723C-705E-4593-834A-72D72424FC4F.png');
const adminUiPath = path.resolve(here, 'admin_ui.js');

const polishCss = String.raw`
<style id="the-wall-admin-polish">
:root{
  --tw-ink:#171512;
  --tw-ink-2:#26221e;
  --tw-paper:#fbf8f1;
  --tw-paper-2:#f3eee4;
  --tw-bg:#ece6dc;
  --tw-line:#ddd4c5;
  --tw-muted:#746c61;
  --tw-red:#9b4137;
  --tw-green:#52714d;
  --tw-gold:#b98222;
  --tw-shadow:0 12px 34px rgba(37,31,25,.08);
}
*{box-sizing:border-box}
html{background:var(--tw-bg)}
body{
  min-height:100vh;
  color:var(--tw-ink);
  background:
    linear-gradient(rgba(244,240,232,.95),rgba(244,240,232,.95)),
    url('/admin/wall-background.png') center/cover fixed;
}
.shell{max-width:1120px;margin:0 auto;padding:18px 22px 56px}
.topbar{
  position:sticky;top:0;z-index:40;
  display:flex;align-items:center;justify-content:space-between;gap:18px;
  margin:0 0 10px;padding:13px 16px;
  background:rgba(23,21,18,.98);color:#f6efe4;
  border:1px solid rgba(255,255,255,.06);border-radius:14px;
  box-shadow:0 8px 30px rgba(26,22,18,.13);
}
.brand{display:flex;align-items:center;gap:11px;min-width:0}
.brand .mark,.login-title .mark{display:none!important}
.plaque-logo{display:block;object-fit:contain}
.brand .plaque-logo{width:46px;height:46px;flex:0 0 46px;filter:drop-shadow(0 3px 8px rgba(0,0,0,.35))}
.brand h1{margin:0;font-size:20px;line-height:1;font-weight:950;letter-spacing:-.45px}
.brand small{display:block;margin-top:4px;font-size:10px;line-height:1;text-transform:uppercase;letter-spacing:1.5px;color:#bfb6aa;font-weight:850}
.account{display:flex;align-items:center;gap:10px;color:#f6efe4}
.account-chip{display:flex!important;flex-direction:column;gap:2px;min-width:112px;padding:7px 10px!important;border:1px solid rgba(255,255,255,.12)!important;background:rgba(255,255,255,.06)!important;border-radius:9px}
.account-chip strong{font-size:11px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px}
.account-chip small{font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#bfb6aa}
.link-button{border:0;background:transparent!important;color:#ddd5c9!important;font-size:10px!important;font-weight:900;text-transform:uppercase;letter-spacing:.6px;text-decoration:none!important;cursor:pointer;padding:8px!important}
.link-button:hover{color:#fff!important}
nav{
  position:sticky;top:84px;z-index:35;
  display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;
  margin:0 0 22px;padding:6px;
  background:rgba(251,248,241,.92);border:1px solid var(--tw-line);border-radius:12px;
  box-shadow:0 5px 20px rgba(38,31,24,.06);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)
}
nav::-webkit-scrollbar{display:none}
nav a{
  flex:0 0 auto;display:flex;align-items:center;justify-content:center;min-height:38px;
  padding:9px 14px;border:0!important;border-radius:8px!important;background:transparent!important;
  color:var(--tw-muted)!important;text-decoration:none;font-size:11px!important;font-weight:900!important;letter-spacing:.45px;text-transform:uppercase
}
nav a:hover,nav a.is-active{background:var(--tw-ink)!important;color:#fff!important}
.panel,.admin-panel{
  background:rgba(251,248,241,.97)!important;
  border:1px solid var(--tw-line)!important;border-left:1px solid var(--tw-line)!important;border-radius:14px!important;
  box-shadow:var(--tw-shadow)!important;padding:22px!important;margin-bottom:16px!important
}
.panel h2,.panel h3{margin-top:0;color:var(--tw-ink)}
.panel h2{font-size:24px!important;letter-spacing:-.6px;margin-bottom:8px!important}
.panel h3{font-size:17px!important}
.help{color:var(--tw-muted)!important;font-size:13px!important;line-height:1.5!important}
.eyebrow{display:block;font-size:9px;line-height:1;text-transform:uppercase;letter-spacing:1.6px;color:var(--tw-muted);font-weight:950;margin-bottom:6px}
.field{gap:6px!important}
.field label{font-size:10px!important;letter-spacing:1.05px!important;color:#5c554c!important;font-weight:950!important}
.field input,.field select,.admin-control{
  width:100%;min-height:48px!important;padding:11px 13px!important;border:1px solid #c9bead!important;border-radius:9px!important;
  background:#fffdf8!important;color:var(--tw-ink)!important;font-size:15px!important;outline:none!important;box-shadow:none!important
}
.field input:focus,.field select:focus,.admin-control:focus{border-color:var(--tw-ink)!important;box-shadow:0 0 0 3px rgba(23,21,18,.08)!important}
.button,button.button{
  min-height:42px;padding:10px 15px;border:1px solid var(--tw-ink)!important;border-radius:9px!important;
  background:var(--tw-ink)!important;color:#fff!important;font-size:10px!important;font-weight:950!important;letter-spacing:.75px!important;text-transform:uppercase!important;
  box-shadow:none!important;text-decoration:none!important;cursor:pointer
}
.button:hover,button.button:hover{background:#2c2824!important}
.button.secondary{background:#fffdf8!important;color:var(--tw-ink)!important;border-color:#c8bdad!important}
.button.warn{background:var(--tw-red)!important;border-color:var(--tw-red)!important;color:#fff!important}
.button.good{background:var(--tw-green)!important;border-color:var(--tw-green)!important;color:#fff!important}
.notice,.error,.warning{border-radius:10px!important;padding:12px 14px!important;font-size:12px!important;line-height:1.45!important;font-weight:800!important;margin-bottom:14px!important}
.notice{background:#e3eee0!important;border-left:4px solid var(--tw-green)!important}
.error{background:#f2dfdb!important;border-left:4px solid var(--tw-red)!important}
.warning{background:#f5e7bf!important;border-left:4px solid var(--tw-gold)!important}
.back{display:inline-flex!important;align-items:center;gap:6px;margin:0 0 12px!important;padding:8px 10px;border-radius:8px;background:#fffaf2;color:var(--tw-muted)!important;text-decoration:none!important;font-size:10px!important;font-weight:900!important;text-transform:uppercase;letter-spacing:.55px}
.danger-zone{border-color:#dec8c4!important;background:#fff9f7!important}

.admin-overview{margin:4px 0 16px}
.overview-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:12px}
.overview-heading h2{margin:0;font-size:31px;letter-spacing:-1.1px;line-height:1}
.overview-new{min-width:130px}
.overview-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.overview-stat{padding:14px 15px;background:rgba(251,248,241,.96);border:1px solid var(--tw-line);border-radius:12px;box-shadow:0 5px 18px rgba(35,29,24,.045)}
.overview-stat strong{display:block;font-size:23px;line-height:1;font-weight:950;letter-spacing:-.7px}
.overview-stat span{display:block;margin-top:6px;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:var(--tw-muted);font-weight:900}
.admin-drawer{margin:0 0 18px;border:1px solid var(--tw-line);border-radius:12px;background:rgba(251,248,241,.9);overflow:hidden}
.admin-drawer>summary{list-style:none;display:flex;align-items:center;gap:10px;min-height:52px;padding:12px 15px;cursor:pointer;font-size:12px;text-transform:uppercase;letter-spacing:.55px;font-weight:950}
.admin-drawer>summary::-webkit-details-marker{display:none}
.summary-plus{display:grid;place-items:center;width:27px;height:27px;border-radius:8px;background:var(--tw-ink);color:#fff;font-size:20px;line-height:1;font-weight:500}
.summary-chevron{margin-left:auto;color:var(--tw-muted);font-size:16px;transition:transform .2s ease}
.admin-drawer[open] .summary-chevron{transform:rotate(180deg)}
.admin-drawer-body{padding:4px 18px 18px}
.admin-drawer-body>h2{font-size:22px!important;margin:8px 0!important}
.section-heading{display:flex!important;flex-direction:column;gap:0;margin:25px 0 10px!important;font-size:23px!important;letter-spacing:-.55px}

.wall-grid{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:12px!important}
.wall-card{position:relative;background:#fffdf9!important;border:1px solid var(--tw-line)!important;border-left:1px solid var(--tw-line)!important;border-radius:13px!important;padding:17px!important;box-shadow:0 6px 20px rgba(36,30,24,.05)!important}
.wall-card.inactive{opacity:.72!important}
.wall-card::before{content:"";position:absolute;top:0;left:0;bottom:0;width:4px;background:var(--tw-green);border-radius:13px 0 0 13px}
.wall-card.inactive::before{background:var(--tw-red)}
.wall-head{gap:10px!important}
.wall-card h3{font-size:19px!important;letter-spacing:-.35px!important;margin-bottom:4px!important}
.location{font-size:12px!important;color:var(--tw-muted)!important;font-weight:750!important}
.badge{padding:5px 7px!important;border-radius:999px!important;background:transparent!important;font-size:9px!important}
.meta{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:7px!important;margin:15px 0 11px!important}
.metric{border:0!important;padding:8px 9px!important;background:var(--tw-paper-2);border-radius:9px}
.metric strong{font-size:14px!important;line-height:1.2!important;overflow-wrap:anywhere}
.metric span{font-size:8px!important}
.code{font-size:10px!important;color:var(--tw-muted)!important}
.wall-primary-actions{display:flex;align-items:center;gap:8px;margin-top:14px}
.wall-manage{flex:1}
.more-menu{position:relative}
.more-menu>summary{list-style:none;min-height:42px;display:flex;align-items:center;justify-content:center;padding:10px 13px;border:1px solid #c8bdad;border-radius:9px;background:#fffdf8;cursor:pointer;font-size:10px;text-transform:uppercase;letter-spacing:.65px;font-weight:950}
.more-menu>summary::-webkit-details-marker{display:none}
.more-menu-popover{position:absolute;right:0;bottom:calc(100% + 7px);z-index:20;width:190px;padding:7px;background:#fff;border:1px solid var(--tw-line);border-radius:10px;box-shadow:0 16px 38px rgba(24,20,17,.16)}
.more-menu-popover>*{width:100%;margin:0 0 5px!important}
.more-menu-popover>*:last-child{margin-bottom:0!important}
.more-menu-popover form button,.more-menu-popover .button{width:100%!important;justify-content:flex-start!important;text-align:left!important;background:#fff!important;color:var(--tw-ink)!important;border-color:transparent!important}
.more-menu-popover .warn{color:var(--tw-red)!important}

.users-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 14px}
.users-toolbar .help{margin:0!important;max-width:620px}
.user-card-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.user-card{padding:16px;background:#fffdf9;border:1px solid var(--tw-line);border-radius:12px}
.user-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding-bottom:12px;border-bottom:1px solid #ebe3d7}
.user-card h3{margin:0 0 4px!important;font-size:17px!important}
.user-handle{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--tw-muted);font-size:11px}
.role-chip{padding:5px 7px;border-radius:999px;background:#ece7de}
.user-card-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}
.user-card-meta>div{padding:9px;background:var(--tw-paper-2);border-radius:8px;font-size:11px}
.meta-label{display:block;margin-bottom:5px;font-size:8px;text-transform:uppercase;letter-spacing:.7px;color:var(--tw-muted);font-weight:950}
.user-card-actions{display:flex;gap:7px;flex-wrap:wrap}
.user-card-actions .button{flex:1 1 42%}

.audit-timeline{position:relative;margin-top:12px}
.audit-timeline::before{content:"";position:absolute;top:8px;bottom:8px;left:7px;width:1px;background:#d7cbbb}
.audit-item{position:relative;display:grid;grid-template-columns:16px 1fr;gap:13px;padding:0 0 20px}
.audit-dot{position:relative;z-index:2;width:15px;height:15px;margin-top:4px;border:4px solid var(--tw-paper);border-radius:50%;background:var(--tw-ink);box-shadow:0 0 0 1px #cfc2b1}
.audit-main{padding:0 0 18px;border-bottom:1px solid #e2d9cc}
.audit-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.audit-top strong{font-size:14px}
.audit-top time{font-size:10px;color:var(--tw-muted);white-space:nowrap}
.audit-sub{display:flex;gap:5px;margin-top:4px;font-size:11px;color:var(--tw-muted)}
.audit-details-toggle{margin-top:8px}
.audit-details-toggle summary{cursor:pointer;font-size:9px;text-transform:uppercase;letter-spacing:.6px;font-weight:900;color:var(--tw-muted)}
.audit-details-toggle pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:7px 0 0;padding:8px;border-radius:7px;background:#f1ece4;font-size:9px}

.table-wrap{overflow:auto;border:1px solid var(--tw-line)!important;border-radius:10px!important;background:#fff!important}
.table{background:#fff!important}.table th{background:#f1eadf!important}.table th,.table td{padding:12px!important}
.nfc{min-height:48px!important;font-size:12px!important}

.login-shell{max-width:420px;margin:0 auto;padding:7vh 18px 40px}
.login-title{margin-bottom:18px;text-align:center}
.login-title .plaque-logo{width:112px;height:112px;margin:0 auto 13px;filter:drop-shadow(0 10px 24px rgba(0,0,0,.15))}
.login-title h1{font-size:29px!important;letter-spacing:-.7px;margin:0!important}
.login-title p{font-size:13px!important;color:var(--tw-muted)!important}
.login-shell .panel{padding:20px!important}

@media(max-width:760px){
  .shell{padding:10px 12px 34px!important}
  .topbar{margin:0 0 8px!important;padding:10px 11px!important;border-radius:11px!important;gap:8px!important}
  .brand{gap:8px!important}
  .brand .plaque-logo{width:40px;height:40px;flex-basis:40px}
  .brand h1{font-size:17px!important}
  .brand small{font-size:8px!important;letter-spacing:1.25px!important}
  .account{gap:4px!important}
  .account-chip{min-width:0!important;max-width:112px;padding:6px 7px!important}
  .account-chip strong{max-width:96px;font-size:9px!important}
  .account-chip small{font-size:7px!important}
  .link-button{font-size:8px!important;padding:6px!important}
  nav{top:69px!important;margin-bottom:16px!important;padding:5px!important;border-radius:10px!important}
  nav a{min-height:34px!important;padding:8px 11px!important;font-size:9px!important}
  .overview-heading{align-items:center}
  .overview-heading h2{font-size:27px!important}
  .overview-new{min-width:112px;padding:9px 11px!important}
  .overview-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .overview-stat{padding:12px}
  .overview-stat strong{font-size:21px}
  .panel,.admin-panel{padding:15px!important;border-radius:11px!important}
  .panel h2{font-size:21px!important}
  .grid,.wall-grid,.user-card-list{grid-template-columns:1fr!important}
  .wall-card{padding:15px!important}
  .metric strong{font-size:13px!important}
  .users-toolbar{align-items:flex-start;flex-direction:column}
  .users-toolbar .button{width:100%}
  .user-card-meta{grid-template-columns:1fr 1fr}
  .audit-top{flex-direction:column;gap:3px}
  .audit-top time{white-space:normal}
  .more-menu-popover{right:0;width:min(210px,75vw)}
  .field input,.field select,.admin-control{min-height:46px!important;font-size:14px!important}
  .actions{gap:7px!important}
  .actions .button,.actions button.button{flex:1 1 calc(50% - 7px)!important}
  .login-shell{padding:6vh 14px 30px!important}
  .login-title .plaque-logo{width:100px;height:100px}
}
@media(max-width:390px){
  .brand small{display:none!important}
  .account-chip small{display:none!important}
  .overview-stats{gap:7px}
  .overview-stat{padding:10px}
}
</style>`;

function injectBrand(html) {
  if (typeof html !== 'string' || !html.includes('</head>')) return html;
  let output = html.replaceAll(
    '<div class="mark">TW</div>',
    '<img class="plaque-logo" src="/admin/plaque.png" alt="The Wall plaque">',
  );
  output = output.replace('</head>', `${polishCss}<script src="/admin/ui.js" defer></script></head>`);
  return output;
}

export function mountAdminBrand(app) {
  app.get('/admin/plaque.png', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(plaquePath);
  });

  app.get('/admin/wall-background.png', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(wallBackgroundPath);
  });

  app.get('/admin/ui.js', (_req, res) => {
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(adminUiPath);
  });

  app.use('/admin', (_req, res, next) => {
    const originalSend = res.send.bind(res);
    res.send = (body) => originalSend(injectBrand(body));
    return next();
  });
}
