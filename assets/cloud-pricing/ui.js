/* assets/cloud-pricing/ui.js
 * Filtering, sorting and unit switching for the price table. The only file that
 * touches the DOM.
 *
 * Hand-maintained. Nothing generates this file.
 *
 * The prices are NOT here. Every row is rendered by Liquid at build time from
 * `_data/cloud_prices.json`, so the table is complete and readable before this
 * script runs, and the page makes no request of any kind. This file only hides
 * rows, reorders them, and restates the same number in a different unit.
 *
 * That ordering is why the filter panel ships with `hidden` in the markup and is
 * revealed here: without JS the controls could not filter anything, and a search
 * box that silently does nothing is worse than no search box. Note what that
 * implies — the no-JS page shows all 1,375 rows rather than the 774 the default
 * filter would leave. That is the honest fallback: showing fewer rows than exist
 * is only defensible while there is a visible, reversible control saying so.
 *
 * Invariants:
 *   - Nothing is stored. A filter and a sort are a glance, not a preference.
 *   - Every figure is derived from `data-usd` / `data-*` attributes, never
 *     parsed back out of rendered text — the text carries a currency symbol, a
 *     percent sign, thousands separators and a unit the reader can switch, and
 *     none of those survive parseFloat.
 *   - Counts render through textContent. The filter string is user input.
 *   - A row with no value in the sorted column sorts LAST in both directions.
 *     Ascending by Seoul price otherwise opens on 601 blank rows.
 */
