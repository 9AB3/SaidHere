(() => {
  'use strict';

  const PENDING_KEY = 'saidhere:nfc-write-pending';
  let pageWasHiddenForWriter = false;

  function addNativeWriters(root = document) {
    root.querySelectorAll?.('.ov3-copy[data-copy]').forEach((copyButton) => {
      const item = copyButton.closest('.ov3-item');
      const actions = item?.querySelector('.ov3-item-actions');
      if (!item || !actions || actions.querySelector('.ov3-native-write')) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ov3-small ov3-native-write';
      button.textContent = 'Write NFC';
      button.setAttribute('aria-label', 'Write this Wall NFC tag with The Wall app');
      actions.prepend(button);
    });
  }

  function writerContext(button) {
    const item = button.closest('.ov3-item');
    if (!item) return null;
    const form = item.querySelector('.ov3-tag-form') || item.querySelector('form[action*="/items/"]');
    const action = String(form?.action || '');
    const match = action.match(/\/admin\/orders\/([^/]+)\/items\/([^/]+)\//i);
    const csrf = form?.querySelector('input[name="_csrf"]')?.value || '';
    if (!match || !csrf) return null;
    return {
      ticketUrl: `/admin/orders/${encodeURIComponent(match[1])}/items/${encodeURIComponent(match[2])}/write-ticket`,
      csrf,
    };
  }

  async function openNativeWriter(button) {
    const context = writerContext(button);
    if (!context) throw new Error('Could not identify this Wall fulfilment item. Refresh Orders and try again.');

    const response = await fetch(context.ticketUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: new URLSearchParams({ _csrf: context.csrf }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.deep_link) {
      throw new Error(data.error || `Could not start NFC writing (HTTP ${response.status}).`);
    }

    sessionStorage.setItem(PENDING_KEY, '1');
    pageWasHiddenForWriter = false;
    window.location.href = data.deep_link;
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
        : 'Write each NFC tag. Successful native writes are marked Tagged automatically.';
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

  document.addEventListener('click', async (event) => {
    const button = event.target.closest?.('.ov3-native-write');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = 'Opening…';
    try {
      await openNativeWriter(button);
    } catch (error) {
      console.error('[orders] NFC writer launch failed', error);
      button.disabled = false;
      button.textContent = oldText;
      window.alert(error?.message || 'Could not start NFC writing.');
    }
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

  document.addEventListener('visibilitychange', () => {
    if (sessionStorage.getItem(PENDING_KEY) !== '1') return;
    if (document.hidden) {
      pageWasHiddenForWriter = true;
      return;
    }
    if (!pageWasHiddenForWriter) return;
    sessionStorage.removeItem(PENDING_KEY);
    setTimeout(() => window.location.reload(), 350);
  });

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
