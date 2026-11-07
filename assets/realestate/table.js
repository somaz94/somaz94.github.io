/* table.js — search, 권역 filter and column sort for a ranking table.
 *
 * Progressive: every row is in the HTML already, in rank order. Nothing is stored
 * and nothing is requested, so a return visit starts from the whole table.
 */
(function () {
  'use strict';

  var table = document.querySelector('[data-re-table]');
  var bar = document.querySelector('.re-filter');
  if (!table || !bar) return;

  var tbody = table.tBodies[0];
  var rows = Array.prototype.slice.call(tbody.rows);
  var search = bar.querySelector('[data-re-search]');
  var groups = Array.prototype.slice.call(bar.querySelectorAll('[data-re-group]'));
  var count = bar.querySelector('[data-re-count]');
  var sortStatus = document.querySelector('[data-re-sort-status]');
  var heads = Array.prototype.slice.call(table.tHead.rows[0].cells);
  var total = rows.length;
  var group = '';
  var countTimer = null;

  /* Its own tbody, or a hidden row would take `:last-child` from the real last one. */
  var emptyBody = table.createTBody();
  emptyBody.className = 're-table-empty';
  emptyBody.hidden = true;
  var emptyCell = emptyBody.insertRow().insertCell();
  emptyCell.colSpan = heads.length;
  emptyCell.textContent = '조건에 맞는 지역이 없습니다.';

  function matches(row, query) {
    /* Spaces removed on both sides: "서울강남" and "서울 강남" name one district. */
    var name = row.getAttribute('data-name').replace(/\s+/g, '').toLowerCase();
    return (!group || row.getAttribute('data-group') === group) &&
           (!query || name.indexOf(query) !== -1);
  }

  function refresh(ev) {
    var query = search.value.replace(/\s+/g, '').toLowerCase();
    var shown = rows.filter(function (row) { return matches(row, query); }).length;
    /* Typing 강남 passes through 강ㄴ and 강나, which match nothing: without this
       the table would empty and refill between keystrokes. */
    if (ev && ev.isComposing && shown === 0) return;

    rows.forEach(function (row) { row.hidden = !matches(row, query); });
    emptyBody.hidden = shown !== 0;
    /* The rows cannot be read beside the message once they have scrolled away. */
    if (shown === 0) table.parentNode.scrollLeft = 0;

    /* Debounced: a live region re-read on each keystroke is unusable. */
    clearTimeout(countTimer);
    countTimer = setTimeout(function () {
      count.textContent = shown === total ? total + '곳' : total + '곳 중 ' + shown + '곳';
    }, 350);
  }

  function value(row, col) {
    var raw = row.cells[col].getAttribute('data-v');
    var n = raw === null || raw === '' ? NaN : Number(raw);
    return isFinite(n) ? n : null;
  }

  function sortBy(col, descending) {
    rows.sort(function (a, b) {
      var x = value(a, col);
      var y = value(b, col);
      /* A missing figure is not small or large: it sinks in both directions. */
      if (x === null || y === null) return x === y ? 0 : (x === null ? 1 : -1);
      return descending ? y - x : x - y;
    });
    rows.forEach(function (row) { tbody.appendChild(row); });
  }

  function mark(cell, state) {
    if (state) cell.setAttribute('aria-sort', state);
    else cell.removeAttribute('aria-sort');
    var m = cell.querySelector('.re-sort-mark');
    if (m) m.textContent = state === 'descending' ? '↓' : (state === 'ascending' ? '↑' : '↕');
  }

  heads.forEach(function (cell, col) {
    var first = cell.getAttribute('data-sort');
    if (!first) return;
    var label = cell.textContent;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 're-sort';
    button.textContent = label;
    var markEl = document.createElement('span');
    markEl.className = 're-sort-mark';
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
        sortStatus.textContent = label + (descending ? ' 높은 순' : ' 낮은 순') + '으로 정렬했습니다.';
      }
    });
  });

  search.addEventListener('input', refresh);
  search.addEventListener('compositionend', refresh);
  search.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && search.value) {
      search.value = '';
      refresh();
    }
  });
  groups.forEach(function (button) {
    button.addEventListener('click', function () {
      group = button.getAttribute('data-re-group');
      groups.forEach(function (other) {
        other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
      });
      refresh();
    });
  });
})();
