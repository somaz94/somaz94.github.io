/* generate.js — combination scoring and number generation for /lotto/.
 *
 * Pure: no DOM, no storage, no network. ui.js is the only file that reads an
 * input or writes a result.
 *
 * WHAT THIS OPTIMISES, AND WHAT IT CANNOT
 * ---------------------------------------
 * It cannot improve the odds of winning. Draws are independent and the 45 balls
 * are uniform; every 6-combination has exactly the same 1/8,145,060 chance and
 * nothing in here changes that by any amount.
 *
 * What it does change is how many people you would split with. 1등~4등 are
 * pari-mutuel — one pool, divided among the winners — so a combination other
 * players avoid is worth more when it does come up.
 *
 * The weights below are not folklore. They come from regressing the MANUAL
 * share of 1등 winners (수동 vs 자동, i.e. human picks vs the terminal's uniform
 * quick pick) against combination shape across ~970 draws, in
 * scripts/fetch_lotto_data.py. Three of four tested effects survived:
 *
 *   birthday range  1~31 heavy → manual share 16.0 / 21.4 / 27.4 / 30.5 / 28.9
 *                   / 31.3 across k = 1..6. Rising, but NOT monotonic — k=5
 *                   dips. The strongest signal all the same.
 *   consecutive     A consecutive pair DROPS manual share 31.9% → 26.1%
 *                   (t = -4.42, the largest single effect). People believe
 *                   consecutive numbers "don't look random" and avoid them.
 *   clustering      3+ numbers sharing a row or column of the mark sheet DROPS
 *                   manual share 30.3% → 26.7% (t = +2.65 for the un-clustered
 *                   side). This is the OPPOSITE of the usual advice: the folk
 *                   theory says people draw lines on the sheet, but the record
 *                   says they avoid clumps and prefer a spread.
 *
 * A fourth — that people cluster around the mid sum of 138 — did NOT survive
 * (t = -1.17) and is deliberately absent. Leaving it in because it sounds right
 * is exactly the failure this model is built to avoid.
 */
