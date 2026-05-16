// Predict the output — code-snippet guessing game.
// Exports window.PredictGame = { name, mount(container, ui), unmount() }.

(function () {
  const STORE = {
    SHOWN:       'predict.shown',
    LANG:        'predict.lang',
    DIFF:        'predict.diff',
    SCORE:       'predict.score',
    BEST_STREAK: 'predict.bestStreak',
  };

  const LANGS = [
    { value: 'any',        label: 'Any language' },
    { value: 'python',     label: 'Python' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'typescript', label: 'TypeScript' },
    { value: 'java',       label: 'Java' },
    { value: 'cpp',        label: 'C++' },
    { value: 'go',         label: 'Go' },
    { value: 'rust',       label: 'Rust' },
  ];
  const DIFFS = [
    { value: 'any', label: 'Any difficulty' },
    { value: '1',   label: 'Easy' },
    { value: '2',   label: 'Medium' },
    { value: '3',   label: 'Hard' },
  ];

  let snippetsPromise = null;
  function loadSnippets() {
    if (!snippetsPromise) {
      snippetsPromise = fetch('games/predict-snippets.json')
        .then((r) => {
          if (!r.ok) throw new Error('snippets fetch failed');
          return r.json();
        })
        .catch((err) => {
          snippetsPromise = null;
          throw err;
        });
    }
    return snippetsPromise;
  }

  // ---------- normalize / validate ----------

  function normalize(s, caseInsensitive) {
    if (s == null) return '';
    let t = String(s);
    t = t.trim();
    t = t.replace(/\s+/g, ' ');
    // strip surrounding quotes (matched pair only)
    if (
      (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
      (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
    ) {
      t = t.slice(1, -1);
    }
    // strip a trailing period
    while (t.endsWith('.')) t = t.slice(0, -1);
    // (trailing newlines already gone after trim)
    if (caseInsensitive) t = t.toLowerCase();
    return t;
  }

  function looksLikeInteger(s) {
    return /^-?\d+$/.test(s.trim());
  }

  function checkAnswer(snippet, raw) {
    const ci = !!snippet.caseInsensitive;
    const got = normalize(raw, ci);
    const candidates = [snippet.answer, ...(snippet.acceptedAnswers || [])];
    for (const c of candidates) {
      if (normalize(c, ci) === got) return true;
    }
    // numeric fallback — but skip when the canonical answer is integer-looking
    const expectedRaw = String(snippet.answer);
    if (!looksLikeInteger(expectedRaw)) {
      const a = parseFloat(got);
      const b = parseFloat(normalize(expectedRaw, ci));
      if (!Number.isNaN(a) && !Number.isNaN(b) && Math.abs(a - b) < 1e-9) {
        // only accept if the user's input is recognizably numeric
        if (/^-?\d*\.?\d+(?:[eE][-+]?\d+)?$/.test(got)) return true;
      }
    }
    return false;
  }

  // ---------- highlighting ----------

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderCodeBlock(code, lang) {
    const pre = document.createElement('pre');
    pre.className = 'code-block hljs';

    let html;
    if (window.hljs && typeof window.hljs.highlight === 'function') {
      try {
        html = window.hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } catch (_) {
        html = escapeHtml(code);
      }
    } else {
      html = escapeHtml(code);
    }

    const lines = html.split('\n');
    lines.forEach((lineHtml, i) => {
      const lineDiv = document.createElement('div');
      lineDiv.className = 'code-line';
      const num = document.createElement('span');
      num.className = 'line-num';
      num.textContent = String(i + 1);
      const content = document.createElement('span');
      content.className = 'line-content';
      content.innerHTML = lineHtml.length ? lineHtml : '\u00A0';
      lineDiv.appendChild(num);
      lineDiv.appendChild(content);
      pre.appendChild(lineDiv);
    });
    return pre;
  }

  // ---------- module state ----------

  let container = null;
  let ui = null;

  let snippets = [];
  let currentSnippet = null;

  let lang = 'any';
  let diff = 'any';

  let score = 0;
  let streak = 0;
  let bestStreak = 0;

  let hintsShown = 0;
  let answered = false;     // current snippet has been resolved (right or wrong)
  let lastWasCorrect = false;

  let keyHandler = null;
  let flashTimer = null;

  // DOM refs that get rebuilt on each snippet
  let rootEl = null;
  let filtersEl = null;
  let snippetCardEl = null;
  let metaLangEl = null;
  let pipsEl = null;
  let codeWrapEl = null;
  let hintsAreaEl = null;
  let answerAreaEl = null;
  let feedbackEl = null;
  let textInputEl = null;

  // ---------- persistence ----------

  function loadInt(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      if (v == null) return fallback;
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : fallback;
    } catch (_) { return fallback; }
  }
  function saveInt(key, val) {
    try { localStorage.setItem(key, String(val)); } catch (_) {}
  }
  function loadStr(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (_) { return fallback; }
  }
  function saveStr(key, val) {
    try { localStorage.setItem(key, val); } catch (_) {}
  }
  function loadShown() {
    try {
      const raw = localStorage.getItem(STORE.SHOWN);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }
  function saveShown(arr) {
    try { localStorage.setItem(STORE.SHOWN, JSON.stringify(arr)); } catch (_) {}
  }

  // ---------- snippet selection ----------

  function pickNext() {
    let pool = snippets.filter((s) => {
      if (lang !== 'any' && s.language !== lang) return false;
      if (diff !== 'any' && String(s.difficulty) !== diff) return false;
      return true;
    });
    if (pool.length === 0) return null;

    let shown = loadShown();
    let unseen = pool.filter((s) => !shown.includes(s.id));
    if (unseen.length === 0) {
      const poolIds = new Set(pool.map((s) => s.id));
      shown = shown.filter((id) => !poolIds.has(id));
      saveShown(shown);
      unseen = pool;
    }
    const pick = unseen[Math.floor(Math.random() * unseen.length)];
    shown.push(pick.id);
    saveShown(shown);
    return pick;
  }

  // ---------- choice shuffling ----------

  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- scoring ----------

  function scoreFor(correct, hintsUsed) {
    if (!correct) return 0;
    let base;
    if (hintsUsed === 0) base = 10 + 5;       // 1st-try + no-hint bonus
    else if (hintsUsed === 1) base = 6;
    else if (hintsUsed === 2) base = 3;
    else base = 1;                             // 3 hints = answer revealed
    const bonus = streak * 2;                  // streak BEFORE this answer
    return base + bonus;
  }

  function applyResult(correct) {
    const gain = scoreFor(correct, hintsShown);
    if (correct) {
      score += gain;
      streak += 1;
      if (streak > bestStreak) bestStreak = streak;
    } else {
      streak = 0;
    }
    saveInt(STORE.SCORE, score);
    saveInt(STORE.BEST_STREAK, bestStreak);
    updateHeader();
    return gain;
  }

  // ---------- header ----------

  function updateHeader() {
    ui.setStatus(`Streak: ${streak} · Score: ${score}`);
    ui.setSubtitle(`Best streak: ${bestStreak}`);
    ui.setStatusWin(false);
  }

  // ---------- rendering ----------

  function buildSkeleton() {
    rootEl = document.createElement('div');
    rootEl.className = 'predict-root';

    filtersEl = document.createElement('div');
    filtersEl.className = 'predict-filters';
    filtersEl.appendChild(buildSelect(LANGS, lang, (v) => {
      lang = v;
      saveStr(STORE.LANG, lang);
      newSnippet();
    }));
    filtersEl.appendChild(buildSelect(DIFFS, diff, (v) => {
      diff = v;
      saveStr(STORE.DIFF, diff);
      newSnippet();
    }));
    rootEl.appendChild(filtersEl);

    snippetCardEl = document.createElement('div');
    snippetCardEl.className = 'snippet-card';

    const meta = document.createElement('div');
    meta.className = 'snippet-meta';
    metaLangEl = document.createElement('span');
    metaLangEl.className = 'lang-tag';
    pipsEl = document.createElement('span');
    pipsEl.className = 'pips';
    meta.appendChild(metaLangEl);
    meta.appendChild(pipsEl);
    snippetCardEl.appendChild(meta);

    codeWrapEl = document.createElement('div');
    snippetCardEl.appendChild(codeWrapEl);

    rootEl.appendChild(snippetCardEl);

    hintsAreaEl = document.createElement('div');
    hintsAreaEl.className = 'hints-area';
    rootEl.appendChild(hintsAreaEl);

    answerAreaEl = document.createElement('div');
    answerAreaEl.className = 'answer-area';
    rootEl.appendChild(answerAreaEl);

    feedbackEl = document.createElement('div');
    rootEl.appendChild(feedbackEl);

    container.appendChild(rootEl);
  }

  function buildSelect(options, value, onChange) {
    const sel = document.createElement('select');
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if (String(o.value) === String(value)) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  function renderSnippet() {
    // language tag
    metaLangEl.textContent = currentSnippet.language;
    // pips
    pipsEl.innerHTML = '';
    for (let i = 1; i <= 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'pip' + (i <= currentSnippet.difficulty ? ' filled' : '');
      pipsEl.appendChild(dot);
    }
    // code block
    codeWrapEl.innerHTML = '';
    codeWrapEl.appendChild(renderCodeBlock(currentSnippet.code, currentSnippet.language));
    // reset card flash
    snippetCardEl.classList.remove('flash-correct', 'flash-wrong');

    // hints
    hintsAreaEl.innerHTML = '';
    answered = false;
    hintsShown = 0;

    // answer area
    answerAreaEl.innerHTML = '';
    if (currentSnippet.answerMode === 'choice') {
      renderChoices();
    } else {
      renderTextInput();
    }

    // feedback
    feedbackEl.className = '';
    feedbackEl.innerHTML = '';

    rebuildControls();
    updateHeader();

    // scroll to top of card
    rootEl.scrollTop = 0;
  }

  function renderTextInput() {
    const wrap = document.createElement('div');
    wrap.className = 'choices';
    textInputEl = document.createElement('input');
    textInputEl.type = 'text';
    textInputEl.className = 'answer-input';
    textInputEl.placeholder = 'Your guess (then press Enter or Submit)';
    textInputEl.spellcheck = false;
    textInputEl.autocapitalize = 'off';
    textInputEl.autocomplete = 'off';
    textInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !answered) {
        e.preventDefault();
        submitText();
      }
    });
    wrap.appendChild(textInputEl);
    answerAreaEl.appendChild(wrap);
    setTimeout(() => { try { textInputEl.focus(); } catch (_) {} }, 0);
  }

  function renderChoices() {
    const choices = currentSnippet.choices || [];
    const correct = choices[0];
    const order = shuffled(choices);
    const wrap = document.createElement('div');
    wrap.className = 'choices';
    for (const ch of order) {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.textContent = ch;
      btn.addEventListener('click', () => handleChoiceClick(btn, ch === correct, wrap, correct));
      wrap.appendChild(btn);
    }
    answerAreaEl.appendChild(wrap);
  }

  function handleChoiceClick(btn, isCorrect, wrap, correctText) {
    if (answered) return;
    answered = true;
    lastWasCorrect = isCorrect;
    // mark all buttons
    for (const b of wrap.querySelectorAll('button')) {
      b.disabled = true;
      if (b.textContent === correctText) b.classList.add('correct');
    }
    if (!isCorrect) btn.classList.add('wrong');
    finishAnswer(isCorrect);
  }

  function submitText() {
    if (answered || !textInputEl) return;
    const correct = checkAnswer(currentSnippet, textInputEl.value);
    answered = true;
    lastWasCorrect = correct;
    textInputEl.disabled = true;
    finishAnswer(correct);
  }

  function finishAnswer(correct) {
    const gained = applyResult(correct);
    flashCard(correct);
    showFeedback(correct, gained);
    rebuildControls();
  }

  function flashCard(correct) {
    snippetCardEl.classList.remove('flash-correct', 'flash-wrong');
    // force reflow so the animation re-triggers
    void snippetCardEl.offsetWidth;
    snippetCardEl.classList.add(correct ? 'flash-correct' : 'flash-wrong');
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      if (snippetCardEl) snippetCardEl.classList.remove('flash-correct', 'flash-wrong');
      flashTimer = null;
    }, 700);
  }

  function showFeedback(correct, gained) {
    feedbackEl.className = 'feedback ' + (correct ? 'correct' : 'wrong');
    feedbackEl.innerHTML = '';

    const head = document.createElement('div');
    if (correct) {
      head.textContent = `Correct! +${gained} points`;
    } else {
      head.textContent = 'Not quite.';
    }
    feedbackEl.appendChild(head);

    if (!correct) {
      const exp = document.createElement('span');
      exp.className = 'expected';
      exp.textContent = 'Expected: ' + currentSnippet.answer;
      feedbackEl.appendChild(exp);
    }

    if (currentSnippet.explanation) {
      const ex = document.createElement('span');
      ex.className = 'explanation';
      ex.textContent = currentSnippet.explanation;
      feedbackEl.appendChild(ex);
    }
  }

  function showHint() {
    if (answered) return;
    if (hintsShown >= 3) return;
    hintsShown += 1;
    renderHints();
    rebuildControls();
  }

  function renderHints() {
    hintsAreaEl.innerHTML = '';
    const hints = currentSnippet.hints || [];
    for (let i = 0; i < hintsShown && i < hints.length; i++) {
      const card = document.createElement('div');
      card.className = 'hint-card';
      const label = document.createElement('strong');
      label.textContent = `Hint ${i + 1}:`;
      card.appendChild(label);
      card.appendChild(document.createTextNode(' ' + hints[i]));
      hintsAreaEl.appendChild(card);
    }
  }

  function rebuildControls() {
    const items = [];
    if (currentSnippet && currentSnippet.answerMode === 'text') {
      items.push({
        type: 'button',
        label: 'Submit',
        onClick: submitText,
        disabled: answered,
      });
    }
    items.push({
      type: 'button',
      label: hintsShown >= 3 ? 'Hint (revealed)' : `Hint (${hintsShown}/3)`,
      onClick: showHint,
      disabled: answered || hintsShown >= 3,
    });
    items.push({
      type: 'button',
      label: 'Skip',
      onClick: skipSnippet,
      disabled: answered,
    });
    items.push({
      type: 'button',
      label: 'Next',
      onClick: newSnippet,
      disabled: !answered,
    });
    ui.setControls(items);
  }

  function skipSnippet() {
    if (answered) return;
    // skip counts as a wrong answer (zero, breaks streak)
    answered = true;
    lastWasCorrect = false;
    applyResult(false);
    showFeedback(false, 0);
    flashCard(false);
    if (textInputEl) textInputEl.disabled = true;
    rebuildControls();
  }

  function newSnippet() {
    currentSnippet = pickNext();
    if (!currentSnippet) {
      // shouldn't happen with the bundled snippets, but be defensive
      codeWrapEl.innerHTML = '';
      const msg = document.createElement('div');
      msg.style.color = 'var(--muted)';
      msg.style.fontSize = '12px';
      msg.style.padding = '8px';
      msg.textContent = 'No snippets match this filter combination.';
      codeWrapEl.appendChild(msg);
      hintsAreaEl.innerHTML = '';
      answerAreaEl.innerHTML = '';
      feedbackEl.innerHTML = '';
      ui.setControls([]);
      return;
    }
    renderSnippet();
  }

  // ---------- key handler (Enter to submit / advance) ----------

  function onKey(e) {
    // Enter advances to next snippet when answered
    if (e.key === 'Enter' && answered) {
      e.preventDefault();
      newSnippet();
    }
  }

  // ---------- mount / unmount ----------

  function mount(c, u) {
    container = c;
    ui = u;

    score      = loadInt(STORE.SCORE, 0);
    bestStreak = loadInt(STORE.BEST_STREAK, 0);
    streak     = 0;
    lang       = loadStr(STORE.LANG, 'any');
    diff       = loadStr(STORE.DIFF, 'any');

    // loading state
    container.innerHTML = '';
    const loading = document.createElement('div');
    loading.style.color = 'var(--muted)';
    loading.style.fontSize = '12px';
    loading.style.padding = '12px';
    loading.textContent = 'Loading snippets...';
    container.appendChild(loading);
    ui.setStatus(`Streak: 0 · Score: ${score}`);
    ui.setSubtitle(`Best streak: ${bestStreak}`);

    keyHandler = onKey;
    document.addEventListener('keydown', keyHandler);

    loadSnippets()
      .then((data) => {
        snippets = Array.isArray(data) ? data : [];
        container.innerHTML = '';
        buildSkeleton();
        newSnippet();
      })
      .catch((err) => {
        loading.textContent = 'Failed to load snippets: ' + (err && err.message ? err.message : err);
      });
  }

  function unmount() {
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
    if (container) container.innerHTML = '';

    container = null;
    ui = null;
    rootEl = null;
    filtersEl = null;
    snippetCardEl = null;
    metaLangEl = null;
    pipsEl = null;
    codeWrapEl = null;
    hintsAreaEl = null;
    answerAreaEl = null;
    feedbackEl = null;
    textInputEl = null;
    currentSnippet = null;
  }

  window.PredictGame = { name: 'Predict', mount, unmount };
})();
