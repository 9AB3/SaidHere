import { mountAdminOrdersV2 } from './admin_orders_v2.js';

export function mountOwnershipAdminNav(app) {
  // Paid plaque fulfilment is deliberately simple: assign the physical NFC,
  // mark the plaque shipped, and leave Wall naming/location to the customer.
  mountAdminOrdersV2(app);

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
