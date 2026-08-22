/* assets/vpc-planner/ui.js
 * DOM binding and rendering — the only file that touches the page.
 *
 * Hand-maintained. Nothing generates this file.
 *
 * Invariants this file holds:
 *   - Every value coming from the form or the hash renders through textContent,
 *     never innerHTML. A CIDR field is free text and the name prefix goes
 *     straight into the table, the export and the bar's label.
 *   - The only inline style written anywhere is a bar segment's width
 *     percentage. Everything else is a class.
 *   - The refresh is debounced. Recomputing a 256-subnet split on every
 *     keystroke is wasted work and makes the field feel heavy. The checkbox and
 *     the mode radios refresh immediately — a click is not a keystroke.
 *   - Announcements go through #vp-status only. It is the page's single live
 *     region; a second one would talk over it.
 *   - Nothing is stored. The share hash is the only persistence, and it lives in
 *     share.js. If a localStorage slot is ever added, prefix the key `vp-`
 *     (every tool on this blog shares one origin), wrap setItem because it
 *     throws in private mode and on a full quota, surface that failure once
 *     rather than on every write, and validate what comes back field by field
 *     instead of parsing straight into state.
 */
(function (global) {
  'use strict';

  var CIDR = global.VPCidr;
  var PLAN = global.VPPlan;
  var EXPORT = global.VPExport;
  var SHARE = global.VPShare;

  var el = {
    cidr: document.getElementById('vp-cidr'),
    modeEven: document.getElementById('vp-mode-even'),
    modeWeighted: document.getElementById('vp-mode-weighted'),
    panelEven: document.getElementById('vp-mode-even-panel'),
    panelWeighted: document.getElementById('vp-mode-weighted-panel'),
    count: document.getElementById('vp-count'),
    prefixes: document.getElementById('vp-prefixes'),
    azs: document.getElementById('vp-azs'),
    namePrefix: document.getElementById('vp-name-prefix'),
    awsReserved: document.getElementById('vp-aws-reserved'),
    existing: document.getElementById('vp-existing'),
    inputError: document.getElementById('vp-input-error'),
    planMeta: document.getElementById('vp-plan-meta'),

    tally: document.getElementById('vp-tally'),
    countSubnets: document.getElementById('vp-count-subnets'),
    countUsable: document.getElementById('vp-count-usable'),
    countFree: document.getElementById('vp-count-free'),
    bar: document.getElementById('vp-bar'),
    barLegend: document.getElementById('vp-bar-legend'),
    conflicts: document.getElementById('vp-conflicts'),
    rows: document.getElementById('vp-rows'),
    exportOut: document.getElementById('vp-export-out'),
    tabs: Array.prototype.slice.call(document.querySelectorAll('.vp-tab')),
    copy: document.getElementById('vp-copy'),

    tableWrap: document.querySelector('.vp-table-wrap'),
    exportBox: document.querySelector('.vp-export'),

    empty: document.getElementById('vp-empty'),
    example: document.getElementById('vp-example'),
    exampleEmpty: document.getElementById('vp-example-empty'),
    share: document.getElementById('vp-share'),
    reset: document.getElementById('vp-reset'),
    status: document.getElementById('vp-status')
  };

  var format = 'terraform';
  /* The last normalised input and the plan it produced, kept so Share, Copy and
   * a format switch do not have to re-read the form and recompute a 256-subnet
   * split to answer a click. */
  var current = null;
  var currentPlan = null;

  var EXAMPLE = {
    cidr: '10.0.0.0/16',
    mode: 'even',
    count: '6',
    prefixes: '24, 24, 24, 26, 26, 28',
    azs: '3',
    namePrefix: 'app',
    awsReserved: true,
    existing: '10.1.0.0/16\n192.168.0.0/24'
  };

  /* -------------------------------------------------------------- helpers */

  function announce(message) {
    el.status.textContent = message || '';
  }

  function num(n) {
    return Number(n).toLocaleString('en-US');
  }

  function debounce(fn, ms) {
    var timer = null;
    return function () {
      if (timer) { clearTimeout(timer); }
      timer = setTimeout(function () { timer = null; fn(); }, ms);
    };
  }

  function clear(node) {
    node.textContent = '';
  }

  /* Reads the form as-is. Normalising it into the `input` shape is VPPlan's job,
   * so that a share link and a form produce identical input. */
  function collect() {
    return {
      cidr: el.cidr.value,
      mode: el.modeWeighted.checked ? 'weighted' : 'even',
      count: el.count.value,
      prefixes: el.prefixes.value,
      azs: el.azs.value,
      namePrefix: el.namePrefix.value,
      awsReserved: el.awsReserved.checked,
      existing: el.existing.value
    };
  }

  function applyInput(input) {
    el.cidr.value = input.cidr || '';
    el.count.value = input.count == null ? '' : String(input.count);
    el.prefixes.value = Object.prototype.toString.call(input.prefixes) === '[object Array]'
      ? input.prefixes.join(', ')
      : String(input.prefixes || '');
    el.azs.value = input.azs == null ? '' : String(input.azs);
    el.namePrefix.value = input.namePrefix || '';
    el.awsReserved.checked = input.awsReserved !== false;
    el.existing.value = Object.prototype.toString.call(input.existing) === '[object Array]'
      ? input.existing.join('\n')
      : String(input.existing || '');

    var weighted = input.mode === 'weighted';
    el.modeWeighted.checked = weighted;
    el.modeEven.checked = !weighted;
    el.panelEven.hidden = weighted;
    el.panelWeighted.hidden = !weighted;
  }

  /* An input problem belongs beside the input, not in the result pane where it
   * would read as a finding about the plan.
   *
   * The strip itself is not a live region — #vp-status is the page's only one.
   * It could not be a reliable one either: CSS collapses it with `:empty`, and
   * `display: none` removes a node from the accessibility tree exactly as
   * `hidden` does, so a region that materialises at the same moment it gains
   * text is registered too late to announce it.
   *
   * Announced only when the text actually changes. refresh() runs on every
   * debounce tick, and re-announcing "not a valid IPv4 CIDR" on each keystroke
   * of a half-typed address would make the field unusable with a screen reader. */
  var lastInputError = '';

  function showInputError(message) {
    var text = message || '';
    el.inputError.textContent = text;
    if (text !== lastInputError) {
      lastInputError = text;
      if (text) { announce(text); }
    }
  }

  /* --------------------------------------------------------------- render */

  /* The bar, the legend, the conflict list and the export body all collapse on
   * their own through `:empty`. These two cannot: a table keeps its `<thead>`
   * and the export head keeps its live buttons. Toggling them here rather than
   * hiding `.vp-result` wholesale is deliberate — the conflict list lives inside
   * `.vp-result` and has to stay visible when a plan parsed but allocated
   * nothing, which is exactly when its message is the answer. */
  function showEmpty(isEmpty) {
    el.empty.hidden = !isEmpty;
    el.tally.hidden = isEmpty;
    el.tableWrap.hidden = isEmpty;
    el.exportBox.hidden = isEmpty;
  }

  function renderBar(plan) {
    clear(el.bar);

    /* Subnets and gaps drawn in address order, so the picture matches the
     * address space rather than the table's ordering. */
    var segments = plan.subnets.map(function (s) {
      return { block: s.block, free: false, clash: s.clash, label: s.name };
    }).concat(plan.gaps.map(function (g) {
      return { block: g.block, free: true, clash: false, label: 'free' };
    })).sort(function (a, b) { return a.block.addr - b.block.addr; });

    var total = CIDR.size(plan.parent);

    segments.forEach(function (seg) {
      var node = document.createElement('div');
      node.className = 'vp-bar-seg' +
        (seg.free ? ' vp-bar-seg--free' : '') +
        (seg.clash ? ' vp-bar-seg--clash' : '');
      /* The only inline style in this file, and it has to be inline: the width
       * is data, not a design decision a stylesheet could know. */
      node.style.width = (CIDR.size(seg.block) / total * 100) + '%';
      node.title = seg.label + ' · ' + CIDR.format(seg.block);
      el.bar.appendChild(node);
    });

    /* The segment widths carry the whole meaning and a screen reader gets none
     * of it from the divs, so the bar states its own summary. The table below
     * is the full accessible equivalent. */
    var freeCount = plan.gaps.length;
    el.bar.setAttribute('aria-label',
      'Allocation of ' + CIDR.format(plan.parent) + ': ' +
      plan.subnets.length + ' subnet' + (plan.subnets.length === 1 ? '' : 's') +
      ', ' + Math.round(plan.totals.freeRatio * 100) + ' percent free in ' +
      freeCount + ' block' + (freeCount === 1 ? '' : 's') + '.');

    if (!freeCount) {
      el.barLegend.textContent = 'Fully allocated — no space left in the block.';
    } else {
      var shown = plan.gaps.slice(0, 4).map(function (g) { return CIDR.format(g.block); });
      el.barLegend.textContent = 'Free: ' + shown.join(', ') +
        (freeCount > shown.length ? ' and ' + (freeCount - shown.length) + ' more' : '');
    }
  }

  function renderConflicts(plan) {
    clear(el.conflicts);
    plan.conflicts.forEach(function (c) {
      var li = document.createElement('li');
      li.className = 'vp-conflict' + (c.severity === 'warn' ? ' vp-conflict--warn' : '');
      li.textContent = c.message;
      el.conflicts.appendChild(li);
    });
  }

  function renderRows(plan) {
    clear(el.rows);
    plan.subnets.forEach(function (s) {
      var tr = document.createElement('tr');
      if (s.clash) { tr.className = 'vp-row--clash'; }

      [
        s.name,
        CIDR.format(s.block),
        s.az,
        s.first + ' – ' + s.last,
        num(s.usable)
      ].forEach(function (value, index) {
        var td = document.createElement('td');
        if (index === 4) { td.className = 'vp-num'; }
        td.textContent = value;
        tr.appendChild(td);
      });

      el.rows.appendChild(tr);
    });
  }

  function render(plan) {
    currentPlan = plan && plan.subnets.length ? plan : null;

    if (!plan || !plan.subnets.length) {
      showEmpty(true);
      clear(el.bar);
      el.bar.removeAttribute('aria-label');
      clear(el.barLegend);
      clear(el.rows);
      clear(el.exportOut);
      clear(el.planMeta);
      /* A parent that parsed but produced nothing still has conflicts worth
       * reading — "6 subnets do not fit" is the answer, not an empty screen. */
      if (plan) { renderConflicts(plan); } else { clear(el.conflicts); }
      return;
    }

    showEmpty(false);

    el.planMeta.textContent = CIDR.format(plan.parent) + ' · ' +
      num(CIDR.size(plan.parent)) + ' addresses';

    el.countSubnets.textContent = num(plan.totals.subnets);
    el.countUsable.textContent = num(plan.totals.usable);
    el.countFree.textContent = Math.round(plan.totals.freeRatio * 100) + '%';

    renderBar(plan);
    renderConflicts(plan);
    renderRows(plan);
    el.exportOut.textContent = EXPORT.render(plan, format);
  }

  /* Distinguishes "nothing typed yet" from "typed something wrong", which the
   * null out of build() alone cannot do. */
  function diagnose(raw, input) {
    if (!String(raw.cidr).trim()) { return ''; }
    if (!CIDR.parse(String(raw.cidr).trim())) {
      return 'Not a valid IPv4 CIDR. It also has to be the start of its own block — 10.0.1.0/16 is really 10.0.0.0/16.';
    }
    if (input && input.mode === 'weighted' && !input.prefixes.length) {
      return 'Enter at least one prefix length, like 24, 24, 26.';
    }

    /* `max` on a number input bounds the spinner, not what can be typed, so a
     * pasted 500 reaches normalise() and comes back as 256. Silently planning
     * something other than what the field says is worse than the clamp. */
    if (input) {
      var clamped = [];
      var typedCount = parseInt(raw.count, 10);
      var typedAzs = parseInt(raw.azs, 10);
      if (input.mode === 'even' && isFinite(typedCount) && typedCount !== input.count) {
        clamped.push('subnet count to ' + input.count);
      }
      if (isFinite(typedAzs) && typedAzs !== input.azs) {
        clamped.push('availability zones to ' + input.azs);
      }
      if (clamped.length) { return 'Limited the ' + clamped.join(' and the ') + '.'; }
    }
    return '';
  }

  function refresh() {
    var raw = collect();
    var input = PLAN.normalise(raw);
    current = input;

    showInputError(diagnose(raw, input));
    render(input ? PLAN.build(input) : null);
    SHARE.write(input);
  }

  var refreshSoon = debounce(refresh, 160);

  /* ------------------------------------------------------------- clipboard */

  /* navigator.clipboard is unavailable on a non-secure origin, which includes
   * anyone running this page from a file:// copy. The textarea fallback is what
   * keeps Copy working there. */
  function copyText(text, okMessage) {
    if (!text) { announce('Nothing to copy yet.'); return; }

    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(text).then(function () {
        announce(okMessage);
      }, function () {
        announce('Could not copy — select the text and copy it manually.');
      });
      return;
    }

    /* Selecting the scratch textarea moves focus into it, and removing it drops
     * focus to <body> — so a keyboard user who pressed Copy would find their
     * next Tab starting over at the top of the document. Put it back. */
    var restore = document.activeElement;
    var scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.top = '0';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    document.body.removeChild(scratch);
    if (restore && restore.focus) { restore.focus(); }
    announce(ok ? okMessage : 'Could not copy — select the text and copy it manually.');
  }

  /* --------------------------------------------------------------- wiring */

  [el.cidr, el.count, el.prefixes, el.azs, el.namePrefix, el.existing]
    .forEach(function (node) { node.addEventListener('input', refreshSoon); });

  el.awsReserved.addEventListener('change', refresh);

  /* Both panels stay in the DOM so switching modes twice does not lose what was
   * typed in the other one. */
  [el.modeEven, el.modeWeighted].forEach(function (node) {
    node.addEventListener('change', function () {
      var weighted = el.modeWeighted.checked;
      el.panelEven.hidden = weighted;
      el.panelWeighted.hidden = !weighted;
      refresh();
    });
  });

  /* Re-serialises the cached plan rather than calling refresh(). Switching the
   * output format is not a change to the plan, and routing it through refresh()
   * would recompute the split and rewrite the hash for nothing — Safari throttles
   * replaceState, and share.js swallows the failure, so the address bar would be
   * the thing that quietly went stale. */
  el.tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      format = tab.getAttribute('data-format');
      el.tabs.forEach(function (other) {
        other.setAttribute('aria-pressed', String(other === tab));
      });
      el.exportOut.textContent = currentPlan ? EXPORT.render(currentPlan, format) : '';
    });
  });

  el.copy.addEventListener('click', function () {
    copyText(el.exportOut.textContent, format.toUpperCase() + ' copied to the clipboard.');
  });

  el.share.addEventListener('click', function () {
    if (!current) { announce('Enter a VPC CIDR first — there is no plan to share yet.'); return; }
    copyText(SHARE.link(current), 'Link copied — it reproduces this plan.');
  });

  [el.example, el.exampleEmpty].forEach(function (node) {
    node.addEventListener('click', function () {
      applyInput(EXAMPLE);
      refresh();
      el.cidr.focus();
      announce('Loaded an example plan.');
    });
  });

  el.reset.addEventListener('click', function () {
    el.cidr.value = '';
    el.prefixes.value = '';
    el.namePrefix.value = '';
    el.existing.value = '';
    showInputError('');
    refresh();
    el.cidr.focus();
    announce('Cleared.');
  });

  /* A shared link wins over the empty form, so this runs before anything else
   * can fire an input event.
   *
   * When there was a hash and it did not decode — truncated in a chat client,
   * hand-edited, or written by a later version of this page — the first refresh()
   * replaces it with an empty one. Saying so is the difference between "this
   * link is broken" and "this tool is broken", and `replaceState` means the back
   * button will not bring the original back for them to inspect. */
  var incomingHash = (global.location.hash || '').replace(/^#/, '');
  var shared = SHARE.read();
  if (shared) { applyInput(shared); }
  refresh();
  if (!shared && incomingHash) {
    announce('That share link could not be read — it may be truncated, or from a newer version of this page. Starting from an empty plan.');
  }
})(this);
