/* assets/vpc-planner/plan.js — splitting, AZ layout and overlap detection.
 * Pure: no DOM, no storage, no network. Depends only on cidr.js.
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
 *     subnets: [ { name, block, az, azIndex, first, last, usable, clash } ],
 *     gaps:    [ { block } ],       // unallocated remainder, for the bar
 *     conflicts: [ { kind, severity, message } ],
 *     totals:  { subnets, usable, freeRatio }
 *   }
 *
 * Rules:
 *   - Largest block first, each aligned to its own size — an unaligned block is
 *     not a CIDR at all, and smallest-first fragments the space.
 *   - "Even" rounds the count UP to a power of two, so spares show as gaps.
 *   - AZs round-robin (i % azs); an uneven split stays visible.
 *   - A request that does not fit returns what DID fit plus a conflict, never null.
 *   - An unparseable `existing` line is its own conflict, never dropped.
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

  /* Newlines or commas: people paste both. */
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

  /* Form or decoded hash -> `input`. Here, not in ui.js, so a share link and a
   * form go through the same funnel. */
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

  /* Aligned blocks for `prefixes` in the order given (build() sorts first).
   * Blocks that do not fit are not returned; build() reads the shortfall off
   * the length. */
  function allocate(parent, prefixes) {
    var bounds = CIDR.range(parent);
    var out = [];
    var cursor = bounds.first;

    for (var i = 0; i < prefixes.length; i++) {
      var p = prefixes[i];
      if (p < parent.prefix) { continue; }        /* bigger than the VPC itself */

      var blockSize = Math.pow(2, 32 - p);
      var start = Math.ceil(cursor / blockSize) * blockSize;
      if (start + blockSize - 1 > bounds.last) { break; }

      out.push({ addr: start, prefix: p });
      cursor = start + blockSize;
    }
    return out;
  }

  /* Unallocated remainder of the parent, as the fewest covering CIDR blocks. */
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

  /* Subnet-vs-subnet and subnet-vs-existing. Sets `clash` so the table and the
   * bar need not re-derive it. */
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

  /* input -> plan, or null only when the parent CIDR itself is unusable. */
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

    /* Ascending prefix IS descending block size. */
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
    /* The single source of these bounds; share.js validates a decoded hash
     * against them, so a copy there would drift. */
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
