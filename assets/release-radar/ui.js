/* assets/release-radar/ui.js
 * Client-side filtering for the radar. The only file that touches the DOM.
 *
 * Every card is rendered by Liquid at build time; this only hides cards. The
 * filter panel ships `hidden` and is revealed here, because without JS its
 * controls could not filter anything.
 *
 * Invariants:
 *   - Nothing is stored: a restored filter would hide components on a page
 *     whose job is to show what the reader is missing.
 *   - Counts render through textContent. The filter string is user input.
 */
(function () {
  'use strict';

  var panel = document.getElementById('rr-filters');
  var query = document.getElementById('rr-q');
  var onlyWarn = document.getElementById('rr-only-warn');
  var count = document.getElementById('rr-filter-count');
  var empty = document.getElementById('rr-empty');

  /* The "no data" build renders none of this. */
  if (!panel || !query || !onlyWarn || !count) { return; }

  var cards = Array.prototype.slice.call(document.querySelectorAll('[data-card]'));
  if (!cards.length) { return; }

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

    // Silent while unfiltered: "N of N" on load is live-region noise.
    if (q || warnOnly) {
      count.textContent = shown + ' of ' + cards.length + ' shown';
    } else {
      count.textContent = '';
    }
  }

  query.addEventListener('input', debounce(apply, 120));
  onlyWarn.addEventListener('change', apply);

  // Escape clears both filters from anywhere, so it is bound to the document.
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && (query.value || onlyWarn.checked)) {
      query.value = '';
      onlyWarn.checked = false;
      apply();
    }
  });

  apply();
})();
