/* assets/release-radar/ui.js
 * Client-side filtering for the radar. The only file that touches the DOM.
 *
 * Hand-maintained. Nothing generates this file.
 *
 * The data is NOT here. Every card is rendered by Liquid at build time from
 * `_data/radar_data.json`, so the page is complete and readable before this
 * script runs, and it makes no request of any kind. This file only hides rows
 * that a filter excludes.
 *
 * That ordering is why the filter panel ships with `hidden` in the markup and is
 * revealed here: without JS the controls could not filter anything, and a search
 * box that silently does nothing is worse than no search box.
 *
 * Invariants:
 *   - Nothing is stored. A filter is a glance, not a preference — restoring one
 *     on a later visit would hide components the reader never chose to hide, on
 *     a page whose whole job is to tell them what they are missing.
 *   - Counts render through textContent. The filter string is user input.
 *   - Group sections hide when every card inside them is filtered out, so the
 *     page never shows a heading over nothing.
 */
(function () {
  'use strict';

  var panel = document.getElementById('rr-filters');
  var query = document.getElementById('rr-q');
  var onlyWarn = document.getElementById('rr-only-warn');
  var count = document.getElementById('rr-filter-count');
  var empty = document.getElementById('rr-empty');

  /* The "no data" build renders none of this. Bail rather than throw. */
  if (!panel || !query || !onlyWarn || !count) { return; }

  var cards = Array.prototype.slice.call(document.querySelectorAll('[data-card]'));
  if (!cards.length) { return; }

  /* Each group paired with its own cards once, at boot. Re-running
   * querySelectorAll per group on every keystroke would walk the whole document
   * again for a set that never changes. */
  var groups = Array.prototype.map.call(
    document.querySelectorAll('[data-group]'),
    function (group) {
      return {
        el: group,
        cards: Array.prototype.slice.call(group.querySelectorAll('[data-card]'))
      };
    }
  );

  panel.hidden = false;

  function debounce(fn, ms) {
    var timer = null;
    return function () {
      if (timer) { clearTimeout(timer); }
      timer = setTimeout(function () { timer = null; fn(); }, ms);
    };
  }

  function apply() {
    var q = query.value.trim().toLowerCase();
    var warnOnly = onlyWarn.checked;
    var shown = 0;

    cards.forEach(function (card) {
      var name = card.getAttribute('data-name') || '';
      var isWarn = card.getAttribute('data-warn') === '1';
      var visible = (!q || name.indexOf(q) !== -1) && (!warnOnly || isWarn);
      card.hidden = !visible;
      if (visible) { shown++; }
    });

    /* A heading with nothing under it reads as a section that came back empty
     * rather than one that was filtered away. */
    groups.forEach(function (group) {
      group.el.hidden = !group.cards.some(function (card) { return !card.hidden; });
    });

    if (empty) { empty.hidden = shown !== 0; }

    /* Silent while unfiltered: announcing "53 of 53" on load would be noise in
     * the live region for no gain. */
    if (q || warnOnly) {
      count.textContent = shown + ' of ' + cards.length + ' shown';
    } else {
      count.textContent = '';
    }
  }

  query.addEventListener('input', debounce(apply, 120));
  onlyWarn.addEventListener('change', apply);

  /* Escape clears both filters from wherever focus happens to be — the fastest
   * way back to the whole page once a search has narrowed it to one card. Bound
   * to the document, not the input: bound to the input it would only work while
   * the search box already had focus, which is the one case where clearing it is
   * least needed. */
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && (query.value || onlyWarn.checked)) {
      query.value = '';
      onlyWarn.checked = false;
      apply();
    }
  });

  apply();
})();
