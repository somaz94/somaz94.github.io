/* assets/refactor-priority/score.js
 * Four measurements -> a priority, a severity band, and the reason (the
 * measurement that drove it and its limit). Pure: no DOM, no storage, no network.
 */
(function (global) {
  'use strict';

  /* Common linter defaults: complexity 10 (McCabe, gocyclo, ESLint `complexity`),
   * `max-depth` 4, `max-params` 5. `sloc` is weighted lowest: length is usually a symptom. */
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

  /* On all four limits = 40, 2.5x all four = 100. Unclamped on the way in, so one
   * measurement far past its limit can carry a row to the top alone. */
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

  /* Separate from the score, which orders the list: severity asks whether any one
   * measurement is out of bounds, which a weighted average would dilute. */
  function severityOf(score, pressures) {
    var worst = 0;
    for (var i = 0; i < KEYS.length; i++) worst = Math.max(worst, pressures[KEYS[i]]);
    if (worst >= 2 || score >= 60) return 'high';
    if (worst >= 1 || score >= 30) return 'medium';
    return 'low';
  }

  // The largest weighted contribution to the score.
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

  // Every comparator ends on `startLine`: a total order stops equal rows reshuffling on repaint.
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
