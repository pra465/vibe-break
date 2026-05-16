// Chess Puzzles — hand-curated mate-in-1 and best-move tactical puzzles.
// Click a piece to select, click a target square to move. Wrong moves shake;
// correct moves advance. Solution is stored as a sequence of {from, to} squares,
// so a future mate-in-2 puzzle just needs a 3-entry solution (user, auto-reply, user).
// Exports window.ChessGame = { name, mount(container, ui), unmount() }.

(function () {
  // Unicode chess glyphs. White uses outlined, black uses filled — both render
  // crisply on macOS without any font dependency.
  const PIECES = {
    'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
    'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟',
  };

  const PUZZLES = [
    {
      // Back-rank mate: king trapped behind own pawns.
      fen: '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1',
      solution: [{ from: 'a1', to: 'a8' }],
      label: 'White to play. Mate in 1.',
    },
    {
      // Queen-and-king mate in the corner.
      fen: '7k/8/5K2/8/8/8/8/6Q1 w - - 0 1',
      solution: [{ from: 'g1', to: 'g7' }],
      label: 'White to play. Mate in 1.',
    },
    {
      // Two-rook ladder mate.
      fen: 'k7/6R1/8/8/8/8/8/4K2R w - - 0 1',
      solution: [{ from: 'h1', to: 'h8' }],
      label: 'White to play. Mate in 1.',
    },
    {
      // Smothered mate — knight delivers, king blocked by own pieces.
      fen: '6rk/6pp/7N/8/8/8/8/6K1 w - - 0 1',
      solution: [{ from: 'h6', to: 'f7' }],
      label: 'White to play. Smothered mate in 1.',
    },
    {
      // Anastasia’s mate setup — knight + rook on the h-file.
      fen: '8/4N1pk/8/R7/8/8/8/4K3 w - - 0 1',
      solution: [{ from: 'a5', to: 'h5' }],
      label: 'White to play. Anastasia’s mate.',
    },
    {
      // Royal fork — knight forks king and rook, winning material.
      fen: 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1',
      solution: [{ from: 'b5', to: 'c7' }],
      label: 'White to play. Best move: win the rook.',
    },
  ];

  function parseFEN(fen) {
    const parts = fen.split(' ');
    const ranks = parts[0].split('/');
    const side = parts[1] || 'w';
    const board = [];
    for (let r = 0; r < 8; r++) {
      const row = [];
      for (const ch of ranks[r]) {
        if (ch >= '1' && ch <= '8') {
          for (let i = 0; i < +ch; i++) row.push(null);
        } else {
          row.push(ch);
        }
      }
      board.push(row);
    }
    return { board, side };
  }

  function squareToCoord(sq) {
    return { row: 8 - +sq[1], col: sq.charCodeAt(0) - 97 };
  }

  function coordToSquare(row, col) {
    return String.fromCharCode(97 + col) + (8 - row);
  }

  function pieceColor(piece) {
    if (!piece) return null;
    return piece === piece.toUpperCase() ? 'w' : 'b';
  }

  let container = null;
  let ui = null;
  let boardEl = null;
  let board = null;
  let puzzleIdx = 0;
  let moveIdx = 0;
  let selected = null;
  let lastMove = null;
  let state = 'playing';        // 'playing' | 'solved' | 'wrong'
  let sideToMove = 'w';
  let pendingReplyTimer = null;
  let wrongFlashTimer = null;
  let clickHandler = null;

  function loadPuzzle(idx) {
    clearTimeout(pendingReplyTimer);
    clearTimeout(wrongFlashTimer);
    pendingReplyTimer = null;
    wrongFlashTimer = null;

    puzzleIdx = ((idx % PUZZLES.length) + PUZZLES.length) % PUZZLES.length;
    const p = PUZZLES[puzzleIdx];
    const parsed = parseFEN(p.fen);
    board = parsed.board;
    sideToMove = parsed.side;
    moveIdx = 0;
    selected = null;
    lastMove = null;
    state = 'playing';
    ui.setStatus(`puzzle ${puzzleIdx + 1}/${PUZZLES.length}`);
    ui.setStatusWin(false);
    ui.setSubtitle(p.label);
    render();
  }

  function nextPuzzle() {
    loadPuzzle(puzzleIdx + 1);
  }

  function resetPuzzle() {
    loadPuzzle(puzzleIdx);
  }

  function showHint() {
    if (state !== 'playing') return;
    const p = PUZZLES[puzzleIdx];
    const move = p.solution[moveIdx];
    if (!move) return;
    selected = squareToCoord(move.from);
    render();
  }

  function applyMove(from, to) {
    board[to.row][to.col] = board[from.row][from.col];
    board[from.row][from.col] = null;
  }

  function onSquareClick(row, col) {
    if (state !== 'playing') return;

    const clickedPiece = board[row][col];
    const clickedColor = pieceColor(clickedPiece);

    if (selected) {
      if (selected.row === row && selected.col === col) {
        selected = null;
        render();
        return;
      }
      // Friendlier UX: clicking another own piece switches selection
      // instead of triggering a "wrong move".
      if (clickedPiece && clickedColor === sideToMove) {
        selected = { row, col };
        render();
        return;
      }
      attemptMove(
        coordToSquare(selected.row, selected.col),
        coordToSquare(row, col)
      );
      return;
    }

    if (clickedPiece && clickedColor === sideToMove) {
      selected = { row, col };
      render();
    }
  }

  function attemptMove(fromSq, toSq) {
    const p = PUZZLES[puzzleIdx];
    const expected = p.solution[moveIdx];

    if (expected.from === fromSq && expected.to === toSq) {
      const from = squareToCoord(fromSq);
      const to = squareToCoord(toSq);
      applyMove(from, to);
      lastMove = { from, to };
      moveIdx++;
      selected = null;
      render();

      if (moveIdx >= p.solution.length) {
        state = 'solved';
        ui.setStatusWin(true);
        ui.setStatus('solved');
        ui.setSubtitle('Nice. Click Next for another puzzle.');
        return;
      }

      // More moves in the sequence — auto-play the opponent reply.
      sideToMove = sideToMove === 'w' ? 'b' : 'w';
      pendingReplyTimer = setTimeout(() => {
        const reply = p.solution[moveIdx];
        if (!reply) return;
        const rf = squareToCoord(reply.from);
        const rt = squareToCoord(reply.to);
        applyMove(rf, rt);
        lastMove = { from: rf, to: rt };
        moveIdx++;
        sideToMove = sideToMove === 'w' ? 'b' : 'w';
        pendingReplyTimer = null;
        render();
      }, 500);
    } else {
      state = 'wrong';
      boardEl.classList.add('shake');
      render();
      wrongFlashTimer = setTimeout(() => {
        boardEl && boardEl.classList.remove('shake');
        if (state === 'wrong') state = 'playing';
        selected = null;
        wrongFlashTimer = null;
        render();
      }, 350);
    }
  }

  function render() {
    boardEl.innerHTML = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq = document.createElement('div');
        sq.className = 'chess-sq ' + ((r + c) % 2 === 0 ? 'light' : 'dark');

        if (selected && selected.row === r && selected.col === c) {
          sq.classList.add(state === 'wrong' ? 'wrong' : 'selected');
        }
        if (lastMove) {
          const isFrom = lastMove.from.row === r && lastMove.from.col === c;
          const isTo = lastMove.to.row === r && lastMove.to.col === c;
          if (isFrom || isTo) sq.classList.add('last-move');
        }

        const piece = board[r][c];
        if (piece) {
          const span = document.createElement('span');
          span.className = 'chess-piece ' + (piece === piece.toUpperCase() ? 'white' : 'black');
          span.textContent = PIECES[piece];
          sq.appendChild(span);
        }
        sq.dataset.r = r;
        sq.dataset.c = c;
        boardEl.appendChild(sq);
      }
    }
  }

  function mount(c, u) {
    container = c;
    ui = u;

    boardEl = document.createElement('div');
    boardEl.className = 'chess-board';
    container.appendChild(boardEl);

    clickHandler = (e) => {
      const target = e.target.closest('.chess-sq');
      if (!target || !boardEl.contains(target)) return;
      onSquareClick(+target.dataset.r, +target.dataset.c);
    };
    boardEl.addEventListener('click', clickHandler);

    ui.setControls([
      { type: 'button', label: 'Hint', onClick: showHint },
      { type: 'button', label: 'Reset', onClick: resetPuzzle },
      { type: 'button', label: 'Next', onClick: nextPuzzle },
    ]);

    loadPuzzle(0);
  }

  function unmount() {
    clearTimeout(pendingReplyTimer);
    clearTimeout(wrongFlashTimer);
    pendingReplyTimer = null;
    wrongFlashTimer = null;
    if (boardEl && clickHandler) boardEl.removeEventListener('click', clickHandler);
    clickHandler = null;
    if (container) container.innerHTML = '';
    container = null;
    boardEl = null;
    board = null;
    ui = null;
    selected = null;
    lastMove = null;
  }

  window.ChessGame = { name: 'Chess Puzzles', mount, unmount };
})();
