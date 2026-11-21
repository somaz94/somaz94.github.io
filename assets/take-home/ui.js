/* ui.js — the only file that touches the DOM. Nothing is stored or sent. */
(function () {
  'use strict';

  var C = window.THCalc;
  var form = document.getElementById('th-form');
  var status = document.getElementById('th-status');
  var result = document.getElementById('th-result');
  if (!form || !status || !result) return;
  if (!C) {
    status.textContent = '계산 스크립트를 불러오지 못했습니다.';
    return;
  }

  function island(id) {
    var el = document.getElementById(id);
    try { return el ? JSON.parse(el.textContent) : null; } catch (e) { return null; }
  }

  if (!C.setPolicy(island('th-policy'), island('th-table'))) {
    status.textContent = '요율 값을 읽지 못해 계산기를 열지 않았습니다.';
    return;
  }
  form.hidden = false;

  var periods = C.periods();
  // By id, not `form.<name>`: `form.children` is the element's child list, not the input.
  var f = {
    amount: document.getElementById('th-amount'),
    nontax: document.getElementById('th-nontax'),
    family: document.getElementById('th-family'),
    children: document.getElementById('th-children'),
    ratio: document.getElementById('th-ratio')
  };
  var echo = document.getElementById('th-amount-echo');
  var delta = document.getElementById('th-delta');
  var childNote = document.getElementById('th-child-note');
  var cells = result.querySelectorAll('[data-out]');
  var tiles = result.querySelectorAll('[data-tile]');
  var last = null;

  function won(n) { return n.toLocaleString('ko-KR'); }

  /* A blank or non-integer count is not "1": it leaves the result empty instead. */
  function count(input) {
    var s = input.value.trim();
    return /^\d+$/.test(s) ? parseInt(s, 10) : null;
  }

  function read() {
    var m = form.querySelector('input[name="mode"]:checked');
    return {
      mode: m ? m.value : 'annual',
      amount: C.parseManwon(f.amount.value),
      nontax: f.nontax.value.trim() === '' ? 0 : C.parseWon(f.nontax.value),
      family: count(f.family),
      children: count(f.children),
      ratio: parseInt(f.ratio.value, 10)
    };
  }

  /* Why there is no result, in one sentence; '' when the input is simply empty. */
  function problem(input) {
    if (f.amount.value.trim() === '') return '';
    if (C.monthlyPay(input.mode, input.amount) === null) {
      return '금액을 읽지 못했습니다. 만원 단위 숫자로 넣어 주세요(예: 4200). 월 1조원 미만까지 계산합니다.';
    }
    if (input.nontax === null) return '비과세액을 읽지 못했습니다. 200000이나 20만처럼 넣어 주세요.';
    if (input.family === null || input.family < 1) return '공제대상 가족 수는 본인을 포함해 1명 이상입니다.';
    if (input.children === null) return '자녀 수를 숫자로 넣어 주세요.';
    if (input.children > input.family - 1) return '자녀 수는 공제대상 가족 수에서 본인을 뺀 수보다 많을 수 없습니다.';
    return '계산할 수 없는 값입니다.';
  }

  function showEcho(input) {
    var m = C.monthlyPay(input.mode, input.amount);
    if (m === null) { echo.textContent = ''; return; }
    echo.textContent = input.mode === 'annual'
      ? '연 ' + won(input.amount) + '원 · 월 ' + won(m) + '원'
      : '월 ' + won(m) + '원 · 연 ' + won(m * 12) + '원';
  }

  function hide() {
    result.hidden = true;
    last = null;
  }

  /* Renders; returns '' or an error sentence when there is no result, null when there is. */
  function render() {
    var input = read();
    showEcho(input);
    f.children.max = String(Math.max(0, (input.family || 1) - 1));
    var rows = periods.map(function (p) { return C.compute(input, p); });
    if (!rows[0]) { hide(); return problem(input); }
    // A pay below the 국민연금 floor still owes the floor's premium; a negative net
    // almost always means 원 typed into a 만원 field, so say that instead of printing it.
    if (rows[0].net < 0) { hide(); return '공제액이 급여보다 많습니다. 금액은 만원 단위입니다(연봉 4,200만원이면 4200).'; }
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      c.textContent = won(rows[+c.getAttribute('data-col')][c.getAttribute('data-out')]);
    }
    for (var j = 0; j < tiles.length; j++) {
      tiles[j].textContent = won(rows[0][tiles[j].getAttribute('data-tile')]);
    }
    // One line per later period: what changes when its rates take over.
    var deltas = [];
    for (var k = 1; k < rows.length; k++) {
      var d = rows[k].net - rows[0].net;
      if (d !== 0) deltas.push(periods[k].label + ': 월 ' + won(Math.abs(d)) + '원 ' + (d < 0 ? '감소' : '증가'));
    }
    delta.textContent = deltas.join(' · ');
    delta.hidden = !deltas.length;
    childNote.hidden = rows[0].child_credit === 0;
    childNote.textContent = rows[0].child_credit
      ? '근로소득세는 간이세액표 금액 ' + won(rows[0].income_tax_table) + '원에서 자녀 공제 ' + won(rows[0].child_credit) + '원을 뺀 뒤 원천징수 비율을 곱한 값입니다.'
      : '';
    result.hidden = false;
    last = rows[0];
    return null;
  }

  /* Errors are shown at once; a result is announced on commit, not per keystroke. */
  function onInput(e) {
    // A Hangul syllable mid-composition ("20ㅁ") is not the reader's input yet.
    if (e && e.isComposing) return;
    status.textContent = render() || '';
  }
  form.addEventListener('input', onInput);
  form.addEventListener('compositionend', function () { onInput(); });
  form.addEventListener('change', function () {
    var msg = render();
    status.textContent = msg !== null ? msg : '월 실수령액 ' + won(last.net) + '원';
  });

  render();
})();
