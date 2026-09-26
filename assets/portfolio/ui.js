/* Portfolio — /portfolio/
 *
 * The only file on this page that touches the DOM. Every card is baked in by
 * Liquid, so with JS off the page is still the complete list; controls that
 * need this file ship `hidden` and are revealed here.
 *
 * No network calls. Persisted state is `darkMode` and `lang`, both shared with
 * /resume/, /career/ and /resume-career/.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var groups = document.getElementById('pf-groups');
  var status = document.getElementById('pf-status');
  var storageNote = document.getElementById('pf-storage-note');
  var empty = document.getElementById('pf-empty');
  var activeTagRow = document.getElementById('pf-active-tag');
  var activeTagBtn = document.getElementById('pf-active-tag-btn');
  var activeCatRow = document.getElementById('pf-active-cat');
  var activeCatBtn = document.getElementById('pf-active-cat-btn');
  var cards = Array.prototype.slice.call(groups.querySelectorAll('.pf-card'));
  var groupBoxes = Array.prototype.slice.call(groups.querySelectorAll('.pf-group'));

  var lang = 'ko';
  var filters = { domain: '', group: '', tag: '', q: '', cat: '' };
  var storageWarned = false;

  var COPY = {
    ko: {
      count: function (n, t) { return n === t ? '전체 ' + t + '건' : t + '건 중 ' + n + '건'; },
      /* "설정", not "테마": theme and language share storage and fail together. */
      storage: '이 브라우저에서는 설정이 저장되지 않습니다.',
      clearTag: function (t) { return t + ' 필터 해제'; },
      clearCat: function (c) { return c + ' 분류 필터 해제'; },
      noMatch: function (q) { return '"' + q + '"에 해당하는 프로젝트가 없습니다.'; },
      badLink: ' · 링크에 이 페이지가 모르는 조건이 있어 무시했습니다.',
      tenure: function (y, m) { return (y ? y + '년 ' : '') + m + '개월'; }
    },
    en: {
      count: function (n, t) { return n === t ? 'All ' + t + ' projects' : n + ' of ' + t; },
      storage: 'This browser will not remember your settings.',
      clearTag: function (t) { return 'Clear the ' + t + ' filter'; },
      clearCat: function (c) { return 'Clear the ' + c + ' category'; },
      noMatch: function (q) { return 'No project matches "' + q + '".'; },
      badLink: ' · The link named a filter this page does not have; it was ignored.',
      tenure: function (y, m) { return (y ? y + 'y ' : '') + m + 'm'; }
    }
  };

  function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* `.pf-topbar` wraps, so `--topbar-h` is only a floor; a jumped-to card would
     land behind the sticky header. Measure it instead. */
  function syncTopbarHeight() {
    var bar = document.querySelector('.pf-topbar');
    if (bar) root.style.setProperty('--topbar-real-h', bar.offsetHeight + 'px');
  }

  /* `restoring` (init only) skips the write: a detected language stored would
     read back next visit as though the reader had chosen it. */
  function applyLanguage(next, restoring) {
    lang = next;
    var nodes = document.querySelectorAll('[data-ko][data-en]');
    for (var i = 0; i < nodes.length; i++) {
      var value = nodes[i].getAttribute('data-' + lang);
      if (value !== null) nodes[i].innerHTML = value;
    }
    /* Attribute names too: on a phone the theme button's text label is hidden,
       so `aria-label` is its only accessible name. */
    var labelled = document.querySelectorAll('[data-label-ko][data-label-en]');
    for (var m = 0; m < labelled.length; m++) {
      labelled[m].setAttribute('aria-label', labelled[m].getAttribute('data-label-' + lang));
    }
    /* A sweep rather than `searchInput` alone: the password gate has a field too. */
    var placeheld = document.querySelectorAll('[data-ph-ko][data-ph-en]');
    for (var p = 0; p < placeheld.length; p++) {
      var ph = placeheld[p].getAttribute('data-ph-' + lang);
      if (ph) placeheld[p].setAttribute('placeholder', ph);
    }
    root.lang = lang;
    var btns = document.querySelectorAll('.pf-lang-btn');
    for (var j = 0; j < btns.length; j++) {
      var on = btns[j].getAttribute('data-lang') === lang;
      btns[j].classList.toggle('is-active', on);
      btns[j].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    syncChips();
    render();
    drawTimeline();
    syncTopbarHeight();
    if (!restoring) rememberLanguage();
  }

  /* Shared with /resume/, /career/ and /resume-career/, which are read as a set.
     `resume-script.html` and `career.html` carry their own copy; keep them in step. */
  var LANG_KEY = 'lang';

  function rememberLanguage() {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch (e) {
      storageWarned = true;
      storageNote.textContent = COPY[lang].storage;
    }
  }

  /* The pre-paint script already decided; read its class back rather than
     asking storage a second time. */
  var themeBtn = document.getElementById('pf-theme');
  var themeIcon = document.getElementById('pf-theme-icon');

  function syncThemeButton() {
    var dark = root.classList.contains('dark-mode');
    themeIcon.textContent = dark ? '☀️' : '🌙';
    themeBtn.setAttribute('aria-pressed', dark ? 'true' : 'false');
  }

  themeBtn.addEventListener('click', function () {
    var dark = root.classList.toggle('dark-mode');
    syncThemeButton();
    try {
      localStorage.setItem('darkMode', dark ? 'enabled' : 'disabled');
    } catch (e) {
      /* Private mode or full quota. A standing fact, so its own node rather
         than the live region, which would re-announce it on every click. */
      storageWarned = true;
      storageNote.textContent = COPY[lang].storage;
    }
  });

  syncThemeButton();

  /* Indexed once from both `data-ko` and `data-en`, so a term matches in either
     language whichever is on screen. `pf-more` is excluded: a word in a card's
     Troubleshooting block does not make the card about that word. */
  function indexCard(card) {
    var parts = [];
    var nodes = card.querySelectorAll('.pf-card-title, .pf-card-lead, .pf-badge');
    for (var i = 0; i < nodes.length; i++) {
      parts.push(nodes[i].getAttribute('data-ko') || nodes[i].textContent);
      parts.push(nodes[i].getAttribute('data-en') || '');
    }
    parts.push((card.getAttribute('data-tags') || '').replace(/\|/g, ' '));
    card._pfText = parts.join(' ').toLowerCase();
  }

  for (var ci = 0; ci < cards.length; ci++) indexCard(cards[ci]);

  var searchInput = document.getElementById('pf-q');
  var searchClear = document.getElementById('pf-q-clear');

  /* Computed here, not by Liquid, so the open-ended "현재" bar grows past the
     build date. Months since year 0 avoids Date-parsing a partial "YYYY-MM",
     which Safari and Chrome disagree on. No `end` means up to today. */
  function ym(v) {
    var p = String(v).split('-');
    return (+p[0]) * 12 + (+p[1]) - 1;
  }

  function drawTimeline() {
    var section = document.getElementById('pf-timeline-section');
    var rows = document.querySelectorAll('.pf-tl-row');
    if (!section || !rows.length) return;

    var now = new Date();
    var today = now.getFullYear() * 12 + now.getMonth();
    var min = Infinity, max = -Infinity;
    var spans = [];
    var served = 0;
    for (var i = 0; i < rows.length; i++) {
      var s = ym(rows[i].getAttribute('data-start'));
      var e = rows[i].getAttribute('data-end') ? ym(rows[i].getAttribute('data-end')) : today;
      if (!isFinite(s) || !isFinite(e) || e < s) { spans.push(null); continue; }
      spans.push([s, e]);
      served += e - s;
      if (s < min) min = s;
      if (e > max) max = e;
    }
    var total = max - min;
    if (!isFinite(total) || total <= 0) return;

    /* The sum of the bars, never first start to today: the gap between two
       jobs is not tenure. Elapsed months, the rule /resume/'s badge uses. */
    var years = document.getElementById('pf-years');
    var yearsTile = document.getElementById('pf-stat-years');
    if (years && yearsTile) {
      years.textContent = COPY[lang].tenure(Math.floor(served / 12), served % 12);
      yearsTile.hidden = false;
    }

    /* Unhidden before measuring: a hidden track is 0px wide. */
    section.hidden = false;
    var trackWidth = 0;
    for (var k = 0; k < rows.length && !trackWidth; k++) {
      if (spans[k]) trackWidth = rows[k].querySelector('.pf-tl-track').clientWidth;
    }

    for (var j = 0; j < rows.length; j++) {
      if (!spans[j]) { rows[j].hidden = true; continue; }
      var bar = rows[j].querySelector('.pf-tl-bar');
      var months = spans[j][1] - spans[j][0];
      bar.style.left = ((spans[j][0] - min) / total * 100) + '%';
      bar.style.width = (months / total * 100) + '%';
      var label = rows[j].querySelector('.pf-tl-label').textContent.trim();
      /* A bar too short for its figure shows none rather than a clipped
         half of it; the button's aria-label below carries the figure either way. */
      var fits = months / total * trackWidth >= 44;
      bar.querySelector('.pf-tl-months').textContent =
        fits ? months + (lang === 'ko' ? '개월' : 'mo') : '';
      /* A static span takes no aria-label; `.pf-tl-period` beside it reads the span. */
      if (bar.tagName === 'BUTTON') bar.setAttribute('aria-label', label + ' ' + months + (lang === 'ko' ? '개월' : ' months'));
    }

    var axis = document.getElementById('pf-tl-axis');
    if (axis) {
      axis.textContent = '';
      var y0 = Math.floor(min / 12), y1 = Math.floor(max / 12);
      for (var y = y0; y <= y1; y++) {
        var sp = document.createElement('span');
        sp.textContent = y;
        axis.appendChild(sp);
      }
    }
  }

  /* The QUERY string, because the hash belongs to the card anchors reveal()
     writes. Input only, validated field by field on read (attacker-controllable),
     written with `replaceState` so Back does not replay every keystroke. */
  function knownValues(selector, attr) {
    var out = Object.create(null);
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      var v = nodes[i].getAttribute(attr);
      if (v) out[v] = true;
    }
    return out;
  }

  function writeState() {
    if (!history.replaceState) return;
    var parts = [];
    if (filters.domain) parts.push('domain=' + encodeURIComponent(filters.domain));
    if (filters.group) parts.push('group=' + encodeURIComponent(filters.group));
    if (filters.tag) parts.push('tag=' + encodeURIComponent(filters.tag));
    if (filters.cat) parts.push('cat=' + encodeURIComponent(filters.cat));
    if (filters.q) parts.push('q=' + encodeURIComponent(filters.q));
    var url = location.pathname + (parts.length ? '?' + parts.join('&') : '') + location.hash;
    history.replaceState(null, '', url);
  }

  /* Returns how many parameters were named but not recognised, so the caller can
     say so rather than silently showing a list the link did not ask for. */
  function readState() {
    var raw = location.search.replace(/^\?/, '');
    if (!raw) return 0;
    var okDomain = knownValues('.pf-chip[data-filter="domain"]', 'data-value');
    var okGroup = knownValues('.pf-chip[data-filter="group"]', 'data-value');
    var okTag = knownValues('.pf-tag-lg', 'data-tag');
    var okCat = knownValues('[data-oss-cat]', 'data-oss-cat');
    var dropped = 0;
    var pairs = raw.split('&');
    for (var i = 0; i < pairs.length; i++) {
      var kv = pairs[i].split('=');
      var k, v;
      try {
        k = decodeURIComponent(kv[0] || '');
        v = decodeURIComponent((kv[1] || '').replace(/\+/g, ' '));
      } catch (e) { dropped++; continue; } /* malformed %-escape: drop the pair, not the page */
      if (!v) continue;
      if (k === 'domain' && okDomain[v]) filters.domain = v;
      else if (k === 'group' && okGroup[v]) filters.group = v;
      else if (k === 'tag' && okTag[v]) filters.tag = v;
      else if (k === 'cat' && okCat[v]) filters.cat = v;
      else if (k === 'q') {
        /* Capped for a sane URL, not safety: it only meets indexOf and textContent. */
        filters.q = v.slice(0, 100).toLowerCase();
        if (searchInput) searchInput.value = filters.q;
      } else dropped++;
    }
    /* Same exclusion setChip keeps: no OSS card belongs to a company. */
    if (filters.cat && filters.group && filters.group !== 'oss') { filters.cat = ''; dropped++; }
    return dropped;
  }

  function matches(card) {
    if (filters.domain && card.getAttribute('data-domain') !== filters.domain) return false;
    if (filters.group && card.getAttribute('data-group') !== filters.group) return false;
    if (filters.tag) {
      var tags = (card.getAttribute('data-tags') || '').split('|');
      if (tags.indexOf(filters.tag) === -1) return false;
    }
    if (filters.cat && card.getAttribute('data-cat') !== filters.cat) return false;
    if (filters.q && card._pfText.indexOf(filters.q) === -1) return false;
    return true;
  }

  /* Split from render() so reveal() can clear three filters and hit the live
     region once. */
  function syncChips() {
    var kinds = ['domain', 'group'];
    for (var k = 0; k < kinds.length; k++) {
      var row = document.querySelectorAll('.pf-chip[data-filter="' + kinds[k] + '"]');
      for (var i = 0; i < row.length; i++) {
        var on = row[i].getAttribute('data-value') === filters[kinds[k]];
        row[i].classList.toggle('is-active', on);
        /* The live region announces the change; this announces the state. */
        row[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    /* No state of its own: a metric is lit when its company is the group
       filter, so the two cannot drift. */
    var metrics = document.querySelectorAll('.pf-metric, .pf-tl-bar[data-metric-group]');
    for (var mm = 0; mm < metrics.length; mm++) {
      var on = filters.group !== '' && metrics[mm].getAttribute('data-metric-group') === filters.group;
      metrics[mm].classList.toggle('is-active', on);
      metrics[mm].setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    var stack = document.querySelectorAll('.pf-tag-lg');
    for (var s = 0; s < stack.length; s++) {
      var active = stack[s].getAttribute('data-tag') === filters.tag;
      stack[s].classList.toggle('is-active', active);
      stack[s].setAttribute('aria-pressed', active ? 'true' : 'false');
      /* A lit chip inside the closed long-tail disclosure would be invisible. */
      if (active) {
        var tail = stack[s].closest('.pf-stack-more');
        if (tail && !tail.open) tail.open = true;
      }
    }

    var cats = document.querySelectorAll('[data-oss-cat]');
    for (var oc = 0; oc < cats.length; oc++) {
      var lit = cats[oc].getAttribute('data-oss-cat') === filters.cat;
      cats[oc].classList.toggle('is-active', lit);
      cats[oc].setAttribute('aria-pressed', lit ? 'true' : 'false');
    }
  }

  function render() {
    var shown = 0;
    for (var i = 0; i < cards.length; i++) {
      var ok = matches(cards[i]);
      cards[i].hidden = !ok;
      if (ok) shown++;
    }
    /* Hide empty groups and recount: a build-time count is wrong once a filter runs. */
    var filtering = filters.domain !== '' || filters.group !== '' ||
                    filters.tag !== '' || filters.q !== '' || filters.cat !== '';
    for (var g = 0; g < groupBoxes.length; g++) {
      var box = groupBoxes[g];
      var visible = 0;
      var inGroup = box.querySelectorAll('.pf-card');
      for (var c = 0; c < inGroup.length; c++) if (!inGroup[c].hidden) visible++;
      box.hidden = visible === 0;
      var badge = box.querySelector('.pf-group-count');
      if (badge) badge.textContent = visible;
      /* A collapsed group with matches looks like a search that found nothing.
         Clearing the filters leaves groups as the reader left them. */
      var det = box.querySelector('.pf-group-box');
      if (filtering && visible > 0 && det) det.open = true;
    }

    empty.hidden = shown !== 0;
    /* Naming the term tells the reader what to change. */
    if (shown === 0 && filters.q) empty.textContent = COPY[lang].noMatch(filters.q);
    else if (shown === 0) empty.textContent = empty.getAttribute('data-' + lang) || '';
    if (searchClear) searchClear.hidden = filters.q === '';
    status.textContent = COPY[lang].count(shown, cards.length);
    if (storageWarned) storageNote.textContent = COPY[lang].storage;

    if (filters.tag) {
      activeTagBtn.textContent = filters.tag + ' ✕';
      activeTagBtn.setAttribute('aria-label', COPY[lang].clearTag(filters.tag));
      activeTagRow.hidden = false;
    } else {
      activeTagRow.hidden = true;
    }

    /* The slug is the state; the name is read back off the button that set it. */
    var catSource = filters.cat &&
      document.querySelector('[data-oss-cat="' + filters.cat + '"]');
    if (catSource && activeCatRow) {
      var catName = catSource.getAttribute('data-cat-name') || filters.cat;
      activeCatBtn.textContent = catName + ' ✕';
      activeCatBtn.setAttribute('aria-label', COPY[lang].clearCat(catName));
      activeCatRow.hidden = false;
    } else if (activeCatRow) {
      activeCatRow.hidden = true;
    }
  }

  function setChip(kind, value) {
    filters[kind] = value;
    /* No OSS card belongs to a company, so a company and a category cannot both hold. */
    if (kind === 'group' && value && value !== 'oss') filters.cat = '';
    syncChips();
    render();
    writeState();
  }

  function setTag(value) {
    filters.tag = filters.tag === value ? '' : value;
    syncChips();
    render();
    writeState();
  }

  /* The card is the click target only where no link, button or summary is. */
  function openCards() { return groups.querySelectorAll('.pf-card.is-open'); }

  /* On the wrapper, not each grid: `.pf-groups.has-open .pf-grid` drops every
     grid to natural heights so an open card does not stretch its row-mates. */
  function syncGridOpen() {
    groups.classList.toggle('has-open', openCards().length > 0);
  }

  function setCardOpen(card, open) {
    var more = card.querySelector('.pf-more');
    if (more) {
      /* Drive the disclosure and let its `toggle` event set the class, so the
         two cannot disagree. */
      if (more.open !== open) more.open = open;
      else { card.classList.toggle('is-open', open); syncGridOpen(); }
    } else {
      card.classList.toggle('is-open', open);
      syncGridOpen();
    }
  }

  function closeAllCards(except) {
    var open = openCards();
    for (var i = 0; i < open.length; i++) {
      if (open[i] !== except) setCardOpen(open[i], false);
    }
  }

  /* `toggle` does not bubble, hence the capture phase. */
  groups.addEventListener('toggle', function (ev) {
    var more = ev.target;
    if (!more.classList || !more.classList.contains('pf-more')) return;
    var card = more.closest('.pf-card');
    if (!card) return;
    card.classList.toggle('is-open', more.open);
    syncGridOpen();
  }, true);

  function motion() {
    return reducedMotion() ? 'auto' : 'smooth';
  }

  /* Filters clear first (a hidden card cannot be scrolled to), then the target
     is FOCUSED: preventDefault() also cancels the browser's focus move, which
     would leave a screen reader on the link it came from. Returns false when
     there is nothing to reveal, so the caller keeps the default click. */
  function reveal(id) {
    var target = document.getElementById(id);
    if (!target || !target.classList.contains('pf-card')) return false;
    filters.domain = '';
    filters.group = '';
    filters.tag = '';
    filters.q = '';
    filters.cat = '';
    if (searchInput) searchInput.value = '';
    syncChips();
    render();
    writeState();
    for (var i = 0; i < cards.length; i++) cards[i].classList.remove('is-target');
    target.classList.add('is-target');
    /* A card inside a collapsed group has no box to scroll to or focus: the
       jump opened the card and then went nowhere. */
    var box = target.closest('.pf-group-box');
    if (box && !box.open) box.open = true;
    closeAllCards(target);
    setCardOpen(target, true);
    target.scrollIntoView({ behavior: motion(), block: 'start' });
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    /* preventScroll, or focus() jumps instantly and undoes the smooth scroll. */
    target.focus({ preventScroll: true });
    if (history.replaceState) history.replaceState(null, '', '#' + id);
    return true;
  }

  /* Delegated: the language swap rewrites chip contents with innerHTML. */
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;

    var chip = t.closest('.pf-chip[data-filter]');
    if (chip) { setChip(chip.getAttribute('data-filter'), chip.getAttribute('data-value')); return; }

    if (t.closest('#pf-active-tag-btn')) { setTag(''); return; }

    var tag = t.closest('.pf-tag');
    if (tag) {
      setTag(tag.getAttribute('data-tag'));
      if (filters.tag) groups.scrollIntoView({ behavior: motion(), block: 'start' });
      return;
    }

    var metric = t.closest('.pf-metric, .pf-tl-bar[data-metric-group]');
    if (metric) {
      var g = metric.getAttribute('data-metric-group');
      /* Pressing the lit one clears it. */
      setChip('group', filters.group === g ? '' : g);
      groups.scrollIntoView({ behavior: motion(), block: 'start' });
      return;
    }

    if (t.closest('#pf-active-cat-btn')) { setChip('cat', ''); return; }

    /* Its own filter, matched on `data-cat` — a search for the category's name
       also caught a card whose description merely mentioned it. A company in
       the source filter is dropped, since no OSS card can match one. */
    var cat = t.closest('[data-oss-cat]');
    if (cat) {
      var slug = cat.getAttribute('data-oss-cat');
      var off = filters.cat === slug;
      if (!off && filters.group !== 'oss') filters.group = '';
      setChip('cat', off ? '' : slug);
      if (!off) groups.scrollIntoView({ behavior: motion(), block: 'start' });
      return;
    }

    var langBtn = t.closest('.pf-lang-btn');
    if (langBtn) { applyLanguage(langBtn.getAttribute('data-lang')); return; }

    /* Card body. Last, so every control above has already claimed its click. */
    var card = t.closest('.pf-card');
    if (card) {
      if (t.closest('a, button, summary')) return;
      /* Selecting text inside a card should not also toggle it. */
      if (window.getSelection && String(window.getSelection()).length > 0) return;
      setCardOpen(card, !card.classList.contains('is-open'));
      return;
    }

    var jump = t.closest('.pf-jump');
    if (jump) {
      /* Leave modifier-clicks to the browser (open in new tab). */
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
      if (reveal(jump.getAttribute('href').slice(1))) ev.preventDefault();
    }
  });

  /* Roving tabindex, one stop per card or case panel: those tags duplicate the
     stack chips, so each one as a tab stop would bury the section below.
     Filtering only toggles `hidden`, which leaves the tab order on its own. */
  var tagLists = document.querySelectorAll('.pf-tags');
  for (var t0 = 0; t0 < tagLists.length; t0++) {
    var btns = tagLists[t0].querySelectorAll('.pf-tag');
    for (var b = 0; b < btns.length; b++) btns[b].tabIndex = b === 0 ? 0 : -1;
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { closeAllCards(null); return; }
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
    if (!ev.target || !ev.target.closest) return;
    var here = ev.target.closest('.pf-tags .pf-tag');
    if (!here) return;
    var list = Array.prototype.slice.call(
      here.closest('.pf-tags').querySelectorAll('.pf-tag'));
    var step = ev.key === 'ArrowRight' ? 1 : -1;
    var next = list[(list.indexOf(here) + step + list.length) % list.length];
    here.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
    ev.preventDefault();
  });

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      filters.q = searchInput.value.trim().toLowerCase();
      render();
      writeState();
    });
    /* Escape clears the field first; only an already-empty field lets the key
       through to close an open card. */
    searchInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && searchInput.value !== '') {
        ev.stopPropagation();
        searchInput.value = '';
        filters.q = '';
        render();
        writeState();
      }
    });
  }

  /* The same lock and password as /resume/ and /career/. `atob` stops casual
     lifting only; View Source defeats it. The lock is `body.content-locked` in
     the markup, so it holds even if this file never runs; below is the way past. */
  var gate = document.getElementById('pf-gate');
  var gateInput = document.getElementById('pf-gate-input');
  var gateError = document.getElementById('pf-gate-error');
  var unlocked = false;
  var dragProbe = null;

  function openGate() {
    if (!gate) return;
    gate.hidden = false;
    gateError.hidden = true;
    gateInput.value = '';
    gateInput.focus();
  }

  function closeGate() {
    if (!gate) return;
    gate.hidden = true;
    gateInput.value = '';
  }

  function checkGate() {
    /* An absent attribute is a wrong password, not no gate. */
    var expected = gate.getAttribute('data-k');
    if (!expected || gateInput.value !== atob(expected)) {
      gateError.hidden = false;
      gateInput.value = '';
      gateInput.focus();
      return;
    }
    unlocked = true;
    document.body.classList.remove('content-locked');
    closeGate();
    /* Nothing visible changes, so announce it through the status line. */
    status.textContent = lang === 'ko'
      ? '✅ 텍스트 선택·복사가 열렸습니다!'
      : '✅ Text selection unlocked!';
  }

  function guardContent(ev) {
    if (unlocked) return;
    /* The gate's own field and the search box must stay usable. */
    if (ev.target && ev.target.closest && ev.target.closest('#pf-gate, input, textarea')) return;
    ev.preventDefault();
    openGate();
  }

  if (gate) {
    document.addEventListener('copy', guardContent);
    document.addEventListener('cut', guardContent);
    document.addEventListener('dragstart', guardContent);

    /* MOUSE-ONLY: on touch a pointermove is a scroll, not a drag. */
    document.addEventListener('pointerdown', function (ev) {
      dragProbe = null;
      if (unlocked || ev.pointerType !== 'mouse' || ev.button !== 0) return;
      if (ev.target.closest('#pf-gate, button, a, input, textarea, summary')) return;
      dragProbe = { x: ev.clientX, y: ev.clientY };
    });

    document.addEventListener('pointermove', function (ev) {
      if (unlocked || !dragProbe) return;
      /* A jittery click is not a drag. Cleared as it fires: one prompt per gesture. */
      if (Math.abs(ev.clientX - dragProbe.x) + Math.abs(ev.clientY - dragProbe.y) < 24) return;
      dragProbe = null;
      openGate();
    });

    document.addEventListener('pointerup', function () { dragProbe = null; });

    document.getElementById('pf-gate-ok').addEventListener('click', checkGate);
    document.getElementById('pf-gate-cancel').addEventListener('click', closeGate);
    gateInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { checkGate(); return; }
      /* Escape closes the gate rather than reaching the card handler below,
         which would otherwise collapse an open card behind the dialog. */
      if (ev.key === 'Escape') { ev.stopPropagation(); closeGate(); }
    });
    gate.addEventListener('click', function (ev) {
      if (ev.target === gate) closeGate();
    });
  }

  if (searchClear) {
    searchClear.addEventListener('click', function () {
      searchInput.value = '';
      filters.q = '';
      render();
      writeState();
      searchInput.focus();
    });
  }

  /* The timeline too: whether a bar has room for its figure depends on width. */
  var resizeQueued = false;
  window.addEventListener('resize', function () {
    if (resizeQueued) return;
    resizeQueued = true;
    window.requestAnimationFrame(function () {
      resizeQueued = false;
      syncTopbarHeight();
      drawTimeline();
    });
  });

  var topbar = document.querySelector('.pf-topbar');
  var scrollQueued = false;
  function syncScrolled() {
    scrollQueued = false;
    if (topbar) topbar.classList.toggle('is-scrolled', (window.pageYOffset || 0) > 4);
  }
  window.addEventListener('scroll', function () {
    if (scrollQueued) return;
    scrollQueued = true;
    window.requestAnimationFrame(syncScrolled);
  }, { passive: true });

  /* The markup already holds each final figure, so with no script or with
     reduced motion the number is simply there. */
  function countUp() {
    if (reducedMotion() || !window.requestAnimationFrame) return;
    var items = [];
    var nodes = document.querySelectorAll('.pf-count[data-count]');
    for (var i = 0; i < nodes.length; i++) {
      var target = parseInt(nodes[i].getAttribute('data-count'), 10);
      if (isFinite(target) && target > 0) items.push([nodes[i], target]);
    }
    if (!items.length) return;
    var start = null;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / 900);
      var eased = 1 - Math.pow(1 - p, 3);
      for (var j = 0; j < items.length; j++) {
        items[j][0].textContent = Math.round(items[j][1] * eased);
      }
      if (p < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
  }

  /* Only what starts below the fold is ever hidden, and only from here: a
     blocked script hides nothing, and nothing on screen at load blinks out. */
  function setupReveal() {
    if (reducedMotion() || !('IntersectionObserver' in window)) return;
    var els = document.querySelectorAll(
      '.pf-sec-head, .pf-metrics, .pf-case, .pf-shifts, .pf-upstream, .pf-oss-cats');
    var fold = window.innerHeight || document.documentElement.clientHeight;
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        io.unobserve(entries[i].target);
        entries[i].target.classList.add('pf-reveal-in');
        entries[i].target.classList.remove('pf-reveal-pending');
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    for (var j = 0; j < els.length; j++) {
      if (els[j].getBoundingClientRect().top < fold) continue;
      els[j].classList.add('pf-reveal-pending');
      io.observe(els[j]);
    }
  }

  /* On a single-column phone every group starts collapsed, the first too: the
     list sits below the case studies, so its headers and counts are the structure
     a phone reader needs. Any filter, and any jump to a card, opens what it
     points at. In JS because `open` is an attribute. */
  if (window.matchMedia('(max-width: 640px)').matches) {
    var boxes = groups.querySelectorAll('.pf-group-box');
    for (var gb = 0; gb < boxes.length; gb++) boxes[gb].open = false;
  }

  /* Controls that only work with this file running ship `hidden`. */
  var filterBox = document.querySelector('.pf-filters');
  var stackBox = document.getElementById('pf-stack-section');
  if (filterBox) filterBox.hidden = false;
  if (stackBox) stackBox.hidden = false;

  /* The inline script before this file already resolved the language and swapped
     the text; this pass syncs the buttons, chips and counts to it. */
  if (root.lang === 'en') applyLanguage('en', true);

  syncTopbarHeight();
  drawTimeline();
  var droppedParams = readState();
  syncChips();
  syncGridOpen();
  render();
  /* Say so once rather than quietly showing a list the link did not ask for. */
  if (droppedParams > 0) status.textContent += COPY[lang].badLink;
  if (location.hash.length > 1) reveal(location.hash.slice(1));
  syncScrolled();
  countUp();
  setupReveal();
})();
