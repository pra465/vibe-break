// Taxi — endless arcade traffic-dodging. Drive the yellow taxi, dodge traffic,
// jump over cars, survive. ↑ accelerate · ↓ slow · ← → steer · space jump.
// Exports window.TaxiGame = { name, mount(container, ui), unmount() }.

(function () {
  // ---------- Constants ----------
  const LANES = 3;
  const ROAD_FRAC = 0.7;
  const TAXI_W = 34;
  const TAXI_H = 58;
  const CAR_W = 34;
  const CAR_H = 56;
  const TAXI_Y_FRAC = 0.78;
  const MIN_SPEED = 140;
  const MAX_SPEED = 700;
  const START_SPEED = 240;
  const ACCEL = 360;
  const DECEL = 260;
  const STEER_TIME = 0.16;
  const JUMP_DURATION = 0.55;
  const JUMP_COOLDOWN = 1.3;
  const SCORE_PER_PX = 0.04;
  const SHAKE_DECAY = 55;
  const CAR_COLORS = [
    '#e26d6d', '#5fa1e0', '#9b65d8', '#5cbf9f',
    '#ffffff', '#f57e3b', '#d24a8b', '#7cd4e6',
  ];
  const HIGH_KEY = 'vibebreak.taxi.high';

  // ---------- Module state ----------
  let container = null, ui = null;
  let wrap = null, canvas = null, ctx = null;
  let W = 0, H = 0, dpr = 1;
  let rafHandle = null, lastTime = 0;
  let resizeObserver = null;

  let keys = {};
  let keydownHandler = null, keyupHandler = null, visHandler = null;

  let mode = 'menu';            // 'menu' | 'playing' | 'gameover'
  let taxi = null;
  let cars = [];
  let particles = [];
  let scrollY = 0;
  let score = 0;
  let highScore = 0;
  let shake = 0;
  let spawnTimer = 0;

  let audioCtx = null;

  // ---------- Audio (synthesized, no external files) ----------
  function ensureAudio() {
    if (audioCtx === null) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = AC ? new AC() : false;
      } catch (_) { audioCtx = false; }
    }
    return audioCtx || null;
  }

  function playTone(freq, dur, type, vol) {
    const ac = ensureAudio();
    if (!ac) return;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.connect(g).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + dur);
  }

  function playJump() {
    playTone(620, 0.08, 'triangle', 0.05);
    setTimeout(() => playTone(880, 0.1, 'triangle', 0.04), 60);
  }

  function playCrash() {
    const ac = ensureAudio();
    if (!ac) return;
    const len = Math.floor(ac.sampleRate * 0.32);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ac.createBufferSource();
    src.buffer = buf;
    const g = ac.createGain();
    g.gain.value = 0.14;
    src.connect(g).connect(ac.destination);
    src.start();
    playTone(140, 0.25, 'sawtooth', 0.07);
  }

  // ---------- High score ----------
  function loadHigh() {
    try { return +(localStorage.getItem(HIGH_KEY)) || 0; }
    catch (_) { return 0; }
  }
  function saveHigh(v) {
    try { localStorage.setItem(HIGH_KEY, String(Math.floor(v))); }
    catch (_) {}
  }

  // ---------- Layout helpers ----------
  function roadLeft() { return (W - W * ROAD_FRAC) / 2; }
  function roadW() { return W * ROAD_FRAC; }
  function laneWidth() { return roadW() / LANES; }
  function lanePosToX(lp) { return roadLeft() + laneWidth() * (lp + 0.5); }
  function laneCenterX(lane) { return lanePosToX(lane); }
  function taxiY() { return H * TAXI_Y_FRAC; }

  // ---------- State helpers ----------
  function newTaxi() {
    return {
      lanePos: 1,
      targetLane: 1,
      lerpFrom: 1,
      lerpT: 1,
      speed: START_SPEED,
      jumping: false,
      jumpT: 0,
      jumpCooldown: 0,
    };
  }

  function resetWorld() {
    taxi = newTaxi();
    cars = [];
    particles = [];
    scrollY = 0;
    score = 0;
    spawnTimer = 0;
  }

  function backToMenu() {
    resetWorld();
    mode = 'menu';
    shake = 0;
    ui.setStatusWin(false);
    ui.setStatus(highScore ? `best ${highScore}` : 'ready');
    ui.setSubtitle('Dodge traffic · ↑↓←→ + space');
    ui.setControls([
      { type: 'button', label: 'Start', onClick: (e) => { e && e.target && e.target.blur(); startGame(); } },
    ]);
  }

  function startGame() {
    ensureAudio();
    resetWorld();
    mode = 'playing';
    shake = 0;
    ui.setStatusWin(false);
    ui.setStatus('0');
    ui.setSubtitle('↑ ↓ ← → · space to jump');
    ui.setControls([]);
  }

  function endGame() {
    mode = 'gameover';
    shake = 16;
    playCrash();
    if (score > highScore) {
      highScore = Math.floor(score);
      saveHigh(highScore);
    }
    ui.setStatusWin(false);
    ui.setSubtitle(`Crashed at ${Math.floor(score)} · best ${highScore}`);
    ui.setControls([
      { type: 'button', label: 'Restart', onClick: (e) => { e && e.target && e.target.blur(); startGame(); } },
    ]);
  }

  // ---------- Input ----------
  function steer(dir) {
    if (mode !== 'playing') return;
    const next = Math.max(0, Math.min(LANES - 1, taxi.targetLane + dir));
    if (next === taxi.targetLane) return;
    taxi.lerpFrom = taxi.lanePos;
    taxi.targetLane = next;
    taxi.lerpT = 0;
    spawnSmokePuff(lanePosToX(taxi.lanePos), taxiY() + TAXI_H / 2 - 6);
  }

  function tryJump() {
    if (mode !== 'playing') return;
    if (taxi.jumping || taxi.jumpCooldown > 0) return;
    taxi.jumping = true;
    taxi.jumpT = 0;
    playJump();
  }

  function handleDiscreteKey(name) {
    if (mode === 'menu' || mode === 'gameover') {
      if (name === ' ' || name === 'Enter') { startGame(); }
      return;
    }
    if (name === 'ArrowLeft') steer(-1);
    if (name === 'ArrowRight') steer(1);
    if (name === ' ') tryJump();
  }

  // ---------- Spawning ----------
  function maybeSpawn(dt) {
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    const speedFrac = (taxi.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
    const baseInterval = 1.15 - speedFrac * 0.55;
    spawnTimer = baseInterval * (0.75 + Math.random() * 0.5);

    // Block 1 or 2 lanes — never all 3, so the player always has an out.
    const blocked = new Set();
    const count = 1 + (Math.random() < 0.35 ? 1 : 0);
    while (blocked.size < count) blocked.add(Math.floor(Math.random() * LANES));

    for (const lane of blocked) {
      cars.push({
        lane,
        y: -CAR_H - 20 - Math.random() * 40,
        color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
        worldSpeed: 70 + Math.random() * 90,
      });
    }
  }

  function spawnShoulderStreak() {
    const side = Math.random() < 0.5 ? 'L' : 'R';
    const lz = roadLeft();
    const rz = roadLeft() + roadW();
    const x = side === 'L'
      ? Math.random() * Math.max(2, lz - 4)
      : rz + 4 + Math.random() * Math.max(2, W - rz - 4);
    particles.push({
      kind: 'streak',
      x,
      y: -10,
      vy: Math.max(taxi.speed * 1.3, 280),
      life: 0.55,
      alpha: 0.85,
    });
  }

  function spawnSmokePuff(x, y) {
    for (let i = 0; i < 5; i++) {
      particles.push({
        kind: 'smoke',
        x: x + (Math.random() - 0.5) * 14,
        y: y + (Math.random() - 0.5) * 4,
        vx: (Math.random() - 0.5) * 40,
        vy: 30 + Math.random() * 40,
        life: 0.5,
        alpha: 0.55,
        r: 3 + Math.random() * 3,
      });
    }
  }

  // ---------- Update ----------
  function update(dt) {
    if (mode !== 'playing') {
      // Decay shake + particles even when paused/over for visual settle.
      if (shake > 0) shake = Math.max(0, shake - SHAKE_DECAY * dt);
      stepParticles(dt);
      return;
    }

    // Speed (continuous, held)
    if (keys['ArrowUp']) taxi.speed = Math.min(MAX_SPEED, taxi.speed + ACCEL * dt);
    else if (keys['ArrowDown']) taxi.speed = Math.max(MIN_SPEED, taxi.speed - DECEL * dt);

    // Lane lerp
    if (taxi.lerpT < 1) {
      taxi.lerpT = Math.min(1, taxi.lerpT + dt / STEER_TIME);
      const t = ease(taxi.lerpT);
      taxi.lanePos = taxi.lerpFrom + (taxi.targetLane - taxi.lerpFrom) * t;
    }

    // Jump
    if (taxi.jumping) {
      taxi.jumpT += dt;
      if (taxi.jumpT >= JUMP_DURATION) {
        taxi.jumping = false;
        taxi.jumpCooldown = JUMP_COOLDOWN;
      }
    } else if (taxi.jumpCooldown > 0) {
      taxi.jumpCooldown = Math.max(0, taxi.jumpCooldown - dt);
    }

    // Scroll + score
    scrollY += taxi.speed * dt;
    score += taxi.speed * dt * SCORE_PER_PX;
    ui.setStatus(`${Math.floor(score)}`);

    // Cars — move down on screen by (taxi - car) speed
    for (const c of cars) c.y += (taxi.speed - c.worldSpeed) * dt;
    cars = cars.filter((c) => c.y < H + CAR_H + 50);

    maybeSpawn(dt);

    // Particles
    if (taxi.speed > 180 && Math.random() < 0.55) spawnShoulderStreak();
    stepParticles(dt);

    // Collisions (skipped while jumping)
    if (!taxi.jumping) {
      const tx = lanePosToX(taxi.lanePos);
      const ty = taxiY();
      const tBox = {
        x: tx - TAXI_W / 2 + 4, y: ty - TAXI_H / 2 + 4,
        w: TAXI_W - 8, h: TAXI_H - 8,
      };
      for (const c of cars) {
        const cx = laneCenterX(c.lane);
        const cBox = {
          x: cx - CAR_W / 2 + 4, y: c.y - CAR_H / 2 + 4,
          w: CAR_W - 8, h: CAR_H - 8,
        };
        if (overlap(tBox, cBox)) {
          endGame();
          return;
        }
      }
    }

    if (shake > 0) shake = Math.max(0, shake - SHAKE_DECAY * dt);
  }

  function stepParticles(dt) {
    for (const p of particles) {
      p.life -= dt;
      if (p.kind === 'streak') {
        p.y += p.vy * dt;
      } else if (p.kind === 'smoke') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.r += dt * 4;
      }
    }
    particles = particles.filter((p) => p.life > 0);
  }

  function ease(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }
  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // ---------- Render ----------
  function render() {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (shake > 0) {
      ctx.translate(
        (Math.random() - 0.5) * shake,
        (Math.random() - 0.5) * shake,
      );
    }

    // Grass background
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#1f5f30');
    grad.addColorStop(1, '#2a7a3f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Shoulder rumble — small scrolling stripes
    const rumblePeriod = 18;
    const rumbleOff = scrollY % rumblePeriod;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let y = -rumblePeriod + rumbleOff; y < H; y += rumblePeriod) {
      ctx.fillRect(6, y, 4, 8);
      ctx.fillRect(W - 10, y, 4, 8);
    }

    // Road surface
    ctx.fillStyle = '#2b2b35';
    ctx.fillRect(roadLeft(), 0, roadW(), H);

    // Road edge stripes (white solid)
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(roadLeft() - 2, 0, 2, H);
    ctx.fillRect(roadLeft() + roadW(), 0, 2, H);

    // Lane dashes (yellow, scroll with speed)
    ctx.fillStyle = '#f4d35e';
    const dashH = 26, gap = 22, period = dashH + gap;
    const offset = scrollY % period;
    for (let i = 1; i < LANES; i++) {
      const x = roadLeft() + laneWidth() * i - 1.5;
      for (let y = -period + offset; y < H + period; y += period) {
        ctx.fillRect(x, y, 3, dashH);
      }
    }

    // Particles behind cars
    for (const p of particles) {
      if (p.kind === 'streak') {
        const a = Math.max(0, Math.min(1, p.life / 0.55)) * p.alpha;
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        ctx.fillRect(p.x, p.y, 2, 12);
      } else if (p.kind === 'smoke') {
        const a = Math.max(0, Math.min(1, p.life / 0.5)) * p.alpha;
        ctx.fillStyle = `rgba(220,220,220,${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Traffic
    for (const c of cars) drawTrafficCar(laneCenterX(c.lane), c.y, c.color);

    // Taxi (last, on top)
    const tx = lanePosToX(taxi.lanePos);
    const ty = taxiY();
    const jumpPhase = taxi.jumping ? Math.sin((taxi.jumpT / JUMP_DURATION) * Math.PI) : 0;
    drawTaxi(tx, ty, jumpPhase);

    // Speed indicator (tiny bar bottom-left)
    drawSpeedBar();

    // Jump-ready indicator (small dot top-right of taxi area)
    drawJumpIndicator();

    // Overlays
    if (mode === 'menu') {
      drawOverlay('CRAZY TAXI', 'Press Start to drive');
    } else if (mode === 'gameover') {
      drawOverlay('CRASH!', `score ${Math.floor(score)} · best ${highScore}`);
    }
  }

  function drawTrafficCar(x, y, color) {
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(x + 2, y + CAR_H / 2, CAR_W * 0.45, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // body
    roundRect(x - CAR_W / 2, y - CAR_H / 2, CAR_W, CAR_H, 6);
    ctx.fillStyle = color;
    ctx.fill();

    // mid divider line (hood/trunk break)
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x - CAR_W / 2 + 3, y - 1, CAR_W - 6, 2);

    // windows
    ctx.fillStyle = '#1a1a1f';
    roundRect(x - CAR_W / 2 + 4, y - CAR_H / 2 + 6, CAR_W - 8, 12, 3); ctx.fill();
    roundRect(x - CAR_W / 2 + 4, y + 4, CAR_W - 8, 12, 3); ctx.fill();

    // front lights (top)
    ctx.fillStyle = '#fff5b8';
    ctx.fillRect(x - CAR_W / 2 + 4, y - CAR_H / 2 + 2, 6, 3);
    ctx.fillRect(x + CAR_W / 2 - 10, y - CAR_H / 2 + 2, 6, 3);

    // tail lights (bottom)
    ctx.fillStyle = '#e23838';
    ctx.fillRect(x - CAR_W / 2 + 4, y + CAR_H / 2 - 5, 6, 3);
    ctx.fillRect(x + CAR_W / 2 - 10, y + CAR_H / 2 - 5, 6, 3);
  }

  function drawTaxi(x, y, jumpPhase) {
    // shadow (offset + shrunk when in the air)
    const shadowAlpha = 0.42 - jumpPhase * 0.2;
    const shadowOff = jumpPhase * 6;
    ctx.fillStyle = `rgba(0,0,0,${shadowAlpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(
      x + shadowOff,
      y + TAXI_H / 2 + shadowOff * 0.4,
      TAXI_W * (0.46 - jumpPhase * 0.08),
      6,
      0, 0, Math.PI * 2
    );
    ctx.fill();

    const scale = 1 + jumpPhase * 0.18;
    const lift = jumpPhase * 12;
    const w = TAXI_W * scale;
    const h = TAXI_H * scale;
    const ty = y - lift;

    // body
    roundRect(x - w / 2, ty - h / 2, w, h, 7);
    ctx.fillStyle = '#f9c80e';
    ctx.fill();

    // checker stripes on sides
    const stripeY = ty - h / 2 + 20;
    const stripeH = h - 40;
    drawChecker(x - w / 2 + 1, stripeY, 5, stripeH);
    drawChecker(x + w / 2 - 6, stripeY, 5, stripeH);

    // mid divider
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x - w / 2 + 3, ty - 1, w - 6, 2);

    // windows
    ctx.fillStyle = '#1a1a1f';
    roundRect(x - w / 2 + 5, ty - h / 2 + 6, w - 10, 13, 3); ctx.fill();
    roundRect(x - w / 2 + 5, ty + 4, w - 10, 13, 3); ctx.fill();

    // roof "TAXI" sign
    ctx.fillStyle = '#1a1a1f';
    ctx.fillRect(x - 10, ty - 3, 20, 7);
    ctx.fillStyle = '#f9c80e';
    ctx.font = 'bold 7px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TAXI', x, ty + 0.5);

    // headlights
    ctx.fillStyle = '#fff5b8';
    ctx.fillRect(x - w / 2 + 4, ty - h / 2 + 2, 7, 3);
    ctx.fillRect(x + w / 2 - 11, ty - h / 2 + 2, 7, 3);
  }

  function drawChecker(x, y, w, h) {
    const sq = 4;
    let dark = true;
    for (let dy = 0; dy < h; dy += sq) {
      ctx.fillStyle = dark ? '#1a1a1f' : '#f9c80e';
      ctx.fillRect(x, y + dy, w, Math.min(sq, h - dy));
      dark = !dark;
    }
  }

  function drawSpeedBar() {
    const x = 8, y = H - 14, w = 60, h = 6;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    roundRect(x, y, w, h, 3); ctx.fill();
    const frac = (taxi.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
    ctx.fillStyle = frac > 0.8 ? '#e26d6d' : frac > 0.5 ? '#f9c80e' : '#5cbf9f';
    roundRect(x + 1, y + 1, (w - 2) * Math.max(0.03, frac), h - 2, 2);
    ctx.fill();
  }

  function drawJumpIndicator() {
    if (mode !== 'playing') return;
    const ready = !taxi.jumping && taxi.jumpCooldown <= 0;
    const x = W - 14, y = H - 11;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = ready ? '#5cbf9f' : 'rgba(255,255,255,0.18)';
    ctx.fill();
  }

  function drawOverlay(title, sub) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const boxH = 76;
    const boxY = H / 2 - boxH / 2;
    ctx.fillRect(0, boxY, W, boxH);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f9c80e';
    ctx.font = 'bold 22px -apple-system, sans-serif';
    ctx.fillText(title, W / 2, boxY + 28);
    ctx.fillStyle = '#e8e8ea';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillText(sub, W / 2, boxY + 53);
  }

  function roundRect(x, y, w, h, r) {
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

  // ---------- Loop ----------
  function loop(t) {
    rafHandle = requestAnimationFrame(loop);
    if (!lastTime) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05;
    update(dt);
    render();
  }

  // ---------- Sizing ----------
  function fitCanvas() {
    if (!wrap || !canvas) return;
    const rect = wrap.getBoundingClientRect();
    W = Math.max(120, Math.floor(rect.width));
    H = Math.max(120, Math.floor(rect.height));
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
  }

  // ---------- Mount / unmount ----------
  function mount(c, u) {
    container = c;
    ui = u;

    wrap = document.createElement('div');
    wrap.className = 'taxi-wrap';
    canvas = document.createElement('canvas');
    canvas.className = 'taxi-canvas';
    wrap.appendChild(canvas);
    container.appendChild(wrap);
    ctx = canvas.getContext('2d');

    fitCanvas();
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(() => fitCanvas());
      resizeObserver.observe(wrap);
    }

    highScore = loadHigh();

    keydownHandler = (e) => {
      const k = e.key;
      if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' || k === ' ') {
        e.preventDefault();
      }
      if (!keys[k]) handleDiscreteKey(k);
      keys[k] = true;
    };
    keyupHandler = (e) => { keys[e.key] = false; };
    document.addEventListener('keydown', keydownHandler);
    document.addEventListener('keyup', keyupHandler);

    visHandler = () => {
      if (document.hidden) {
        if (rafHandle) cancelAnimationFrame(rafHandle);
        rafHandle = null;
      } else if (!rafHandle) {
        lastTime = 0;
        rafHandle = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', visHandler);

    backToMenu();
    lastTime = 0;
    rafHandle = requestAnimationFrame(loop);
  }

  function unmount() {
    if (rafHandle) cancelAnimationFrame(rafHandle);
    rafHandle = null;
    if (keydownHandler) document.removeEventListener('keydown', keydownHandler);
    if (keyupHandler) document.removeEventListener('keyup', keyupHandler);
    if (visHandler) document.removeEventListener('visibilitychange', visHandler);
    if (resizeObserver) resizeObserver.disconnect();
    if (audioCtx && audioCtx.close) {
      try { audioCtx.close(); } catch (_) {}
    }
    audioCtx = null;
    keys = {};
    keydownHandler = null;
    keyupHandler = null;
    visHandler = null;
    resizeObserver = null;
    if (container) container.innerHTML = '';
    container = null;
    wrap = null;
    canvas = null;
    ctx = null;
    taxi = null;
    cars = [];
    particles = [];
  }

  window.TaxiGame = { name: 'Taxi', mount, unmount };
})();
