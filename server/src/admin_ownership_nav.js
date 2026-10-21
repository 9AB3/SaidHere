export function mountOwnershipAdminNav(app) {
  // Commerce adds paying Wall Owners, but it does not replace the existing
  // Main Admin + Moderator administration model. Keep /admin/users available
  // for platform staff while routing the commerce shortcuts to fulfilment.
  app.get('/admin/orders', (_req, res) => res.redirect(303, '/admin/fulfillment'));
  app.get('/admin/customers', (_req, res) => res.redirect(303, '/admin/fulfillment'));

  app.use('/admin', (_req, res, next) => {
    const originalSend = res.send.bind(res);
    res.send = (body) => {
      if (typeof body === 'string' && body.includes('<a href="/admin/users">Users</a>')) {
        body = body.replace(
          '<a href="/admin/users">Users</a>',
          '<a href="/admin/orders">Orders</a><a href="/admin/users">Users</a>',
        );
      }
      return originalSend(body);
    };
    return next();
  });
}
