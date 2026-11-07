/* generate.js — combination scoring and number generation for /lotto/.
 *
 * Pure: no DOM, no storage, no network. ui.js is the only file that reads an
 * input or writes a result.
 *
 * It cannot improve the odds: draws are independent and every combination is
 * equally likely. It only ranks by how crowded a combination is, because
 * 1등~4등 are pari-mutuel.
 *
 * The weights come from the MANUAL share of 1등 winners (human picks vs the
 * terminal's uniform quick pick) against combination shape; the measured
 * contrasts are `evidence` in _data/lotto_data.json, from
 * scripts/fetch_lotto_data.py. Birthday range and consecutive pairs survived;
 * clustering came back REVERSED (people avoid clumps), so it counts in favour.
 * Sum-extremity did not survive and is deliberately absent.
 */
(function (global) {
  'use strict';

  var POOL = 45;
  var PICK = 6;
  var GRID_COLS = 7;        // the mark sheet lays 1..45 out seven to a row
  var BIRTHDAY_MAX = 31;

  /* Units are percentage points of predicted manual share, so `popularity`
     reads as "roughly what share of human pickers would choose this shape".
     These are fallbacks: the page hands in `evidence.model`, refitted by
     scripts/fetch_lotto_data.py on every run, through setModel(). */
  var W = {
    base: 14.0,
    perBirthday: 3.0,       // per number in 1..31
    consecutive: -5.8,      // at least one adjacent pair
    clustered: -3.6         // 3+ sharing a row or column
  };

  var MODEL_KEYS = { base: 'base', per_birthday: 'perBirthday',
                     consecutive: 'consecutive', clustered: 'clustered' };

  /* All or nothing: a model mixing refitted and fallback terms is neither. */
  function setModel(m) {
    if (!m || typeof m !== 'object') return false;
    var next = {}, k;
    for (k in MODEL_KEYS) {
      var v = m[k];
      if (typeof v !== 'number' || !isFinite(v) || Math.abs(v) > 100) return false;
      next[MODEL_KEYS[k]] = v;
    }
    for (k in next) W[k] = next[k];
    return true;
  }

  /* `by_birthday` never observed k = 0, so the linear term is held at the edge
     of its support: an all-32..45 ticket may be crowded by "avoid birthdays"
     advice, the very thing this model tries to avoid. */
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

  /* Why a combination scored as it did: a bare number would be
     indistinguishable from numerology. */
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
     candidates. Candidates are uniform, so the winning odds are untouched. */
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
    setModel: setModel,
    featuresOf: featuresOf,
    popularity: popularity,
    explain: explain,
    randomCombo: randomCombo,
    generate: generate
  };
})(window);
