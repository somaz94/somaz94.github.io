/* assets/vpc-planner/share.js
 * The plan input carried in the location hash.
 *
 * No DOM beyond `location` and no network. The hash is the only state this tool
 * persists — deliberately. A share link that reproduces a plan is worth more
 * than a localStorage slot, and it cannot go stale against a schema the user
 * never sees.
 *
 * Hand-maintained. Nothing generates this file.
 *
 * Rules held here:
 *   - The INPUT goes in the hash, never the computed plan. Encoding the result
 *     would let a link outlive a fix to the split algorithm and keep reproducing
 *     the old, wrong answer.
 *   - The hash is untrusted input. `decode` validates field by field — mode is
 *     one of two literals, counts are integers in range, `existing` is an array
 *     of strings capped at a sane length — and returns null on anything else. It
 *     never hands a parsed object straight to the form.
 *   - The payload is versioned. An unknown version decodes to null rather than
 *     being read as v1, which is what makes a later format change safe.
 *   - Writing the hash uses `history.replaceState`, not `location.hash = …`:
 *     the latter pushes a history entry on every debounce tick and the back
 *     button ends up walking back through every keystroke.
 *   - Base64 is done here, locally, over UTF-8 bytes. No CDN, no remote worker,
 *     no compression library — the page is expected to work offline.
 */
(function (global) {
  'use strict';

  var VERSION = 1;
  /* Prefixed even though the hash is per-page: every tool on this blog shares
   * one origin, and the same prefix rule applies to any storage key added
   * later. */
  var PARAM = 'vp';

  /* The bounds a decoded hash is validated against are plan.js's, read rather
   * than restated — the two have to agree or a link made from a valid form would
   * decode to null. Load order is cidr → plan → share → ui, so VPPlan exists by
   * the time this runs. */
  var LIMITS = global.VPPlan.LIMITS;
  var MAX_SUBNETS = LIMITS.subnets;
  var MAX_AZS = LIMITS.azs;
  var MAX_EXISTING = LIMITS.existing;
  var MAX_TEXT = LIMITS.text;
  /* This one is share-specific and belongs here: a hash longer than this is not
   * a link anyone shared, it is someone probing. Bail before base64-decoding. */
  var MAX_HASH = 8192;

  function bytesToBase64Url(str) {
    var bytes = new global.TextEncoder().encode(str);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return global.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToString(value) {
    var b64 = String(value).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) { b64 += '='; }
    var binary = global.atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new global.TextDecoder().decode(bytes);
  }

  /* input -> the string that goes after "#". Returns '' for an empty plan so the
   * URL of an untouched page stays clean. */
  function encode(input) {
    if (!input || !input.cidr) { return ''; }
    try {
      var payload = {
        v: VERSION,
        c: input.cidr,
        m: input.mode,
        n: input.count,
        p: input.prefixes,
        z: input.azs,
        x: input.namePrefix,
        r: input.awsReserved ? 1 : 0,
        e: input.existing
      };
      return PARAM + '=' + bytesToBase64Url(JSON.stringify(payload));
    } catch (err) {
      return '';
    }
  }

  function isPlainString(v) {
    return typeof v === 'string';
  }

  function validInt(v, lo, hi) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= lo && v <= hi;
  }

  function validStringArray(v, maxItems) {
    if (Object.prototype.toString.call(v) !== '[object Array]') { return false; }
    if (v.length > maxItems) { return false; }
    for (var i = 0; i < v.length; i++) {
      if (!isPlainString(v[i]) || v[i].length > MAX_TEXT) { return false; }
    }
    return true;
  }

  /* The string after "#" -> input, or null when it is absent, malformed, a
   * version this build does not know, or fails field-by-field validation. */
  function decode(hash) {
    var raw = String(hash == null ? '' : hash).replace(/^#/, '');
    if (!raw || raw.length > MAX_HASH) { return null; }

    var marker = PARAM + '=';
    if (raw.indexOf(marker) !== 0) { return null; }

    var data;
    try {
      data = JSON.parse(base64UrlToString(raw.slice(marker.length)));
    } catch (err) {
      return null;
    }

    if (!data || typeof data !== 'object') { return null; }
    if (data.v !== VERSION) { return null; }

    if (!isPlainString(data.c) || !data.c.length || data.c.length > MAX_TEXT) { return null; }
    if (data.m !== 'even' && data.m !== 'weighted') { return null; }
    if (!validInt(data.n, 1, MAX_SUBNETS)) { return null; }
    if (!validInt(data.z, 1, MAX_AZS)) { return null; }
    if (!isPlainString(data.x) || data.x.length > MAX_TEXT) { return null; }
    if (data.r !== 0 && data.r !== 1) { return null; }
    if (!validStringArray(data.e, MAX_EXISTING)) { return null; }

    if (Object.prototype.toString.call(data.p) !== '[object Array]') { return null; }
    if (data.p.length > MAX_SUBNETS) { return null; }
    for (var i = 0; i < data.p.length; i++) {
      if (!validInt(data.p[i], 0, 32)) { return null; }
    }

    return {
      cidr: data.c,
      mode: data.m,
      count: data.n,
      prefixes: data.p,
      azs: data.z,
      namePrefix: data.x,
      awsReserved: data.r === 1,
      existing: data.e
    };
  }

  /* Reads the current location. Called once on load, before any input event, so
   * a shared link wins over the empty form. */
  function read() {
    return decode(global.location ? global.location.hash.replace(/^#/, '') : '');
  }

  /* Replaces the hash in place — see the `replaceState` note above. */
  function write(input) {
    if (!global.history || !global.history.replaceState) { return; }
    var encoded = encode(input);
    var url = global.location.pathname + global.location.search + (encoded ? '#' + encoded : '');
    try {
      global.history.replaceState(null, '', url);
    } catch (err) {
      /* A sandboxed iframe or a file:// origin refuses this. The tool works
       * without a shareable URL, so there is nothing to tell the user. */
    }
  }

  /* The absolute URL to hand to the clipboard. */
  function link(input) {
    var base = global.location.origin + global.location.pathname;
    var encoded = encode(input);
    return encoded ? base + '#' + encoded : base;
  }

  global.VPShare = {
    VERSION: VERSION,
    PARAM: PARAM,
    encode: encode,
    decode: decode,
    read: read,
    write: write,
    link: link
  };
})(this);
