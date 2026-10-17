/* 개념 사전 — the only file here that touches the DOM. The search helpers
 * (`_includes/private-search.js`) are pure and load first.
 *
 * NOTHING IS BUILT WITH innerHTML. Entry bodies arrive as kramdown HTML; they
 * are parsed inert with DOMParser and rebuilt from an allowlist, so an `id`, a
 * `style` or an unexpected tag never reaches the page.
 *
 * STORAGE holds entry ids only: `st-done-v1` (이해함) and `st-last-v1` (이어서
 * 읽기). Content never touches it.
 *
 * ROUTES are the hash alone: `#` home, `#<cat>`, `#<cat>/<group>`, `#<id>`.
 * Every element id here is `st-*` or `tool-theme`, which no entry id may be,
 * or a deep link would scroll to the element instead.
 */
(function () {
  'use strict';

  var DONE_KEY = 'st-done-v1';
  var LAST_KEY = 'st-last-v1';

  /* Keyed by names that come out of the payload, so null-prototype tables: a
     plain literal answers `x['constructor']` with a truthy function. */
  function table(pairs) {
    var t = Object.create(null);
    pairs.forEach(function (p) { t[p[0]] = p[1]; });
    return t;
  }

  /* Same list as TAGS in _plugins/study_build.rb, which says why. */
  var ALLOWED = table('P H2 H3 UL OL LI STRONG EM DEL CODE PRE A TABLE THEAD TBODY TR TH TD BLOCKQUOTE DIV SPAN BR'
    .split(' ').map(function (tag) { return [tag, true]; }));

  var SOURCE_TYPES = [['wiki', '위키'], ['post', '블로그'], ['tistory', '티스토리'], ['doc', '공식 문서'], ['ref', '참고']];

  function byId(id) { return document.getElementById(id); }

  var el = {
    payload: byId('st-payload'),
    boot: byId('st-boot'),
    toast: byId('st-toast'),
    app: byId('st-app'),
    q: byId('st-q'),
    tree: byId('st-tree'),
    view: byId('st-view'),
    results: byId('st-results'),
    resultCats: byId('st-result-cats'),
    resultList: byId('st-result-list'),
    resultEmpty: byId('st-result-empty'),
    status: byId('st-status')
  };

  var DATA = null;
  var ENTRY = Object.create(null);
  var CAT = Object.create(null);
  var PLACE = Object.create(null);   // id -> { cat, group, index }
  var ORDER = [];
  var ROWS = [];
  var CHIPS = [];                    // { key, node, count }
  var done = new Set();
  /* Stored ids this build does not carry, such as an entry the build skipped:
     written back untouched, so a toggle here cannot erase their marks. */
  var foreign = new Set();
  var saveFailed = false;
  var searchCat = '';
  var onlyUndone = false;
  var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);


  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function link(href, cls, text) {
    var a = node('a', cls, text);
    a.href = href;
    return a;
  }

  /* Only https and site-relative URLs become links; anything else keeps its words. */
  function outbound(url, text) {
    if (!/^https:\/\//i.test(url || '') && !/^\/(?!\/)/.test(url || '')) return node('span', null, text);
    var a = link(url, 'st-ext', text);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  function say(text) { el.status.textContent = text; }


  /* A retired id follows `formerly`, so old links and progress marks survive a rename. */
  function resolve(id) {
    if (typeof id !== 'string') return null;
    if (ENTRY[id]) return id;
    var moved = DATA.moved && Object.prototype.hasOwnProperty.call(DATA.moved, id) ? DATA.moved[id] : null;
    return typeof moved === 'string' && ENTRY[moved] ? moved : null;
  }

  function loadProgress() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem(DONE_KEY) || '[]'); } catch (e) { return; }
    if (!Array.isArray(raw)) return;
    raw.forEach(function (id) {
      var r = resolve(id);
      if (r) done.add(r);
      else if (typeof id === 'string' && /^[a-z0-9-]{1,100}$/.test(id)) foreign.add(id);
    });
  }

  function saveProgress() {
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify(Array.from(done).concat(Array.from(foreign))));
    } catch (e) {
      if (!saveFailed) say('이 브라우저에는 저장할 수 없어 이해함 표시가 이번 방문에만 남습니다.');
      saveFailed = true;
    }
  }

  function readLast() {
    try { return resolve(localStorage.getItem(LAST_KEY)); } catch (e) { return null; }
  }

  function writeLast(id) {
    try { localStorage.setItem(LAST_KEY, id); } catch (e) { /* this visit only */ }
  }


  function index(data) {
    DATA = data;
    (data.entries || []).forEach(function (e) { ENTRY[e.id] = e; });
    (data.cats || []).forEach(function (cat) {
      CAT[cat.key] = cat;
      cat.groups.forEach(function (group) {
        group.ids.forEach(function (id, i) {
          if (!ENTRY[id]) return;
          PLACE[id] = { cat: cat, group: group, index: i };
          ORDER.push(id);
        });
      });
    });
  }

  function catIds(cat) {
    return cat.groups.reduce(function (all, g) { return all.concat(g.ids); }, []);
  }

  function doneCount(ids) {
    return ids.filter(function (id) { return done.has(id); }).length;
  }


  function buildBody(html) {
    var doc = new DOMParser().parseFromString(html || '', 'text/html');
    var frag = document.createDocumentFragment();
    var headings = [];
    copyChildren(doc.body, frag, headings);
    return { node: frag, headings: headings };
  }

  function copyChildren(from, to, headings) {
    for (var c = from.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) to.appendChild(document.createTextNode(c.nodeValue));
      else if (c.nodeType === 1 && ALLOWED[c.tagName]) to.appendChild(copyElement(c, headings));
      /* Anything else, a comment or an unexpected tag, is dropped whole. */
    }
  }

  function copyElement(src, headings) {
    var tag = src.tagName;
    var out;
    if (tag === 'A') {
      out = copyLink(src);
    } else {
      out = document.createElement(tag.toLowerCase());
      var cls = (src.getAttribute('class') || '').split(/\s+/).filter(function (c) {
        return /^[A-Za-z][\w-]*$/.test(c);
      });
      if (cls.length) out.className = cls.join(' ');
    }
    copyChildren(src, out, headings);
    if (tag === 'H2') headings.push(out);
    /* A region that scrolls sideways needs a keyboard stop. */
    if (tag === 'PRE') out.tabIndex = 0;
    if (tag === 'TABLE') {
      var wrap = node('div', 'st-table');
      wrap.tabIndex = 0;
      wrap.appendChild(out);
      return wrap;
    }
    return out;
  }

  function copyLink(src) {
    var href = (src.getAttribute('href') || '').trim();
    var ref = /^#([a-z0-9-]+)$/.exec(href);
    if (ref) {
      var id = resolve(ref[1]);
      return id ? link('#' + id) : node('span');
    }
    return outbound(href, null);
  }


  function buildTree() {
    var list = node('ul');
    DATA.cats.forEach(function (cat) {
      var li = node('li', 'st-tree-cat');
      li.appendChild(link('#' + cat.key, 'st-tree-link', cat.label));
      var groups = node('ul');
      cat.groups.forEach(function (g) {
        var gi = node('li');
        gi.appendChild(link('#' + cat.key + '/' + g.key, 'st-tree-link st-tree-group', g.label));
        groups.appendChild(gi);
      });
      li.appendChild(groups);
      list.appendChild(li);
    });
    el.tree.appendChild(list);
  }

  /* `page` for the route itself, `location` for the group an entry sits in. */
  function markTree(current, around) {
    Array.prototype.forEach.call(el.tree.querySelectorAll('a'), function (a) {
      var href = a.getAttribute('href');
      if (href === current) a.setAttribute('aria-current', 'page');
      else if (href === around) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
  }


  function show(view, heading, scrollTo) {
    el.view.textContent = '';
    el.view.appendChild(view);
    if (scrollTo) {
      scrollTo.scrollIntoView({ block: 'start' });
    } else {
      window.scrollTo(0, 0);
    }
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }

  function crumbs(parts) {
    var nav = node('nav', 'st-crumbs');
    nav.setAttribute('aria-label', '위치');
    var ol = node('ol');
    [['개념 사전', '#']].concat(parts).forEach(function (p) {
      var li = node('li');
      li.appendChild(p[1] ? link(p[1], null, p[0]) : node('span', null, p[0]));
      ol.appendChild(li);
    });
    nav.appendChild(ol);
    return nav;
  }

  function bar(n, m) {
    var track = node('span', 'st-bar');
    track.setAttribute('aria-hidden', 'true');
    var fill = node('span', 'st-bar-fill');
    fill.style.width = (n ? Math.round((m / n) * 100) : 0) + '%';
    track.appendChild(fill);
    return track;
  }

  function defRow(e) {
    var row = node('div', 'st-def');
    row.dataset.id = e.id;
    var dt = node('dt');
    dt.appendChild(link('#' + e.id, null, e.term));
    if (done.has(e.id)) dt.appendChild(node('span', 'st-badge', '이해함'));
    row.appendChild(dt);
    row.appendChild(node('dd', null, e.def));
    return row;
  }

  function renderHome(missing, focus) {
    var wrap = node('section', 'st-front');
    var h1 = node('h1', 'st-title', '개념 사전');
    wrap.appendChild(h1);
    wrap.appendChild(node('p', 'st-lead', '분야별 기본 개념을 한 용어에 한 항목씩 정리했습니다.'));
    if (missing) wrap.appendChild(node('p', 'st-note', '링크된 ‘' + missing + '’ 항목을 찾지 못해 첫 화면을 보여 드립니다.'));

    var last = readLast();
    if (last) {
      var go = link('#' + last, 'st-continue');
      go.appendChild(node('span', 'st-continue-label', '이어서 읽기'));
      go.appendChild(node('span', 'st-continue-term', ENTRY[last].term));
      wrap.appendChild(go);
    }

    if (!ORDER.length) wrap.appendChild(node('p', 'st-note', '아직 항목이 없습니다.'));
    var cards = node('ul', 'st-cards');
    DATA.cats.forEach(function (cat) {
      var ids = catIds(cat);
      var m = doneCount(ids);
      var li = node('li');
      var a = link('#' + cat.key, 'st-card-link');
      a.appendChild(node('span', 'st-card-title', cat.label));
      if (cat.desc) a.appendChild(node('span', 'st-card-desc', cat.desc));
      a.appendChild(node('span', 'st-card-count', '용어 ' + ids.length + ' · 이해함 ' + m));
      a.appendChild(bar(ids.length, m));
      a.appendChild(node('span', 'st-card-groups', cat.groups.map(function (g) { return g.label; }).join(' · ')));
      li.appendChild(a);
      cards.appendChild(li);
    });
    wrap.appendChild(cards);

    markTree('#', null);
    show(wrap, focus ? h1 : null);
  }

  function renderCategory(cat, groupKey) {
    var wrap = node('section', 'st-cat');
    wrap.appendChild(crumbs([[cat.label]]));
    var h1 = node('h1', 'st-title', cat.label);
    wrap.appendChild(h1);
    if (cat.desc) wrap.appendChild(node('p', 'st-lead', cat.desc));
    var ids = catIds(cat);
    wrap.appendChild(node('p', 'st-note', '용어 ' + ids.length + ' · 이해함 ' + doneCount(ids)));

    var tools = node('div', 'st-cat-tools');
    var chips = node('nav', 'st-chips');
    chips.setAttribute('aria-label', '묶음으로 이동');
    cat.groups.forEach(function (g) { chips.appendChild(link('#' + cat.key + '/' + g.key, 'st-chip', g.label)); });
    tools.appendChild(chips);
    var check = node('label', 'st-check');
    var box = node('input');
    box.type = 'checkbox';
    box.checked = onlyUndone;
    check.appendChild(box);
    check.appendChild(node('span', null, '이해 안 한 것만'));
    tools.appendChild(check);
    wrap.appendChild(tools);

    var empty = node('p', 'st-note', '이 분야에는 이해 안 한 용어가 없습니다.');
    var target = null;
    var sections = cat.groups.map(function (g) {
      var sec = node('section', 'st-group');
      var h2 = node('h2', 'st-group-title', g.label);
      sec.appendChild(h2);
      if (g.desc) sec.appendChild(node('p', 'st-group-desc', g.desc));
      var dl = node('dl', 'st-defs');
      g.ids.forEach(function (id) { if (ENTRY[id]) dl.appendChild(defRow(ENTRY[id])); });
      sec.appendChild(dl);
      wrap.appendChild(sec);
      if (g.key === groupKey) target = h2;
      return sec;
    });
    wrap.appendChild(empty);

    function applyUndone() {
      var any = false;
      sections.forEach(function (sec) {
        var rows = sec.querySelectorAll('.st-def');
        var shown = 0;
        Array.prototype.forEach.call(rows, function (row) {
          row.hidden = onlyUndone && done.has(row.dataset.id);
          if (!row.hidden) shown++;
        });
        sec.hidden = shown === 0;
        any = any || shown > 0;
      });
      empty.hidden = any;
    }
    box.addEventListener('change', function () {
      onlyUndone = box.checked;
      applyUndone();
    });
    applyUndone();

    var visible = target && !target.parentNode.hidden ? target : null;
    if (target && !visible) {
      var note = '‘' + target.textContent + '’ 묶음은 모두 이해함으로 표시돼 지금 필터에 가려져 있습니다.';
      tools.insertAdjacentElement('afterend', node('p', 'st-note', note));
    }
    markTree(groupKey ? '#' + cat.key + '/' + groupKey : '#' + cat.key, null);
    show(wrap, visible || h1, visible);
  }

  function tocList(headings) {
    var ol = node('ol', 'st-toc-list');
    headings.forEach(function (h) {
      var li = node('li');
      var b = node('button', 'st-toc-link', h.textContent);
      b.type = 'button';
      /* Scrolls without touching the hash, which is the route. */
      b.addEventListener('click', function () {
        h.tabIndex = -1;
        h.scrollIntoView({ block: 'start' });
        h.focus({ preventScroll: true });
      });
      li.appendChild(b);
      ol.appendChild(li);
    });
    return ol;
  }

  function section(title) {
    var sec = node('section', 'st-section');
    sec.appendChild(node('h2', 'st-section-title', title));
    return sec;
  }

  function renderEntry(e) {
    var place = PLACE[e.id];
    var catHref = '#' + place.cat.key;
    var groupHref = catHref + '/' + place.group.key;
    writeLast(e.id);

    var art = node('article', 'st-entry');
    art.appendChild(crumbs([[place.cat.label, catHref], [place.group.label, groupHref]]));
    var h1 = node('h1', 'st-title', e.term);
    art.appendChild(h1);
    var meta = [];
    if (e.en) meta.push(e.en);
    if (e.aliases && e.aliases.length) meta.push('다른 표기: ' + e.aliases.join(', '));
    if (meta.length) art.appendChild(node('p', 'st-entry-meta', meta.join(' · ')));
    art.appendChild(node('p', 'st-entry-def', e.def));

    var body = buildBody(e.html);
    var grid = node('div', 'st-entry-grid');
    var main = node('div', 'st-entry-main');
    /* The rail and the <details> are one list shown at different widths. */
    if (body.headings.length >= 3) {
      var details = node('details', 'st-toc');
      details.appendChild(node('summary', null, '목차'));
      details.appendChild(tocList(body.headings));
      main.appendChild(details);
      var rail = node('nav', 'st-rail');
      rail.setAttribute('aria-label', '목차');
      rail.appendChild(node('p', 'st-rail-title', '목차'));
      rail.appendChild(tocList(body.headings));
      grid.classList.add('has-rail');
      grid.appendChild(rail);
      grid.appendChild(main);
    } else {
      grid.appendChild(main);
    }
    var prose = node('div', 'st-prose');
    prose.appendChild(body.node);
    main.appendChild(prose);

    var related = (e.related || []).filter(function (id) { return ENTRY[id]; });
    if (related.length) {
      var rel = section('관련 용어');
      var dl = node('dl', 'st-defs');
      related.forEach(function (id) { dl.appendChild(defRow(ENTRY[id])); });
      rel.appendChild(dl);
      main.appendChild(rel);
    }

    if (e.sources && e.sources.length) {
      var src = section('출처');
      SOURCE_TYPES.forEach(function (type) {
        var items = e.sources.filter(function (s) { return s.type === type[0]; });
        if (!items.length) return;
        src.appendChild(node('h3', 'st-src-type', type[1]));
        var list = node('ul', 'st-links');
        items.forEach(function (s) {
          var li = node('li');
          li.appendChild(outbound(s.url, s.section ? s.title + ' › ' + s.section : s.title));
          list.appendChild(li);
        });
        src.appendChild(list);
      });
      if (e.checked) src.appendChild(node('p', 'st-checked', e.checked + ' 확인' + (e.basis ? ' · ' + e.basis + ' 기준' : '')));
      main.appendChild(src);
    }

    main.appendChild(entryFoot(e, place));
    art.appendChild(grid);
    markTree(null, groupHref);
    show(art, h1);
  }

  function entryFoot(e, place) {
    var foot = node('footer', 'st-entry-foot');
    /* A toggle keeps one name; `aria-pressed` carries the state. The glyph is
       hidden, since CSS `content` would join the name. */
    var toggle = node('button', 'st-done');
    toggle.type = 'button';
    var glyph = node('span', null, '○');
    glyph.setAttribute('aria-hidden', 'true');
    toggle.appendChild(glyph);
    toggle.appendChild(document.createTextNode('이해함'));
    function sync() {
      var on = done.has(e.id);
      toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
      glyph.textContent = on ? '✓' : '○';
    }
    toggle.addEventListener('click', function () {
      if (done.has(e.id)) done.delete(e.id);
      else done.add(e.id);
      saveProgress();
      sync();
    });
    sync();
    foot.appendChild(toggle);

    var ids = place.group.ids.filter(function (id) { return ENTRY[id]; });
    var at = ids.indexOf(e.id);
    var pager = node('nav', 'st-pager');
    pager.setAttribute('aria-label', '같은 묶음의 이전·다음 용어');
    [[ids[at - 1], '이전', 'st-pager-prev'], [ids[at + 1], '다음', 'st-pager-next']].forEach(function (p) {
      if (!p[0]) return;
      var a = link('#' + p[0], p[2]);
      a.appendChild(node('span', 'st-pager-label', p[1]));
      a.appendChild(document.createTextNode(ENTRY[p[0]].term));
      pager.appendChild(a);
    });
    if (pager.firstChild) foot.appendChild(pager);
    return foot;
  }


  function parseRoute() {
    var raw;
    try {
      raw = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    } catch (e) {
      return { kind: 'missing', raw: location.hash };
    }
    if (!raw) return { kind: 'home' };
    var parts = raw.split('/');
    if (CAT[parts[0]]) {
      var cat = CAT[parts[0]];
      var group = parts[1] && cat.groups.some(function (g) { return g.key === parts[1]; }) ? parts[1] : null;
      return { kind: 'cat', cat: cat, group: group, stale: parts.length > 2 || (!!parts[1] && !group) };
    }
    var id = resolve(raw);
    if (id) return { kind: 'entry', id: id, moved: id !== raw };
    return { kind: 'missing', raw: raw };
  }

  function route(initial) {
    var r = parseRoute();
    if (r.kind === 'entry') {
      if (r.moved) history.replaceState(null, '', '#' + r.id);
      renderEntry(ENTRY[r.id]);
    } else if (r.kind === 'cat') {
      if (r.stale) history.replaceState(null, '', '#' + r.cat.key);
      renderCategory(r.cat, r.group);
    } else {
      /* On a touch screen focus the heading, not the search box: no keyboard pops up. */
      renderHome(r.kind === 'missing' ? r.raw.slice(0, 40) : null, !initial || coarse);
      if (initial && !coarse) el.q.focus();
    }
  }


  function lower(s) { return String(s == null ? '' : s).toLowerCase(); }

  function buildRows() {
    ROWS = ORDER.map(function (id, i) {
      var e = ENTRY[id];
      var names = [e.term].concat(e.en ? [e.en] : [], e.aliases || []).map(lower);
      return {
        id: id,
        order: i,
        names: names,
        head: names.join('\n') + '\n' + lower(e.def),
        hay: names.join('\n') + '\n' + lower(e.def) + '\n' + lower(e.text),
        folded: Object.create(null)
      };
    });
  }

  /* 초성 folding is built on first use and kept: a visit that never searches by
     initials never pays for it. */
  function has(row, field, token) {
    if (!PrivateSearch.isCho(token)) return row[field].indexOf(token) !== -1;
    if (!(field in row.folded)) row.folded[field] = PrivateSearch.fold(row[field]);
    return row.folded[field].indexOf(token) !== -1;
  }

  /* 0 exact headword · 1 headword prefix · 2 headword or definition · 3 body. */
  function tier(row, q) {
    var whole = q.pos.join(' ');
    var names = q.pos.length && q.pos.every(PrivateSearch.isCho) ? row.names.map(PrivateSearch.fold) : row.names;
    if (names.indexOf(whole) !== -1) return 0;
    if (whole && names.some(function (n) { return n.indexOf(whole) === 0; })) return 1;
    if (q.pos.every(function (t) { return has(row, 'head', t); })) return 2;
    return 3;
  }

  function search(raw) {
    var q = PrivateSearch.parseQuery(raw);
    if (!q.on) return null;
    var hits = [];
    ROWS.forEach(function (row) {
      var keep = q.pos.every(function (t) { return has(row, 'hay', t); }) &&
                 !q.neg.some(function (t) { return has(row, 'hay', t); });
      if (keep) hits.push({ row: row, tier: tier(row, q) });
    });
    hits.sort(function (a, b) { return a.tier - b.tier || a.row.order - b.row.order; });
    return { q: q, hits: hits };
  }

  /* Marks are built from text nodes: the text holds `<` and `&` as themselves. */
  function marked(text, tokens) {
    var frag = document.createDocumentFragment();
    var at = 0;
    PrivateSearch.rangesFor(text, tokens).forEach(function (r) {
      if (r[0] > at) frag.appendChild(document.createTextNode(text.slice(at, r[0])));
      frag.appendChild(node('mark', null, text.slice(r[0], r[1])));
      at = r[1];
    });
    if (at < text.length) frag.appendChild(document.createTextNode(text.slice(at)));
    return frag;
  }

  /* Built once and updated in place: redrawing a row inside its own click
     handler drops focus to <body>. */
  function buildChips() {
    [{ key: '', label: '전체' }].concat(DATA.cats).forEach(function (cat) {
      var b = node('button', 'st-chip');
      b.type = 'button';
      b.appendChild(document.createTextNode(cat.label));
      var count = node('span', 'st-chip-n');
      b.appendChild(count);
      b.addEventListener('click', function () {
        searchCat = cat.key;
        renderResults();
      });
      el.resultCats.appendChild(b);
      CHIPS.push({ key: cat.key, node: b, count: count });
    });
  }

  var lastHits = [];

  function renderResults() {
    var res = search(el.q.value);
    el.results.hidden = !res;
    el.view.hidden = !!res;
    if (!res) {
      lastHits = [];
      searchCat = '';
      say('');
      return;
    }
    var perCat = Object.create(null);
    res.hits.forEach(function (h) {
      var key = PLACE[h.row.id].cat.key;
      perCat[key] = (perCat[key] || 0) + 1;
    });
    if (searchCat && !perCat[searchCat]) searchCat = '';
    CHIPS.forEach(function (c) {
      var n = c.key ? perCat[c.key] || 0 : res.hits.length;
      c.count.textContent = ' ' + n;
      c.node.hidden = c.key !== '' && n === 0;
      c.node.setAttribute('aria-pressed', c.key === searchCat ? 'true' : 'false');
    });

    lastHits = res.hits.filter(function (h) { return !searchCat || PLACE[h.row.id].cat.key === searchCat; });
    el.resultList.textContent = '';
    lastHits.forEach(function (h) {
      var e = ENTRY[h.row.id];
      var place = PLACE[e.id];
      var li = node('li', 'st-result');
      var a = link('#' + e.id, 'st-result-link');
      var term = node('span', 'st-result-term');
      term.appendChild(marked(e.term, res.q.pos));
      a.appendChild(term);
      a.appendChild(node('span', 'st-result-path', place.cat.label + ' › ' + place.group.label));
      var def = node('span', 'st-result-def');
      def.appendChild(marked(e.def, res.q.pos));
      a.appendChild(def);
      li.appendChild(a);
      el.resultList.appendChild(li);
    });
    el.resultEmpty.hidden = lastHits.length > 0;
    say('검색 결과 ' + lastHits.length + '건');
  }

  function clearSearch() {
    if (!el.q.value) return;
    el.q.value = '';
    searchCat = '';
    renderResults();
  }

  function here() { return '#' + location.hash.slice(1); }

  /* Written onto the history entry being left: the redraw after Back would
     otherwise override the browser's own scroll restore. */
  function stamp(href) {
    try {
      history.replaceState({ y: window.pageYOffset, href: href, q: el.q.value, cat: searchCat }, '');
    } catch (e) { /* only a convenience */ }
  }

  function restore(st) {
    if (!st || typeof st !== 'object') return;
    if (typeof st.q === 'string' && st.q) {
      el.q.value = st.q;
      searchCat = typeof st.cat === 'string' ? st.cat : '';
      renderResults();
    }
    if (typeof st.y === 'number') window.scrollTo(0, st.y);
    var back = null;
    Array.prototype.some.call(document.querySelectorAll('#st-view a, #st-result-list a'), function (a) {
      if (a.getAttribute('href') === st.href) back = a;
      return !!back;
    });
    if (back) back.focus({ preventScroll: true });
  }

  /* A link to the hash already showing fires no `hashchange`, which would leave
     the results covering the entry the reader just picked. */
  function open(id) {
    if (here() === '#' + id) {
      clearSearch();
      route(false);
    } else {
      stamp('#' + id);
      location.hash = '#' + id;
    }
  }

  function plainClick(e) {
    return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
  }


  function start(data) {
    index(data);
    loadProgress();
    buildRows();
    buildTree();
    buildChips();

    el.q.addEventListener('input', renderResults);
    el.resultList.addEventListener('click', function (e) {
      var a = e.target.closest('a');
      if (!a || !plainClick(e)) return;
      e.preventDefault();
      open(a.getAttribute('href').slice(1));
    });
    document.addEventListener('click', function (e) {
      var a = !el.app.hidden && e.target.closest('a[href^="#"]');
      if (a && a.getAttribute('href') !== here()) stamp(a.getAttribute('href'));
    }, true);
    document.addEventListener('click', function (e) {
      if (el.app.hidden || e.defaultPrevented || !plainClick(e)) return;
      var a = e.target.closest('a[href^="#"]');
      if (!a || a.getAttribute('href') !== here()) return;
      e.preventDefault();
      clearSearch();
      route(false);
    });
    el.q.addEventListener('keydown', function (e) {
      if (e.isComposing) return;
      if (e.key === 'Enter' && lastHits.length) {
        e.preventDefault();
        open(lastHits[0].row.id);
      } else if (e.key === 'Escape' && el.q.value) {
        e.preventDefault();
        clearSearch();
      }
    });

    /* Mid-Hangul keydown carries the physical key: without `isComposing` a `/` would steal focus. */
    document.addEventListener('keydown', function (e) {
      if (e.isComposing || e.altKey || (gate.box && !gate.box.hidden)) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        el.q.focus();
        el.q.select();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.key !== '/') return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault();
      el.q.focus();
      el.q.select();
    });

    /* Every link here is a hash, so this is the whole router, Back included. */
    window.addEventListener('hashchange', function () {
      var st = history.state;
      clearSearch();
      route(false);
      restore(st);
    });

    el.boot.hidden = true;
    el.app.hidden = false;
    route(true);
  }


  var MESSAGES = {
    unsupported: '이 브라우저에서는 이 페이지를 열 수 없습니다. 최신 브라우저로 접속해 주세요.',
    empty: '이 페이지에 담긴 항목이 없습니다. 항목 없이 빌드된 것 같습니다.',
    unreadable: '페이지 데이터를 읽지 못했습니다. 새로고침해 주세요.',
    stale: '페이지가 갱신됐습니다. 새로고침해 주세요.',
    framed: '다른 사이트 안에서는 이 페이지를 볼 수 없습니다.',
    copy: '본문은 복사할 수 없습니다. 코드 블록은 복사할 수 있습니다.',
    unlocked: '✅ 텍스트 선택·복사가 열렸습니다!',
    keep: '이 페이지는 저장하거나 인쇄할 수 없습니다.'
  };

  function fail(message) {
    el.boot.textContent = message;
    el.boot.classList.add('is-error');
  }

  var toastTimer = 0;
  function notice(message) {
    /* Cleared first, or a second identical notice would not be read again. */
    el.status.textContent = '';
    setTimeout(function () { say(message); }, 30);
    el.toast.textContent = message;
    el.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('is-on'); }, 2400);
  }

  /* Copying is discouraged, not prevented (decided 2026-09-30): the developer
     tools, a screenshot or OCR still read the page, and the gate below opens
     it to whoever has the password. COPYABLE must equal what
     `tool-content-lock` leaves selectable; a test holds that. */
  var COPYABLE = 'input, textarea, select, [contenteditable], pre, code, kbd, samp, .highlight';
  /* These two links wrap a whole definition or category description, which a
     phone's "copy link text" would take without firing `copy`. */
  var MENU_OK = COPYABLE + ', a:not(.st-result-link):not(.st-card-link)';
  var MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');

  function inside(node, selector) {
    var n = node && node.nodeType === 1 ? node : node && node.parentNode;
    return !!(n && n.closest && n.closest(selector));
  }

  /* Every range, not the two ends: a drag from one code block to the next ends
     inside both while spanning the prose between them. */
  function selectionIsCopyable() {
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return true;
    var sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed) return true;
    for (var i = 0; i < sel.rangeCount; i++) {
      if (!inside(sel.getRangeAt(i).commonAncestorContainer, COPYABLE)) return false;
    }
    return true;
  }

  /* The password /resume/ and /portfolio/ take (decided 2026-10-02) lifts the
     lock for this page load. It is never stored, so a reload locks again. */
  var gate = {
    box: byId('st-gate'),
    input: byId('st-gate-input'),
    error: byId('st-gate-error'),
    errorText: '',
    back: null,
    pressOnBackdrop: false
  };
  if (gate.error) gate.errorText = gate.error.textContent;
  var unlocked = false;
  var dragProbe = null;

  function openGate() {
    if (!gate.box) { notice(MESSAGES.copy); return; }
    if (!gate.box.hidden) return;
    gate.back = document.activeElement;
    gate.pressOnBackdrop = false;
    gate.box.hidden = false;
    gate.error.hidden = true;
    gate.input.value = '';
    gate.input.focus();
  }

  /* preventScroll: a long press keeps focus on the entry heading, and focusing
     it again would jump away from the paragraph about to be copied. */
  function closeGate() {
    gate.box.hidden = true;
    gate.input.value = '';
    var back = gate.back;
    gate.back = null;
    if (back && back !== document.body && back.isConnected) back.focus({ preventScroll: true });
  }

  function checkGate() {
    /* An absent or malformed attribute is a wrong password, not no gate. */
    var expected = gate.box.getAttribute('data-k');
    var ok = false;
    try { ok = !!expected && gate.input.value === window.atob(expected); } catch (err) { ok = false; }
    if (!ok) {
      gate.input.value = '';
      gate.input.focus();
      gate.error.hidden = false;
      /* Emptied first, or a second wrong try would not be read again. */
      gate.error.textContent = '';
      setTimeout(function () { gate.error.textContent = gate.errorText; }, 30);
      return;
    }
    unlocked = true;
    document.body.classList.add('st-unlocked');
    closeGate();
    notice(MESSAGES.unlocked);
  }

  function guardCopy(e) {
    if (unlocked || selectionIsCopyable()) return;
    e.preventDefault();
    openGate();
  }

  document.addEventListener('copy', guardCopy);
  document.addEventListener('cut', guardCopy);
  document.addEventListener('contextmenu', function (e) {
    if (unlocked || inside(e.target, MENU_OK)) return;
    e.preventDefault();
    if (!inside(e.target, 'button, summary, label, #st-gate')) openGate();
  });
  document.addEventListener('dragstart', function (e) {
    if (unlocked) return;
    if (!inside(e.target, COPYABLE) || !selectionIsCopyable()) e.preventDefault();
  });

  /* A selection the lock refuses fires no event, so a mouse drag over prose
     asks instead. Mouse only: on touch a move is a scroll. */
  function onScrollbar(e) {
    var t = e.target;
    /* An inline element reports a client width of 0 and has no scrollbar. */
    if (t.nodeType !== 1 || !t.clientWidth) return false;
    return e.offsetX >= t.clientWidth || e.offsetY >= t.clientHeight;
  }

  function dropProbe() { dragProbe = null; }

  document.addEventListener('pointerdown', function (e) {
    dragProbe = null;
    if (unlocked || e.pointerType !== 'mouse' || e.button !== 0 || onScrollbar(e)) return;
    if (inside(e.target, COPYABLE + ', a, button, summary, label, #st-gate')) return;
    dragProbe = { x: e.clientX, y: e.clientY };
  });
  document.addEventListener('pointermove', function (e) {
    if (unlocked || !dragProbe) return;
    /* A missed pointerup must not turn a later hover into a drag. */
    if (!(e.buttons & 1)) { dragProbe = null; return; }
    /* A jittery click is not a drag. Cleared as it fires: one prompt per gesture. */
    if (Math.abs(e.clientX - dragProbe.x) + Math.abs(e.clientY - dragProbe.y) < 24) return;
    dragProbe = null;
    openGate();
  });
  document.addEventListener('pointerup', dropProbe);
  document.addEventListener('pointercancel', dropProbe);
  /* An overlay scrollbar takes no layout width, so a thumb drag is caught here instead. */
  document.addEventListener('scroll', dropProbe, true);

  if (gate.box) {
    byId('st-gate-ok').addEventListener('click', checkGate);
    byId('st-gate-cancel').addEventListener('click', closeGate);
    /* Both ends on the backdrop: a press in the field released outside is not a dismissal. */
    gate.box.addEventListener('pointerdown', function (e) { gate.pressOnBackdrop = e.target === gate.box; });
    gate.box.addEventListener('click', function (e) {
      if (e.target === gate.box && gate.pressOnBackdrop) closeGate();
    });
    gate.box.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeGate();
      } else if (e.key === 'Enter' && e.target === gate.input && !e.isComposing) {
        e.preventDefault();
        checkGate();
      } else if (e.key === 'Tab') {
        /* aria-modal says nothing lies behind it, so focus may not wander there. */
        var stops = [gate.input, byId('st-gate-ok'), byId('st-gate-cancel')];
        var at = stops.indexOf(document.activeElement);
        var next = at < 0 ? (e.shiftKey ? stops.length - 1 : 0) : (at + (e.shiftKey ? stops.length - 1 : 1)) % stops.length;
        e.preventDefault();
        stops[next].focus();
      }
    });
    /* Registered before the router's own listener, so the gate is gone before the new page takes focus. */
    window.addEventListener('hashchange', function () {
      if (!gate.box.hidden) closeGate();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.altKey || e.shiftKey || !(MAC ? e.metaKey : e.ctrlKey)) return;
    var key = (e.key || '').toLowerCase();
    /* A focused code block selects itself, so a keyboard can copy it too. */
    var box = document.activeElement;
    if (key === 'a' && box && box.tagName === 'PRE') {
      e.preventDefault();
      var range = document.createRange();
      range.selectNodeContents(box);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    /* The print stylesheet blanks the page; this stops the shortcuts first. */
    if (key !== 's' && key !== 'p') return;
    e.preventDefault();
    notice(MESSAGES.keep);
  });

  function inflates() {
    return typeof window.DecompressionStream === 'function' && typeof window.Response === 'function' &&
      typeof window.Blob === 'function' && typeof window.Blob.prototype.stream === 'function';
  }

  /* Gzipped JSON in base64, as _plugins/study_build.rb writes it. */
  function decode(b64) {
    var bin = window.atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var stream = new Blob([bytes]).stream().pipeThrough(new window.DecompressionStream('gzip'));
    return new Response(stream).text().then(JSON.parse);
  }

  /* GitHub Pages sends no frame-ancestors header, so a frame on another site
     is the script's to refuse: it tries to leave the frame, and draws nothing
     if the frame will not let it. A same-origin parent is left alone. */
  function framedElsewhere() {
    if (window.top === window.self) return false;
    try { return window.top.location.origin !== window.location.origin; } catch (err) { return true; }
  }

  if (framedElsewhere()) {
    try { window.top.location.replace(window.location.href); } catch (err) { /* sandboxed or blocked */ }
    fail(MESSAGES.framed);
    var out = link(window.location.href, null, '새 창에서 열기');
    out.target = '_top';
    el.boot.appendChild(document.createTextNode(' '));
    el.boot.appendChild(out);
    return;
  }

  var payload = el.payload.dataset.payload || '';
  if (!inflates()) {
    fail(MESSAGES.unsupported);
  } else if (!payload) {
    fail(MESSAGES.empty);
  } else {
    /* Through a promise from the start: atob throws synchronously on bad base64. */
    Promise.resolve(payload).then(decode).then(function (data) {
      /* An older cached ui.js cannot draw a newer payload. */
      if (!data || data.v !== 1) {
        fail(MESSAGES.stale);
        return;
      }
      try {
        start(data);
      } catch (err) {
        el.app.hidden = true;
        el.boot.hidden = false;
        fail(MESSAGES.stale);
      }
    }, function () { fail(MESSAGES.unreadable); });
  }
})();