(function () {
  'use strict';

  /* AWS's own calculator bills a month as 730 hours (365 * 24 / 12), not 720.
   * Over a year the two differ by about 1.4%, which is larger than several of
   * the price gaps this table exists to show. */
  var HOURS_PER_MONTH = 730;

  var panel = document.getElementById('cp-filters');
  var query = document.getElementById('cp-q');
  var groupSel = document.getElementById('cp-group');
  var archSel = document.getElementById('cp-arch');
  var regionSel = document.getElementById('cp-region');
  var spotRateSel = document.getElementById('cp-spot-rate');
  var currentOnly = document.getElementById('cp-current');
  var count = document.getElementById('cp-count');
  var empty = document.getElementById('cp-empty');
  var body = document.getElementById('cp-body');
  var table = document.getElementById('cp-table');

  /* The "no data" build renders none of this. Bail rather than throw. */
  if (!panel || !query || !body || !table || !count) { return; }

  var rows = Array.prototype.slice.call(body.querySelectorAll('[data-row]'));
  if (!rows.length) { return; }

  var unitRadios = Array.prototype.slice.call(
    panel.querySelectorAll('input[name="cp-unit"]')
  );
  var unitLabels = Array.prototype.slice.call(
    table.querySelectorAll('[data-unit-label]')
  );

  panel.hidden = false;

  /* ------------------------------------------------------------------ money */

  /* Formatted here rather than in Liquid, and the two units share one function
   * so they cannot disagree about how a number is written. Liquid's `round`
   * cannot pad — `0.098` stays three digits while `0.1181` is four — and a price
   * column that changes width per row is not a column anyone can compare down.
   *
   * The thresholds are the catalogue's own range: it runs from $0.0042/hr
   * (t4g.nano) to $361/hr (u7in-24tb.224xlarge). Four decimals on the second is
   * noise, two on the first rounds it to zero. */
  function money(usd) {
    if (usd >= 100) { return '$' + usd.toFixed(0); }
    if (usd >= 10) { return '$' + usd.toFixed(2); }
    return '$' + usd.toFixed(4);
  }

  function monthly(usd) {
    var m = usd * HOURS_PER_MONTH;
    /* Whole dollars, with separators: nobody budgets a month to the cent, and
     * "$71.54" beside "$159,432.00" is two different questions in one column. */
    return '$' + Math.round(m).toLocaleString('en-US');
  }

  function unit() {
    for (var i = 0; i < unitRadios.length; i++) {
      if (unitRadios[i].checked) { return unitRadios[i].value; }
    }
    return 'hour';
  }

  /* Collected once. Re-querying every money cell on each unit change would walk the
   * whole table for a set that never changes. */
  var priceCells = Array.prototype.slice.call(table.querySelectorAll('[data-usd]'))
    .map(function (cell) {
      return { el: cell, usd: parseFloat(cell.getAttribute('data-usd')) };
    })
    .filter(function (c) { return isFinite(c.usd); });

  /* The reservation upfronts, formatted once. They are a LUMP SUM, not a rate,
   * so unlike every other money figure on the page they do not move with the
   * hour/month toggle — $1,036 due today is $1,036 due today whichever unit the
   * rate beside it is shown in. Separators matter here more than anywhere else
   * in the table: the largest is $45,533, and "45533" is a number nobody reads
   * at a glance. Liquid emits the unseparated form so the no-JS page still
   * states the amount. */
  Array.prototype.slice.call(table.querySelectorAll('[data-upfront]'))
    .forEach(function (el) {
      var v = parseFloat(el.getAttribute('data-upfront'));
      if (isFinite(v)) {
        el.textContent = '$' + Math.round(v).toLocaleString('en-US');
      }
    });

  function renderUnit() {
    var monthlyMode = unit() === 'month';
    priceCells.forEach(function (c) {
      c.el.textContent = monthlyMode ? monthly(c.usd) : money(c.usd);
    });
    /* The header carries the unit, so it has to move with the cells — a table of
     * five-figure numbers under a "USD/hr" heading is not a rounding error, it
     * is a claim that an m5.large costs $86 an hour. */
    unitLabels.forEach(function (el) {
      el.textContent = monthlyMode ? 'USD/mo' : 'USD/hr';
    });
  }

  /* ---------------------------------------------------------------- sorting */

  /* Sort key -> the attribute holding it. The two names are deliberately the
   * same string in the markup (`data-sort="vcpu"` reads `data-vcpu`), so a new
   * column needs no entry here. `name` is the only textual key. */
  var sortKey = null;      /* null = the build-time order: family, then vCPU */
  var sortDesc = false;

  function value(row, key) {
    var raw = row.getAttribute('data-' + key);
    if (raw === null) { return null; }
    return key === 'name' ? raw : parseFloat(raw);
  }

  function applySort() {
    var ordered = rows.slice();

    if (sortKey === null) {
      ordered.sort(function (a, b) {
        return value(a, 'i') - value(b, 'i');
      });
    } else {
      ordered.sort(function (a, b) {
        var av = value(a, sortKey);
        var bv = value(b, sortKey);
        /* Missing values sink in BOTH directions rather than flipping to the
         * top on a descending sort. A blank is not a small number and not a
         * large one; it is the absence of the thing being ranked. */
        if (av === null && bv === null) { return value(a, 'i') - value(b, 'i'); }
        if (av === null) { return 1; }
        if (bv === null) { return -1; }
        var cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
        if (cmp === 0) { return value(a, 'i') - value(b, 'i'); }
        return sortDesc ? -cmp : cmp;
      });
    }

    /* One reflow instead of one per row. Appending an element that is already in the
     * document moves it, so no clone and no re-binding is needed. */
    var frag = document.createDocumentFragment();
    ordered.forEach(function (row) { frag.appendChild(row); });
    body.appendChild(frag);
    rows = ordered;
  }

  var headers = Array.prototype.slice.call(table.querySelectorAll('th[data-sort]'));

  function syncHeaders() {
    headers.forEach(function (th) {
      var key = th.getAttribute('data-sort');
      if (key !== sortKey) { th.setAttribute('aria-sort', 'none'); return; }
      th.setAttribute('aria-sort', sortDesc ? 'descending' : 'ascending');
    });
  }

  headers.forEach(function (th) {
    var button = th.querySelector('.cp-sort');
    if (!button) { return; }
    button.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (sortKey !== key) {
        sortKey = key;
        /* Text opens A-Z; a number opens with the largest, because "which is
         * the most expensive" is the question a price column is clicked for.
         * A third click drops back to the build-time order rather than cycling
         * forever between two answers the reader has already seen. */
        sortDesc = key !== 'name';
      } else if (sortDesc === (key !== 'name')) {
        sortDesc = !sortDesc;
      } else {
        sortKey = null;
      }
      syncHeaders();
      applySort();
      stripe();
    });
  });

  /* ---------------------------------------------------------------- regions */

  /* The slug list arrives on the select as `data-regions`, so nothing here names
   * a region. Adding one to `REGIONS` in the fetch script grows the options, the
   * row attributes and this filter together — the whole reason the markup
   * generates `data-<slug>` instead of spelling out `data-seoul`.
   *
   * The default is READ from the DOM rather than repeated here. The markup marks
   * the first region's option `selected`, and that is the page's resting state;
   * a second copy of it in this file is a second thing to remember to change. */
  var regionSlugs = regionSel
    ? (regionSel.getAttribute('data-regions') || '').split(',').filter(Boolean)
    : [];
  var regionDefault = regionSel ? regionSel.value : '';

  function priced(row, slug) { return row.hasAttribute('data-' + slug); }

  function regionOk(row, value) {
    if (!value) { return true; }
    /* Priced everywhere. Written over the slug list rather than as
     * `a && b` so it stays true to its label if a third region appears. */
    if (value === 'both') {
      return regionSlugs.every(function (s) { return priced(row, s); });
    }

    /* Both halves are checked against the KNOWN slug list, and an unknown one
     * falls through to `true` at the bottom. A `data-` lookup for a region that
     * does not exist is false on every row, so without this an unrecognised
     * slug empties the table instead of ignoring the filter — the opposite of
     * what the fallback is for, and the failure would look like "nothing is
     * priced there" rather than like a bad value. */
    var want;
    if (value.indexOf('avail-') === 0) {
      want = value.slice(6);
      if (regionSlugs.indexOf(want) !== -1) { return priced(row, want); }
    } else if (value.indexOf('only-') === 0) {
      /* Exclusive: priced here and nowhere else. The second half is the whole
       * point of the option — without it this is just `avail-`. */
      want = value.slice(5);
      if (regionSlugs.indexOf(want) !== -1) {
        return priced(row, want) && regionSlugs.every(function (s) {
          return s === want || !priced(row, s);
        });
      }
    }

    /* An unrecognised value shows everything rather than nothing. The select
     * cannot produce one, but devtools or an extension can, and an empty table
     * reads as "this tool is broken". */
    return true;
  }

  /* -------------------------------------------------------------- filtering */

  function stripe() {
    /* Striping by the VISIBLE sequence, not by `:nth-child`. A CSS stripe
     * counts DOM position, so hiding rows leaves runs of two and three of the
     * same shade — which is worse than no stripe, because it reads as a grouping
     * that is not there. */
    var odd = false;
    rows.forEach(function (row) {
      if (row.hidden) { return; }
      row.classList.toggle('cp-alt', odd);
      odd = !odd;
    });
  }

  function apply() {
    var q = query.value.trim().toLowerCase();
    var group = groupSel ? groupSel.value : '';
    var arch = archSel ? archSel.value : '';
    var region = regionSel ? regionSel.value : '';
    var maxRate = spotRateSel && spotRateSel.value !== '' ? +spotRateSel.value : null;
    var needCurrent = currentOnly ? currentOnly.checked : false;
    var shown = 0;

    rows.forEach(function (row) {
      var visible =
        (!q || row.getAttribute('data-name').indexOf(q) !== -1) &&
        (!group || row.getAttribute('data-group') === group) &&
        (!arch || row.getAttribute('data-arch') === arch) &&
        regionOk(row, region) &&
        /* A row with no spot data is HIDDEN by this filter, not kept. The
         * question asked is "interruption at most X", and a type the advisor
         * does not cover has no answer — showing it would put rows of unknown
         * risk inside a set the reader has just bounded by risk. The count line
         * says how many that removed. */
        (maxRate === null ||
          (row.hasAttribute('data-spot-rate') &&
           +row.getAttribute('data-spot-rate') <= maxRate)) &&
        (!needCurrent || row.getAttribute('data-current') === '1');
      row.hidden = !visible;
      if (visible) { shown++; }
    });

    if (empty) {
      empty.hidden = shown !== 0;
      /* One combination empties the table for a reason the reader cannot see:
       * Interruption is a Seoul figure — the Spot column is Seoul, as its header
       * says — so bounding it while the Region filter excludes Seoul-priced
       * types can only ever match nothing. "Nothing matches that filter" is true
       * there and useless; it reads as a broken tool rather than as two filters
       * that cannot both hold. */
      empty.textContent = (maxRate !== null && region && region !== 'both' &&
                           region.indexOf(regionSlugs[0]) === -1)
        ? 'Nothing matches. Interruption is a Seoul figure, so it cannot narrow ' +
          'types that Seoul does not price.'
        : 'Nothing matches that filter.';
    }

    /* Never silent, unlike /release-radar/'s equivalent. The DEFAULT view here
     * is already filtered — "Available in Seoul" ships checked — so an empty
     * status line would let 529 hidden rows pass for the whole catalogue. */
    count.textContent = shown.toLocaleString('en-US') + ' of ' +
      rows.length.toLocaleString('en-US') + ' types';

    stripe();
  }

  function debounce(fn, ms) {
    var timer = null;
    return function () {
      if (timer) { clearTimeout(timer); }
      timer = setTimeout(function () { timer = null; fn(); }, ms);
    };
  }

  query.addEventListener('input', debounce(apply, 120));
  [groupSel, archSel, regionSel, spotRateSel, currentOnly].forEach(function (el) {
    if (el) { el.addEventListener('change', apply); }
  });
  unitRadios.forEach(function (el) { el.addEventListener('change', renderUnit); });

  /* Escape clears the filters from wherever focus happens to be — the fastest
   * way back to the whole table once a search has narrowed it to one row. Bound
   * to the document, not the input: bound to the input it would only work while
   * the search box already had focus, which is the one case where clearing it is
   * least needed.
   *
   * It restores the SHIPPED default rather than clearing to nothing: Region is
   * `Priced in <first region>` at rest, and an Escape that silently added the
   * 529 rows the page deliberately opens without would be undoing something the
   * reader never did. */
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') { return; }
    var dirty = query.value ||
      (groupSel && groupSel.value) ||
      (archSel && archSel.value) ||
      (regionSel && regionSel.value !== regionDefault) ||
      (spotRateSel && spotRateSel.value) ||
      (currentOnly && currentOnly.checked);
    if (!dirty) { return; }
    query.value = '';
    if (groupSel) { groupSel.value = ''; }
    if (archSel) { archSel.value = ''; }
    if (regionSel) { regionSel.value = regionDefault; }
    if (spotRateSel) { spotRateSel.value = ''; }
    if (currentOnly) { currentOnly.checked = false; }
    apply();
  });

  renderUnit();
  apply();
})();
