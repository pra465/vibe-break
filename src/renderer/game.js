// Loader: reads the game picker, mounts the chosen game, swaps cleanly on change.

const STORAGE_KEY = 'vibebreak.game';

const GAMES = {
  maze:    window.MazeGame,
  snake:   window.SnakeGame,
  predict: window.PredictGame,
  runner:  window.RunnerGame,
  shooter: window.ShooterGame,
  chess:   window.ChessGame,
  taxi:    window.TaxiGame,
  ghostman: window.GhostManGame,
};

const container  = document.getElementById('game-container');
const controlsEl = document.getElementById('controls');
const statusEl   = document.getElementById('status');
const subtitleEl = document.getElementById('subtitle');
const pickerEl   = document.getElementById('game-picker');

const ui = {
  setStatus(text) {
    statusEl.textContent = text;
  },
  setSubtitle(text) {
    subtitleEl.textContent = text;
  },
  setStatusWin(win) {
    statusEl.classList.toggle('win', !!win);
  },
  setControls(items) {
    controlsEl.innerHTML = '';
    for (const item of items || []) {
      if (item.type === 'button') {
        const b = document.createElement('button');
        b.textContent = item.label;
        if (item.disabled) b.disabled = true;
        if (item.title) b.title = item.title;
        b.addEventListener('click', () => {
          if (b.disabled) return;
          item.onClick && item.onClick();
        });
        controlsEl.appendChild(b);
      } else if (item.type === 'select') {
        const s = document.createElement('select');
        for (const opt of item.options || []) {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          if (item.value !== undefined && String(opt.value) === String(item.value)) {
            o.selected = true;
          }
          s.appendChild(o);
        }
        s.addEventListener('change', () => item.onChange && item.onChange(s.value));
        controlsEl.appendChild(s);
      }
    }
  },
};

let currentGame = null;

function loadGame(key) {
  const game = GAMES[key];
  if (!game) return;

  if (currentGame) {
    try { currentGame.unmount(); } catch (_) {}
  }
  container.innerHTML = '';
  controlsEl.innerHTML = '';
  ui.setStatusWin(false);

  currentGame = game;
  try { localStorage.setItem(STORAGE_KEY, key); } catch (_) {}
  game.mount(container, ui);
}

const saved = (function () {
  try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
})();
const initial = GAMES[saved] ? saved : 'maze';
pickerEl.value = initial;

pickerEl.addEventListener('change', () => loadGame(pickerEl.value));

loadGame(initial);
