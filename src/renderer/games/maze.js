// Maze game — DFS-carved perfect maze with BFS hint solver.
// Exports window.MazeGame = { name, mount(container, ui), unmount() }.

(function () {
  const KEY_MAP = {
    ArrowUp:    [0, -1],
    ArrowDown:  [0,  1],
    ArrowLeft:  [-1, 0],
    ArrowRight: [1,  0],
    w: [0, -1], W: [0, -1],
    s: [0,  1], S: [0,  1],
    a: [-1, 0], A: [-1, 0],
    d: [1,  0], D: [1,  0],
  };

  let container = null;
  let ui = null;
  let board = null;
  let keyHandler = null;

  let SIZE = 11;
  let currentDifficulty = 11;
  let grid, px, py, moves, won, trail;

  function genMaze(size) {
    SIZE = size;
    if (SIZE % 2 === 0) SIZE++;
    grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(1));

    function carve(x, y) {
      grid[y][x] = 0;
      const dirs = [[2, 0], [-2, 0], [0, 2], [0, -2]].sort(() => Math.random() - 0.5);
      for (const [dx, dy] of dirs) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && grid[ny][nx] === 1) {
          grid[y + dy / 2][x + dx / 2] = 0;
          carve(nx, ny);
        }
      }
    }
    carve(0, 0);

    grid[SIZE - 1][SIZE - 1] = 0;
    if (grid[SIZE - 2][SIZE - 1] === 1 && grid[SIZE - 1][SIZE - 2] === 1) {
      grid[SIZE - 2][SIZE - 1] = 0;
    }

    px = 0; py = 0; moves = 0; won = false;
    trail = new Set();
    trail.add('0,0');

    ui.setSubtitle('while your code generates');
    ui.setStatus('0 moves');
    ui.setStatusWin(false);
    render();
  }

  function render() {
    board.innerHTML = '';
    board.style.gridTemplateColumns = `repeat(${SIZE}, 1fr)`;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        const key = `${x},${y}`;
        if (grid[y][x] === 1) {
          cell.classList.add('wall');
        } else {
          cell.classList.add('floor');
          if (trail.has(key)) cell.classList.add('trail');
        }
        if (x === SIZE - 1 && y === SIZE - 1) cell.classList.add('goal');
        if (x === px && y === py) cell.classList.add('player');
        cell.dataset.x = x;
        cell.dataset.y = y;
        cell.addEventListener('click', () => tryMoveTo(x, y));
        board.appendChild(cell);
      }
    }
  }

  function tryMoveTo(x, y) {
    if (won) return;
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
    if (grid[y][x] === 1) return;
    const dx = Math.abs(x - px), dy = Math.abs(y - py);
    if (dx + dy !== 1) return;
    px = x; py = y; moves++;
    trail.add(`${x},${y}`);
    if (px === SIZE - 1 && py === SIZE - 1) {
      won = true;
      ui.setSubtitle(`Solved in ${moves} moves`);
      ui.setStatus('🎉 nice');
      ui.setStatusWin(true);
    } else {
      ui.setStatus(`${moves} moves`);
    }
    render();
  }

  function showHint() {
    if (won) return;
    const q = [[px, py]];
    const parent = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    parent[py][px] = [px, py];
    let found = null;
    while (q.length) {
      const [x, y] = q.shift();
      if (x === SIZE - 1 && y === SIZE - 1) { found = [x, y]; break; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue;
        if (grid[ny][nx] === 1) continue;
        if (parent[ny][nx]) continue;
        parent[ny][nx] = [x, y];
        q.push([nx, ny]);
      }
    }
    if (!found) return;
    let cur = found;
    while (
      parent[cur[1]][cur[0]] &&
      !(parent[cur[1]][cur[0]][0] === px && parent[cur[1]][cur[0]][1] === py)
    ) {
      cur = parent[cur[1]][cur[0]];
    }
    const [hx, hy] = cur;
    const idx = hy * SIZE + hx;
    const cell = board.children[idx];
    if (cell) {
      cell.classList.add('hint');
      setTimeout(() => cell.classList.remove('hint'), 700);
    }
  }

  function mount(c, u) {
    container = c;
    ui = u;

    board = document.createElement('div');
    board.className = 'board';
    container.appendChild(board);

    ui.setControls([
      {
        type: 'select',
        value: String(currentDifficulty),
        options: [
          { value: '7',  label: 'Easy' },
          { value: '11', label: 'Medium' },
          { value: '15', label: 'Hard' },
        ],
        onChange: (val) => {
          currentDifficulty = parseInt(val, 10);
          genMaze(currentDifficulty);
        },
      },
      { type: 'button', label: 'New maze', onClick: () => genMaze(currentDifficulty) },
      { type: 'button', label: 'Hint',     onClick: showHint },
    ]);

    keyHandler = (e) => {
      const m = KEY_MAP[e.key];
      if (!m) return;
      e.preventDefault();
      tryMoveTo(px + m[0], py + m[1]);
    };
    document.addEventListener('keydown', keyHandler);

    genMaze(currentDifficulty);
  }

  function unmount() {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
    if (container) container.innerHTML = '';
    container = null;
    board = null;
    ui = null;
  }

  window.MazeGame = { name: 'Maze', mount, unmount };
})();
