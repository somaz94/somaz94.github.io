/* assets/security-news/ui.js
 * Client-side filtering for the headline list. Every item is rendered by Liquid at
 * build time; this only hides items.
 *
 * Invariants:
 *   - Nothing is stored. Filter state lives in the URL hash, so a filtered view can be
 *     shared and a return visit starts from the whole list.
 *   - The hash is untrusted: a value no chip offers is ignored.
 *   - Counts render through textContent. The search string is user input.
 *   - A query that is a CVE some headline carries matches that CVE exactly, the way the
 *     fetch script counts the headlines on each KEV row: as a substring CVE-2026-1113
 *     would also match CVE-2026-11135, and the list would disagree with the number on
 *     the link. Any other query, a CVE half typed included, stays a substring search, or
 *     typing CVE-2026-118527 would empty the list at every digit before the last.
 *   - A chip's count answers "how many if I press this": the other filters applied, its
 *     own replaced. Counting against the whole list would promise rows that are not there.
 *   - KEV deadlines, "today" and the data's age are worked out at read time in KST, the
 *     zone every date here is printed in. The page can be a day old, and anything baked
 *     relative to the build would be wrong by that much.
 *   - Older days start folded, but a filter opens every day it matches, so a count can
 *     never point at rows a closed day is hiding. Clearing it restores what the reader chose.
 */
