/* Portfolio — /portfolio/
 *
 * The only file on this page that touches the DOM. Everything it renders is
 * already in the HTML before it runs: Liquid baked every card in at build time,
 * so with JS off the page is still the complete list. The filter controls and
 * the stack section ship `hidden` and are revealed here, the same way
 * /release-radar/ does it — a chip that cannot do anything is worse than no chip.
 *
 * No network calls, no third-party anything. The single piece of persisted state
 * is the theme, under `darkMode` — the key /resume/ also uses. (/career/ writes
 * `careerDarkMode` and does NOT share it; see the note in the page head.)
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
  var cards = Array.prototype.slice.call(groups.querySelectorAll('.pf-card'));
  var groupBoxes = Array.prototype.slice.call(groups.querySelectorAll('.pf-group'));

  var lang = 'ko';
  var filters = { domain: '', group: '', tag: '', q: '' };
  var storageWarned = false;

  var COPY = {
    ko: {
      count: function (n, t) { return n === t ? '전체 ' + t + '건' : t + '건 중 ' + n + '건'; },
      /* "설정" rather than "테마": the theme and the language go into the same
         storage and therefore fail together, so naming only one of them would
         leave the reader expecting the other to be remembered. */
      storage: '이 브라우저에서는 설정이 저장되지 않습니다.',
      clearTag: function (t) { return t + ' 필터 해제'; },
      noMatch: function (q) { return '"' + q + '"에 해당하는 프로젝트가 없습니다.'; },
      badLink: ' · 링크에 이 페이지가 모르는 조건이 있어 무시했습니다.'
    },
    en: {
      count: function (n, t) { return n === t ? 'All ' + t + ' projects' : n + ' of ' + t; },
      storage: 'This browser will not remember your settings.',
      clearTag: function (t) { return 'Clear the ' + t + ' filter'; },
      noMatch: function (q) { return 'No project matches "' + q + '".'; },
      badLink: ' · The link named a filter this page does not have; it was ignored.'
    }
  };

  /* --------------------------------------------------------- topbar height */

  /* `.pf-topbar` wraps, so `--topbar-h` is a floor rather than its height: on a
     360px screen the nav runs to three rows and a card scrolled to with the
     static 52px margin lands behind the sticky header. Measure it instead. */
  function syncTopbarHeight() {
    var bar = document.querySelector('.pf-topbar');
    if (bar) root.style.setProperty('--topbar-real-h', bar.offsetHeight + 'px');
  }

  /* ------------------------------------------------------------ language */

  /* `restoring` is passed only by the init call at the bottom. A language the
     reader picked is a choice and is written down; one worked out from the
     browser is not, and writing it would make the next visit read it back as
     though they had asked for it. */
  function applyLanguage(next, restoring) {
    lang = next;
    var nodes = document.querySelectorAll('[data-ko][data-en]');
    for (var i = 0; i < nodes.length; i++) {
      var value = nodes[i].getAttribute('data-' + lang);
      if (value !== null) nodes[i].innerHTML = value;
    }
    /* Names that live in an attribute rather than in text. The theme button's
       own label is `display: none` below 720px and its icon is aria-hidden, so
       without this the button has no accessible name at all on a phone; the
       landmark labels would otherwise stay English under a Korean screen
       reader. */
    var labelled = document.querySelectorAll('[data-label-ko][data-label-en]');
    for (var m = 0; m < labelled.length; m++) {
      labelled[m].setAttribute('aria-label', labelled[m].getAttribute('data-label-' + lang));
    }
    /* The placeholder is an attribute too, and the text swap above never
       reaches it. */
    if (searchInput) {
      var ph = searchInput.getAttribute('data-ph-' + lang);
      if (ph) searchInput.setAttribute('placeholder', ph);
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

  /* Key is `lang`, shared with /resume/ and /career/ — the same reason
     `darkMode` is shared: the three documents are read as a set and link to
     each other, so a language chosen on one that did not survive the click to
     the next was not really a choice. Those two carry an inline copy of this
     block; keep the three in step. */
  var LANG_KEY = 'lang';

  function rememberLanguage() {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch (e) {
      storageWarned = true;
      storageNote.textContent = COPY[lang].storage;
    }
  }

  /* A stored value is a decision and always wins — including a stored `ko`,
     which is why this is an allowlist rather than the "anything that is not
     `en` means Korean" shortcut it replaced. That shortcut was safe only while
     Korean was also the fallback; now that the fallback asks the browser, it
     would throw away the choice of the one reader it matters most for — an
     English-locale visitor who went and picked Korean.

     With nothing stored, follow the browser: `ko` only for a Korean
     preference, English for everything else, since English is the more widely
     read of the two languages this page has. `navigator.language` is the
     highest-priority entry of `navigator.languages`, which is the one that
     expresses the preference. The `($|-)` matters — a bare `^ko` also matches
     `kok` (Konkani), a real BCP-47 tag. */
  function resolveLanguage() {
    var stored = null;
    try {
      stored = localStorage.getItem(LANG_KEY);
    } catch (e) {
      /* Storage unavailable — fall through to the browser. */
    }
    if (stored === 'ko' || stored === 'en') return stored;
    return /^ko($|-)/i.test(navigator.language || '') ? 'ko' : 'en';
  }

  /* --------------------------------------------------------------- theme */

  /* The pre-paint script in the page already decided; read that decision back
     off the root element rather than asking storage a second time, so there is
     exactly one answer on the page. */
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
      /* Private mode, or a full quota. This is a standing fact, not an event —
         it goes in its own node rather than the live region, which would
         re-announce it on every filter click. */
      storageWarned = true;
      storageNote.textContent = COPY[lang].storage;
    }
  });

  syncThemeButton();

  /* -------------------------------------------------------------- search */

  /* Indexed ONCE, from the `data-ko` and `data-en` attributes rather than from
     what is on screen — both halves go into the same string. Reading rendered
     text would mean re-indexing on every language switch, and worse, "canary"
     would stop matching the moment the page was in Korean even though the card
     says it in its other half. Cached on the element, not in an attribute: this
     doubles the text and there is no reason to ship it twice.

     `pf-more` is excluded deliberately — a card whose Troubleshooting block
     happens to mention a word is not a card about that word, and including the
     expanded detail made a search for "Redis" return nine cards, only one of
     which was about Redis. Title, summary, badges and tags only. */
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

  /* ------------------------------------------------------------ timeline */

  /* Positions are computed here rather than baked in by Liquid because the open
     -ended bar has to keep growing: a build from six months ago would otherwise
     keep drawing a six-month-old "현재". Months since year 0, so the arithmetic
     is one subtraction and no Date parsing of a partial "YYYY-MM" — which is the
     one thing browsers disagree about (Safari refuses several forms Chrome
     accepts). `end` absent means still there, and the axis runs to today. */
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
    for (var i = 0; i < rows.length; i++) {
      var s = ym(rows[i].getAttribute('data-start'));
      var e = rows[i].getAttribute('data-end') ? ym(rows[i].getAttribute('data-end')) : today;
      if (!isFinite(s) || !isFinite(e) || e < s) { spans.push(null); continue; }
      spans.push([s, e]);
      if (s < min) min = s;
      if (e > max) max = e;
    }
    var total = max - min;
    if (!isFinite(total) || total <= 0) return;

    for (var j = 0; j < rows.length; j++) {
      if (!spans[j]) { rows[j].hidden = true; continue; }
      var bar = rows[j].querySelector('.pf-tl-bar');
      var months = spans[j][1] - spans[j][0];
      bar.style.left = ((spans[j][0] - min) / total * 100) + '%';
      bar.style.width = (months / total * 100) + '%';
      var label = rows[j].querySelector('.pf-tl-label').textContent.trim();
      bar.querySelector('.pf-tl-months').textContent = months + (lang === 'ko' ? '개월' : 'mo');
      bar.setAttribute('aria-label', label + ' ' + months + (lang === 'ko' ? '개월' : ' months'));
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
    section.hidden = false;
  }

  /* ----------------------------------------------------------- url state */

  /* The QUERY string, not the hash — the hash already belongs to the card
     anchors that reveal() writes, and one of them would have to lose. Both work
     side by side this way: `?tag=Helm#card-phantom-ngf-migration` is a link to a
     filtered list scrolled to a card.
     Following /vpc-planner/: the URL carries the INPUT and never the result, is
     validated field by field on read because it is attacker-controllable, and is
     written with `replaceState` so the back button does not walk through every
     keystroke of a search. */
  function knownValues(selector, attr) {
    var out = {};
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
    var dropped = 0;
    var pairs = raw.split('&');
    for (var i = 0; i < pairs.length; i++) {
      var kv = pairs[i].split('=');
      var k = decodeURIComponent(kv[0] || '');
      var v = decodeURIComponent((kv[1] || '').replace(/\+/g, ' '));
      if (!v) continue;
      if (k === 'domain' && okDomain[v]) filters.domain = v;
      else if (k === 'group' && okGroup[v]) filters.group = v;
      else if (k === 'tag' && okTag[v]) filters.tag = v;
      else if (k === 'q') {
        /* Length-capped: it is only ever compared with indexOf against strings
           this page built, and only ever written back with textContent, so the
           cap is about a sane URL rather than about safety. */
        filters.q = v.slice(0, 100).toLowerCase();
        if (searchInput) searchInput.value = filters.q;
      } else dropped++;
    }
    return dropped;
  }

  /* ------------------------------------------------------------- filters */

  function matches(card) {
    if (filters.domain && card.getAttribute('data-domain') !== filters.domain) return false;
    if (filters.group && card.getAttribute('data-group') !== filters.group) return false;
    if (filters.tag) {
      var tags = (card.getAttribute('data-tags') || '').split('|');
      if (tags.indexOf(filters.tag) === -1) return false;
    }
    if (filters.q && card._pfText.indexOf(filters.q) === -1) return false;
    return true;
  }

  /* Split from render() so reveal() can clear three filters and announce once.
     Calling setChip() three times fired the live region three times, and a
     screen reader either truncates the first two or reads all three. */
  function syncChips() {
    var kinds = ['domain', 'group'];
    for (var k = 0; k < kinds.length; k++) {
      var row = document.querySelectorAll('.pf-chip[data-filter="' + kinds[k] + '"]');
      for (var i = 0; i < row.length; i++) {
        var on = row[i].getAttribute('data-value') === filters[kinds[k]];
        row[i].classList.toggle('is-active', on);
        /* Colour alone does not tell a screen-reader user which filter is on.
           The live region announces the change; this announces the state. */
        row[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    /* No state of its own: a metric is lit when its company is the one being
       filtered. A separate flag would be a second answer to the same question,
       and the two would drift the first time a group chip was used instead. */
    var metrics = document.querySelectorAll('.pf-metric, .pf-tl-bar');
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
    }
  }

  function render() {
    var shown = 0;
    for (var i = 0; i < cards.length; i++) {
      var ok = matches(cards[i]);
      cards[i].hidden = !ok;
      if (ok) shown++;
    }
    /* A group heading over nothing reads as a group that lost its contents, and
       a count written at build time would be a lie the moment a filter runs. */
    var filtering = filters.domain !== '' || filters.group !== '' ||
                    filters.tag !== '' || filters.q !== '';
    for (var g = 0; g < groupBoxes.length; g++) {
      var box = groupBoxes[g];
      var visible = 0;
      var inGroup = box.querySelectorAll('.pf-card');
      for (var c = 0; c < inGroup.length; c++) if (!inGroup[c].hidden) visible++;
      box.hidden = visible === 0;
      var badge = box.querySelector('.pf-group-count');
      if (badge) badge.textContent = visible;
      /* A collapsed group with matches inside it is a search that looks like it
         found nothing. Any active filter opens every group that still has
         something to show; clearing the filters leaves them as the reader left
         them rather than snapping back. */
      var det = box.querySelector('.pf-group-box');
      if (filtering && visible > 0 && det) det.open = true;
    }

    empty.hidden = shown !== 0;
    /* Naming the term is the difference between "nothing here" and "nothing
       matched what you typed" — the second tells you what to change. */
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
  }

  function setChip(kind, value) {
    filters[kind] = value;
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

  /* ----------------------------------------------------------- card open */

  /* The card is the click target, but only where nothing else already is: an
     evidence link, a tag button and the disclosure summary all do their own job,
     and a card that swallowed those would break them. */
  function openCards() { return groups.querySelectorAll('.pf-card.is-open'); }

  /* The flag lives on the wrapper, not on each grid: `.pf-groups.has-open
     .pf-grid` drops every grid back to natural heights, so an expanded card in
     one company does not stretch its row-mates while the other groups keep
     their squared-off rows. */
  function syncGridOpen() {
    groups.classList.toggle('has-open', openCards().length > 0);
  }

  function setCardOpen(card, open) {
    var more = card.querySelector('.pf-more');
    if (more) {
      /* Drive the disclosure and let its `toggle` event set the class, so the
         two can never disagree — including when the summary is clicked directly
         or a jump opens the card. */
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

  /* ---------------------------------------------------------------- jump */

  function motion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  }

  /* A card the current filter is hiding cannot be scrolled to, and a jump that
     silently does nothing reads as a broken link — so the filters clear first,
     then the target is marked and FOCUSED. The focus move matters: calling
     preventDefault() on the anchor removes the browser's own focus move as well
     as its scroll, and restoring only the scroll leaves a screen reader's
     reading cursor on the link it came from, inside a <details> now off-screen.
     Returns false when there is nothing to reveal, so the caller can leave the
     anchor's default behaviour alone instead of swallowing the click. */
  function reveal(id) {
    var target = document.getElementById(id);
    if (!target || !target.classList.contains('pf-card')) return false;
    filters.domain = '';
    filters.group = '';
    filters.tag = '';
    filters.q = '';
    if (searchInput) searchInput.value = '';
    syncChips();
    render();
    writeState();
    for (var i = 0; i < cards.length; i++) cards[i].classList.remove('is-target');
    target.classList.add('is-target');
    closeAllCards(target);
    setCardOpen(target, true);
    target.scrollIntoView({ behavior: motion(), block: 'start' });
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    /* preventScroll, or focus() jumps instantly and undoes the smooth scroll. */
    target.focus({ preventScroll: true });
    if (history.replaceState) history.replaceState(null, '', '#' + id);
    return true;
  }

  /* ------------------------------------------------------------- events */

  /* One delegated listener rather than one per control: the language swap
     rewrites chip contents with innerHTML, and a listener bound to a child
     would not survive that. */
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

    var metric = t.closest('.pf-metric, .pf-tl-bar');
    if (metric) {
      var g = metric.getAttribute('data-metric-group');
      /* Pressing the lit one clears it, so the band is a toggle rather than a
         one-way trip that needs the "전체" chip to undo. */
      setChip('group', filters.group === g ? '' : g);
      groups.scrollIntoView({ behavior: motion(), block: 'start' });
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
      /* Leave modifier-clicks to the browser — otherwise the migration list
         cannot be opened in a new tab. */
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
      if (reveal(jump.getAttribute('href').slice(1))) ev.preventDefault();
    }
  });

  /* Roving tabindex over each card's tag list. There are 236 of these buttons
     and they duplicate the 96 stack chips exactly, so left alone they put 236
     tab stops between the grid and the section that does the same job. One stop
     per card, arrows inside. Filtering only toggles `hidden`, and a hidden
     subtree leaves the tab order on its own, so this needs no re-declaring. */
  var tagLists = document.querySelectorAll('.pf-card .pf-tags');
  for (var t0 = 0; t0 < tagLists.length; t0++) {
    var btns = tagLists[t0].querySelectorAll('.pf-tag');
    for (var b = 0; b < btns.length; b++) btns[b].tabIndex = b === 0 ? 0 : -1;
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { closeAllCards(null); return; }
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
    if (!ev.target || !ev.target.closest) return;
    var here = ev.target.closest('.pf-card .pf-tags .pf-tag');
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
  if (searchClear) {
    searchClear.addEventListener('click', function () {
      searchInput.value = '';
      filters.q = '';
      render();
      writeState();
      searchInput.focus();
    });
  }

  window.addEventListener('resize', syncTopbarHeight);

  /* ---------------------------------------------------------------- init */

  /* Below 640px the page runs to about 21,000px — sixty cards in one column —
     and the group headers are the only structure a reader has to move through
     it. Every group but the first therefore starts collapsed THERE and only
     there: the counts stay on screen, one tap opens a group, and any filter or
     search opens whatever matches. The first stays open so the page never looks
     like a list of headings with nothing under them. Done here rather than in
     CSS because `open` is an attribute, not a style. */
  if (window.matchMedia('(max-width: 640px)').matches) {
    var boxes = groups.querySelectorAll('.pf-group-box');
    for (var gb = 1; gb < boxes.length; gb++) boxes[gb].open = false;
  }

  /* Controls that only work with this file running ship `hidden`. */
  var filterBox = document.querySelector('.pf-filters');
  var stackBox = document.getElementById('pf-stack-section');
  if (filterBox) filterBox.hidden = false;
  if (stackBox) stackBox.hidden = false;

  /* Resolved BEFORE the init pass below, and applied only when the answer
     differs from the markup: the page ships Korean, so a Korean reader runs
     exactly the sequence that ran before this existed. Anyone getting English
     pays one redundant render for a page that is finally in a language they
     read, which is the right way round. */
  if (resolveLanguage() === 'en') applyLanguage('en', true);

  syncTopbarHeight();
  drawTimeline();
  var droppedParams = readState();
  syncChips();
  syncGridOpen();
  render();
  /* A link that names a filter this page does not have is a link that shows
     something other than what it promised — say so once rather than quietly
     rendering the full list. */
  if (droppedParams > 0) status.textContent += COPY[lang].badLink;
  if (location.hash.length > 1) reveal(location.hash.slice(1));
})();
