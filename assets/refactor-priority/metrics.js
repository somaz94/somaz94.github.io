/* assets/refactor-priority/metrics.js
 * The four measurements taken from one function. Pure: no DOM, no storage, no
 * network. Input text is already blanked by detect.js, so comments and strings count for nothing.
 */
(function (global) {
  'use strict';

  /* McCabe decision points. `else` is absent: the `if` already counted its
   * second path (`else if` is counted via its `if`). Boolean operators count. */
  var DECISIONS = Object.assign(Object.create(null), {
    js:     [/\bif\b/g, /\bfor\b/g, /\bwhile\b/g, /\bcase\b/g, /\bcatch\b/g, /&&/g, /\|\|/g, /\?\?/g],
    clike:  [/\bif\b/g, /\bfor\b/g, /\bforeach\b/g, /\bwhile\b/g, /\bcase\b/g, /\bcatch\b/g, /&&/g, /\|\|/g],
    // Go has no `while` and no `catch`; `select` is a branch and so is each `case`.
    go:     [/\bif\b/g, /\bfor\b/g, /\bcase\b/g, /\bselect\b/g, /&&/g, /\|\|/g],
    // A comprehension's `for` and `if` are branches too, and `\b` catches both.
    python: [/\bif\b/g, /\belif\b/g, /\bfor\b/g, /\bwhile\b/g, /\bexcept\b/g, /\bcase\b/g, /\band\b/g, /\bor\b/g],
    // `;;` counts each `case` arm (arms are patterns); the `case` keyword is omitted.
    shell:  [/\bif\b/g, /\belif\b/g, /\bfor\b/g, /\bwhile\b/g, /\buntil\b/g, /;;/g, /&&/g, /\|\|/g]
  });

  // Only these families have `?:`. Null-prototype: `TERNARY['constructor']` must be falsy.
  var TERNARY = Object.assign(Object.create(null), { js: true, clike: true });

  function countAll(text, patterns) {
    var total = 0;
    for (var i = 0; i < patterns.length; i++) {
      var m = text.match(patterns[i]);
      if (m) total += m.length;
    }
    return total;
  }

  // Counts `a ? b : c`, skipping `??`, `?.`, `?:` (TS optional) and `<?>` (Java wildcard).
  function countTernaries(text) {
    var count = 0;
    for (var i = 0; i < text.length; i++) {
      if (text.charAt(i) !== '?') continue;
      var next = text.charAt(i + 1);
      var prev = text.charAt(i - 1);
      if (next === '?' || next === '.' || next === ':' || next === '>') continue;
      if (prev === '?' || prev === '<') continue;
      count++;
    }
    return count;
  }

  function complexityOf(bodyText, langKey) {
    var patterns = DECISIONS[langKey] || DECISIONS.js;
    var n = 1 + countAll(bodyText, patterns);
    if (TERNARY[langKey]) n += countTernaries(bodyText);
    return n;
  }

  /* Nesting from indentation, not braces: telling a block `{` from an object
   * literal needs a parser. The unit is the smallest gap between the widths present. */
  function nestingOf(bodyLines) {
    var widths = [];
    var seen = {};
    for (var i = 0; i < bodyLines.length; i++) {
      if (!bodyLines[i].trim()) continue;               // blank, or a blanked string body
      var w = global.RP_DETECT.indentWidth(bodyLines[i]);
      if (!seen[w]) { seen[w] = 1; widths.push(w); }
    }
    if (widths.length < 2) return 0;
    widths.sort(function (a, b) { return a - b; });

    var base = widths[0];
    var unit = Infinity;
    for (var k = 1; k < widths.length; k++) {
      var gap = widths[k] - widths[k - 1];
      if (gap > 0 && gap < unit) unit = gap;
    }
    if (!isFinite(unit) || unit < 1) return 0;

    /* Minus one: the body itself is a level above `base`. Matches ESLint `max-depth`
     * and golangci-lint nestif, which count from the first nested block. */
    var depth = Math.floor((widths[widths.length - 1] - base) / unit) - 1;
    return Math.min(Math.max(0, depth), 20);   // a runaway guard, not a real ceiling
  }

  /* Non-empty lines after blanking, so comments cost nothing. A trailing
   * closing-punctuation line is dropped so brace and indent languages agree. */
  function slocOf(bodyLines) {
    var n = 0;
    for (var i = 0; i < bodyLines.length; i++) {
      var text = bodyLines[i].trim();
      if (!text) continue;
      if (i === bodyLines.length - 1 && i > 0 && /^[)}\];,]+$/.test(text)) continue;
      n++;
    }
    return n;
  }

  function measure(fn, langKey) {
    return {
      complexity: complexityOf(fn.bodyText, langKey),
      nesting: nestingOf(fn.bodyLines),
      sloc: slocOf(fn.bodyLines),
      lines: fn.endLine - fn.startLine + 1,
      params: fn.params.length
    };
  }

  global.RP_METRICS = {
    measure: measure,
    complexityOf: complexityOf,
    nestingOf: nestingOf,
    slocOf: slocOf
  };
})(window);
