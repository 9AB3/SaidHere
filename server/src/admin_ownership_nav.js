export function mountOwnershipAdminNav(app) {
  // The legacy admin portal still contains its original Users routes for a safe
  // migration, but the product model is now Platform Admin + paying Wall Owners.
  // Keep the public admin navigation focused on commerce ownership instead.
  app.get('/admin/users', (_req, res) => res.redirect(303, '/admin/fulfillment'));
  app.get('/admin/orders', (_req, res) => res.redirect(303, '/admin/fulfillment'));
  app.get('/admin/customers', (_req, res) => res.redirect(303, '/admin/fulfillment'));

  app.use('/admin', (_req, res, next) => {
    const originalSend = res.send.bind(res);
    res.send = (body) => {
      if (typeof body === 'string') {
        body = body
          .replace('<a href="/admin/users">Users</a>', '<a href="/admin/orders">Orders</a>')
          .replace('Manage users', 'Manage customers');
      }
      return originalSend(body);
    };
    return next();
  });
}
