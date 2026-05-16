// Tower of Hanoi — drag or click to move disks.
// Exports window.HanoiGame = { name, mount(container, ui), unmount() }.

(function () {
  // ---- knobs ----
  const DISK_H = 14;
  const POLE_W = 2;
  const BASE_THICK = 2;

  const ANIM_UP = 130;
  const ANIM_ACROSS = 180;
  const ANIM_DOWN = 130;
  const ANIM_TOTAL = ANIM_UP + ANIM_ACROSS + ANIM_DOWN;
  const LIFT_HEIGHT = 80;            // how high the disk arcs above its peak

  const DRAG_THRESHOLD = 4;          // px of cursor motion before a press becomes a drag
  const HINT_DURATION = 1500;
  const HINT_PULSE_PERIOD = 800;
  const MAX_HINTS = 3;

  const SHAKE_DURATION = 250;
  const SHAKE_AMP = 4;

  const WIN_PULSE_DURATION = 400;

  const RESET_CONFIRM_THRESHOLD = 5; // moves before reset asks for confirmation
  const NUDGE_AFTER_MS = 180000;

  // storage keys
  const STORE_DISKS = 'hanoi.disks';
  const STORE_MODE  = 'hanoi.mode';
  const STORE_BEST  = (n) => `hanoi.best.${n}`;
  const STORE_BEST_TIME = (n) => `hanoi.bestTime.${n}`;

  // ---- module state ----
  let container = null, ui = null;
  let topControlsEl, statsEl;
  let wrap, canvas, ctx, dpr;
  let canvasW = 320, canvasH = 200;
  let baseY;                          // y of the platform top
  let labelY;

  let disksSelectEl, modeFreeBtn, modeOptBtn;

  let diskCount = 5;
  let mode = 'optimal';               // 'free' | 'optimal'

  let towers;                         // [stack, stack, stack] — bottom..top, sizes
  let moves = 0;
  let history = [];                   // committed move records, for undo

  let selected = null;                // tower idx of click-selected
  let drag = null;                    // { tower, started, x, y, originX, originY, disk }

  let anim = null;                    // { disk, fromTower, toTower, fromX, fromY, toX, toY, start }
  let shakeUntil = 0;
  let shakeOriginTower = -1;          // tower whose held disk should shake
  let winPulseStart = 0;

  let hintsUsed = 0;
  let didHint = false;
  let hintHighlight = null;           // { from, to, until }

  let timerStart = null;              // performance.now() of first move
  let elapsedMs = 0;                  // accumulated playing time
  let won = false;
  let isResetConfirming = false;

  let rafId = null;
  let lastFrame = null;

  let nudgeHandle = null;

  // listeners
  let keyHandler = null;
  let visHandler = null;
  let mouseDownH = null, mouseMoveH = null, mouseUpH = null;
  let touchStartH = null, touchMoveH = null, touchEndH = null;

  // ---------- persistence ----------

  function loadInt(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      if (v == null) return fallback == null ? null : fallback;
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : (fallback == null ? null : fallback);
    } catch (_) { return fallback == null ? null : fallback; }
  }
  function saveInt(key, val) { try { localStorage.setItem(key, String(val)); } catch (_) {} }
  function loadStr(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : v; }
    catch (_) { return fallback; }
  }
  function saveStr(key, val) { try { localStorage.setItem(key, val); } catch (_) {} }

  // ---------- geometry ----------

  function diskWidth(size)   { return 20 + 10 * size; }
  function towerCenterX(idx) { return canvasW * (0.2 + 0.3 * idx); }
  function diskColor(size)   {
    const hue = (size / Math.max(1, diskCount)) * 280;
    return `hsl(${hue}, 60%, 55%)`;
  }
  function diskYAt(stackPos) { return baseY - (stackPos + 1) * DISK_H; }

  function towerAtX(x) {
    if (x < canvasW * 0.333) return 0;
    if (x < canvasW * 0.667) return 1;
    return 2;
  }

  function isValidMove(from, to) {
    if (from === to) return false;
    if (towers[from].length === 0) return false;
    if (towers[to].length === 0) return true;
    const moving = towers[from][towers[from].length - 1];
    const top    = towers[to][towers[to].length - 1];
    return moving < top;
  }

  // ---------- state transitions ----------

  function buildInitialTowers() {
    const t = [[], [], []];
    for (let s = diskCount; s >= 1; s--) t[0].push(s);
    return t;
  }

  function fullReset() {
    towers = buildInitialTowers();
    moves = 0;
    history = [];
    selected = null;
    drag = null;
    anim = null;
    shakeUntil = 0;
    hintsUsed = 0;
    didHint = false;
    hintHighlight = null;
    timerStart = null;
    elapsedMs = 0;
    won = false;
    winPulseStart = 0;
    isResetConfirming = false;
    refresh();
  }

  function tryReset() {
    if (won || moves < RESET_CONFIRM_THRESHOLD) {
      fullReset();
      return;
    }
    isResetConfirming = true;
    refresh();
  }

  function cancelResetConfirm() {
    isResetConfirming = false;
    refresh();
  }

  function setMode(next) {
    if (mode === next) return;
    mode = next;
    saveStr(STORE_MODE, mode);
    refreshSeg();
    updateStats();
  }

  function refreshSeg() {
    if (!modeFreeBtn || !modeOptBtn) return;
    modeFreeBtn.classList.toggle('active', mode === 'free');
    modeOptBtn.classList.toggle('active', mode === 'optimal');
  }

  // ---------- moves ----------

  function attemptMove(from, to) {
    if (anim) return;
    if (from === to) {
      // tap on the same selected tower → deselect
      if (selected === from) selected = null;
      return;
    }
    if (!isValidMove(from, to)) {
      shakeUntil = performance.now() + SHAKE_DURATION;
      shakeOriginTower = from;
      return;
    }
    commitMove(from, to, true);
  }

  function commitMove(from, to, recordHistory) {
    const stack = towers[from];
    const disk = stack[stack.length - 1];
    const fromY = diskYAt(stack.length - 1);
    stack.pop();
    const toY = diskYAt(towers[to].length); // landing slot index = current length

    anim = {
      disk,
      fromTower: from,
      toTower: to,
      fromX: towerCenterX(from),
      fromY,
      toX: towerCenterX(to),
      toY,
      start: performance.now(),
    };

    if (timerStart == null) timerStart = performance.now();
    moves++;
    if (recordHistory) history.push({ from, to });
    selected = null;
    drag = null;
    refresh();
  }

  function undo() {
    if (anim || won) return;
    if (history.length === 0) return;
    const last = history.pop();
    // animate reverse — and DO NOT push to history (so undo isn't free)
    const stack = towers[last.to];
    const disk = stack[stack.length - 1];
    const fromY = diskYAt(stack.length - 1);
    stack.pop();
    const toY = diskYAt(towers[last.from].length);

    anim = {
      disk,
      fromTower: last.to,
      toTower: last.from,
      fromX: towerCenterX(last.to),
      fromY,
      toX: towerCenterX(last.from),
      toY,
      start: performance.now(),
    };
    if (timerStart == null) timerStart = performance.now();
    moves++;
    selected = null;
    drag = null;
    refresh();
  }

  function finishAnim() {
    if (!anim) return;
    towers[anim.toTower].push(anim.disk);
    anim = null;
    if (towers[2].length === diskCount) onWin();
    refresh();
  }

  function onWin() {
    won = true;
    winPulseStart = performance.now();
    // bake final elapsed
    if (timerStart != null) {
      elapsedMs += performance.now() - timerStart;
      timerStart = null;
    }
    // best moves
    const bestMoves = loadInt(STORE_BEST(diskCount));
    if (bestMoves == null || moves < bestMoves) saveInt(STORE_BEST(diskCount), moves);
    // best time
    const bestTime = loadInt(STORE_BEST_TIME(diskCount));
    if (bestTime == null || elapsedMs < bestTime) saveInt(STORE_BEST_TIME(diskCount), Math.round(elapsedMs));
  }

  // ---------- optimal solver ----------
  // Returns the next optimal move ({from,to}) from the current state to all-on-tower-2,
  // even if the player has wandered off the optimal path.

  function whereIs(t, size) {
    for (let i = 0; i < 3; i++) if (t[i].includes(size)) return i;
    return -1;
  }

  function optimalMove(t, n, target) {
    if (n <= 0) return null;
    const src = whereIs(t, n);
    if (src === target) return optimalMove(t, n - 1, target);
    const aux = 3 - src - target;
    let allOnAux = true;
    for (let d = 1; d < n; d++) {
      if (whereIs(t, d) !== aux) { allOnAux = false; break; }
    }
    if (allOnAux) return { from: src, to: target };
    return optimalMove(t, n - 1, aux);
  }

  function hint() {
    if (anim || won) return;
    if (hintsUsed >= MAX_HINTS) return;
    const m = optimalMove(towers, diskCount, 2);
    if (!m) return;
    hintsUsed++;
    didHint = true;
    hintHighlight = { from: m.from, to: m.to, until: performance.now() + HINT_DURATION };
    refresh();
  }

  // ---------- input ----------

  function eventXY(e) {
    const rect = canvas.getBoundingClientRect();
    let cx, cy;
    if (e.touches && e.touches[0]) {
      cx = e.touches[0].clientX; cy = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches[0]) {
      cx = e.changedTouches[0].clientX; cy = e.changedTouches[0].clientY;
    } else {
      cx = e.clientX; cy = e.clientY;
    }
    return {
      x: (cx - rect.left) * (canvasW / rect.width),
      y: (cy - rect.top)  * (canvasH / rect.height),
    };
  }

  function onPressStart(p) {
    if (anim || won) return;
    if (isResetConfirming) return;
    const tower = towerAtX(p.x);
    drag = {
      tower,
      started: false,
      startX: p.x, startY: p.y,
      x: p.x, y: p.y,
      disk: towers[tower].length ? towers[tower][towers[tower].length - 1] : null,
    };
  }

  function onPressMove(p) {
    if (!drag) return;
    drag.x = p.x; drag.y = p.y;
    if (!drag.started) {
      const dx = p.x - drag.startX;
      const dy = p.y - drag.startY;
      if (dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD) {
        // upgrade press to drag — but only if the source tower has a disk
        if (drag.disk != null) drag.started = true;
      }
    }
  }

  function onPressEnd(p) {
    if (!drag) return;
    const fromTower = drag.tower;
    const draggedDisk = drag.disk;
    const wasStarted = drag.started;
    drag = null;

    if (anim || won || isResetConfirming) return;

    if (wasStarted && draggedDisk != null) {
      // drop — find tower under cursor
      const dropTower = towerAtX(p.x);
      if (dropTower === fromTower) {
        // dragged but back to source — treat as a no-op (deselect)
        selected = null;
      } else {
        attemptMove(fromTower, dropTower);
      }
      refresh();
      return;
    }

    // click path
    if (selected == null) {
      // pick up only if there's something to pick up
      if (towers[fromTower].length > 0) selected = fromTower;
    } else if (selected === fromTower) {
      selected = null;
    } else {
      attemptMove(selected, fromTower);
    }
    refresh();
  }

  function onMouseDown(e) {
    e.preventDefault();
    onPressStart(eventXY(e));
  }
  function onMouseMove(e) {
    if (!drag) return;
    onPressMove(eventXY(e));
  }
  function onMouseUp(e) {
    if (!drag) return;
    onPressEnd(eventXY(e));
  }
  function onTouchStart(e) {
    e.preventDefault();
    onPressStart(eventXY(e));
  }
  function onTouchMove(e) {
    if (!drag) return;
    e.preventDefault();
    onPressMove(eventXY(e));
  }
  function onTouchEnd(e) {
    if (!drag) return;
    e.preventDefault();
    onPressEnd(eventXY(e));
  }

  function towerForKey(k) {
    if (k === '1' || k === 'a' || k === 'A') return 0;
    if (k === '2' || k === 'b' || k === 'B') return 1;
    if (k === '3' || k === 'c' || k === 'C') return 2;
    return -1;
  }

  function onKey(e) {
    if (anim || won) return;
    if (isResetConfirming) return;
    const t = towerForKey(e.key);
    if (t < 0) return;
    e.preventDefault();
    if (selected == null) {
      if (towers[t].length > 0) selected = t;
    } else if (selected === t) {
      selected = null;
    } else {
      attemptMove(selected, t);
    }
    refresh();
  }

  function onVisibility() {
    if (document.hidden) {
      // pause timer
      if (timerStart != null && !won) {
        elapsedMs += performance.now() - timerStart;
        timerStart = null;
      }
    }
    // when visible again, timer resumes on next move (per spec, "starts on first move").
    // Cleaner: resume immediately if there have been moves already.
    else if (moves > 0 && !won && timerStart == null) {
      timerStart = performance.now();
    }
  }

  // ---------- drawing ----------

  function drawBg() {
    ctx.clearRect(0, 0, canvasW, canvasH);
  }

  function drawTowersAndDisks() {
    // bases
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    for (let i = 0; i < 3; i++) {
      const cx = towerCenterX(i);
      const baseW = Math.min(110, canvasW * 0.30);
      ctx.fillRect(cx - baseW / 2, baseY, baseW, BASE_THICK);
    }

    // poles
    for (let i = 0; i < 3; i++) {
      const cx = towerCenterX(i);
      // hint highlight on the pole?
      let strokeColor = 'rgba(255,255,255,0.10)';
      if (selected === i) strokeColor = 'rgba(127,119,221,0.55)';
      ctx.fillStyle = strokeColor;
      ctx.fillRect(Math.round(cx - POLE_W / 2), 30, POLE_W, baseY - 30);
    }

    // valid-drop indicator: faint goal glow on poles that accept the held disk
    const heldDisk = (drag && drag.started && drag.disk != null) ? drag.disk
                    : (selected != null && towers[selected].length > 0)
                      ? towers[selected][towers[selected].length - 1]
                      : null;
    if (heldDisk != null) {
      for (let i = 0; i < 3; i++) {
        if (i === (drag && drag.started ? drag.tower : selected)) continue;
        const accept = towers[i].length === 0 || towers[i][towers[i].length - 1] > heldDisk;
        if (!accept) continue;
        const cx = towerCenterX(i);
        const pulse = 0.4 + 0.3 * Math.sin(performance.now() / 300);
        ctx.fillStyle = `rgba(151, 196, 89, ${pulse * 0.5})`;
        ctx.fillRect(Math.round(cx - POLE_W * 1.5), 30, POLE_W * 3, baseY - 30);
      }
    }

    // hint highlights on bases
    if (hintHighlight) {
      const t = performance.now();
      const remaining = hintHighlight.until - t;
      if (remaining <= 0) {
        hintHighlight = null;
      } else {
        const fade = Math.min(1, remaining / HINT_DURATION);
        const pulse = 0.5 + 0.5 * Math.sin(t / HINT_PULSE_PERIOD * Math.PI * 2);
        const alpha = fade * (0.35 + 0.45 * pulse);
        const baseW = Math.min(110, canvasW * 0.30);
        // source tower — accent
        let cx = towerCenterX(hintHighlight.from);
        ctx.strokeStyle = `rgba(127, 119, 221, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(cx - baseW / 2, baseY - 1, baseW, BASE_THICK + 2);
        // dest tower — goal
        cx = towerCenterX(hintHighlight.to);
        ctx.strokeStyle = `rgba(151, 196, 89, ${alpha})`;
        ctx.strokeRect(cx - baseW / 2, baseY - 1, baseW, BASE_THICK + 2);
      }
    }

    // disks (excluding the held/dragged top disk if applicable, and excluding anim disk)
    const draggedTower = (drag && drag.started) ? drag.tower : -1;
    const selectedTower = (selected != null) ? selected : -1;

    for (let i = 0; i < 3; i++) {
      const stack = towers[i];
      const cx = towerCenterX(i);
      let drawCount = stack.length;
      // when dragging from this tower, skip the top disk (rendered following cursor)
      if (i === draggedTower) drawCount = Math.max(0, stack.length - 1);

      for (let s = 0; s < drawCount; s++) {
        const size = stack[s];
        // selected tower's top disk lifts
        let yLift = 0;
        let scale = 1;
        if (i === selectedTower && s === stack.length - 1 && draggedTower !== i) {
          yLift = -30;
          // pulse 1.0..1.03 over 800ms
          const ph = (performance.now() / 800) * Math.PI * 2;
          scale = 1.0 + 0.015 + Math.sin(ph) * 0.015;
        }
        // shake on invalid attempt for the held disk
        let shakeDx = 0;
        if (i === selectedTower && s === stack.length - 1 && performance.now() < shakeUntil) {
          const t = (shakeUntil - performance.now()) / SHAKE_DURATION;
          shakeDx = Math.sin(t * Math.PI * 8) * SHAKE_AMP;
        }
        // win pulse on every disk on the goal tower
        if (won && i === 2 && performance.now() - winPulseStart < WIN_PULSE_DURATION) {
          const t = (performance.now() - winPulseStart) / WIN_PULSE_DURATION;
          const p = t < 0.5 ? (t / 0.5) : (1 - (t - 0.5) / 0.5);
          scale = 1.0 + p * 0.05;
        }
        drawDisk(size, cx + shakeDx, diskYAt(s) + yLift, scale);
      }
    }

    // dragged disk follows cursor
    if (drag && drag.started && drag.disk != null) {
      drawDisk(drag.disk, drag.x, drag.y - DISK_H / 2, 1.0);
    }

    // animating disk
    if (anim) {
      const pos = animPosition(performance.now());
      drawDisk(anim.disk, pos.x, pos.y, 1.0);
    }

    // tower labels
    ctx.fillStyle = 'rgba(138, 138, 147, 0.9)';
    ctx.textAlign = 'center';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('A', towerCenterX(0), labelY);
    ctx.fillText('B', towerCenterX(1), labelY);
    ctx.fillText('C', towerCenterX(2), labelY);
  }

  function drawDisk(size, cx, topY, scale) {
    const w = diskWidth(size) * scale;
    const h = DISK_H * scale;
    const x = cx - w / 2;
    const y = topY + (DISK_H - h) / 2;
    ctx.fillStyle = diskColor(size);
    roundedRectPath(x, y, w, h, 4);
    ctx.fill();
    // highlight stripe on top
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.fillRect(x + 2, y + 1, w - 4, 1);
  }

  function roundedRectPath(x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function easeOut(t) { return 1 - (1 - t) * (1 - t); }
  function easeIn (t) { return t * t; }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function animPosition(now) {
    const t = now - anim.start;
    const peakY = Math.min(anim.fromY, anim.toY) - LIFT_HEIGHT;
    if (t < ANIM_UP) {
      const p = easeOut(t / ANIM_UP);
      return { x: anim.fromX, y: anim.fromY + (peakY - anim.fromY) * p };
    }
    if (t < ANIM_UP + ANIM_ACROSS) {
      const p = easeInOut((t - ANIM_UP) / ANIM_ACROSS);
      return { x: anim.fromX + (anim.toX - anim.fromX) * p, y: peakY };
    }
    if (t < ANIM_TOTAL) {
      const p = easeIn((t - ANIM_UP - ANIM_ACROSS) / ANIM_DOWN);
      return { x: anim.toX, y: peakY + (anim.toY - peakY) * p };
    }
    return { x: anim.toX, y: anim.toY };
  }

  // ---------- main loop ----------

  function frame(now) {
    if (lastFrame == null) lastFrame = now;
    lastFrame = now;

    // animation completion
    if (anim && now - anim.start >= ANIM_TOTAL) finishAnim();

    drawBg();
    drawTowersAndDisks();

    updateStats();
    rafId = requestAnimationFrame(frame);
  }

  // ---------- stats / controls ----------

  function fmtTime(ms) {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function currentElapsed() {
    if (won) return elapsedMs;
    if (timerStart == null) return elapsedMs;
    if (document.hidden) return elapsedMs;
    return elapsedMs + (performance.now() - timerStart);
  }

  function updateStats() {
    if (!statsEl) return;
    const optimalCount = Math.pow(2, diskCount) - 1;
    const bestMoves = loadInt(STORE_BEST(diskCount));
    const bestTime  = loadInt(STORE_BEST_TIME(diskCount));

    let html = '';
    if (won) {
      const ok = mode === 'optimal' && moves === optimalCount && !didHint;
      const newBestMoves = bestMoves == null || moves < bestMoves || (bestMoves != null && moves === bestMoves && (bestTime == null || elapsedMs < bestTime));
      // simpler: new best on moves
      const isNewMovesBest = bestMoves == null || moves <= bestMoves;
      html += `<span class="goal">Solved in ${moves} moves · ${fmtTime(elapsedMs)}</span>`;
      if (ok) html += ` <span class="goal">· \u2728 Optimal!</span>`;
      if (isNewMovesBest && bestMoves != null && moves < bestMoves) {
        html += ` <span class="goal">· \u{1F3AF} New best!</span>`;
      } else if (bestMoves == null) {
        html += ` <span class="goal">· \u{1F3AF} New best!</span>`;
      }
    } else {
      const movesPart = (mode === 'optimal')
        ? `<span class="accent">Moves: ${moves} / ${optimalCount}</span>`
        : `<span class="accent">Moves: ${moves}</span>`;
      const timePart  = `Time: ${fmtTime(currentElapsed())}`;
      let bestPart = '';
      if (bestMoves != null) {
        bestPart = `Best: ${bestMoves}` + (bestTime != null ? ` (${fmtTime(bestTime)})` : '');
      }
      html = [movesPart, timePart, bestPart].filter(Boolean).join(' &nbsp;\u00B7&nbsp; ');
    }
    statsEl.innerHTML = html;
  }

  function refresh() {
    updateStats();
    refreshSeg();
    if (disksSelectEl) disksSelectEl.value = String(diskCount);

    if (isResetConfirming) {
      ui.setControls([
        { type: 'button', label: 'Reset puzzle?', disabled: true },
        { type: 'button', label: 'No', onClick: cancelResetConfirm },
        { type: 'button', label: 'Yes, reset', onClick: () => { isResetConfirming = false; fullReset(); } },
      ]);
      ui.setSubtitle(`${diskCount} disks · ${mode === 'optimal' ? 'optimal' : 'free'}`);
      ui.setStatus(`Hanoi`);
      return;
    }

    if (won) {
      ui.setControls([
        { type: 'button', label: 'Play again', onClick: fullReset },
      ]);
      ui.setSubtitle(`Solved!`);
      ui.setStatus(`Solved · ${moves}`);
      ui.setStatusWin(true);
      return;
    }

    ui.setStatusWin(false);
    ui.setControls([
      { type: 'button', label: 'Reset', onClick: tryReset },
      {
        type: 'button',
        label: 'Undo',
        onClick: undo,
        disabled: history.length === 0 || !!anim,
      },
      {
        type: 'button',
        label: hintsUsed >= MAX_HINTS ? 'Hint (0 left)' : `Hint (${MAX_HINTS - hintsUsed} left)`,
        onClick: hint,
        disabled: hintsUsed >= MAX_HINTS || !!anim,
        title: hintsUsed >= MAX_HINTS ? 'no more hints' : '',
      },
    ]);
    ui.setSubtitle(`${diskCount} disks · ${mode === 'optimal' ? 'optimal' : 'free'}`);
    ui.setStatus(`Moves: ${moves}`);
  }

  // ---------- skeleton build ----------

  function buildSkeleton() {
    // top controls
    topControlsEl = document.createElement('div');
    topControlsEl.className = 'hanoi-controls';

    const disksLabel = document.createElement('span');
    disksLabel.className = 'hanoi-label';
    disksLabel.textContent = 'Disks:';
    topControlsEl.appendChild(disksLabel);

    disksSelectEl = document.createElement('select');
    for (let i = 3; i <= 7; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = String(i);
      if (i === diskCount) opt.selected = true;
      disksSelectEl.appendChild(opt);
    }
    disksSelectEl.addEventListener('change', () => {
      diskCount = parseInt(disksSelectEl.value, 10);
      saveStr(STORE_DISKS, String(diskCount));
      fullReset();
    });
    topControlsEl.appendChild(disksSelectEl);

    const modeLabel = document.createElement('span');
    modeLabel.className = 'hanoi-label';
    modeLabel.style.marginLeft = '6px';
    modeLabel.textContent = 'Mode:';
    topControlsEl.appendChild(modeLabel);

    const seg = document.createElement('div');
    seg.className = 'hanoi-seg';
    modeFreeBtn = document.createElement('button');
    modeFreeBtn.className = 'hanoi-seg-btn';
    modeFreeBtn.textContent = 'Free';
    modeFreeBtn.addEventListener('click', () => setMode('free'));
    modeOptBtn = document.createElement('button');
    modeOptBtn.className = 'hanoi-seg-btn';
    modeOptBtn.textContent = 'Optimal';
    modeOptBtn.addEventListener('click', () => setMode('optimal'));
    seg.appendChild(modeFreeBtn);
    seg.appendChild(modeOptBtn);
    topControlsEl.appendChild(seg);

    container.appendChild(topControlsEl);

    // stats line
    statsEl = document.createElement('div');
    statsEl.className = 'hanoi-stats';
    container.appendChild(statsEl);

    // canvas wrap + canvas
    wrap = document.createElement('div');
    wrap.className = 'hanoi-wrap';
    container.appendChild(wrap);

    canvas = document.createElement('canvas');
    canvas.className = 'hanoi-canvas';
    wrap.appendChild(canvas);

    // size canvas to wrap width with sane caps
    const measured = wrap.clientWidth || 320;
    canvasW = Math.max(280, Math.min(340, measured));
    canvasH = 200;
    baseY = canvasH - 30;
    labelY = canvasH - 8;

    dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(canvasW * dpr);
    canvas.height = Math.round(canvasH * dpr);
    canvas.style.width  = canvasW + 'px';
    canvas.style.height = canvasH + 'px';
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
  }

  // ---------- mount / unmount ----------

  function mount(c, u) {
    container = c;
    ui = u;

    // load preferences
    const dcRaw = loadStr(STORE_DISKS, '5');
    const dcParsed = parseInt(dcRaw, 10);
    diskCount = Number.isFinite(dcParsed) && dcParsed >= 3 && dcParsed <= 7 ? dcParsed : 5;
    const m = loadStr(STORE_MODE, 'optimal');
    mode = (m === 'free' || m === 'optimal') ? m : 'optimal';

    container.innerHTML = '';
    buildSkeleton();
    refreshSeg();

    // init game state
    fullReset();

    // listeners
    keyHandler = onKey;
    visHandler = onVisibility;
    mouseDownH = onMouseDown;
    mouseMoveH = onMouseMove;
    mouseUpH = onMouseUp;
    touchStartH = onTouchStart;
    touchMoveH = onTouchMove;
    touchEndH = onTouchEnd;

    document.addEventListener('keydown', keyHandler);
    document.addEventListener('visibilitychange', visHandler);
    canvas.addEventListener('mousedown', mouseDownH);
    window.addEventListener('mousemove', mouseMoveH);
    window.addEventListener('mouseup', mouseUpH);
    canvas.addEventListener('touchstart', touchStartH, { passive: false });
    window.addEventListener('touchmove', touchMoveH, { passive: false });
    window.addEventListener('touchend', touchEndH);
    window.addEventListener('touchcancel', touchEndH);

    if (NUDGE_AFTER_MS > 0 && window.VibeBreakNudge) {
      nudgeHandle = window.VibeBreakNudge.startNudge(wrap, { afterMs: NUDGE_AFTER_MS });
    }

    rafId = requestAnimationFrame(frame);
  }

  function unmount() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    lastFrame = null;

    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    if (visHandler) document.removeEventListener('visibilitychange', visHandler);
    if (canvas && mouseDownH) canvas.removeEventListener('mousedown', mouseDownH);
    if (mouseMoveH) window.removeEventListener('mousemove', mouseMoveH);
    if (mouseUpH)   window.removeEventListener('mouseup', mouseUpH);
    if (canvas && touchStartH) canvas.removeEventListener('touchstart', touchStartH);
    if (touchMoveH) window.removeEventListener('touchmove', touchMoveH);
    if (touchEndH)  {
      window.removeEventListener('touchend', touchEndH);
      window.removeEventListener('touchcancel', touchEndH);
    }
    keyHandler = visHandler = null;
    mouseDownH = mouseMoveH = mouseUpH = null;
    touchStartH = touchMoveH = touchEndH = null;

    if (nudgeHandle) { nudgeHandle.stop(); nudgeHandle = null; }

    if (container) container.innerHTML = '';
    container = null;
    ui = null;
    wrap = canvas = ctx = null;
    statsEl = topControlsEl = disksSelectEl = modeFreeBtn = modeOptBtn = null;
    towers = null;
    history = [];
    selected = null;
    drag = null;
    anim = null;
    hintHighlight = null;
  }

  window.HanoiGame = { name: 'Hanoi', mount, unmount };
})();
