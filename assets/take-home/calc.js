/* calc.js — 연봉 실수령액 계산. Pure: no DOM, no storage, no network.
 *
 * Every rate arrives through setPolicy() from _data/take_home_policy.yml and the
 * 간이세액표 grid from _data/take_home_tax_table.json. There are deliberately no
 * fallback rates: a stale constant computes a pay slip that looks right.
 *
 * All money is integer 원 and every rate is an exact fraction (see dec()), because
 * each premium is floored to 10원 and a float product one ulp under a multiple of
 * 10 floors to the wrong figure.
 */
(function (global) {
  'use strict';

  var POLICY = null;
  var TABLE = null;
  var FAMILY_COLUMNS = 11;
  var TABLE_CAP = 10000000; // 별표 2: the grid ends at 10,000천원; above it is a formula
  // Monthly pay must stay under 1조원: the largest product below (pay × 98 × 45) then
  // stays under 2^53, where integer arithmetic is still exact.
  var MAX_MONTHLY = 1e12;

  /* "3.595" → {n: 3595, d: 1000}. Only plain decimals: anything else is refused. */
  function dec(s) {
    if (typeof s !== 'string' || !/^\d+(\.\d+)?$/.test(s)) return null;
    var dot = s.indexOf('.');
    var places = dot < 0 ? 0 : s.length - dot - 1;
    return { n: parseInt(s.replace('.', ''), 10), d: Math.pow(10, places) };
  }

  /* floor(a / b) for non-negative integers, without a float division that can round up to b's multiple. */
  function floorDiv(a, b) { return (a - (a % b)) / b; }
  function floor10(x) { return floorDiv(x, 10) * 10; }
  /* floor(x × pct%) for an integer x and a dec() percent. */
  function pctOf(x, p) { return floorDiv(x * p.n, p.d * 100); }

  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0; }

  function readPeriod(p) {
    if (!p || typeof p.key !== 'string' || typeof p.label !== 'string') return null;
    var pe = p.pension, he = p.health, lt = p.long_term_care, em = p.employment;
    if (!pe || !he || !lt || !em) return null;
    var out = {
      key: p.key, label: p.label, note: typeof p.note === 'string' ? p.note : '',
      pension: { rate: dec(pe.rate_pct), min: pe.base_min, max: pe.base_max },
      health: { rate: dec(he.rate_pct), min: he.premium_min, max: he.premium_max },
      ltc: { num: dec(lt.income_pct), den: dec(lt.health_pct) },
      employment: { rate: dec(em.rate_pct) }
    };
    if (!out.pension.rate || !out.health.rate || !out.ltc.num || !out.ltc.den || !out.employment.rate) return null;
    if (!isInt(pe.base_min) || !isInt(pe.base_max) || pe.base_min > pe.base_max) return null;
    if (!isInt(he.premium_min) || !isInt(he.premium_max) || he.premium_min > he.premium_max) return null;
    if (out.ltc.den.n === 0) return null;
    return out;
  }

  function readTax(t) {
    if (!t || !Array.isArray(t.above_cap) || !Array.isArray(t.ratios)) return null;
    if (!isInt(t.child_one) || !isInt(t.child_two) || !isInt(t.child_each_more)) return null;
    var above = [];
    for (var i = 0; i < t.above_cap.length; i++) {
      var r = t.above_cap[i];
      var row = r && { over: r.over, add: r.add, factor: dec(r.factor_pct), rate: dec(r.rate_pct) };
      if (!row || !isInt(row.over) || row.over < TABLE_CAP || !isInt(row.add) || !row.factor || !row.rate) return null;
      above.push(row);
    }
    // Tried from the top, so the list must run from the highest threshold down.
    for (var j = 1; j < above.length; j++) if (above[j].over >= above[j - 1].over) return null;
    if (!above.length || above[above.length - 1].over !== TABLE_CAP) return null;
    var ratios = t.ratios.filter(isInt);
    if (ratios.length !== t.ratios.length || ratios.indexOf(100) < 0) return null;
    return { childOne: t.child_one, childTwo: t.child_two, childMore: t.child_each_more, above: above, ratios: ratios };
  }

  function readTable(tb) {
    if (!tb || !Array.isArray(tb.rows) || !tb.rows.length || !Array.isArray(tb.at_10000)) return null;
    if (tb.at_10000.length !== FAMILY_COLUMNS || !tb.at_10000.every(isInt)) return null;
    for (var i = 0; i < tb.rows.length; i++) {
      var r = tb.rows[i];
      if (!Array.isArray(r) || r.length !== FAMILY_COLUMNS + 2 || !r.every(isInt)) return null;
      if (i && tb.rows[i - 1][1] !== r[0]) return null;
    }
    if (tb.rows[tb.rows.length - 1][1] * 1000 !== TABLE_CAP) return null;
    return { rows: tb.rows, atCap: tb.at_10000, source: typeof tb.source === 'string' ? tb.source : '' };
  }

  /* Validates field by field; returns true only when every number the arithmetic reads is present. */
  function setPolicy(p, table) {
    POLICY = null;
    TABLE = null;
    if (!p || !Array.isArray(p.periods) || !p.periods.length) return false;
    var periods = p.periods.map(readPeriod);
    if (periods.some(function (x) { return !x; })) return false;
    var tax = readTax(p.income_tax);
    var local = p.local_tax && dec(p.local_tax.rate_pct);
    var tb = readTable(table);
    if (!tax || !local || !tb) return false;
    POLICY = { periods: periods, tax: tax, local: local };
    TABLE = tb;
    return true;
  }

  function periods() { return POLICY ? POLICY.periods.slice() : []; }

  /* 원천징수 대상 월급여 from the reader's input; null when the amount is unusable. */
  function monthlyPay(mode, amount) {
    if (!Number.isSafeInteger(amount) || amount <= 0) return null;
    var m = mode === 'annual' ? floorDiv(amount, 12) : amount;
    return m > 0 && m < MAX_MONTHLY ? m : null;
  }

  /* Four employee premiums on the monthly pay net of 비과세. */
  function insurance(taxable, period) {
    var pe = period.pension;
    var base = Math.min(Math.max(floorDiv(taxable, 1000) * 1000, pe.min), pe.max);
    var pension = floor10(pctOf(base, pe.rate));
    var health = Math.min(Math.max(floor10(pctOf(taxable, period.health.rate)), period.health.min), period.health.max);
    // health × (income% ÷ health%), as one fraction so the ratio is never rounded first.
    var l = period.ltc;
    var ltc = floor10(floorDiv(health * l.num.n * l.den.d, l.num.d * l.den.n));
    var employment = floor10(pctOf(taxable, period.employment.rate));
    return { pension: pension, health: health, long_term_care: ltc, employment: employment, pension_base: base };
  }

  /* 별표 2 제4호: beyond 11 family members, keep subtracting the 10→11 step. */
  function column(values, family) {
    if (family <= FAMILY_COLUMNS) return values[family - 1];
    var v11 = values[FAMILY_COLUMNS - 1];
    var step = values[FAMILY_COLUMNS - 2] - v11;
    return Math.max(0, v11 - step * (family - FAMILY_COLUMNS));
  }

  /* The table amount before 자녀 공제 and the 80/100/120% election. */
  function tableTax(taxable, family) {
    var rows = TABLE.rows;
    if (taxable < rows[0][0] * 1000) return 0;
    if (taxable === TABLE_CAP) return column(TABLE.atCap, family);
    if (taxable > TABLE_CAP) {
      var above = POLICY.tax.above;
      for (var i = 0; i < above.length; i++) {
        var a = above[i];
        if (taxable > a.over) {
          var part = floorDiv((taxable - a.over) * a.factor.n * a.rate.n, a.factor.d * a.rate.d * 10000);
          return column(TABLE.atCap, family) + a.add + part;
        }
      }
    }
    var lo = 0, hi = rows.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (rows[mid][0] * 1000 <= taxable) lo = mid; else hi = mid - 1;
    }
    return column(rows[lo].slice(2), family);
  }

  /* 별표 2 제3호 amount for this many 8세 이상 20세 이하 children. */
  function childCredit(children) {
    var t = POLICY.tax;
    if (children <= 0) return 0;
    if (children === 1) return t.childOne;
    return t.childTwo + t.childMore * (children - 2);
  }

  function incomeTax(taxable, family, children, ratio) {
    var table = tableTax(taxable, family);
    var afterChild = Math.max(0, table - childCredit(children));
    return { table: table, child: table - afterChild, amount: floor10(floorDiv(afterChild * ratio, 100)) };
  }

  /* One period's breakdown, or null when an input is out of range. */
  function compute(input, period) {
    if (!POLICY) return null;
    var gross = monthlyPay(input.mode, input.amount);
    if (gross === null) return null;
    var family = input.family, children = input.children;
    if (!isInt(family) || family < 1 || !isInt(children) || children > family - 1) return null;
    if (POLICY.tax.ratios.indexOf(input.ratio) < 0) return null;
    if (!isInt(input.nontax)) return null;
    var nontax = Math.min(input.nontax, gross);
    var taxable = gross - nontax;
    var ins = insurance(taxable, period);
    var it = incomeTax(taxable, family, children, input.ratio);
    var local = floor10(floorDiv(it.amount * POLICY.local.n, POLICY.local.d * 100));
    var total = ins.pension + ins.health + ins.long_term_care + ins.employment + it.amount + local;
    return {
      period: period.key,
      gross: gross, nontax: nontax, taxable: taxable,
      pension: ins.pension, pension_base: ins.pension_base,
      health: ins.health, long_term_care: ins.long_term_care, employment: ins.employment,
      income_tax: it.amount, income_tax_table: it.table, child_credit: it.child,
      local_tax: local,
      total: total, net: gross - total, net_annual: (gross - total) * 12
    };
  }

  /* Accepts "42000000", "4,200만", "4200만원", "4억 2천". `천`/`백` mean 천만/백만, as on
     /realestate/: written after 억 that is what a reader means, and the unit alternation
     lists 천만/백만 before 만 so "3천만" is not read as "3천" + a stray 만. A decimal
     needs a unit: "4200.5" with none is refused rather than rounded to a guess. */
  function parseWon(raw) {
    var s = String(raw == null ? '' : raw).replace(/[\s,]/g, '').replace(/원$/, '');
    if (!s) return null;
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    var re = /(\d+(?:\.\d+)?)(억|천만|백만|만|천|백)?/g;
    var units = { '억': 1e8, '천만': 1e7, '천': 1e7, '백만': 1e6, '백': 1e6, '만': 1e4 };
    var total = 0, matched = 0, m;
    while ((m = re.exec(s)) !== null) {
      if (m[0] === '') break;
      if (!m[2] && m[1].indexOf('.') >= 0) return null;
      total += parseFloat(m[1]) * (m[2] ? units[m[2]] : 1);
      matched += m[0].length;
    }
    if (matched !== s.length || !isFinite(total)) return null;
    return Math.round(total);
  }

  /* The amount field is in 만원, so a phone's number pad can type every value.
     "4,200" → 42,000,000, "4200.5" → 42,005,000; a fifth decimal, below 1원, is refused. */
  function parseManwon(raw) {
    var s = String(raw == null ? '' : raw).replace(/[\s,]/g, '');
    var m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(s);
    if (!m) return null;
    var won = parseInt(m[1], 10) * 10000 + (m[2] ? parseInt((m[2] + '000').slice(0, 4), 10) : 0);
    return Number.isSafeInteger(won) ? won : null;
  }

  global.THCalc = {
    setPolicy: setPolicy,
    periods: periods,
    monthlyPay: monthlyPay,
    compute: compute,
    parseWon: parseWon,
    parseManwon: parseManwon,
    // Exposed for tests: the table lookup alone, before 자녀 공제 and the election.
    tableTax: function (taxable, family) { return POLICY ? tableTax(taxable, family) : null; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
