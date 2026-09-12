/* assets/vpc-planner/cidr.js
 * IPv4 address and CIDR primitives.
 *
 * Pure by design: no DOM, no storage, no network. Everything above this file
 * depends on it; it depends on nothing. That is what makes a split rule testable
 * without a page around it.
 *
 * Hand-maintained. Nothing generates this file.
 *
 * Two traps this file deliberately avoids rather than works around:
 *   - JavaScript bitwise operators coerce to SIGNED 32-bit, so `10.0.0.0/8`
 *     survives but anything at or above 128.0.0.0 comes back negative. Nothing
 *     here uses `<<`, `>>` or `&` on an address. Every derivation is plain
 *     arithmetic on a Number, which is exact well past 2^32.
 *   - `1 << 32` is 1, not 4294967296, because the shift count is taken mod 32.
 *     `size()` uses Math.pow for the same reason.
 */
(function (global) {
  'use strict';

  /* AWS reserves five addresses in every subnet: network, VPC router, DNS, a
   * fourth held for future use, and broadcast. On a /28 that is 5 of 16, which
   * is the difference the tool exists to show. */
  var AWS_RESERVED = 5;

  var SPACE = 4294967296;          /* 2^32 — one past the last IPv4 address. */

  /* An octet, rejecting a leading zero: "010" is octal in some resolvers and
   * decimal in others, so it is never a safe thing to accept. */
  var OCTET = /^(0|[1-9][0-9]{0,2})$/;
  var CIDR_RE = /^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\/([0-9]{1,2})$/;
  var DOTTED_RE = /^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/;

  /* uint32 <-> dotted quad. Kept separate from parse/format so the table can
   * print a first and last address without re-deriving a block. */
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

  /* Total addresses in the block: 2^(32 - prefix). */
  function size(block) {
    return Math.pow(2, 32 - block.prefix);
  }

  /* "10.0.0.0/16" -> { addr: <uint32>, prefix: 16 }, or null when the text is
   * not a well-formed IPv4 CIDR. Returning null rather than throwing keeps the
   * caller's error handling in one place — the input strip beside the field.
   *
   * Rejects a host bit set below the prefix ("10.0.1.0/16"), an octet over 255,
   * a prefix outside 0..32, a leading zero, and IPv6 in any form — the regex
   * admits no colons, so "::1/128" never reaches the numeric checks. */
  function parse(text) {
    var m = CIDR_RE.exec(String(text == null ? '' : text).trim());
    if (!m) { return null; }
    if (!OCTET.test(m[5])) { return null; }

    var prefix = Number(m[5]);
    if (prefix > 32) { return null; }

    var addr = toInt(m[1] + '.' + m[2] + '.' + m[3] + '.' + m[4]);
    if (addr === null) { return null; }

    /* Aligned to its own size is the same statement as "no host bits set", and
     * says it without a mask that would have to survive prefix 0. */
    if (addr % Math.pow(2, 32 - prefix) !== 0) { return null; }

    return { addr: addr, prefix: prefix };
  }

  /* { addr, prefix } -> "10.0.0.0/16". */
  function format(block) {
    if (!block) { return ''; }
    return fromInt(block.addr) + '/' + block.prefix;
  }

  /* First and last address of the block as uint32, inclusive. */
  function range(block) {
    if (!block) { return null; }
    return { first: block.addr, last: block.addr + size(block) - 1 };
  }

  /* Does `outer` fully contain `inner`? Not on any hot path — allocate() bounds
   * its cursor directly — but it is the assertion the split's containment
   * invariant is checked with, and a CIDR primitive set without it is missing an
   * obvious half of `overlaps`. */
  function contains(outer, inner) {
    var o = range(outer);
    var i = range(inner);
    if (!o || !i) { return false; }
    return o.first <= i.first && i.last <= o.last;
  }

  /* Do the two blocks share any address? Overlap is symmetric and includes the
   * containment case — a /24 inside a /16 overlaps it. Two adjacent blocks do
   * not overlap, which is why this is `<=` on the far edge and not `<`. */
  function overlaps(a, b) {
    var x = range(a);
    var y = range(b);
    if (!x || !y) { return false; }
    return x.first <= y.last && y.first <= x.last;
  }

  /* Assignable addresses in the block. `awsReserved` false gives the plain host
   * count (size - network - broadcast); true subtracts AWS's five. Never
   * negative: a /31 or /32 clamps to 0, which is also the truthful answer —
   * AWS does not offer either as a subnet. */
  function usableHosts(block, awsReserved) {
    if (!block) { return 0; }
    var n = size(block) - (awsReserved ? AWS_RESERVED : 2);
    return n > 0 ? n : 0;
  }

  /* The largest power of two that divides `n` — i.e. the biggest block that may
   * legally start at this address. 0 is aligned to the whole space.
   * Arithmetic rather than `n & -n`, which would go signed above 2^31. */
  function alignmentAt(n) {
    if (n === 0) { return SPACE; }
    var v = 1;
    while (n % (v * 2) === 0) { v *= 2; }
    return v;
  }

  /* The largest power of two not exceeding `n`. */
  function floorPow2(n) {
    var v = 1;
    while (v * 2 <= n) { v *= 2; }
    return v;
  }

  /* An inclusive address interval expressed as the fewest CIDR blocks that
   * cover it exactly. The standard greedy walk: at each step take the largest
   * block that both starts legally here and still fits in what is left. */
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
