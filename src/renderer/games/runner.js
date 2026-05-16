// Runner — side-scrolling endless runner. Jump and duck to dodge.
// Exports window.RunnerGame = { name, mount(container, ui), unmount() }.

(function () {
  // ---- knobs ----
  const NUDGE_AFTER_MS = 180000;            // 3 min cumulative play before toast (set 0 to disable)
  const STORE_BEST = 'runner.best';

  const CANVAS_H = 240;
  const CANVAS_W_FALLBACK = 320;
  const GROUND_OFFSET = 40;                 // ground from bottom

  const PLAYER_X = 50;
  const PLAYER_W = 28;
  const PLAYER_H = 32;
  const DUCK_H = 16;

  const JUMP_VY = 12;                       // initial upward velocity
  const GRAVITY = 0.6;

  const START_SPEED = 4;
  const MAX_SPEED = 10;
  const SPEED_RAMP_PER_SEC = 0.05;

  const STEP = 1000 / 60;                   // fixed simulation step (ms)

  // ---- chunk library (hand-tuned) ----
  // Each chunk is an array of pieces { type, offset } where offset is
  // pixels from the chunk's leading edge. Difficulty 1..3 gates which
  // chunks are eligible for the current speed.
  const CHUNKS = [
    // ---- difficulty 1 (4) ----
    { d: 1, pieces: [{ type: 'low',  offset: 0 }] },
    { d: 1, pieces: [{ type: 'high', offset: 0 }] },
    { d: 1, pieces: [{ type: 'tall', offset: 0 }] },
    { d: 1, pieces: [{ type: 'low',  offset: 0 }, { type: 'low', offset: 220 }] },

    // ---- difficulty 2 (5) ----
    { d: 2, pieces: [{ type: 'double', offset: 0 }] },
    { d: 2, pieces: [{ type: 'low',  offset: 0 }, { type: 'high', offset: 300 }] },
    { d: 2, pieces: [{ type: 'high', offset: 0 }, { type: 'low',  offset: 280 }] },
    { d: 2, pieces: [{ type: 'low',  offset: 0 }, { type: 'low',  offset: 200 }, { type: 'low', offset: 400 }] },
    { d: 2, pieces: [{ type: 'tall', offset: 0 }, { type: 'low',  offset: 260 }] },

    // ---- difficulty 3 (5) ----
    { d: 3, pieces: [{ type: 'low',    offset: 0 }, { type: 'high', offset: 200 }, { type: 'low', offset: 380 }] },
    { d: 3, pieces: [{ type: 'double', offset: 0 }, { type: 'high', offset: 260 }] },
    { d: 3, pieces: [{ type: 'high',   offset: 0 }, { type: 'high', offset: 220 }, { type: 'low', offset: 420 }] },
    { d: 3, pieces: [{ type: 'tall',   offset: 0 }, { type: 'high', offset: 260 }] },
    { d: 3, pieces: [{ type: 'low',    offset: 0 }, { type: 'tall', offset: 220 }, { type: 'low', offset: 440 }] },
  ];

  // ---- module state ----
  let container = null;
  let ui = null;
  let wrap = null;
  let canvas = null;
  let ctx = null;
  let dpr = 1;
  let CANVAS_W = CANVAS_W_FALLBACK;
  let GROUND_Y = CANVAS_H - GROUND_OFFSET;

  let rafId = null;
  let lastTime = null;
  let accumulator = 0;

  let state = 'playing';                    // 'playing' | 'paused' | 'gameover'
  let player = null;
  let obstacles = [];
  let clouds = [];
  let groundOffset = 0;

  let runMs = 0;                            // ms in current run (for speed ramp)
  let runFrames = 0;                        // frames since current run started (for animations)

  let speed = START_SPEED;
  let distance = 0;
  let nextSpawnDistance = 0;
  let lastChunkIdx = -1;

  let score = 0;
  let best = 0;
  let newBestAt = 0;

  let gameOverAt = 0;
  let shakeUntil = 0;

  let nudgeHandle = null;

  // input
  let keyDown = null, keyUp = null, visHandler = null;
  let canvasMouseDown = null, canvasMouseUp = null, canvasMouseLeave = null;
  let pointerDuck = false;

  // ---------- persistence ----------

  function loadBest() {
    try {
      const v = parseInt(localStorage.getItem(STORE_BEST), 10);
      return Number.isFinite(v) && v >= 0 ? v : 0;
    } catch (_) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem(STORE_BEST, String(v)); } catch (_) {}
  }

  // ---------- helpers ----------

  function rand(a, b) { return a + Math.random() * (b - a); }

  function roundedRectPath(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
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

  function fillRoundedRect(x, y, w, h, r) {
    roundedRectPath(x, y, w, h, r);
    ctx.fill();
  }

  function strokeRoundedRect(x, y, w, h, r) {
    roundedRectPath(x, y, w, h, r);
    ctx.stroke();
  }

  function intersects(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // ---------- obstacle factory ----------

  function spawnPiece(type, x) {
    if (type === 'low')  return [{ type, x, y: GROUND_Y - 30, w: 18, h: 30, alpha: 0 }];
    if (type === 'tall') return [{ type, x, y: GROUND_Y - 50, w: 22, h: 50, alpha: 0 }];
    if (type === 'high') return [{ type, x, y: GROUND_Y - 50, w: 30, h: 24, alpha: 0 }];
    if (type === 'double') return [
      { type: 'low', x,        y: GROUND_Y - 30, w: 18, h: 30, alpha: 0 },
      { type: 'low', x: x + 32, y: GROUND_Y - 30, w: 18, h: 30, alpha: 0 },
    ];
    return [];
  }

  function pieceMaxRight(type) {
    if (type === 'low')    return 18;
    if (type === 'tall')   return 22;
    if (type === 'high')   return 30;
    if (type === 'double') return 32 + 18;
    return 0;
  }

  // ---------- chunk spawning ----------

  function spawnChunk() {
    const maxDiff = speed < 5 ? 1 : (speed <= 7 ? 2 : 3);
    let pool = [];
    for (let i = 0; i < CHUNKS.length; i++) {
      if (CHUNKS[i].d <= maxDiff && i !== lastChunkIdx) pool.push(i);
    }
    if (pool.length === 0) {
      pool = CHUNKS.map((_, i) => i).filter((i) => CHUNKS[i].d <= maxDiff);
    }
    const idx = pool[Math.floor(Math.random() * pool.length)];
    const chunk = CHUNKS[idx];
    lastChunkIdx = idx;

    let chunkExtent = 0;
    for (const piece of chunk.pieces) {
      const items = spawnPiece(piece.type, CANVAS_W + piece.offset);
      for (const it of items) obstacles.push(it);
      chunkExtent = Math.max(chunkExtent, piece.offset + pieceMaxRight(piece.type));
    }

    // gap formula per spec — note: this gives smaller pixel gaps at higher
    // speed; tune NUDGE_AFTER_MS-style if you want longer reaction windows.
    const gap = (300 / speed) * rand(2.0, 3.5);
    nextSpawnDistance = distance + chunkExtent + gap;
  }

  // ---------- player physics ----------

  function makePlayer() {
    return {
      x: PLAYER_X,
      y: GROUND_Y - PLAYER_H,
      vy: 0,
      isJumping: false,
      isDucking: false,
    };
  }

  function jump() {
    if (state !== 'playing') return;
    if (player.isJumping) return;
    if (player.isDucking) return;
    player.vy = -JUMP_VY;
    player.isJumping = true;
  }

  function setDuck(d) {
    if (state !== 'playing') {
      player.isDucking = false;
      return;
    }
    if (player.isJumping) {
      // can't duck mid-air — but allow releasing
      if (!d) player.isDucking = false;
      return;
    }
    if (d && !player.isDucking) {
      player.isDucking = true;
      player.y = GROUND_Y - DUCK_H;
    } else if (!d && player.isDucking) {
      player.isDucking = false;
      player.y = GROUND_Y - PLAYER_H;
    }
  }

  function tickPlayer() {
    if (player.isJumping) {
      player.vy += GRAVITY;
      player.y += player.vy;
      if (player.y >= GROUND_Y - PLAYER_H) {
        player.y = GROUND_Y - PLAYER_H;
        player.vy = 0;
        player.isJumping = false;
        // re-apply duck if pointer/key still held
        if (pointerDuck) setDuck(true);
      }
    }
  }

  function playerHitbox() {
    const h = player.isDucking ? DUCK_H : PLAYER_H;
    // shrink slightly for forgiveness
    return {
      x: player.x + 3,
      y: player.y + 3,
      w: PLAYER_W - 6,
      h: h - 5,
    };
  }

  // ---------- tick ----------

  function tick() {
    if (state !== 'playing') return;

    runMs += STEP;
    runFrames += 1;

    // speed ramp
    speed = Math.min(MAX_SPEED, START_SPEED + (runMs / 1000) * SPEED_RAMP_PER_SEC);

    // player
    tickPlayer();

    // obstacles
    for (const o of obstacles) {
      o.x -= speed;
      // fade-in over the last 20 px of entry
      if (o.x < CANVAS_W - 20) o.alpha = 1;
      else o.alpha = Math.max(0, 1 - (o.x - (CANVAS_W - 20)) / 20) * 0.5 + 0.5;
    }
    obstacles = obstacles.filter((o) => o.x + o.w > -10);

    // clouds + ground scroll
    for (const c of clouds) {
      c.x -= speed * 0.3;
      if (c.x < -60) c.x = CANVAS_W + 30 + Math.random() * 80;
    }
    groundOffset = (groundOffset - speed) % 30;
    if (groundOffset > 0) groundOffset -= 30;

    // spawning
    distance += speed;
    if (distance >= nextSpawnDistance) spawnChunk();

    // collision
    const hb = playerHitbox();
    for (const o of obstacles) {
      if (intersects(hb, o)) {
        endRun();
        break;
      }
    }

    // score
    score = Math.floor(distance / 10);
    ui.setStatus(`Score: ${score}`);
  }

  function endRun() {
    state = 'gameover';
    gameOverAt = performance.now();
    shakeUntil = performance.now() + 200;
    if (score > best) {
      best = score;
      saveBest(best);
      newBestAt = performance.now();
    }
    refreshControls();
    ui.setSubtitle(`Best: ${best} · press any key to restart`);
  }

  function resetRun() {
    state = 'playing';
    runMs = 0;
    runFrames = 0;
    speed = START_SPEED;
    distance = 0;
    nextSpawnDistance = 80;
    obstacles = [];
    lastChunkIdx = -1;
    player = makePlayer();
    score = 0;
    refreshControls();
    ui.setStatus(`Score: 0`);
    ui.setSubtitle(`Best: ${best}`);
  }

  // ---------- drawing ----------

  function color(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  let _accent = '#7f77dd';
  let _text   = '#e8e8ea';
  let _muted  = '#8a8a93';
  let _border = 'rgba(255,255,255,0.08)';
  let _goal   = '#97c459';

  function refreshColors() {
    _accent = color('--accent') || _accent;
    _text   = color('--text')   || _text;
    _muted  = color('--muted')  || _muted;
    _goal   = color('--goal')   || _goal;
    // --border is the literal token, fine to use as-is
  }

  function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.save();
    if (performance.now() < shakeUntil) {
      const k = (shakeUntil - performance.now()) / 200;
      ctx.translate((Math.random() - 0.5) * 6 * k, (Math.random() - 0.5) * 6 * k);
    }

    drawClouds();
    drawGround();
    drawObstacles();
    drawPlayer();
    drawHud();

    ctx.restore();

    if (state === 'paused') drawPauseOverlay();
    if (state === 'gameover') drawGameOverOverlay();
  }

  function drawClouds() {
    ctx.fillStyle = 'rgba(138, 138, 147, 0.40)';
    for (const c of clouds) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 7, 0, Math.PI * 2);
      ctx.arc(c.x + 9, c.y - 3, 9, 0, Math.PI * 2);
      ctx.arc(c.x + 19, c.y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawGround() {
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 0.5);
    ctx.lineTo(CANVAS_W, GROUND_Y + 0.5);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    for (let x = groundOffset; x < CANVAS_W; x += 30) {
      ctx.fillRect(Math.round(x), GROUND_Y + 5, 8, 1);
    }
  }

  function drawObstacles() {
    for (const o of obstacles) {
      ctx.fillStyle = `rgba(232, 232, 234, ${0.7 * o.alpha})`;
      fillRoundedRect(o.x, o.y, o.w, o.h, 3);
      // a subtle accent stripe for "high" obstacles to read them faster
      if (o.type === 'high') {
        ctx.fillStyle = `rgba(127, 119, 221, ${0.5 * o.alpha})`;
        fillRoundedRect(o.x + 2, o.y + 2, o.w - 4, 3, 1);
      }
    }
  }

  function drawPlayer() {
    const inAir = player.isJumping;
    const h = player.isDucking ? DUCK_H : PLAYER_H;
    const w = PLAYER_W;

    let bobY = 0;
    if (state === 'playing' && !inAir && !player.isDucking) {
      bobY = Math.sin(runFrames * 0.32) * 1;
    }

    ctx.save();
    ctx.translate(player.x + w / 2, player.y + h / 2 + bobY);
    if (inAir) {
      // tilt forward (negative angle in canvas = lean forward as moving right)
      const tilt = Math.max(-0.22, Math.min(0.22, -player.vy * 0.018));
      ctx.rotate(tilt);
    }

    ctx.fillStyle = _accent;
    fillRoundedRect(-w / 2, -h / 2, w, h, 6);

    // eyes — sit near the front-top of the body
    ctx.fillStyle = '#1a1a1f';
    const eyeY = -h / 2 + (player.isDucking ? 4 : 8);
    const eyeX1 = player.isDucking ? 2 : -1;
    const eyeX2 = player.isDucking ? 9 : 8;
    ctx.beginPath();
    ctx.arc(eyeX1, eyeY, 1.6, 0, Math.PI * 2);
    ctx.arc(eyeX2, eyeY, 1.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawHud() {
    ctx.textAlign = 'right';
    ctx.fillStyle = _text;
    ctx.font = 'bold 16px "SF Mono", Menlo, Consolas, monospace';
    ctx.fillText(String(score).padStart(5, '0'), CANVAS_W - 10, 22);

    ctx.fillStyle = _muted;
    ctx.font = '10px "SF Mono", Menlo, Consolas, monospace';
    ctx.fillText('best ' + String(best).padStart(5, '0'), CANVAS_W - 10, 38);

    if (performance.now() - newBestAt < 2000 && newBestAt > 0) {
      const t = (performance.now() - newBestAt) / 2000;
      const a = 0.6 + 0.4 * Math.sin(t * 18);
      ctx.fillStyle = `rgba(151, 196, 89, ${a})`;
      ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText('NEW BEST!', CANVAS_W - 10, 56);
    }
  }

  function drawPauseOverlay() {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.textAlign = 'center';
    ctx.fillStyle = _text;
    ctx.font = '16px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('Paused', CANVAS_W / 2, CANVAS_H / 2 - 4);
    ctx.fillStyle = _muted;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('press P to resume', CANVAS_W / 2, CANVAS_H / 2 + 16);
  }

  function drawGameOverOverlay() {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const cardW = Math.min(220, CANVAS_W - 40);
    const cardH = 130;
    const cx = (CANVAS_W - cardW) / 2;
    const cy = (CANVAS_H - cardH) / 2;

    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    fillRoundedRect(cx, cy, cardW, cardH, 12);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 0.5;
    strokeRoundedRect(cx, cy, cardW, cardH, 12);

    ctx.textAlign = 'center';
    ctx.fillStyle = _text;
    ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('Game over', CANVAS_W / 2, cy + 26);

    ctx.font = '12px "SF Mono", Menlo, Consolas, monospace';
    ctx.fillText(`Score: ${score}`, CANVAS_W / 2, cy + 54);
    ctx.fillStyle = _muted;
    ctx.fillText(`Best:  ${best}`, CANVAS_W / 2, cy + 72);

    if (performance.now() - newBestAt < 2000 && newBestAt > 0) {
      ctx.fillStyle = _goal;
      ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText('NEW BEST!', CANVAS_W / 2, cy + 90);
    }

    ctx.fillStyle = _muted;
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    const grace = performance.now() < gameOverAt + 500;
    ctx.fillText(grace ? '...' : 'press any key', CANVAS_W / 2, cy + cardH - 14);
  }

  // ---------- main loop ----------

  function loop(now) {
    if (lastTime != null) {
      let dt = now - lastTime;
      if (dt > 100) dt = 100; // clamp tab-switch hiccups
      accumulator += dt;
      while (accumulator >= STEP) {
        tick();
        accumulator -= STEP;
      }
    }
    lastTime = now;
    draw();
    rafId = requestAnimationFrame(loop);
  }

  // ---------- input ----------

  function isJumpKey(e) {
    return e.key === ' ' || e.code === 'Space' ||
           e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W';
  }
  function isDuckKey(e) {
    return e.key === 'ArrowDown' || e.key === 's' || e.key === 'S';
  }

  function onKeyDown(e) {
    if (state === 'gameover') {
      if (performance.now() >= gameOverAt + 500) {
        e.preventDefault();
        resetRun();
      }
      return;
    }
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      e.preventDefault();
      togglePause();
      return;
    }
    if (state !== 'playing') return;
    if (isJumpKey(e)) {
      e.preventDefault();
      jump();
    } else if (isDuckKey(e)) {
      e.preventDefault();
      pointerDuck = true;
      setDuck(true);
    }
  }

  function onKeyUp(e) {
    if (isDuckKey(e)) {
      pointerDuck = false;
      setDuck(false);
    }
  }

  function onCanvasMouseDown(e) {
    if (state === 'gameover') {
      if (performance.now() >= gameOverAt + 500) resetRun();
      return;
    }
    if (state === 'paused') { togglePause(); return; }
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (y < CANVAS_H / 2) {
      jump();
    } else {
      pointerDuck = true;
      setDuck(true);
    }
  }
  function onCanvasMouseUp() {
    if (pointerDuck) {
      pointerDuck = false;
      setDuck(false);
    }
  }
  function onCanvasMouseLeave() {
    if (pointerDuck) {
      pointerDuck = false;
      setDuck(false);
    }
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
    } else if (state === 'paused') {
      state = 'playing';
    }
    refreshControls();
  }

  function onVisibility() {
    if (document.hidden && state === 'playing') {
      state = 'paused';
      refreshControls();
    }
    // do not auto-resume on visible — user presses P
  }

  // ---------- controls bar ----------

  function refreshControls() {
    const items = [];
    if (state === 'gameover') {
      items.push({ type: 'button', label: 'Restart', onClick: resetRun });
    } else {
      items.push({
        type: 'button',
        label: state === 'paused' ? 'Resume' : 'Pause',
        onClick: togglePause,
      });
      items.push({ type: 'button', label: 'Restart', onClick: resetRun });
    }
    ui.setControls(items);
  }

  // ---------- mount / unmount ----------

  function mount(c, u) {
    container = c;
    ui = u;

    refreshColors();
    best = loadBest();

    wrap = document.createElement('div');
    wrap.className = 'runner-wrap';
    container.appendChild(wrap);

    canvas = document.createElement('canvas');
    canvas.className = 'runner-canvas';
    wrap.appendChild(canvas);

    // size canvas to container width with a sane cap
    const measured = wrap.clientWidth || CANVAS_W_FALLBACK;
    CANVAS_W = Math.max(260, Math.min(360, measured));
    GROUND_Y = CANVAS_H - GROUND_OFFSET;

    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(CANVAS_W * dpr);
    canvas.height = Math.round(CANVAS_H * dpr);
    canvas.style.width = CANVAS_W + 'px';
    canvas.style.height = CANVAS_H + 'px';
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // initial state
    obstacles = [];
    clouds = [
      { x: CANVAS_W * 0.15, y: 38 },
      { x: CANVAS_W * 0.45, y: 56 },
      { x: CANVAS_W * 0.75, y: 32 },
      { x: CANVAS_W * 1.05, y: 50 },
    ];
    player = makePlayer();
    score = 0;
    distance = 0;
    speed = START_SPEED;
    nextSpawnDistance = 80;
    runMs = 0;
    runFrames = 0;
    state = 'playing';
    lastTime = null;
    accumulator = 0;
    gameOverAt = 0;
    shakeUntil = 0;
    newBestAt = 0;
    lastChunkIdx = -1;
    pointerDuck = false;

    ui.setStatus(`Score: 0`);
    ui.setSubtitle(`Best: ${best}`);
    ui.setStatusWin(false);
    refreshControls();

    // listeners
    keyDown = onKeyDown;
    keyUp = onKeyUp;
    visHandler = onVisibility;
    canvasMouseDown = onCanvasMouseDown;
    canvasMouseUp = onCanvasMouseUp;
    canvasMouseLeave = onCanvasMouseLeave;

    document.addEventListener('keydown', keyDown);
    document.addEventListener('keyup', keyUp);
    document.addEventListener('visibilitychange', visHandler);
    canvas.addEventListener('mousedown', canvasMouseDown);
    window.addEventListener('mouseup', canvasMouseUp);
    canvas.addEventListener('mouseleave', canvasMouseLeave);

    if (NUDGE_AFTER_MS > 0 && window.VibeBreakNudge) {
      nudgeHandle = window.VibeBreakNudge.startNudge(wrap, { afterMs: NUDGE_AFTER_MS });
    }

    rafId = requestAnimationFrame(loop);
  }

  function unmount() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;

    if (keyDown)         document.removeEventListener('keydown', keyDown);
    if (keyUp)           document.removeEventListener('keyup', keyUp);
    if (visHandler)      document.removeEventListener('visibilitychange', visHandler);
    if (canvas && canvasMouseDown)  canvas.removeEventListener('mousedown', canvasMouseDown);
    if (canvasMouseUp)   window.removeEventListener('mouseup', canvasMouseUp);
    if (canvas && canvasMouseLeave) canvas.removeEventListener('mouseleave', canvasMouseLeave);

    keyDown = keyUp = visHandler = null;
    canvasMouseDown = canvasMouseUp = canvasMouseLeave = null;

    if (nudgeHandle) { nudgeHandle.stop(); nudgeHandle = null; }

    if (container) container.innerHTML = '';
    container = null;
    ui = null;
    wrap = null;
    canvas = null;
    ctx = null;
    obstacles = [];
    clouds = [];
    player = null;
  }

  window.RunnerGame = { name: 'Runner', mount, unmount };
})();
