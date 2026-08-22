/* assets/refactor-priority/ui.js
 * DOM binding and rendering — the only file on this page that touches the DOM.
 *
 * Hand-maintained.
 *
 * Invariants held here:
 *   - Everything renders through textContent, never innerHTML. The input is
 *     pasted source code, which is exactly the text an attacker controls, and a
 *     function name travels from it into the page unchanged.
 *   - The analysis is debounced. Re-scanning a 4,000-line paste on every
 *     keystroke would make the editor unusable.
 *   - The function list is one tab stop with a roving tabindex, re-declared on
 *     every repaint — not one tab stop per function.
 *   - Announcements go through #rp-status only. It is the page's single live
 *     region; a second one would talk over it. #rp-input-error is a visual strip
 *     that mirrors what was announced there, not a region of its own.
 *   - Nothing is stored. There is no localStorage call in this tool and no
 *     reason for one — the input is the state. If persistence is ever added,
 *     prefix every key `rp-` (every tool on this blog shares one origin), wrap
 *     setItem because it throws in private mode and on a full quota, and
 *     validate what comes back field by field rather than parsing into state.
 *   - No network. There is no fetch, no image, no font, no beacon on this page.
 */
(function () {
  'use strict';

  var el = {
    input: document.getElementById('rp-input'),
    inputMeta: document.getElementById('rp-input-meta'),
    inputError: document.getElementById('rp-input-error'),
    language: document.getElementById('rp-language'),
    tally: document.getElementById('rp-tally'),
    countFunctions: document.getElementById('rp-count-functions'),
    countHigh: document.getElementById('rp-count-high'),
    maxComplexity: document.getElementById('rp-max-complexity'),
    functions: document.getElementById('rp-functions'),
    detail: document.getElementById('rp-detail'),
    empty: document.getElementById('rp-empty'),
    status: document.getElementById('rp-status'),
    sample: document.getElementById('rp-sample'),
    sampleEmpty: document.getElementById('rp-sample-empty'),
    copy: document.getElementById('rp-copy'),
    clear: document.getElementById('rp-clear'),
    sortGroup: document.querySelector('.rp-sort'),
    sorts: document.querySelectorAll('.rp-tab[data-sort]')
  };

  var emptyTitle = el.empty.querySelector('.rp-empty-title');
  var emptyBody = el.empty.querySelector('p');

  /* Severity is carried by the left border and the score colour, and by the word
   * in the detail badge and in every row's accessible name — no glyph. */
  var SEVERITY = {
    high: { className: 'rp-sev--high', word: 'High' },
    medium: { className: 'rp-sev--medium', word: 'Medium' },
    low: { className: 'rp-sev--low', word: 'Low' }
  };

  /* Refusing a paste this large is the honest failure. The scan is linear, but a
   * multi-megabyte file still blocks the main thread long enough to look like a
   * crash, and "the page froze" is a worse answer than "that is too big". */
  var MAX_CHARS = 600000;

  /* MAX_CHARS bounds the scan; this bounds the paint, and they are different
   * problems. 595 kB of source measures in about 360ms, but it also yields
   * ~21,000 functions — seven DOM nodes and two listeners each — and every
   * arrow key rebuilds the list. The tally and the copied Markdown still
   * describe every function found; only the rows on screen are capped, and the
   * list says so rather than trailing off. */
  var MAX_ROWS = 300;

  var state = {
    rows: [],          // in source order, as analysed
    sorted: [],        // in display order, every function
    visible: [],       // the leading slice actually painted
    sort: 'priority',
    selectedId: null,
    language: null,    // the language actually used, guessed or chosen
    sampleIndex: 0
  };

  // --------------------------------------------------------------- helpers

  function node(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;   // never innerHTML — see the header
    return n;
  }

  function announce(message) {
    el.status.textContent = message || '';
  }

  /* The strip is not itself a live region, so it is announced through #rp-status
   * — and only when the text changes. This runs on every debounce tick, and
   * repeating the same message on each keystroke makes the editor unusable with
   * a screen reader. */
  var lastError = '';

  function showInputError(message) {
    var text = message || '';
    if (el.inputError.textContent !== text) el.inputError.textContent = text;
    if (text !== lastError) {
      lastError = text;
      if (text) announce(text);
    }
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  function languageLabel(key) {
    var lang = window.RP_DETECT.LANGS[key];
    return lang ? lang.label : 'unknown';
  }

  // ------------------------------------------------------------- rendering

  /* Exactly one row is tabbable at a time; this is the one. Every repaint has to
   * call it, or the list drops out of the tab order entirely. */
  function setRovingRow(index) {
    var rows = el.functions.querySelectorAll('.rp-function');
    for (var i = 0; i < rows.length; i++) rows[i].tabIndex = i === index ? 0 : -1;
  }

  /* Indexes are into `state.visible`, never `state.sorted`. Selecting row 4,000
   * of a capped list would set an id with no button behind it, and the focus
   * call after the repaint would then land nowhere. */
  function selectedIndex() {
    for (var i = 0; i < state.visible.length; i++) {
      if (state.visible[i].id === state.selectedId) return i;
    }
    return state.visible.length ? 0 : -1;
  }

  function select(index, focus) {
    if (index < 0 || index >= state.visible.length) return;
    state.selectedId = state.visible[index].id;
    renderList();
    renderDetail();
    if (focus) {
      var row = el.functions.querySelectorAll('.rp-function')[index];
      if (row) row.focus();
    }
  }

  function moveSelection(delta, focus) {
    var next = selectedIndex() + delta;
    if (next < 0) next = 0;
    if (next > state.visible.length - 1) next = state.visible.length - 1;
    select(next, focus);
  }

  function renderList() {
    el.functions.textContent = '';
    var current = selectedIndex();

    state.visible.forEach(function (row, i) {
      var sev = SEVERITY[row.severity];
      var li = node('li');
      var btn = node('button', 'rp-function ' + sev.className);
      btn.type = 'button';
      btn.tabIndex = i === current ? 0 : -1;
      if (i === current) btn.setAttribute('aria-current', 'true');

      btn.appendChild(node('span', 'rp-function-rank', String(i + 1)));

      var main = node('span', 'rp-function-main');
      main.appendChild(node('span', 'rp-function-name', row.name));
      main.appendChild(node('span', 'rp-function-where',
        'line ' + row.startLine + '–' + row.endLine +
        (row.parent ? ' · in ' + row.parent : '')));
      btn.appendChild(main);

      var figures = node('span', 'rp-function-figures');
      figures.appendChild(node('span', 'rp-figure', 'C ' + row.metrics.complexity));
      figures.appendChild(node('span', 'rp-figure', 'N ' + row.metrics.nesting));
      figures.appendChild(node('span', 'rp-figure', 'L ' + row.metrics.sloc));
      btn.appendChild(figures);

      btn.appendChild(node('span', 'rp-function-score', String(row.score)));

      /* The accessible name has to carry what the colour, the glyph and the
       * abbreviated figures carry. */
      btn.setAttribute('aria-label',
        row.name + ', ' + sev.word.toLowerCase() + ' priority, score ' + row.score +
        '. Complexity ' + row.metrics.complexity +
        ', nesting ' + row.metrics.nesting +
        ', ' + plural(row.metrics.sloc, 'line') +
        ', ' + plural(row.metrics.params, 'parameter') +
        '. Lines ' + row.startLine + ' to ' + row.endLine + '.');

      btn.addEventListener('click', function () {
        /* `select` repaints the list, so this button is gone afterwards. Restore
         * focus only when it had it — a mouse click in Safari never focuses a
         * <button>, so this stays a no-op there instead of stealing focus. */
        select(i, document.activeElement === btn);
      });
      btn.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') { ev.preventDefault(); moveSelection(1, true); }
        else if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') { ev.preventDefault(); moveSelection(-1, true); }
        else if (ev.key === 'Home') { ev.preventDefault(); select(0, true); }
        else if (ev.key === 'End') { ev.preventDefault(); select(state.visible.length - 1, true); }
      });

      li.appendChild(btn);
      el.functions.appendChild(li);
    });

    /* A cap that says nothing reads as "that was all of them", which is the one
     * thing it is not. */
    if (state.sorted.length > state.visible.length) {
      el.functions.appendChild(node('li', 'rp-truncated',
        'Showing the worst ' + state.visible.length + ' of ' + state.sorted.length +
        ' functions. Copy exports all of them.'));
    }

    setRovingRow(current);
  }

  function metricRow(row, key) {
    var limit = window.RP_SCORE.LIMITS[key];
    var value = row.metrics[key];
    var pressure = row.pressures[key];

    var wrap = node('div', 'rp-metric' + (value > limit ? ' rp-metric--over' : ''));
    wrap.appendChild(node('span', 'rp-metric-label', window.RP_SCORE.SHORT[key]));

    var track = node('span', 'rp-metric-track');
    var fill = node('span', 'rp-metric-fill');
    /* The only inline style on the page. It is data — how far this measurement
     * went against its limit — not styling, and the bar is capped at full while
     * the figure beside it keeps saying how far past it actually went. */
    fill.style.width = Math.max(2, Math.min(100, Math.round(pressure * 100))) + '%';
    track.appendChild(fill);
    wrap.appendChild(track);

    wrap.appendChild(node('span', 'rp-metric-value', value + ' / ' + limit));
    return wrap;
  }

  function renderDetail() {
    el.detail.textContent = '';
    var index = selectedIndex();
    if (index < 0) return;
    var row = state.visible[index];
    var sev = SEVERITY[row.severity];

    var head = node('div', 'rp-detail-head');
    head.appendChild(node('b', 'rp-detail-name', row.name));
    head.appendChild(node('span', 'rp-badge ' + sev.className, sev.word));
    head.appendChild(node('span', 'rp-detail-where',
      'line ' + row.startLine + '–' + row.endLine + ' · ' + plural(row.metrics.lines, 'line') + ' spanned'));
    el.detail.appendChild(head);

    el.detail.appendChild(node('p', 'rp-detail-driver', 'Ranked on ' + row.driver.text + '.'));

    var metrics = node('div', 'rp-metrics');
    window.RP_SCORE.KEYS.forEach(function (key) { metrics.appendChild(metricRow(row, key)); });
    el.detail.appendChild(metrics);

    if (row.params.length) {
      el.detail.appendChild(node('p', 'rp-detail-params',
        plural(row.params.length, 'parameter') + ': ' + row.params.join(', ')));
    }

    /* Said here rather than only in the note at the top, because this is the
     * pane where the number that looks wrong is being read. Both directions are
     * stated: a closure explains why its lines appear twice, and the function
     * containing one explains why its own figures are larger than the code a
     * reader would call "this function". */
    if (row.parent) {
      el.detail.appendChild(node('p', 'rp-detail-note',
        'Nested inside ' + row.parent + '. These lines are counted here and again in that function’s figures.'));
    }
    if (row.children) {
      el.detail.appendChild(node('p', 'rp-detail-note',
        'Contains ' + plural(row.children, 'nested function') +
        ', measured here as well as on ' + (row.children === 1 ? 'its own row' : 'their own rows') + '.'));
    }
  }

  function renderTally(counts) {
    el.countFunctions.textContent = String(counts.functions);
    el.countHigh.textContent = String(counts.high);
    el.maxComplexity.textContent = String(counts.maxComplexity);
  }

  /* Every path that leaves the ranking empty comes through here, so the sort
   * buttons cannot be left up over nothing — four controls whose only possible
   * outcome is "sorted an empty list". */
  function setEmpty(title, body) {
    emptyTitle.textContent = title;
    emptyBody.textContent = body;
    el.empty.hidden = false;
    el.sortGroup.hidden = true;
  }

  // ------------------------------------------------------------------- run

  function resort() {
    state.sorted = window.RP_SCORE.sort(state.rows, state.sort);
    state.visible = state.sorted.slice(0, MAX_ROWS);
    if (!state.visible.length) { state.selectedId = null; return; }
    var stillThere = state.visible.some(function (r) { return r.id === state.selectedId; });
    if (!stillThere) state.selectedId = state.visible[0].id;
  }

  function run() {
    var source = el.input.value;
    var choice = el.language.value;

    if (!source.trim()) {
      state.rows = [];
      state.sorted = [];
      state.visible = [];
      state.selectedId = null;
      state.language = null;
      el.functions.textContent = '';
      el.detail.textContent = '';
      el.tally.hidden = true;
      el.inputMeta.textContent = '';
      showInputError('');
      setEmpty('Nothing analysed yet',
        'Paste a file on the left, or start from an example and edit it.');
      return;
    }

    if (source.length > MAX_CHARS) {
      state.rows = [];
      state.sorted = [];
      state.visible = [];
      el.functions.textContent = '';
      el.detail.textContent = '';
      el.tally.hidden = true;
      el.inputMeta.textContent = source.length.toLocaleString() + ' characters';
      showInputError('That is ' + source.length.toLocaleString() + ' characters, past the ' +
        MAX_CHARS.toLocaleString() + ' this page will scan in one pass. Paste one file at a time.');
      setEmpty('Not analysed', 'The input is larger than this page will scan in one pass.');
      return;
    }
    showInputError('');

    var lang = choice === 'auto' ? window.RP_DETECT.guessLanguage(source) : choice;
    state.language = lang;
    state.rows = window.RP_SCORE.analyse(source, lang);
    resort();

    var lineCount = source.split('\n').length;
    el.inputMeta.textContent =
      plural(lineCount, 'line') + ' · ' + plural(state.rows.length, 'function') + ' · ' +
      (choice === 'auto' ? 'looks like ' + languageLabel(lang) : languageLabel(lang));

    if (!state.rows.length) {
      el.functions.textContent = '';
      el.detail.textContent = '';
      el.tally.hidden = true;
      setEmpty('No functions found',
        'Read as ' + languageLabel(lang) + '. If that is wrong, choose the language by hand — ' +
        'boundaries are found by matching braces or by reading indentation, and the other ' +
        'scanner finds nothing at all.');
      return;
    }

    el.empty.hidden = true;
    el.sortGroup.hidden = false;
    el.tally.hidden = false;
    renderTally(window.RP_SCORE.tally(state.rows));
    renderList();
    renderDetail();
  }

  /* Debounced so a large paste does not re-scan on every keystroke. The
   * announcement is deliberately off this path — it would interrupt a screen
   * reader mid-word at every pause in typing. */
  var pending = null;
  function scheduleRun() {
    if (pending) clearTimeout(pending);
    pending = setTimeout(function () { pending = null; run(); }, 200);
  }

  // --------------------------------------------------------------- actions

  /* Cycles rather than reloading the same file. The two examples exist to show
   * the two boundary scanners, and a button that always loads the first one
   * would only ever show one of them. */
  function loadSample(index) {
    var samples = window.RP_SAMPLES;
    var i = typeof index === 'number' ? index : state.sampleIndex;
    var sample = samples[i % samples.length];
    state.sampleIndex = (i + 1) % samples.length;

    el.input.value = sample.text;
    /* The example is pinned to its language rather than left on auto — the point
     * of the second one is to run the indentation scanner, and a guess is not a
     * demonstration. */
    el.language.value = sample.language;
    state.selectedId = null;
    run();
    announce('Loaded the ' + sample.label + ' example.');
    el.input.focus();
  }

  function copy() {
    if (!state.sorted.length) { announce('Nothing to copy yet.'); return; }
    var text = window.RP_REPORT.toMarkdown(state.sorted, {
      language: languageLabel(state.language),
      totalLines: el.input.value.split('\n').length
    });
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      announce('This browser will not let the page copy. Select the ranking and copy it by hand.');
      return;
    }
    navigator.clipboard.writeText(text).then(function () {
      announce('Copied the ranking as a Markdown table.');
    }, function () {
      announce('The browser refused clipboard access. Select the ranking and copy it by hand.');
    });
  }

  function clear() {
    el.input.value = '';
    state.selectedId = null;
    run();
    announce('Cleared.');
    el.input.focus();
  }

  function setSort(key) {
    state.sort = key;
    for (var i = 0; i < el.sorts.length; i++) {
      el.sorts[i].setAttribute('aria-pressed', el.sorts[i].getAttribute('data-sort') === key ? 'true' : 'false');
    }
    resort();
    renderList();
    renderDetail();
    announce('Sorted by ' + key + '.');
  }

  // ------------------------------------------------------------------ bind

  el.input.addEventListener('input', scheduleRun);
  // A language change is a deliberate act, not typing — no reason to make it wait.
  el.language.addEventListener('change', function () { state.selectedId = null; run(); });
  el.sample.addEventListener('click', function () { loadSample(); });
  el.sampleEmpty.addEventListener('click', function () { loadSample(0); });
  el.copy.addEventListener('click', copy);
  el.clear.addEventListener('click', clear);

  for (var s = 0; s < el.sorts.length; s++) {
    (function (button) {
      button.addEventListener('click', function () { setSort(button.getAttribute('data-sort')); });
    })(el.sorts[s]);
  }

  /* Tab inserts an indent here rather than leaving the field. Indentation is
   * load-bearing for one of the two scanners, so a textarea that ate the key
   * would quietly change the answer. Escape is bound as the documented way out,
   * and the placeholder is not the only place that says so. */
  el.input.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      var index = selectedIndex();
      /* Tab is consumed as an indent, so Escape is the only forward exit from
       * this field. Announcing and staying put would leave a keyboard user with
       * nothing but Shift+Tab — and an empty ranking is the first-visit state,
       * so that is precisely when it would happen. */
      if (index < 0) {
        el.language.focus();
        announce('Nothing in the ranking yet — moved to the language field.');
        return;
      }
      select(index, true);
      return;
    }
    if (ev.key !== 'Tab' || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    ev.preventDefault();
    /* `execCommand('insertText')` keeps the browser's own undo stack intact.
     * Assigning to `.value` wipes it, so a single Tab used to make Ctrl+Z stop
     * undoing everything typed before it — a real loss in a field whose whole
     * purpose is pasting code and then editing it. The assignment stays as the
     * fallback for anything that refuses the command. */
    var inserted = false;
    try {
      inserted = document.execCommand && document.execCommand('insertText', false, '  ');
    } catch (err) {
      inserted = false;
    }
    if (!inserted) {
      var start = el.input.selectionStart;
      var end = el.input.selectionEnd;
      el.input.value = el.input.value.slice(0, start) + '  ' + el.input.value.slice(end);
      el.input.selectionStart = el.input.selectionEnd = start + 2;
    }
    scheduleRun();
  });

  run();
})();
