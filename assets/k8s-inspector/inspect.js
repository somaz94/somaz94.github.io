/* assets/k8s-inspector/inspect.js
 * Splitting, parsing, conversion and rule evaluation.
 *
 * Pure: no DOM, no storage, no network (ui.js owns all three), so a rule can be
 * tested without a page around it.
 */
(function (global) {
  'use strict';

  var YAML = global.jsyaml;   // vendored, see yaml.js

  /* A `---` at column 0 is always a document marker: block and multi-line
   * quoted scalars continue a mapping key, so they are always indented. That is
   * what makes splitting safe without a full parse, and why the pattern allows
   * no leading whitespace. Each entry keeps its start line for error reports. */
  function splitDocuments(source) {
    var lines = String(source == null ? '' : source).split('\n');
    var docs = [];
    var cur = [];
    var startLine = 1;

    function flush(endLine) {
      docs.push({ text: cur.join('\n'), startLine: startLine, endLine: endLine });
    }

    for (var i = 0; i < lines.length; i++) {
      /* A `%YAML` / `%TAG` directive belongs to the document after its `---`;
       * stranded on its own, js-yaml rejects the real document with
       * "directives end mark is expected". */
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

  /* One document at a time rather than `loadAll`, so a typo in document 4 is
   * reported as document 4 instead of hiding 1 to 3. */
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
      /* Drop empty documents: `helm template` emits one per template that
       * rendered empty. `== null` on purpose — js-yaml returns `null` for a
       * comment-only document, `undefined` only for a blank one. Indexes are
       * reassigned so document numbers stay contiguous. */
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

  /* Each resource also keeps `passed`, the rules that ran and found nothing:
   * without it a clean resource and an unchecked one look identical. */
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

  /* Both throw on unparseable input; ui.js shows it on the parse-error strip. */
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
    // `lineWidth: -1`: the default wraps at 80 and folds image references.
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
