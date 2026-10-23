export function installCheckoutUiPatch(app) {
  app.use('/shop', (req, res, next) => {
    if (req.method !== 'GET' || (req.path !== '/' && req.path !== '')) return next();

    const originalSend = res.send.bind(res);
    res.send = (body) => {
      if (typeof body === 'string' && body.includes('id="quantity"') && !body.includes('/checkout-quantity.js')) {
        body = body.replace(
          '</body>',
          '<script src="/checkout-quantity.js" defer></script></body>',
        );
      }
      return originalSend(body);
    };
    return next();
  });
}
