/* ui.js — the only file on /lotto/ that touches the DOM.
 *
 * Nothing is stored: a fresh set every visit is the honest behaviour for a page
 * whose argument is that each draw is independent.
 */
(function () {
  'use strict';

  var L = window.Lotto;
  if (!L) return;

  var modelEl = document.getElementById('lt-model');
  if (modelEl) {
    try { L.setModel(JSON.parse(modelEl.textContent)); } catch (e) { /* keep the fallback */ }
  }

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

  /* 동행복권's own colour bands, which readers already associate with ranges. */
  function band(n) { return Math.min(5, Math.floor((n - 1) / 10) + 1); }

  function ball(n, extra) {
    var b = el('span', 'lt-ball lt-ball--' + band(n) + (extra ? ' ' + extra : ''),
               String(n));
    return b;
  }

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
    // The cap must be visible here: the live region is collapsed, so an
    // announcement alone leaves a sighted visitor pressing a dead button.
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
      // The last row is ragged, so ±7 can land out of range. Clamping would
      // move focus to a different column; stay put instead.
      if (next < 0 || next >= cs.length) return;
      focusCell(next);
    });
  }

  function popClass(p) {
    if (p >= 28) return 'lt-pop lt-pop--high';
    if (p >= 18) return 'lt-pop lt-pop--mid';
    return 'lt-pop';
  }

  /* `navigator.clipboard` is undefined outside a secure context, so the
     execCommand path is a real fallback. A failure is reported, not swallowed. */
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
        // Scheduled when the copy settles, not on click: a slow clipboard would
        // otherwise write '복사됨' after the reset timer already fired.
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

  /* `speak` is false on load: a live region firing at boot talks over the page
     being read. */
  function renderResults(sets, speak) {
    results.textContent = '';
    sets.forEach(function (s) { results.appendChild(renderRow(s)); });
    if (speak && sets.length) {
      announce(sets.length + '개 조합을 생성했습니다. 첫 조합 ' +
               sets[0].numbers.join(', ') + '.');
    }
  }

  /* N is deliberately small. `popularity` is a coarse step function, so a large
     N lands the argmin in the same extreme corner every time — past the fitted
     support and crowded by "avoid birthdays" advice. At N=20 the spread survives. */
  var TRIES = 20;

  function run(speak) {
    var n = Number(countSel && countSel.value) || 5;
    renderResults(L.generate({ count: n, tries: TRIES, locked: locked }), speak);
  }

  renderGrid();
  bindGrid();
  updateLockHint();
  if (runBtn) runBtn.addEventListener('click', function () { run(true); });
  // A first set on load, through run() so it honours the <select> default.
  if (results) run(false);
})();
