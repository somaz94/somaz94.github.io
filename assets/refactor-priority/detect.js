/* assets/refactor-priority/detect.js
 * Language guessing, comment/string blanking, and function-boundary extraction.
 * Pure: no DOM, no storage, no network.
 *
 * Every downstream question is asked of `strip()`'s output: comment and string
 * bodies blanked to spaces, length and newlines kept, so a `{` in a string or an
 * `if` in a comment counts for nothing and every offset still maps to the source.
 * Deliberately no parser; known blind spots are noted beside the code that has them.
 */
(function (global) {
  'use strict';

  /* `family` picks the boundary scanner; the rest configures `strip`.
   * Null-prototype so `LANGS['constructor']` is undefined and the `||` fallback fires. */
  var LANGS = Object.assign(Object.create(null), {
    js:     { label: 'JavaScript / TypeScript', family: 'brace',  line: '//', block: true,  quotes: '\'"`', multiline: '`', regex: true },
    go:     { label: 'Go',                      family: 'brace',  line: '//', block: true,  quotes: '\'"`', multiline: '`', regex: false },
    clike:  { label: 'Java / C / C++ / C#',     family: 'brace',  line: '//', block: true,  quotes: '\'"',  multiline: '',  regex: false },
    python: { label: 'Python',                  family: 'indent', line: '#',  block: false, quotes: '\'"',  multiline: '',  regex: false, triple: true },
    shell:  { label: 'Shell',                   family: 'brace',  line: '#',  block: false, quotes: '\'"',  multiline: '\'"', regex: false, heredoc: true, hashNeedsSpace: true }
  });

  var ORDER = ['js', 'go', 'clike', 'python', 'shell'];

  /* A `/` opens a regex only where no value can sit to its left. Wrong after the
   * `)` of an `if` condition, which costs one blanked division, not a boundary. */
  var REGEX_OK_PUNCT = '(,=:[!&|?{};+-*%~^<>';
  var REGEX_OK_WORDS = {
    'return': 1, 'typeof': 1, 'instanceof': 1, 'in': 1, 'of': 1, 'new': 1,
    'delete': 1, 'void': 1, 'case': 1, 'do': 1, 'else': 1, 'yield': 1,
    'await': 1, 'throw': 1
  };

  function regexAllowed(out, at) {
    var i = at - 1;
    while (i >= 0 && /\s/.test(out[i] || ' ')) i--;
    if (i < 0) return true;
    var c = out[i];
    if (REGEX_OK_PUNCT.indexOf(c) >= 0) return true;
    if (!/[A-Za-z0-9_$]/.test(c)) return false;
    var end = i + 1;
    while (i >= 0 && /[A-Za-z0-9_$]/.test(out[i] || ' ')) i--;
    return REGEX_OK_WORDS[out.slice(i + 1, end).join('')] === 1;
  }

  /* Returns `source` at the same length with comment and string bodies blanked
   * to spaces; newlines survive, so line numbers and indentation are untouched. */
  function strip(source, langKey) {
    var cfg = LANGS[langKey] || LANGS.js;
    var s = String(source == null ? '' : source);
    var n = s.length;
    var out = new Array(n);
    var i = 0;
    var heredoc = null;

    function blank(from, to) {
      for (var k = from; k < to && k < n; k++) out[k] = s.charAt(k) === '\n' ? '\n' : ' ';
    }

    function lineEnd(from) {
      var e = s.indexOf('\n', from);
      return e < 0 ? n : e;
    }

    /* Returns the index just past the closing quote. Outside `multiline` quotes an
     * unescaped newline ends the run, so an unterminated quote blanks one line.
     * Shell quotes really span lines, so a half-typed `'` there hides every
     * function below it until closed — the language, not a bug. */
    function quotedEnd(from, quote) {
      var spans = cfg.multiline.indexOf(quote) >= 0;
      for (var k = from + 1; k < n; k++) {
        var c = s.charAt(k);
        // A backslash is literal in shell single quotes and Go raw strings.
        if (c === '\\' && quote !== '`' && !(cfg.heredoc && quote === '\'')) { k++; continue; }
        if (c === '\n' && !spans) return k;
        if (c === quote) return k + 1;
      }
      return n;
    }

    function regexEnd(from) {
      var inClass = false;
      for (var k = from + 1; k < n; k++) {
        var c = s.charAt(k);
        if (c === '\\') { k++; continue; }
        if (c === '\n') return k;               // a regex literal cannot span lines
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) return k + 1;
      }
      return n;
    }

    while (i < n) {
      var c = s.charAt(i);

      /* Heredoc body, opened below on `<<TAG`: blanked through the terminator
       * line so an embedded jq filter or manifest adds no braces. */
      if (heredoc !== null && c === '\n') {
        out[i] = '\n';
        i++;
        while (i < n) {
          var he = lineEnd(i);
          var text = s.slice(i, he);
          blank(i, he);
          i = he;
          if (i < n) { out[i] = '\n'; i++; }
          // `<<-TAG` lets the terminator be indented with tabs.
          if (text.replace(/^\t+/, '').trim() === heredoc) break;
        }
        heredoc = null;
        continue;
      }

      if (cfg.line === '//' && c === '/' && s.charAt(i + 1) === '/') {
        var le = lineEnd(i); blank(i, le); i = le; continue;
      }
      // In shell a `#` opens a comment only at a word start (`${v#p}` is not one).
      if (cfg.line === '#' && c === '#' &&
          (!cfg.hashNeedsSpace || i === 0 || /\s/.test(s.charAt(i - 1)))) {
        var le2 = lineEnd(i); blank(i, le2); i = le2; continue;
      }
      if (cfg.block && c === '/' && s.charAt(i + 1) === '*') {
        var close = s.indexOf('*/', i + 2);
        var to = close < 0 ? n : close + 2;
        blank(i, to); i = to; continue;
      }
      // Before the single-quote branch, so a docstring is blanked whole, not read as `''` + prose.
      if (cfg.triple && (s.substr(i, 3) === '"""' || s.substr(i, 3) === "'''")) {
        var tag = s.substr(i, 3);
        var tclose = s.indexOf(tag, i + 3);
        var tto = tclose < 0 ? n : tclose + 3;
        blank(i, tto); i = tto; continue;
      }
      if (cfg.quotes.indexOf(c) >= 0) {
        var qe = quotedEnd(i, c); blank(i, qe); i = qe; continue;
      }
      if (cfg.regex && c === '/' && regexAllowed(out, i)) {
        var re = regexEnd(i); blank(i, re); i = re; continue;
      }
      /* No space allowed after `<<`, which keeps `$(( a << b ))` out. Blind spot:
       * legal `<< TAG` is missed, and its body is simply not blanked. */
      if (cfg.heredoc && c === '<' && s.charAt(i + 1) === '<') {
        var hm = /^<<-?(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(s.slice(i, i + 64));
        if (hm) { heredoc = hm[2]; blank(i, i + hm[0].length); i += hm[0].length; continue; }
      }

      out[i] = c;
      i++;
    }

    return out.join('');
  }

  /* Scored, not first-match: a Go file also carries every C-like marker.
   * A shebang is decisive. */
  var MARKERS = {
    go: [[/^package\s+\w+/m, 5], [/\bfunc\s+\w*\s*\(/, 4], [/:=/, 2], [/\berr\s*!=\s*nil\b/, 3], [/^import\s+\(/m, 3]],
    python: [[/^\s*def\s+\w+\s*\(/m, 5], [/^\s*from\s+[\w.]+\s+import\b/m, 4], [/^\s*import\s+\w+$/m, 2], [/\bself\./, 3], [/\belif\b/, 3], [/:\s*$/m, 1]],
    shell: [[/^\s*(?:function\s+)?[\w.-]+\s*\(\s*\)\s*\{/m, 4], [/\bfi\b/, 3], [/\besac\b/, 3], [/\bthen\b/, 2], [/\blocal\s+\w+=/, 3], [/\$\{?\w+\}?/, 1]],
    js: [[/\bfunction\b/, 3], [/=>/, 3], [/\b(?:const|let)\s+\w+\s*=/, 3], [/\brequire\s*\(/, 2], [/^\s*(?:export|import)\b/m, 3], [/\bconsole\.log\b/, 1]],
    clike: [[/#include\b/, 5], [/\b(?:public|private|protected)\s+(?:static\s+)?[\w<>\[\]]+\s+\w+\s*\(/, 5], [/\bnamespace\s+\w+/, 3], [/\bSystem\.out\b/, 3], [/\bstd::/, 4]]
  };

  function guessLanguage(source) {
    var s = String(source == null ? '' : source);
    if (!s.trim()) return null;

    var shebang = /^#!.*?\b(bash|sh|zsh|ksh|python[\d.]*|node)\b/.exec(s.slice(0, 200));
    if (shebang) {
      if (shebang[1].indexOf('python') === 0) return 'python';
      return shebang[1] === 'node' ? 'js' : 'shell';
    }

    var best = null;
    var bestScore = 0;
    for (var key in MARKERS) {
      if (!Object.prototype.hasOwnProperty.call(MARKERS, key)) continue;
      var score = 0;
      for (var i = 0; i < MARKERS[key].length; i++) {
        if (MARKERS[key][i][0].test(s)) score += MARKERS[key][i][1];
      }
      if (score > bestScore) { bestScore = score; best = key; }
    }
    // Two weak signals are not a guess. Braces or a `def` decide the family.
    if (!best || bestScore < 4) return /\{/.test(s) ? 'js' : (/^\s*def\s/m.test(s) ? 'python' : 'js');
    return best;
  }

  /* Keywords shaped like a method declaration (`name (...) {`).
   * Null-prototype is load-bearing: indexed by a name from the pasted file, a plain
   * literal answered `NOT_A_NAME['constructor']` truthy and silently dropped every
   * ES6 constructor and Java `toString()`. */
  var NOT_A_NAME = Object.assign(Object.create(null), {
    'if': 1, 'else': 1, 'for': 1, 'while': 1, 'switch': 1, 'catch': 1, 'do': 1,
    'try': 1, 'finally': 1, 'return': 1, 'with': 1, 'using': 1, 'lock': 1,
    'foreach': 1, 'synchronized': 1, 'fixed': 1, 'unsafe': 1, 'select': 1,
    'defer': 1, 'go': 1, 'new': 1, 'delete': 1, 'typeof': 1, 'case': 1,
    'default': 1, 'match': 1, 'unless': 1, 'until': 1, 'elif': 1
  });

  function parenGroup(code, open) {
    var depth = 0;
    for (var i = open; i < code.length; i++) {
      var c = code.charAt(i);
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) return { text: code.slice(open + 1, i), end: i + 1 }; }
    }
    return null;
  }

  /* A `;` before the `{` means no body (prototype, interface method, overload),
   * so no row. Blind spot: an object-literal TS return type (`): Promise<{ ok: boolean }> {`)
   * is taken for the body, and the function measures tiny — visibly, not silently. */
  function findBodyBrace(code, from) {
    var lineBudget = 12;
    for (var i = from; i < code.length; i++) {
      var c = code.charAt(i);
      if (c === '\n') { if (--lineBudget < 0) return -1; continue; }
      if (c === '{') return i;
      if (c === ';') return -1;
    }
    return -1;
  }

  function matchBrace(code, open) {
    var depth = 0;
    for (var i = open; i < code.length; i++) {
      var c = code.charAt(i);
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  /* Joins a wrapped signature until its parens balance. Joined on '\n', the
   * split separator, so an index into the result is still a file offset. */
  function logicalHeader(lines, li, offsets) {
    var text = lines[li];
    var depth = 0;
    var k;
    for (k = 0; k < text.length; k++) {
      if (text.charAt(k) === '(') depth++;
      else if (text.charAt(k) === ')') depth--;
    }
    var last = li;
    while (depth > 0 && last - li < 11 && last + 1 < lines.length) {
      last++;
      text += '\n' + lines[last];
      var line = lines[last];
      for (k = 0; k < line.length; k++) {
        if (line.charAt(k) === '(') depth++;
        else if (line.charAt(k) === ')') depth--;
      }
    }
    return { text: text, start: offsets[li] };
  }

  var JS_FUNCTION = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?/;
  var JS_ASSIGNED = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s+)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/;
  var JS_PROPERTY = /^\s*(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?(?:function\b|\()/;
  var JS_METHOD   = /^\s*(?:(?:public|private|protected|static|readonly|abstract|override|async|get|set)\s+)*\*?\s*([A-Za-z_$#][\w$]*)\s*(?:<[^>(]*>)?\s*\(/;
  var GO_FUNC     = /^\s*func\s*(?:\([^)]*\)\s*)?([A-Za-z_]\w*)?/;
  var GO_ASSIGNED = /^\s*(?:var\s+)?([A-Za-z_]\w*)\s*:?=\s*func\s*\(/;
  var SH_PAREN    = /^\s*(?:function\s+)?([A-Za-z_][\w.:-]*)\s*\(\s*\)/;
  var SH_KEYWORD  = /^\s*function\s+([A-Za-z_][\w.:-]*)\s*\{/;
  var C_METHOD    = /^\s*(?:@[\w.]+\s+)*(?:(?:public|private|protected|internal|static|final|abstract|virtual|override|inline|extern|explicit|constexpr|const|synchronized|native|unsafe|async|new|partial)\s+)*(?:[\w:<>,.\[\]*&\s]+?\s+[*&]?)?([A-Za-z_~]\w*)\s*(?:<[^>(]*>)?\s*\(/;

  /* `it('x', () => {` looks like `name(...) {` once strings are blanked; a function
   * in the params marks a call. A method with a function default is skipped too. */
  function looksLikeCall(paramText) {
    return /=>|\bfunction\b/.test(paramText);
  }

  function matchSignature(text, langKey) {
    var m;
    if (langKey === 'js') {
      m = JS_FUNCTION.exec(text);
      if (m) return { name: m[1] || '(anonymous)', end: m.index + m[0].length, strict: false };
      m = JS_ASSIGNED.exec(text) || JS_PROPERTY.exec(text);
      /* `const f = x => {` has no paren list; searching for the next `(` would land
       * inside the body, so the bare parameter is taken from the match instead. */
      if (m && /=>$/.test(m[0])) {
        var bare = /([A-Za-z_$][\w$]*)\s*=>$/.exec(m[0]);
        return {
          name: m[1],
          end: m.index + m[0].length,
          strict: false,
          noParens: true,
          params: bare ? [bare[1]] : []
        };
      }
      if (m) return { name: m[1], end: m.index + m[0].length - 1, strict: false };
      m = JS_METHOD.exec(text);
      if (m && !NOT_A_NAME[m[1]]) return { name: m[1], end: m.index + m[0].length - 1, strict: true };
      return null;
    }
    if (langKey === 'go') {
      m = GO_FUNC.exec(text);
      if (m) return { name: m[1] || '(anonymous)', end: m.index + m[0].length, strict: false };
      m = GO_ASSIGNED.exec(text);
      if (m) return { name: m[1], end: m.index + m[0].length - 1, strict: false };
      return null;
    }
    if (langKey === 'shell') {
      m = SH_KEYWORD.exec(text);
      if (m) return { name: m[1], end: m.index + m[0].length - 1, strict: false, noParens: true };
      m = SH_PAREN.exec(text);
      if (m) return { name: m[1], end: m.index + m[0].length, strict: false, noParens: true };
      return null;
    }
    m = C_METHOD.exec(text);
    if (m && !NOT_A_NAME[m[1]]) return { name: m[1], end: m.index + m[0].length - 1, strict: true };
    return null;
  }

  function braceFunctions(code, langKey) {
    var lines = code.split('\n');
    var offsets = [];
    var acc = 0;
    var i;
    for (i = 0; i < lines.length; i++) { offsets.push(acc); acc += lines[i].length + 1; }

    function lineOf(pos) {
      var lo = 0, hi = offsets.length - 1;
      while (lo < hi) {
        var mid = (lo + hi + 1) >> 1;
        if (offsets[mid] <= pos) lo = mid; else hi = mid - 1;
      }
      return lo;
    }

    var found = [];
    for (i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      var header = logicalHeader(lines, i, offsets);
      var sig = matchSignature(header.text, langKey);
      if (!sig) continue;

      var params = sig.params || [];
      var afterHead = header.start + sig.end;
      if (!sig.noParens) {
        var openParen = code.indexOf('(', header.start + sig.end);
        if (openParen < 0) continue;
        var group = parenGroup(code, openParen);
        if (!group) continue;
        if (sig.strict && looksLikeCall(group.text)) continue;
        params = splitParams(group.text);
        afterHead = group.end;
      }

      var open = findBodyBrace(code, afterHead);
      if (open < 0) continue;
      var close = matchBrace(code, open);
      if (close < 0) continue;

      var startLine = lineOf(header.start);
      var endLine = lineOf(close);
      found.push({
        name: sig.name,
        startLine: startLine + 1,
        endLine: endLine + 1,
        params: params,
        bodyText: code.slice(open + 1, close),
        bodyLines: lines.slice(startLine, endLine + 1)
      });
      // No skip-ahead: a nested closure gets its own row; `annotate` records containment.
    }
    return found;
  }

  /* A tab is four columns, not eight: the question is blocks deep, not screen
   * width, and nestingOf infers the unit from the gaps anyway. */
  function indentWidth(line) {
    var w = 0;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === ' ') w++;
      else if (c === '\t') w += 4;
      else break;
    }
    return w;
  }

  var PY_DEF = /^([ \t]*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;

  function pythonFunctions(code) {
    var lines = code.split('\n');
    var found = [];

    for (var i = 0; i < lines.length; i++) {
      var m = PY_DEF.exec(lines[i]);
      if (!m) continue;

      // The signature may wrap; walk to the line where the parens balance.
      var depth = 0;
      var last = i;
      var scan = i;
      do {
        var line = lines[scan];
        for (var k = 0; k < line.length; k++) {
          if (line.charAt(k) === '(') depth++;
          else if (line.charAt(k) === ')') depth--;
        }
        last = scan;
        scan++;
      } while (depth > 0 && scan < lines.length && scan - i < 12);

      var headText = lines.slice(i, last + 1).join('\n');
      var openParen = headText.indexOf('(');
      var group = parenGroup(headText, openParen);
      var params = group ? splitParams(group.text) : [];
      // `self` and `cls` are supplied by the call, not chosen by the caller.
      if (params.length && (params[0] === 'self' || params[0] === 'cls')) params.shift();

      /* Body = following lines indented past the `def`. A dedented docstring line
       * cannot end it: `strip` blanked it. */
      var base = indentWidth(m[1]);
      var end = last;
      for (var j = last + 1; j < lines.length; j++) {
        if (!lines[j].trim()) continue;
        if (indentWidth(lines[j]) <= base) break;
        end = j;
      }

      found.push({
        name: m[2],
        startLine: i + 1,
        endLine: end + 1,
        params: params,
        bodyText: lines.slice(last + 1, end + 1).join('\n'),
        bodyLines: lines.slice(i, end + 1)
      });
    }
    return found;
  }

  // Top-level commas only; `strip` already removed commas inside string defaults.
  function splitParams(text) {
    var out = [];
    var depth = 0;
    var buf = '';
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      /* `=>` is not a closing angle bracket; counted as one it drove depth negative
       * and `f(cb = (x) => x, y, z)` read as one parameter. `Math.max` covers `b > c`. */
      if (c === '>' && text.charAt(i - 1) === '=') { buf += c; continue; }
      if (c === '(' || c === '[' || c === '{' || c === '<') depth++;
      else if (c === ')' || c === ']' || c === '}' || c === '>') depth = Math.max(0, depth - 1);
      if (c === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue; }
      buf += c;
    }
    if (buf.trim()) out.push(buf.trim());
    return out.filter(function (p) { return p !== '' && p !== 'void'; });
  }

  /* Records containment. A closure is measured twice, on its own row and in its
   * parent's figures, and the UI says so. */
  function annotate(list) {
    list.sort(function (a, b) { return a.startLine - b.startLine || b.endLine - a.endLine; });

    var counts = {};
    list.forEach(function (fn, i) {
      fn.id = fn.name + '@' + fn.startLine;
      var parent = null;
      for (var j = i - 1; j >= 0; j--) {
        if (list[j].startLine <= fn.startLine && list[j].endLine >= fn.endLine) { parent = list[j]; break; }
      }
      // Counted by id, not name: two `render`s in one file must not share children.
      fn.parent = parent ? parent.name : null;
      fn.parentId = parent ? parent.id : null;
      if (parent) counts[parent.id] = (counts[parent.id] || 0) + 1;
    });

    list.forEach(function (fn) { fn.children = counts[fn.id] || 0; });
    return list;
  }

  function functions(source, langKey) {
    var key = LANGS[langKey] ? langKey : guessLanguage(source);
    if (!key) return [];
    var code = strip(source, key);
    var list = LANGS[key].family === 'indent' ? pythonFunctions(code) : braceFunctions(code, key);
    return annotate(list);
  }

  global.RP_DETECT = {
    LANGS: LANGS,
    ORDER: ORDER,
    strip: strip,
    guessLanguage: guessLanguage,
    functions: functions,
    indentWidth: indentWidth,
    splitParams: splitParams
  };
})(window);
