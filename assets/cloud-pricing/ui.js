/* assets/cloud-pricing/ui.js
 * Filtering, sorting and unit switching for the price table. The only file that
 * touches the DOM.
 *
 * Every row is rendered by Liquid at build time, so the table is complete
 * before this runs. The filter panel ships `hidden` and is revealed here, so the
 * no-JS page shows every row: fewer rows than exist is only defensible behind a
 * visible, reversible control.
 *
 * Invariants:
 *   - Nothing is stored. A filter and a sort are a glance, not a preference.
 *   - Figures come from `data-*` attributes, never parsed back out of rendered
 *     text (symbols, separators and a switchable unit do not survive parseFloat).
 *   - Counts render through textContent. The filter string is user input.
 */
(function () {
  'use strict';

  /* AWS's calculator month: 365 * 24 / 12, not 720 — the 1.4% difference is
   * larger than several of the gaps this table shows. */
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

  /* The "no data" build renders none of this. */
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

  /* Formatted here, not in Liquid: `round` cannot pad, and a column whose
   * digit count changes per row cannot be compared down. The thresholds follow
   * the catalogue's range — four decimals on the cheapest, none on the dearest. */
  function money(usd) {
    if (usd >= 100) { return '$' + usd.toFixed(0); }
    if (usd >= 10) { return '$' + usd.toFixed(2); }
    return '$' + usd.toFixed(4);
  }

  function monthly(usd) {
    var m = usd * HOURS_PER_MONTH;
    // Whole dollars: nobody budgets a month to the cent.
    return '$' + Math.round(m).toLocaleString('en-US');
  }

  function unit() {
    for (var i = 0; i < unitRadios.length; i++) {
      if (unitRadios[i].checked) { return unitRadios[i].value; }
    }
    return 'hour';
  }

  var priceCells = Array.prototype.slice.call(table.querySelectorAll('[data-usd]'))
    .map(function (cell) {
      return { el: cell, usd: parseFloat(cell.getAttribute('data-usd')) };
    })
    .filter(function (c) { return isFinite(c.usd); });

  /* Reservation upfronts are a LUMP SUM, so they ignore the hour/month toggle.
   * Liquid emits them unseparated so the no-JS page still states the amount. */
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
    // The header carries the unit, so it must move with the cells.
    unitLabels.forEach(function (el) {
      el.textContent = monthlyMode ? 'USD/mo' : 'USD/hr';
    });
  }

  /* `data-sort="vcpu"` reads `data-vcpu`, so a new column needs no entry here.
   * `name` is the only textual key. */
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
        // Blanks sink in BOTH directions: a blank is not a small or large number.
        if (av === null && bv === null) { return value(a, 'i') - value(b, 'i'); }
        if (av === null) { return 1; }
        if (bv === null) { return -1; }
        var cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
        if (cmp === 0) { return value(a, 'i') - value(b, 'i'); }
        return sortDesc ? -cmp : cmp;
      });
    }

    // One reflow; appending an attached element moves it, so no re-binding.
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
        /* Text opens A-Z, a number largest-first. A third click drops back to
         * the build-time order. */
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

  /* The slug list arrives as `data-regions`, so nothing here names a region;
   * `REGIONS` in the fetch script grows options, row attributes and this filter
   * together. The default is read from the markup's `selected`, not repeated. */
  var regionSlugs = regionSel
    ? (regionSel.getAttribute('data-regions') || '').split(',').filter(Boolean)
    : [];
  var regionDefault = regionSel ? regionSel.value : '';

  function priced(row, slug) { return row.hasAttribute('data-' + slug); }

  function regionOk(row, value) {
    if (!value) { return true; }
    // Priced everywhere, over the slug list so it holds for any region count.
    if (value === 'both') {
      return regionSlugs.every(function (s) { return priced(row, s); });
    }

    /* Both halves are validated against the known slugs: a `data-` lookup for
     * an unknown region is false on every row and would empty the table. */
    var want;
    if (value.indexOf('avail-') === 0) {
      want = value.slice(6);
      if (regionSlugs.indexOf(want) !== -1) { return priced(row, want); }
    } else if (value.indexOf('only-') === 0) {
      // Exclusive: priced here and nowhere else.
      want = value.slice(5);
      if (regionSlugs.indexOf(want) !== -1) {
        return priced(row, want) && regionSlugs.every(function (s) {
          return s === want || !priced(row, s);
        });
      }
    }

    // An unrecognised value (devtools, an extension) shows everything.
    return true;
  }

  function stripe() {
    /* By the VISIBLE sequence, not `:nth-child`, which counts hidden rows and
     * leaves same-shade runs that read as a grouping. */
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
        /* No spot data means HIDDEN, not kept: an unknown risk does not belong
         * in a set the reader just bounded by risk. */
        (maxRate === null ||
          (row.hasAttribute('data-spot-rate') &&
           +row.getAttribute('data-spot-rate') <= maxRate)) &&
        (!needCurrent || row.getAttribute('data-current') === '1');
      row.hidden = !visible;
      if (visible) { shown++; }
    });

    if (empty) {
      empty.hidden = shown !== 0;
      /* Interruption is a primary-region figure, so bounding it while Region
       * excludes that region matches nothing by construction — say so. */
      empty.textContent = (maxRate !== null && region && region !== 'both' &&
                           region.indexOf(regionSlugs[0]) === -1)
        ? 'Nothing matches. Interruption is a Seoul figure, so it cannot narrow ' +
          'types that Seoul does not price.'
        : 'Nothing matches that filter.';
    }

    /* Never silent, unlike /release-radar/'s: the DEFAULT view is already
     * filtered (Region ships on the first region), so silence would let hidden
     * rows pass for the whole catalogue. */
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

  /* Escape clears the filters from anywhere, so it is bound to the document,
   * not the input. It restores the SHIPPED Region default rather than clearing
   * it: adding rows the page opens without would undo something the reader
   * never did. */
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
