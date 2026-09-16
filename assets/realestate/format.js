/* format.js — number parsing and display for the 부동산 calculators.
 *
 * Pure: no DOM, no storage, no network. Loaded first because both calc.js and
 * ui.js format money, and the page must agree with itself on what "5억 3천" is.
 */
(function (global) {
  'use strict';

  var UK = 100000000;   // 억
  var MAN = 10000;      // 만

  /* Parse a Korean money expression into won.
   *
   * Accepts what a person actually types into a property form: "5억3000만",
   * "5억 3,000만원", "530,000,000", "5.3억", "5억3천", "3천만", "8천5백".
   * Returns null for anything it cannot read, never 0 — a rejected input and a
   * genuine zero are different answers, and conflating them silently computes
   * tax on nothing.
   *
   * 천 and 백 mean 천만 and 백만 here, not 1,000 and 100. That is not a guess:
   * there is no field on this page where "3천" could plausibly mean 3,000 won,
   * and reading it literally produced the single worst failure this parser can
   * have — "5억3천" came out as 500,003,000, which echoes back as "5억 3,000원"
   * and differs from the intended "5억 3,000만원" by one character on screen
   * and by a factor of 10,000 in the result.
   *
   * The unit alternation lists 천만 / 백만 BEFORE 만, so the regex takes the
   * longest match. Written the other way, "3천만" consumes "3천" and then
   * strands "만", failing the completeness check below — which is exactly how
   * the most natural way to write 30,000,000 used to be rejected outright.
   */
  function parseWon(raw) {
    if (raw === null || raw === undefined) return null;
    var s = String(raw).replace(/[\s,]/g, '').replace(/원$/, '');
    if (!s) return null;

    // Plain number, the common case.
    if (/^\d+(\.\d+)?$/.test(s)) {
      var plain = Number(s);
      return isFinite(plain) ? plain : null;
    }

    // Unit form. Every chunk must be consumed, so "5억x" is rejected rather
    // than silently read as 5억.
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
    // 0 is returned as 0, the same as the plain-number path above. Folding it
    // to null here made "0" and "0만" disagree, and left the caller unable to
    // tell an unreadable field from one holding a deliberate zero.
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

  /* Group digits. Intl is used when present but is not required — the page has
   * to work with no network and on an old browser, and this is one line. */
  function comma(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var neg = n < 0;
    var s = String(Math.round(Math.abs(n)));
    s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s;
  }

  /* Render won the way a Korean reader scans it: "5억 3,000만원".
   *
   * The 억/만 split is not decoration. A bare "530,000,000원" forces the reader
   * to count digit groups to find out whether it is 5억 or 53억, which is the
   * single most consequential misreading this page can cause.
   */
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

  /* Percent with a fixed decimal count, for figures the page computed. */
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
