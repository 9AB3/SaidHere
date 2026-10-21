import { mountAdminOrders } from './admin_orders.js';

export function mountOwnershipAdminNav(app) {
  // Mount the commerce/order console before the older admin routes so /admin/orders
  // is a first-class operational page rather than a redirect into a basic fulfilment view.
  mountAdminOrders(app);

  app.get('/admin/customers', (_req, res) => res.redirect(303, '/admin/orders'));

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
