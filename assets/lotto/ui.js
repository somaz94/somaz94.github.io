/* ui.js — the only file on /lotto/ that touches the DOM.
 *
 * generate.js is pure; everything that reads a control, writes a result or
 * moves focus lives here.
 *
 * Nothing is stored. No localStorage, no sessionStorage, no cookie — a fresh
 * set of numbers on every visit is the honest behaviour for a page whose whole
 * argument is that each draw is independent. The consequence is no quota
 * handling and no schema migration to get wrong.
 */
(function () {
  'use strict';

  var L = window.Lotto;
  if (!L) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) {
    return Array.prototype.slice.call((r || document).querySelectorAll(s));
  };

  var statusEl = $('#lt-status');
  var announceTimer = null;
  function announce(msg) {
    if (!statusEl) return;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(function () { statusEl.textContent = msg; }, 300);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* 동행복권's own banding — 1-10 / 11-20 / 21-30 / 31-40 / 41-45. Readers
     already associate the colours with ranges, so reusing them costs nothing
     and makes a row scannable without reading the digits. */
  function band(n) { return Math.min(5, Math.floor((n - 1) / 10) + 1); }

  function ball(n, extra) {
    var b = el('span', 'lt-ball lt-ball--' + band(n) + (extra ? ' ' + extra : ''),
               String(n));
    return b;
  }

  /* ── Generator ───────────────────────────────────────────────────────── */

  var locked = [];

  var grid = $('#lt-grid');
  var countSel = $('#lt-count');
  var runBtn = $('#lt-run');
  var results = $('#lt-results');
  var lockHint = $('#lt-lock-hint');

  function renderGrid() {
    if (!grid) return;
    grid.setAttribute('role', 'group');
    for (var n = 1; n <= L.POOL; n++) {
      var b = el('button', 'lt-cell', String(n));
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', n + '번 고정');
      // Roving tabindex: the grid is one tab stop, arrows move inside it.
      b.tabIndex = n === 1 ? 0 : -1;
      b.dataset.n = String(n);
      grid.appendChild(b);
    }
  }

  function cells() { return $$('.lt-cell', grid); }

  function updateLockHint(msg) {
    if (!lockHint) return;
    if (!locked.length) {
      lockHint.textContent = '숫자를 눌러 최대 5개까지 고정할 수 있습니다.';
      lockHint.className = 'lt-hint';
      return;
    }
    var full = locked.length >= L.PICK - 1;
    var list = locked.slice().sort(function (a, b) { return a - b; }).join(', ');
    // The cap has to be visible here. `announce` writes to a live region that is
    // collapsed to height 0, so refusing a 6th lock with only an announcement
    // left a sighted visitor pressing a button that appeared to do nothing.
    // The old wording was also wrong: it said "더 고정하면", as though more were
    // still possible at the cap.
    lockHint.textContent = '고정: ' + list + (
      msg ? ' — ' + msg
          : full ? ' — 최대 5개까지 고정했습니다. 바꾸려면 고정된 번호를 눌러 해제하세요.'
                 : '');
    lockHint.className = (msg || full) ? 'lt-hint lt-hint--bad' : 'lt-hint';
  }

  function toggleLock(n, btn) {
    var i = locked.indexOf(n);
    if (i >= 0) {
      locked.splice(i, 1);
      btn.setAttribute('aria-pressed', 'false');
    } else {
      // Cap at 5. Locking all 6 would leave nothing to choose between, and the
      // page would be presenting the user's own numbers back as a result.
      if (locked.length >= L.PICK - 1) {
        updateLockHint('최대 5개까지만 고정할 수 있습니다.');
        announce('고정은 최대 5개까지 가능합니다.');
        return;
      }
      locked.push(n);
      btn.setAttribute('aria-pressed', 'true');
    }
    updateLockHint();
  }

  function focusCell(idx) {
    var cs = cells();
    if (!cs.length) return;
    var i = Math.max(0, Math.min(cs.length - 1, idx));
    cs.forEach(function (c, j) { c.tabIndex = j === i ? 0 : -1; });
    cs[i].focus();
  }

  function bindGrid() {
    if (!grid) return;
    grid.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.lt-cell');
      if (btn) toggleLock(Number(btn.dataset.n), btn);
    });
    grid.addEventListener('keydown', function (ev) {
      var btn = ev.target.closest('.lt-cell');
      if (!btn) return;
      var cs = cells();
      var i = cs.indexOf(btn);
      var next = null;
      if (ev.key === 'ArrowRight') next = i + 1;
      else if (ev.key === 'ArrowLeft') next = i - 1;
      else if (ev.key === 'ArrowDown') next = i + L.GRID_COLS;
      else if (ev.key === 'ArrowUp') next = i - L.GRID_COLS;
      else if (ev.key === 'Home') next = 0;
      else if (ev.key === 'End') next = cs.length - 1;
      if (next === null) return;
      ev.preventDefault();
      // 45 cells in a 7-wide grid leaves a ragged last row, so ±7 can land out
      // of range. Clamping would move focus to a different COLUMN rather than
      // leave it alone — from 42 (col 6) a Down press jumped to 45 (col 2).
      if (next < 0 || next >= cs.length) return;
      focusCell(next);
    });
  }

  function popClass(p) {
    if (p >= 28) return 'lt-pop lt-pop--high';
    if (p >= 18) return 'lt-pop lt-pop--mid';
    return 'lt-pop';
  }

  /* Copy without a network or a permission prompt where possible.
     `navigator.clipboard` is undefined outside a secure context, so the
     execCommand path is a real fallback rather than legacy cruft — and a failure
     is reported on the button itself instead of being swallowed, because a copy
     button that does nothing silently is worse than no button. */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }

  function renderRow(s) {
    var row = el('div', 'lt-row');

    var balls = el('div', 'lt-balls');
    s.numbers.forEach(function (n) { balls.appendChild(ball(n)); });
    row.appendChild(balls);

    var meta = el('div', 'lt-row-meta');
    meta.appendChild(el('span', popClass(s.popularity), s.popularity.toFixed(0) + '%'));
    meta.appendChild(el('span', 'lt-pop-label', '예상 수동 선택률'));

    var text = s.numbers.join(', ');
    var copy = el('button', 'lt-btn lt-copy', '복사');
    copy.type = 'button';
    copy.setAttribute('aria-label', text + ' 복사');
    var resetTimer = null;
    copy.addEventListener('click', function () {
      copyText(text).then(function () {
        copy.textContent = '복사됨';
        announce(text + ' 복사했습니다.');
      }, function () {
        copy.textContent = '복사 실패';
        announce('복사하지 못했습니다. 번호를 직접 선택해 복사하세요.');
      }).then(function () {
        // Scheduled when the copy settles, not when it was clicked. A clipboard
        // slower than 1600ms — a permission prompt, a sluggish execCommand
        // fallback — would otherwise let the timer restore '복사' first and then
        // have the promise write '복사됨' with no timer left to clear it.
        clearTimeout(resetTimer);
        resetTimer = setTimeout(function () { copy.textContent = '복사'; }, 1600);
      });
    });
    meta.appendChild(copy);
    row.appendChild(meta);

    var ul = el('ul', 'lt-reasons');
    s.reasons.forEach(function (r) {
      ul.appendChild(el('li', r.good ? 'is-good' : null, r.text));
    });
    row.appendChild(ul);
    return row;
  }

  /* `speak` is false for the render that happens on load. A live region firing
     at boot talks over the page being read, and the boot render is not a
     response to anything the visitor did. */
  function renderResults(sets, speak) {
    results.textContent = '';
    sets.forEach(function (s) { results.appendChild(renderRow(s)); });
    if (speak && sets.length) {
      announce(sets.length + '개 조합을 생성했습니다. 첫 조합 ' +
               sets[0].numbers.join(', ') + '.');
    }
  }

  /* Best-of-N over uniform candidates, and N is deliberately small.
     `popularity` is a coarse step function, so at N=900 the argmin lands in the
     same extreme corner every time: 1499 of 1500 sampled rows came back
     "consecutive AND clustered" with five or six numbers from 32..45, and not
     one row ever reached the legend's middle or upper tier. That is both an
     extrapolation past the fitted support and a shape the common "avoid
     birthdays" advice also produces — crowded for the very reason the model is
     trying to avoid. At N=20 the spread survives and all three tiers occur. */
  var TRIES = 20;

  function run(speak) {
    var n = Number(countSel && countSel.value) || 5;
    renderResults(L.generate({ count: n, tries: TRIES, locked: locked }), speak);
  }

  /* ── Boot ────────────────────────────────────────────────────────────── */

  renderGrid();
  bindGrid();
  updateLockHint();
  if (runBtn) runBtn.addEventListener('click', function () { run(true); });
  // A first set on load, so the page shows what it does before being asked.
  // Routed through run() so it honours the <select> default rather than
  // hardcoding a count that would drift if the markup changed.
  if (results) run(false);
})();
