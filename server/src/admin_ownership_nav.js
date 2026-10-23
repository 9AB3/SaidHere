import { mountAdminMultiwall } from './admin_multiwall.js';
import { mountAdminOrdersV3 } from './admin_orders_v3.js';
import { mountAdminWallSafety } from './admin_wall_safety.js';

export function mountOwnershipAdminNav(app) {
  // Multi-Wall moderator assignments and the mobile admin fixes are mounted
  // before the legacy portal so they can safely intercept the routes they own.
  mountAdminMultiwall(app);

  // Orders are handled as whole fulfilment jobs: each Wall is tagged, confirmed,
  // then the complete order is shipped together and moved into order history.
  mountAdminOrdersV3(app);

  // Intercept destructive/replacement actions before the older Wall-management
  // routes so purchase, ownership and physical-inventory records stay consistent.
  mountAdminWallSafety(app);

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
