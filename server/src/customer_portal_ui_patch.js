export function installCustomerPortalUiPatch(app) {
  app.use('/my-walls', (req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/login') || req.path.startsWith('/claim')) return next();

    const originalSend = res.send.bind(res);
    res.send = (body) => {
      if (typeof body === 'string' && body.includes('<main class="shell">')) {
        if (!body.includes('/my-walls-dashboard.css')) {
          body = body.replace('</head>', '<link rel="stylesheet" href="/my-walls-dashboard.css?v=2"></head>');
        }
        if (!body.includes('/my-walls-dashboard.js')) {
          body = body.replace('</body>', '<script src="/my-walls-dashboard.js?v=2" defer></script></body>');
        }
      }
      return originalSend(body);
    };
    return next();
  });
}
