import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const plaquePath = path.resolve(here, '../../lib/267ABF9F-A613-4DD2-B026-87B6C2B6AEBD.png');
const wallBackgroundPath = path.resolve(here, '../../lib/12CA723C-705E-4593-834A-72D72424FC4F.png');

const polishCss = String.raw`
<style id="the-wall-admin-polish">
:root{
  --tw-black:#171411;
  --tw-black-soft:#2a2520;
  --tw-cream:#efe5d4;
  --tw-paper:#f7efe2;
  --tw-line:rgba(40,33,27,.22);
  --tw-muted:#766b5d;
  --tw-red:#913b31;
  --tw-green:#4d6848;
}
html{background:#c8baa2}
body{
  min-height:100vh;
  background:
    linear-gradient(rgba(211,199,178,.90),rgba(211,199,178,.90)),
    url('/admin/wall-background.png') center/cover fixed;
  color:var(--tw-black);
}
.shell{max-width:1120px;padding:18px 20px 48px}
.topbar{
  position:sticky;top:0;z-index:30;
  margin:0 -6px 12px;
  padding:12px 8px 10px;
  background:rgba(214,202,181,.91);
  border-bottom:1px solid rgba(40,33,27,.16);
  backdrop-filter:blur(14px);
  -webkit-backdrop-filter:blur(14px);
}
.brand{gap:11px;min-width:0}
.brand .mark,.login-title .mark{display:none!important}
.plaque-logo{display:block;object-fit:contain;filter:drop-shadow(0 2px 3px rgba(0,0,0,.18))}
.brand .plaque-logo{width:52px;height:52px;flex:0 0 52px}
.brand h1{font-size:20px;line-height:1.05;letter-spacing:-.35px;margin:0}
.brand small{font-size:11px;line-height:1.25;margin-top:3px;color:#62584d}
.account{gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;color:#4f473e}
.account>span{
  padding:7px 9px;background:rgba(247,239,226,.68);border:1px solid rgba(40,33,27,.15);
  font-size:11px;line-height:1.1;text-transform:capitalize
}
.link-button{font-size:11px;font-weight:900;text-underline-offset:3px}
nav{
  display:flex;flex-wrap:nowrap;gap:6px;overflow-x:auto;scrollbar-width:none;
  margin:0 0 18px;padding:2px 0 5px;-webkit-overflow-scrolling:touch
}
nav::-webkit-scrollbar{display:none}
nav a{
  flex:0 0 auto;min-height:38px;display:flex;align-items:center;padding:9px 13px;
  background:rgba(247,239,226,.82);border:1px solid rgba(40,33,27,.18);
  box-shadow:0 2px 7px rgba(35,28,20,.05);font-size:11px;letter-spacing:.35px;text-transform:uppercase
}
nav a:hover{background:var(--tw-black);color:var(--tw-cream)}
.panel{
  border:1px solid var(--tw-line);border-left:4px solid var(--tw-black);
  background:rgba(247,239,226,.94);box-shadow:0 8px 24px rgba(43,33,24,.10);
  padding:20px;margin-bottom:16px;border-radius:2px
}
.panel h2{font-size:22px;letter-spacing:-.4px;margin-bottom:8px}
.panel h3{font-size:17px}
.help{font-size:13px;line-height:1.45;margin-top:5px}
.field{gap:6px}
.field label{font-size:10px;letter-spacing:.9px;color:#51483e}
.field input,.field select{
  min-height:46px;border:1px solid #9d907c;background:rgba(255,251,243,.96);
  padding:11px 12px;border-radius:0;font-size:15px;outline:none
}
.field input:focus,.field select:focus{border-color:var(--tw-black);box-shadow:0 0 0 2px rgba(24,21,18,.10)}
.button,button.button{
  min-height:42px;padding:10px 15px;border-radius:0;font-size:11px;letter-spacing:.65px;text-transform:uppercase;
  box-shadow:none
}
.button.secondary{background:rgba(247,239,226,.62)}
.wall-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}
.wall-card{
  border:1px solid rgba(40,33,27,.17);border-left:5px solid var(--tw-black);
  background:rgba(247,239,226,.90);box-shadow:0 5px 16px rgba(35,28,20,.07);padding:17px
}
.wall-card h3{font-size:19px;letter-spacing:-.2px}
.location{font-size:13px}
.badge{padding:5px 7px;background:rgba(255,255,255,.30)}
.meta{margin:14px 0 12px}
.metric strong{font-size:16px}.metric span{font-size:9px}
.notice,.error,.warning{font-size:12px;line-height:1.4;border-radius:0;padding:11px 13px}
.warning{background:#f0ddb0}
.danger-zone{border-left-color:var(--tw-red)}
.back{font-size:12px;text-transform:uppercase;letter-spacing:.45px;margin-bottom:12px}
.table-wrap{border:1px solid rgba(40,33,27,.18);background:rgba(247,239,226,.75)}
.table{background:transparent}
.table th{position:sticky;top:0;background:#dfd1ba;z-index:2}
.table th,.table td{padding:12px}
.login-shell{max-width:440px;margin:0 auto;padding:8vh 18px 40px}
.login-title{margin-bottom:18px}
.login-title .plaque-logo{width:132px;height:132px;margin:0 auto 12px}
.login-title h1{font-size:28px;letter-spacing:-.6px}
.login-title p{font-size:13px;margin-top:7px}
.login-shell .panel{border-left:1px solid var(--tw-line);padding:20px}
.nfc{font-size:12px;min-height:48px}

@media(max-width:760px){
  .shell{padding:8px 13px 38px}
  .topbar{margin:0 -3px 10px;padding:9px 4px 9px;align-items:center;gap:8px}
  .brand{gap:8px;flex:1 1 auto}
  .brand .plaque-logo{width:42px;height:42px;flex-basis:42px}
  .brand h1{font-size:17px;white-space:nowrap}
  .brand small{font-size:9px;white-space:nowrap}
  .account{flex:0 1 42%;gap:4px;justify-content:flex-end}
  .account>span{font-size:9px;padding:5px 6px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .link-button{font-size:9px}
  nav{margin-bottom:12px;gap:5px}
  nav a{min-height:36px;padding:8px 11px;font-size:10px}
  .panel{padding:15px;margin-bottom:12px}
  .panel h2{font-size:19px}
  .grid,.wall-grid{grid-template-columns:1fr}
  .wall-card{padding:15px}
  .wall-head{gap:8px}
  .wall-card h3{font-size:18px}
  .meta{gap:6px}
  .metric strong{font-size:15px}
  .actions{gap:7px}
  .actions .button,.actions button.button{flex:1 1 calc(50% - 7px);min-height:40px;padding:9px 10px;font-size:10px}
  .table{min-width:650px}
  .table-wrap{margin-left:-2px;margin-right:-2px}
  .login-shell{padding:6vh 14px 30px}
  .login-title .plaque-logo{width:118px;height:118px}
  .login-title h1{font-size:25px}
  .login-shell .panel{padding:16px}
}
@media(max-width:390px){
  .brand small{display:none}
  .account>span{max-width:115px}
}
</style>`;

function injectBrand(html) {
  if (typeof html !== 'string' || !html.includes('</head>')) return html;
  let output = html.replaceAll(
    '<div class="mark">TW</div>',
    '<img class="plaque-logo" src="/admin/plaque.png" alt="The Wall plaque">',
  );
  output = output.replace('</head>', `${polishCss}</head>`);
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

  app.use('/admin', (_req, res, next) => {
    const originalSend = res.send.bind(res);
    res.send = (body) => originalSend(injectBrand(body));
    return next();
  });
}
