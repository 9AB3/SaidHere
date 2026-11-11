(() => {
  'use strict';
  // Only anonymous aggregate event names and a coarse marketing channel are sent.
  const pathname = window.location.pathname;
  const landing = pathname.startsWith('/t/') || pathname.startsWith('/w/') ? 'nfc' : 'home';
  const knownSources = ['reddit','google','instagram','facebook','tiktok','youtube','email'];
  const params = new URLSearchParams(window.location.search);
  const fromParam = (params.get('utm_source') || '').toLowerCase();
  let source = knownSources.find((value) => fromParam.includes(value)) || (fromParam ? 'other' : 'direct');
  if (!fromParam && document.referrer) {
    try {
      const host = new URL(document.referrer).hostname.toLowerCase();
      if (host !== window.location.hostname) {
        source = knownSources.find((value) => host.includes(value)) || 'other';
      }
    } catch (_) { /* Ignore invalid referrers. */ }
  }
  function log(event, platform = null) {
    const payload = JSON.stringify({ event, platform, landing, source });
    try {
      const blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon?.('/api/analytics/event', blob)) return;
      fetch('/api/analytics/event', {
        method: 'POST',
        body: payload,
        headers: { 'content-type': 'application/json' },
        keepalive: true,
        credentials: 'same-origin',
      }).catch(() => {});
    } catch (_) { /* Analytics never interferes with navigation. */ }
  }
  log('landing_view');
  document.querySelectorAll('a[href*="apps.apple.com"], a[href*="play.google.com"]').forEach((link) => {
    link.addEventListener('click', () => {
      log('store_click', link.href.includes('apps.apple.com') ? 'ios' : 'android');
    });
  });
})();
