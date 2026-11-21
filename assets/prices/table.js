/* table.js — search, 대분류 filter and column sort for the /prices/ item table.
 *
 * Copied from assets/dividend/table.js (the realestate → salary → dividend line)
 * with the class prefix changed and 시장 renamed 대분류; a fix to one copy has to
 * be ported to the others.
 * Progressive: every row is in the HTML already, in rank order. Nothing is
 * stored and nothing is requested, so a return visit starts from the whole table.
 */
(function () {
  'use strict';

  var table = document.querySelector('[data-px-table]');
  var bar = document.querySelector('.px-filter');
  if (!table || !bar) return;

  var tbody = table.tBodies[0];
  var rows = Array.prototype.slice.call(tbody.rows);
  var search = bar.querySelector('[data-px-search]');
  var cats = Array.prototype.slice.call(bar.querySelectorAll('[data-px-cat]'));
  var count = bar.querySelector('[data-px-count]');
  var unit = count.getAttribute('data-unit') || '';
  var sortStatus = document.querySelector('[data-px-sort-status]');
  var heads = Array.prototype.slice.call(table.tHead.rows[0].cells);
  var total = rows.length;
  var cat = '';
  var countTimer = null;
  /* `data-px-page="50"` shows the matching rows 50 at a time behind a button;
     absent, every match shows. The CSS hides rows past the first page until
     `data-px-ready` is set below, so the long table never paints in full first. */
  var page = Number(table.getAttribute('data-px-page')) || 0;
  var limit = page;
  var more = null;
  if (page) {
    more = document.createElement('button');
    more.type = 'button';
    more.className = 'px-btn px-more';
    table.parentNode.parentNode.insertBefore(more, table.parentNode.nextSibling);
    more.addEventListener('click', function () {
      limit += page;
      apply();
      /* The last page hides the button under the reader's focus; land on the table instead of <body>. */
      if (more.hidden) table.parentNode.focus({ preventScroll: true });
    });
  }

  /* Its own tbody, or a hidden row would take `:last-child` from the real last one. */
  var emptyBody = table.createTBody();
  emptyBody.className = 'px-table-empty';
  emptyBody.hidden = true;
  var emptyCell = emptyBody.insertRow().insertCell();
  emptyCell.colSpan = heads.length;
  emptyCell.textContent = table.getAttribute('data-px-empty') || '조건에 맞는 항목이 없습니다.';

  /* Lower-cased once: 2,000 rows re-read per keystroke is the whole cost here. */
  var names = rows.map(function (row) {
    return (row.getAttribute('data-name') || '').replace(/\s+/g, '').toLowerCase();
  });

  /* Row → its index in `rows`, for walking the tbody in display order after a sort. */
  var position = new Map(rows.map(function (row, i) { return [row, i]; }));

  function matches(i, query) {
    return (!cat || rows[i].getAttribute('data-cat') === cat) &&
           (!query || names[i].indexOf(query) !== -1);
  }

  function query() {
    /* Spaces removed on both sides: "전기 료" and "전기료" name one item. */
    return search.value.replace(/\s+/g, '').toLowerCase();
  }

  /* Visibility from the filter AND the page limit, walked in the table's current
     order, so a sort keeps showing the first rows of the new order. */
  function apply() {
    var q = query();
    var shown = 0;
    var matched = 0;
    Array.prototype.forEach.call(tbody.rows, function (row) {
      var ok = matches(position.get(row), q);
      if (ok) matched += 1;
      var visible = ok && (!page || matched <= limit);
      if (visible) shown += 1;
      /* Only rows whose state changes: rewriting 2,200 `hidden` flags per keystroke is wasted layout work. */
      if (row.hidden !== !visible) row.hidden = !visible;
    });
    if (more) {
      var left = matched - shown;
      more.hidden = left <= 0;
      more.textContent = Math.min(page, left).toLocaleString('ko-KR') + unit + ' 더 보기 · ' +
        left.toLocaleString('ko-KR') + unit + ' 남음';
    }
    return matched;
  }

  function refresh(ev) {
    var q = query();
    var shown = rows.filter(function (row, i) { return matches(i, q); }).length;
    /* Typing 사과 passes through 삭, which matches nothing: without this the
       table would empty and refill between keystrokes. */
    if (ev && ev.isComposing && shown === 0) return;

    limit = page;
    apply();
    emptyBody.hidden = shown !== 0;
    /* The rows cannot be read beside the message once they have scrolled away. */
    if (shown === 0) table.parentNode.scrollLeft = 0;

    /* Debounced: a live region re-read on each keystroke is unusable. */
    clearTimeout(countTimer);
    countTimer = setTimeout(function () {
      count.textContent = shown === total
        ? total.toLocaleString('ko-KR') + unit
        : total.toLocaleString('ko-KR') + unit + ' 중 ' + shown.toLocaleString('ko-KR') + unit;
    }, 350);
  }

  function value(row, col) {
    var raw = row.cells[col].getAttribute('data-v');
    var n = raw === null || raw === '' ? NaN : Number(raw);
    return isFinite(n) ? n : null;
  }

  function sortBy(col, descending) {
    /* Index carried along so equal values keep rank order: Array.sort was not
       required to be stable before ES2019. */
    var order = rows.map(function (row, i) { return [row, i]; });
    order.sort(function (a, b) {
      var x = value(a[0], col);
      var y = value(b[0], col);
      /* A missing figure is not small or large: it sinks in both directions. */
      if (x === null || y === null) {
        if (x === y) return a[1] - b[1];
        return x === null ? 1 : -1;
      }
      if (x === y) return a[1] - b[1];
      return descending ? y - x : x - y;
    });
    var frag = document.createDocumentFragment();
    order.forEach(function (pair) { frag.appendChild(pair[0]); });
    tbody.appendChild(frag);
    if (page) apply();
  }

  function mark(cell, state) {
    if (state) cell.setAttribute('aria-sort', state);
    else cell.removeAttribute('aria-sort');
    var m = cell.querySelector('.px-sort-mark');
    if (m) m.textContent = state === 'descending' ? '↓' : (state === 'ascending' ? '↑' : '↕');
  }

  heads.forEach(function (cell, col) {
    var first = cell.getAttribute('data-sort');
    if (!first) return;
    var label = cell.textContent;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'px-sort';
    button.textContent = label;
    var markEl = document.createElement('span');
    markEl.className = 'px-sort-mark';
    markEl.setAttribute('aria-hidden', 'true');
    button.appendChild(markEl);
    cell.textContent = '';
    cell.appendChild(button);
    mark(cell, cell.getAttribute('aria-sort'));

    button.addEventListener('click', function () {
      var current = cell.getAttribute('aria-sort');
      var descending = current ? current === 'ascending' : first === 'desc';
      heads.forEach(function (other) {
        if (other !== cell) mark(other, null);
      });
      mark(cell, descending ? 'descending' : 'ascending');
      sortBy(col, descending);
      if (sortStatus) {
        /* The rank column reads backwards: ascending puts 1위 on top, which
           "낮은 순" would describe as the opposite. It names its own messages. */
        sortStatus.textContent = cell.getAttribute(descending ? 'data-sort-desc-msg' : 'data-sort-asc-msg') ||
          label + (descending ? ' 높은 순' : ' 낮은 순') + '으로 정렬했습니다.';
      }
    });
  });

  if (page) {
    apply();
    table.setAttribute('data-px-ready', '');
  }

  search.addEventListener('input', refresh);
  search.addEventListener('compositionend', refresh);
  search.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && search.value) {
      search.value = '';
      refresh();
    }
  });
  cats.forEach(function (button) {
    button.addEventListener('click', function () {
      cat = button.getAttribute('data-px-cat');
      cats.forEach(function (other) {
        other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
      });
      refresh();
    });
  });
})();
