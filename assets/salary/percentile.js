/* percentile.js — the three calculators on /salary/percentile/.
 *
 * Reads the build-time model from #sa-pct-model and places one figure in it.
 * The pay curve is the one scripts/fetch_percentile_data.py fits (band_cdf,
 * share_above); change one and change the other. Nothing is stored or sent.
 */
(function () {
  'use strict';

  var island = document.getElementById('sa-pct-model');
  if (!island) return;
  var model;
  try {
    model = JSON.parse(island.textContent);
  } catch (e) {
    /* Inputs that answer nothing are worse than none: the tables below still hold the figures. */
    var sec = document.querySelector('.sa-calc-section');
    if (sec) sec.parentNode.removeChild(sec);
    return;
  }

  /* '5000', '8천', '1억 2천', '1.5억' → 만원. 천 after 억 means 천만, as it is said aloud.
     A bare number ending in 원 ('50,000,000원') is in 원, not 만원. A trailing '.' is
     a figure still being typed, not an error. */
  function parseMan(raw) {
    var s = String(raw).replace(/[,\s]/g, '').replace(/\u2212/g, '-');
    var inWon = /\d원$/.test(s);
    s = s.replace(/원$/, '').replace(/만$/, '').replace(/\.(?=억|천|$)/, '');
    var sign = 1;
    if (s.charAt(0) === '-') {
      sign = -1;
      s = s.slice(1);
    }
    if (!s) return null;
    var m = /^(?:(\d+(?:\.\d+)?)억)?(?:(\d+(?:\.\d+)?)(천)?)?$/.exec(s);
    if (!m || (m[1] === undefined && m[2] === undefined)) return null;
    var man = 0;
    if (m[1] !== undefined) man += parseFloat(m[1]) * 10000;
    if (m[2] !== undefined) man += parseFloat(m[2]) * (m[3] ? 1000 : 1);
    return isFinite(man) ? sign * man / (inWon ? 10000 : 1) : null;
  }

  function bandCdf(b, x) {
    if (x <= b.lo) return 0;
    if (b.hi !== null && x >= b.hi) return 1;
    if (b.kind === 'uniform') return (x - b.lo) / (b.hi - b.lo);
    var t = x / b.lo;
    if (b.kind === 'open') return 1 - Math.pow(t, -b.a);
    var r = b.hi / b.lo;
    if (Math.abs(b.a) < 1e-9) return Math.log(t) / Math.log(r);
    return (1 - Math.pow(t, -b.a)) / (1 - Math.pow(r, -b.a));
  }

  function payShareAbove(won) {
    var below = 0;
    for (var i = 0; i < model.bands.length; i++) below += model.bands[i].people * bandCdf(model.bands[i], won);
    return Math.max(0, (model.total - below) / model.total * 100);
  }

  function fmtPct(p) {
    if (p < 0.001) return '0.001% 미만';
    if (p >= 10) return p.toFixed(1) + '%';
    if (p >= 1) return p.toFixed(2) + '%';
    return p.toFixed(3) + '%';
  }

  function fmtPeople(n) {
    if (n >= 10000) return Math.round(n / 10000).toLocaleString('ko-KR') + '만 명';
    return Math.round(n).toLocaleString('ko-KR') + '명';
  }

  /* Deciles are joined by straight lines; outside P10–P90 there is nothing to read. */
  function decileTop(cuts, won) {
    if (won < cuts[0].won) return { below: true };
    var last = cuts[cuts.length - 1];
    if (won >= last.won) return { above: last.top };
    for (var i = 1; i < cuts.length; i++) {
      if (won < cuts[i].won) {
        var a = cuts[i - 1], b = cuts[i];
        var p = a.p + (b.p - a.p) * (won - a.won) / (b.won - a.won);
        return { top: 100 - p };
      }
    }
    return { above: last.top };
  }

  function answer(kind, man) {
    var won = man * 10000;
    if (kind === 'pay') {
      var share = payShareAbove(won);
      if (share >= 99.95) return '근로자 거의 모두가 이보다 많이 받습니다.';
      if (model.total * share / 100 < 1) return '상위 <b>0.001% 미만</b> · 이보다 많이 받는 근로자는 거의 없습니다.';
      return '상위 약 <b>' + fmtPct(share) + '</b> · 근로자 ' + fmtPeople(model.total * share / 100) +
        '이 이보다 많이 받습니다.';
    }
    var r = decileTop(model[kind], won);
    if (r.below) return '하위 10% 안쪽입니다. 그 아래는 조사가 경계를 공개하지 않습니다.';
    if (r.above) return '<b>상위 ' + r.above + '% 안쪽</b>입니다. 조사가 그보다 잘게 나누지 않습니다.';
    return '상위 약 <b>' + Math.max(1, Math.round(r.top)) + '%</b>입니다.';
  }

  Array.prototype.forEach.call(document.querySelectorAll('form[data-pct]'), function (form) {
    var kind = form.getAttribute('data-pct');
    var input = form.querySelector('input');
    var out = form.querySelector('output');
    function run() {
      var raw = input.value.trim();
      if (!raw) {
        out.innerHTML = '';
        return;
      }
      var man = parseMan(raw);
      if (man === null) {
        out.textContent = '숫자로 입력해 주세요. 예: 5000, 1억 2천';
        return;
      }
      out.innerHTML = answer(kind, man);
    }
    /* Debounced: the output is a live region, and announcing every keystroke reads out
       '1억', then '1억 2', then the answer. Enter answers at once. */
    var timer = null;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(run, 450);
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearTimeout(timer);
      run();
    });
  });
})();
