(() => {
  'use strict';

  const path = window.location.pathname;
  document.body.dataset.adminPage = path;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const text = (node) => (node?.textContent || '').trim();
  const numberFrom = (node) => {
    const match = text(node).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));

  function installStyles() {
    if ($('#admin-v2-styles')) return;
    const style = document.createElement('style');
    style.id = 'admin-v2-styles';
    style.textContent = `
      body.modal-open{overflow:hidden}
      .admin-modal{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;padding:18px}
      .admin-modal.is-open{display:flex}
      .admin-modal-backdrop{position:absolute;inset:0;background:rgba(14,12,10,.66);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)}
      .admin-modal-dialog{position:relative;z-index:1;width:min(560px,100%);max-height:min(88vh,760px);overflow:auto;background:var(--tw-paper);border:1px solid var(--tw-line);border-radius:16px;box-shadow:0 28px 80px rgba(17,14,11,.32)}
      .admin-modal-head{position:sticky;top:0;z-index:2;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:18px 20px 14px;background:rgba(251,248,241,.98);border-bottom:1px solid var(--tw-line)}
      .admin-modal-head h2{margin:0!important;font-size:22px!important;letter-spacing:-.5px!important}
      .admin-modal-head p{margin:5px 0 0;color:var(--tw-muted);font-size:12px;line-height:1.45}
      .admin-modal-close{flex:0 0 36px;width:36px;height:36px;border:1px solid var(--tw-line);border-radius:9px;background:#fffdf8;color:var(--tw-ink);font-size:22px;line-height:1;cursor:pointer}
      .admin-modal-body{padding:18px 20px 20px}
      .admin-modal-body>.help:first-child{margin-top:0!important}
      .admin-modal-body .grid{gap:12px!important}
      .admin-modal-body .actions{margin-top:14px!important}
      .admin-modal-body form>.grid+.actions,.admin-modal-body form>.actions{margin-top:14px}

      .admin-page-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin:4px 0 14px}
      .admin-page-heading h2{margin:0;font-size:31px;line-height:1;letter-spacing:-1px}
      .admin-page-heading .eyebrow{margin-bottom:6px}
      .admin-page-heading .button{min-width:128px}

      .wall-original-heading{display:none!important}
      .wall-inventory{margin-top:16px}
      .wall-inventory-kicker{display:block;margin:0 0 8px;font-size:9px;line-height:1;text-transform:uppercase;letter-spacing:1.6px;color:var(--tw-muted);font-weight:950}
      .wall-inventory-toolbar{display:grid;grid-template-columns:minmax(0,1fr) 150px auto;gap:8px;align-items:center;margin:0 0 9px}
      .wall-search,.user-search{min-height:40px!important;padding:9px 12px!important;font-size:13px!important}
      .wall-filter,.user-filter{min-height:40px!important;padding:8px 10px!important;font-size:12px!important}
      .wall-result-count,.user-result-count{font-size:10px;color:var(--tw-muted);font-weight:850;white-space:nowrap;text-align:right}
      .wall-grid.wall-list{display:flex!important;flex-direction:column!important;gap:5px!important}
      .wall-card.wall-row{padding:0!important;border-radius:9px!important;box-shadow:none!important;overflow:visible;background:#fffdf9!important;opacity:1!important}
      .wall-card.wall-row::before{width:3px!important;border-radius:9px 0 0 9px!important}
      .wall-row-inner{display:grid;grid-template-columns:minmax(180px,1fr) 72px 72px auto auto;align-items:center;gap:10px;min-height:58px;padding:8px 10px 8px 14px}
      .wall-row-identity{min-width:0}
      .wall-row-identity h3{margin:0 0 2px!important;font-size:15px!important;line-height:1.1!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .wall-row-identity .location{font-size:10px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .wall-row-metric{display:flex;flex-direction:column;align-items:flex-start;min-width:0}
      .wall-row-metric strong{font-size:13px;line-height:1;font-weight:950}
      .wall-row-metric span{margin-top:3px;font-size:7px;line-height:1;text-transform:uppercase;letter-spacing:.65px;color:var(--tw-muted);font-weight:900}
      .wall-row-status{justify-self:start}
      .wall-row-status .badge{font-size:8px!important;padding:4px 6px!important}
      .wall-row-actions{justify-self:end}
      .wall-row-actions .wall-primary-actions{display:flex;align-items:center;gap:4px;margin:0!important}
      .wall-row-actions .button{min-height:34px!important;padding:8px 10px!important;font-size:8px!important;border-radius:7px!important}
      .wall-row-actions .more-menu{position:relative}
      .wall-row-actions .more-menu>summary{list-style:none;display:flex;align-items:center;justify-content:center;min-height:34px!important;width:34px!important;padding:0!important;border:1px solid #c8bdad;border-radius:7px!important;background:#fffdf8;cursor:pointer;font-size:10px!important;letter-spacing:1px!important}
      .wall-row-actions .more-menu>summary::-webkit-details-marker{display:none}
      .wall-row-actions .more-menu-popover{position:absolute;top:calc(100% + 5px)!important;right:0!important;z-index:30;width:190px;padding:7px;background:#fff;border:1px solid var(--tw-line);border-radius:10px;box-shadow:0 16px 38px rgba(24,20,17,.16)}
      .wall-row-actions .more-menu-popover>*{width:100%;margin:0 0 5px!important}
      .wall-row-actions .more-menu-popover>*:last-child{margin-bottom:0!important}
      .wall-row-actions .more-menu-popover form button,.wall-row-actions .more-menu-popover .button{width:100%!important;justify-content:flex-start!important;text-align:left!important;background:#fff!important;color:var(--tw-ink)!important;border-color:transparent!important}
      .wall-list-head{display:grid;grid-template-columns:minmax(180px,1fr) 72px 72px auto auto;gap:10px;padding:0 10px 5px 14px;color:var(--tw-muted);font-size:7px;text-transform:uppercase;letter-spacing:.75px;font-weight:950}
      .list-empty{display:none;padding:20px;text-align:center;color:var(--tw-muted);font-size:12px;background:#fffdf9;border:1px solid var(--tw-line);border-radius:9px}
      .list-empty.is-visible{display:block}

      .users-panel{padding:0!important;overflow:hidden}
      .users-panel>.help{display:none!important}
      .users-panel>h2{display:none!important}
      .users-toolbar-v2{display:grid;grid-template-columns:minmax(0,1fr) 130px auto;gap:8px;align-items:center;padding:14px 14px 10px;border-bottom:1px solid var(--tw-line)}
      .user-list{display:flex;flex-direction:column}
      .user-row{display:grid;grid-template-columns:minmax(180px,1fr) 90px 118px 150px auto;align-items:center;gap:12px;min-height:66px;padding:10px 14px;border-bottom:1px solid #e8dfd2;background:#fffdf9}
      .user-row:last-child{border-bottom:0}
      .user-identity{min-width:0}
      .user-identity strong{display:block;font-size:14px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .user-handle{margin-top:3px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--tw-muted);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .user-role{justify-self:start;padding:5px 7px;border-radius:999px;background:#eee8de;font-size:8px;text-transform:uppercase;letter-spacing:.7px;font-weight:950}
      .user-status{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      .user-status .badge{font-size:8px!important;padding:4px 6px!important}
      .temp-badge{display:inline-flex;align-items:center;padding:4px 6px;border-radius:999px;background:#f5e7bf;color:#76530d;font-size:7px;line-height:1;text-transform:uppercase;letter-spacing:.55px;font-weight:950}
      .user-login{font-size:10px;color:var(--tw-muted)}
      .user-actions{display:flex;gap:5px;justify-self:end}
      .user-actions .button{min-height:34px!important;padding:8px 10px!important;font-size:8px!important;border-radius:7px!important;white-space:nowrap}
      .role-help{margin:10px 14px 14px;border-top:1px solid #e7ded1;padding-top:10px;color:var(--tw-muted);font-size:10px;line-height:1.45}
      .role-help summary{cursor:pointer;font-weight:900;text-transform:uppercase;letter-spacing:.55px;color:#5f574e}
      .role-help p{margin:8px 0 0}

      .audit-timeline{position:relative;margin-top:12px}
      .audit-timeline::before{content:"";position:absolute;top:8px;bottom:8px;left:7px;width:1px;background:#d7cbbb}
      .audit-item{position:relative;display:grid;grid-template-columns:16px 1fr;gap:13px;padding:0 0 20px}
      .audit-dot{position:relative;z-index:2;width:15px;height:15px;margin-top:4px;border:4px solid var(--tw-paper);border-radius:50%;background:var(--tw-ink);box-shadow:0 0 0 1px #cfc2b1}
      .audit-main{padding:0 0 18px;border-bottom:1px solid #e2d9cc}
      .audit-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
      .audit-top strong{font-size:14px}.audit-top time{font-size:10px;color:var(--tw-muted);white-space:nowrap}
      .audit-sub{display:flex;gap:5px;margin-top:4px;font-size:11px;color:var(--tw-muted)}
      .audit-details-toggle{margin-top:8px}.audit-details-toggle summary{cursor:pointer;font-size:9px;text-transform:uppercase;letter-spacing:.6px;font-weight:900;color:var(--tw-muted)}
      .audit-details-toggle pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:7px 0 0;padding:8px;border-radius:7px;background:#f1ece4;font-size:9px}

      @media(max-width:760px){
        .admin-modal{align-items:flex-end;padding:0}
        .admin-modal-dialog{width:100%;max-height:88vh;border-radius:18px 18px 0 0;border-bottom:0}
        .admin-modal-head{padding:16px 17px 13px}.admin-modal-body{padding:16px 17px 22px;padding-bottom:max(22px,env(safe-area-inset-bottom))}
        .admin-page-heading{align-items:center}.admin-page-heading h2{font-size:27px}.admin-page-heading .button{min-width:auto}
        .overview-stats{grid-template-columns:repeat(4,minmax(0,1fr))!important}
        .overview-stat{padding:8px 7px!important}.overview-stat strong{font-size:17px!important}.overview-stat span{font-size:7px!important;margin-top:4px!important}
        .wall-inventory-toolbar{grid-template-columns:minmax(0,1fr) 108px;gap:6px}
        .wall-result-count,.user-result-count{grid-column:1/-1;text-align:left;margin-top:-2px;font-size:9px}
        .wall-list-head{display:none}
        .wall-row-inner{grid-template-columns:minmax(0,1fr) 44px 44px auto;gap:7px;min-height:56px;padding:8px 8px 8px 12px}
        .wall-row-identity h3{font-size:14px!important}.wall-row-identity .location{font-size:9px!important}
        .wall-row-metric strong{font-size:12px}.wall-row-metric span{font-size:6px}.wall-row-status{display:none}
        .wall-row-actions .wall-manage{font-size:0!important;width:34px!important;padding:0!important}.wall-row-actions .wall-manage::after{content:'›';font-size:21px;line-height:1;font-weight:500}
        .wall-row-actions .more-menu>summary{width:30px!important;min-height:32px!important}
        .users-toolbar-v2{grid-template-columns:minmax(0,1fr) 104px;padding:11px 11px 8px}.user-result-count{grid-column:1/-1}
        .user-row{grid-template-columns:minmax(0,1fr) auto auto;gap:7px;min-height:60px;padding:9px 11px}
        .user-role{grid-column:2}.user-status{grid-column:1 / 3;grid-row:2}.user-login{display:none}.user-actions{grid-column:3;grid-row:1 / 3;align-self:center}
        .user-actions .button{font-size:0!important;width:34px!important;padding:0!important}.user-actions .button:first-child::after{content:'Edit';font-size:7px}.user-actions .button:last-child::after{content:'Reset';font-size:7px}
        .role-help{margin:8px 11px 12px}
      }
    `;
    document.head.appendChild(style);
  }

  function setActiveNav() {
    $$('nav a').forEach((link) => {
      const href = link.getAttribute('href') || '';
      const active = href === path || (href !== '/admin/walls' && path.startsWith(href));
      link.classList.toggle('is-active', active);
    });
  }

  function refineHeader() {
    const brandTitle = $('.brand h1');
    const brandSub = $('.brand small');
    if (brandTitle) brandTitle.textContent = 'The Wall';
    if (brandSub) brandSub.textContent = 'Admin console';
    const chip = $('.account > span');
    if (chip) {
      const parts = text(chip).split('·').map((part) => part.trim());
      chip.innerHTML = `<strong>${escapeHtml(parts[0] || 'Admin')}</strong><small>${escapeHtml(parts[1] || '')}</small>`;
      chip.classList.add('account-chip');
    }
  }

  function improveForms() {
    $$('input, select').forEach((field) => field.classList.add('admin-control'));
    $$('.panel').forEach((panel) => panel.classList.add('admin-panel'));
  }

  function createModalFromPanel(panel, { title, description = '' } = {}) {
    if (!panel) return null;
    const existingHeading = $('h2', panel);
    if (existingHeading) existingHeading.remove();

    const modal = document.createElement('div');
    modal.className = 'admin-modal';
    modal.setAttribute('aria-hidden', 'true');
    const backdrop = document.createElement('div');
    backdrop.className = 'admin-modal-backdrop';
    const dialog = document.createElement('section');
    dialog.className = 'admin-modal-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const head = document.createElement('div');
    head.className = 'admin-modal-head';
    const titleWrap = document.createElement('div');
    titleWrap.innerHTML = `<h2>${escapeHtml(title)}</h2>${description ? `<p>${escapeHtml(description)}</p>` : ''}`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'admin-modal-close';
    close.setAttribute('aria-label', `Close ${title}`);
    close.textContent = '×';
    head.append(titleWrap, close);
    const body = document.createElement('div');
    body.className = 'admin-modal-body';
    while (panel.firstChild) body.appendChild(panel.firstChild);
    dialog.append(head, body);
    modal.append(backdrop, dialog);
    panel.remove();
    document.body.appendChild(modal);

    let previousFocus = null;
    const open = () => {
      previousFocus = document.activeElement;
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
      window.setTimeout(() => $('input:not([type="hidden"]),select,button', body)?.focus(), 40);
    };
    const closeModal = () => {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');
      previousFocus?.focus?.();
    };
    close.addEventListener('click', closeModal);
    backdrop.addEventListener('click', closeModal);
    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeModal();
    });
    return { modal, body, open, close: closeModal };
  }

  function wallStats(cards) {
    const active = cards.filter((card) => !card.classList.contains('inactive')).length;
    let messages = 0;
    let visitors = 0;
    cards.forEach((card) => {
      const metrics = $$('.metric strong', card);
      messages += numberFrom(metrics[0]);
      visitors += numberFrom(metrics[1]);
    });
    return { total: cards.length, active, messages, visitors };
  }

  function makeStat(label, value) {
    const item = document.createElement('div');
    item.className = 'overview-stat';
    item.innerHTML = `<strong>${value}</strong><span>${escapeHtml(label)}</span>`;
    return item;
  }

  function compactWallActions(card) {
    const actions = $('.actions', card);
    if (!actions) return null;
    const edit = $$('a.button', actions).find((a) => /\/edit$/.test(a.getAttribute('href') || ''));
    const children = Array.from(actions.children);
    const primary = document.createElement('div');
    primary.className = 'wall-primary-actions';
    if (edit) {
      edit.className = 'button wall-manage';
      edit.textContent = 'Manage';
      edit.setAttribute('aria-label', `Manage ${text($('h3', card))}`);
      primary.appendChild(edit);
    }
    const moreChildren = children.filter((child) => child !== edit);
    if (moreChildren.length) {
      const more = document.createElement('details');
      more.className = 'more-menu';
      const summary = document.createElement('summary');
      summary.setAttribute('aria-label', 'More Wall actions');
      summary.textContent = '•••';
      const menu = document.createElement('div');
      menu.className = 'more-menu-popover';
      moreChildren.forEach((child) => menu.appendChild(child));
      more.append(summary, menu);
      primary.appendChild(more);
    }
    return primary;
  }

  function makeWallRow(card) {
    const name = text($('h3', card));
    const location = text($('.location', card));
    const inactive = card.classList.contains('inactive');
    const metrics = $$('.metric strong', card);
    const messages = numberFrom(metrics[0]);
    const visitors = numberFrom(metrics[1]);
    const actions = compactWallActions(card);
    card.classList.add('wall-row');
    card.dataset.search = `${name} ${location}`.toLowerCase();
    card.dataset.status = inactive ? 'inactive' : 'active';
    card.innerHTML = '';
    const inner = document.createElement('div');
    inner.className = 'wall-row-inner';
    const identity = document.createElement('div');
    identity.className = 'wall-row-identity';
    identity.innerHTML = '<h3></h3><div class="location"></div>';
    $('h3', identity).textContent = name;
    $('.location', identity).textContent = location || 'No location set';
    const messageMetric = document.createElement('div');
    messageMetric.className = 'wall-row-metric';
    messageMetric.innerHTML = `<strong>${messages}</strong><span>Msgs</span>`;
    const visitorMetric = document.createElement('div');
    visitorMetric.className = 'wall-row-metric';
    visitorMetric.innerHTML = `<strong>${visitors}</strong><span>Visitors</span>`;
    const status = document.createElement('div');
    status.className = 'wall-row-status';
    status.innerHTML = `<span class="badge ${inactive ? 'inactive' : 'active'}">${inactive ? 'Inactive' : 'Active'}</span>`;
    const actionWrap = document.createElement('div');
    actionWrap.className = 'wall-row-actions';
    if (actions) actionWrap.appendChild(actions);
    inner.append(identity, messageMetric, visitorMetric, status, actionWrap);
    card.appendChild(inner);
    return card;
  }

  function addFilterToolbar({ container, items, searchText, statusOptions, getSearch, getStatus, emptyText, countLabel }) {
    const toolbar = document.createElement('div');
    toolbar.className = container.includes('user') ? 'users-toolbar-v2' : 'wall-inventory-toolbar';
    const search = document.createElement('input');
    search.className = `admin-control ${container.includes('user') ? 'user-search' : 'wall-search'}`;
    search.type = 'search';
    search.placeholder = searchText;
    const filter = document.createElement('select');
    filter.className = `admin-control ${container.includes('user') ? 'user-filter' : 'wall-filter'}`;
    filter.innerHTML = statusOptions.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
    const count = document.createElement('div');
    count.className = container.includes('user') ? 'user-result-count' : 'wall-result-count';
    const empty = document.createElement('div');
    empty.className = 'list-empty';
    empty.textContent = emptyText;

    const apply = () => {
      const query = search.value.trim().toLowerCase();
      const status = filter.value;
      let visible = 0;
      items.forEach((item) => {
        const matchesText = !query || getSearch(item).includes(query);
        const itemStatus = getStatus(item);
        const matchesStatus = status === 'all' || itemStatus === status;
        item.hidden = !(matchesText && matchesStatus);
        if (!item.hidden) visible += 1;
      });
      count.textContent = `${visible} of ${items.length} ${countLabel}`;
      empty.classList.toggle('is-visible', visible === 0);
    };
    search.addEventListener('input', apply);
    filter.addEventListener('change', apply);
    toolbar.append(search, filter, count);
    apply();
    return { toolbar, empty };
  }

  function rebuildWalls() {
    if (path !== '/admin/walls' && path !== '/admin') return;
    const panels = $$('.panel');
    const createPanel = panels.find((panel) => text($('h2', panel)) === 'Create a Wall');
    const createModal = createModalFromPanel(createPanel, {
      title: 'Create Wall',
      description: 'Create the place, then save the one-time NFC URL that is generated.',
    });

    const cards = $$('.wall-card');
    const stats = wallStats(cards);
    const wallSection = cards[0]?.closest('section') || $$('section').find((section) => text($('h2', section)).startsWith('Walls')) || null;
    const oldHeading = wallSection ? $('h2', wallSection) : null;
    oldHeading?.classList.add('wall-original-heading');

    const overview = document.createElement('section');
    overview.className = 'admin-overview';
    const heading = document.createElement('div');
    heading.className = 'overview-heading admin-page-heading';
    heading.innerHTML = '<div><span class="eyebrow">Overview</span><h2>Walls</h2></div>';
    const newButton = document.createElement('button');
    newButton.type = 'button';
    newButton.className = 'button overview-new';
    newButton.textContent = '+ New Wall';
    newButton.addEventListener('click', () => createModal?.open());
    heading.appendChild(newButton);
    const statsRow = document.createElement('div');
    statsRow.className = 'overview-stats';
    statsRow.append(makeStat('Walls', stats.total), makeStat('Active', stats.active), makeStat('Messages', stats.messages), makeStat('Visitors', stats.visitors));
    overview.append(heading, statsRow);
    if (wallSection?.parentNode) wallSection.parentNode.insertBefore(overview, wallSection);

    const grid = wallSection ? $('.wall-grid', wallSection) : null;
    if (!grid || !cards.length) return;
    grid.classList.add('wall-list');
    const rows = cards.map(makeWallRow);
    const inventory = document.createElement('div');
    inventory.className = 'wall-inventory';
    const kicker = document.createElement('span');
    kicker.className = 'wall-inventory-kicker';
    kicker.textContent = 'Wall inventory';
    const { toolbar, empty } = addFilterToolbar({
      container: 'wall', items: rows, searchText: 'Search Walls or location',
      statusOptions: [['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']],
      getSearch: (item) => item.dataset.search || '', getStatus: (item) => item.dataset.status || '',
      emptyText: 'No Walls match this search.', countLabel: 'Walls',
    });
    const listHead = document.createElement('div');
    listHead.className = 'wall-list-head';
    listHead.innerHTML = '<span>Wall</span><span>Messages</span><span>Visitors</span><span>Status</span><span></span>';
    grid.before(inventory);
    inventory.append(kicker, toolbar, listHead);
    grid.after(empty);

    $$('details.more-menu').forEach((menu) => {
      menu.addEventListener('toggle', () => {
        if (!menu.open) return;
        $$('details.more-menu').forEach((other) => { if (other !== menu) other.open = false; });
      });
    });
  }

  function userRowFromTableRow(row) {
    const cells = $$('td', row);
    if (cells.length < 5) return null;
    const display = text($('strong', cells[0]));
    const username = text($('.code', cells[0]));
    const role = text(cells[1]);
    const active = Boolean($('.badge.active', cells[2]));
    const temporary = /temporary password/i.test(text(cells[2]));
    const lastLogin = text(cells[3]);

    const item = document.createElement('article');
    item.className = 'user-row';
    item.dataset.search = `${display} ${username} ${role}`.toLowerCase();
    item.dataset.status = active ? 'active' : 'inactive';

    const identity = document.createElement('div');
    identity.className = 'user-identity';
    const strong = document.createElement('strong');
    strong.textContent = display;
    const handle = document.createElement('div');
    handle.className = 'user-handle';
    handle.textContent = username;
    identity.append(strong, handle);

    const roleChip = document.createElement('span');
    roleChip.className = 'user-role';
    roleChip.textContent = role;

    const status = document.createElement('div');
    status.className = 'user-status';
    status.innerHTML = `<span class="badge ${active ? 'active' : 'inactive'}">${active ? 'Active' : 'Inactive'}</span>${temporary ? '<span class="temp-badge">Temp password</span>' : ''}`;

    const login = document.createElement('div');
    login.className = 'user-login';
    login.textContent = lastLogin || 'Never';

    const actions = document.createElement('div');
    actions.className = 'user-actions';
    while (cells[4].firstChild) actions.appendChild(cells[4].firstChild);
    $$('a.button', actions).forEach((button) => button.classList.add('secondary'));

    item.append(identity, roleChip, status, login, actions);
    return item;
  }

  function rebuildUsers() {
    if (path !== '/admin/users') return;
    const panels = $$('.panel');
    const addPanel = panels.find((panel) => text($('h2', panel)) === 'Add admin user');
    const addModal = createModalFromPanel(addPanel, {
      title: 'Add admin user',
      description: 'Create a login and choose the access level for this administrator.',
    });

    const usersPanel = panels.find((panel) => text($('h2', panel)) === 'Admin users');
    if (!usersPanel) return;
    usersPanel.classList.add('users-panel');
    const pageHeading = document.createElement('div');
    pageHeading.className = 'admin-page-heading';
    pageHeading.innerHTML = '<div><span class="eyebrow">Access</span><h2>Users</h2></div>';
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'button';
    addButton.textContent = '+ Add User';
    addButton.addEventListener('click', () => addModal?.open());
    pageHeading.appendChild(addButton);
    usersPanel.parentNode.insertBefore(pageHeading, usersPanel);

    const table = $('table', usersPanel);
    if (!table) return;
    const rows = $$('tbody tr', table).map(userRowFromTableRow).filter(Boolean);
    const list = document.createElement('div');
    list.className = 'user-list';
    rows.forEach((row) => list.appendChild(row));

    const { toolbar, empty } = addFilterToolbar({
      container: 'user', items: rows, searchText: 'Search users',
      statusOptions: [['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']],
      getSearch: (item) => item.dataset.search || '', getStatus: (item) => item.dataset.status || '',
      emptyText: 'No admin users match this search.', countLabel: 'Users',
    });

    const roleHelp = document.createElement('details');
    roleHelp.className = 'role-help';
    roleHelp.innerHTML = '<summary>Role permissions</summary><p><strong>Owner</strong> — full access including users and audit. <strong>Admin</strong> — full Wall management. <strong>Moderator</strong> — review Walls and clear messages only.</p>';

    const wrap = $('.table-wrap', usersPanel);
    if (wrap) wrap.replaceWith(toolbar, list, empty, roleHelp);
    else usersPanel.append(toolbar, list, empty, roleHelp);
  }

  const actionLabels = {
    'wall.create': 'Created Wall', 'wall.edit': 'Edited Wall', 'wall.status': 'Changed Wall status',
    'wall.replace_nfc': 'Replaced NFC URL', 'wall.clear_messages': 'Cleared messages', 'wall.delete': 'Deleted Wall',
    'admin_user.create': 'Created admin user', 'admin_user.edit': 'Updated admin user',
    'admin_user.password_reset': 'Reset admin password', 'account.password_changed': 'Changed password',
    'auth.login': 'Logged in', 'auth.logout': 'Logged out',
  };
  const prettyAction = (raw) => actionLabels[raw] || raw.replaceAll('_', ' ').replaceAll('.', ' · ').replace(/\b\w/g, (m) => m.toUpperCase());

  function rebuildAudit() {
    if (path !== '/admin/audit') return;
    const panel = $('.panel');
    const table = $('table', panel);
    if (!table) return;
    const timeline = document.createElement('div');
    timeline.className = 'audit-timeline';
    $$('tbody tr', table).forEach((row) => {
      const cells = $$('td', row);
      if (cells.length < 5) return;
      const when = text(cells[0]);
      const user = text(cells[1]);
      const actionRaw = text($('strong', cells[2])) || text(cells[2]);
      const wall = text(cells[3]);
      const details = text(cells[4]);
      const item = document.createElement('article');
      item.className = 'audit-item';
      item.innerHTML = `<div class="audit-dot"></div><div class="audit-main"><div class="audit-top"><strong>${escapeHtml(prettyAction(actionRaw))}</strong><time>${escapeHtml(when)}</time></div><div class="audit-sub"><span>${escapeHtml(user)}</span>${wall && wall !== '—' ? `<span>· ${escapeHtml(wall)}</span>` : ''}</div>${details && details !== '{}' ? `<details class="audit-details-toggle"><summary>Details</summary><pre>${escapeHtml(details)}</pre></details>` : ''}</div>`;
      timeline.appendChild(item);
    });
    $('.table-wrap', panel)?.replaceWith(timeline);
    const heading = $('h2', panel);
    if (heading) heading.innerHTML = '<span class="eyebrow">Activity</span><span>Audit log</span>';
  }

  function tidySingleFormPages() {
    if (!['/admin/account/password'].includes(path) && !/\/admin\/walls\/[^/]+\/(edit|replace-nfc|clear|delete)$/.test(path) && !/\/admin\/users\/[^/]+\/(edit|password)$/.test(path)) return;
    const panel = $('.panel');
    if (!panel) return;
    panel.style.maxWidth = '720px';
    panel.style.marginLeft = 'auto';
    panel.style.marginRight = 'auto';
  }

  installStyles();
  refineHeader();
  setActiveNav();
  improveForms();
  rebuildWalls();
  rebuildUsers();
  rebuildAudit();
  tidySingleFormPages();
})();