(function () {
  'use strict';

  var panel = document.getElementById('sn-filters');
  var query = document.getElementById('sn-q');
  var count = document.getElementById('sn-count');
  var empty = document.getElementById('sn-empty');
  var langLink = document.getElementById('sn-lang');
  var news = document.getElementById('sn-news');
  var reset = document.getElementById('sn-reset');
  var toTop = document.getElementById('sn-top');
  var jump = document.getElementById('sn-jump');
  var topbar = document.querySelector('.sn-topbar');
  var CVE_QUERY = /^cve-\d{4}-\d{4,}$/;
  var sourceSelect = document.getElementById('sn-source');
  var copyButton = document.getElementById('sn-copy');
  var copied = document.getElementById('sn-copied');
  var age = document.getElementById('sn-age');
  var FILTERS = ['cat', 'region', 'kev', 'severe', 'action', 'source', 'issue'];
  /* These have no "All" chip of their own, so a second press clears them. */
  var TOGGLES = ['kev', 'severe', 'action', 'issue'];
  var OPEN_DAYS = 2;
  var STALE_HOURS = 24;
  var DAY_MS = 86400000;
  var KST_MS = 9 * 3600000;
  var DUE_SOON_DAYS = 7;

  /* The "no data" build renders none of this. */
  if (!panel || !query || !count) { return; }

  function dayNumber(iso) {
    var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return parts ? Date.UTC(+parts[1], +parts[2] - 1, +parts[3]) / DAY_MS : null;
  }

  var today = Math.floor((Date.now() + KST_MS) / DAY_MS);

  function showDeadlines() {
    Array.prototype.forEach.call(document.querySelectorAll('.sn-due[data-due]'), function (el) {
      var due = dayNumber(el.getAttribute('data-due'));
      var section = el.closest('[data-due-in]');
      if (due === null || !section) { return; }
      var left = due - today;
      var text = left < 0 ? 'data-due-past' : left === 0 ? 'data-due-today' : 'data-due-in';
      el.textContent = section.getAttribute(text).replace('{n}', String(left));
      el.setAttribute('data-state', left < 0 ? 'past' : left <= DUE_SOON_DAYS ? 'soon' : 'later');
      el.hidden = false;
    });
  }
  showDeadlines();

  function showAge() {
    var at = age ? Date.parse(age.getAttribute('data-updated')) : NaN;
    if (isNaN(at)) { return; }
    var minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
    var hours = Math.floor(minutes / 60);
    var text = minutes < 1 ? age.getAttribute('data-now')
      : hours < 1 ? age.getAttribute('data-min').replace('{n}', String(minutes))
      : hours < 48 ? age.getAttribute('data-hours').replace('{n}', String(hours))
      : age.getAttribute('data-days').replace('{n}', String(Math.floor(hours / 24)));
    age.textContent = text;
    age.setAttribute('data-state', hours >= STALE_HOURS ? 'stale' : 'fresh');
    age.hidden = false;
  }
  showAge();

  function showRelativeDays() {
    if (!news) { return; }
    Array.prototype.forEach.call(news.querySelectorAll('[data-rel]'), function (el) {
      var ago = today - dayNumber(el.getAttribute('data-rel'));
      if (ago !== 0 && ago !== 1) { return; }
      el.textContent = news.getAttribute(ago === 0 ? 'data-today' : 'data-yesterday') || '';
      el.hidden = false;
    });
  }
  showRelativeDays();

  var chips = Array.prototype.slice.call(document.querySelectorAll('button[data-filter]'));
  var sourceOptions = sourceSelect ? Array.prototype.slice.call(sourceSelect.options) : [];
  var days = Array.prototype.map.call(document.querySelectorAll('[data-day]'), function (day, index) {
    return {
      el: day,
      date: day.querySelector('time').getAttribute('datetime'),
      wantOpen: index < OPEN_DAYS,
      items: Array.prototype.map.call(day.querySelectorAll('[data-item]'), function (el) {
        var title = el.querySelector('.sn-title');
        /* Named fields, not textContent: "AI" would otherwise match every "AI translated" label. */
        var fields = el.querySelectorAll('.sn-title, .sn-source, .sn-cve, .sn-also a');
        var words = Array.prototype.map.call(fields, function (n) { return n.textContent; }).join(' ');
        /* `title` holds the original headline behind a label, so either language can be searched. */
        var original = title ? title.title.replace(/^[^:]*:\s*/, '') : '';
        var cves = Array.prototype.map.call(el.querySelectorAll('.sn-cve'), function (n) {
          return n.textContent.trim().toLowerCase();
        });
        return {
          el: el,
          titleEl: title,
          titleText: title ? title.textContent : '',
          url: title ? title.href : '',
          sourceName: el.querySelector('.sn-source').textContent,
          marked: '',
          source: el.getAttribute('data-source'),
          issue: el.getAttribute('data-issue') || '',
          cat: el.getAttribute('data-cat'),
          region: el.getAttribute('data-region'),
          kev: el.hasAttribute('data-kev'),
          severe: el.hasAttribute('data-severe'),
          action: el.hasAttribute('data-action'),
          cves: cves,
          text: (words + ' ' + original).toLowerCase()
        };
      })
    };
  });

  var items = days.reduce(function (all, day) { return all.concat(day.items); }, []);
  var total = items.length;
  if (!total) { return; }

  /* Keyed by text from the page, so no prototype key can answer for a CVE. */
  var knownCves = Object.create(null);
  items.forEach(function (item) {
    item.cves.forEach(function (cve) { knownCves[cve] = 1; });
  });
  var newsTitle = news ? news.querySelector('.sn-section-title') : null;

  function emptyState() {
    return { cat: '', region: '', kev: '', severe: '', action: '', source: '', issue: '', q: '' };
  }

  var state = emptyState();
  var langBase = langLink ? langLink.getAttribute('href') : '';

  function offered(filter, value) {
    if (filter === 'source') {
      return sourceOptions.some(function (option) { return option.value === value; });
    }
    return chips.some(function (chip) {
      return chip.getAttribute('data-filter') === filter && chip.getAttribute('data-value') === value;
    });
  }

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    FILTERS.forEach(function (key) {
      var value = params.get(key) || '';
      state[key] = offered(key, value) ? value : '';
    });
    state.q = params.get('q') || '';
    query.value = state.q;
  }

  function writeHash() {
    var params = new URLSearchParams();
    FILTERS.concat('q').forEach(function (key) {
      if (state[key]) { params.set(key, state[key]); }
    });
    var hash = params.toString();
    var url = window.location.pathname + window.location.search + (hash ? '#' + hash : '');
    try {
      window.history.replaceState(null, '', url);
    } catch (e) {
      /* Sandboxed frames can refuse this; the filter still applies. */
    }
    /* Switching language keeps the view. */
    if (langLink) { langLink.setAttribute('href', langBase + (hash ? '#' + hash : '')); }
  }

  function matches(item, q, s) {
    if (s.cat && item.cat !== s.cat) { return false; }
    if (s.region && item.region !== s.region) { return false; }
    if (s.kev && !item.kev) { return false; }
    if (s.severe && !item.severe) { return false; }
    if (s.action && !item.action) { return false; }
    if (s.source && item.source !== s.source) { return false; }
    if (s.issue && item.issue !== s.issue) { return false; }
    if (CVE_QUERY.test(q) && knownCves[q] === 1) { return item.cves.indexOf(q) !== -1; }
    return !q || item.text.indexOf(q) !== -1;
  }

  function ifPressed(filter, value) {
    var s = emptyState();
    FILTERS.forEach(function (key) { s[key] = key === filter ? value : state[key]; });
    return s;
  }

  function showDayCount(day, n) {
    var label = day.el.querySelector('[data-day-n]');
    if (!label) { return; }
    label.textContent = n === 1
      ? label.getAttribute('data-one')
      : (label.getAttribute('data-many') || '').replace('{n}', String(n));
  }

  function isFiltering() {
    return !!state.q.trim() || FILTERS.some(function (key) { return state[key]; });
  }

  /* DOM nodes, never markup: the query is user input. Lower-casing can change a string's
     length in a few scripts, and an offset from one then cuts the other in the wrong place. */
  function markTitle(item, q) {
    if (!item.titleEl || item.marked === q) { return; }
    item.marked = q;
    var text = item.titleText;
    var lower = text.toLowerCase();
    item.titleEl.textContent = '';
    if (!q || lower.length !== text.length) {
      item.titleEl.textContent = text;
      return;
    }
    var from = 0;
    var at = lower.indexOf(q);
    while (at !== -1) {
      item.titleEl.appendChild(document.createTextNode(text.slice(from, at)));
      var mark = document.createElement('mark');
      mark.textContent = text.slice(at, at + q.length);
      item.titleEl.appendChild(mark);
      from = at + q.length;
      at = lower.indexOf(q, from);
    }
    item.titleEl.appendChild(document.createTextNode(text.slice(from)));
  }

  function apply() {
    var q = state.q.trim().toLowerCase();
    var shown = 0;
    var filtering = isFiltering();
    days.forEach(function (day) {
      var inDay = 0;
      day.items.forEach(function (item) {
        var ok = matches(item, q, state);
        item.el.hidden = !ok;
        if (ok) {
          inDay += 1;
          markTitle(item, q);
        }
      });
      day.el.hidden = inDay === 0;
      day.el.open = filtering || day.wantOpen;
      showDayCount(day, inDay);
      shown += inDay;
    });
    chips.forEach(function (chip) {
      var filter = chip.getAttribute('data-filter');
      var value = chip.getAttribute('data-value');
      var active = state[filter] === value;
      var s = ifPressed(filter, value);
      var n = items.filter(function (item) { return matches(item, q, s); }).length;
      var label = chip.querySelector('.sn-chip-n');
      if (label) { label.textContent = String(n); }
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
      chip.classList.toggle('sn-chip--none', n === 0 && !active);
    });
    sourceOptions.forEach(function (option) {
      var s = ifPressed('source', option.value);
      var n = items.filter(function (item) { return matches(item, q, s); }).length;
      option.textContent = option.getAttribute('data-name') + ' (' + n + ')';
    });
    if (sourceSelect) { sourceSelect.value = state.source; }
    if (reset) { reset.hidden = !filtering; }
    /* The pressed story button has scrolled away, and every chip beside the list reads "All",
       so this line is the only place left that can say why the list is short. */
    var story = document.querySelector('.sn-story-all[aria-pressed="true"]');
    var storyName = story ? story.closest('.sn-story').querySelector('.sn-story-title').textContent + ' · ' : '';
    count.textContent = storyName + (count.getAttribute('data-template') || '')
      .replace('{n}', String(shown))
      .replace('{total}', String(total));
    if (empty) { empty.hidden = shown !== 0; }
  }

  function debounce(fn, ms) {
    var timer;
    return function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(fn, ms);
    };
  }

  /* Means another tab, which only the browser can open. */
  function isModifiedClick(event) {
    return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  }

  function isSticky() {
    return window.getComputedStyle(panel).position === 'sticky';
  }

  function publishStickyHeight() {
    document.documentElement.style.setProperty('--sn-sticky-h', isSticky() ? panel.offsetHeight + 'px' : '0px');
  }

  /* Read before the list shrinks: past that point the browser has clamped the scroll and
     the panel no longer reads as stuck. Without the jump, a filter pressed deep in the
     list would leave the reader at the page's end, looking at the sources. */
  function refresh() {
    var stuck = isSticky() && topbar &&
      panel.getBoundingClientRect().top <= topbar.getBoundingClientRect().bottom + 1;
    writeHash();
    apply();
    if (stuck && news) { news.scrollIntoView({ block: 'start' }); }
  }

  /* Fires for the page's own open changes too; only a reader's choice is worth keeping,
     and while filtering every matching day is open whatever they chose. */
  days.forEach(function (day) {
    day.el.addEventListener('toggle', function () {
      if (!isFiltering()) { day.wantOpen = day.el.open; }
    });
  });

  if (sourceSelect) {
    sourceSelect.addEventListener('change', function () {
      state.source = sourceSelect.value;
      refresh();
    });
  }

  function markdownEscape(text) {
    return text.replace(/([\\\[\]])/g, '\\$1');
  }

  /* Every matching headline, folded days included: the count beside the button is the
     promise. Takes the shown language and links to the publisher, as the page does. */
  function listAsMarkdown() {
    var q = state.q.trim().toLowerCase();
    var lines = [];
    days.forEach(function (day) {
      var rows = day.items.filter(function (item) { return matches(item, q, state); });
      if (!rows.length) { return; }
      if (lines.length) { lines.push(''); }
      lines.push('### ' + day.date);
      rows.forEach(function (item) {
        /* An unescaped ")" would end the link early; href does not encode parentheses. */
        var url = item.url.replace(/\(/g, '%28').replace(/\)/g, '%29');
        lines.push('- [' + markdownEscape(item.titleText) + '](' + url + ') · ' + item.sourceName);
      });
    });
    return lines.join('\n') + '\n';
  }

  if (copyButton && copied && navigator.clipboard && navigator.clipboard.writeText) {
    var copyLabel = copyButton.textContent;
    var copyTimer;
    var reportCopy = function (attribute) {
      var message = copyButton.getAttribute(attribute) || '';
      copyButton.textContent = message;
      copied.textContent = message;
      window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(function () {
        copyButton.textContent = copyLabel;
        copied.textContent = '';
      }, 2000);
    };
    copyButton.addEventListener('click', function () {
      navigator.clipboard.writeText(listAsMarkdown()).then(function () {
        reportCopy('data-done');
      }, function () {
        reportCopy('data-failed');
      });
    });
    copyButton.hidden = false;
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      var filter = chip.getAttribute('data-filter');
      var value = chip.getAttribute('data-value');
      state[filter] = TOGGLES.indexOf(filter) !== -1 && state[filter] === value ? '' : value;
      /* A story sits above the list, so without the jump the press would change nothing in
         view. Focus moves first, as for a KEV link, or it cuts off the count being announced. */
      var toList = filter === 'issue' && state.issue;
      if (toList && newsTitle) { newsTitle.focus({ preventScroll: true }); }
      refresh();
      if (toList && news) { news.scrollIntoView({ block: 'start' }); }
    });
  });

  /* Focus goes where the KEV link sends it, for the same reason, and before the button
     hides, or it would fall to the top of the document. */
  if (reset) {
    reset.addEventListener('click', function () {
      state = emptyState();
      query.value = '';
      if (newsTitle) { newsTitle.focus({ preventScroll: true }); }
      refresh();
    });
  }

  /* A KEV row's link shows only the headlines on its CVE, clearing every other filter so
     the count it printed is the count shown. Focus goes to the section heading, not the
     search field, which would raise a touch keyboard over the results; and it moves
     before apply(), so a screen reader does not cut off the count it announces. The
     link is revealed only once it has a handler: shown while ui.js is blocked, it would
     jump to a fragment that does not exist. */
  Array.prototype.forEach.call(document.querySelectorAll('.sn-kev-news[data-cve]'), function (link) {
    link.addEventListener('click', function (event) {
      /* The href carries the same filter in the other tab. */
      if (isModifiedClick(event)) { return; }
      event.preventDefault();
      state = emptyState();
      state.q = link.getAttribute('data-cve') || '';
      query.value = state.q;
      writeHash();
      if (newsTitle) { newsTitle.focus({ preventScroll: true }); }
      apply();
      if (news) { news.scrollIntoView({ block: 'start' }); }
    });
    link.hidden = false;
  });

  query.addEventListener('input', debounce(function () {
    state.q = query.value;
    refresh();
  }, 120));

  function goToNews(event) {
    event.preventDefault();
    if (newsTitle) { newsTitle.focus({ preventScroll: true }); }
    if (news) { news.scrollIntoView({ block: 'start' }); }
  }

  /* A plain fragment still works without script, but here it would reach readHash and
     clear the reader's filters. */
  if (jump) {
    jump.addEventListener('click', function (event) {
      if (isModifiedClick(event)) { return; }
      goToNews(event);
    });
  }

  /* Where the panel does not stick, a long list puts it a long scroll away. Read on scroll,
     not through IntersectionObserver: that reports only a change in crossing, so the End
     key or a fling that skips over the panel in one frame would never show the button. */
  if (toTop) {
    var placing = false;
    var placeToTop = function () {
      placing = false;
      toTop.hidden = panel.getBoundingClientRect().bottom > 0;
    };
    window.addEventListener('scroll', function () {
      if (placing) { return; }
      placing = true;
      window.requestAnimationFrame(placeToTop);
    }, { passive: true });
    toTop.addEventListener('click', goToNews);
  }

  /* Resize for crossing the breakpoint; the observer for chips rewrapping as counts change. */
  window.addEventListener('resize', publishStickyHeight);
  if ('ResizeObserver' in window) { new ResizeObserver(publishStickyHeight).observe(panel); }

  window.addEventListener('hashchange', function () {
    readHash();
    writeHash();
    apply();
  });

  panel.hidden = false;
  chips.forEach(function (chip) { chip.hidden = false; });
  publishStickyHeight();
  readHash();
  writeHash();
  apply();
})();
