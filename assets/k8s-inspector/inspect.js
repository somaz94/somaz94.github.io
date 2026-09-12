/* assets/k8s-inspector/inspect.js
 * Splitting, parsing, conversion and rule evaluation.
 *
 * Pure by design: no DOM, no storage, no network. ui.js owns all three. Keeping
 * the split here means a rule can be reasoned about — and later tested — without
 * a page around it.
 *
 * Hand-maintained.
 */
(function (global) {
  'use strict';

  var YAML = global.jsyaml;   // vendored, see yaml.js

  /* A `---` at column 0 is always a document marker, never content. Block
   * scalars and multi-line quoted scalars are continuations of a mapping key, so
   * their lines are indented past that key and column 0 is unreachable from
   * inside one. That is what makes splitting safe without a full parse, and it is
   * why the pattern anchors at the line start with no leading whitespace allowed.
   *
   * Each entry carries the line it began on, so a parse failure can be reported
   * against the source the user is actually looking at. */
  function splitDocuments(source) {
    var lines = String(source == null ? '' : source).split('\n');
    var docs = [];
    var cur = [];
    var startLine = 1;

    function flush(endLine) {
      docs.push({ text: cur.join('\n'), startLine: startLine, endLine: endLine });
    }

    for (var i = 0; i < lines.length; i++) {
      /* A `%YAML` / `%TAG` directive belongs to the document that follows its
       * `---`, not to the one before it. Splitting on the marker alone stranded
       * the directive as a document of its own, and js-yaml then rejected the
       * real document with "directives end mark is expected" — a parse error the
       * input never contained. */
      if (/^%/.test(lines[i]) && cur.join('').trim() === '') {
        cur.push(lines[i]);
        continue;
      }
      // `---` alone or `--- # comment`. `----` is not a marker.
      if (/^---(\s.*)?$/.test(lines[i])) {
        // Keep a directive attached to the document it introduces.
        if (cur.length && cur.every(function (l) { return /^%/.test(l) || !l.trim(); })) {
          cur.push(lines[i]);
          continue;
        }
        // A leading marker opens the first document rather than closing an empty
        // one, so nothing is flushed until there is content behind it.
        if (cur.length || docs.length) flush(i);
        cur = [];
        startLine = i + 2;
        continue;
      }
      // `...` ends a document without opening the next.
      if (/^\.\.\.(\s.*)?$/.test(lines[i])) {
        flush(i);
        cur = [];
        startLine = i + 2;
        continue;
      }
      cur.push(lines[i]);
    }
    flush(lines.length);

    return docs.filter(function (d) { return d.text.trim() !== ''; });
  }

  function looksLikeJson(source) {
    var t = String(source == null ? '' : source).trim();
    return t.charAt(0) === '{' || t.charAt(0) === '[';
  }

  /* js-yaml reports `mark.line` zero-based and relative to the string it was
   * handed, so a per-document parse has to offset it back onto the whole input —
   * otherwise every error after the first `---` points at the wrong line. */
  function messageOf(err, startLine) {
    var msg = (err && err.reason) || (err && err.message) || String(err);
    var line = err && err.mark && typeof err.mark.line === 'number'
      ? startLine + err.mark.line
      : null;
    return line ? 'line ' + line + ': ' + msg : msg;
  }

  /* Parses documents one at a time rather than through `loadAll`, so a typo in
   * document 4 is reported as document 4 and does not silently hide 1 to 3.
   * Every document comes back in input order, each either parsed or errored. */
  function parse(source) {
    var text = String(source == null ? '' : source);
    if (!text.trim()) return { format: null, docs: [], error: null };

    if (looksLikeJson(text)) {
      try {
        var value = JSON.parse(text);
        // A JSON array, or a List — the shape `kubectl get -o json` emits.
        var list = Array.isArray(value) ? value
          : (value && value.kind === 'List' && Array.isArray(value.items)) ? value.items
          : [value];
        return {
          format: 'json',
          docs: list.map(function (v, i) {
            return { index: i, value: v, error: null, startLine: 1 };
          }),
          error: null
        };
      } catch (err) {
        return { format: 'json', docs: [], error: err.message };
      }
    }

    if (!YAML) return { format: 'yaml', docs: [], error: 'The YAML parser did not load.' };

    var loaded = splitDocuments(text).map(function (d) {
      try {
        return { value: YAML.load(d.text), error: null, startLine: d.startLine };
      } catch (err) {
        return { value: null, error: messageOf(err, d.startLine), startLine: d.startLine };
      }
    });

    return {
      format: 'yaml',
      /* An empty document — comments only, or a bare `~` — carries nothing to
       * inspect. `helm template` emits one for every template that rendered
       * empty, and reporting those as "not a Kubernetes resource" turns ordinary
       * output into warnings. Note the test is `== null`, covering both: js-yaml
       * returns `null` for a comment-only document and `undefined` only for one
       * that is genuinely blank. Indexes are reassigned after the filter so
       * document numbers stay contiguous. */
      docs: loaded
        .filter(function (d) { return d.error || d.value != null; })
        .map(function (d, i) { d.index = i; return d; }),
      error: null
    };
  }

  function describe(value, index) {
    var meta = (value && typeof value === 'object' && value.metadata) || {};
    return {
      kind: (value && value.kind) || null,
      name: (meta && meta.name) || null,
      namespace: (meta && meta.namespace) || null,
      apiVersion: (value && value.apiVersion) || null,
      index: index
    };
  }

  function applies(check, kind) {
    if (!check.appliesTo) return true;   // every kind
    return check.appliesTo.indexOf(kind) >= 0;
  }

  /* Runs the rule table over the parsed documents. Each resource keeps its own
   * findings so the report can be read one resource at a time, and also keeps
   * `passed` — the rules that ran and found nothing. Without that list a clean
   * resource and an unchecked one look identical, which is the difference
   * between "this is fine" and "nothing here was examined". */
  function inspect(parsed) {
    var rules = (global.KI_RULES && global.KI_RULES.checks) || [];
    var values = parsed.docs
      .filter(function (d) { return !d.error && d.value && typeof d.value === 'object'; })
      .map(function (d) { return d.value; });

    return parsed.docs.map(function (d) {
      var info = describe(d.value, d.index);

      if (d.error) {
        return {
          info: info,
          findings: [{
            id: 'parse-error',
            severity: 'error',
            title: 'Could not be parsed',
            where: 'document ' + (d.index + 1),
            detail: d.error
          }],
          passed: []
        };
      }

      if (!d.value || typeof d.value !== 'object' || Array.isArray(d.value)) {
        return {
          info: info,
          findings: [{
            id: 'not-a-resource',
            severity: 'warn',
            title: 'Not a Kubernetes resource',
            where: 'document ' + (d.index + 1),
            detail: 'It parsed, but it is not a mapping with apiVersion and kind, so no ' +
              'rule applies to it.'
          }],
          passed: []
        };
      }

      var findings = [];
      var passed = [];

      if (!info.kind || !info.apiVersion) {
        findings.push({
          id: 'missing-type-fields',
          severity: 'error',
          title: info.kind ? 'No apiVersion' : 'No kind',
          where: 'document ' + (d.index + 1),
          detail: 'A resource needs both apiVersion and kind. Without them the API server ' +
            'cannot route it, and most rules here cannot run either.'
        });
      }

      rules.forEach(function (check) {
        if (!applies(check, info.kind)) return;
        var hits;
        try {
          hits = check.test(d.value, values) || [];
        } catch (err) {
          // A rule that throws must not take the report down with it — a
          // half-typed manifest reaches shapes no rule anticipated.
          hits = [];
        }
        if (!hits.length) {
          passed.push({ id: check.id, title: check.title });
          return;
        }
        hits.forEach(function (hit) {
          findings.push({
            id: check.id,
            severity: check.severity,
            title: check.title,
            where: hit.where,
            detail: hit.detail
          });
        });
      });

      return { info: info, findings: findings, passed: passed };
    });
  }

  function tally(resources) {
    var out = { error: 0, warn: 0, ok: 0 };
    resources.forEach(function (r) {
      r.findings.forEach(function (f) {
        if (f.severity === 'error') out.error++;
        else if (f.severity === 'warn') out.warn++;
      });
      out.ok += r.passed.length;
    });
    return out;
  }

  function firstError(parsed) {
    if (parsed.error) return parsed.error;
    var bad = parsed.docs.filter(function (d) { return d.error; })[0];
    return bad ? bad.error : null;
  }

  /* The two directions behind the one topbar button. `toYAML` is why the
   * vendored parser had to ship a dumper as well. Both throw on unparseable
   * input; ui.js turns that into the parse-error strip rather than swallowing it. */
  function toJSON(source) {
    var parsed = parse(source);
    var err = firstError(parsed);
    if (err) throw new Error(err);
    var values = parsed.docs.map(function (d) { return d.value; });
    return JSON.stringify(values.length === 1 ? values[0] : values, null, 2) + '\n';
  }

  function toYAML(source) {
    var parsed = parse(source);
    var err = firstError(parsed);
    if (err) throw new Error(err);
    if (!YAML) throw new Error('The YAML parser did not load.');
    // `lineWidth: -1` keeps long values on one line. The default wraps at 80 and
    // folds image references and annotations into something nobody pasted.
    return parsed.docs.map(function (d) {
      return YAML.dump(d.value, { lineWidth: -1, noRefs: true });
    }).join('---\n');
  }

  global.KI_INSPECT = {
    splitDocuments: splitDocuments,
    parse: parse,
    inspect: inspect,
    tally: tally,
    toJSON: toJSON,
    toYAML: toYAML
  };
})(window);
