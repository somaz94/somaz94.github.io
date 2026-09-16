/* assets/vpc-planner/plan.js
 * Splitting, availability-zone layout and overlap detection.
 *
 * Pure by design: no DOM, no storage, no network. ui.js owns all three. Depends
 * only on cidr.js.
 *
 * Hand-maintained. Nothing generates this file.
 *
 * The shape everything downstream agrees on:
 *
 *   input  = {
 *     cidr: "10.0.0.0/16",
 *     mode: "even" | "weighted",
 *     count: 6,                    // mode "even"
 *     prefixes: [24, 24, 26],      // mode "weighted"
 *     azs: 3,
 *     namePrefix: "app",
 *     awsReserved: true,
 *     existing: ["10.1.0.0/16"]
 *   }
 *
 *   plan   = {
 *     parent: { addr, prefix },
 *     subnets: [ { name, block, az, first, last, usable, clash } ],
 *     gaps:    [ { block } ],       // unallocated remainder, for the bar
 *     conflicts: [ { kind, severity, message } ],
 *     totals:  { subnets, usable, freeRatio }
 *   }
 *
 * Rules held here, all of them decided before a line was written:
 *   - Allocate largest prefix first. Smallest-first fragments the block: a /28
 *     placed at the top of a /16 makes the next /24 start at an unaligned
 *     boundary, and a subnet that is not aligned to its own size is not a valid
 *     CIDR at all.
 *   - Every subnet is aligned to its own size. That is a correctness invariant,
 *     not a nicety — it is what makes the result expressible as a CIDR.
 *   - "Even" rounds the subnet count UP to a power of two before choosing the
 *     prefix, so 6 subnets in a /16 come out as 8 x /19 and the two spares show
 *     as gaps rather than silently disappearing.
 *   - AZs are assigned round-robin, so subnet i lands in AZ (i % azs). With 6
 *     subnets and 3 AZs that is 2 per AZ; with 7 it is 3/2/2 and the imbalance
 *     stays visible in the table rather than being smoothed over.
 *   - A request that does not fit returns a plan with the subnets that DID fit
 *     plus a conflict explaining the shortfall. Returning null for "too big"
 *     would throw away a partial answer the user can act on.
 *   - Overlap detection runs twice: subnet against subnet (a bug in the split,
 *     severity "error"), and every subnet against each pasted existing range (a
 *     collision with the outside world, also "error"). A pasted range that is
 *     merely adjacent is not a conflict and is not reported.
 *   - An unparseable line in `existing` is reported as its own conflict carrying
 *     the line's text, never dropped silently.
 */
