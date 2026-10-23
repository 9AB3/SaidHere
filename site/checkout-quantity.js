(() => {
  const q = document.getElementById('quantity');
  const minus = document.getElementById('minus');
  const plus = document.getElementById('plus');
  const qtyLabel = document.getElementById('qtyLabel');
  const subtotal = document.getElementById('subtotal');
  const total = document.getElementById('total');
  if (!q || !minus || !plus || !qtyLabel || !subtotal || !total) return;

  const initialText = String(subtotal.textContent || '').trim();
  const numeric = Number(initialText.replace(/[^0-9.,-]/g, '').replace(/,/g, '')) || 15;
  const unitAmount = numeric;
  const currency = initialText.includes('A$') ? 'AUD' : 'AUD';
  const formatter = new Intl.NumberFormat('en-AU', { style: 'currency', currency });

  function update() {
    let n = parseInt(q.value, 10);
    if (!Number.isFinite(n)) n = 1;
    n = Math.max(1, Math.min(10, n));
    q.value = String(n);
    qtyLabel.textContent = String(n);
    const label = formatter.format(unitAmount * n);
    subtotal.textContent = label;
    total.textContent = label;
    minus.disabled = n <= 1;
    plus.disabled = n >= 10;
  }

  minus.addEventListener('click', () => {
    q.value = String((parseInt(q.value, 10) || 1) - 1);
    update();
  });
  plus.addEventListener('click', () => {
    q.value = String((parseInt(q.value, 10) || 1) + 1);
    update();
  });
  q.addEventListener('input', update);
  q.addEventListener('change', update);
  update();
})();
