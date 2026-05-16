// Snake — 15x15 grid, arrow/WASD input, speed ramps with score.
// Exports window.SnakeGame = { name, mount(container, ui), unmount() }.

(function () {
  const SIZE = 15;
  const START_SPEED = 180;     // ms per tick
  const SPEED_FLOOR = 80;
  const SPEED_STEP_MS = 5;
  const POINTS_PER_STEP = 5;

  const DIRS = {
    up:    [0, -1],
    down:  [0,  1],
    left:  [-1, 0],
    right: [1,  0],
  };

  const KEY_MAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right',
  };

  function isOpposite(a, b) {
    if (!a || !b) return false;
    return DIRS[a][0] === -DIRS[b][0] && DIRS[a][1] === -DIRS[b][1];
  }

  let container = null;
  let ui = null;
  let board = null;

  let snake;          // array of {x,y}, last entry is head
  let dir;            // current direction (applied each tick)
  let pendingDir;     // queued direction from input
  let food;           // {x,y}
  let score;
  let state;          // 'playing' | 'paused' | 'gameover'
  let tickHandle = null;

  let keyHandler = null;
  let visHandler = null;
  let clickHandler = null;

  function reset() {
    // length 3 in the middle, head at center, moving right
    snake = [
      { x: 5, y: 7 },
      { x: 6, y: 7 },
      { x: 7, y: 7 },
    ];
    dir = 'right';
    pendingDir = 'right';
    score = 0;
    spawnFood();
    state = 'playing';
    ui.setSubtitle('arrows or WASD to play');
    ui.setStatus('score: 0');
    ui.setStatusWin(false);
    render();
    scheduleTick();
  }

  function currentSpeed() {
    const reduction = Math.floor(score / POINTS_PER_STEP) * SPEED_STEP_MS;
    return Math.max(SPEED_FLOOR, START_SPEED - reduction);
  }

  function scheduleTick() {
    clearTimeout(tickHandle);
    tickHandle = null;
    if (state !== 'playing') return;
    tickHandle = setTimeout(() => {
      tick();
      scheduleTick();
    }, currentSpeed());
  }

  function tick() {
    dir = pendingDir;
    const [dx, dy] = DIRS[dir];
    const head = snake[snake.length - 1];
    const next = { x: head.x + dx, y: head.y + dy };

    // wall collision
    if (next.x < 0 || next.x >= SIZE || next.y < 0 || next.y >= SIZE) {
      gameOver();
      return;
    }

    const eating = food && next.x === food.x && next.y === food.y;
    // when not eating, the tail will move out of the way this tick
    const bodyToCheck = eating ? snake : snake.slice(1);
    for (const seg of bodyToCheck) {
      if (seg.x === next.x && seg.y === next.y) {
        gameOver();
        return;
      }
    }

    snake.push(next);
    if (eating) {
      score++;
      ui.setStatus(`score: ${score}`);
      spawnFood();
    } else {
      snake.shift();
    }
    render();
  }

  function spawnFood() {
    const occupied = new Set(snake.map((s) => `${s.x},${s.y}`));
    const empty = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (!occupied.has(`${x},${y}`)) empty.push({ x, y });
      }
    }
    if (!empty.length) {
      food = null;
      gameOver(true);
      return;
    }
    food = empty[Math.floor(Math.random() * empty.length)];
  }

  function gameOver(perfect = false) {
    state = 'gameover';
    clearTimeout(tickHandle);
    tickHandle = null;
    const tail = perfect ? ' (board full!)' : '';
    ui.setSubtitle(`Game over — score: ${score}${tail}. Any arrow or click to play again.`);
    ui.setStatusWin(false);
    render();
  }

  function render() {
    board.innerHTML = '';
    board.style.gridTemplateColumns = `repeat(${SIZE}, 1fr)`;
    const headIdx = snake.length - 1;
    const segMap = new Map();
    snake.forEach((seg, i) => segMap.set(`${seg.x},${seg.y}`, i));
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const cell = document.createElement('div');
        cell.className = 'cell floor';
        const key = `${x},${y}`;
        if (segMap.has(key)) {
          cell.classList.add(segMap.get(key) === headIdx ? 'snake-head' : 'snake-body');
        } else if (food && food.x === x && food.y === y) {
          cell.classList.add('snake-food');
        }
        board.appendChild(cell);
      }
    }
  }

  function handleDirectionInput(name) {
    if (state === 'gameover') {
      reset();
      return;
    }
    if (state !== 'playing') return;
    if (isOpposite(name, dir)) return;
    pendingDir = name;
  }

  function mount(c, u) {
    container = c;
    ui = u;

    board = document.createElement('div');
    board.className = 'board';
    container.appendChild(board);

    ui.setControls([
      { type: 'button', label: 'Restart', onClick: () => reset() },
    ]);

    keyHandler = (e) => {
      const name = KEY_MAP[e.key];
      if (!name) return;
      e.preventDefault();
      handleDirectionInput(name);
    };
    document.addEventListener('keydown', keyHandler);

    visHandler = () => {
      if (document.hidden) {
        if (state === 'playing') {
          state = 'paused';
          clearTimeout(tickHandle);
          tickHandle = null;
          ui.setSubtitle('paused');
        }
      } else {
        if (state === 'paused') {
          state = 'playing';
          ui.setSubtitle('arrows or WASD to play');
          scheduleTick();
        }
      }
    };
    document.addEventListener('visibilitychange', visHandler);

    clickHandler = () => {
      if (state === 'gameover') reset();
    };
    board.addEventListener('click', clickHandler);

    reset();
  }

  function unmount() {
    clearTimeout(tickHandle);
    tickHandle = null;
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    if (visHandler) document.removeEventListener('visibilitychange', visHandler);
    keyHandler = null;
    visHandler = null;
    clickHandler = null;
    if (container) container.innerHTML = '';
    container = null;
    board = null;
    ui = null;
  }

  window.SnakeGame = { name: 'Snake', mount, unmount };
})();
