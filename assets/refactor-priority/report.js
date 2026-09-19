/* assets/refactor-priority/report.js
 * The ranking as a Markdown table, for the Copy button.
 *
 * Pure: no DOM, no clipboard, no network. ui.js owns the clipboard call — this
 * file only produces the text, so the format can be checked without a page.
 *
 * Hand-maintained.
 */
(function (global) {
  'use strict';

  /* A pipe inside a cell ends the cell. Function names can contain one in a
   * couple of the supported languages (a shell function may be named `a|b` only
   * in theory, but a TypeScript method name arrives here verbatim from the
   * source and this file must not be the thing that decides it is safe). */
  function cell(text) {
    return String(text == null ? '' : text).replace(/\|/g, '\\|');
  }

  function severityWord(severity) {
    return severity === 'high' ? 'High' : severity === 'medium' ? 'Medium' : 'Low';
  }

  /* The header states the limits the numbers are being judged against. Pasted
   * into a review or an issue, the table travels away from the page that
   * explains it, and a column of bare figures invites the reader to supply their
   * own thresholds. */
  function toMarkdown(rows, meta) {
    var limits = global.RP_SCORE.LIMITS;
    var info = meta || {};
    var out = [];

    out.push('## Refactoring shortlist');
    out.push('');

    var summary = [];
    if (info.language) summary.push('Language: ' + info.language);
    summary.push(rows.length + (rows.length === 1 ? ' function' : ' functions'));
    if (info.totalLines) summary.push(info.totalLines + ' lines scanned');
    out.push(summary.join(' · '));
    out.push('');
    out.push('Limits applied: complexity ' + limits.complexity + ', nesting ' + limits.nesting +
      ', lines ' + limits.sloc + ', parameters ' + limits.params + '.');
    out.push('');

    if (!rows.length) {
      out.push('No functions were found in the input.');
      out.push('');
    } else {
      out.push('| # | Function | Lines | Complexity | Nesting | Params | Score | Severity | Why |');
      out.push('|---:|---|---|---:|---:|---:|---:|---|---|');
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        out.push([
          '',
          i + 1,
          '`' + cell(r.name) + '`' + (r.parent ? ' (in `' + cell(r.parent) + '`)' : ''),
          r.startLine + '–' + r.endLine,
          r.metrics.complexity,
          r.metrics.nesting,
          r.metrics.params,
          r.score,
          severityWord(r.severity),
          cell(r.driver.text),
          ''
        ].join(' | ').trim());
      }
      out.push('');
    }

    out.push('Function boundaries are found with brace and indentation heuristics rather than a ' +
      'parser, so this is a shortlist to review, not an exact measurement. A nested function is ' +
      'counted on its own row and again inside the figures of the function containing it.');
    out.push('');
    return out.join('\n');
  }

  global.RP_REPORT = { toMarkdown: toMarkdown };
})(window);
