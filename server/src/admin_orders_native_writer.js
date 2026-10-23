(() => {
  'use strict';

  function addNativeWriters() {
    document.querySelectorAll('.ov3-copy[data-copy]').forEach((copyButton) => {
      const tag = copyButton.closest('.ov3-tag');
      if (!tag || tag.querySelector('.ov3-native-write')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ov3-copy ov3-native-write';
      button.textContent = 'Write NFC';
      button.addEventListener('click', () => {
        const raw = String(copyButton.dataset.copy || '').trim();
        if (!raw) return;
        const url = /^https:\/\//i.test(raw) ? raw : `https://${raw}`;
        window.location.href = `saidhere://write-nfc?value=${encodeURIComponent(url)}`;
      });
      tag.appendChild(button);
    });
  }

  function updateOrderProgress(order) {
    if (!order) return;
    const checkboxes = [...order.querySelectorAll('.ov3-tag-form input[type="checkbox"]')];
    const total = checkboxes.length;
    const tagged = checkboxes.filter((checkbox) => checkbox.checked).length;
    const summaryCells = order.querySelectorAll(':scope > summary .ov3-summary-cell');
    const taggedCell = summaryCells[1]?.querySelector('b');
    if (taggedCell) taggedCell.textContent = `${tagged}/${total}`;

    const ship = order.querySelector('.ov3-ship');
    const shipButton = order.querySelector('.ov3-ship-button');
    const title = ship?.querySelector('div > b');
    const help = ship?.querySelector('div > span');
    const ready = total > 0 && tagged === total;
    if (title) title.textContent = ready ? 'Ready to ship' : `${tagged} of ${total} tagged`;
    if (help) {
      help.textContent = ready
        ? 'All NFC tags are confirmed. Ship the complete order together.'
        : 'Tick each Wall after you physically write its NFC tag.';
    }
    if (shipButton) shipButton.disabled = !ready;
  }

  // Intercept the original checkbox submit before the older page listener sees it.
  // This keeps the <details> order expanded while the fulfilment operator works down it.
  document.addEventListener('change', async (event) => {
    const checkbox = event.target.closest?.('.ov3-tag-form input[type="checkbox"]');
    if (!checkbox) return;
    event.stopImmediatePropagation();

    const form = checkbox.closest('form');
    const order = checkbox.closest('.ov3-order');
    if (!form) return;
    const previous = !checkbox.checked;
    const taggedInput = form.querySelector('input[name="tagged"]');
    if (taggedInput) taggedInput.value = checkbox.checked ? 'true' : 'false';
    checkbox.disabled = true;

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (taggedInput) taggedInput.value = checkbox.checked ? 'false' : 'true';
      updateOrderProgress(order);
    } catch (_) {
      checkbox.checked = previous;
      if (taggedInput) taggedInput.value = checkbox.checked ? 'false' : 'true';
      window.alert('Could not save Tagged status. Refresh Orders and try again.');
    } finally {
      checkbox.disabled = false;
    }
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addNativeWriters, { once: true });
  } else {
    addNativeWriters();
  }
})();