(function (global) {
  'use strict';

  var CIDR = global.VPCidr;

  var MAX_SUBNETS = 256;
  var MAX_AZS = 6;
  var MAX_EXISTING = 64;
  var MAX_TEXT = 64;

  function clampInt(value, lo, hi, fallback) {
    var n = parseInt(value, 10);
    if (!isFinite(n)) { return fallback; }
    if (n < lo) { return lo; }
    if (n > hi) { return hi; }
    return n;
  }

  /* Accepts the textarea's newlines as well as commas, because people paste
   * both and neither is more correct than the other. */
  function splitList(value) {
    if (Object.prototype.toString.call(value) === '[object Array]') {
      return value.map(function (v) { return String(v).trim(); })
        .filter(function (v) { return v.length > 0; });
    }
    return String(value == null ? '' : value)
      .split(/[\n,]+/)
      .map(function (v) { return v.trim(); })
      .filter(function (v) { return v.length > 0; });
  }

  /* Normalises whatever ui.js collected from the form into the `input` shape
   * above. Kept here rather than in ui.js so that a share link and a form
   * produce byte-identical input — the hash decodes to the same field names and
   * runs through the same funnel. */
  function normalise(raw) {
    if (!raw) { return null; }

    var cidr = String(raw.cidr == null ? '' : raw.cidr).trim();
    if (!cidr) { return null; }

    var prefixes = splitList(raw.prefixes)
      .map(function (v) { return parseInt(String(v).replace(/^\//, ''), 10); })
      .filter(function (n) { return isFinite(n) && n >= 0 && n <= 32; })
      .slice(0, MAX_SUBNETS);

    return {
      cidr: cidr.slice(0, MAX_TEXT),
      mode: raw.mode === 'weighted' ? 'weighted' : 'even',
      count: clampInt(raw.count, 1, MAX_SUBNETS, 1),
      prefixes: prefixes,
      azs: clampInt(raw.azs, 1, MAX_AZS, 1),
      namePrefix: String(raw.namePrefix == null ? '' : raw.namePrefix).trim().slice(0, MAX_TEXT),
      awsReserved: raw.awsReserved !== false,
      existing: splitList(raw.existing)
        .slice(0, MAX_EXISTING)
        .map(function (v) { return v.slice(0, MAX_TEXT); })
    };
  }

  /* The subnet blocks alone, largest first, aligned. Split out from build() so
   * the allocation can be checked without the AZ layout and naming on top.
   *
   * `prefixes` is consumed in the order given — build() sorts before calling,
   * because "largest first" is the caller's rule to state, not a surprise this
   * function springs on it. Blocks that do not fit are simply not returned;
   * build() reads the shortfall off the length. */
  function allocate(parent, prefixes) {
    var bounds = CIDR.range(parent);
    var out = [];
    var cursor = bounds.first;

    for (var i = 0; i < prefixes.length; i++) {
      var p = prefixes[i];
      if (p < parent.prefix) { continue; }        /* bigger than the VPC itself */

      var blockSize = Math.pow(2, 32 - p);
      /* Round the cursor up to this block's own alignment. */
      var start = Math.ceil(cursor / blockSize) * blockSize;
      if (start + blockSize - 1 > bounds.last) { break; }

      out.push({ addr: start, prefix: p });
      cursor = start + blockSize;
    }
    return out;
  }

  /* Unallocated remainder of the parent, expressed as the fewest CIDR blocks
   * that cover it. The bar needs the widths and the user usually wants to know
   * what is actually left to hand out. */
  function gaps(parent, subnets) {
    var bounds = CIDR.range(parent);
    var taken = subnets.map(function (s) { return CIDR.range(s.block); })
      .sort(function (a, b) { return a.first - b.first; });

    var out = [];
    var cursor = bounds.first;

    for (var i = 0; i < taken.length; i++) {
      if (taken[i].first > cursor) {
        out = out.concat(CIDR.coverRange(cursor, taken[i].first - 1));
      }
      if (taken[i].last + 1 > cursor) { cursor = taken[i].last + 1; }
    }
    if (cursor <= bounds.last) {
      out = out.concat(CIDR.coverRange(cursor, bounds.last));
    }
    return out.map(function (b) { return { block: b }; });
  }

  /* Subnet-vs-subnet and subnet-vs-existing. See the rules above for what does
   * and does not count. Marks the offending subnets so the table and the bar can
   * colour them without re-deriving the answer. */
  function findConflicts(subnets, existing) {
    var out = [];
    var i, j;

    for (i = 0; i < subnets.length; i++) {
      for (j = i + 1; j < subnets.length; j++) {
        if (CIDR.overlaps(subnets[i].block, subnets[j].block)) {
          subnets[i].clash = true;
          subnets[j].clash = true;
          out.push({
            kind: 'internal',
            severity: 'error',
            message: subnets[i].name + ' (' + CIDR.format(subnets[i].block) + ') overlaps ' +
              subnets[j].name + ' (' + CIDR.format(subnets[j].block) + ')'
          });
        }
      }
    }

    for (i = 0; i < existing.length; i++) {
      var text = existing[i];
      var block = CIDR.parse(text);
      if (!block) {
        out.push({
          kind: 'unparsed',
          severity: 'warn',
          message: 'Not a valid IPv4 CIDR, so it was not checked: ' + text
        });
        continue;
      }
      for (j = 0; j < subnets.length; j++) {
        if (CIDR.overlaps(subnets[j].block, block)) {
          subnets[j].clash = true;
          out.push({
            kind: 'external',
            severity: 'error',
            message: subnets[j].name + ' (' + CIDR.format(subnets[j].block) +
              ') collides with the range already in use ' + CIDR.format(block)
          });
        }
      }
    }
    return out;
  }

  /* input -> plan, or null when the parent CIDR itself is unusable. Every other
   * failure is a conflict inside a plan, not a null. */
  function build(input) {
    if (!input) { return null; }

    var parent = CIDR.parse(input.cidr);
    if (!parent) { return null; }

    var conflicts = [];
    var requested = [];

    if (input.mode === 'weighted') {
      if (!input.prefixes.length) { return null; }
      for (var i = 0; i < input.prefixes.length; i++) {
        var p = input.prefixes[i];
        if (p < parent.prefix) {
          conflicts.push({
            kind: 'toobig',
            severity: 'error',
            message: '/' + p + ' is larger than the VPC block itself (/' +
              parent.prefix + '), so it was skipped.'
          });
          continue;
        }
        requested.push(p);
      }
    } else {
      /* Round up to a power of two so every subnet gets the same prefix and the
       * spares stay visible as gaps. */
      var slots = CIDR.floorPow2(input.count);
      if (slots < input.count) { slots *= 2; }
      var bits = Math.round(Math.log(slots) / Math.LN2);
      var evenPrefix = parent.prefix + bits;

      if (evenPrefix > 32) {
        conflicts.push({
          kind: 'toosmall',
          severity: 'error',
          message: 'A /' + parent.prefix + ' cannot be divided into ' + input.count +
            ' subnets — that would need a /' + evenPrefix + '.'
        });
      } else {
        for (var k = 0; k < input.count; k++) { requested.push(evenPrefix); }
      }
    }

    /* Largest block first. Ascending prefix number IS descending block size. */
    var ordered = requested.slice().sort(function (a, b) { return a - b; });
    var placed = allocate(parent, ordered);

    if (placed.length < ordered.length) {
      conflicts.push({
        kind: 'shortfall',
        severity: 'error',
        message: (ordered.length - placed.length) + ' of ' + ordered.length +
          ' subnets do not fit in ' + CIDR.format(parent) + '. Widen the VPC block or ask for fewer.'
      });
    }

    var namePrefix = input.namePrefix || 'subnet';
    var subnets = placed.map(function (block, index) {
      var azIndex = index % input.azs;
      var seq = Math.floor(index / input.azs) + 1;
      var bounds = CIDR.range(block);
      return {
        name: namePrefix + '-' + String.fromCharCode(97 + azIndex) + seq,
        block: block,
        az: String.fromCharCode(97 + azIndex),
        azIndex: azIndex,
        first: CIDR.fromInt(bounds.first),
        last: CIDR.fromInt(bounds.last),
        usable: CIDR.usableHosts(block, input.awsReserved),
        clash: false
      };
    });

    conflicts = conflicts.concat(findConflicts(subnets, input.existing));

    var free = gaps(parent, subnets);
    var freeAddresses = free.reduce(function (sum, g) { return sum + CIDR.size(g.block); }, 0);
    var parentSize = CIDR.size(parent);

    return {
      parent: parent,
      subnets: subnets,
      gaps: free,
      conflicts: conflicts,
      totals: {
        subnets: subnets.length,
        usable: subnets.reduce(function (sum, s) { return sum + s.usable; }, 0),
        freeRatio: parentSize ? freeAddresses / parentSize : 0
      }
    };
  }

  global.VPPlan = {
    /* The single source of these bounds. share.js validates a decoded hash
     * against the same numbers, and duplicating them there would let the two
     * drift: raise the AZ ceiling here alone and the form would happily accept 7
     * zones while every share link made from it decoded to null. */
    LIMITS: {
      subnets: MAX_SUBNETS,
      azs: MAX_AZS,
      existing: MAX_EXISTING,
      text: MAX_TEXT
    },
    normalise: normalise,
    build: build,
    allocate: allocate,
    gaps: gaps,
    findConflicts: findConflicts
  };
})(this);
