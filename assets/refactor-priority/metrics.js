/* assets/refactor-priority/metrics.js
 * The four measurements taken from one function.
 *
 * Pure: no DOM, no storage, no network. Input is a record from detect.js, whose
 * text has already had comments and string bodies blanked — so nothing counted
 * here can come from a comment, a docstring or a string literal.
 *
 * Hand-maintained.
 */
(function (global) {
  'use strict';

  /* Decision points, per McCabe: every place control can take a second path.
   *
   * `else` is deliberately absent. An `if/else` has two paths and the `if`
   * already accounted for the second one; counting both double-charges every
   * branch in the file. `elif` and `else if` are counted, because each adds a
   * further path — `else if` is matched by the `if` inside it.
   *
   * Boolean operators count because each one is a branch the reader has to hold:
   * `if (a && b)` has the same two-outcome shape as a nested `if`. */
  var DECISIONS = Object.assign(Object.create(null), {
    js:     [/\bif\b/g, /\bfor\b/g, /\bwhile\b/g, /\bcase\b/g, /\bcatch\b/g, /&&/g, /\|\|/g, /\?\?/g],
    clike:  [/\bif\b/g, /\bfor\b/g, /\bforeach\b/g, /\bwhile\b/g, /\bcase\b/g, /\bcatch\b/g, /&&/g, /\|\|/g],
    // Go has no `while` and no `catch`; `select` is a branch and so is each `case`.
    go:     [/\bif\b/g, /\bfor\b/g, /\bcase\b/g, /\bselect\b/g, /&&/g, /\|\|/g],
    // A comprehension's `for` and `if` are branches too, and `\b` catches both.
    python: [/\bif\b/g, /\belif\b/g, /\bfor\b/g, /\bwhile\b/g, /\bexcept\b/g, /\bcase\b/g, /\band\b/g, /\bor\b/g],
    /* `;;` stands in for a `case` arm: the arms are patterns, not keywords, so
     * there is nothing else to count them by. The `case` keyword itself is left
     * out to avoid charging the statement twice. */
    shell:  [/\bif\b/g, /\belif\b/g, /\bfor\b/g, /\bwhile\b/g, /\buntil\b/g, /;;/g, /&&/g, /\|\|/g]
  });

  /* Only these two families spell a conditional expression with `?`.
   * Null-prototype for the same reason every other lookup here is: a plain
   * literal answers `TERNARY['constructor']` with a truthy function. */
  var TERNARY = Object.assign(Object.create(null), { js: true, clike: true });

  function countAll(text, patterns) {
    var total = 0;
    for (var i = 0; i < patterns.length; i++) {
      var m = text.match(patterns[i]);
      if (m) total += m.length;
    }
    return total;
  }

  /* Counts `a ? b : c` while skipping the four other things a `?` can be:
   * `??` (nullish coalescing), `?.` (optional chaining), `?:` (a TypeScript
   * optional parameter or a C# nullable) and `<?>` (a Java wildcard type
   * argument). Looking at the character on either side settles all four and
   * needs no context. */
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

  /* Nesting is read from indentation rather than from braces, for every
   * language alike.
   *
   * Counting braces would mean deciding which `{` opens a block and which opens
   * an object literal, an initialiser list or a TypeScript type — a distinction
   * that needs the parser this tool does not have. Indentation answers the
   * question the reader actually has ("how far in is this code") and answers it
   * identically for Python and for Go.
   *
   * The unit is measured from the function itself, not assumed: the smallest gap
   * between the distinct indentation widths present. A file indented with three
   * spaces reports the same depth as one indented with four, and a continuation
   * line aligned under an open paren does not invent a level of its own unless
   * it is the only indentation in the function.
   */
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

    /* Minus one: `base` is the signature's own indentation, so the body counts
     * as a level before any block has been opened. ESLint's `max-depth` and
     * golangci-lint's nestif — the conventions score.js cites for the limit —
     * both start counting at the first nested block, so without this every
     * function reads one deeper than the tool it is being compared against and
     * a legitimately 4-deep function is flagged as 5. */
    var depth = Math.floor((widths[widths.length - 1] - base) / unit) - 1;
    return Math.min(Math.max(0, depth), 20);   // a runaway guard, not a real ceiling
  }

  /* Lines that carry code: the signature plus the body. Comment-only lines and
   * blank lines were blanked or were already empty, so counting non-empty lines
   * gets this for free — and it is the fairer number to score on, since a
   * well-documented function should not rank worse than an identical
   * undocumented one.
   *
   * A trailing line that is nothing but closing punctuation is dropped. It
   * belongs to the syntax rather than the code, and only the brace languages
   * have one — without this a Go function and the identical Python function
   * differ by one line for no reason the reader can see. */
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
