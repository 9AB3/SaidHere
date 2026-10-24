const CHECKOUT_SCRIPT = String.raw`(() => {
  const q = document.getElementById('quantity');
  const minus = document.getElementById('minus');
  const plus = document.getElementById('plus');
  const qtyLabel = document.getElementById('qtyLabel');
  const subtotal = document.getElementById('subtotal');
  const total = document.getElementById('total');
  if (!q || !minus || !plus || !qtyLabel || !subtotal || !total) return;

  const initial = String(subtotal.textContent || '').trim();
  const unit = Number(initial.replace(/[^0-9.,-]/g, '').replace(/,/g, '')) || 15;
  const formatter = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });

  function value() {
    let n = Number.parseInt(q.value, 10);
    if (!Number.isFinite(n)) n = 1;
    return Math.max(1, Math.min(10, n));
  }

  function render(n = value()) {
    q.value = String(n);
    qtyLabel.textContent = String(n);
    const amount = formatter.format(unit * n);
    subtotal.textContent = amount;
    total.textContent = amount;
    minus.disabled = n <= 1;
    plus.disabled = n >= 10;
  }

  minus.addEventListener('click', (event) => {
    event.preventDefault();
    render(Math.max(1, value() - 1));
  });

  plus.addEventListener('click', (event) => {
    event.preventDefault();
    render(Math.min(10, value() + 1));
  });

  q.addEventListener('input', () => render());
  q.addEventListener('change', () => render());
  render();
})();`;

export function installCheckoutUiPatch(app) {
  // Serve the checkout behaviour directly from the Node app. This avoids relying
  // on Render's copied static directory and remains allowed by Helmet's script-src 'self'.
  app.get('/checkout-quantity.js', (_req, res) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    return res.type('application/javascript').send(CHECKOUT_SCRIPT);
  });

  app.use('/shop', (req, res, next) => {
    if (req.method !== 'GET' || (req.path !== '/' && req.path !== '')) return next();

    const originalSend = res.send.bind(res);
    res.send = (body) => {
      if (typeof body === 'string' && body.includes('id="quantity"')) {
        // The owner no longer assigns a global Wall location during setup.
        body = body
          .replace('Name and location are set on the first scan.', 'Name your Wall on the first scan.')
          .replace('its first NFC scan lets you choose the name and location.', 'its first NFC scan lets you choose the Wall name.');

        // Remove the original inline checkout script, which Helmet correctly blocks,
        // then load the CSP-safe server-served script instead.
        body = body.replace(/<script>\(\(\)=>\{[\s\S]*?<\/script>/, '');
        if (!body.includes('/checkout-quantity.js?v=4')) {
          body = body.replace(
            '</body>',
            '<script src="/checkout-quantity.js?v=4"></script><!-- checkout-ui-v4 --></body>',
          );
        }
      }
      return originalSend(body);
    };
    return next();
  });
}
