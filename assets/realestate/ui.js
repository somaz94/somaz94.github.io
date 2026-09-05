/* ui.js — the only file on this page that touches the DOM.
 *
 * format.js and calc.js are pure; everything that reads an input, writes a
 * result or moves focus lives here.
 *
 * Nothing is stored. Not localStorage, not sessionStorage, not a cookie: the
 * fields hold a salary, a mortgage balance and a home price, and the footer
 * tells the reader they are not kept. A "restore my last input" convenience is
 * not worth making that sentence false. The consequence is that there is no
 * quota handling and no schema migration to get wrong.
 */
(function () {
  'use strict';

  var F = window.REFormat;
  var C = window.RECalc;
  if (!F || !C) return;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  var statusEl = $('#re-status');
  var announceTimer = null;

  /* Announcements are debounced and fired on commit, not on every keystroke:
     a live region re-read on each character is unusable with a screen reader. */
  function announce(msg) {
    if (!statusEl) return;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(function () {
      statusEl.textContent = msg;
    }, 350);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* Every value below reaches the DOM through textContent. There is no
     innerHTML sink on this page, so a figure typed into a field can never be
     read back as markup. */
  function row(label, value) {
    var r = el('div', 're-out-row');
    r.appendChild(el('span', null, label));
    r.appendChild(el('span', null, value));
    return r;
  }

  function setHint(input, message, bad) {
    var hint = input.parentNode.querySelector('.re-hint');
    if (!hint) return;
    hint.textContent = message || '';
    hint.className = bad ? 're-hint re-hint--bad' : 're-hint';
  }

  /* Read a money field, echoing back how it was parsed. The echo is the point:
     "5억3천" and "53000000" differ by a factor of ten and both look plausible
     in a narrow box, so the page shows what it actually understood. */
  function readWon(input, opts) {
    var o = opts || {};
    var raw = input.value.trim();
    if (!raw) {
      setHint(input, o.empty || '', false);
      return o.optional ? 0 : null;
    }
    var v = F.parseWon(raw);
    if (v === null) {
      setHint(input, '금액을 읽을 수 없습니다 (예: 5억 3000만)', true);
      return null;
    }
    setHint(input, F.won(v), false);
    return v;
  }

  function readPct(input, fallback) {
    var raw = input.value.trim();
    if (!raw) return fallback === undefined ? null : fallback;
    var v = F.parsePercent(raw);
    if (v === null || v < 0) {
      setHint(input, '숫자로 입력하세요', true);
      return null;
    }
    setHint(input, '', false);
    return v;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function bind(root, handler) {
    $$('input, select', root).forEach(function (n) {
      n.addEventListener('input', handler);
      n.addEventListener('change', handler);
    });
  }

  /* Build-time values handed over by Liquid as data attributes. They are our
     own build output rather than user input, but they are still validated: a
     missing or malformed number must fall back to a stated default instead of
     poisoning a limit with NaN.

     `live` travels with the value because the fallback is a constant frozen at
     authoring time. On a build where the dashboard data is absent the page
     would otherwise still say "현재 기준금리 2.75%", asserting a policy rate it
     did not read from anywhere. */
  function dataNum(host, key, fallback) {
    var v = host ? F.parsePercent(host.getAttribute(key)) : null;
    if (v === null || !isFinite(v)) return { value: fallback, live: false };
    return { value: v, live: true };
  }

  /* Policy figures baked in by Liquid from _data/realestate_policy.yml. A
     <script type="application/json"> island rather than a fetch — the page's
     offline contract holds, and JSON parses in one step instead of a dozen
     data- attributes. Parsed defensively even though it is our own build
     output: a syntax error here must not take the calculators down with it,
     and calc.js validates every field again on the way in. */
  var POLICY = {};
  (function () {
    var el = document.getElementById('re-policy');
    if (!el) return;
    try {
      POLICY = JSON.parse(el.textContent) || {};
    } catch (e) {
      POLICY = {};
    }
    if (C.setPolicy) C.setPolicy(POLICY);
  })();

  var calcHost = $('.re-calcs');
  var baseRate = dataNum(calcHost, 'data-base-rate', 2.75);
  var mortgageRate = dataNum(calcHost, 'data-mortgage-rate', 4.36);
  var BASE_RATE = baseRate.value;
  var MORTGAGE_RATE = mortgageRate.value;

  /* The 전월세 전환율 the market actually charged, from /realestate/rents/.
     Unlike the two rates above this one has NO fallback constant: a frozen
     market rate is a claim about what landlords charged, and there is no
     honest value to assert when the rent sweep returned nothing. Absent means
     the calculator says nothing about the market. */
  var marketRent = (function () {
    if (!calcHost) return null;
    var rate = F.parsePercent(calcHost.getAttribute('data-market-rent-rate'));
    // `rate <= 0` is a real guard, not defensive noise: Liquid's `default`
    // filter does not treat 0 as missing, so a genuine "0" can reach here.
    if (rate === null || rate <= 0) return null;
    // F.parseInt10, never the global parseInt. Every other number on this page
    // arrives comma-grouped from the fetch script, and `parseInt('3,562', 10)`
    // is 3 — silently turning the sample size into a plausible wrong number
    // the moment somebody switches this attribute to `sample_str` for
    // consistency with its neighbours. parseInt10 strips separators and
    // rejects anything that is not a whole number.
    var sample = F.parseInt10(calcHost.getAttribute('data-market-rent-sample'));
    var regions = F.parseInt10(calcHost.getAttribute('data-market-rent-regions'));
    return {
      rate: rate,
      sample: sample && sample > 0 ? sample : null,
      // Read from the data, never hardcoded: the 규제지역 list moved on
      // 2025-10-16 and will move again, and the pages beside this one already
      // render the count from `regions.size`.
      regions: regions && regions > 0 ? regions : null,
      month: calcHost.getAttribute('data-market-rent-month') || null
    };
  })();

  /* ── 1. 취득세 ─────────────────────────────────────────────────────────── */

  (function () {
    var root = $('#re-calc-acq');
    if (!root) return;
    var price = $('[name=acq-price]', root);
    var houses = $('[name=acq-houses]', root);
    var regulated = $('[name=acq-regulated]', root);
    var over85 = $('[name=acq-over85]', root);
    var first = $('[name=acq-first]', root);
    var out = $('.re-out', root);
    var value = $('.re-out-value', out);
    var rows = $('.re-out-rows', out);
    var note = $('.re-out-note', out);

    function run(ev) {
      clear(rows);
      var p = readWon(price);
      if (p === null) {
        value.textContent = '—';
        note.textContent = '취득가액을 입력하면 계산합니다.';
        return;
      }
      var r = C.acquisitionTax(p, Number(houses.value), regulated.checked,
                               over85.checked, first.checked);
      // The note has to be cleared with the figure. Leaving it behind stranded
      // the previous result's explanation under an em dash — "다주택 중과세율이
      // 적용됐습니다" beside no amount at all.
      if (!r) { value.textContent = '—'; note.textContent = ''; return; }

      value.textContent = F.won(r.total);
      rows.appendChild(row('취득세 (' + F.pct(r.rates.acq) + ')', F.won(r.amounts.acq)));
      rows.appendChild(row('지방교육세 (' + F.pct(r.rates.edu) + ')', F.won(r.amounts.edu)));
      rows.appendChild(row(
        '농어촌특별세 (' + (r.rates.rural ? F.pct(r.rates.rural) : '비과세') + ')',
        r.rates.rural ? F.won(r.amounts.rural) : '0원'));
      if (r.relief > 0) {
        rows.appendChild(row('생애최초 감면', '-' + F.won(r.relief)));
      }
      rows.appendChild(row('합계 세율', F.pct(r.rates.total)));
      rows.appendChild(row('취득가액 대비', F.pct(r.total / p * 100)));

      var msg = [];
      if (r.heavy) msg.push('다주택 중과세율이 적용됐습니다.');
      // A ticked box that changed nothing needs to say why, or it reads as broken.
      if (r.reliefBlocked === 'price') {
        msg.push('생애최초 감면은 취득가액 ' + F.won(r.reliefPriceCap) +
                 ' 이하에만 적용돼 이 금액에는 해당하지 않습니다.');
      } else if (r.reliefBlocked === 'heavy') {
        msg.push('생애최초 감면은 다주택 중과세율과 함께 적용되지 않습니다.');
      }
      if (r.progressive) {
        msg.push('6억~9억 구간은 계단이 아니라 연속 누진입니다 — 세율 = 취득가액(억) × 2 ÷ 3 − 3.');
      }
      if (!r.over85) msg.push('전용 85㎡ 이하 국민주택규모는 농어촌특별세가 비과세입니다.');
      msg.push('근거: ' + r.basis + ' · 요율 확인 ' + r.checked + '. 주택의 유상취득(매매)만 대상이며 상속 · 증여 · 신축 · 오피스텔은 과세 체계가 다릅니다.');
      note.textContent = msg.join(' ');
      // Only announce in response to an actual edit. `announceTimer` is one
      // shared timer, so four calculators announcing at boot cancel each other
      // and the last one wins — the page would open on 취득세 while a screen
      // reader read out 중개보수. The boot call passes no event.
      if (ev) announce('취득세 합계 ' + F.won(r.total));
    }
    bind(root, run);
    run();
  })();

  /* ── 2. 대출한도 (LTV · DSR) ───────────────────────────────────────────── */

  (function () {
    var root = $('#re-calc-loan');
    if (!root) return;
    var price = $('[name=loan-price]', root);
    var ltv = $('[name=loan-ltv]', root);
    var income = $('[name=loan-income]', root);
    var dsr = $('[name=loan-dsr]', root);
    var existing = $('[name=loan-existing]', root);
    var rate = $('[name=loan-rate]', root);
    var stress = $('[name=loan-stress]', root);
    var years = $('[name=loan-years]', root);
    var region = $('[name=loan-region]', root);
    var method = $('[name=loan-method]', root);
    var growth = $('[name=loan-growth]', root);
    var growthField = $('#loan-growth-field', root);
    var methodHint = $('#loan-method-hint', root);
    var stressHint = $('#loan-stress-hint', root);
    var out = $('.re-out', root);
    var value = $('.re-out-value', out);
    var label = $('.re-out-label', out);
    var rows = $('.re-out-rows', out);
    var note = $('.re-out-note', out);
    var flag = $('.re-out-flag', out);

    // The dashboard's own mortgage rate is the honest default here: a
    // hardcoded one goes stale the month after it is written.
    rate.placeholder = String(MORTGAGE_RATE);

    /* The stress floor is regional, so one default cannot serve both. Written
       into the placeholder rather than the value: a reader who types their own
       figure keeps it when they switch region. */
    function stressFloor() {
      var s = POLICY.stress || {};
      var v = region && region.value === 'other' ? s.non_capital : s.capital;
      return isFinite(v) ? v : (isFinite(s['default']) ? s['default'] : 1.5);
    }
    function syncRegion() {
      var floor = stressFloor();
      stress.placeholder = String(floor);
      if (stressHint) {
        stressHint.textContent = region && region.value === 'other'
          ? '비수도권 하한 ' + floor + '%p — 비우면 이 값을 씁니다'
          : '수도권 · 규제지역 하한 ' + floor + '%p — 비우면 이 값을 씁니다';
      }
    }

    function run(ev) {
      clear(rows);
      flag.hidden = true;
      flag.textContent = '';
      var p = readWon(price);
      var inc = readWon(income);
      var ex = readWon(existing, { optional: true, empty: '없으면 비워 두세요' });

      var ltvPct = readPct(ltv, 70);
      var dsrPct = readPct(dsr, 40);
      var ratePct = readPct(rate, MORTGAGE_RATE);
      var stressPct = readPct(stress, stressFloor());
      var methodKey = method ? method.value : 'level';
      // Only 체증식 takes a growth rate; the field is hidden otherwise so the
      // form never asks for a number that changes nothing.
      if (growthField) growthField.hidden = methodKey !== 'graduated';
      if (methodHint && C.SCHEDULES[methodKey]) {
        methodHint.textContent = C.SCHEDULES[methodKey].note;
      }
      var growthPct = methodKey === 'graduated' ? readPct(growth, 3) : 0;

      // A rejected percent must stop the calculation, not flow into it. `null`
      // is coerced to 0 by every arithmetic operator here, so a half-typed
      // "4." in the rate field silently became a 0% loan and the headline
      // jumped from a DSR-bound 4.5억 to an LTV-bound 7억 — a confident answer
      // to a question nobody asked. Same for an unreadable existing-debt
      // figure, which `|| 0` would quietly treat as no debt at all.
      if ([ltvPct, dsrPct, ratePct, stressPct, growthPct].indexOf(null) !== -1 || ex === null) {
        value.textContent = '—';
        label.textContent = '대출 가능 한도';
        note.textContent = '빨간 글씨로 표시된 칸을 다시 입력하면 계산합니다.';
        return;
      }

      var r = C.loanLimit({
        price: p, ltvPct: ltvPct, income: inc, dsrPct: dsrPct, existing: ex,
        ratePct: ratePct, stressPct: stressPct,
        capital: !region || region.value !== 'other',
        method: methodKey, growthPct: growthPct,
        years: F.parseInt10(years.value) || 30
      });
      if (!r) {
        value.textContent = '—';
        label.textContent = '대출 가능 한도';
        note.textContent = '주택가격과 연소득을 입력하면 계산합니다.';
        return;
      }

      value.textContent = F.won(r.amount);
      label.textContent = '대출 가능 한도 — ' + r.binding.label + '에 걸림';

      r.limits.forEach(function (lim) {
        rows.appendChild(row(
          lim.label + ' 한도' + (lim.key === r.binding.key ? ' ← 적용' : ''),
          F.won(lim.value)));
      });
      rows.appendChild(row('첫해 월 상환액 (' + r.methodLabel + ')', F.won(r.monthly)));
      rows.appendChild(row('첫해 연 상환액', F.won(r.annual)));
      if (r.dsrActual !== null) {
        rows.appendChild(row('실제 DSR', F.pct(r.dsrActual)));
      }

      if (r.capacityExhausted) {
        flag.hidden = false;
        flag.textContent = '기존 대출 상환액이 이미 DSR 한도를 넘습니다';
      }

      var msg = ['한도는 LTV와 DSR 중 낮은 쪽으로 정해집니다 — 어느 쪽에 걸렸는지가 곧 움직일 수 있는 조건입니다.'];
      // DSR consumes the FIRST year, and that is where the three schedules
      // differ most — so the basis is stated rather than left to be inferred
      // from a limit that moved when the dropdown changed.
      msg.push('DSR은 첫해 상환액으로 계산합니다. ' + r.methodNote);
      if (r.stressRate > ratePct) {
        msg.push('DSR 한도는 스트레스 가산을 얹은 ' + F.pct(r.stressRate) +
                 '로 산정하고, 월 상환액은 실제 약정금리로 계산합니다.');
      }
      if (r.binding.key === 'cap') {
        msg.push('규제지역 대출 상한 ' + F.won(r.binding.value) +
                 (r.binding.band ? ' (' + r.binding.band + ' 구간)' : '') +
                 '에 걸렸습니다 — 소득과 LTV에 관계없이 적용되며, 생애최초뿐 아니라 모든 차주가 대상입니다. 대출 후 6개월 내 전입 의무가 붙습니다.');
      }
      msg.push('근거: ' + r.basis + '. LTV · DSR 비율과 스트레스 가산은 규제와 차주 조건에 따라 달라지므로 입력값으로 두었습니다 — 실제 한도는 취급 은행 심사 결과와 다를 수 있습니다.');
      note.textContent = msg.join(' ');
      if (ev) announce('대출 한도 ' + F.won(r.amount) + ', ' + r.binding.label + '에 걸림');
    }
    bind(root, run);
    syncRegion();
    if (region) region.addEventListener('change', syncRegion);
    run();
  })();

  /* ── 3. 전세 ↔ 월세 전환 ───────────────────────────────────────────────── */

  (function () {
    var root = $('#re-calc-rent');
    if (!root) return;
    var dir = $('[name=rent-dir]', root);
    var jeonse = $('[name=rent-jeonse]', root);
    var deposit = $('[name=rent-deposit]', root);
    var monthly = $('[name=rent-monthly]', root);
    var rate = $('[name=rent-rate]', root);
    var out = $('.re-out', root);
    var value = $('.re-out-value', out);
    var label = $('.re-out-label', out);
    var rows = $('.re-out-rows', out);
    var note = $('.re-out-note', out);
    var jeonseField = jeonse.closest('.re-field');
    var monthlyField = monthly.closest('.re-field');
    var depositLabel = $('label[for=rent-deposit]', root);

    var cap = C.legalCapRate(BASE_RATE);
    rate.placeholder = String(cap);

    function run(ev) {
      clear(rows);
      var toMonthly = dir.value === 'to-monthly';
      // 전세→월세 는 월세를, 월세→전세 는 전세를 묻지 않는다. 방향과 무관한
      // 칸을 남겨두면 어느 값이 입력이고 어느 값이 결과인지 흐려진다.
      jeonseField.hidden = !toMonthly;
      monthlyField.hidden = toMonthly;
      // 같은 칸이 방향에 따라 다른 것을 가리킨다. 월세→전세 에서는 이미 걸려
      // 있는 보증금이고, 결과 행도 스스로 '기존 보증금'이라 부른다.
      depositLabel.textContent = toMonthly ? '전환 후 보증금' : '기존 보증금';

      var pct = readPct(rate, cap);
      var r;
      if (toMonthly) {
        r = C.jeonseToMonthly(readWon(jeonse), readWon(deposit, { optional: true }), pct);
      } else {
        r = C.monthlyToJeonse(readWon(deposit, { optional: true }), readWon(monthly), pct);
      }

      if (!r) {
        value.textContent = '—';
        label.textContent = toMonthly ? '환산 월세' : '환산 전세보증금';
        note.textContent = toMonthly
          ? '전세보증금을 입력하면 계산합니다.'
          : '월세를 입력하면 계산합니다.';
        return;
      }
      if (r.error === 'keep-too-large') {
        value.textContent = '—';
        note.textContent = '남길 보증금이 전세보증금보다 크거나 같습니다.';
        return;
      }

      if (toMonthly) {
        label.textContent = '환산 월세';
        value.textContent = F.won(r.monthly);
        rows.appendChild(row('전환 대상 보증금', F.won(r.converted)));
        rows.appendChild(row('남기는 보증금', F.won(r.deposit)));
      } else {
        label.textContent = '환산 전세보증금';
        value.textContent = F.won(r.jeonse);
        rows.appendChild(row('월세의 보증금 환산분', F.won(r.converted)));
        rows.appendChild(row('기존 보증금', F.won(r.deposit)));
      }
      rows.appendChild(row('적용 전환율', F.pct(r.rate)));

      // 시장 실거래 수준. Placed as its own row rather than folded into the
      // note: it is a measured figure and the note around it is statute, and
      // running the two together invites reading the market median as a rule.
      if (marketRent) {
        rows.appendChild(row('시장 전환율 (실거래 중위)', F.pct(marketRent.rate)));
      }

      // Assembled as parts, the way the other three calculators build their
      // notes. The conditional clauses had grown to the point where the
      // spacing between sentences lived inside three separate ternaries.
      var over = r.rate > cap + 1e-9;
      var msg = ['법정 상한은 연 10%와 기준금리 + 2%p 중 낮은 쪽입니다 — ' +
        // Says where the base rate came from. On a build with no dashboard data
        // this is a constant frozen at authoring time, and calling that "현재
        // 기준금리" would assert a policy rate the page never read.
        (baseRate.live ? '현재 기준금리 ' : '기준금리(내장 기본값) ') +
        F.pct(BASE_RATE) + ' 기준 ' + F.pct(cap) + '.'];
      if (over) msg.push('입력한 전환율이 법정 상한을 넘습니다.');
      // 적용되지, not 강제되지. 제7조의2 does not reach a contract written as
      // 월세 from the start at all; "강제되지 않는다" would say the ceiling
      // exists but goes unenforced, which is a different and wrong claim.
      msg.push('근거: ' + r.basis +
        '. 이 상한은 기존 계약의 전환에 적용되며 신규 계약에는 적용되지 않습니다.');
      // Why the two figures can differ without either being wrong. Without
      // this the market median sitting above the ceiling reads as evidence of
      // widespread illegality, which it is not.
      if (marketRent) {
        msg.push('시장 전환율은 ' + (marketRent.month ? marketRent.month + ' ' : '') +
          '규제지역' + (marketRent.regions ? ' ' + marketRent.regions + '곳' : '') +
          '의 실거래' +
          // F.comma, not toLocaleString: the latter follows the BROWSER locale
          // rather than the document's, so a de-DE reader saw "3.562건" for
          // 3,562 — a thousand-fold misreading of the sample size.
          (marketRent.sample ? ' ' + F.comma(marketRent.sample) + '건' : '') +
          '에서 계산한 중위값으로, 신규 계약까지 포함한 값이므로 법정 상한과 ' +
          '직접 비교할 수 없습니다.');
      }
      note.textContent = msg.join(' ');
      if (ev) announce((toMonthly ? '환산 월세 ' + F.won(r.monthly)
                                  : '환산 전세보증금 ' + F.won(r.jeonse)));
    }
    bind(root, run);
    run();
  })();

  /* ── 4. 중개보수 ───────────────────────────────────────────────────────── */

  (function () {
    var root = $('#re-calc-fee');
    if (!root) return;
    var kind = $('[name=fee-kind]', root);
    var deposit = $('[name=fee-deposit]', root);
    var monthly = $('[name=fee-monthly]', root);
    var out = $('.re-out', root);
    var value = $('.re-out-value', out);
    var label = $('.re-out-label', out);
    var rows = $('.re-out-rows', out);
    var note = $('.re-out-note', out);
    var monthlyField = monthly.closest('.re-field');
    var depositLabel = $('label[for=fee-deposit]', root);

    function run(ev) {
      clear(rows);
      var isSale = kind.value === 'sale';
      monthlyField.hidden = isSale;
      depositLabel.textContent = isSale ? '매매가' : '보증금';

      var d = readWon(deposit);
      if (d === null) {
        value.textContent = '—';
        label.textContent = '중개보수 상한';
        note.textContent = isSale ? '매매가를 입력하면 계산합니다.'
                                  : '보증금을 입력하면 계산합니다.';
        return;
      }

      var value_ = isSale ? d
        : C.leaseTradeValue(d, readWon(monthly, { optional: true }));
      var r = C.agentFee(value_, isSale ? 'sale' : 'lease');
      if (!r) { value.textContent = '—'; note.textContent = ''; return; }

      label.textContent = '중개보수 상한';
      value.textContent = F.won(r.fee);
      if (!isSale) rows.appendChild(row('거래금액 환산', F.won(r.value)));
      rows.appendChild(row('상한요율', F.pct(r.rate, 1)));
      if (r.cap !== null) {
        rows.appendChild(row('구간 한도액', F.won(r.cap) + (r.capped ? ' (적용)' : '')));
      }
      rows.appendChild(row('부가세 별도 (10%)', F.won(r.vat)));
      rows.appendChild(row('부가세 포함', F.won(r.fee + r.vat)));

      var msg = [];
      if (!isSale) {
        msg.push('월세는 보증금 + 월차임 × 100으로 환산하되, 그 값이 5천만원 미만이면 배수를 70으로 다시 계산합니다.');
      }
      if (r.capped) msg.push('구간 한도액이 적용돼 요율로 계산한 금액보다 낮습니다.');
      msg.push('이 값은 협의로 정하는 실제 보수가 아니라 ' + r.basis +
               '에 따른 상한입니다 — 요율은 시 · 도 조례로 달라질 수 있고, 부가세는 중개업자가 일반과세자인 경우입니다. 요율 확인 ' + r.checked + '.');
      note.textContent = msg.join(' ');
      if (ev) announce('중개보수 상한 ' + F.won(r.fee));
    }
    bind(root, run);
    run();
  })();

  /* ── Tabs ──────────────────────────────────────────────────────────────
   * One tab stop for the whole strip (roving tabindex), arrow keys inside.
   * Tabbing past it lands on the selected panel's first field rather than
   * walking through three hidden forms.
   */

  (function () {
    var strip = $('.re-tabs');
    if (!strip) return;
    var tabs = $$('.re-tab', strip);
    if (!tabs.length) return;

    function select(idx, focus) {
      tabs.forEach(function (t, i) {
        var on = i === idx;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
      if (focus) tabs[idx].focus();
    }

    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(i, false); });
      t.addEventListener('keydown', function (ev) {
        var next = null;
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') next = (i + 1) % tabs.length;
        else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') next = (i - 1 + tabs.length) % tabs.length;
        else if (ev.key === 'Home') next = 0;
        else if (ev.key === 'End') next = tabs.length - 1;
        if (next === null) return;
        ev.preventDefault();
        select(next, true);
      });
    });

    select(0, false);
  })();
})();
