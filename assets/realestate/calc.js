/* calc.js — the four 부동산 calculators.
 *
 * Pure: no DOM, no storage, no network. Every function takes plain numbers and
 * returns a plain object, so a rate table can be checked without a page around
 * it. ui.js is the only file that reads an input or writes a result.
 *
 * On the rate tables below: they are statutory, they change, and a wrong figure
 * here is worse than no calculator at all. Each table therefore carries the law
 * it comes from and the date it was last checked, and the page prints both next
 * to the result rather than burying them in a footnote. When a rate changes,
 * edit the table and move RATES_CHECKED — do not patch the arithmetic.
 */
(function (global) {
  'use strict';

  var RATES_CHECKED = '2026-08-04';

  /* Policy figures that change every few months — loan ceilings, stress rates,
     which districts are 조정대상지역, the 생애최초 relief — live in
     _data/realestate_policy.yml and reach this file through a build-time JSON
     island that ui.js hands over. They are NOT duplicated here.

     The fallbacks below exist only so the module is usable on its own (a test,
     a console); the page always overrides them. They are marked stale on
     purpose: if a fallback ever reaches a reader it should be obvious that the
     wiring broke, not quietly plausible.

     What stays hard-coded in this file is the STATUTORY rate arithmetic — the
     취득세 bands, the 중개보수 table. Those move on a legislative timescale and
     are the tables the functions below are actually built around. */
  var POLICY = {
    // Absolute lending ceiling, banded by house price. Empty = no ceiling.
    capTiers: [],
    stress: { capital: 3.0, non_capital: 0.75, "default": 1.5 },
    firstHome: { priceCap: 1200000000, reliefCap: 2000000 }
  };

  /* The ceiling that applies to a given house price.
     `upTo: null` is the open-ended top band and must sort last, so the tiers are
     walked in the order the policy file lists them rather than compared. */
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
    // Validated field by field. This arrives from our own build, but a partial
    // or renamed key must fall back rather than turn a limit into NaN.
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
          // null is meaningful here (the open-ended top band), so it is kept
          // rather than coerced to a number.
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

  /* ── 1. 취득세 ────────────────────────────────────────────────────────────
   * 지방세법 제11조 (유상취득 주택), 제13조의2 (다주택·법인 중과),
   * 지방교육세 = 지방세법 제151조, 농어촌특별세 = 농어촌특별세법 제5조.
   *
   * Scope is deliberately narrow: 주택의 유상취득(매매)만. 상속·증여·신축·
   * 분양권·오피스텔·토지는 과세 체계가 다르므로 이 계산기의 대상이 아니고,
   * UI 가 그렇게 말한다. 대상을 넓히는 것보다 좁게 맞는 편이 낫다.
   */

  var ACQ_BASIS = '지방세법 제11조 · 제13조의2, 지방교육세 · 농어촌특별세 포함';

  /* 표준세율 구간. 6억~9억 은 계단이 아니라 연속 함수다:
   *   세율(%) = 취득가액(억) × 2 ÷ 3 − 3
   * 6억에서 정확히 1%, 9억에서 정확히 3% 로 이어진다. 이 구간을 계단으로
   * 근사하면 경계에서 수백만원이 어긋난다. */
  function standardRate(priceWon) {
    var uk = priceWon / 100000000;
    if (uk <= 6) return 1;
    if (uk >= 9) return 3;
    return Math.round((uk * 2 / 3 - 3) * 100) / 100;
  }

  /* 중과세율. houses = 취득 후 보유하게 될 주택 수(취득 대상 포함). */
  function heavyRate(houses, regulated) {
    if (houses <= 1) return null;
    if (houses === 2) return regulated ? 8 : null;   // 비조정 2주택은 표준세율
    if (houses === 3) return regulated ? 12 : 8;
    return 12;                                       // 4주택 이상은 지역 불문
  }

  /* 지방교육세 · 농어촌특별세.
   *
   * 표준세율 주택: 지방교육세 = 취득세율 × 1/2 × 20%, 농특세 = 0.2%(85㎡ 초과).
   * 중과세율 주택: 지방교육세 0.4% 고정, 농특세는 8% 중과 0.6% / 12% 중과 1.0%.
   * 85㎡ 이하 국민주택규모는 농특세 비과세 — 면적을 묻는 유일한 이유다. */
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
   * @param {number} price   취득가액 (원)
   * @param {number} houses  취득 후 주택 수 (1 = 무주택자가 1채 취득)
   * @param {boolean} regulated 조정대상지역 여부
   * @param {boolean} over85 전용면적 85㎡ 초과 여부
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

    /* 생애최초 감면 (지방세특례제한법 제36조의3). Caps at the relief ceiling, and
       only up to the price ceiling — a 13억 first home gets nothing. Applied to
       the 취득세 itself, so it cannot take the surtaxes below zero, and never
       below zero itself on a cheap purchase where the tax is under the cap. */
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
      // Why a first-home purchase got no relief, so the checkbox never looks
      // simply broken.
      reliefBlocked: firstHome && relief === 0
        ? (isHeavy ? 'heavy' : (price > POLICY.firstHome.priceCap ? 'price' : null))
        : null,
      reliefPriceCap: POLICY.firstHome.priceCap,
      rates: { acq: acqRate, edu: sur.edu, rural: sur.rural,
               total: Math.round((acqRate + sur.edu + sur.rural) * 100) / 100 },
      amounts: { acq: acq, edu: edu, rural: rural },
      total: acq + edu + rural - relief,
      // 표준세율 구간 안내: 6~9억 누진 구간에 걸렸는지 알려주면 왜 1%도 3%도
      // 아닌 값이 나왔는지 읽는 사람이 납득한다.
      progressive: !isHeavy && price > 6e8 && price < 9e8
    };
  }

  /* ── 2. 대출한도 (LTV · DSR) ──────────────────────────────────────────────
   * LTV = 담보인정비율, DSR = 총부채원리금상환비율 (은행업감독규정).
   *
   * 두 한도를 모두 보여주고 어느 쪽에 걸렸는지 밝히는 것이 핵심이다. 최종
   * 한도만 던지면 읽는 사람이 움직일 수 있는 레버(소득이냐, 담보가냐, 만기냐)
   * 를 알 수 없다.
   */

  var LOAN_BASIS = '은행업감독규정 LTV · DSR (스트레스 금리는 사용자 입력)';

  /* Repayment schedules. All three return the FIRST YEAR's total payment,
     because that is what a DSR test consumes — and the first year is where the
     three differ most:

       원리금균등  level for the whole term, so first year = every year.
       원금균등    principal split evenly, interest on the falling balance, so
                   the first year is the HIGHEST. Same loan therefore fails a
                   DSR test that 원리금균등 passes.
       체증식      payments start low and step up annually. First year is the
                   LOWEST, so it flatters the limit most — and its real schedule
                   is set by the product (보금자리론), not by a general formula,
                   which is why the growth rate is an input and the page says a
                   lender may score it differently.

     Rate 0% is handled separately in each: it does not occur in practice but is
     typable, and a NaN on screen is worse than an exact answer. */

  function monthsOf(years) { return Math.max(1, Math.round(years * 12)); }

  /* 원리금균등 — level annuity. */
  function annualLevel(principal, ratePct, years) {
    var n = monthsOf(years), r = ratePct / 100 / 12;
    if (r === 0) return principal / years;
    return principal * r / (1 - Math.pow(1 + r, -n)) * 12;
  }

  /* 원금균등 — first 12 months.
     principal part is 12 × P/n. Interest is r × P × (12 − (0+1+…+11)/n), the
     sum of the falling balance over those months; 66 is that 0..11 sum. */
  function annualEqualPrincipal(principal, ratePct, years) {
    var n = monthsOf(years), r = ratePct / 100 / 12;
    var months = Math.min(12, n);
    var k = months * (months - 1) / 2;
    return principal * (months / n + r * (months - k / n));
  }

  /* 체증식 — level annuity as the baseline, then scaled so payments grow by
     `growthPct` a year and still clear the same debt. The first year is what
     comes back. */
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

  /* Invert whichever schedule is in play: how much principal a given annual
     capacity buys. Every schedule above is linear in the principal — double the
     loan, double the payment — so one division inverts all three rather than a
     separate closed form each. */
  function principalFromAnnual(capacity, ratePct, years, method, growthPct) {
    if (!isFinite(capacity) || capacity <= 0) return 0;
    var unit = annualPayment(1e8, ratePct, years, method, growthPct);
    return unit > 0 ? capacity / unit * 1e8 : 0;
  }

  /**
   * @param {object} o
   * @param {number} o.price        주택가격 (원)
   * @param {number} o.ltvPct       LTV 비율 (%)
   * @param {number} o.income       연소득 (원)
   * @param {number} o.dsrPct       DSR 한도 (%)
   * @param {number} o.existing     기존 대출 연간 원리금 (원)
   * @param {number} o.ratePct      대출 금리 (%)
   * @param {number} o.stressPct    스트레스 가산금리 (%p) — DSR 산정에만 적용
   * @param {number} o.years        만기 (년)
   * @param {boolean} [o.capital]   수도권·규제지역 여부 — 6.27 대책의 6억 상한 적용
   * @param {number} [o.hardCap]    상한을 직접 지정할 때 (원). 없으면 o.capital 로 결정
   */
  function loanLimit(o) {
    if (!isFinite(o.price) || o.price <= 0) return null;
    if (!isFinite(o.income) || o.income <= 0) return null;

    var ltvLimit = o.price * o.ltvPct / 100;

    // 스트레스 DSR: 한도 산정에만 가산금리를 얹고, 실제 상환액은 약정금리로
    // 계산한다. 두 금리를 하나로 합치면 "한도는 줄었는데 월납은 왜 그대로냐"
    // 는 질문에 답할 수 없다.
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
    /* The absolute ceiling. Neither a ratio nor income-scaled, and BANDED by
       house price since the 10.15 대책 — 15억 이하 6억, 15~25억 4억, 25억 초과
       2억. A flat 6억 overstates the limit on everything above 15억, which is a
       large share of the market this cap was written for. It binds before LTV
       and DSR for most 수도권 purchases, so leaving it out entirely made this
       calculator answer too high for anyone in Seoul. */
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
      // 실제 약정금리 기준 상환 부담과, 그때의 DSR 실적치.
      monthly: actualAnnual / 12,
      annual: actualAnnual,
      dsrActual: o.income > 0
        ? (actualAnnual + (o.existing || 0)) / o.income * 100 : null,
      capacityExhausted: capacity <= 0
    };
  }

  /* ── 3. 전세 ↔ 월세 전환 ──────────────────────────────────────────────────
   * 주택임대차보호법 제7조의2 (월차임 전환 시 산정률의 제한).
   *
   * 법정 상한 = min(연 10%, 기준금리 + 2%p). 기준금리가 바뀌면 상한도 바뀌므로
   * 이 페이지는 대시보드가 방금 받아온 기준금리에서 상한을 계산한다 — 상수로
   * 박아두면 인하 다음 날부터 틀린 값을 보여주게 된다.
   */

  var RENT_BASIS = '주택임대차보호법 제7조의2 · 시행령 제9조';

  function legalCapRate(baseRatePct) {
    if (!isFinite(baseRatePct)) return null;
    return Math.min(10, baseRatePct + 2);
  }

  /** 전세 → 월세. deposit: 전세보증금, keep: 전환 후 남길 보증금. */
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

  /* ── 4. 중개보수 ──────────────────────────────────────────────────────────
   * 공인중개사법 시행규칙 별표1 (2021.10.19 개정) 상한요율.
   *
   * 이건 "수수료"가 아니라 상한이다. 실제 보수는 협의로 정해지고, 시·도 조례로
   * 요율이 달라질 수 있다. 그래서 결과 문구가 전부 "상한"이라고 말한다.
   */

  var FEE_BASIS = '공인중개사법 시행규칙 별표1 (2021.10.19 개정) 상한요율';

  // [상한(원, 미만), 요율(%), 한도액(원) | null]
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

  /* 월세의 거래금액 환산: 보증금 + 월차임 × 100. 다만 그 값이 5천만원 미만이면
   * 배수를 70 으로 다시 계산한다 — 소액 월세가 최저 구간으로 떨어지지 않도록
   * 한 규정이고, 빠뜨리면 보증금이 적은 계약에서 상한이 과대 계산된다. */
  function leaseTradeValue(deposit, monthly) {
    var d = isFinite(deposit) && deposit > 0 ? deposit : 0;
    var m = isFinite(monthly) && monthly > 0 ? monthly : 0;
    if (m === 0) return d;
    var v = d + m * 100;
    if (v < 50000000) v = d + m * 70;
    return v;
  }

  /**
   * @param {number} value 거래금액 (원) — 월세는 leaseTradeValue 로 환산한 값
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
      vat: fee * 0.1        // 중개업자가 일반과세자인 경우. 간이과세는 다르다.
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
