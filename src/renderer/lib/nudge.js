// Shared "still vibe-coding?" toast utility.
//
// The original codebase loads scripts via plain <script> tags rather than
// ES modules, so the public surface is exposed as window.VibeBreakNudge.
// Use it from any game module like:
//
//   const { startNudge } = window.VibeBreakNudge;
//   const handle = startNudge(wrapEl, { afterMs: 180000 });
//   // ...
//   handle.stop();
//
// `wrapEl` should be a positioned (position: relative/absolute/etc.)
// container — the toast positions itself absolutely within it.

(function () {
  function startNudge(container, options) {
    const opts = options || {};
    const afterMs    = opts.afterMs    != null ? opts.afterMs    : 180000;
    const cooldownMs = opts.cooldownMs != null ? opts.cooldownMs : 180000;
    const visibleMs  = opts.visibleMs  != null ? opts.visibleMs  : 5000;
    const message    = opts.message    != null ? opts.message    : '\u{1F44B} still vibe-coding?';

    let activeMs = 0;
    let lastTickTs = null;
    let nextThreshold = afterMs;

    let toastEl = null;
    let hideTimer = null;
    let removeTimer = null;
    let rafId = null;
    let stopped = false;

    function tick(now) {
      if (stopped) return;
      if (lastTickTs != null && !document.hidden) {
        let dt = now - lastTickTs;
        if (dt > 1000) dt = 1000; // clamp tab-switch hiccups
        activeMs += dt;
        if (activeMs >= nextThreshold && !toastEl && container && container.isConnected) {
          showToast();
        }
      }
      lastTickTs = now;
      rafId = requestAnimationFrame(tick);
    }

    function showToast() {
      toastEl = document.createElement('div');
      toastEl.className = 'shared-nudge-toast';

      const msg = document.createElement('span');
      msg.className = 'message';
      msg.textContent = message + ' \u00B7 ';
      toastEl.appendChild(msg);

      const dismissBtn = document.createElement('span');
      dismissBtn.className = 'dismiss';
      dismissBtn.textContent = 'dismiss';
      dismissBtn.addEventListener('click', dismiss);
      toastEl.appendChild(dismissBtn);

      container.appendChild(toastEl);
      // next frame so the transition runs from the initial state
      requestAnimationFrame(() => {
        if (toastEl) toastEl.classList.add('show');
      });

      hideTimer = setTimeout(dismiss, visibleMs);
    }

    function dismiss() {
      if (hideTimer)   { clearTimeout(hideTimer);   hideTimer = null; }
      if (removeTimer) { clearTimeout(removeTimer); removeTimer = null; }
      if (!toastEl) return;

      const el = toastEl;
      toastEl = null;
      el.classList.remove('show');
      removeTimer = setTimeout(() => {
        if (el && el.parentNode) el.parentNode.removeChild(el);
        removeTimer = null;
      }, 280);

      nextThreshold = activeMs + cooldownMs;
    }

    function stop() {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      if (hideTimer)   { clearTimeout(hideTimer);   hideTimer = null; }
      if (removeTimer) { clearTimeout(removeTimer); removeTimer = null; }
      if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
      toastEl = null;
    }

    rafId = requestAnimationFrame(tick);

    return { stop };
  }

  window.VibeBreakNudge = { startNudge };
})();
