/* assets/vpc-planner/ui.js — the only file that touches the page.
 *
 *   - Form and hash values render through textContent, never innerHTML.
 *   - Typing refreshes debounced; the checkbox and mode radios immediately.
 *   - #vp-status is the page's single live region.
 *   - Nothing is stored; the share hash (share.js) is the only persistence.
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
  /* Cached so Share, Copy and a format switch need not recompute the split. */
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

  /* Raw form values; VPPlan.normalise does the rest. */
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

  /* Shown beside the input and announced via #vp-status (the strip is not a
   * live region: `:empty` collapses it, so it would register too late). Only
   * announced when the text changes, not on every debounce tick. */
  var lastInputError = '';

  function showInputError(message) {
    var text = message || '';
    el.inputError.textContent = text;
    if (text !== lastInputError) {
      lastInputError = text;
      if (text) { announce(text); }
    }
  }

  /* The rest collapse via `:empty`; the table and export head cannot. Not
   * `.vp-result` wholesale: the conflict list inside it must stay visible when
   * a plan parsed but allocated nothing. */
  function showEmpty(isEmpty) {
    el.empty.hidden = !isEmpty;
    el.tally.hidden = isEmpty;
    el.tableWrap.hidden = isEmpty;
    el.exportBox.hidden = isEmpty;
  }

  function renderBar(plan) {
    clear(el.bar);

    /* Address order, not table order. */
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
      /* Inline because the width is data, not design. */
      node.style.width = (CIDR.size(seg.block) / total * 100) + '%';
      node.title = seg.label + ' · ' + CIDR.format(seg.block);
      el.bar.appendChild(node);
    });

    /* A screen reader gets nothing from the widths, so the bar states a summary. */
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

  /* "Nothing typed yet" vs "typed something wrong" — build()'s null cannot tell. */
  function diagnose(raw, input) {
    if (!String(raw.cidr).trim()) { return ''; }
    if (!CIDR.parse(String(raw.cidr).trim())) {
      return 'Not a valid IPv4 CIDR. It also has to be the start of its own block — 10.0.1.0/16 is really 10.0.0.0/16.';
    }
    if (input && input.mode === 'weighted' && !input.prefixes.length) {
      return 'Enter at least one prefix length, like 24, 24, 26.';
    }

    /* `max` bounds the spinner, not typing, so say when normalise() clamped. */
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

  /* The textarea fallback covers non-secure origins (file://), where
   * navigator.clipboard is unavailable. */
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

    /* Removing the scratch textarea drops focus to <body>; put it back. */
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

  [el.cidr, el.count, el.prefixes, el.azs, el.namePrefix, el.existing]
    .forEach(function (node) { node.addEventListener('input', refreshSoon); });

  el.awsReserved.addEventListener('change', refresh);

  /* Both panels stay in the DOM, so a mode switch keeps what was typed. */
  [el.modeEven, el.modeWeighted].forEach(function (node) {
    node.addEventListener('change', function () {
      var weighted = el.modeWeighted.checked;
      el.panelEven.hidden = weighted;
      el.panelWeighted.hidden = !weighted;
      refresh();
    });
  });

  /* Not refresh(): a format switch is not a plan change, and needless
   * replaceState calls get throttled by Safari, silently staling the URL. */
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

  /* A shared link wins over the empty form. An undecodable hash is announced:
   * the first refresh() replaces it, and replaceState leaves no way back to it. */
  var incomingHash = (global.location.hash || '').replace(/^#/, '');
  var shared = SHARE.read();
  if (shared) { applyInput(shared); }
  refresh();
  if (!shared && incomingHash) {
    announce('That share link could not be read — it may be truncated, or from a newer version of this page. Starting from an empty plan.');
  }
})(this);
