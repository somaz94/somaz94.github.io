/* format.js — number parsing and display for the 부동산 calculators.
 * Pure: no DOM, no storage, no network. Loaded before calc.js and ui.js.
 */
(function (global) {
  'use strict';

  var UK = 100000000;   // 억
  var MAN = 10000;      // 만

  /* Parse a Korean money expression ("5억 3,000만원", "5.3억", "3천만") into won.
   * Returns null for anything unreadable, never 0: a rejected input is not a zero.
   *
   * 천 and 백 mean 천만 and 백만: read literally, "5억3천" became 500,003,000.
   * The alternation lists 천만 / 백만 BEFORE 만 so the regex takes the longest
   * match; the other way, "3천만" consumes "3천" and strands "만".
   */
  function parseWon(raw) {
    if (raw === null || raw === undefined) return null;
    var s = String(raw).replace(/[\s,]/g, '').replace(/원$/, '');
    if (!s) return null;

    if (/^\d+(\.\d+)?$/.test(s)) {
      var plain = Number(s);
      return isFinite(plain) ? plain : null;
    }

    // Every chunk must be consumed, so "5억x" is rejected rather than read as 5억.
    var total = 0;
    var matched = 0;
    var re = /(\d+(?:\.\d+)?)(억|천만|백만|만|천|백)?/g;
    var m;
    while ((m = re.exec(s)) !== null) {
      if (m[0] === '') break;
      var n = Number(m[1]);
      if (!isFinite(n)) return null;
      var unit = m[2];
      if (unit === '억') total += n * UK;
      else if (unit === '천만' || unit === '천') total += n * 1000 * MAN;
      else if (unit === '백만' || unit === '백') total += n * 100 * MAN;
      else if (unit === '만') total += n * MAN;
      else total += n;
      matched += m[0].length;
    }
    if (matched !== s.length) return null;
    // 0 stays 0, as in the plain path; null here made "0" and "0만" disagree.
    return total;
  }

  /* Parse a percent. "3.5", "3.5%", "0.035" is NOT accepted as 3.5% —
   * guessing between a ratio and a percent is how a 40% DSR becomes 0.4%. */
  function parsePercent(raw) {
    if (raw === null || raw === undefined) return null;
    var s = String(raw).replace(/[\s,%]/g, '');
    if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
    var v = Number(s);
    return isFinite(v) ? v : null;
  }

  function parseInt10(raw) {
    if (raw === null || raw === undefined) return null;
    var s = String(raw).replace(/[\s,]/g, '');
    if (!s || !/^\d+$/.test(s)) return null;
    var v = parseInt(s, 10);
    return isFinite(v) ? v : null;
  }

  /* Group digits by regex rather than toLocaleString, which follows the browser
   * locale, not the document's. */
  function comma(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var neg = n < 0;
    var s = String(Math.round(Math.abs(n)));
    s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s;
  }

  /* Render won as "5억 3,000만원": a bare "530,000,000원" makes the reader count
   * digit groups to tell 5억 from 53억. */
  function won(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var neg = n < 0;
    var v = Math.round(Math.abs(n));
    if (v === 0) return '0원';

    var uk = Math.floor(v / UK);
    var rest = v - uk * UK;
    var man = Math.floor(rest / MAN);
    var one = rest - man * MAN;

    var parts = [];
    if (uk) parts.push(comma(uk) + '억');
    if (man) parts.push(comma(man) + '만');
    if (one) parts.push(comma(one));
    return (neg ? '-' : '') + parts.join(' ') + '원';
  }

  function pct(v, decimals) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    var d = decimals === undefined ? 2 : decimals;
    return v.toFixed(d) + '%';
  }

  global.REFormat = {
    UK: UK,
    MAN: MAN,
    parseWon: parseWon,
    parsePercent: parsePercent,
    parseInt10: parseInt10,
    comma: comma,
    won: won,
    pct: pct
  };
})(window);
