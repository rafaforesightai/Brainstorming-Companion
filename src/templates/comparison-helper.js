(function() {
  const WS_URL = 'ws://' + window.location.host;
  let ws = null;
  let eventQueue = [];
  let currentView = 'side-by-side';
  let activeSlot = null;
  let preferred = null;
  let slots = [];

  // -------------------------------------------------------------------------
  // WebSocket
  // -------------------------------------------------------------------------

  function connect() {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      document.getElementById('status').textContent = 'Connected';
      eventQueue.forEach(e => ws.send(JSON.stringify(e)));
      eventQueue = [];
    };
    ws.onmessage = (msg) => {
      let data;
      try { data = JSON.parse(msg.data); } catch { return; }

      if (data.type === 'reload') {
        // Reload all iframes
        reloadAllIframes();
      } else if (data.type === 'slot-content') {
        // Reload a specific slot iframe
        reloadSlotIframe(data.slot);
      } else if (data.type === 'slots-update') {
        // Re-initialize slots
        if (data.slots) initSlots(data.slots);
      }
    };
    ws.onclose = () => {
      document.getElementById('status').textContent = 'Reconnecting…';
      setTimeout(connect, 1000);
    };
    ws.onerror = () => {
      document.getElementById('status').textContent = 'Disconnected';
    };
  }

  function sendEvent(event) {
    event.timestamp = Date.now();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    } else {
      eventQueue.push(event);
    }
  }

  // -------------------------------------------------------------------------
  // Iframe helpers
  // -------------------------------------------------------------------------

  function reloadAllIframes() {
    slots.forEach(s => reloadSlotIframe(s.id));
  }

  function reloadSlotIframe(slotId) {
    const iframe = document.getElementById('iframe-' + slotId);
    if (iframe) {
      iframe.src = '/slot/' + slotId + '?t=' + Date.now();
    }
  }

  // -------------------------------------------------------------------------
  // Slot initialization
  // -------------------------------------------------------------------------

  function initSlots(newSlots) {
    slots = newSlots;
    buildTabBar();
    buildPanels();
    buildPrefButtons();

    if (slots.length > 0) {
      if (!activeSlot || !slots.find(s => s.id === activeSlot)) {
        activeSlot = slots[0].id;
      }
      applyView();
      updateTabHighlight();
    }
  }

  function buildTabBar() {
    const tabBar = document.getElementById('tab-bar');
    tabBar.innerHTML = '';
    slots.forEach((slot, i) => {
      const btn = document.createElement('button');
      btn.className = 'tab' + (slot.id === activeSlot ? ' active' : '');
      btn.dataset.slot = slot.id;
      btn.innerHTML =
        '<span class="slot-letter">' + slot.id.toUpperCase() + '</span>' +
        (slot.label ? '<span class="slot-label">' + escapeHtml(slot.label) + '</span>' : '');
      btn.title = 'Slot ' + slot.id.toUpperCase() + (slot.label ? ' — ' + slot.label : '') + ' (key: ' + (i + 1) + ' or ' + slot.id + ')';
      btn.addEventListener('click', () => switchSlot(slot.id));
      tabBar.appendChild(btn);
    });
  }

  function buildPanels() {
    const panelsEl = document.getElementById('panels');
    panelsEl.innerHTML = '';
    slots.forEach(slot => {
      const panel = document.createElement('div');
      panel.className = 'panel';
      panel.id = 'panel-' + slot.id;

      const header = document.createElement('div');
      header.className = 'panel-header';
      header.textContent = 'Slot ' + slot.id.toUpperCase() + (slot.label ? ' — ' + slot.label : '');

      const iframe = document.createElement('iframe');
      iframe.id = 'iframe-' + slot.id;
      iframe.src = '/slot/' + slot.id;
      iframe.title = 'Slot ' + slot.id.toUpperCase();

      panel.appendChild(header);
      panel.appendChild(iframe);
      panelsEl.appendChild(panel);
    });
  }

  function buildPrefButtons() {
    const bar = document.getElementById('preference-bar');
    // Remove old pref buttons (keep the label span and keyboard hint)
    const oldBtns = bar.querySelectorAll('.pref-btn, .pref-result');
    oldBtns.forEach(el => el.remove());

    // Insert buttons after the label span
    const label = bar.querySelector('span');
    slots.forEach(slot => {
      const btn = document.createElement('button');
      btn.className = 'pref-btn' + (preferred === slot.id ? ' selected' : '');
      btn.dataset.slot = slot.id;
      btn.textContent = slot.id.toUpperCase() + (slot.label ? ' — ' + slot.label : '');
      btn.addEventListener('click', () => setPreferred(slot.id));
      label.after(btn);
      label.parentNode.insertBefore(btn, label.nextSibling);
    });
  }

  // -------------------------------------------------------------------------
  // View / slot switching
  // -------------------------------------------------------------------------

  function switchSlot(slotId) {
    activeSlot = slotId;
    updateTabHighlight();
    if (currentView === 'single') {
      applyView();
    }
    sendEvent({ type: 'tab-switch', slot: slotId });
  }

  function switchToSlotByIndex(index) {
    if (index >= 0 && index < slots.length) {
      switchSlot(slots[index].id);
    }
  }

  function updateTabHighlight() {
    document.querySelectorAll('#tab-bar .tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.slot === activeSlot);
    });
  }

  function setView(mode) {
    currentView = mode;
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === mode);
    });
    applyView();
    sendEvent({ type: 'view-change', mode });
  }

  function toggleView() {
    setView(currentView === 'side-by-side' ? 'single' : 'side-by-side');
  }

  function applyView() {
    if (currentView === 'side-by-side') {
      document.querySelectorAll('#panels .panel').forEach(panel => {
        panel.classList.remove('hidden');
      });
    } else {
      // Single view: show only active slot
      document.querySelectorAll('#panels .panel').forEach(panel => {
        const isActive = panel.id === 'panel-' + activeSlot;
        panel.classList.toggle('hidden', !isActive);
      });
    }
  }

  function setPreferred(slotId) {
    preferred = slotId;
    document.querySelectorAll('.pref-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.slot === slotId);
    });

    // Show result text
    const bar = document.getElementById('preference-bar');
    let resultEl = bar.querySelector('.pref-result');
    if (!resultEl) {
      resultEl = document.createElement('div');
      resultEl.className = 'pref-result';
      const hint = bar.querySelector('.keyboard-hint');
      if (hint) bar.insertBefore(resultEl, hint);
      else bar.appendChild(resultEl);
    }
    const slot = slots.find(s => s.id === slotId);
    const label = slot && slot.label ? slot.label : 'Slot ' + slotId.toUpperCase();
    resultEl.textContent = label + ' preferred — return to terminal to continue';

    sendEvent({ type: 'preference', choice: slotId, label });
  }

  // -------------------------------------------------------------------------
  // Keyboard shortcuts
  // -------------------------------------------------------------------------

  document.addEventListener('keydown', (e) => {
    // Don't intercept when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'Tab') {
      e.preventDefault();
      toggleView();
      return;
    }
    if (e.key >= '1' && e.key <= '9') {
      switchToSlotByIndex(parseInt(e.key, 10) - 1);
      return;
    }
    const lower = e.key.toLowerCase();
    if ('abcdefghijklmnopqrstuvwxyz'.includes(lower) && lower.length === 1) {
      if (slots.find(s => s.id === lower)) {
        switchSlot(lower);
      }
    }
  });

  // -------------------------------------------------------------------------
  // View toggle buttons
  // -------------------------------------------------------------------------

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-btn');
    if (btn) setView(btn.dataset.view);
  });

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // -------------------------------------------------------------------------
  // Boot: fetch slots from /api/status, then connect WebSocket
  // -------------------------------------------------------------------------

  fetch('/api/status')
    .then(r => r.json())
    .then(data => {
      if (data.slots && data.slots.length > 0) {
        initSlots(data.slots);
      }
    })
    .catch(() => {});

  connect();
})();
