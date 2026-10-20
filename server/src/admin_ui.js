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

  function wallStats() {
    const cards = $$('.wall-card');
    const total = cards.length;
    const active = cards.filter((card) => !card.classList.contains('inactive')).length;
    let messages = 0;
    let visitors = 0;
    cards.forEach((card) => {
      const metrics = $$('.metric strong', card);
      messages += numberFrom(metrics[0]);
      visitors += numberFrom(metrics[1]);
    });
    return { total, active, messages, visitors };
  }

  function makeStat(label, value) {
    const item = document.createElement('div');
    item.className = 'overview-stat';
    item.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
    return item;
  }

  function compactWallActions(card) {
    const actions = $('.actions', card);
    if (!actions || actions.dataset.compacted === '1') return;
    actions.dataset.compacted = '1';

    const edit = $$('a.button', actions).find((a) => /\/edit$/.test(a.getAttribute('href') || ''));
    const children = Array.from(actions.children);
    const primary = document.createElement('div');
    primary.className = 'wall-primary-actions';

    if (edit) {
      edit.className = 'button wall-manage';
      edit.textContent = 'Manage wall';
      primary.appendChild(edit);
    }

    const more = document.createElement('details');
    more.className = 'more-menu';
    const summary = document.createElement('summary');
    summary.textContent = 'More';
    const menu = document.createElement('div');
    menu.className = 'more-menu-popover';

    children.forEach((child) => {
      if (child === edit) return;
      menu.appendChild(child);
    });
    more.append(summary, menu);
    primary.appendChild(more);
    actions.replaceWith(primary);
  }

  function rebuildWalls() {
    if (path !== '/admin/walls' && path !== '/admin') return;

    const panels = $$('.panel');
    const createPanel = panels.find((panel) => text($('h2', panel)) === 'Create a Wall');
    const drawer = upgradeCreatePanel(createPanel, 'New Wall');

    const cards = $$('.wall-card');
    cards.forEach(compactWallActions);

    const stats = wallStats();
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
      window.setTimeout(() => $('input[name="display_name"]', drawer)?.focus(), 350);
    });
    heading.appendChild(newButton);

    const statsRow = document.createElement('div');
    statsRow.className = 'overview-stats';
    statsRow.append(
      makeStat('Total walls', stats.total),
      makeStat('Active', stats.active),
      makeStat('Messages', stats.messages),
      makeStat('Visitors', stats.visitors),
    );
    overview.append(heading, statsRow);

    const insertionPoint = drawer || $('.wall-grid')?.parentElement || $('.panel');
    if (insertionPoint) insertionPoint.parentNode.insertBefore(overview, insertionPoint);

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
    const display = $('strong', cells[0]);
    const username = $('.code', cells[0]);
    identity.innerHTML = `<div><h3>${display?.innerHTML || ''}</h3><div class="user-handle">${username?.innerHTML || ''}</div></div>`;

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
      item.innerHTML = `
        <div class="audit-dot"></div>
        <div class="audit-main">
          <div class="audit-top"><strong>${prettyAction(actionRaw)}</strong><time>${when}</time></div>
          <div class="audit-sub"><span>${user}</span>${wall && wall !== '—' ? `<span>· ${wall}</span>` : ''}</div>
          ${details && details !== '{}' ? `<details class="audit-details-toggle"><summary>Details</summary><pre>${details}</pre></details>` : ''}
        </div>`;
      timeline.appendChild(item);
    });
    $('.table-wrap', panel)?.replaceWith(timeline);
    const heading = $('h2', panel);
    if (heading) heading.innerHTML = '<span class="eyebrow">Activity</span><span>Audit log</span>';
  }

  function improveForms() {
    $$('input, select').forEach((field) => field.classList.add('admin-control'));
    $$('.panel').forEach((panel) => panel.classList.add('admin-panel'));
  }

  refineHeader();
  setActiveNav();
  improveForms();
  rebuildWalls();
  rebuildUsers();
  rebuildAudit();
})();
