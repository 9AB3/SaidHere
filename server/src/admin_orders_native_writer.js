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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addNativeWriters, { once: true });
  } else {
    addNativeWriters();
  }
})();
