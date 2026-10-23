(() => {
  const main = document.querySelector('main.shell');
  if (!main || !location.pathname.startsWith('/my-walls')) return;

  const wallCards = [...main.querySelectorAll('.card.wallrow')];
  const onDashboard = location.pathname === '/my-walls' || location.pathname === '/my-walls/';

  function metricValue(card, label) {
    for (const metric of card.querySelectorAll('.metric')) {
      const text = (metric.querySelector('span')?.textContent || '').trim().toLowerCase();
      if (text === label.toLowerCase()) {
        return Number((metric.querySelector('strong')?.textContent || '0').replace(/[^0-9.-]/g, '')) || 0;
      }
    }
    return 0;
  }

  if (onDashboard) {
    document.body.classList.add('my-walls-dashboard');
    const pagehead = [...main.querySelectorAll('.pagehead')].find((el) => (el.querySelector('h1')?.textContent || '').trim() === 'My Walls');
    if (!pagehead) return;

    let totalMessages = 0;
    let totalVisitors = 0;
    let setupCount = 0;
    let reportWalls = 0;

    wallCards.forEach((card) => {
      const badges = [...card.querySelectorAll('.badge')].map((x) => (x.textContent || '').trim().toLowerCase());
      const needsSetup = badges.some((x) => x.includes('first scan'));
      const hasReports = badges.some((x) => x.includes('report'));
      const inactive = badges.some((x) => x === 'inactive');
      card.dataset.setup = needsSetup ? '1' : '0';
      card.dataset.reports = hasReports ? '1' : '0';
      card.dataset.inactive = inactive ? '1' : '0';
      card.dataset.search = (card.textContent || '').toLowerCase();
      if (needsSetup) {
        setupCount += 1;
        card.classList.add('mw-attention');
        const info = document.createElement('div');
        info.className = 'mw-action-note';
        info.textContent = 'Scan the physical Wall to finish setup';
        card.querySelector('.sub')?.after(info);
        const button = card.querySelector(':scope > .button');
        if (button) button.textContent = 'Setup';
      }
      if (hasReports) {
        reportWalls += 1;
        card.classList.add('mw-reports');
      }
      totalMessages += metricValue(card, 'Messages');
      totalVisitors += metricValue(card, 'Visitors');
    });

    const overview = document.createElement('section');
    overview.className = 'mw-overview';
    overview.innerHTML = `
      <div class="mw-stat"><strong>${wallCards.length}</strong><span>Walls</span></div>
      <div class="mw-stat"><strong>${totalMessages}</strong><span>Messages</span></div>
      <div class="mw-stat"><strong>${totalVisitors}</strong><span>Visitors</span></div>
      <div class="mw-stat"><strong>${setupCount + reportWalls}</strong><span>Need action</span></div>`;
    pagehead.after(overview);

    if (wallCards.length > 1) {
      const tools = document.createElement('div');
      tools.className = 'mw-tools';
      tools.innerHTML = `
        <input class="mw-search" type="search" placeholder="Find a Wall" aria-label="Find a Wall">
        <button class="mw-filter is-active" type="button" data-filter="all">All</button>
        ${setupCount ? '<button class="mw-filter" type="button" data-filter="setup">Needs setup</button>' : ''}
        ${reportWalls ? '<button class="mw-filter" type="button" data-filter="reports">Reports</button>' : ''}`;
      overview.after(tools);

      let filter = 'all';
      const search = tools.querySelector('.mw-search');
      const empty = document.createElement('div');
      empty.className = 'mw-empty-filter mw-hidden';
      empty.textContent = 'No Walls match that filter.';
      wallCards[wallCards.length - 1].after(empty);

      function apply() {
        const q = (search.value || '').trim().toLowerCase();
        let shown = 0;
        wallCards.forEach((card) => {
          const matchesSearch = !q || card.dataset.search.includes(q);
          const matchesFilter = filter === 'all' ||
            (filter === 'setup' && card.dataset.setup === '1') ||
            (filter === 'reports' && card.dataset.reports === '1');
          const visible = matchesSearch && matchesFilter;
          card.classList.toggle('mw-hidden', !visible);
          if (visible) shown += 1;
        });
        empty.classList.toggle('mw-hidden', shown !== 0);
      }

      search.addEventListener('input', apply);
      tools.querySelectorAll('.mw-filter').forEach((button) => {
        button.addEventListener('click', () => {
          filter = button.dataset.filter || 'all';
          tools.querySelectorAll('.mw-filter').forEach((x) => x.classList.toggle('is-active', x === button));
          apply();
        });
      });
    }

    const ordersHeading = [...main.querySelectorAll('.pagehead h1')].find((h) => (h.textContent || '').includes('Walls being prepared'));
    const ordersSection = ordersHeading?.closest('section');
    if (ordersSection) {
      ordersSection.classList.add('orders-section');
      const cards = [...ordersSection.querySelectorAll('.card.order')];
      const head = ordersSection.querySelector('.pagehead');
      if (head && cards.length) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'mw-orders-toggle';
        toggle.textContent = cards.length > 1 ? `Hide ${cards.length} orders` : 'Hide order';
        head.append(toggle);
        let open = true;
        toggle.addEventListener('click', () => {
          open = !open;
          cards.forEach((card) => card.classList.toggle('mw-hidden', !open));
          toggle.textContent = open ? (cards.length > 1 ? `Hide ${cards.length} orders` : 'Hide order') : (cards.length > 1 ? `Show ${cards.length} orders` : 'Show order');
        });
      }
    }

    // Put items requiring attention first while keeping the rest in their existing order.
    const firstWall = wallCards[0];
    if (firstWall) {
      const parent = firstWall.parentNode;
      [...wallCards]
        .sort((a, b) => Number(b.dataset.reports) * 2 + Number(b.dataset.setup) - (Number(a.dataset.reports) * 2 + Number(a.dataset.setup)))
        .forEach((card) => parent.insertBefore(card, ordersSection || null));
    }
    return;
  }

  // Owner manage page: condense the form and make the important numbers visible immediately.
  if (/^\/my-walls\/[0-9a-f-]+\/?$/i.test(location.pathname)) {
    document.body.classList.add('my-wall-manage');
    const detailCard = [...main.querySelectorAll('section.card')][0];
    const metrics = detailCard?.querySelector('.metrics');
    const pagehead = [...main.querySelectorAll('.pagehead')][0];
    if (metrics && pagehead) {
      const values = [...metrics.querySelectorAll('.metric')].map((metric) => ({
        value: (metric.querySelector('strong')?.textContent || '').trim(),
        label: (metric.querySelector('span')?.textContent || '').trim(),
      }));
      const summary = document.createElement('div');
      summary.className = 'mw-manage-summary';
      summary.innerHTML = values.slice(0, 3).map((x) => `<div class="mw-stat"><strong>${x.value}</strong><span>${x.label}</span></div>`).join('');
      pagehead.after(summary);
      metrics.classList.add('mw-hidden');
    }

    const moderationHead = [...main.querySelectorAll('.pagehead')].find((el) => (el.textContent || '').toLowerCase().includes('reported posts'));
    if (moderationHead) {
      const count = [...moderationHead.querySelectorAll('.badge')].map((x) => x.textContent || '').join(' ');
      if (/0\s+pending/i.test(count)) moderationHead.style.marginBottom = '5px';
    }
  }
})();
