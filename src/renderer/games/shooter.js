// Shooter — top-down arcade shooter, 20 waves + boss.
// Exports window.ShooterGame = { name, mount(container, ui), unmount() }.

(function () {
  // ============================================================
  // CONSTANTS
  // ============================================================

  const CANVAS_W_MIN = 280;
  const CANVAS_W_MAX = 340;
  const CANVAS_H = 360;

  const PLAYER_SPEED = 5;
  const PLAYER_W = 16;
  const PLAYER_H = 20;
  const PLAYER_HITBOX_W = 10;     // 60% of visual width
  const PLAYER_HITBOX_H = 12;     // 60% of visual height
  const PLAYER_BOTTOM_PADDING = 60;
  const PLAYER_INVINCIBLE_MS = 800;
  const PLAYER_LIVES_START = 3;
  const PLAYER_LIVES_MAX = 5;

  const PLAYER_BULLET_SPEED = 8;
  const ENEMY_BULLET_SPEED = 3;
  const BOSS_BULLET_SPEED = 2.5;

  const BREATHER_MS = 3000;
  const RESTART_GRACE_MS = 500;
  const COMBO_TIMEOUT_MS = 2000;
  const COMBO_MAX_MULT = 3.0;

  const SHIELD_DURATION_MS = 5000;
  const NEW_BEST_MS = 2000;

  const STAR_COUNT = 60;
  const STORE_BEST = 'shooter.best';

  const ENEMY_TYPES = {
    grunt:    { hp: 1, speed: 2,   value: 10, fireMs: 0,    color: '#e26d6d', size: 12 },
    shooter:  { hp: 2, speed: 1.5, value: 25, fireMs: 1500, color: '#fac775', size: 14 },
    zigzag:   { hp: 1, speed: 3,   value: 20, fireMs: 0,    color: '#f5d76e', size: 12 },
    tank:     { hp: 5, speed: 1,   value: 60, fireMs: 2000, color: '#a0a0a8', size: 18 },
    kamikaze: { hp: 1, speed: 4,   value: 30, fireMs: 0,    color: '#9d7add', size: 12 },
  };

  const WEAPON_FIRE_INTERVAL = {
    default: Math.round(1000 / 6),   // ~167ms
    spread:  Math.round(1000 / 5),   // 200ms
    rapid:   Math.round(1000 / 12),  // ~83ms
  };

  // ============================================================
  // WAVES — hand-tuned 20-wave progression
  // ============================================================

  const WAVES = [
    // 1: gentle intro — single wall of grunts
    { spawns: [{ at: 500, type: 'grunt', count: 5, formation: 'line' }] },
    // 2: introduce shooters from the edges
    { spawns: [
      { at: 0,    type: 'grunt',   count: 8, formation: 'random' },
      { at: 2500, type: 'shooter', count: 2, formation: 'edges' },
    ] },
    // 3: introduce zigzags — readability test
    { spawns: [{ at: 500, type: 'zigzag', count: 6, formation: 'stream', interval: 500 }] },
    // 4: tanks — first 5-HP enemy, learn to focus fire
    { spawns: [
      { at: 0,    type: 'tank',  count: 2, formation: 'edges' },
      { at: 1500, type: 'grunt', count: 4, formation: 'random' },
    ] },
    // 5: V formation tests sweeping fire
    { spawns: [
      { at: 0,    type: 'grunt',   count: 9, formation: 'vee' },
      { at: 3000, type: 'shooter', count: 3, formation: 'line' },
    ] },
    // 6: kamikaze debut — fast and aimed
    { spawns: [
      { at: 0,    type: 'grunt',    count: 5, formation: 'random' },
      { at: 2000, type: 'kamikaze', count: 2, formation: 'edges' },
    ] },
    // 7: zigzag stream + shooter pressure
    { spawns: [
      { at: 0,    type: 'zigzag',  count: 5, formation: 'stream', interval: 600 },
      { at: 2500, type: 'shooter', count: 2, formation: 'edges' },
    ] },
    // 8: tanks line — sustained fire
    { spawns: [
      { at: 0,    type: 'tank',  count: 3, formation: 'line' },
      { at: 2000, type: 'grunt', count: 6, formation: 'random' },
    ] },
    // 9: kamikaze stream — dodge under pressure
    { spawns: [
      { at: 0,    type: 'grunt',    count: 4, formation: 'random' },
      { at: 1500, type: 'kamikaze', count: 5, formation: 'stream', interval: 700 },
    ] },
    // 10: mid-game spike — all four basic types
    { spawns: [
      { at: 0,    type: 'grunt',   count: 6, formation: 'vee' },
      { at: 2000, type: 'shooter', count: 2, formation: 'edges' },
      { at: 4000, type: 'zigzag',  count: 4, formation: 'stream', interval: 500 },
      { at: 6500, type: 'tank',    count: 1, formation: 'line' },
    ] },
    // 11: zigzag vee — pattern disruption
    { spawns: [
      { at: 0,    type: 'zigzag',  count: 7, formation: 'vee' },
      { at: 2500, type: 'shooter', count: 3, formation: 'line' },
    ] },
    // 12: tank duo + zigzag swarm
    { spawns: [
      { at: 0,    type: 'tank',   count: 2, formation: 'edges' },
      { at: 1500, type: 'zigzag', count: 8, formation: 'stream', interval: 400 },
    ] },
    // 13: kamikaze waves bracketing a grunt swarm
    { spawns: [
      { at: 0,    type: 'kamikaze', count: 2, formation: 'edges' },
      { at: 1500, type: 'grunt',    count: 8, formation: 'random' },
      { at: 4000, type: 'kamikaze', count: 2, formation: 'edges' },
    ] },
    // 14: shooter line + zigzag stream — bullet management
    { spawns: [
      { at: 0,    type: 'shooter', count: 4, formation: 'line' },
      { at: 2000, type: 'zigzag',  count: 6, formation: 'stream', interval: 500 },
    ] },
    // 15: combined arms
    { spawns: [
      { at: 0,    type: 'tank',    count: 2, formation: 'edges' },
      { at: 1500, type: 'shooter', count: 3, formation: 'vee' },
      { at: 4000, type: 'grunt',   count: 4, formation: 'random' },
    ] },
    // 16: zigzag onslaught with kamikaze finisher
    { spawns: [
      { at: 0,    type: 'zigzag',   count: 8, formation: 'stream', interval: 400 },
      { at: 4500, type: 'kamikaze', count: 2, formation: 'edges' },
    ] },
    // 17: heavy mixed wave (zigzags during tank pressure)
    { spawns: [
      { at: 0,    type: 'tank',     count: 3, formation: 'line' },
      { at: 2000, type: 'zigzag',   count: 6, formation: 'stream', interval: 500 },
      { at: 6000, type: 'kamikaze', count: 4, formation: 'stream', interval: 700 },
    ] },
    // 18: shooter swarm — bullet hell mini-test
    { spawns: [
      { at: 0,    type: 'shooter', count: 5, formation: 'stream', interval: 700 },
      { at: 1500, type: 'grunt',   count: 4, formation: 'random' },
    ] },
    // 19: heavy tank wave — pre-boss endurance
    { spawns: [
      { at: 0,    type: 'tank',    count: 4, formation: 'edges' },
      { at: 2500, type: 'grunt',   count: 6, formation: 'random' },
      { at: 5000, type: 'shooter', count: 2, formation: 'edges' },
    ] },
    // 20: boss
    { boss: true },
  ];

  // ============================================================
  // MODULE STATE
  // ============================================================

  let container = null, ui = null;
  let wrap = null, canvas = null, ctx = null, dpr = 1;
  let canvasW = 320, canvasH = CANVAS_H;

  let player = null;
  let bullets = [];
  let enemies = [];
  let powerups = [];
  let particles = [];
  let stars = [];
  let boss = null;

  let waveIndex = 0;                  // 0-based; 19 = boss
  let state = 'wave-active';          // 'wave-active'|'breather'|'boss-fight'|'gameover'|'victory'
  let paused = false;
  let waveStartedAt = 0;
  let waveSpawnsLeft = [];
  let breatherUntil = 0;
  let endStateAt = 0;

  let score = 0;
  let best = 0;
  let combo = 0;
  let comboUntil = 0;
  let newBestAt = 0;

  let damageFlashUntil = 0;
  let victoryFlashUntil = 0;
  let gridScrollY = 0;

  let shake = { until: 0, amp: 0 };

  let rafId = null;
  let lastFrame = null;

  const input = {
    left: false, right: false, fire: false,
    mouseX: null, mouseInside: false, mouseDown: false,
    touchActive: false, touchX: null,
    lastKeyboardMs: 0,
  };

  // listeners
  let keyDownH = null, keyUpH = null, visH = null;
  let mouseMoveH = null, mouseDownH = null, mouseUpH = null;
  let mouseEnterH = null, mouseLeaveH = null;
  let touchStartH = null, touchMoveH = null, touchEndH = null;

  // ============================================================
  // HELPERS
  // ============================================================

  function nowMs() { return performance.now(); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function loadBest() {
    try { const v = parseInt(localStorage.getItem(STORE_BEST), 10); return Number.isFinite(v) ? v : 0; }
    catch (_) { return 0; }
  }
  function saveBest(v) { try { localStorage.setItem(STORE_BEST, String(v)); } catch (_) {} }

  // ============================================================
  // WAVE EXPANSION
  // ============================================================

  function expandWave(wave) {
    const out = [];
    for (const s of wave.spawns) {
      if (s.formation === 'stream') {
        const interval = s.interval || 500;
        const x = canvasW / 2;
        for (let i = 0; i < s.count; i++) {
          out.push({ at: s.at + i * interval, type: s.type, x, y: -20 });
        }
      } else if (s.formation === 'line') {
        const padding = 32;
        const usable = canvasW - padding * 2;
        for (let i = 0; i < s.count; i++) {
          const x = s.count === 1
            ? canvasW / 2
            : padding + (usable * i / (s.count - 1));
          out.push({ at: s.at, type: s.type, x, y: -20 });
        }
      } else if (s.formation === 'vee') {
        const cx = canvasW / 2;
        const spread = 26;
        for (let i = 0; i < s.count; i++) {
          const half = (s.count - 1) / 2;
          const off = i - half;
          const x = clamp(cx + off * spread, 24, canvasW - 24);
          const y = -20 - Math.abs(off) * 14;
          out.push({ at: s.at, type: s.type, x, y });
        }
      } else if (s.formation === 'random') {
        for (let i = 0; i < s.count; i++) {
          const x = 24 + Math.random() * (canvasW - 48);
          const y = -20 - Math.random() * 30;
          out.push({ at: s.at + Math.random() * 600, type: s.type, x, y });
        }
      } else if (s.formation === 'edges') {
        const pairs = Math.floor(s.count / 2);
        for (let i = 0; i < pairs; i++) {
          out.push({ at: s.at + i * 600, type: s.type, x: 26, y: -20 });
          out.push({ at: s.at + i * 600, type: s.type, x: canvasW - 26, y: -20 });
        }
        if (s.count % 2 === 1) {
          out.push({ at: s.at + pairs * 600, type: s.type, x: canvasW / 2, y: -20 });
        }
      }
    }
    out.sort((a, b) => a.at - b.at);
    return out;
  }

  // ============================================================
  // ENTITIES
  // ============================================================

  function makePlayer() {
    return {
      x: canvasW / 2,
      y: canvasH - PLAYER_BOTTOM_PADDING,
      lives: PLAYER_LIVES_START,
      weapon: 'default',
      weaponLevel: 1,
      shieldUntil: 0,
      invincibleUntil: 0,
      lastFireAt: 0,
    };
  }

  function spawnEnemy(type, x, y) {
    const t = ENEMY_TYPES[type];
    enemies.push({
      type, x, y,
      startX: x,
      vx: 0, vy: t.speed,
      hp: t.hp, maxHp: t.hp,
      fireTimer: t.fireMs ? rand(t.fireMs * 0.4, t.fireMs) : 0,
      spawnTime: nowMs(),
      kamiLocked: false,
    });
  }

  function spawnBoss() {
    boss = {
      x: canvasW / 2,
      y: 50,
      w: 80,
      h: 50,
      hp: 80,
      maxHp: 80,
      phase: 1,
      fireTimer: 1000,
      gruntTimer: 4000,
      kamiTimer: 6000,
      spawnTime: nowMs(),
    };
  }

  function pushParticle(x, y, color, opts) {
    opts = opts || {};
    const angle = opts.angle != null ? opts.angle : rand(0, Math.PI * 2);
    const speed = opts.speed != null ? opts.speed : rand(0.5, 3);
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: opts.life || 400,
      maxLife: opts.life || 400,
      color,
      size: opts.size != null ? opts.size : 2,
      gravity: opts.gravity != null ? opts.gravity : 0.05,
    });
  }

  function deathBurst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      pushParticle(x, y, color, { speed: rand(0.8, 3.0), gravity: 0.1, life: 400 });
    }
  }

  function pickupSparkle(x, y) {
    for (let i = 0; i < 8; i++) {
      pushParticle(x, y, '#97c459', { speed: rand(0.5, 1.8), gravity: 0, life: 300, size: 1.5 });
    }
  }

  function makeStars() {
    const out = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      out.push({
        x: Math.random() * canvasW,
        y: Math.random() * canvasH,
        vy: rand(0.3, 1.0),
        alpha: rand(0.2, 0.8),
        size: Math.random() < 0.3 ? 2 : 1,
      });
    }
    return out;
  }

  // ============================================================
  // FIRING
  // ============================================================

  function tryPlayerFire() {
    const t = nowMs();
    const cd = WEAPON_FIRE_INTERVAL[player.weapon];
    if (t - player.lastFireAt < cd) return;
    player.lastFireAt = t;
    fireWeapon();
  }

  function pushPlayerBullet(vx, vy, ox, oy) {
    bullets.push({
      x: player.x + (ox || 0),
      y: player.y - 12 + (oy || 0),
      vx: vx || 0,
      vy: vy != null ? vy : -PLAYER_BULLET_SPEED,
      owner: 'player',
      damage: 1,
      isPlayer: true,
      trail: [],
    });
  }

  function fireWeapon() {
    const w = player.weapon;
    const lv = player.weaponLevel;
    if (w === 'default') {
      if (lv === 1) {
        pushPlayerBullet(0, -PLAYER_BULLET_SPEED);
      } else if (lv === 2) {
        pushPlayerBullet(0, -PLAYER_BULLET_SPEED, -4, 0);
        pushPlayerBullet(0, -PLAYER_BULLET_SPEED, +4, 0);
      } else {
        pushPlayerBullet(0, -PLAYER_BULLET_SPEED, -4, 0);
        pushPlayerBullet(0, -PLAYER_BULLET_SPEED, +4, 0);
        // side-shots
        pushPlayerBullet(-PLAYER_BULLET_SPEED * 0.7, -PLAYER_BULLET_SPEED * 0.7, -6, 0);
        pushPlayerBullet(+PLAYER_BULLET_SPEED * 0.7, -PLAYER_BULLET_SPEED * 0.7, +6, 0);
      }
    } else if (w === 'spread') {
      const speed = PLAYER_BULLET_SPEED;
      const angles = lv === 1
        ? [-15, 0, 15]
        : lv === 2
          ? [-22, -8, 8, 22]
          : [-28, -14, 0, 14, 28];
      for (const deg of angles) {
        const r = (deg * Math.PI) / 180;
        pushPlayerBullet(Math.sin(r) * speed, -Math.cos(r) * speed);
      }
      if (lv === 3) {
        pushPlayerBullet(-PLAYER_BULLET_SPEED * 0.7, -PLAYER_BULLET_SPEED * 0.7, -6, 0);
        pushPlayerBullet(+PLAYER_BULLET_SPEED * 0.7, -PLAYER_BULLET_SPEED * 0.7, +6, 0);
      }
    } else if (w === 'rapid') {
      if (lv === 1) {
        pushPlayerBullet(0, -PLAYER_BULLET_SPEED);
      } else if (lv === 2) {
        pushPlayerBullet(0, -PLAYER_BULLET_SPEED, -3, 0);
        pushPlayerBullet(0, -PLAYER_BULLET_SPEED, +3, 0);
      } else {
        pushPlayerBullet(0, -PLAYER_BULLET_SPEED, -3, 0);
        pushPlayerBullet(0, -PLAYER_BULLET_SPEED, +3, 0);
        pushPlayerBullet(-PLAYER_BULLET_SPEED * 0.5, -PLAYER_BULLET_SPEED * 0.85, -7, 0);
        pushPlayerBullet(+PLAYER_BULLET_SPEED * 0.5, -PLAYER_BULLET_SPEED * 0.85, +7, 0);
      }
    }
  }

  function pushEnemyBullet(x, y, vx, vy, opts) {
    bullets.push({
      x, y, vx, vy,
      owner: (opts && opts.owner) || 'enemy',
      damage: 1,
      isPlayer: false,
    });
  }

  function fireAimedAt(srcX, srcY, speed) {
    const dx = player.x - srcX;
    const dy = player.y - srcY;
    const len = Math.hypot(dx, dy) || 1;
    return { vx: (dx / len) * speed, vy: (dy / len) * speed };
  }

  // ============================================================
  // ENEMY TICK
  // ============================================================

  function tickEnemy(e, dt, deltaMs) {
    const t = nowMs() - e.spawnTime;
    if (e.type === 'shooter') {
      e.x = e.startX + Math.sin(t / 700) * 26;
      e.y += e.vy * dt;
    } else if (e.type === 'zigzag') {
      e.x = e.startX + Math.sin(t / 350) * 50;
      e.y += e.vy * dt;
    } else if (e.type === 'kamikaze') {
      if (!e.kamiLocked) {
        const dx = player.x - e.x;
        const dy = (player.y - e.y) || 1;
        const len = Math.hypot(dx, dy) || 1;
        const sp = ENEMY_TYPES.kamikaze.speed;
        e.vx = (dx / len) * sp;
        e.vy = (dy / len) * sp;
        e.kamiLocked = true;
      }
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    } else {
      e.y += e.vy * dt;
    }

    // firing
    if (e.fireTimer != null && ENEMY_TYPES[e.type].fireMs > 0 && e.y > 10 && e.y < canvasH - 80) {
      e.fireTimer -= deltaMs;
      if (e.fireTimer <= 0) {
        if (e.type === 'shooter') {
          const v = fireAimedAt(e.x, e.y, ENEMY_BULLET_SPEED);
          pushEnemyBullet(e.x, e.y + 8, v.vx, v.vy);
        } else if (e.type === 'tank') {
          const baseAngle = Math.atan2(player.y - e.y, player.x - e.x);
          for (const off of [-0.18, 0, 0.18]) {
            const a = baseAngle + off;
            pushEnemyBullet(e.x, e.y + 10,
              Math.cos(a) * ENEMY_BULLET_SPEED,
              Math.sin(a) * ENEMY_BULLET_SPEED);
          }
        }
        e.fireTimer = ENEMY_TYPES[e.type].fireMs;
      }
    }
  }

  // ============================================================
  // BOSS TICK
  // ============================================================

  function tickBoss(dt, deltaMs) {
    const sp = boss.phase === 1 ? 1.5 : boss.phase === 2 ? 2.5 : 3.5;
    const t = (nowMs() - boss.spawnTime) / 1000;
    const margin = 50;
    boss.x = canvasW / 2 + Math.sin(t * sp * 0.5) * (canvasW / 2 - margin);

    // phase transitions
    const pct = boss.hp / boss.maxHp;
    if (boss.phase === 1 && pct <= 0.66) bossPhaseUp(2);
    else if (boss.phase === 2 && pct <= 0.33) bossPhaseUp(3);

    // firing
    boss.fireTimer -= deltaMs;
    if (boss.fireTimer <= 0) {
      if (boss.phase === 1) {
        const v = fireAimedAt(boss.x, boss.y + boss.h / 2, BOSS_BULLET_SPEED);
        pushEnemyBullet(boss.x, boss.y + boss.h / 2, v.vx, v.vy, { owner: 'boss' });
        boss.fireTimer = 1000;
      } else if (boss.phase === 2) {
        const base = Math.atan2(player.y - boss.y, player.x - boss.x);
        for (const off of [-0.25, 0, 0.25]) {
          const a = base + off;
          pushEnemyBullet(boss.x, boss.y + boss.h / 2,
            Math.cos(a) * BOSS_BULLET_SPEED, Math.sin(a) * BOSS_BULLET_SPEED, { owner: 'boss' });
        }
        boss.fireTimer = 1500;
      } else {
        const base = Math.atan2(player.y - boss.y, player.x - boss.x);
        for (const off of [-0.45, -0.22, 0, 0.22, 0.45]) {
          const a = base + off;
          pushEnemyBullet(boss.x, boss.y + boss.h / 2,
            Math.cos(a) * BOSS_BULLET_SPEED, Math.sin(a) * BOSS_BULLET_SPEED, { owner: 'boss' });
        }
        boss.fireTimer = 1200;
      }
    }

    // backup spawns
    if (boss.phase >= 2) {
      boss.gruntTimer -= deltaMs;
      if (boss.gruntTimer <= 0) {
        spawnEnemy('grunt', 26 + Math.random() * (canvasW - 52), -20);
        boss.gruntTimer = 4000;
      }
    }
    if (boss.phase >= 3) {
      boss.kamiTimer -= deltaMs;
      if (boss.kamiTimer <= 0) {
        spawnEnemy('kamikaze', 26 + Math.random() * (canvasW - 52), -20);
        boss.kamiTimer = 6000;
      }
    }
  }

  function bossPhaseUp(p) {
    boss.phase = p;
    triggerShake(8, 3);
    // guaranteed powerup drop on transition
    spawnPowerupAt(boss.x, boss.y + boss.h / 2, true);
    boss.fireTimer = 0;
    if (p === 2) boss.gruntTimer = 4000;
    if (p === 3) boss.kamiTimer = 6000;
  }

  // ============================================================
  // POWERUPS
  // ============================================================

  function maybeDropPowerupOn(e) {
    let chance = 0.10;
    if (e.type === 'tank') chance = 0.50;
    if (Math.random() < chance) spawnPowerupAt(e.x, e.y, false);
  }

  function spawnPowerupAt(x, y, forced) {
    const r = Math.random();
    let kind;
    if (r < 0.03 && player.lives < PLAYER_LIVES_MAX) kind = 'life';
    else if (r < 0.36) kind = 'spread';
    else if (r < 0.69) kind = 'rapid';
    else kind = 'shield';
    if (forced && kind === 'life' && player.lives >= PLAYER_LIVES_MAX) kind = 'shield';
    powerups.push({ kind, x, y, vy: 1.5, rot: 0 });
  }

  function applyPowerup(kind) {
    if (kind === 'shield') {
      const t = nowMs();
      const remain = Math.max(0, player.shieldUntil - t);
      player.shieldUntil = t + SHIELD_DURATION_MS + remain;
    } else if (kind === 'life') {
      if (player.lives < PLAYER_LIVES_MAX) player.lives++;
    } else {
      const newWeapon = kind === 'spread' ? 'spread' : 'rapid';
      if (player.weapon === newWeapon) {
        player.weaponLevel = Math.min(3, player.weaponLevel + 1);
      } else {
        player.weapon = newWeapon;
        player.weaponLevel = 1;
      }
    }
  }

  // ============================================================
  // PLAYER HIT
  // ============================================================

  function playerIsProtected() {
    const t = nowMs();
    return t < player.shieldUntil || t < player.invincibleUntil;
  }

  function damagePlayer() {
    if (playerIsProtected()) return;
    player.lives--;
    player.invincibleUntil = nowMs() + PLAYER_INVINCIBLE_MS;
    damageFlashUntil = nowMs() + 200;
    triggerShake(4, 2);
    if (player.lives <= 0) {
      gameOver();
    }
  }

  function gameOver() {
    state = 'gameover';
    endStateAt = nowMs();
    finalizeBest();
  }

  function victory() {
    state = 'victory';
    endStateAt = nowMs();
    victoryFlashUntil = nowMs() + 200;
    triggerShake(20, 5);
    score += 5000 + player.lives * 1000;
    finalizeBest();
  }

  function finalizeBest() {
    if (score > best) {
      best = score;
      saveBest(best);
      newBestAt = nowMs();
    }
  }

  function triggerShake(frames, amp) {
    shake.until = nowMs() + frames * (1000 / 60);
    shake.amp = amp;
  }

  // ============================================================
  // KILL / SCORE
  // ============================================================

  function killEnemy(idx, e) {
    deathBurst(e.x, e.y, ENEMY_TYPES[e.type].color, 12);
    awardKill(ENEMY_TYPES[e.type].value);
    maybeDropPowerupOn(e);
    enemies.splice(idx, 1);
  }

  function awardKill(value) {
    const mult = Math.min(COMBO_MAX_MULT, 1.0 + 0.1 * combo);
    score += Math.floor(value * mult);
    combo += 1;
    comboUntil = nowMs() + COMBO_TIMEOUT_MS;
  }

  // ============================================================
  // COLLISION
  // ============================================================

  function bulletHitsEnemy(b, e) {
    const r = ENEMY_TYPES[e.type].size * 0.65;
    const dx = b.x - e.x, dy = b.y - e.y;
    return dx * dx + dy * dy < r * r;
  }
  function bulletHitsBoss(b) {
    return b.x > boss.x - boss.w / 2 && b.x < boss.x + boss.w / 2 &&
           b.y > boss.y - boss.h / 2 && b.y < boss.y + boss.h / 2;
  }
  function bulletHitsPlayer(b) {
    return b.x > player.x - PLAYER_HITBOX_W / 2 &&
           b.x < player.x + PLAYER_HITBOX_W / 2 &&
           b.y > player.y - PLAYER_HITBOX_H / 2 &&
           b.y < player.y + PLAYER_HITBOX_H / 2;
  }
  function enemyHitsPlayer(e) {
    const r = ENEMY_TYPES[e.type].size * 0.55;
    const dx = e.x - player.x, dy = e.y - player.y;
    return dx * dx + dy * dy < (r + PLAYER_HITBOX_W * 0.45) * (r + PLAYER_HITBOX_W * 0.45);
  }
  function powerupHitsPlayer(p) {
    const dx = p.x - player.x, dy = p.y - player.y;
    return Math.abs(dx) < 12 && Math.abs(dy) < 12;
  }

  // ============================================================
  // FRAME UPDATE
  // ============================================================

  function update(deltaMs) {
    if (paused) return;
    if (state === 'gameover' || state === 'victory') return;

    const dt = clamp(deltaMs / (1000 / 60), 0, 2.5); // frame units

    // input → player movement
    const useKeyboard = (nowMs() - input.lastKeyboardMs) < 500;
    if (useKeyboard) {
      if (input.left)  player.x -= PLAYER_SPEED * dt;
      if (input.right) player.x += PLAYER_SPEED * dt;
    } else if (input.touchActive && input.touchX != null) {
      player.x += (input.touchX - player.x) * Math.min(1, 0.30 * dt);
    } else if (input.mouseInside && input.mouseX != null) {
      player.x += (input.mouseX - player.x) * Math.min(1, 0.30 * dt);
    }
    player.x = clamp(player.x, PLAYER_W / 2, canvasW - PLAYER_W / 2);

    // firing
    const wantsFire = (useKeyboard && input.fire)
                  || (!useKeyboard && (input.mouseDown || input.touchActive));
    if (wantsFire) tryPlayerFire();

    // bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      if (b.isPlayer) {
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 3) b.trail.shift();
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < -20 || b.y > canvasH + 20 || b.x < -20 || b.x > canvasW + 20) {
        bullets.splice(i, 1);
      }
    }

    // enemies
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      tickEnemy(e, dt, deltaMs);
      if (e.y > canvasH + 30 || e.x < -40 || e.x > canvasW + 40) {
        enemies.splice(i, 1);
        continue;
      }
      if (enemyHitsPlayer(e)) {
        deathBurst(e.x, e.y, ENEMY_TYPES[e.type].color, 12);
        enemies.splice(i, 1);
        damagePlayer();
        if (state === 'gameover') return;
      }
    }

    // boss
    if (boss) tickBoss(dt, deltaMs);

    // bullet vs enemy / boss / player
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      if (b.isPlayer) {
        let hit = false;
        for (let j = enemies.length - 1; j >= 0; j--) {
          const e = enemies[j];
          if (bulletHitsEnemy(b, e)) {
            e.hp -= b.damage;
            hit = true;
            if (e.hp <= 0) killEnemy(j, e);
            break;
          }
        }
        if (!hit && boss && bulletHitsBoss(b)) {
          boss.hp -= b.damage;
          hit = true;
          if (boss.hp <= 0) {
            // mega explosion
            for (let k = 0; k < 40; k++) {
              pushParticle(boss.x, boss.y, '#e26d6d',
                { speed: rand(1, 4.5), gravity: 0.05, life: 700, size: 2 });
            }
            boss = null;
            victory();
            return;
          }
        }
        if (hit) bullets.splice(i, 1);
      } else {
        if (bulletHitsPlayer(b)) {
          bullets.splice(i, 1);
          damagePlayer();
          if (state === 'gameover') return;
        }
      }
    }

    // powerups
    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.y += p.vy * dt;
      p.rot += 0.04 * dt;
      if (p.y > canvasH + 20) { powerups.splice(i, 1); continue; }
      if (powerupHitsPlayer(p)) {
        applyPowerup(p.kind);
        pickupSparkle(p.x, p.y);
        powerups.splice(i, 1);
      }
    }

    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= deltaMs;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    // stars
    for (const s of stars) {
      s.y += s.vy * dt;
      if (s.y > canvasH) { s.y = -2; s.x = Math.random() * canvasW; }
    }

    // grid scroll
    gridScrollY = (gridScrollY + 0.4 * dt) % 40;

    // combo decay
    if (combo > 0 && nowMs() > comboUntil) combo = 0;

    // wave/state machine
    if (state === 'wave-active') {
      const t = nowMs() - waveStartedAt;
      while (waveSpawnsLeft.length && waveSpawnsLeft[0].at <= t) {
        const s = waveSpawnsLeft.shift();
        spawnEnemy(s.type, s.x, s.y);
      }
      if (waveSpawnsLeft.length === 0 && enemies.length === 0) {
        // wave clear bonus = 100 × wave-number-1-based
        score += 100 * (waveIndex + 1);
        state = 'breather';
        breatherUntil = nowMs() + BREATHER_MS;
        ui.setStatus(`Wave ${waveIndex + 1} cleared`);
      }
    } else if (state === 'breather') {
      if (nowMs() >= breatherUntil) {
        waveIndex++;
        startWave(waveIndex);
      }
    } else if (state === 'boss-fight') {
      // boss tick handled above; victory triggers from bullet collision
    }
  }

  function startWave(idx) {
    bullets = bullets.filter((b) => b.isPlayer); // clear leftover enemy bullets between waves
    if (idx >= WAVES.length || WAVES[idx].boss) {
      spawnBoss();
      state = 'boss-fight';
      ui.setStatus(`Boss · Wave ${idx + 1}/${WAVES.length}`);
      return;
    }
    state = 'wave-active';
    waveStartedAt = nowMs();
    waveSpawnsLeft = expandWave(WAVES[idx]);
    ui.setStatus(`Wave ${idx + 1}/${WAVES.length}`);
  }

  // ============================================================
  // DRAWING
  // ============================================================

  function fillRoundedRect(x, y, w, h, r) {
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
    ctx.fill();
  }

  function drawBackground() {
    // bg fill
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, canvasW, canvasH);
    // grid
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let x = 20; x < canvasW; x += 40) {
      ctx.fillRect(x, 0, 1, canvasH);
    }
    for (let y = (gridScrollY % 40) - 40; y < canvasH; y += 40) {
      ctx.fillRect(0, Math.round(y), canvasW, 1);
    }
  }

  function drawStars() {
    for (const s of stars) {
      ctx.fillStyle = `rgba(255,255,255,${s.alpha})`;
      ctx.fillRect(Math.round(s.x), Math.round(s.y), s.size, s.size);
    }
  }

  function drawPlayer() {
    if (player.lives <= 0) return;
    const t = nowMs();
    const flicker = (Math.sin(t / 60) * 0.5 + 0.5) * 0.4 + 0.6; // 0.6..1.0
    let alpha = 1;
    if (t < player.invincibleUntil) {
      alpha = 0.3 + 0.7 * (Math.sin(t / 40) * 0.5 + 0.5);
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    // engines
    ctx.fillStyle = `rgba(151, 196, 89, ${flicker})`;
    ctx.fillRect(player.x - 5, player.y + PLAYER_H / 2 - 4, 3, 5);
    ctx.fillRect(player.x + 2, player.y + PLAYER_H / 2 - 4, 3, 5);
    // ship triangle
    ctx.fillStyle = '#7f77dd';
    ctx.beginPath();
    ctx.moveTo(player.x, player.y - PLAYER_H / 2);
    ctx.lineTo(player.x + PLAYER_W / 2, player.y + PLAYER_H / 2);
    ctx.lineTo(player.x - PLAYER_W / 2, player.y + PLAYER_H / 2);
    ctx.closePath();
    ctx.fill();
    // shield ring
    if (t < player.shieldUntil) {
      const remain = (player.shieldUntil - t) / SHIELD_DURATION_MS;
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(t / 120);
      ctx.strokeStyle = '#9d96e8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 16, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawEnemies() {
    for (const e of enemies) {
      drawEnemy(e);
    }
  }

  function drawEnemy(e) {
    const t = ENEMY_TYPES[e.type];
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = t.color;

    if (e.type === 'grunt') {
      // red triangle pointing down
      ctx.beginPath();
      ctx.moveTo(0, 8);
      ctx.lineTo(-7, -6);
      ctx.lineTo(7, -6);
      ctx.closePath();
      ctx.fill();
    } else if (e.type === 'shooter') {
      // orange diamond
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(8, 0);
      ctx.lineTo(0, 8);
      ctx.lineTo(-8, 0);
      ctx.closePath();
      ctx.fill();
    } else if (e.type === 'zigzag') {
      // yellow chevron
      ctx.beginPath();
      ctx.moveTo(-7, -6);
      ctx.lineTo(0, 2);
      ctx.lineTo(7, -6);
      ctx.lineTo(0, 8);
      ctx.closePath();
      ctx.fill();
    } else if (e.type === 'tank') {
      // gray hexagon
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const r = 11;
        const px = Math.cos(a) * r, py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      // inner ring detail
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.type === 'kamikaze') {
      // purple triangle (outline only) pointing toward velocity
      const ang = Math.atan2(e.vy, e.vx) - Math.PI / 2;
      ctx.rotate(ang);
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(7, 6);
      ctx.lineTo(-7, 6);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();

    // hp bar (only when damaged)
    if (e.hp < e.maxHp) {
      const pct = Math.max(0, e.hp / e.maxHp);
      const w = 16;
      const x = e.x - w / 2;
      const y = e.y - 13;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(x, y, w, 2);
      ctx.fillStyle = pct > 0.5 ? '#97c459' : pct > 0.25 ? '#fac775' : '#e26d6d';
      ctx.fillRect(x, y, w * pct, 2);
    }
  }

  function drawBoss() {
    if (!boss) return;
    ctx.save();
    ctx.translate(boss.x, boss.y);
    // body
    ctx.fillStyle = '#e26d6d';
    const w = boss.w, h = boss.h;
    ctx.beginPath();
    ctx.moveTo(-w * 0.5, 0);
    ctx.lineTo(-w * 0.30, -h * 0.5);
    ctx.lineTo(+w * 0.30, -h * 0.5);
    ctx.lineTo(+w * 0.5, 0);
    ctx.lineTo(+w * 0.30, +h * 0.5);
    ctx.lineTo(-w * 0.30, +h * 0.5);
    ctx.closePath();
    ctx.fill();
    // accent bar
    ctx.fillStyle = boss.phase === 1 ? 'rgba(0,0,0,0.25)' :
                    boss.phase === 2 ? 'rgba(250,199,117,0.6)' :
                                       'rgba(157, 122, 221, 0.7)';
    ctx.fillRect(-w * 0.3, -3, w * 0.6, 6);
    // "eye" centered
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBossHpBar() {
    if (!boss) return;
    const pad = 8;
    const w = canvasW - pad * 2;
    const x = pad;
    const y = 8;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x, y, w, 4);
    const pct = Math.max(0, boss.hp / boss.maxHp);
    let col = '#e26d6d';
    if (boss.phase === 1) col = '#e26d6d';
    if (boss.phase === 2) col = '#fac775';
    if (boss.phase === 3) col = '#9d7add';
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * pct, 4);
  }

  function drawBullets() {
    for (const b of bullets) {
      if (b.isPlayer) {
        // trail echoes
        if (b.trail) {
          for (let i = 0; i < b.trail.length; i++) {
            const t = b.trail[i];
            const a = (i + 1) / (b.trail.length + 1) * 0.5;
            ctx.fillStyle = `rgba(255, 224, 102, ${a})`;
            ctx.fillRect(t.x - 1.5, t.y - 4, 3, 8);
          }
        }
        ctx.fillStyle = '#ffe066';
        ctx.fillRect(b.x - 1.5, b.y - 4, 3, 8);
      } else {
        // enemy/boss bullet — red circle
        ctx.fillStyle = b.owner === 'boss' ? '#ff7878' : '#e26d6d';
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.arc(b.x - 1, b.y - 1, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawPowerups() {
    for (const p of powerups) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      const size = 14;
      let color = '#7f77dd', letter = 'S';
      if (p.kind === 'spread') { color = '#7f77dd'; letter = 'S'; }
      else if (p.kind === 'rapid') { color = '#f5d76e'; letter = 'R'; }
      else if (p.kind === 'shield') { color = '#97c459'; letter = '+'; }
      else if (p.kind === 'life') { color = '#e26d6d'; letter = '\u2665'; }
      ctx.fillStyle = color;
      fillRoundedRect(-size / 2, -size / 2, size, size, 3);
      ctx.fillStyle = '#1a1a1f';
      ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, 0, 1);
      ctx.restore();
    }
  }

  function drawHud() {
    const t = nowMs();
    // top-left score
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#e8e8ea';
    ctx.font = '12px "SF Mono", Menlo, Consolas, monospace';
    ctx.fillText(`Score: ${score.toLocaleString()}`, 8, boss ? 18 : 8);

    // combo multiplier next to score, fading
    if (combo > 0) {
      const mult = Math.min(COMBO_MAX_MULT, 1 + 0.1 * combo);
      const remain = Math.max(0, comboUntil - t);
      const alpha = Math.min(1, remain / 1000);
      ctx.fillStyle = `rgba(151, 196, 89, ${alpha})`;
      ctx.font = 'bold 11px "SF Mono", Menlo, Consolas, monospace';
      ctx.fillText(`x${mult.toFixed(1)}`, 8, (boss ? 18 : 8) + 14);
    }

    // top-right lives
    ctx.textAlign = 'right';
    let hearts = '';
    for (let i = 0; i < player.lives; i++) hearts += '\u2665';
    ctx.fillStyle = '#e26d6d';
    ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(hearts, canvasW - 8, boss ? 16 : 6);

    // top-center wave + progress
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8e8ea';
    ctx.font = '11px "SF Mono", Menlo, Consolas, monospace';
    const waveLabel = state === 'boss-fight' || state === 'victory'
      ? `Boss · Wave ${WAVES.length}/${WAVES.length}`
      : `Wave ${Math.min(waveIndex + 1, WAVES.length)}/${WAVES.length}`;
    ctx.fillText(waveLabel, canvasW / 2, boss ? 18 : 8);
    // thin progress bar under wave label
    const barW = 80;
    const barX = canvasW / 2 - barW / 2;
    const barY = (boss ? 18 : 8) + 14;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(barX, barY, barW, 2);
    const progress = Math.min(1, (waveIndex + (state === 'breather' || state === 'wave-active' ? 0 : 1)) / WAVES.length);
    ctx.fillStyle = '#7f77dd';
    ctx.fillRect(barX, barY, barW * progress, 2);

    // NEW BEST pulse
    if (newBestAt > 0 && t - newBestAt < NEW_BEST_MS) {
      const k = (t - newBestAt) / NEW_BEST_MS;
      const a = 0.6 + 0.4 * Math.sin(k * 18);
      ctx.fillStyle = `rgba(151, 196, 89, ${a})`;
      ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('NEW BEST!', 8, (boss ? 18 : 8) + 30);
    }
  }

  function drawDamageFlash() {
    if (nowMs() < damageFlashUntil) {
      const k = (damageFlashUntil - nowMs()) / 200;
      ctx.fillStyle = `rgba(226, 109, 109, ${k * 0.30})`;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }
    if (nowMs() < victoryFlashUntil) {
      const k = (victoryFlashUntil - nowMs()) / 200;
      ctx.fillStyle = `rgba(255,255,255,${k * 0.45})`;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }
  }

  function drawBreatherOverlay() {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8e8ea';
    ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(`Wave ${waveIndex + 1} cleared!`, canvasW / 2, canvasH / 2 - 6);
    ctx.fillStyle = '#8a8a93';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(`Wave ${waveIndex + 2} incoming...`, canvasW / 2, canvasH / 2 + 14);
  }

  function drawCenteredCard(lines, headlineColor) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, canvasW, canvasH);
    const cardW = Math.min(240, canvasW - 30);
    const cardH = 22 * lines.length + 36;
    const cx = (canvasW - cardW) / 2;
    const cy = (canvasH - cardH) / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    fillRoundedRect(cx, cy, cardW, cardH, 12);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(cx + 0.5, cy + 0.5, cardW - 1, cardH - 1);

    ctx.textAlign = 'center';
    let y = cy + 24;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      ctx.fillStyle = i === 0 ? (headlineColor || '#e8e8ea') : (ln.muted ? '#8a8a93' : '#e8e8ea');
      ctx.font = i === 0
        ? 'bold 16px -apple-system, BlinkMacSystemFont, sans-serif'
        : '12px "SF Mono", Menlo, Consolas, monospace';
      ctx.fillText(ln.text != null ? ln.text : ln, canvasW / 2, y);
      y += 22;
    }
  }

  function drawPauseOverlay() {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8e8ea';
    ctx.font = '16px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('Paused', canvasW / 2, canvasH / 2 - 4);
    ctx.fillStyle = '#8a8a93';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('press P to resume', canvasW / 2, canvasH / 2 + 16);
  }

  function drawGameOver() {
    const grace = nowMs() < endStateAt + RESTART_GRACE_MS;
    drawCenteredCard([
      'GAME OVER',
      `Score: ${score.toLocaleString()}`,
      { text: `Best:  ${best.toLocaleString()}`, muted: true },
      { text: grace ? '...' : 'press R to restart', muted: true },
    ], '#e26d6d');
  }

  function drawVictory() {
    const grace = nowMs() < endStateAt + RESTART_GRACE_MS;
    drawCenteredCard([
      'VICTORY',
      `Score: ${score.toLocaleString()}`,
      { text: `Lives left: ${player.lives}`, muted: true },
      { text: `Best: ${best.toLocaleString()}`, muted: true },
      { text: grace ? '...' : 'press R to play again', muted: true },
    ], '#97c459');
  }

  function draw() {
    drawBackground();

    // shake
    const t = nowMs();
    let sx = 0, sy = 0;
    if (t < shake.until) {
      sx = (Math.random() - 0.5) * shake.amp * 2;
      sy = (Math.random() - 0.5) * shake.amp * 2;
    }
    ctx.save();
    ctx.translate(sx, sy);

    drawStars();
    drawPowerups();
    drawBullets();
    drawEnemies();
    drawParticles();
    drawPlayer();
    drawBoss();

    ctx.restore();

    drawBossHpBar();
    drawHud();
    drawDamageFlash();

    if (state === 'breather') drawBreatherOverlay();
    if (paused && state !== 'gameover' && state !== 'victory') drawPauseOverlay();
    if (state === 'gameover') drawGameOver();
    if (state === 'victory') drawVictory();
  }

  // ============================================================
  // LOOP
  // ============================================================

  function loop(ts) {
    if (lastFrame == null) lastFrame = ts;
    let deltaMs = ts - lastFrame;
    if (deltaMs > 100) deltaMs = 100; // clamp tab-switch hiccups
    lastFrame = ts;

    update(deltaMs);
    draw();

    rafId = requestAnimationFrame(loop);
  }

  // ============================================================
  // INPUT
  // ============================================================

  function isMoveLeft(k)  { return k === 'ArrowLeft'  || k === 'a' || k === 'A'; }
  function isMoveRight(k) { return k === 'ArrowRight' || k === 'd' || k === 'D'; }
  function isFire(k)      { return k === ' ' || k === 'Spacebar' || k === 'z' || k === 'Z'; }
  function isPause(k)     { return k === 'p' || k === 'P' || k === 'Escape'; }
  function isRestart(k)   { return k === 'r' || k === 'R'; }

  function onKeyDown(e) {
    if (state === 'gameover' || state === 'victory') {
      if (isRestart(e.key) && nowMs() > endStateAt + RESTART_GRACE_MS) {
        e.preventDefault();
        restartGame();
      }
      return;
    }
    if (isPause(e.key)) {
      e.preventDefault();
      togglePause();
      return;
    }
    let consumed = false;
    if (isMoveLeft(e.key))  { input.left = true;  consumed = true; }
    if (isMoveRight(e.key)) { input.right = true; consumed = true; }
    if (isFire(e.key))      { input.fire = true;  consumed = true; }
    if (consumed) {
      input.lastKeyboardMs = nowMs();
      e.preventDefault();
    }
  }

  function onKeyUp(e) {
    if (isMoveLeft(e.key))  input.left = false;
    if (isMoveRight(e.key)) input.right = false;
    if (isFire(e.key))      input.fire = false;
  }

  function eventCanvasXY(e) {
    const rect = canvas.getBoundingClientRect();
    let cx, cy;
    if (e.touches && e.touches[0])           { cx = e.touches[0].clientX; cy = e.touches[0].clientY; }
    else if (e.changedTouches && e.changedTouches[0]) { cx = e.changedTouches[0].clientX; cy = e.changedTouches[0].clientY; }
    else                                     { cx = e.clientX; cy = e.clientY; }
    return {
      x: (cx - rect.left) * (canvasW / rect.width),
      y: (cy - rect.top)  * (canvasH / rect.height),
    };
  }

  function onMouseMove(e) {
    const p = eventCanvasXY(e);
    input.mouseX = p.x;
    input.mouseInside = true;
  }
  function onMouseEnter() { input.mouseInside = true; }
  function onMouseLeave() { input.mouseInside = false; input.mouseDown = false; }
  function onMouseDown(e) {
    e.preventDefault();
    if (state === 'gameover' || state === 'victory') {
      if (nowMs() > endStateAt + RESTART_GRACE_MS) restartGame();
      return;
    }
    if (paused) { togglePause(); return; }
    input.mouseDown = true;
  }
  function onMouseUp() { input.mouseDown = false; }
  function onTouchStart(e) {
    e.preventDefault();
    if (state === 'gameover' || state === 'victory') {
      if (nowMs() > endStateAt + RESTART_GRACE_MS) restartGame();
      return;
    }
    if (paused) { togglePause(); return; }
    const p = eventCanvasXY(e);
    input.touchActive = true;
    input.touchX = p.x;
  }
  function onTouchMove(e) {
    if (!input.touchActive) return;
    e.preventDefault();
    const p = eventCanvasXY(e);
    input.touchX = p.x;
  }
  function onTouchEnd() {
    input.touchActive = false;
    input.touchX = null;
  }

  function togglePause() {
    if (state === 'gameover' || state === 'victory') return;
    paused = !paused;
  }

  function onVisibility() {
    if (document.hidden) paused = true;
  }

  // ============================================================
  // RESTART
  // ============================================================

  function restartGame() {
    bullets = [];
    enemies = [];
    powerups = [];
    particles = [];
    boss = null;
    player = makePlayer();
    waveIndex = 0;
    score = 0;
    combo = 0;
    comboUntil = 0;
    paused = false;
    damageFlashUntil = 0;
    victoryFlashUntil = 0;
    newBestAt = 0;
    shake.until = 0;
    startWave(0);
  }

  // ============================================================
  // MOUNT / UNMOUNT
  // ============================================================

  function ensureRootCss() {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    if (!cs.getPropertyValue('--shooter-bg').trim()) {
      root.style.setProperty('--shooter-bg', '#0a0a14');
    }
    if (!cs.getPropertyValue('--shooter-grid').trim()) {
      root.style.setProperty('--shooter-grid', 'rgba(255, 255, 255, 0.04)');
    }
  }

  function buildSkeleton() {
    wrap = document.createElement('div');
    wrap.className = 'shooter-wrap';
    container.appendChild(wrap);

    canvas = document.createElement('canvas');
    canvas.className = 'shooter-canvas';
    wrap.appendChild(canvas);

    const measured = wrap.clientWidth || 320;
    canvasW = clamp(measured, CANVAS_W_MIN, CANVAS_W_MAX);
    canvasH = CANVAS_H;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvasW * dpr);
    canvas.height = Math.round(canvasH * dpr);
    canvas.style.width = canvasW + 'px';
    canvas.style.height = canvasH + 'px';
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
  }

  function mount(c, u) {
    container = c;
    ui = u;
    ensureRootCss();

    container.innerHTML = '';
    buildSkeleton();

    best = loadBest();
    stars = makeStars();
    player = makePlayer();
    bullets = []; enemies = []; powerups = []; particles = [];
    boss = null;
    waveIndex = 0;
    score = 0;
    combo = 0;
    comboUntil = 0;
    paused = false;
    damageFlashUntil = 0;
    victoryFlashUntil = 0;
    newBestAt = 0;
    shake = { until: 0, amp: 0 };
    input.left = input.right = input.fire = false;
    input.mouseDown = false;
    input.mouseInside = false;
    input.mouseX = null;
    input.touchActive = false;
    input.touchX = null;
    input.lastKeyboardMs = 0;

    ui.setStatusWin(false);
    ui.setSubtitle(`Best: ${best.toLocaleString()}`);

    startWave(0);

    ui.setControls([
      { type: 'button', label: 'Pause',   onClick: togglePause },
      { type: 'button', label: 'Restart', onClick: restartGame },
    ]);

    keyDownH = onKeyDown;
    keyUpH = onKeyUp;
    visH = onVisibility;
    mouseMoveH = onMouseMove;
    mouseDownH = onMouseDown;
    mouseUpH = onMouseUp;
    mouseEnterH = onMouseEnter;
    mouseLeaveH = onMouseLeave;
    touchStartH = onTouchStart;
    touchMoveH = onTouchMove;
    touchEndH = onTouchEnd;

    document.addEventListener('keydown', keyDownH);
    document.addEventListener('keyup', keyUpH);
    document.addEventListener('visibilitychange', visH);
    canvas.addEventListener('mousemove', mouseMoveH);
    canvas.addEventListener('mousedown', mouseDownH);
    window.addEventListener('mouseup', mouseUpH);
    canvas.addEventListener('mouseenter', mouseEnterH);
    canvas.addEventListener('mouseleave', mouseLeaveH);
    canvas.addEventListener('touchstart', touchStartH, { passive: false });
    window.addEventListener('touchmove', touchMoveH, { passive: false });
    window.addEventListener('touchend', touchEndH);
    window.addEventListener('touchcancel', touchEndH);

    lastFrame = null;
    rafId = requestAnimationFrame(loop);
  }

  function unmount() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    lastFrame = null;

    if (keyDownH)   document.removeEventListener('keydown', keyDownH);
    if (keyUpH)     document.removeEventListener('keyup', keyUpH);
    if (visH)       document.removeEventListener('visibilitychange', visH);
    if (canvas) {
      if (mouseMoveH)  canvas.removeEventListener('mousemove', mouseMoveH);
      if (mouseDownH)  canvas.removeEventListener('mousedown', mouseDownH);
      if (mouseEnterH) canvas.removeEventListener('mouseenter', mouseEnterH);
      if (mouseLeaveH) canvas.removeEventListener('mouseleave', mouseLeaveH);
      if (touchStartH) canvas.removeEventListener('touchstart', touchStartH);
    }
    if (mouseUpH)   window.removeEventListener('mouseup', mouseUpH);
    if (touchMoveH) window.removeEventListener('touchmove', touchMoveH);
    if (touchEndH)  {
      window.removeEventListener('touchend', touchEndH);
      window.removeEventListener('touchcancel', touchEndH);
    }
    keyDownH = keyUpH = visH = null;
    mouseMoveH = mouseDownH = mouseUpH = mouseEnterH = mouseLeaveH = null;
    touchStartH = touchMoveH = touchEndH = null;

    if (container) container.innerHTML = '';
    container = null;
    ui = null;
    wrap = canvas = ctx = null;
    bullets = []; enemies = []; powerups = []; particles = []; stars = [];
    player = null; boss = null;
  }

  window.ShooterGame = { name: 'Shooter', mount, unmount };
})();
