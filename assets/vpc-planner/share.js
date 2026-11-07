/* assets/vpc-planner/share.js — the plan input carried in the location hash,
 * the tool's only persistence. No DOM beyond `location`, no network.
 *
 *   - The INPUT goes in the hash, never the plan: an encoded result would
 *     outlive a fix to the split and keep reproducing the wrong answer.
 *   - The hash is untrusted: `decode` validates field by field, null otherwise.
 *   - Versioned: an unknown version decodes to null rather than as v1.
 *   - `history.replaceState`, not `location.hash =`, so Back does not walk
 *     through every keystroke.
 */
(function (global) {
  'use strict';

  var VERSION = 1;
  /* Prefixed: every tool on this blog shares one origin. */
  var PARAM = 'vp';

  /* plan.js's bounds, read rather than restated, or a link made from a valid
   * form could decode to null. plan.js loads before this file. */
  var LIMITS = global.VPPlan.LIMITS;
  var MAX_SUBNETS = LIMITS.subnets;
  var MAX_AZS = LIMITS.azs;
  var MAX_EXISTING = LIMITS.existing;
  var MAX_TEXT = LIMITS.text;
  /* A longer hash is probing, not a shared link; bail before base64-decoding. */
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

  /* input -> the string after "#"; '' for an empty plan keeps the URL clean. */
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

  /* The string after "#" -> input, or null. */
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

  function read() {
    return decode(global.location ? global.location.hash.replace(/^#/, '') : '');
  }

  function write(input) {
    if (!global.history || !global.history.replaceState) { return; }
    var encoded = encode(input);
    var url = global.location.pathname + global.location.search + (encoded ? '#' + encoded : '');
    try {
      global.history.replaceState(null, '', url);
    } catch (err) {
      /* Refused in a sandboxed iframe or on file://; the tool works without it. */
    }
  }

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
