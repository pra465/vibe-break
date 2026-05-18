// Ghost Man Advanced — original maze-chase arcade game.
// Neon CRT palette, original 15x15 maze, original character/enemy art,
// 4 enemy AI archetypes, power-food frightened mode, level progression.
// Inspired by 80s maze-chase games but no Pac-Man assets/branding.
// Exports window.GhostManGame = { name, mount(container, ui), unmount() }.

(function () {
  // ---------- Maze ----------
  // # = wall, . = pellet, o = power food, G = enemy spawn, P = player spawn
  const MAZE_TEMPLATE = [
    '###############',
    '#......#......#',
    '#.##.#.#.#.##.#',
    '#o..#.....#..o#',
    '#.#.#.###.#.#.#',
    '#.....#.#.....#',
    '#.###.#.#.###.#',
    '#...G.G.G.G...#',
    '#.###.###.###.#',
    '#.....#.#.....#',
    '#.#.#.###.#.#.#',
    '#o..#.....#..o#',
    '#.##.#.#.#.##.#',
    '#......P......#',
    '###############',
  ];
  const ROWS = MAZE_TEMPLATE.length;
  const COLS = MAZE_TEMPLATE[0].length;

  // ---------- Tuning ----------
  const PLAYER_SPEED = 6.2;
  const GHOST_SPEEDS = { chaser: 5.4, ambusher: 5.2, patroller: 4.9, wanderer: 5.1 };
  const FRIGHTENED_SPEED = 3.4;
  const POWER_START = 7.0;
  const POWER_MIN = 3.0;
  const POWER_DECAY_PER_LEVEL = 0.6;
  const DYING_DURATION = 1.2;
  const LEVEL_END_DURATION = 1.7;
  const SCORE_PELLET = 10;
  const SCORE_POWER = 50;
  const SCORE_GHOST_BASE = 200;
  const SCORE_LEVEL_BONUS = 500;
  const BEST_KEY = 'vibebreak.ghostman.best';

  // ---------- Palette ----------
  const COLOR_BG = '#080816';
  const COLOR_WALL = '#3a5fc8';
  const COLOR_WALL_HI = '#6a90ff';
  const COLOR_PELLET = '#f4e8c5';
  const COLOR_POWER = '#fff48d';
  const COLOR_PLAYER = '#a45df3';
  const COLOR_PLAYER_HI = '#cda1ff';
  const COLOR_FRIGHTENED = '#1d3df0';
  const COLOR_GHOST = ['#ff5d8f', '#4cee72', '#ff8d3a', '#df5dff'];

  const DIRS = [
    { dx:  1, dy:  0 },
    { dx:  0, dy:  1 },
    { dx: -1, dy:  0 },
    { dx:  0, dy: -1 },
  ];
  const KEY_TO_DIR = {
    ArrowRight: 0, d: 0, D: 0,
    ArrowDown:  1, s: 1, S: 1,
    ArrowLeft:  2, a: 2, A: 2,
    ArrowUp:    3, w: 3, W: 3,
  };
  function opposite(d) { return (d + 2) % 4; }

  // ---------- Module state ----------
  let container = null, ui = null;
  let wrap = null, canvas = null, ctx = null;
  let W = 0, H = 0, dpr = 1;
  let TILE = 20, offX = 0, offY = 0;
  let rafHandle = null, lastTime = 0;
  let resizeObserver = null;

  let grid = null;
  let player = null;
  let ghosts = null;
  let particles = [];
  let popups = [];
  let score = 0, lives = 3, level = 1, best = 0;
  let pelletsLeft = 0;
  let powerTimer = 0;
  let powerDurationCurrent = POWER_START;
  let ghostsEatenInCombo = 0;
  let mode = 'menu';
  let modeTimer = 0;
  let shake = 0;
  let levelFlashT = 0;
  let extraLifeAwarded = false;
  let keys = {};
  let keydownHandler = null, keyupHandler = null, visHandler = null;
  let audioCtx = null;
  let _lastStatus = null, _lastSubtitle = null;

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
  function tone(freq, dur, type, vol, slideTo) {
    const ac = ensureAudio();
    if (!ac) return;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    if (slideTo != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), ac.currentTime + dur);
    }
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.connect(g).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + dur);
  }
  function playPellet() { tone(880 + Math.random() * 120, 0.04, 'square', 0.02); }
  function playPower()  { tone(220, 0.4, 'sawtooth', 0.06, 900); }
  function playGhost()  { tone(440, 0.2, 'square', 0.06, 1320); }
  function playDie()    { tone(660, 0.7, 'sawtooth', 0.08, 80); }
  function playStart() {
    tone(330, 0.13, 'triangle', 0.05);
    setTimeout(() => tone(440, 0.13, 'triangle', 0.05), 110);
    setTimeout(() => tone(660, 0.18, 'triangle', 0.05), 220);
  }
  function playLevel()  { tone(523, 0.18, 'triangle', 0.06); setTimeout(() => tone(784, 0.25, 'triangle', 0.06), 160); }

  // ---------- Best score ----------
  function loadBest() {
    try { return +(localStorage.getItem(BEST_KEY)) || 0; }
    catch (_) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem(BEST_KEY, String(Math.floor(v))); }
    catch (_) {}
  }

  // ---------- Maze ----------
  function buildGrid() {
    grid = [];
    for (let r = 0; r < ROWS; r++) grid.push(MAZE_TEMPLATE[r].split(''));
    pelletsLeft = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] === '.' || grid[r][c] === 'o') pelletsLeft++;
      }
    }
  }

  function canEnter(row, col) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return false;
    return grid[row][col] !== '#';
  }

  function findSpawn(ch) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (MAZE_TEMPLATE[r][c] === ch) return { row: r, col: c };
      }
    }
    return { row: 1, col: 1 };
  }
  function findAllSpawns(ch) {
    const out = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (MAZE_TEMPLATE[r][c] === ch) out.push({ row: r, col: c });
      }
    }
    return out;
  }

  // ---------- Entities ----------
  function makePlayer() {
    const sp = findSpawn('P');
    return {
      kind: 'player',
      col: sp.col, row: sp.row,
      dir: null,
      progress: 0,
      queuedDir: null,
      speed: PLAYER_SPEED,
      mouth: 0,
    };
  }

  function spawnGhosts(lv) {
    const count = Math.min(4, 1 + lv);
    const spawns = findAllSpawns('G');
    const types = ['chaser', 'wanderer', 'patroller', 'ambusher'];
    const corners = [
      { row: 1, col: 1 },
      { row: 1, col: COLS - 2 },
      { row: ROWS - 2, col: 1 },
      { row: ROWS - 2, col: COLS - 2 },
    ];
    const list = [];
    const boost = Math.min(2.5, (lv - 1) * 0.25);
    for (let i = 0; i < count; i++) {
      const sp = spawns[i % spawns.length];
      const type = types[i % types.length];
      list.push({
        kind: 'ghost',
        idx: i,
        type,
        col: sp.col, row: sp.row,
        spawnCol: sp.col, spawnRow: sp.row,
        dir: i % 2 === 0 ? 0 : 2,
        progress: 0,
        speed: GHOST_SPEEDS[type] + boost,
        baseSpeed: GHOST_SPEEDS[type] + boost,
        frightened: false,
        eaten: false,
        patrolTarget: corners[i % corners.length],
      });
    }
    return list;
  }

  // ---------- Level / state ----------
  function startLevel(lv) {
    level = lv;
    buildGrid();
    player = makePlayer();
    ghosts = spawnGhosts(lv);
    powerTimer = 0;
    powerDurationCurrent = Math.max(POWER_MIN, POWER_START - (lv - 1) * POWER_DECAY_PER_LEVEL);
    ghostsEatenInCombo = 0;
    particles = [];
    popups = [];
    shake = 0;
    levelFlashT = 0;
    mode = 'playing';
    pushHUD();
    playStart();
  }

  function nextLevel() {
    addScore(SCORE_LEVEL_BONUS);
    playLevel();
    startLevel(level + 1);
  }

  function resetPositionsKeepLevel() {
    player = makePlayer();
    ghosts = spawnGhosts(level);
    powerTimer = 0;
    ghostsEatenInCombo = 0;
    mode = 'playing';
    pushHUD();
  }

  function startMenu() {
    score = 0;
    lives = 3;
    level = 1;
    extraLifeAwarded = false;
    buildGrid();
    player = makePlayer();
    ghosts = spawnGhosts(1);
    powerTimer = 0;
    mode = 'menu';
    modeTimer = 0;
    shake = 0;
    particles = [];
    popups = [];
    pushHUD();
    ui.setControls([
      { type: 'button', label: 'Start', onClick: (e) => { if (e && e.target) e.target.blur(); ensureAudio(); startGame(); } },
    ]);
  }

  function startGame() {
    score = 0;
    lives = 3;
    level = 1;
    extraLifeAwarded = false;
    startLevel(1);
    ui.setControls([]);
  }

  function gameOver() {
    mode = 'gameover';
    if (score > best) { best = Math.floor(score); saveBest(best); }
    pushHUD();
    ui.setControls([
      { type: 'button', label: 'Play again', onClick: (e) => { if (e && e.target) e.target.blur(); startGame(); } },
    ]);
  }

  function setStatusOnce(s) {
    if (_lastStatus !== s) { ui.setStatus(s); _lastStatus = s; }
  }
  function setSubtitleOnce(s) {
    if (_lastSubtitle !== s) { ui.setSubtitle(s); _lastSubtitle = s; }
  }
  function pushHUD() {
    ui.setStatusWin(false);
    setStatusOnce(String(score));
    let sub;
    if (mode === 'menu') sub = `Ghost Man · best ${best} · Press Start`;
    else if (mode === 'gameover') sub = `Game over · ${score} pts · best ${best}`;
    else if (powerTimer > 0) sub = `POWER ${powerTimer.toFixed(1)}s · L${level} · ${heartString()}`;
    else sub = `L${level} · ${heartString()} · best ${best}`;
    setSubtitleOnce(sub);
  }
  function heartString() {
    if (lives <= 0) return '';
    return '♥'.repeat(Math.min(lives, 5));
  }

  // ---------- Scoring helpers ----------
  function addScore(n) {
    score += n;
    if (score > best) { best = Math.floor(score); saveBest(best); }
    if (!extraLifeAwarded && score >= 10000) { extraLifeAwarded = true; lives++; }
  }
  function pushPopup(text, x, y, color) {
    popups.push({ text, x, y, color: color || '#fff48d', life: 1.0, vy: -28 });
  }
  function pushBurst(x, y, color) {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 30 + Math.random() * 50;
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.4, r: 1.8 + Math.random() * 2, color,
      });
    }
  }

  // ---------- Input ----------
  function applyDirection(e, newDir) {
    if (newDir === e.dir) return true;
    if (e.dir == null) {
      if (canEnter(e.row + DIRS[newDir].dy, e.col + DIRS[newDir].dx)) {
        e.dir = newDir;
        e.progress = 0;
        return true;
      }
      return false;
    }
    if (newDir === opposite(e.dir)) {
      // reverse mid-traversal
      e.col += DIRS[e.dir].dx;
      e.row += DIRS[e.dir].dy;
      e.dir = newDir;
      e.progress = 1 - e.progress;
      return true;
    }
    // perpendicular only valid at cell center
    if (e.progress < 0.02 && canEnter(e.row + DIRS[newDir].dy, e.col + DIRS[newDir].dx)) {
      e.dir = newDir;
      e.progress = 0;
      return true;
    }
    return false;
  }
  function onPlayerInput(dir) {
    if (mode !== 'playing') return;
    if (applyDirection(player, dir)) {
      player.queuedDir = null;
    } else {
      player.queuedDir = dir;
    }
  }

  // ---------- Movement ----------
  function tickEntity(e, dt, isPlayer) {
    if (e.dir == null) {
      if (isPlayer && player.queuedDir != null) {
        if (applyDirection(player, player.queuedDir)) player.queuedDir = null;
      }
      return;
    }
    e.progress += e.speed * dt;
    if (e.progress >= 1) {
      const d = DIRS[e.dir];
      e.col += d.dx;
      e.row += d.dy;
      e.progress -= 1;
      if (e.progress > 0.999) e.progress = 0;

      if (isPlayer) {
        eatHere();
        // Allow queued perpendicular turn at the new cell
        if (player.queuedDir != null) {
          const qd = DIRS[player.queuedDir];
          if (canEnter(player.row + qd.dy, player.col + qd.dx)) {
            player.dir = player.queuedDir;
            player.queuedDir = null;
            player.progress = 0;
          }
        }
      } else {
        ghostDecide(e);
      }

      // Stop if blocked ahead
      const nd = DIRS[e.dir];
      if (!canEnter(e.row + nd.dy, e.col + nd.dx)) {
        if (isPlayer) {
          e.dir = null;
          e.progress = 0;
        } else {
          // ghosts shouldn't stop — try a fallback
          e.progress = 0;
          ghostDecide(e);
        }
      }
    }
  }

  function eatHere() {
    const ch = grid[player.row][player.col];
    if (ch === '.') {
      grid[player.row][player.col] = ' ';
      pelletsLeft--;
      addScore(SCORE_PELLET);
      const { x, y } = entityPixel(player);
      pushBurst(x, y, COLOR_PELLET);
      playPellet();
      if (pelletsLeft <= 0) winLevel();
    } else if (ch === 'o') {
      grid[player.row][player.col] = ' ';
      pelletsLeft--;
      addScore(SCORE_POWER);
      const { x, y } = entityPixel(player);
      pushBurst(x, y, COLOR_POWER);
      pushBurst(x, y, COLOR_POWER);
      powerTimer = powerDurationCurrent;
      ghostsEatenInCombo = 0;
      // Set ghosts to frightened (except eaten ones returning home)
      for (const g of ghosts) {
        if (!g.eaten) {
          g.frightened = true;
          g.speed = FRIGHTENED_SPEED;
          // classic-style reverse on power-up
          g.dir = opposite(g.dir);
          g.progress = 1 - g.progress;
          const ndir = DIRS[g.dir];
          // swap col/row to reflect new direction's "from" cell
          // We need to invert: the cell we were heading INTO becomes our new "from".
          // applyDirection's reverse logic does this already; simulate it:
          // (we already changed dir; need to shift cell too)
          // But progress was just inverted, so the cell pair flipped.
          // To keep consistent: original "ahead" cell = (e.col + d.dx, e.row + d.dy) where d was old dir.
          // After reversing: new "from" = old "to". So col,row should be old "to" cell.
          // Simpler: jump to the old destination, set progress = 1 - oldProgress.
          // But oldProgress is already inverted. Untangling — use direct method:
          // (Already handled by progress inversion alone; col/row stay the same;
          //  this means the ghost is now between (col,row) and (col-d.dx, col-d.dy). Wait that's wrong.)
          // Easier: just keep col/row where they were and let progress + new dir
          // create the smooth reverse. Since progress represents distance from
          // (col,row) toward (col+dir.dx, row+dir.dy), changing dir flips the
          // target cell, so the ghost is now moving back from where it was heading.
          // The visual will be a smooth reverse provided progress is recomputed below.
          // Reset to a clean state instead:
          g.progress = 0;
          // Pick a valid backward direction
          const back = ndir;
          if (!canEnter(g.row + back.dy, g.col + back.dx)) {
            // can't reverse — keep facing player's chosen direction; ghostDecide will fix
          }
        }
      }
      playPower();
      if (pelletsLeft <= 0) winLevel();
    }
  }

  function winLevel() {
    mode = 'levelEnd';
    modeTimer = LEVEL_END_DURATION;
    levelFlashT = 0;
  }

  // ---------- Ghost AI ----------
  function ghostDecide(g) {
    if (g.eaten) {
      if (g.row === g.spawnRow && g.col === g.spawnCol) {
        // arrived home
        g.eaten = false;
        g.frightened = powerTimer > 0;
        g.speed = g.frightened ? FRIGHTENED_SPEED : g.baseSpeed;
      } else {
        g.dir = pickDirToward(g, { row: g.spawnRow, col: g.spawnCol }, false);
        return;
      }
    }

    let target = null;
    let away = false;

    if (g.frightened) {
      away = true;
      target = { row: player.row, col: player.col };
    } else {
      switch (g.type) {
        case 'chaser':
          target = { row: player.row, col: player.col };
          break;
        case 'ambusher': {
          const pd = player.dir != null ? DIRS[player.dir] : { dx: 0, dy: 0 };
          target = { row: player.row + pd.dy * 4, col: player.col + pd.dx * 4 };
          break;
        }
        case 'patroller':
          if (g.col === g.patrolTarget.col && g.row === g.patrolTarget.row) {
            const corners = [
              { row: 1, col: 1 },
              { row: 1, col: COLS - 2 },
              { row: ROWS - 2, col: 1 },
              { row: ROWS - 2, col: COLS - 2 },
            ];
            g.patrolTarget = corners[Math.floor(Math.random() * corners.length)];
          }
          target = g.patrolTarget;
          break;
        case 'wanderer': {
          const dist = Math.abs(g.row - player.row) + Math.abs(g.col - player.col);
          if (dist < 6 && Math.random() < 0.45) {
            target = { row: player.row, col: player.col };
          } else {
            g.dir = pickRandomDir(g);
            return;
          }
          break;
        }
      }
    }
    g.dir = pickDirToward(g, target, away);
  }

  function validDirs(g) {
    const opts = [];
    for (let d = 0; d < 4; d++) {
      if (d === opposite(g.dir)) continue;
      const nr = g.row + DIRS[d].dy;
      const nc = g.col + DIRS[d].dx;
      if (canEnter(nr, nc)) opts.push(d);
    }
    return opts;
  }
  function pickRandomDir(g) {
    const opts = validDirs(g);
    if (opts.length === 0) return opposite(g.dir);
    return opts[Math.floor(Math.random() * opts.length)];
  }
  function pickDirToward(g, target, away) {
    const opts = validDirs(g);
    if (opts.length === 0) return opposite(g.dir);
    let best = opts[0], bestScore = away ? -Infinity : Infinity;
    for (const d of opts) {
      const nr = g.row + DIRS[d].dy;
      const nc = g.col + DIRS[d].dx;
      const sd = (nr - target.row) ** 2 + (nc - target.col) ** 2;
      if (away ? sd > bestScore : sd < bestScore) {
        bestScore = sd;
        best = d;
      }
    }
    return best;
  }

  // ---------- Collisions ----------
  function checkCollisions() {
    const pp = entityPixel(player);
    for (const g of ghosts) {
      if (g.eaten) continue;
      const gp = entityPixel(g);
      const dx = pp.x - gp.x, dy = pp.y - gp.y;
      if (dx * dx + dy * dy < (TILE * 0.55) ** 2) {
        if (g.frightened) eatGhost(g);
        else { die(); return; }
      }
    }
  }
  function eatGhost(g) {
    g.eaten = true;
    g.frightened = false;
    g.speed = PLAYER_SPEED + 2.5;
    ghostsEatenInCombo++;
    const pts = SCORE_GHOST_BASE * (1 << (ghostsEatenInCombo - 1));
    addScore(pts);
    const gp = entityPixel(g);
    pushPopup(`+${pts}`, gp.x, gp.y, '#7fe7ff');
    pushBurst(gp.x, gp.y, '#7fe7ff');
    shake = Math.max(shake, 6);
    playGhost();
  }
  function die() {
    mode = 'dying';
    modeTimer = DYING_DURATION;
    shake = Math.max(shake, 10);
    playDie();
  }

  // ---------- Update ----------
  function update(dt) {
    if (shake > 0) shake = Math.max(0, shake - dt * 30);

    if (mode === 'menu' || mode === 'gameover') {
      stepParticles(dt); stepPopups(dt);
      return;
    }
    if (mode === 'dying') {
      modeTimer -= dt;
      stepParticles(dt); stepPopups(dt);
      if (modeTimer <= 0) {
        lives--;
        if (lives <= 0) gameOver();
        else resetPositionsKeepLevel();
      }
      return;
    }
    if (mode === 'levelEnd') {
      modeTimer -= dt;
      levelFlashT += dt;
      stepParticles(dt); stepPopups(dt);
      if (modeTimer <= 0) nextLevel();
      return;
    }

    // playing
    if (powerTimer > 0) {
      powerTimer = Math.max(0, powerTimer - dt);
      if (powerTimer === 0) {
        for (const g of ghosts) {
          if (!g.eaten) {
            g.frightened = false;
            g.speed = g.baseSpeed;
          }
        }
      }
    }

    if (player.dir != null) player.mouth = (player.mouth + dt * 12) % (Math.PI * 2);

    tickEntity(player, dt, true);
    if (mode !== 'playing') { stepParticles(dt); stepPopups(dt); pushHUD(); return; }

    for (const g of ghosts) tickEntity(g, dt, false);

    checkCollisions();
    stepParticles(dt);
    stepPopups(dt);
    pushHUD();
  }

  function stepParticles(dt) {
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.9;
      p.vy *= 0.9;
    }
    particles = particles.filter((p) => p.life > 0);
  }
  function stepPopups(dt) {
    for (const p of popups) {
      p.life -= dt;
      p.y += p.vy * dt;
      p.vy *= 0.96;
    }
    popups = popups.filter((p) => p.life > 0);
  }

  // ---------- Rendering ----------
  function entityPixel(e) {
    if (e.dir == null) {
      return {
        x: offX + (e.col + 0.5) * TILE,
        y: offY + (e.row + 0.5) * TILE,
      };
    }
    const d = DIRS[e.dir];
    return {
      x: offX + (e.col + 0.5 + d.dx * e.progress) * TILE,
      y: offY + (e.row + 0.5 + d.dy * e.progress) * TILE,
    };
  }

  function render() {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, W, H);
    drawVignette();

    if (shake > 0) {
      ctx.translate(
        (Math.random() - 0.5) * shake,
        (Math.random() - 0.5) * shake,
      );
    }

    drawMaze();

    for (const p of particles) {
      const a = Math.max(0, Math.min(1, p.life / 0.4));
      ctx.fillStyle = withAlpha(p.color, a);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const g of ghosts) drawGhost(g);
    if (mode !== 'dying') drawPlayer(player); else drawPlayerDying(player);

    // Power timer ring around player
    if (powerTimer > 0 && mode === 'playing') {
      const pp = entityPixel(player);
      const t = powerTimer / powerDurationCurrent;
      ctx.strokeStyle = withAlpha(COLOR_POWER, 0.75);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, TILE * 0.58, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
      ctx.stroke();
    }

    for (const p of popups) {
      const a = Math.max(0, Math.min(1, p.life));
      ctx.fillStyle = withAlpha(p.color, a);
      ctx.font = 'bold 11px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.text, p.x, p.y);
    }

    if (mode === 'menu') drawOverlay('GHOST MAN', 'Arrow keys · Press Start');
    else if (mode === 'gameover') drawOverlay('GAME OVER', `${score} pts · best ${best}`);
    else if (mode === 'levelEnd') drawLevelEnd();
  }

  function drawVignette() {
    const r = Math.max(W, H);
    const g = ctx.createRadialGradient(W / 2, H / 2, r * 0.18, W / 2, H / 2, r * 0.72);
    g.addColorStop(0, 'rgba(0, 0, 0, 0)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawMaze() {
    let wallColor = COLOR_WALL;
    let wallHi = COLOR_WALL_HI;
    if (mode === 'levelEnd') {
      const flash = ((Math.sin(levelFlashT * 14) + 1) / 2) > 0.5;
      wallColor = flash ? '#ffffff' : COLOR_WALL;
      wallHi = flash ? '#ffffff' : COLOR_WALL_HI;
    }

    const powerPulse = (Math.sin(performance.now() / 220) + 1) / 2;
    const powerR = 4.2 + powerPulse * 1.4;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const ch = grid[r][c];
        const x = offX + c * TILE;
        const y = offY + r * TILE;
        if (ch === '#') {
          ctx.fillStyle = wallColor;
          roundRect(x + 1, y + 1, TILE - 2, TILE - 2, 4);
          ctx.fill();
          ctx.fillStyle = wallHi;
          roundRect(x + 3, y + 3, TILE - 6, TILE - 6, 3);
          ctx.fill();
        } else if (ch === '.') {
          ctx.fillStyle = COLOR_PELLET;
          ctx.beginPath();
          ctx.arc(x + TILE / 2, y + TILE / 2, 1.8, 0, Math.PI * 2);
          ctx.fill();
        } else if (ch === 'o') {
          ctx.shadowColor = COLOR_POWER;
          ctx.shadowBlur = 8;
          ctx.fillStyle = COLOR_POWER;
          ctx.beginPath();
          ctx.arc(x + TILE / 2, y + TILE / 2, powerR, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    }
  }

  function drawPlayer(p) {
    const { x, y } = entityPixel(p);
    const r = TILE * 0.42;
    // body
    ctx.fillStyle = COLOR_PLAYER;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // inner glow
    ctx.fillStyle = COLOR_PLAYER_HI;
    ctx.beginPath();
    ctx.arc(x - r * 0.25, y - r * 0.3, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
    // mouth chomp
    const dir = p.dir != null ? DIRS[p.dir] : { dx: -1, dy: 0 };
    const angle = Math.atan2(dir.dy, dir.dx);
    const mouthOpen = ((Math.sin(p.mouth) + 1) / 2) * 0.55 + 0.05;
    ctx.fillStyle = COLOR_BG;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r * 1.05, angle - mouthOpen, angle + mouthOpen);
    ctx.closePath();
    ctx.fill();
    // tiny "eye" dot perpendicular to facing
    const ex = x + (-dir.dy) * r * 0.35;
    const ey = y + (dir.dx) * r * 0.35 - 1;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ex, ey, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPlayerDying(p) {
    const { x, y } = entityPixel(p);
    const t = 1 - Math.max(0, modeTimer / DYING_DURATION);
    const r = TILE * 0.42 * (1 - t);
    if (r <= 0.1) return;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = COLOR_PLAYER;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawGhost(g) {
    const { x, y } = entityPixel(g);
    const r = TILE * 0.42;

    let body = null;
    if (g.eaten) {
      body = null;
    } else if (g.frightened) {
      const blink = powerTimer < 1.5 && Math.floor(powerTimer * 8) % 2 === 0;
      body = blink ? '#ffffff' : COLOR_FRIGHTENED;
    } else {
      body = COLOR_GHOST[g.idx % COLOR_GHOST.length];
    }

    if (body) {
      ctx.fillStyle = body;
      ctx.beginPath();
      // rounded dome top
      ctx.arc(x, y - r * 0.1, r, Math.PI, 0);
      ctx.lineTo(x + r, y + r * 0.7);
      // wavy bottom — 3 humps
      const waves = 3;
      const waveW = (2 * r) / waves;
      for (let i = 0; i < waves; i++) {
        const sx = x + r - i * waveW;
        ctx.quadraticCurveTo(sx - waveW / 4, y + r * 0.95, sx - waveW / 2, y + r * 0.65);
        ctx.quadraticCurveTo(sx - waveW * 0.75, y + r * 0.95, sx - waveW, y + r * 0.7);
      }
      ctx.closePath();
      ctx.fill();
      // subtle inner highlight
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }

    // Eyes
    if (g.frightened && !g.eaten) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4;
      drawX(x - r * 0.32, y - r * 0.12, 2.2);
      drawX(x + r * 0.32, y - r * 0.12, 2.2);
      // little frown
      ctx.beginPath();
      ctx.moveTo(x - r * 0.35, y + r * 0.18);
      ctx.quadraticCurveTo(x, y + r * 0.04, x + r * 0.35, y + r * 0.18);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x - r * 0.32, y - r * 0.15, 2.7, 0, Math.PI * 2);
      ctx.arc(x + r * 0.32, y - r * 0.15, 2.7, 0, Math.PI * 2);
      ctx.fill();
      const d = DIRS[g.dir];
      ctx.fillStyle = '#111122';
      ctx.beginPath();
      ctx.arc(x - r * 0.32 + d.dx * 1.1, y - r * 0.15 + d.dy * 1.1, 1.4, 0, Math.PI * 2);
      ctx.arc(x + r * 0.32 + d.dx * 1.1, y - r * 0.15 + d.dy * 1.1, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  function drawX(cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r);
    ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r);
    ctx.stroke();
  }

  function drawOverlay(title, sub) {
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    const h = 78;
    const y = H / 2 - h / 2;
    ctx.fillRect(0, y, W, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLOR_PLAYER_HI;
    ctx.font = 'bold 22px -apple-system, sans-serif';
    ctx.fillText(title, W / 2, y + 28);
    ctx.fillStyle = '#e8e8ea';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillText(sub, W / 2, y + 55);
  }

  function drawLevelEnd() {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const h = 64;
    const y = H / 2 - h / 2;
    ctx.fillRect(0, y, W, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLOR_POWER;
    ctx.font = 'bold 18px -apple-system, sans-serif';
    ctx.fillText(`LEVEL ${level} CLEAR`, W / 2, y + 25);
    ctx.fillStyle = '#e8e8ea';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillText(`+${SCORE_LEVEL_BONUS} bonus`, W / 2, y + 46);
  }

  function withAlpha(hex, a) {
    if (typeof hex !== 'string' || !hex.startsWith('#')) return hex;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a.toFixed(3)})`;
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

  // ---------- Loop / sizing ----------
  function loop(t) {
    rafHandle = requestAnimationFrame(loop);
    if (!lastTime) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05;
    update(dt);
    render();
  }

  function fitCanvas() {
    if (!wrap || !canvas) return;
    const rect = wrap.getBoundingClientRect();
    W = Math.max(160, Math.floor(rect.width));
    H = Math.max(160, Math.floor(rect.height));
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    TILE = Math.max(8, Math.floor(Math.min(W / COLS, H / ROWS)));
    offX = Math.floor((W - TILE * COLS) / 2);
    offY = Math.floor((H - TILE * ROWS) / 2);
  }

  // ---------- Mount / unmount ----------
  function mount(c, u) {
    container = c;
    ui = u;
    _lastStatus = null;
    _lastSubtitle = null;

    wrap = document.createElement('div');
    wrap.className = 'ghostman-wrap';
    canvas = document.createElement('canvas');
    canvas.className = 'ghostman-canvas';
    wrap.appendChild(canvas);
    container.appendChild(wrap);
    ctx = canvas.getContext('2d');

    fitCanvas();
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(() => fitCanvas());
      resizeObserver.observe(wrap);
    }

    best = loadBest();

    keydownHandler = (e) => {
      const k = e.key;
      if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' || k === ' ') {
        e.preventDefault();
      }
      if (!keys[k]) {
        if (k in KEY_TO_DIR) onPlayerInput(KEY_TO_DIR[k]);
        else if ((mode === 'menu' || mode === 'gameover') && (k === ' ' || k === 'Enter')) {
          ensureAudio();
          startGame();
        }
      }
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

    startMenu();
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
    grid = null;
    player = null;
    ghosts = null;
    particles = [];
    popups = [];
    _lastStatus = null;
    _lastSubtitle = null;
  }

  window.GhostManGame = { name: 'Ghost Man', mount, unmount };
})();
