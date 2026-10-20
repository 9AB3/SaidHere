(() => {
  'use strict';

  const path = window.location.pathname;
  document.body.dataset.adminPage = path;

  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const $ = (selector, root = document) => root.querySelector(selector);
  const text = (node) => (node?.textContent || '').trim();
  const numberFrom = (node) => {
    const match = text(node).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  };

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

    const account = $('.account');
    const chip = account?.querySelector(':scope > span');
    if (chip) {
      const parts = text(chip).split('·').map((part) => part.trim());
      chip.innerHTML = `<strong>${parts[0] || 'Admin'}</strong><small>${parts[1] || ''}</small>`;
      chip.classList.add('account-chip');
    }
  }

  function improveForms() {
    $$('input, select').forEach((field) => field.classList.add('admin-control'));
    $$('.panel').forEach((panel) => panel.classList.add('admin-panel'));
  }

  function upgradeCreatePanel(panel, label) {
    if (!panel || panel.closest('details.admin-drawer')) return null;
    const details = document.createElement('details');
    details.className = 'admin-drawer';
    const summary = document.createElement('summary');
    summary.innerHTML = `<span class="summary-plus">+</span><span>${label}</span><span class="summary-chevron">⌄</span>`;
    const body = document.createElement('div');
    body.className = 'admin-drawer-body';
    while (panel.firstChild) body.appendChild(panel.firstChild);
    details.append(summary, body);
    panel.replaceWith(details);
    return details;
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
    item.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
    return item;
  }

  function compactWallActions(card) {
    const actions = $('.actions', card);
    if (!actions || actions.dataset.compacted === '1') return null;
    actions.dataset.compacted = '1';

    const edit = $$('a.button', actions).find((a) => /\/edit$/.test(a.getAttribute('href') || ''));
    const children = Array.from(actions.children);
    const primary = document.createElement('div');
    primary.className = 'wall-primary-actions';

    if (edit) {
      edit.className = 'button wall-manage';
      edit.textContent = 'Manage';
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

    actions.replaceWith(primary);
    return primary;
  }

  function installCompactWallStyles() {
    if ($('#compact-wall-styles')) return;
    const style = document.createElement('style');
    style.id = 'compact-wall-styles';
    style.textContent = `
      body[data-admin-page="/admin/walls"] .admin-overview,
      body[data-admin-page="/admin"] .admin-overview{margin-bottom:12px}
      .wall-inventory-toolbar{display:grid;grid-template-columns:minmax(0,1fr) 150px auto;gap:8px;align-items:center;margin:0 0 9px}
      .wall-search{min-height:40px!important;padding:9px 12px!important;font-size:13px!important}
      .wall-filter{min-height:40px!important;padding:8px 10px!important;font-size:12px!important}
      .wall-result-count{font-size:10px;color:var(--tw-muted);font-weight:850;white-space:nowrap;text-align:right}
      .wall-grid.wall-list{display:flex!important;flex-direction:column!important;gap:5px!important}
      .wall-card.wall-row{padding:0!important;border-radius:9px!important;box-shadow:none!important;overflow:visible;background:#fffdf9!important;opacity:1!important}
      .wall-card.wall-row::before{width:3px;border-radius:9px 0 0 9px}
      .wall-row-inner{display:grid;grid-template-columns:minmax(180px,1fr) 72px 72px auto auto;align-items:center;gap:10px;min-height:62px;padding:9px 10px 9px 14px}
      .wall-row-identity{min-width:0}
      .wall-row-identity h3{margin:0 0 2px!important;font-size:15px!important;line-height:1.1!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .wall-row-identity .location{font-size:10px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .wall-row-metric{display:flex;flex-direction:column;align-items:flex-start;min-width:0}
      .wall-row-metric strong{font-size:13px;line-height:1;font-weight:950}
      .wall-row-metric span{margin-top:3px;font-size:7px;line-height:1;text-transform:uppercase;letter-spacing:.65px;color:var(--tw-muted);font-weight:900}
      .wall-row-status{justify-self:start}
      .wall-row-status .badge{font-size:8px!important;padding:4px 6px!important}
      .wall-row-actions{justify-self:end}
      .wall-row-actions .wall-primary-actions{margin:0!important;gap:4px!important}
      .wall-row-actions .button{min-height:34px!important;padding:8px 10px!important;font-size:8px!important;border-radius:7px!important}
      .wall-row-actions .more-menu>summary{min-height:34px!important;width:34px!important;padding:0!important;border-radius:7px!important;font-size:10px!important;letter-spacing:1px!important}
      .wall-row-actions .more-menu-popover{bottom:auto!important;top:calc(100% + 5px)!important;right:0!important}
      .wall-list-empty{display:none;padding:20px;text-align:center;color:var(--tw-muted);font-size:12px;background:#fffdf9;border:1px solid var(--tw-line);border-radius:9px}
      .wall-list-empty.is-visible{display:block}
      .wall-list-head{display:grid;grid-template-columns:minmax(180px,1fr) 72px 72px auto auto;gap:10px;padding:0 10px 5px 14px;color:var(--tw-muted);font-size:7px;text-transform:uppercase;letter-spacing:.75px;font-weight:950}
      .wall-list-head span:nth-child(4){padding-left:2px}
      @media(max-width:700px){
        .overview-stats{grid-template-columns:repeat(4,minmax(0,1fr))!important}
        .overview-stat{padding:8px 7px!important}
        .overview-stat strong{font-size:17px!important}.overview-stat span{font-size:7px!important;margin-top:4px!important}
        .wall-inventory-toolbar{grid-template-columns:minmax(0,1fr) 108px;gap:6px}
        .wall-result-count{grid-column:1/-1;text-align:left;margin-top:-2px;font-size:9px}
        .wall-list-head{display:none}
        .wall-row-inner{grid-template-columns:minmax(0,1fr) 44px 44px auto;gap:7px;min-height:58px;padding:8px 8px 8px 12px}
        .wall-row-identity h3{font-size:14px!important}.wall-row-identity .location{font-size:9px!important}
        .wall-row-metric strong{font-size:12px}.wall-row-metric span{font-size:6px}
        .wall-row-status{display:none}
        .wall-row-actions .wall-manage{font-size:0!important;width:34px!important;padding:0!important}
        .wall-row-actions .wall-manage::after{content:'›';font-size:21px;line-height:1;font-weight:500}
        .wall-row-actions .more-menu>summary{width:30px!important;min-height:32px!important}
      }
      @media(max-width:390px){
        .wall-row-inner{grid-template-columns:minmax(0,1fr) 39px 39px auto;gap:5px}
      }
    `;
    document.head.appendChild(style);
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
    const title = document.createElement('h3');
    title.textContent = name;
    const loc = document.createElement('div');
    loc.className = 'location';
    loc.textContent = location || 'No location set';
    identity.append(title, loc);

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

  function addWallFilters(grid, cards) {
    const toolbar = document.createElement('div');
    toolbar.className = 'wall-inventory-toolbar';

    const search = document.createElement('input');
    search.className = 'admin-control wall-search';
    search.type = 'search';
    search.placeholder = 'Search Walls or location';
    search.setAttribute('aria-label', 'Search Walls');

    const filter = document.createElement('select');
    filter.className = 'admin-control wall-filter';
    filter.setAttribute('aria-label', 'Filter Walls by status');
    filter.innerHTML = '<option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option>';

    const count = document.createElement('div');
    count.className = 'wall-result-count';

    const empty = document.createElement('div');
    empty.className = 'wall-list-empty';
    empty.textContent = 'No Walls match this search.';
    grid.after(empty);

    const apply = () => {
      const q = search.value.trim().toLowerCase();
      const status = filter.value;
      let visible = 0;
      cards.forEach((card) => {
        const matchesText = !q || card.dataset.search.includes(q);
        const matchesStatus = status === 'all' || card.dataset.status === status;
        const show = matchesText && matchesStatus;
        card.hidden = !show;
        if (show) visible += 1;
      });
      count.textContent = `${visible} of ${cards.length} Walls`;
      empty.classList.toggle('is-visible', visible === 0);
    };

    search.addEventListener('input', apply);
    filter.addEventListener('change', apply);
    toolbar.append(search, filter, count);
    apply();
    return toolbar;
  }

  function rebuildWalls() {
    if (path !== '/admin/walls' && path !== '/admin') return;
    installCompactWallStyles();

    const panels = $$('.panel');
    const createPanel = panels.find((panel) => text($('h2', panel)) === 'Create a Wall');
    const drawer = upgradeCreatePanel(createPanel, 'New Wall');
    const originalCards = $$('.wall-card');
    const stats = wallStats(originalCards);

    const overview = document.createElement('section');
    overview.className = 'admin-overview';
    const heading = document.createElement('div');
    heading.className = 'overview-heading';
    heading.innerHTML = '<div><span class="eyebrow">Overview</span><h2>Walls</h2></div>';

    const newButton = document.createElement('button');
    newButton.type = 'button';
    newButton.className = 'button overview-new';
    newButton.textContent = '+ New Wall';
    newButton.addEventListener('click', () => {
      if (!drawer) return;
      drawer.open = true;
      drawer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(() => $('input[name="display_name"]', drawer)?.focus(), 250);
    });
    heading.appendChild(newButton);

    const statsRow = document.createElement('div');
    statsRow.className = 'overview-stats';
    statsRow.append(
      makeStat('Walls', stats.total),
      makeStat('Active', stats.active),
      makeStat('Messages', stats.messages),
      makeStat('Visitors', stats.visitors),
    );
    overview.append(heading, statsRow);

    const insertionPoint = drawer || $('.wall-grid')?.parentElement || $('.panel');
    if (insertionPoint) insertionPoint.parentNode.insertBefore(overview, insertionPoint);

    const grid = $('.wall-grid');
    if (!grid || !originalCards.length) return;
    grid.classList.add('wall-list');
    const rows = originalCards.map(makeWallRow);

    const listHead = document.createElement('div');
    listHead.className = 'wall-list-head';
    listHead.innerHTML = '<span>Wall</span><span>Messages</span><span>Visitors</span><span>Status</span><span></span>';
    grid.before(listHead);

    const toolbar = addWallFilters(grid, rows);
    listHead.before(toolbar);

    const wallSectionHeading = $$('section > h2').find((h) => text(h).startsWith('Walls'));
    if (wallSectionHeading) {
      wallSectionHeading.innerHTML = '<span class="eyebrow">Inventory</span><span>All Walls</span>';
      wallSectionHeading.classList.add('section-heading');
    }
  }

  function buildUserCard(row) {
    const cells = $$('td', row);
    if (cells.length < 5) return null;
    const card = document.createElement('article');
    card.className = 'user-card';
    const identity = document.createElement('div');
    identity.className = 'user-card-head';
    identity.innerHTML = `<div><h3>${$('strong', cells[0])?.innerHTML || ''}</h3><div class="user-handle">${$('.code', cells[0])?.innerHTML || ''}</div></div>`;
    const role = document.createElement('span');
    role.className = 'role role-chip';
    role.textContent = text(cells[1]);
    identity.appendChild(role);
    const meta = document.createElement('div');
    meta.className = 'user-card-meta';
    const status = document.createElement('div');
    status.innerHTML = `<span class="meta-label">Status</span>${cells[2].innerHTML}`;
    const login = document.createElement('div');
    login.innerHTML = `<span class="meta-label">Last login</span><strong>${cells[3].innerHTML}</strong>`;
    meta.append(status, login);
    const actions = document.createElement('div');
    actions.className = 'user-card-actions';
    while (cells[4].firstChild) actions.appendChild(cells[4].firstChild);
    card.append(identity, meta, actions);
    return card;
  }

  function rebuildUsers() {
    if (path !== '/admin/users') return;
    const panels = $$('.panel');
    const addPanel = panels.find((panel) => text($('h2', panel)) === 'Add admin user');
    const drawer = upgradeCreatePanel(addPanel, 'Add admin user');
    const usersPanel = panels.find((panel) => text($('h2', panel)) === 'Admin users');
    const table = $('table', usersPanel);
    if (table) {
      const list = document.createElement('div');
      list.className = 'user-card-list';
      $$('tbody tr', table).forEach((row) => {
        const card = buildUserCard(row);
        if (card) list.appendChild(card);
      });
      $('.table-wrap', usersPanel)?.replaceWith(list);
    }
    if (usersPanel) {
      const header = $('h2', usersPanel);
      if (header) header.innerHTML = '<span class="eyebrow">Access</span><span>Admin users</span>';
      const top = document.createElement('div');
      top.className = 'users-toolbar';
      const intro = document.createElement('p');
      intro.className = 'help';
      intro.textContent = 'Manage who can administer Walls, moderate content and review activity.';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button';
      button.textContent = '+ Add user';
      button.addEventListener('click', () => {
        if (!drawer) return;
        drawer.open = true;
        drawer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      top.append(intro, button);
      header?.after(top);
    }
  }

  const actionLabels = {
    'wall.create': 'Created Wall',
    'wall.edit': 'Edited Wall',
    'wall.status': 'Changed Wall status',
    'wall.replace_nfc': 'Replaced NFC URL',
    'wall.clear_messages': 'Cleared messages',
    'wall.delete': 'Deleted Wall',
    'admin_user.create': 'Created admin user',
    'admin_user.edit': 'Updated admin user',
    'admin_user.password_reset': 'Reset admin password',
    'account.password_changed': 'Changed password',
    'auth.login': 'Logged in',
    'auth.logout': 'Logged out',
  };

  function prettyAction(raw) {
    if (actionLabels[raw]) return actionLabels[raw];
    return raw.replaceAll('_', ' ').replaceAll('.', ' · ').replace(/\b\w/g, (m) => m.toUpperCase());
  }

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
      const item = document.createElement('article');
      item.className = 'audit-item';
      const when = text(cells[0]);
      const user = text(cells[1]);
      const actionRaw = text($('strong', cells[2])) || text(cells[2]);
      const wall = text(cells[3]);
      const details = text(cells[4]);
      item.innerHTML = `<div class="audit-dot"></div><div class="audit-main"><div class="audit-top"><strong>${prettyAction(actionRaw)}</strong><time>${when}</time></div><div class="audit-sub"><span>${user}</span>${wall && wall !== '—' ? `<span>· ${wall}</span>` : ''}</div>${details && details !== '{}' ? `<details class="audit-details-toggle"><summary>Details</summary><pre>${details}</pre></details>` : ''}</div>`;
      timeline.appendChild(item);
    });
    $('.table-wrap', panel)?.replaceWith(timeline);
    const heading = $('h2', panel);
    if (heading) heading.innerHTML = '<span class="eyebrow">Activity</span><span>Audit log</span>';
  }

  refineHeader();
  setActiveNav();
  improveForms();
  rebuildWalls();
  rebuildUsers();
  rebuildAudit();
})();
