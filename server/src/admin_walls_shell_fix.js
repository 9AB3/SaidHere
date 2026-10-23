(() => {
  'use strict';

  function tidyWallsMonitor() {
    if (!document.querySelector('.wm')) return;

    // admin_ui.js still knows how to decorate the legacy Wall management page.
    // The new monitor owns its own controls, so remove only that generated toolbar.
    document.querySelectorAll('.admin-content > .toolbar').forEach((toolbar) => toolbar.remove());
    document.querySelectorAll('.admin-content > .kpis').forEach((kpis) => kpis.remove());

    const heading = document.querySelector('.admin-head h1');
    const subtitle = document.querySelector('.admin-head p');
    if (heading) heading.textContent = 'Walls';
    if (subtitle) subtitle.textContent = 'Ownership, status and activity';
  }

  tidyWallsMonitor();
  requestAnimationFrame(tidyWallsMonitor);
  setTimeout(tidyWallsMonitor, 50);
  setTimeout(tidyWallsMonitor, 250);
})();
