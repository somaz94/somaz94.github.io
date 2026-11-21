/* The district trend's readout: a crosshair and one tooltip, both optional. Every value
   is also in the table beneath the charts, which is where this reads them from. */
(function () {
  'use strict';

  function field(label, value) {
    var row = document.createElement('span');
    row.className = 're-tip-row';
    row.appendChild(document.createTextNode(label + ' '));
    var strong = document.createElement('b');
    strong.textContent = value;
    row.appendChild(strong);
    return row;
  }

  function linesFor(kind, row) {
    if (kind === 'line') {
      return [
        field('매매 지수', row.dataset.sale || '—'),
        field('전세 지수', row.dataset.jeonse || '—')
      ];
    }
    return [
      field('거래', row.dataset.count + '건'),
      field('평균 평당가', row.dataset.py ? row.dataset.py + '만' : '—')
    ];
  }

  function marker(plot, cls) {
    var el = document.createElement('span');
    el.className = 're-dot re-dot--hover ' + cls;
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
    plot.appendChild(el);
    return el;
  }

  function setUp(plot, rows) {
    var kind = plot.getAttribute('data-re-plot');
    var cross = document.createElement('span');
    cross.className = 're-cross';
    cross.hidden = true;
    cross.setAttribute('aria-hidden', 'true');
    var tip = document.createElement('span');
    tip.className = 're-tip';
    tip.hidden = true;
    tip.setAttribute('aria-hidden', 'true');
    plot.appendChild(cross);
    plot.appendChild(tip);
    var saleDot = kind === 'line' ? marker(plot, 're-dot--sale') : null;
    var jeonseDot = kind === 'line' ? marker(plot, 're-dot--jeonse') : null;
    var current = -1;

    function placeDot(dot, y, x) {
      dot.hidden = y === '';
      dot.style.left = x + '%';
      dot.style.top = y + '%';
    }

    function show(i) {
      current = i;
      var row = rows[i];
      var x = parseFloat(row.dataset.x);
      cross.hidden = false;
      cross.style.left = x + '%';
      if (saleDot) {
        placeDot(saleDot, row.dataset.saleY, x);
        placeDot(jeonseDot, row.dataset.jeonseY, x);
      }
      tip.textContent = '';
      var head = document.createElement('span');
      head.className = 're-tip-head';
      head.textContent = row.dataset.month;
      tip.appendChild(head);
      linesFor(kind, row).forEach(function (line) { tip.appendChild(line); });
      if (plot.matches(':focus-visible')) { tip.appendChild(field('달 이동', '← →')); }
      tip.hidden = false;
      tip.classList.toggle('re-tip--left', x > 50);
      tip.style.left = x + '%';
      // On a phone the tooltip is most of the plot's width, so flipping is not enough.
      tip.style.translate = '';
      var box = tip.getBoundingClientRect();
      var edge = document.documentElement.clientWidth - 4;
      var shift = box.left < 4 ? 4 - box.left : (box.right > edge ? edge - box.right : 0);
      tip.style.translate = shift + 'px';
    }

    function hide() {
      current = -1;
      cross.hidden = true;
      tip.hidden = true;
      if (saleDot) { saleDot.hidden = true; jeonseDot.hidden = true; }
    }

    function track(ev) {
      var box = plot.getBoundingClientRect();
      if (!box.width) { return; }
      var share = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width));
      show(Math.round(share * (rows.length - 1)));
    }
    plot.addEventListener('pointermove', track);
    // A tap has no move, and lifting the finger fires leave: it would never be seen.
    plot.addEventListener('pointerdown', track);
    plot.addEventListener('pointerleave', function (ev) {
      if (ev.pointerType !== 'touch') { hide(); }
    });
    plot.addEventListener('pointercancel', hide);
    document.addEventListener('pointerdown', function (ev) {
      if (!plot.contains(ev.target)) { hide(); }
    });

    // Keyboard reaches the same readout; a screen reader has the table instead.
    plot.tabIndex = 0;
    plot.addEventListener('focus', function () {
      if (plot.matches(':focus-visible')) { show(rows.length - 1); }
    });
    plot.addEventListener('blur', hide);
    plot.addEventListener('keydown', function (ev) {
      // Alt+← is the browser's back.
      if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) { return; }
      var next = null;
      var newest = rows.length - 1;
      if (ev.key === 'ArrowLeft') { next = current < 0 ? newest : Math.max(0, current - 1); }
      else if (ev.key === 'ArrowRight') { next = current < 0 ? newest : Math.min(newest, current + 1); }
      else if (ev.key === 'Home') { next = 0; }
      else if (ev.key === 'End') { next = newest; }
      else if (ev.key === 'Escape') { hide(); return; }
      if (next === null) { return; }
      ev.preventDefault();
      show(next);
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-re-trend]'), function (root) {
    // The table runs newest first; the charts run oldest first.
    var rows = Array.prototype.slice.call(root.querySelectorAll('tr[data-month]')).reverse();
    if (!rows.length) { return; }
    Array.prototype.forEach.call(root.querySelectorAll('[data-re-plot]'), function (plot) {
      setUp(plot, rows);
    });
  });
})();
