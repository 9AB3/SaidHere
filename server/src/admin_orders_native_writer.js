(() => {
  'use strict';

  function addNativeWriters(root = document) {
    root.querySelectorAll?.('.ov3-copy[data-copy]').forEach((copyButton) => {
      const item = copyButton.closest('.ov3-item');
      const actions = item?.querySelector('.ov3-item-actions');
      if (!item || !actions || actions.querySelector('.ov3-native-write')) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ov3-small ov3-native-write';
      button.textContent = 'Write NFC';
      button.dataset.write = String(copyButton.dataset.copy || '');
      button.setAttribute('aria-label', 'Write this Wall NFC tag with The Wall app');
      actions.prepend(button);
    });
  }

  function openNativeWriter(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) return;
    const url = /^https:\/\//i.test(raw) ? raw : `https://${raw}`;
    window.location.href = `saidhere://write-nfc?value=${encodeURIComponent(url)}`;
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

  function urlEncodedForm(form) {
    const params = new URLSearchParams();
    form.querySelectorAll('input[name]').forEach((input) => {
      if ((input.type === 'checkbox' || input.type === 'radio') && !input.checked) return;
      params.append(input.name, input.value);
    });
    return params;
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('.ov3-native-write');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const fallback = button.closest('.ov3-item')?.querySelector('.ov3-copy[data-copy]')?.dataset.copy || '';
    openNativeWriter(button.dataset.write || fallback);
  }, true);

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
        body: urlEncodedForm(form),
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (taggedInput) taggedInput.value = checkbox.checked ? 'false' : 'true';
      updateOrderProgress(order);
    } catch (error) {
      console.error('[orders] Tagged save failed', error);
      checkbox.checked = previous;
      if (taggedInput) taggedInput.value = checkbox.checked ? 'false' : 'true';
      updateOrderProgress(order);
      window.alert('Could not save Tagged status. Refresh Orders and try again.');
    } finally {
      checkbox.disabled = false;
    }
  }, true);

  addNativeWriters();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => addNativeWriters(), { once: true });
  }
  requestAnimationFrame(() => addNativeWriters());
  setTimeout(() => addNativeWriters(), 250);

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.addedNodes.length > 0)) addNativeWriters();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
