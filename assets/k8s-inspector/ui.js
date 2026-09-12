/* assets/k8s-inspector/ui.js
 * DOM binding and rendering — the only file that touches the page.
 *
 * Hand-maintained.
 *
 * Invariants held here:
 *   - Findings render with textContent, never innerHTML. The input is a pasted
 *     manifest, which is exactly the text an attacker controls.
 *   - The re-inspect is debounced. A 200-document paste must not re-run every
 *     rule on every keystroke.
 *   - The resource list is one tab stop with a roving tabindex, re-declared on
 *     every repaint — not one tab stop per resource.
 *   - Announcements go through #ki-status only. It is the page's single live
 *     region; a second one would talk over it.
 *   - Nothing is stored. If persistence is added later, prefix every key `ki-`
 *     (every tool on this blog shares one origin), wrap setItem because it
 *     throws in private mode and on a full quota, and validate what comes back
 *     field by field rather than parsing straight into state.
 */
(function () {
  'use strict';

  var el = {
    input: document.getElementById('ki-input'),
    inputMeta: document.getElementById('ki-input-meta'),
    parseError: document.getElementById('ki-parse-error'),
    resources: document.getElementById('ki-resources'),
    findings: document.getElementById('ki-findings'),
    empty: document.getElementById('ki-empty'),
    tally: document.getElementById('ki-tally'),
    countError: document.getElementById('ki-count-error'),
    countWarn: document.getElementById('ki-count-warn'),
    countOk: document.getElementById('ki-count-ok'),
    status: document.getElementById('ki-status'),
    sample: document.getElementById('ki-sample'),
    sampleEmpty: document.getElementById('ki-sample-empty'),
    convert: document.getElementById('ki-convert'),
    convertText: document.getElementById('ki-convert-text'),
    copy: document.getElementById('ki-copy'),
    clear: document.getElementById('ki-clear')
  };

  var SEVERITY = {
    error: { className: 'ki-sev--error', mark: '●', word: 'Error' },
    warn: { className: 'ki-sev--warn', mark: '▲', word: 'Warning' },
    ok: { className: 'ki-sev--ok', mark: '✓', word: 'Passed' }
  };

  var state = {
    resources: [],
    selected: 0,
    format: null
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

  /* The strip itself is not a live region — #ki-status is the page's only one,
   * and it could not have been a working one: CSS collapses the strip while it
   * is empty, and `display: none` keeps a node out of the accessibility tree
   * exactly as `hidden` does.
   *
   * Announced only on change. This runs on every debounce tick while a document
   * is half-typed, and repeating the same parse error on each keystroke would
   * make the editor unusable with a screen reader. */
  var lastParseError = '';

  function showParseError(message) {
    var text = message || '';
    if (el.parseError.textContent !== text) el.parseError.textContent = text;
    if (text !== lastParseError) {
      lastParseError = text;
      if (text) announce(text);
    }
  }

  /* Clearing goes through the same path so `lastParseError` cannot get stuck —
   * otherwise the same error, fixed and reintroduced, would announce only once. */
  function clearParseError() {
    showParseError('');
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  function titleOf(info) {
    if (!info.kind) return 'document ' + (info.index + 1);
    return info.name ? info.kind + '/' + info.name : info.kind;
  }

  // ------------------------------------------------------------ rendering

  /* Exactly one row is tabbable at a time; this is the one. Every repaint has to
   * call it, or the list drops out of the tab order entirely — the same trap the
   * diagram palette hit when its tiles were rebuilt on each search keystroke. */
  function setRovingRow(index) {
    var rows = el.resources.querySelectorAll('.ki-resource');
    for (var i = 0; i < rows.length; i++) {
      rows[i].tabIndex = i === index ? 0 : -1;
    }
  }

  function moveSelection(delta, focus) {
    if (!state.resources.length) return;
    var next = state.selected + delta;
    if (next < 0) next = 0;
    if (next > state.resources.length - 1) next = state.resources.length - 1;
    if (next === state.selected) return;
    select(next, focus);
  }

  function select(index, focus) {
    state.selected = index;
    renderResources();
    renderFindings();
    if (focus) {
      var row = el.resources.querySelectorAll('.ki-resource')[index];
      if (row) row.focus();
    }
  }

  function worstSeverity(resource) {
    if (resource.findings.some(function (f) { return f.severity === 'error'; })) return 'error';
    if (resource.findings.some(function (f) { return f.severity === 'warn'; })) return 'warn';
    return 'ok';
  }

  function renderResources() {
    el.resources.textContent = '';
    if (state.resources.length < 1) return;

    state.resources.forEach(function (resource, i) {
      var sev = SEVERITY[worstSeverity(resource)];
      var li = node('li');
      var btn = node('button', 'ki-resource ' + sev.className);
      btn.type = 'button';
      btn.tabIndex = i === state.selected ? 0 : -1;
      if (i === state.selected) btn.setAttribute('aria-current', 'true');

      btn.appendChild(node('span', 'ki-resource-mark', sev.mark));
      btn.appendChild(node('span', 'ki-resource-name', titleOf(resource.info)));

      var count = resource.findings.length;
      if (count) btn.appendChild(node('span', 'ki-resource-count', String(count)));

      // The accessible name has to carry what the colour and the glyph carry.
      btn.setAttribute('aria-label',
        titleOf(resource.info) + ' — ' +
        (count ? plural(count, 'finding') : 'no findings') +
        (resource.info.namespace ? ', namespace ' + resource.info.namespace : ''));

      btn.addEventListener('click', function () {
        /* `select` repaints the list, so this button is gone afterwards. Restore
         * focus only when it had it — a mouse click in Safari never focuses a
         * <button>, so this stays a no-op there instead of stealing focus. */
        select(i, document.activeElement === btn);
      });
      btn.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
          ev.preventDefault(); moveSelection(1, true);
        } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
          ev.preventDefault(); moveSelection(-1, true);
        } else if (ev.key === 'Home') {
          ev.preventDefault(); select(0, true);
        } else if (ev.key === 'End') {
          ev.preventDefault(); select(state.resources.length - 1, true);
        }
      });

      li.appendChild(btn);
      el.resources.appendChild(li);
    });

    setRovingRow(state.selected);
  }

  function findingCard(finding) {
    var sev = SEVERITY[finding.severity] || SEVERITY.warn;
    var card = node('div', 'ki-finding ' + sev.className);

    var head = node('div', 'ki-finding-head');
    head.appendChild(node('span', 'ki-finding-mark', sev.mark));
    head.appendChild(node('span', 'ki-finding-title', finding.title));
    // Screen readers get the severity as a word; sighted readers get the glyph.
    head.appendChild(node('span', 'ki-sr-only', sev.word));
    card.appendChild(head);

    if (finding.where) card.appendChild(node('code', 'ki-finding-where', finding.where));
    card.appendChild(node('p', 'ki-finding-detail', finding.detail));
    return card;
  }

  function renderFindings() {
    el.findings.textContent = '';
    var resource = state.resources[state.selected];
    if (!resource) return;

    var header = node('div', 'ki-finding-context');
    header.appendChild(node('b', null, titleOf(resource.info)));
    var sub = [resource.info.apiVersion, resource.info.namespace &&
      'namespace ' + resource.info.namespace].filter(Boolean).join(' · ');
    if (sub) header.appendChild(node('span', null, sub));
    el.findings.appendChild(header);

    ['error', 'warn'].forEach(function (severity) {
      resource.findings
        .filter(function (f) { return f.severity === severity; })
        .forEach(function (f) { el.findings.appendChild(findingCard(f)); });
    });

    /* What passed, not only what failed. A resource with no findings and a
     * resource nothing applied to look identical without this — and they mean
     * completely different things. */
    if (resource.passed.length) {
      var passed = node('div', 'ki-passed');
      passed.appendChild(node('p', 'ki-passed-title',
        plural(resource.passed.length, 'check') + ' passed'));
      var list = node('ul', 'ki-passed-list');
      // Safari drops list semantics when `list-style: none` is applied.
      list.setAttribute('role', 'list');
      resource.passed.forEach(function (p) {
        list.appendChild(node('li', null, p.title));
      });
      passed.appendChild(list);
      el.findings.appendChild(passed);
    } else if (!resource.findings.length) {
      el.findings.appendChild(node('p', 'ki-passed-title',
        'No rule in this tool applies to ' + (resource.info.kind || 'this document') + '.'));
    }
  }

  // ------------------------------------------------------------------ run

  function run() {
    var source = el.input.value;

    if (!source.trim()) {
      state.resources = [];
      state.selected = 0;
      state.format = null;
      el.resources.textContent = '';
      el.findings.textContent = '';
      el.empty.hidden = false;
      el.tally.hidden = true;
      clearParseError();
      el.inputMeta.textContent = '';
      return;
    }

    var parsed = window.KI_INSPECT.parse(source);
    state.format = parsed.format;

    // A whole-input failure (malformed JSON) has no documents to report against,
    // so it belongs on the input strip rather than in the report.
    if (parsed.error) {
      showParseError(parsed.error);
      el.inputMeta.textContent = parsed.format ? parsed.format.toUpperCase() : '';
      /* The report on screen describes text the user has already replaced —
       * typing `{` in front of valid YAML flips this branch on. Counts and
       * resource chips for the old input are worse than none. */
      state.resources = [];
      el.resources.textContent = '';
      el.findings.textContent = '';
      el.tally.hidden = true;
      return;
    }
    clearParseError();

    state.resources = window.KI_INSPECT.inspect(parsed);
    if (!state.resources.length) {
      // Separators only, or helm output where every template rendered empty.
      // Falls back to the empty state rather than a blank report pane.
      el.resources.textContent = '';
      el.findings.textContent = '';
      el.empty.hidden = false;
      el.tally.hidden = true;
      el.inputMeta.textContent = '0 documents · ' + (parsed.format || '').toUpperCase();
      return;
    }
    if (state.selected > state.resources.length - 1) state.selected = 0;

    var counts = window.KI_INSPECT.tally(state.resources);
    el.countError.textContent = String(counts.error);
    el.countWarn.textContent = String(counts.warn);
    el.countOk.textContent = String(counts.ok);
    el.tally.hidden = false;
    el.empty.hidden = true;

    el.inputMeta.textContent =
      plural(state.resources.length, 'document') + ' · ' +
      (parsed.format || '').toUpperCase();

    renderResources();
    renderFindings();
    setConvertLabel();
  }

  /* Debounced so a large paste does not re-run every rule per keystroke. The
   * announcement is deliberately not on this path — it would interrupt a screen
   * reader mid-word on every pause in typing. */
  var pending = null;
  function scheduleRun() {
    if (pending) clearTimeout(pending);
    pending = setTimeout(function () {
      pending = null;
      run();
    }, 180);
  }

  // -------------------------------------------------------------- actions

  function setConvertLabel() {
    // The label names the result, not the current state — "To JSON" turns YAML
    // into JSON. Naming the input instead is how these buttons get misread.
    el.convertText.textContent = state.format === 'json' ? 'To YAML' : 'To JSON';
  }

  function loadSample() {
    el.input.value = window.KI_SAMPLES.default;
    state.selected = 0;
    run();
    announce('Loaded the sample manifest.');
    el.input.focus();
  }

  function convert() {
    var source = el.input.value;
    if (!source.trim()) { announce('Nothing to convert.'); return; }
    try {
      var toJson = state.format !== 'json';
      el.input.value = toJson
        ? window.KI_INSPECT.toJSON(source)
        : window.KI_INSPECT.toYAML(source);
      state.selected = 0;
      run();
      announce(toJson ? 'Converted to JSON.' : 'Converted to YAML.');
    } catch (err) {
      // Conversion needs a clean parse; the lint does not. Say which failed.
      showParseError('Cannot convert: ' + err.message);
      announce('Conversion failed — the input does not parse.');
    }
  }

  function copy() {
    var source = el.input.value;
    if (!source) { announce('Nothing to copy.'); return; }
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      announce('This browser will not let the page copy. Select the text and copy it.');
      return;
    }
    navigator.clipboard.writeText(source).then(function () {
      announce('Copied to the clipboard.');
    }, function () {
      announce('The browser refused clipboard access. Select the text and copy it.');
    });
  }

  function clear() {
    el.input.value = '';
    state.selected = 0;
    run();
    announce('Cleared.');
    el.input.focus();
  }

  // ----------------------------------------------------------------- bind

  el.input.addEventListener('input', scheduleRun);
  el.sample.addEventListener('click', loadSample);
  el.sampleEmpty.addEventListener('click', loadSample);
  el.convert.addEventListener('click', convert);
  el.copy.addEventListener('click', copy);
  el.clear.addEventListener('click', clear);

  /* Tab inserts a tab here rather than leaving the field. A manifest is
   * indentation-sensitive and this is the only control where that is true — so
   * Escape is bound as the documented way out, and the placeholder is not the
   * only place that says so. */
  el.input.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { el.findings.focus(); return; }
    if (ev.key !== 'Tab' || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    ev.preventDefault();
    var start = el.input.selectionStart;
    var end = el.input.selectionEnd;
    el.input.value = el.input.value.slice(0, start) + '  ' + el.input.value.slice(end);
    el.input.selectionStart = el.input.selectionEnd = start + 2;
    scheduleRun();
  });

  setConvertLabel();
  run();
})();
