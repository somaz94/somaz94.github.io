/* assets/refactor-priority/score.js
 * Turns four measurements into one priority, a severity band, and the reason.
 *
 * Pure: no DOM, no storage, no network.
 *
 * The reason is not decoration. A rank a reader cannot argue with is a hunch
 * with a number printed on it, which is the thing this tool exists to replace —
 * so every row carries the measurement that drove it and the limit it passed.
 *
 * Hand-maintained.
 */
(function (global) {
  'use strict';

  /* The value at which a measurement stops being comfortable. These are the
   * conventional defaults the common linters ship — complexity 10 is McCabe's
   * own suggested ceiling and is what golangci-lint's gocyclo and ESLint's
   * `complexity` rule default to; 4 levels of nesting and 5 parameters are the
   * usual thresholds for `max-depth` and `max-params`. `sloc` is the softest of
   * the four and is weighted accordingly: length is a symptom more often than a
   * cause.
   *
   * They are limits, not verdicts. Passing one is what puts a function on the
   * list; how far past it went is what orders the list. */
  var LIMITS = { complexity: 10, nesting: 4, sloc: 50, params: 5 };

  var WEIGHTS = { complexity: 0.40, nesting: 0.25, sloc: 0.20, params: 0.15 };

  var LABELS = {
    complexity: 'cyclomatic complexity',
    nesting: 'nesting depth',
    sloc: 'lines of code',
    params: 'parameters'
  };

  var SHORT = { complexity: 'Complexity', nesting: 'Nesting', sloc: 'Lines', params: 'Params' };

  var KEYS = ['complexity', 'nesting', 'sloc', 'params'];

  /* Scaled so that a function sitting exactly on all four limits scores 40, and
   * one at two and a half times all four scores 100. Nothing is clamped on the
   * way in — a single measurement far past its limit is supposed to carry a row
   * to the top on its own. */
  function scoreOf(metrics) {
    var raw = 0;
    var pressures = {};
    for (var i = 0; i < KEYS.length; i++) {
      var key = KEYS[i];
      var p = metrics[key] / LIMITS[key];
      pressures[key] = p;
      raw += WEIGHTS[key] * p;
    }
    return { score: Math.min(100, Math.round(raw * 40)), pressures: pressures };
  }

  /* Severity asks a different question from the score, so it is computed
   * separately rather than sliced out of it. The score orders the list; severity
   * answers "is any single measurement out of bounds". A function with
   * complexity 25 and nothing else wrong scores in the thirties — a weighted
   * average dilutes it — but 25 is not a medium problem, and the band says so.
   */
  function severityOf(score, pressures) {
    var worst = 0;
    for (var i = 0; i < KEYS.length; i++) worst = Math.max(worst, pressures[KEYS[i]]);
    if (worst >= 2 || score >= 60) return 'high';
    if (worst >= 1 || score >= 30) return 'medium';
    return 'low';
  }

  /* The measurement that contributed most to the score — weight included, so a
   * mildly-over complexity outranks a wildly-over parameter count only when it
   * actually moved the number more. */
  function driverOf(metrics, pressures) {
    var best = KEYS[0];
    var bestContribution = -1;
    for (var i = 0; i < KEYS.length; i++) {
      var key = KEYS[i];
      var contribution = WEIGHTS[key] * pressures[key];
      if (contribution > bestContribution) { bestContribution = contribution; best = key; }
    }
    return {
      key: best,
      label: LABELS[best],
      value: metrics[best],
      limit: LIMITS[best],
      over: metrics[best] > LIMITS[best],
      text: metrics[best] > LIMITS[best]
        ? LABELS[best] + ' ' + metrics[best] + ', past the usual limit of ' + LIMITS[best]
        : LABELS[best] + ' ' + metrics[best] + ', within the usual limit of ' + LIMITS[best]
    };
  }

  function evaluate(fn, langKey) {
    var metrics = global.RP_METRICS.measure(fn, langKey);
    var scored = scoreOf(metrics);
    return {
      id: fn.id,
      name: fn.name,
      parent: fn.parent,
      children: fn.children,
      startLine: fn.startLine,
      endLine: fn.endLine,
      params: fn.params,
      metrics: metrics,
      pressures: scored.pressures,
      score: scored.score,
      severity: severityOf(scored.score, scored.pressures),
      driver: driverOf(metrics, scored.pressures)
    };
  }

  function analyse(source, langKey) {
    var list = global.RP_DETECT.functions(source, langKey);
    var out = [];
    for (var i = 0; i < list.length; i++) out.push(evaluate(list[i], langKey));
    return out;
  }

  /* Every comparator falls through to `startLine`. Without a total order the
   * list reshuffles among equal rows on each repaint, and a row that moves while
   * being read is worse than one in an arguable position. */
  var SORTS = Object.assign(Object.create(null), {
    priority: function (a, b) {
      return b.score - a.score ||
        b.metrics.complexity - a.metrics.complexity ||
        b.metrics.sloc - a.metrics.sloc ||
        a.startLine - b.startLine;
    },
    complexity: function (a, b) { return b.metrics.complexity - a.metrics.complexity || a.startLine - b.startLine; },
    nesting: function (a, b) { return b.metrics.nesting - a.metrics.nesting || a.startLine - b.startLine; },
    length: function (a, b) { return b.metrics.sloc - a.metrics.sloc || a.startLine - b.startLine; }
  });

  function sort(rows, key) {
    return rows.slice().sort(SORTS[key] || SORTS.priority);
  }

  function tally(rows) {
    var out = { functions: rows.length, high: 0, medium: 0, low: 0, maxComplexity: 0 };
    for (var i = 0; i < rows.length; i++) {
      out[rows[i].severity]++;
      if (rows[i].metrics.complexity > out.maxComplexity) out.maxComplexity = rows[i].metrics.complexity;
    }
    return out;
  }

  global.RP_SCORE = {
    LIMITS: LIMITS,
    WEIGHTS: WEIGHTS,
    LABELS: LABELS,
    SHORT: SHORT,
    KEYS: KEYS,
    analyse: analyse,
    evaluate: evaluate,
    sort: sort,
    tally: tally
  };
})(window);
