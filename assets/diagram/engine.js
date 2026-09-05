/* Architecture diagram editor — model, geometry, rendering and export.
 *
 * The editor keeps one plain-object model and re-renders the whole content
 * layer from it. Rendering emits presentation attributes rather than CSS
 * classes so a cloned content layer is a valid standalone SVG, which is what
 * makes export byte-identical to what is on screen.
 *
 * Depends on assets/diagram/icons.js (window.DIAGRAM_ICONS).
 */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var MODEL_VERSION = 1;

  // ---------------------------------------------------------------- icons

  /* icons.js is only an index — every icon's key, name and category, but no
   * path data. Paths are over 95% of the bytes and are split into one chunk
   * per group, fetched the first time that group is actually looked at. An
   * icon whose chunk has not arrived has `body === null`; callers either wait
   * on `ensure()` or draw the placeholder. */
  var Icons = (function () {
    var byKey = Object.create(null);
    var groups = [];
    var byId = Object.create(null);
    var shared = [];
    var ready = false;
    var pending = Object.create(null);   // group id -> Promise
    var custom = Object.create(null);    // key -> icon, from the user's import
    var customGroup = null;

    function expand(body) {
      return body.replace(/@@(\d+)@@/g, function (_, n) {
        return shared[Number(n)] || '';
      });
    }

    function init() {
      var data = global.DIAGRAM_ICONS;
      if (!data) throw new Error('icons.js did not load');
      shared = data.shared || [];
      groups = data.groups.map(function (g) {
        var icons = g.icons.map(function (i) {
          var icon = {
            key: i.k,
            name: i.n,
            category: i.c || 'Other',
            // Present only for an inlined group; otherwise the chunk fills
            // these in and `loaded` flips.
            viewBox: i.vb || '0 0 24 24',
            body: i.b == null ? null : expand(i.b),
            group: g.id,
            // A group can be monochrome wholesale (`mono`), or an individual
            // icon can be — the ecosystem set mixes brand-coloured logos with
            // single-path simple-icons that follow the node colour.
            mono: !!(i.m || g.mono)
          };
          byKey[icon.key] = icon;
          return icon;
        });
        var group = {
          id: g.id, label: g.label, color: g.color, mono: !!g.mono,
          chunk: g.chunk || '',
          loaded: !g.chunk,
          // A group can draw from more than one upstream set, so attribution
          // is a list — the ecosystem group credits both of its sources.
          credits: (g.credits || []).map(function (c) {
            return { text: c.t, url: c.u || '' };
          }),
          icons: icons
        };
        byId[group.id] = group;
        return group;
      });
      // Icons the user imported from their own machine. Always present so the
      // tab can explain itself when empty — it is the only route for icon sets
      // whose licence forbids us shipping them, Azure's above all.
      // No credits entry: attribution exists to satisfy upstream licences, and
      // the user's own files carry none. The tab's own panel says where they
      // are stored.
      customGroup = {
        id: 'custom', label: 'Custom', color: '#0EA5E9',
        mono: false, chunk: '', loaded: true, custom: true,
        credits: [], icons: []
      };
      groups.push(customGroup);
      byId.custom = customGroup;
      ready = true;
      return groups;
    }

    /* The chunk calls this on load. Declared on `global` rather than resolved
     * through onload alone so a chunk served from cache behaves identically. */
    global.DIAGRAM_ICON_CHUNK = function (id, bodies) {
      var group = byId[id];
      if (!group) return;
      Object.keys(bodies).forEach(function (key) {
        var icon = byKey[key];
        if (!icon) return;
        icon.viewBox = bodies[key].vb;
        icon.body = expand(bodies[key].b);
      });
      group.loaded = true;
    };

    function loadGroup(id) {
      if (!ready) init();
      var group = byId[id];
      if (!group) return Promise.resolve(false);
      if (group.loaded) return Promise.resolve(true);
      if (pending[id]) return pending[id];
      pending[id] = new Promise(function (resolve) {
        var el = document.createElement('script');
        el.src = group.chunk;
        el.async = true;
        el.onload = function () { resolve(group.loaded); };
        // A missing chunk must not wedge the editor: the group stays empty and
        // its icons keep rendering as placeholders.
        el.onerror = function () { delete pending[id]; resolve(false); };
        document.head.appendChild(el);
      });
      return pending[id];
    }

    function ensure(ids) {
      if (!ready) init();
      var list = (ids == null ? groups.map(function (g) { return g.id; })
                              : [].concat(ids));
      return Promise.all(list.map(loadGroup));
    }

    function groupOf(key) {
      var i = String(key || '').indexOf(':');
      return i < 0 ? '' : key.slice(0, i);
    }

    return {
      init: init,
      groups: function () { if (!ready) init(); return groups; },
      group: function (id) { if (!ready) init(); return byId[id] || null; },
      get: function (key) {
        if (!ready) init();
        return byKey[key] || custom[key] || null;
      },
      all: function () {
        if (!ready) init();
        return Object.keys(byKey).map(function (k) { return byKey[k]; })
          .concat(Object.keys(custom).map(function (k) { return custom[k]; }));
      },
      ensure: ensure,
      groupOf: groupOf,
      // Group ids referenced by a set of icon keys — what a restored diagram
      // needs loaded before its first render is meaningful.
      groupsFor: function (keys) {
        var seen = Object.create(null);
        (keys || []).forEach(function (k) {
          var id = groupOf(k);
          if (id && byId[id]) seen[id] = true;
        });
        return Object.keys(seen);
      },
      setCustom: function (icons) {
        if (!ready) init();
        custom = Object.create(null);
        var list = (icons || []).map(function (i) {
          var icon = {
            key: i.key, name: i.name, category: 'Custom',
            viewBox: i.viewBox || '0 0 24 24', body: i.body,
            group: 'custom', mono: false
          };
          custom[icon.key] = icon;
          return icon;
        }).sort(function (a, b) { return a.name.localeCompare(b.name); });
        customGroup.icons = list;
        return list;
      },
      customIcons: function () {
        if (!ready) init();
        return customGroup.icons.slice();
      }
    };
  })();

  // ---------------------------------------------------------------- model

  var NODE_DEFAULTS = {
    icon: { w: 64, h: 64, label: '', color: '#334155' },
    group: { w: 320, h: 220, label: 'Group', color: '#2563eb', fill: 'rgba(37,99,235,0.06)' },
    text: { w: 160, h: 24, label: 'Text', color: '#0f172a', fontSize: 15 },
    note: { w: 180, h: 90, label: 'Note', color: '#334155', fill: '#fff9db', fontSize: 13 }
  };

  var NODE_TYPES = ['icon', 'group', 'text', 'note'];

  var idSeq = 0;
  function nextId(prefix) {
    idSeq += 1;
    return prefix + '-' + Date.now().toString(36) + '-' + idSeq.toString(36);
  }

  function emptyModel() {
    return {
      v: MODEL_VERSION,
      title: 'Untitled diagram',
      background: '#ffffff',
      nodes: [],
      edges: []
    };
  }

  function makeNode(type, props) {
    var base = NODE_DEFAULTS[type] || NODE_DEFAULTS.icon;
    var node = {
      id: nextId(type),
      type: type,
      x: 0, y: 0,
      w: base.w, h: base.h,
      label: base.label,
      color: base.color
    };
    // `textColor` is deliberately empty by default. A box has two colours the
    // user cares about — the fill behind the text and the text itself — but
    // tying the text to the accent colour is right often enough that it should
    // stay the default. Empty means "track `color`", so every diagram drawn
    // before the split keeps rendering exactly as it did.
    if (type === 'group') { node.fill = base.fill; node.dashed = true; node.textColor = ''; }
    if (type === 'text') { node.fontSize = base.fontSize; node.bold = false; }
    if (type === 'note') {
      node.fill = base.fill;
      node.fontSize = base.fontSize;
      node.bold = false;
      node.align = 'left';
      node.textColor = '';
    }
    for (var k in props) if (Object.prototype.hasOwnProperty.call(props, k)) node[k] = props[k];
    return node;
  }

  function makeEdge(fromId, toId, props) {
    var edge = {
      id: nextId('edge'),
      from: fromId,
      to: toId,
      fromSide: 'auto',
      toSide: 'auto',
      label: '',
      color: '#64748b',
      width: 2,
      dashed: false,
      animated: false,
      arrow: 'end',      // none | end | both
      route: 'orthogonal' // orthogonal | straight | curve
    };
    for (var k in props) if (Object.prototype.hasOwnProperty.call(props, k)) edge[k] = props[k];
    return edge;
  }

  // ---------------------------------------------------------------- geometry

  var LABEL_GAP = 6;
  var LABEL_LINE = 14;

  /** Visual bounds including the caption drawn under an icon. */
  function nodeBounds(node) {
    var b = { x: node.x, y: node.y, w: node.w, h: node.h };
    if (node.type === 'icon' && node.label) {
      b.h += LABEL_GAP + LABEL_LINE * String(node.label).split('\n').length;
    }
    return b;
  }

  function nodeCenter(node) {
    return { x: node.x + node.w / 2, y: node.y + node.h / 2 };
  }

  function sidePoint(node, side) {
    var c = nodeCenter(node);
    switch (side) {
      case 'n': return { x: c.x, y: node.y };
      case 's': return { x: c.x, y: node.y + node.h };
      case 'w': return { x: node.x, y: c.y };
      case 'e': return { x: node.x + node.w, y: c.y };
      default: return c;
    }
  }

  /** Pick the facing sides when an edge does not pin them explicitly. */
  function autoSides(a, b) {
    var ca = nodeCenter(a), cb = nodeCenter(b);
    var dx = cb.x - ca.x, dy = cb.y - ca.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0 ? ['e', 'w'] : ['w', 'e'];
    }
    return dy >= 0 ? ['s', 'n'] : ['n', 's'];
  }

  function isHorizontal(side) { return side === 'e' || side === 'w'; }

  function offsetFrom(point, side, gap) {
    switch (side) {
      case 'n': return { x: point.x, y: point.y - gap };
      case 's': return { x: point.x, y: point.y + gap };
      case 'w': return { x: point.x - gap, y: point.y };
      default: return { x: point.x + gap, y: point.y };
    }
  }

  function dedupePoints(points) {
    var out = [];
    for (var i = 0; i < points.length; i++) {
      var p = points[i], last = out[out.length - 1];
      if (!last || Math.abs(last.x - p.x) > 0.01 || Math.abs(last.y - p.y) > 0.01) out.push(p);
    }
    return out;
  }

  function edgePoints(edge, from, to) {
    var sides = autoSides(from, to);
    var sa = edge.fromSide && edge.fromSide !== 'auto' ? edge.fromSide : sides[0];
    var sb = edge.toSide && edge.toSide !== 'auto' ? edge.toSide : sides[1];
    var a = sidePoint(from, sa);
    var b = sidePoint(to, sb);

    if (edge.route === 'straight' || edge.route === 'curve') return { pts: [a, b], sa: sa, sb: sb };

    var gap = 16;
    var a1 = offsetFrom(a, sa, gap);
    var b1 = offsetFrom(b, sb, gap);
    var mid = [];
    if (isHorizontal(sa) && isHorizontal(sb)) {
      var mx = (a1.x + b1.x) / 2;
      mid = [{ x: mx, y: a1.y }, { x: mx, y: b1.y }];
    } else if (!isHorizontal(sa) && !isHorizontal(sb)) {
      var my = (a1.y + b1.y) / 2;
      mid = [{ x: a1.x, y: my }, { x: b1.x, y: my }];
    } else if (isHorizontal(sa)) {
      mid = [{ x: b1.x, y: a1.y }];
    } else {
      mid = [{ x: a1.x, y: b1.y }];
    }
    return { pts: dedupePoints([a, a1].concat(mid, [b1, b])), sa: sa, sb: sb };
  }

  function roundedPath(points, radius) {
    if (points.length < 2) return '';
    if (points.length === 2) {
      return 'M' + fmt(points[0].x) + ' ' + fmt(points[0].y) +
             'L' + fmt(points[1].x) + ' ' + fmt(points[1].y);
    }
    var d = 'M' + fmt(points[0].x) + ' ' + fmt(points[0].y);
    for (var i = 1; i < points.length - 1; i++) {
      var prev = points[i - 1], cur = points[i], next = points[i + 1];
      var r = Math.min(
        radius,
        Math.hypot(cur.x - prev.x, cur.y - prev.y) / 2,
        Math.hypot(next.x - cur.x, next.y - cur.y) / 2
      );
      if (r < 0.5) { d += 'L' + fmt(cur.x) + ' ' + fmt(cur.y); continue; }
      var inN = norm(cur, prev), outN = norm(cur, next);
      d += 'L' + fmt(cur.x + inN.x * r) + ' ' + fmt(cur.y + inN.y * r);
      d += 'Q' + fmt(cur.x) + ' ' + fmt(cur.y) + ' ' +
           fmt(cur.x + outN.x * r) + ' ' + fmt(cur.y + outN.y * r);
    }
    var last = points[points.length - 1];
    return d + 'L' + fmt(last.x) + ' ' + fmt(last.y);
  }

  function curvePath(a, b) {
    var dx = Math.abs(b.x - a.x) * 0.5;
    return 'M' + fmt(a.x) + ' ' + fmt(a.y) +
           'C' + fmt(a.x + dx) + ' ' + fmt(a.y) + ' ' +
           fmt(b.x - dx) + ' ' + fmt(b.y) + ' ' + fmt(b.x) + ' ' + fmt(b.y);
  }

  function norm(from, to) {
    var dx = to.x - from.x, dy = to.y - from.y;
    var len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  function fmt(n) {
    return (Math.round(n * 100) / 100).toString();
  }

  function modelBounds(model, pad) {
    pad = pad == null ? 40 : pad;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    model.nodes.forEach(function (n) {
      var b = nodeBounds(n);
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    });
    if (!isFinite(minX)) return { x: 0, y: 0, w: 640, h: 400 };
    return {
      x: minX - pad, y: minY - pad,
      w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2
    };
  }

  function nodeAt(model, x, y) {
    // Topmost first, and icons/text win over the group boxes behind them.
    for (var i = model.nodes.length - 1; i >= 0; i--) {
      var n = model.nodes[i];
      if (n.type === 'group') continue;
      if (hit(n, x, y)) return n;
    }
    for (var j = model.nodes.length - 1; j >= 0; j--) {
      var g = model.nodes[j];
      if (g.type !== 'group') continue;
      if (hit(g, x, y)) return g;
    }
    return null;
  }

  function hit(node, x, y) {
    var b = nodeBounds(node);
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  }

  // ---------------------------------------------------------------- rendering

  function el(name, attrs, parent) {
    var node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        if (attrs[k] == null || attrs[k] === false) continue;
        node.setAttribute(k, String(attrs[k]));
      }
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  var FONT_STACK = "'Inter','Helvetica Neue',Helvetica,Arial,'Apple SD Gothic Neo','Malgun Gothic',sans-serif";

  function renderIconGlyph(node, parent) {
    var icon = Icons.get(node.icon);
    // No such icon, or its chunk has not arrived: same dashed placeholder
    // either way. Callers that care re-render once `ensure()` resolves.
    if (!icon || icon.body == null) {
      el('rect', {
        x: node.x, y: node.y, width: node.w, height: node.h, rx: 8,
        fill: '#f1f5f9', stroke: '#cbd5e1', 'stroke-dasharray': '4 3'
      }, parent);
      return;
    }
    var vb = icon.viewBox.split(/[\s,]+/).map(Number);
    var vw = vb[2] || 24, vh = vb[3] || 24;
    var scale = Math.min(node.w / vw, node.h / vh);
    var dx = node.x + (node.w - vw * scale) / 2;
    var dy = node.y + (node.h - vh * scale) / 2;

    var g = el('g', {
      transform: 'translate(' + fmt(dx) + ' ' + fmt(dy) + ') scale(' + fmt(scale) + ')'
    }, parent);
    // Mono icons are stroke geometry that inherits the node colour.
    if (icon.mono) g.setAttribute('color', node.color || '#334155');
    // The icon body is trusted, generated content from our own build script.
    g.innerHTML = '<g transform="translate(' + fmt(-vb[0] || 0) + ' ' + fmt(-vb[1] || 0) + ')">' +
                  icon.body + '</g>';
  }

  function renderLabel(node, parent) {
    if (!node.label) return;
    var lines = String(node.label).split('\n');
    var cx = node.x + node.w / 2;
    var top = node.y + node.h + LABEL_GAP + 11;
    var text = el('text', {
      x: fmt(cx), y: fmt(top),
      'text-anchor': 'middle',
      'font-family': FONT_STACK,
      'font-size': 12.5,
      'font-weight': 500,
      fill: node.color || '#334155'
    }, parent);
    lines.forEach(function (line, i) {
      el('tspan', { x: fmt(cx), dy: i === 0 ? 0 : LABEL_LINE }, text).textContent = line;
    });
  }

  function renderGroup(node, parent) {
    el('rect', {
      x: node.x, y: node.y, width: node.w, height: node.h, rx: 10,
      fill: node.fill || 'none',
      stroke: node.color || '#2563eb',
      'stroke-width': 1.5,
      'stroke-dasharray': node.dashed === false ? null : '7 5'
    }, parent);
    if (node.label) {
      el('text', {
        x: node.x + 12, y: node.y + 20,
        'font-family': FONT_STACK, 'font-size': 12.5, 'font-weight': 600,
        'letter-spacing': 0.3,
        fill: node.textColor || node.color || '#2563eb'
      }, parent).textContent = node.label;
    }
  }

  /* SVG has no automatic text wrapping, so lines are measured against an
   * average glyph width. It is an estimate, but the box is resizable and the
   * alternative (foreignObject) does not survive PNG rasterisation. */
  function wrapLines(text, maxWidth, fontSize) {
    var avg = fontSize * 0.56;
    var limit = Math.max(1, Math.floor(maxWidth / avg));
    var out = [];
    String(text).split('\n').forEach(function (paragraph) {
      if (!paragraph) { out.push(''); return; }
      var line = '';
      paragraph.split(/\s+/).forEach(function (word) {
        // A single word longer than the box is hard-split rather than clipped.
        while (word.length > limit) {
          if (line) { out.push(line); line = ''; }
          out.push(word.slice(0, limit));
          word = word.slice(limit);
        }
        var candidate = line ? line + ' ' + word : word;
        if (candidate.length > limit) { out.push(line); line = word; }
        else { line = candidate; }
      });
      out.push(line);
    });
    return out;
  }

  function renderNote(node, parent) {
    var size = node.fontSize || 13;
    var pad = 10;
    el('rect', {
      x: node.x, y: node.y, width: node.w, height: node.h, rx: 8,
      fill: node.fill || '#fff9db',
      stroke: node.color || '#334155',
      'stroke-width': 1.25,
      'stroke-opacity': 0.35
    }, parent);

    var lines = wrapLines(node.label || '', node.w - pad * 2, size);
    var lineHeight = size * 1.45;
    var align = node.align === 'center' ? 'middle' : (node.align === 'right' ? 'end' : 'start');
    var tx = align === 'middle' ? node.x + node.w / 2
           : align === 'end' ? node.x + node.w - pad
           : node.x + pad;
    // Vertically centre the block, but never let it start above the box.
    var block = lines.length * lineHeight;
    var top = node.y + Math.max(pad, (node.h - block) / 2) + size * 0.85;

    var text = el('text', {
      x: fmt(tx), y: fmt(top),
      'text-anchor': align,
      'font-family': FONT_STACK,
      'font-size': size,
      'font-weight': node.bold ? 700 : 400,
      fill: node.textColor || node.color || '#334155'
    }, parent);
    lines.forEach(function (line, i) {
      el('tspan', { x: fmt(tx), dy: i === 0 ? 0 : fmt(lineHeight) }, text).textContent = line;
    });
  }

  function renderText(node, parent) {
    var lines = String(node.label || '').split('\n');
    var size = node.fontSize || 15;
    var text = el('text', {
      x: node.x, y: node.y + size,
      'font-family': FONT_STACK,
      'font-size': size,
      'font-weight': node.bold ? 700 : 400,
      fill: node.color || '#0f172a'
    }, parent);
    lines.forEach(function (line, i) {
      el('tspan', { x: node.x, dy: i === 0 ? 0 : size * 1.35 }, text).textContent = line;
    });
  }

  function renderEdge(edge, from, to, parent) {
    var geo = edgePoints(edge, from, to);
    var d = edge.route === 'curve'
      ? curvePath(geo.pts[0], geo.pts[geo.pts.length - 1])
      : roundedPath(geo.pts, 10);

    // A flow animation needs a dash pattern to march, so it implies dashes.
    var dash = edge.animated ? '9 7' : (edge.dashed ? '7 5' : null);
    var path = el('path', {
      d: d,
      fill: 'none',
      stroke: edge.color || '#64748b',
      'stroke-width': edge.width || 2,
      'stroke-linecap': edge.animated ? 'butt' : 'round',
      'stroke-linejoin': 'round',
      'stroke-dasharray': dash,
      'marker-end': edge.arrow === 'end' || edge.arrow === 'both'
        ? 'url(#dg-arrow-' + colorId(edge.color) + ')' : null,
      'marker-start': edge.arrow === 'both'
        ? 'url(#dg-arrow-' + colorId(edge.color) + ')' : null
    }, parent);
    path.setAttribute('data-edge', edge.id);

    if (edge.animated) {
      // SMIL rather than CSS: it is part of the document, so an exported SVG
      // keeps flowing when opened in a browser. PNG captures a still frame.
      el('animate', {
        attributeName: 'stroke-dashoffset',
        from: 16, to: 0, dur: '0.8s', repeatCount: 'indefinite'
      }, path);
    }

    if (edge.label) {
      var mid = midpointOf(geo.pts);
      var g = el('g', null, parent);
      var t = el('text', {
        x: fmt(mid.x), y: fmt(mid.y - 6),
        'text-anchor': 'middle',
        'font-family': FONT_STACK, 'font-size': 11.5, 'font-weight': 500,
        fill: edge.color || '#64748b'
      }, g);
      t.textContent = edge.label;
      // A backing plate keeps the caption readable where it crosses the line.
      var pad = 4;
      var width = edge.label.length * 6.2 + pad * 2;
      var rect = el('rect', {
        x: fmt(mid.x - width / 2), y: fmt(mid.y - 17),
        width: fmt(width), height: 15, rx: 3,
        fill: '#ffffff', 'fill-opacity': 0.86
      });
      g.insertBefore(rect, t);
    }
    return path;
  }

  function midpointOf(points) {
    if (points.length === 2) {
      return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
    }
    var total = 0, segs = [];
    for (var i = 1; i < points.length; i++) {
      var len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      segs.push(len); total += len;
    }
    var target = total / 2, acc = 0;
    for (var j = 0; j < segs.length; j++) {
      if (acc + segs[j] >= target) {
        var t = segs[j] ? (target - acc) / segs[j] : 0;
        return {
          x: points[j].x + (points[j + 1].x - points[j].x) * t,
          y: points[j].y + (points[j + 1].y - points[j].y) * t
        };
      }
      acc += segs[j];
    }
    return points[Math.floor(points.length / 2)];
  }

  function colorId(color) {
    return String(color || '#64748b').replace(/[^a-zA-Z0-9]/g, '');
  }

  /** Arrow markers are per-colour so an exported SVG carries only what it uses. */
  function ensureMarkers(defs, model) {
    var seen = Object.create(null);
    model.edges.forEach(function (e) {
      if (e.arrow === 'none') return;
      seen[e.color || '#64748b'] = true;
    });
    Object.keys(seen).forEach(function (color) {
      // `auto-start-reverse` flips this same marker when it sits at the start
      // of a path, so one definition serves both ends. Mirroring the geometry
      // as well would double-reverse it and point the head into the node.
      var marker = el('marker', {
        id: 'dg-arrow-' + colorId(color), viewBox: '0 0 10 10',
        refX: 8.5, refY: 5, markerWidth: 6.5, markerHeight: 6.5,
        orient: 'auto-start-reverse', markerUnits: 'strokeWidth'
      }, defs);
      el('path', { d: 'M0 1L9 5L0 9z', fill: color }, marker);
    });
  }

  /**
   * Draw the whole model into `content`, which is the only layer that export
   * looks at. Z-order is groups, then edges, then everything else.
   */
  /* An SVG `<title>` is the accessible name of the element it opens, and it is
   * also the browser's native tooltip. It has to be the FIRST child — a later
   * one is ignored for naming — which is why this runs before the shapes go in
   * rather than being appended alongside them.
   *
   * This costs one element per node and it is the only thing standing between a
   * screen reader and a wall of anonymous <path>s, in the editor and in every
   * SVG it exports. */
  function describeNode(node) {
    var label = (node.label || '').replace(/\s+/g, ' ').trim();
    if (node.type === 'group') return label ? 'Group: ' + label : 'Group';
    if (node.type === 'note') return label ? 'Note: ' + label : 'Note';
    if (node.type === 'text') return label || 'Text';
    var icon = Icons.get(node.icon);
    var kind = (icon && icon.name) || 'Icon';
    // "EKS — EKS" reads as a stutter; when the label just repeats the service
    // name, one of them is enough.
    if (!label || label.toLowerCase() === kind.toLowerCase()) return kind;
    return label + ' (' + kind + ')';
  }

  function describeEdge(edge, from, to) {
    var arrow = edge.arrow === 'both' ? ' to and from ' : ' to ';
    var text = 'Connection: ' + describeNode(from) + arrow + describeNode(to);
    var label = (edge.label || '').replace(/\s+/g, ' ').trim();
    return label ? text + ', labelled ' + label : text;
  }

  function titleFirst(parent, text) {
    var t = document.createElementNS(SVG_NS, 'title');
    t.textContent = text;
    parent.insertBefore(t, parent.firstChild);
    return t;
  }

  function renderContent(content, defs, model) {
    while (content.firstChild) content.removeChild(content.firstChild);
    while (defs.firstChild) defs.removeChild(defs.firstChild);
    ensureMarkers(defs, model);

    var byId = Object.create(null);
    model.nodes.forEach(function (n) { byId[n.id] = n; });

    var groupLayer = el('g', { 'data-layer': 'groups' }, content);
    var edgeLayer = el('g', { 'data-layer': 'edges' }, content);
    var nodeLayer = el('g', { 'data-layer': 'nodes' }, content);

    model.nodes.forEach(function (n) {
      if (n.type !== 'group') return;
      var g = el('g', { 'data-node': n.id, role: 'img' }, groupLayer);
      renderGroup(n, g);
      titleFirst(g, describeNode(n));
    });

    model.edges.forEach(function (e) {
      var from = byId[e.from], to = byId[e.to];
      if (!from || !to) return;
      var g = el('g', { 'data-edge-group': e.id, role: 'img' }, edgeLayer);
      renderEdge(e, from, to, g);
      titleFirst(g, describeEdge(e, from, to));
    });

    model.nodes.forEach(function (n) {
      if (n.type === 'group') return;
      var g = el('g', { 'data-node': n.id, role: 'img' }, nodeLayer);
      if (n.type === 'text') {
        renderText(n, g);
      } else if (n.type === 'note') {
        renderNote(n, g);
      } else {
        renderIconGlyph(n, g);
        renderLabel(n, g);
      }
      titleFirst(g, describeNode(n));
    });
  }

  // ---------------------------------------------------------------- export

  function buildExportSvg(model, contentLayer, defsLayer, opts) {
    opts = opts || {};
    var pad = opts.padding == null ? 40 : opts.padding;
    var box = modelBounds(model, pad);

    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    svg.setAttribute('viewBox', [fmt(box.x), fmt(box.y), fmt(box.w), fmt(box.h)].join(' '));
    svg.setAttribute('width', Math.round(box.w));
    svg.setAttribute('height', Math.round(box.h));

    /* Named at the root as well as per node. `role="img"` plus a title is what
     * makes the exported file announce itself as one picture called something,
     * rather than as a pile of unlabelled shapes, wherever it ends up embedded. */
    svg.setAttribute('role', 'img');
    var titleId = 'dg-title-' + (model.title || 'diagram').replace(/\W+/g, '-').toLowerCase();
    var heading = document.createElementNS(SVG_NS, 'title');
    heading.setAttribute('id', titleId);
    heading.textContent = model.title || 'Architecture diagram';
    svg.appendChild(heading);
    svg.setAttribute('aria-labelledby', titleId);

    if (opts.background !== false) {
      el('rect', {
        x: fmt(box.x), y: fmt(box.y), width: fmt(box.w), height: fmt(box.h),
        fill: model.background || '#ffffff'
      }, svg);
    }
    svg.appendChild(defsLayer.cloneNode(true));
    var content = contentLayer.cloneNode(true);
    content.removeAttribute('transform');
    svg.appendChild(content);
    return svg;
  }

  function serialize(svg) {
    var out = new XMLSerializer().serializeToString(svg);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + out;
  }

  function toPngBlob(svg, scale) {
    scale = scale || 2;
    var width = Number(svg.getAttribute('width')) || 800;
    var height = Number(svg.getAttribute('height')) || 600;
    var source = serialize(svg);
    // A data: URL keeps the <img> same-origin, so the canvas stays untainted.
    var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);

    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        var ctx = canvas.getContext('2d');
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(function (blob) {
          blob ? resolve(blob) : reject(new Error('canvas produced no image'));
        }, 'image/png');
      };
      img.onerror = function () { reject(new Error('the diagram could not be rasterised')); };
      img.src = url;
    });
  }

  // ---------------------------------------------------------------- persistence

  function toJSON(model) {
    return JSON.stringify(model, null, 2);
  }

  /** Accept only what the current schema knows; never trust stored input. */
  function fromJSON(text) {
    var raw = typeof text === 'string' ? JSON.parse(text) : text;
    if (!raw || typeof raw !== 'object') throw new Error('not a diagram file');
    if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
      throw new Error('not a diagram file');
    }
    var model = emptyModel();
    model.title = typeof raw.title === 'string' ? raw.title : model.title;
    model.background = typeof raw.background === 'string' ? raw.background : model.background;

    var seen = Object.create(null);
    raw.nodes.forEach(function (n) {
      if (!n || typeof n !== 'object') return;
      var type = NODE_TYPES.indexOf(n.type) >= 0 ? n.type : 'icon';
      var node = makeNode(type, {
        id: typeof n.id === 'string' ? n.id : nextId(type),
        icon: typeof n.icon === 'string' ? n.icon : undefined,
        x: num(n.x, 0), y: num(n.y, 0),
        w: num(n.w, NODE_DEFAULTS[type].w), h: num(n.h, NODE_DEFAULTS[type].h),
        label: typeof n.label === 'string' ? n.label : '',
        color: typeof n.color === 'string' ? n.color : NODE_DEFAULTS[type].color
      });
      if (type === 'group') {
        node.fill = typeof n.fill === 'string' ? n.fill : NODE_DEFAULTS.group.fill;
        node.dashed = n.dashed !== false;
        node.textColor = typeof n.textColor === 'string' ? n.textColor : '';
      }
      if (type === 'text') {
        node.fontSize = num(n.fontSize, NODE_DEFAULTS.text.fontSize);
        node.bold = !!n.bold;
      }
      if (type === 'note') {
        node.fill = typeof n.fill === 'string' ? n.fill : NODE_DEFAULTS.note.fill;
        node.fontSize = num(n.fontSize, NODE_DEFAULTS.note.fontSize);
        node.bold = !!n.bold;
        node.align = ['left', 'center', 'right'].indexOf(n.align) >= 0 ? n.align : 'left';
        node.textColor = typeof n.textColor === 'string' ? n.textColor : '';
      }
      if (seen[node.id]) return;
      seen[node.id] = true;
      model.nodes.push(node);
    });

    raw.edges.forEach(function (e) {
      if (!e || typeof e !== 'object') return;
      if (!seen[e.from] || !seen[e.to]) return;  // drop edges to vanished nodes
      model.edges.push(makeEdge(e.from, e.to, {
        id: typeof e.id === 'string' ? e.id : undefined,
        fromSide: side(e.fromSide), toSide: side(e.toSide),
        label: typeof e.label === 'string' ? e.label : '',
        color: typeof e.color === 'string' ? e.color : '#64748b',
        width: num(e.width, 2),
        dashed: !!e.dashed,
        animated: !!e.animated,
        arrow: ['none', 'end', 'both'].indexOf(e.arrow) >= 0 ? e.arrow : 'end',
        route: ['orthogonal', 'straight', 'curve'].indexOf(e.route) >= 0 ? e.route : 'orthogonal'
      }));
    });
    return model;
  }

  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function side(value) {
    return ['n', 'e', 's', 'w', 'auto'].indexOf(value) >= 0 ? value : 'auto';
  }

  // ---------------------------------------------------------------- history

  function createHistory(limit) {
    limit = limit || 60;
    var past = [], future = [];
    return {
      push: function (snapshot) {
        past.push(snapshot);
        if (past.length > limit) past.shift();
        future.length = 0;
      },
      undo: function (current) {
        if (!past.length) return null;
        future.push(current);
        return past.pop();
      },
      redo: function (current) {
        if (!future.length) return null;
        past.push(current);
        return future.pop();
      },
      canUndo: function () { return past.length > 0; },
      canRedo: function () { return future.length > 0; },
      clear: function () { past.length = 0; future.length = 0; }
    };
  }

  function clone(model) {
    return JSON.parse(JSON.stringify(model));
  }

  global.DiagramEngine = {
    SVG_NS: SVG_NS,
    MODEL_VERSION: MODEL_VERSION,
    Icons: Icons,
    el: el,
    fmt: fmt,
    nextId: nextId,
    emptyModel: emptyModel,
    makeNode: makeNode,
    makeEdge: makeEdge,
    describeNode: describeNode,
    nodeBounds: nodeBounds,
    nodeCenter: nodeCenter,
    sidePoint: sidePoint,
    edgePoints: edgePoints,
    modelBounds: modelBounds,
    nodeAt: nodeAt,
    renderContent: renderContent,
    buildExportSvg: buildExportSvg,
    serialize: serialize,
    toPngBlob: toPngBlob,
    toJSON: toJSON,
    fromJSON: fromJSON,
    createHistory: createHistory,
    clone: clone
  };
})(window);
