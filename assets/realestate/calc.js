/* calc.js — the four 부동산 calculators.
 * Pure: no DOM, no storage, no network; plain numbers in, plain objects out.
 *
 * Each statutory table carries its law and RATES_CHECKED, and the page prints
 * both beside the result. When a rate changes, edit the table and move
 * RATES_CHECKED — do not patch the arithmetic.
 */
(function (global) {
  'use strict';

  var RATES_CHECKED = '2026-08-04';

  /* Policy figures that move every few months live in
     _data/realestate_policy.yml and arrive via setPolicy(). These fallbacks only
     let the module run standalone (a test, a console); the page overrides them.
     Only the statutory tables (취득세, 중개보수) are hard-coded here. */
  var POLICY = {
    // Absolute lending ceiling, banded by house price. Empty = no ceiling.
    capTiers: [],
    stress: { capital: 3.0, non_capital: 0.75, "default": 1.5 },
    firstHome: { priceCap: 1200000000, reliefCap: 2000000 }
  };

  /* `upTo: null` is the open-ended top band, so tiers are walked in policy-file
     order rather than compared. */
  function capForPrice(price) {
    var tiers = POLICY.capTiers || [];
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i];
      if (t.upTo === null || t.upTo === undefined || price <= t.upTo) return t;
    }
    return null;
  }

  function setPolicy(p) {
    if (!p || typeof p !== 'object') return;
    // Validated field by field: a partial or renamed key must fall back, not NaN.
    var num = function (v, fallback) {
      var n = typeof v === 'number' ? v : parseFloat(v);
      return isFinite(n) && n >= 0 ? n : fallback;
    };
    if (Array.isArray(p.capTiers)) {
      var tiers = [];
      p.capTiers.forEach(function (t) {
        var amount = num(t && t.amount, 0);
        if (amount <= 0) return;                 // a band with no ceiling is noise
        tiers.push({
          // null (the open-ended top band) is kept, not coerced.
          upTo: (t.upTo === null || t.upTo === undefined) ? null : num(t.upTo, null),
          amount: amount,
          label: typeof t.label === 'string' ? t.label : ''
        });
      });
      if (tiers.length) POLICY.capTiers = tiers;
    }
    if (p.stress) {
      POLICY.stress.capital = num(p.stress.capital, POLICY.stress.capital);
      POLICY.stress.non_capital = num(p.stress.non_capital, POLICY.stress.non_capital);
      POLICY.stress['default'] = num(p.stress['default'], POLICY.stress['default']);
    }
    if (p.firstHome) {
      POLICY.firstHome.priceCap = num(p.firstHome.priceCap, POLICY.firstHome.priceCap);
      POLICY.firstHome.reliefCap = num(p.firstHome.reliefCap, POLICY.firstHome.reliefCap);
    }
  }

  /* 1. 취득세 (acquisition tax)
   * Local Tax Act (지방세법) 제11조 (유상취득 주택), 제13조의2 (다주택·법인 중과);
   * 지방교육세 = 지방세법 제151조, 농어촌특별세 = 농어촌특별세법 제5조.
   * Covers a paid purchase (매매) of a home only: 상속·증여·신축·오피스텔 are
   * taxed under a different scheme.
   */

  var ACQ_BASIS = '지방세법 제11조 · 제13조의2, 지방교육세 · 농어촌특별세 포함';

  /* 6억~9억 is a continuous function, not steps: rate(%) = 취득가액(억) × 2 ÷ 3 − 3.
   * A stepped approximation is off by millions of won at the band edges. */
  function standardRate(priceWon) {
    var uk = priceWon / 100000000;
    if (uk <= 6) return 1;
    if (uk >= 9) return 3;
    return Math.round((uk * 2 / 3 - 3) * 100) / 100;
  }

  /* 중과세율 (surcharge rate). houses = homes held after the purchase,
   * the one being bought included. */
  function heavyRate(houses, regulated) {
    if (houses <= 1) return null;
    if (houses === 2) return regulated ? 8 : null;   // 2 homes outside 조정대상지역: standard rate
    if (houses === 3) return regulated ? 12 : 8;
    return 12;                                       // 4+ homes: regardless of region
  }

  /* 표준세율: 지방교육세 = 취득세율 × 1/2 × 20%, 농특세 = 0.2% (over 85㎡).
   * 중과세율: 지방교육세 fixed at 0.4%; 농특세 0.6% at the 8% rate, 1.0% at 12%.
   * 국민주택규모 (85㎡ or less) is exempt from 농특세, the only reason area is asked. */
  function surtaxRates(acqRate, isHeavy, over85) {
    var edu = isHeavy ? 0.4 : Math.round(acqRate * 0.5 * 0.2 * 100) / 100;
    var rural = 0;
    if (over85) {
      if (!isHeavy) rural = 0.2;
      else rural = acqRate >= 12 ? 1.0 : 0.6;
    }
    return { edu: edu, rural: rural };
  }

  /**
   * @param {number} price   취득가액 (purchase price, won)
   * @param {number} houses  homes held after the purchase (1 = a first home)
   * @param {boolean} regulated inside a 조정대상지역 (regulated area)
   * @param {boolean} over85 전용면적 (exclusive area) over 85㎡
   */
  function acquisitionTax(price, houses, regulated, over85, firstHome) {
    if (!isFinite(price) || price <= 0) return null;
    var h = heavyRate(houses, regulated);
    var isHeavy = h !== null;
    var acqRate = isHeavy ? h : standardRate(price);
    var sur = surtaxRates(acqRate, isHeavy, over85);

    var acq = price * acqRate / 100;
    var edu = price * sur.edu / 100;
    var rural = price * sur.rural / 100;

    /* 생애최초 감면 (지방세특례제한법 제36조의3). Applied to the 취득세 alone and
       capped at it, so it never takes the tax below zero. */
    var relief = 0;
    if (firstHome && !isHeavy && price <= POLICY.firstHome.priceCap) {
      relief = Math.min(POLICY.firstHome.reliefCap, acq);
    }

    return {
      basis: ACQ_BASIS,
      checked: RATES_CHECKED,
      heavy: isHeavy,
      over85: over85,
      firstHome: !!firstHome,
      relief: relief,
      // Why a ticked first-home box changed nothing.
      reliefBlocked: firstHome && relief === 0
        ? (isHeavy ? 'heavy' : (price > POLICY.firstHome.priceCap ? 'price' : null))
        : null,
      reliefPriceCap: POLICY.firstHome.priceCap,
      rates: { acq: acqRate, edu: sur.edu, rural: sur.rural,
               total: Math.round((acqRate + sur.edu + sur.rural) * 100) / 100 },
      amounts: { acq: acq, edu: edu, rural: rural },
      total: acq + edu + rural - relief,
      // In the 6~9억 progressive band, explain why the rate is neither 1% nor 3%.
      progressive: !isHeavy && price > 6e8 && price < 9e8
    };
  }

  /* 2. 대출한도 (loan limit: LTV · DSR, 은행업감독규정)
   * Show both limits and say which one binds, so the reader sees which lever to move.
   */

  var LOAN_BASIS = '은행업감독규정 LTV · DSR (스트레스 금리는 사용자 입력)';

  /* Each schedule returns the FIRST YEAR's payment, because that is what DSR
     consumes: highest for 원금균등, lowest for 체증식. 체증식's real schedule is
     set by the product (보금자리론), hence the growth rate is an input. */

  function monthsOf(years) { return Math.max(1, Math.round(years * 12)); }

  /* 원리금균등 */
  function annualLevel(principal, ratePct, years) {
    var n = monthsOf(years), r = ratePct / 100 / 12;
    if (r === 0) return principal / years;
    return principal * r / (1 - Math.pow(1 + r, -n)) * 12;
  }

  /* 원금균등, first 12 months: principal 12 × P/n, interest
     r × P × (12 − (0+1+…+11)/n) over the falling balance. */
  function annualEqualPrincipal(principal, ratePct, years) {
    var n = monthsOf(years), r = ratePct / 100 / 12;
    var months = Math.min(12, n);
    var k = months * (months - 1) / 2;
    return principal * (months / n + r * (months - k / n));
  }

  /* 체증식: payments grow `growthPct` a year and still clear the same debt. */
  function annualGraduated(principal, ratePct, years, growthPct) {
    var g = (growthPct || 0) / 100;
    if (g <= 0) return annualLevel(principal, ratePct, years);
    var yrs = Math.max(1, Math.round(years));
    var r = ratePct / 100;
    // Present value of a payment stream growing at g, discounted at r. The
    // first-year payment is whatever makes that equal the principal.
    var pv = 0;
    for (var t = 1; t <= yrs; t++) {
      pv += Math.pow(1 + g, t - 1) / Math.pow(1 + r, t);
    }
    return pv > 0 ? principal / pv : annualLevel(principal, ratePct, years);
  }

  var SCHEDULES = {
    level: { label: '원리금균등', fn: annualLevel,
             note: '매달 같은 금액을 갚습니다. 첫해와 마지막 해의 상환액이 같습니다.' },
    principal: { label: '원금균등', fn: annualEqualPrincipal,
             note: '원금을 균등하게 나누고 이자는 남은 잔액에만 붙어, 첫해가 가장 무겁고 갈수록 줄어듭니다. DSR은 그 첫해로 재므로 한도가 가장 작게 나옵니다.' },
    graduated: { label: '체증식', fn: annualGraduated,
             note: '처음엔 적게, 뒤로 갈수록 많이 갚습니다. 첫해가 가장 가벼워 한도는 크게 나오지만, 보금자리론 등 일부 상품에만 있고 실제 심사 기준은 상품마다 다릅니다.' }
  };

  function annualPayment(principal, ratePct, years, method, growthPct) {
    if (!isFinite(principal) || principal <= 0) return 0;
    var s = SCHEDULES[method] || SCHEDULES.level;
    return s.fn(principal, ratePct, years, growthPct);
  }

  /* Every schedule is linear in the principal, so one division inverts all three. */
  function principalFromAnnual(capacity, ratePct, years, method, growthPct) {
    if (!isFinite(capacity) || capacity <= 0) return 0;
    var unit = annualPayment(1e8, ratePct, years, method, growthPct);
    return unit > 0 ? capacity / unit * 1e8 : 0;
  }

  /**
   * @param {object} o
   * @param {number} o.price        house price (won)
   * @param {number} o.ltvPct       LTV ratio (%)
   * @param {number} o.income       annual income (won)
   * @param {number} o.dsrPct       DSR limit (%)
   * @param {number} o.existing     annual 원리금 (principal + interest) on existing loans (won)
   * @param {number} o.ratePct      loan interest rate (%)
   * @param {number} o.stressPct    스트레스 가산금리 (stress add-on, %p), DSR only
   * @param {number} o.years        term (years)
   * @param {boolean} [o.capital]   inside 수도권·규제지역: applies the price-banded lending cap
   * @param {number} [o.hardCap]    explicit cap (won); if absent, decided by o.capital
   */
  function loanLimit(o) {
    if (!isFinite(o.price) || o.price <= 0) return null;
    if (!isFinite(o.income) || o.income <= 0) return null;

    var ltvLimit = o.price * o.ltvPct / 100;

    // The stress add-on applies to the limit only; actual payments use the contract rate.
    var method = SCHEDULES[o.method] ? o.method : 'level';
    var growth = o.growthPct;
    var stressRate = o.ratePct + (o.stressPct || 0);
    var capacity = o.income * o.dsrPct / 100 - (o.existing || 0);
    var dsrLimit = capacity <= 0 ? 0
      : principalFromAnnual(capacity, stressRate, o.years, method, growth);

    var limits = [
      { key: 'ltv', label: 'LTV', value: ltvLimit },
      { key: 'dsr', label: 'DSR', value: dsrLimit }
    ];
    /* The absolute ceiling, BANDED by house price since the 10.15 대책; it binds
       before LTV and DSR on most 수도권 purchases. */
    var tier = o.capital ? capForPrice(o.price) : null;
    var cap = isFinite(o.hardCap) && o.hardCap > 0 ? o.hardCap
            : (tier ? tier.amount : 0);
    if (cap > 0) {
      limits.push({
        key: 'cap',
        label: '규제지역 한도',
        value: cap,
        band: tier ? tier.label : null
      });
    }

    var binding = limits[0];
    for (var i = 1; i < limits.length; i++) {
      if (limits[i].value < binding.value) binding = limits[i];
    }

    var actualAnnual = annualPayment(binding.value, o.ratePct, o.years, method, growth);
    return {
      basis: LOAN_BASIS,
      checked: RATES_CHECKED,
      method: method,
      methodLabel: SCHEDULES[method].label,
      methodNote: SCHEDULES[method].note,
      limits: limits,
      binding: binding,
      amount: binding.value,
      stressRate: stressRate,
      monthly: actualAnnual / 12,
      annual: actualAnnual,
      dsrActual: o.income > 0
        ? (actualAnnual + (o.existing || 0)) / o.income * 100 : null,
      capacityExhausted: capacity <= 0
    };
  }

  /* 3. 전세 ↔ 월세 전환 — Housing Lease Protection Act (주택임대차보호법) 제7조의2.
   * Legal cap = min(10% a year, 기준금리 + 2%p), using the dashboard's 기준금리.
   */

  var RENT_BASIS = '주택임대차보호법 제7조의2 · 시행령 제9조';

  function legalCapRate(baseRatePct) {
    if (!isFinite(baseRatePct)) return null;
    return Math.min(10, baseRatePct + 2);
  }

  /** 전세 → 월세. deposit: 전세보증금, keep: deposit left after conversion. */
  function jeonseToMonthly(deposit, keep, ratePct) {
    if (!isFinite(deposit) || deposit <= 0) return null;
    if (!isFinite(ratePct) || ratePct <= 0) return null;
    var k = isFinite(keep) && keep > 0 ? keep : 0;
    if (k >= deposit) return { error: 'keep-too-large' };
    var converted = deposit - k;
    return {
      basis: RENT_BASIS,
      direction: 'to-monthly',
      converted: converted,
      deposit: k,
      monthly: converted * (ratePct / 100) / 12,
      rate: ratePct
    };
  }

  /** 월세 → 전세. */
  function monthlyToJeonse(deposit, monthly, ratePct) {
    if (!isFinite(monthly) || monthly <= 0) return null;
    if (!isFinite(ratePct) || ratePct <= 0) return null;
    var d = isFinite(deposit) && deposit > 0 ? deposit : 0;
    var converted = monthly * 12 / (ratePct / 100);
    return {
      basis: RENT_BASIS,
      direction: 'to-jeonse',
      converted: converted,
      deposit: d,
      jeonse: d + converted,
      rate: ratePct
    };
  }

  /* 4. 중개보수 (brokerage fee) — 공인중개사법 시행규칙 별표1 (2021.10.19 개정) 상한요율.
   * A ceiling, not the actual fee: it is negotiated and 시·도 조례 may vary it.
   */

  var FEE_BASIS = '공인중개사법 시행규칙 별표1 (2021.10.19 개정) 상한요율';

  // [upper bound (won, exclusive), rate (%), fee cap (won) | null]
  var FEE_SALE = [
    [50000000,   0.6, 250000],
    [200000000,  0.5, 800000],
    [900000000,  0.4, null],
    [1200000000, 0.5, null],
    [1500000000, 0.6, null],
    [Infinity,   0.7, null]
  ];
  var FEE_LEASE = [
    [50000000,   0.5, 200000],
    [100000000,  0.4, 300000],
    [600000000,  0.3, null],
    [1200000000, 0.4, null],
    [1500000000, 0.5, null],
    [Infinity,   0.6, null]
  ];

  /* 월세 거래금액 = 보증금 + 월차임 × 100, recomputed with × 70 when under 5천만원.
   * Skipping that overstates the cap on low-deposit contracts. */
  function leaseTradeValue(deposit, monthly) {
    var d = isFinite(deposit) && deposit > 0 ? deposit : 0;
    var m = isFinite(monthly) && monthly > 0 ? monthly : 0;
    if (m === 0) return d;
    var v = d + m * 100;
    if (v < 50000000) v = d + m * 70;
    return v;
  }

  /**
   * @param {number} value 거래금액 (transaction value, won); for 월세, the leaseTradeValue result
   * @param {string} kind  'sale' | 'lease'
   */
  function agentFee(value, kind) {
    if (!isFinite(value) || value <= 0) return null;
    var table = kind === 'lease' ? FEE_LEASE : FEE_SALE;
    var band = null;
    for (var i = 0; i < table.length; i++) {
      if (value < table[i][0]) { band = table[i]; break; }
    }
    if (!band) band = table[table.length - 1];

    var raw = value * band[1] / 100;
    var capped = band[2] !== null && raw > band[2];
    var fee = capped ? band[2] : raw;
    return {
      basis: FEE_BASIS,
      checked: RATES_CHECKED,
      kind: kind,
      value: value,
      rate: band[1],
      cap: band[2],
      capped: capped,
      fee: fee,
      vat: fee * 0.1        // For a 일반과세자 broker; 간이과세 differs.
    };
  }

  global.RECalc = {
    RATES_CHECKED: RATES_CHECKED,
    setPolicy: setPolicy,
    policy: POLICY,
    capForPrice: capForPrice,
    SCHEDULES: SCHEDULES,
    standardRate: standardRate,
    acquisitionTax: acquisitionTax,
    annualPayment: annualPayment,
    principalFromAnnual: principalFromAnnual,
    loanLimit: loanLimit,
    legalCapRate: legalCapRate,
    jeonseToMonthly: jeonseToMonthly,
    monthlyToJeonse: monthlyToJeonse,
    leaseTradeValue: leaseTradeValue,
    agentFee: agentFee
  };
})(window);
