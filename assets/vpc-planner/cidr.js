/* assets/vpc-planner/cidr.js — IPv4 address and CIDR primitives.
 * Pure: no DOM, no storage, no network, no dependencies.
 *
 * No bitwise operators on an address: they coerce to SIGNED 32-bit (anything
 * at or above 128.0.0.0 goes negative) and `1 << 32` is 1. Plain arithmetic only.
 */
(function (global) {
  'use strict';

  /* AWS reserves five per subnet: network, VPC router, DNS, future use, broadcast. */
  var AWS_RESERVED = 5;

  var SPACE = 4294967296;          /* 2^32 — one past the last IPv4 address. */

  /* An octet, rejecting a leading zero: "010" is octal in some resolvers and
   * decimal in others, so it is never a safe thing to accept. */
  var OCTET = /^(0|[1-9][0-9]{0,2})$/;
  var CIDR_RE = /^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\/([0-9]{1,2})$/;
  var DOTTED_RE = /^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/;

  /* uint32 <-> dotted quad. */
  function toInt(dotted) {
    var m = DOTTED_RE.exec(String(dotted).trim());
    if (!m) { return null; }
    var n = 0;
    for (var i = 1; i <= 4; i++) {
      if (!OCTET.test(m[i])) { return null; }
      var octet = Number(m[i]);
      if (octet > 255) { return null; }
      n = n * 256 + octet;
    }
    return n;
  }

  function fromInt(n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0 || n >= SPACE) { return ''; }
    var v = Math.floor(n);
    return [
      Math.floor(v / 16777216) % 256,
      Math.floor(v / 65536) % 256,
      Math.floor(v / 256) % 256,
      v % 256
    ].join('.');
  }

  function size(block) {
    return Math.pow(2, 32 - block.prefix);
  }

  /* "10.0.0.0/16" -> { addr: <uint32>, prefix: 16 }, or null (never throws).
   * Rejects host bits below the prefix ("10.0.1.0/16"), an octet over 255, a
   * prefix outside 0..32, a leading zero, and IPv6. */
  function parse(text) {
    var m = CIDR_RE.exec(String(text == null ? '' : text).trim());
    if (!m) { return null; }
    if (!OCTET.test(m[5])) { return null; }

    var prefix = Number(m[5]);
    if (prefix > 32) { return null; }

    var addr = toInt(m[1] + '.' + m[2] + '.' + m[3] + '.' + m[4]);
    if (addr === null) { return null; }

    /* "No host bits set", without a mask that would have to survive prefix 0. */
    if (addr % Math.pow(2, 32 - prefix) !== 0) { return null; }

    return { addr: addr, prefix: prefix };
  }

  function format(block) {
    if (!block) { return ''; }
    return fromInt(block.addr) + '/' + block.prefix;
  }

  /* Inclusive uint32 bounds. */
  function range(block) {
    if (!block) { return null; }
    return { first: block.addr, last: block.addr + size(block) - 1 };
  }

  /* Does `outer` fully contain `inner`? The page never calls it; kept as the
   * counterpart of `overlaps` for checking the split by hand. */
  function contains(outer, inner) {
    var o = range(outer);
    var i = range(inner);
    if (!o || !i) { return false; }
    return o.first <= i.first && i.last <= o.last;
  }

  /* Any shared address, containment included. Adjacent blocks do not overlap. */
  function overlaps(a, b) {
    var x = range(a);
    var y = range(b);
    if (!x || !y) { return false; }
    return x.first <= y.last && y.first <= x.last;
  }

  /* Assignable addresses; `awsReserved` subtracts five instead of two. A /31 or
   * /32 clamps to 0; AWS offers neither as a subnet. */
  function usableHosts(block, awsReserved) {
    if (!block) { return 0; }
    var n = size(block) - (awsReserved ? AWS_RESERVED : 2);
    return n > 0 ? n : 0;
  }

  /* The biggest block that may legally start at `n`. Not `n & -n`, which goes
   * signed above 2^31. */
  function alignmentAt(n) {
    if (n === 0) { return SPACE; }
    var v = 1;
    while (n % (v * 2) === 0) { v *= 2; }
    return v;
  }

  function floorPow2(n) {
    var v = 1;
    while (v * 2 <= n) { v *= 2; }
    return v;
  }

  /* Fewest CIDR blocks covering an inclusive interval: greedy, largest aligned
   * block that still fits. */
  function coverRange(first, last) {
    var out = [];
    var start = first;
    while (start <= last) {
      var block = Math.min(alignmentAt(start), floorPow2(last - start + 1));
      out.push({ addr: start, prefix: 32 - Math.round(Math.log(block) / Math.LN2) });
      start += block;
    }
    return out;
  }

  global.VPCidr = {
    AWS_RESERVED: AWS_RESERVED,
    SPACE: SPACE,
    parse: parse,
    format: format,
    toInt: toInt,
    fromInt: fromInt,
    size: size,
    range: range,
    contains: contains,
    overlaps: overlaps,
    usableHosts: usableHosts,
    alignmentAt: alignmentAt,
    floorPow2: floorPow2,
    coverRange: coverRange
  };
})(this);