(function (global) {
  'use strict';

  var POOL = 45;
  var PICK = 6;
  var GRID_COLS = 7;        // the mark sheet lays 1..45 out seven to a row
  var BIRTHDAY_MAX = 31;

  /* Fitted from the manual-share contrasts. Units are percentage points of
     predicted manual share, so `popularity` reads directly as "roughly what
     share of human pickers would choose a combination shaped like this". */
  var W = {
    base: 14.0,
    perBirthday: 3.0,       // +3%p per number in 1..31
    consecutive: -5.8,      // measured Δ for having at least one adjacent pair
    clustered: -3.6         // measured Δ for 3+ sharing a row or column
  };

  /* The fit only spans what the record contains. `by_birthday` in
     _data/lotto_data.json covers k = 1..6, and k = 1 rests on nine draws; k = 0
     was never observed at all. Running the linear term below k = 1 invents a
     number the data does not support — and it is not a harmless extrapolation,
     because "avoid birthday numbers" is itself widely repeated advice, so a
     ticket made entirely of 32..45 may be crowded for exactly the reason this
     model is trying to avoid. The term is held at the edge of its support. */
  var BIRTHDAY_FLOOR = 1;

  function featuresOf(nums) {
    var sorted = nums.slice().sort(function (a, b) { return a - b; });
    var birthday = 0, consecutive = 0;
    var rows = {}, cols = {};
    for (var i = 0; i < sorted.length; i++) {
      var n = sorted[i];
      if (n <= BIRTHDAY_MAX) birthday++;
      if (i > 0 && n - sorted[i - 1] === 1) consecutive++;
      var r = Math.floor((n - 1) / GRID_COLS), c = (n - 1) % GRID_COLS;
      rows[r] = (rows[r] || 0) + 1;
      cols[c] = (cols[c] || 0) + 1;
    }
    var rowMax = 0, colMax = 0, k;
    for (k in rows) if (rows[k] > rowMax) rowMax = rows[k];
    for (k in cols) if (cols[k] > colMax) colMax = cols[k];

    return {
      numbers: sorted,
      birthday: birthday,
      consecutive: consecutive,
      rowMax: rowMax,
      colMax: colMax,
      clustered: rowMax >= 3 || colMax >= 3
    };
  }

  /* Predicted share of human pickers, in percent. Lower is better here: it
     means fewer people to divide the pool with. */
  function popularity(nums) {
    var f = featuresOf(nums);
    var p = W.base + W.perBirthday * Math.max(BIRTHDAY_FLOOR, f.birthday)
      + (f.consecutive >= 1 ? W.consecutive : 0)
      + (f.clustered ? W.clustered : 0);
    return { score: Math.max(0, Math.min(100, p)), features: f };
  }

  /* Plain-language account of why a combination scored as it did. The page owes
     the reader this: a bare number would be indistinguishable from the
     numerology the rest of the page argues against. */
  function explain(nums) {
    var r = popularity(nums), f = r.features, out = [];
    out.push({
      good: f.birthday <= 3,
      text: '1~31이 ' + f.birthday + '개' +
        (f.birthday <= 3 ? ' — 생일로 고르는 사람과 덜 겹칩니다'
                         : ' — 생일 범위에 몰려 있어 겹치기 쉽습니다')
    });
    out.push({
      good: f.consecutive >= 1,
      text: f.consecutive >= 1
        ? '연속수 포함 — 많은 사람이 피하는 모양이라 유리합니다'
        : '연속수 없음 — 사람들이 선호하는 모양입니다'
    });
    out.push({
      good: f.clustered,
      text: f.clustered
        ? '용지 한 줄에 3개 이상 몰림 — 실제로는 덜 선택되는 모양입니다'
        : '용지에 고르게 흩어짐 — 사람들이 선호하는 모양입니다'
    });
    return { popularity: r.score, features: f, reasons: out };
  }

  /* Uniform random combination. Partial Fisher-Yates over a 1..45 deck rather
     than reject-sampling a Set: the deck cannot loop and cannot bias. */
  function randomCombo(rng, locked) {
    var fixed = (locked || []).slice(0, PICK);
    var taken = {};
    var out = [];
    for (var i = 0; i < fixed.length; i++) {
      if (!taken[fixed[i]]) { taken[fixed[i]] = 1; out.push(fixed[i]); }
    }
    var deck = [];
    for (var n = 1; n <= POOL; n++) if (!taken[n]) deck.push(n);
    var need = PICK - out.length;
    for (var k = 0; k < need; k++) {
      // `rng` is a published option, so a generator that can return exactly 1
      // is possible even though Math.random cannot. Unclamped that indexes one
      // past the deck and the combination comes back as six nulls.
      var j = k + Math.min(deck.length - 1 - k, Math.floor(rng() * (deck.length - k)));
      var t = deck[k]; deck[k] = deck[j]; deck[j] = t;
      out.push(deck[k]);
    }
    return out.sort(function (a, b) { return a - b; });
  }

  /* Draw `count` combinations, each the least-popular of `tries` uniform
     candidates.

     Every candidate is drawn uniformly, so the winning odds are untouched — the
     selection only reorders equally-likely tickets by how crowded they are. */
  function generate(opts) {
    var o = opts || {};
    var count = Math.max(1, Math.min(10, o.count || 5));
    var tries = Math.max(1, Math.min(4000, o.tries || 800));
    var rng = o.rng || Math.random;
    var locked = (o.locked || []).filter(function (n) {
      return n >= 1 && n <= POOL;
    });
    if (locked.length >= PICK) {
      return [explainWith(locked.slice(0, PICK))];
    }

    var out = [];
    var seen = {};
    for (var i = 0; i < count; i++) {
      var best = null;
      for (var t = 0; t < tries; t++) {
        var cand = randomCombo(rng, locked);
        var key = cand.join('-');
        if (seen[key]) continue;
        var p = popularity(cand).score;
        if (!best || p < best.p) best = { combo: cand, p: p, key: key };
      }
      if (!best) break;
      seen[best.key] = 1;
      out.push(explainWith(best.combo));
    }
    return out;
  }

  function explainWith(combo) {
    var e = explain(combo);
    return { numbers: combo, popularity: e.popularity,
             features: e.features, reasons: e.reasons };
  }

  global.Lotto = {
    POOL: POOL,
    PICK: PICK,
    GRID_COLS: GRID_COLS,
    BIRTHDAY_MAX: BIRTHDAY_MAX,
    weights: W,
    featuresOf: featuresOf,
    popularity: popularity,
    explain: explain,
    randomCombo: randomCombo,
    generate: generate
  };
})(window);
