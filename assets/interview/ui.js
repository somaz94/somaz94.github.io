/* Interview page — the only file here that touches the DOM. `crypto.js` is pure
 * and loads first.
 *
 * NOTHING IS BUILT WITH innerHTML: a `<` or `&` in a question must render as
 * itself, so every decrypted string goes through `textContent`.
 *
 * STORAGE: `iv-progress-v1` holds question IDs only. Writing decrypted content
 * or the passphrase to storage would move it back out of the envelope onto disk;
 * a refresh asks for the passphrase again.
 */
(function () {
  'use strict';

  var PROGRESS_KEY = 'iv-progress-v1';

  var el = {
    payload: document.getElementById('iv-payload'),
    lock: document.getElementById('iv-lock'),
    form: document.getElementById('iv-form'),
    pass: document.getElementById('iv-pass'),
    unlock: document.getElementById('iv-unlock'),
    msg: document.getElementById('iv-lock-msg'),
    app: document.getElementById('iv-app'),
    modeRow: document.getElementById('iv-mode-row'),
    lensField: document.getElementById('iv-lens-field'),
    lensRow: document.getElementById('iv-lens-row'),
    kindField: document.getElementById('iv-kind-field'),
    kindRow: document.getElementById('iv-kind-row'),
    cat: document.getElementById('iv-cat'),
    catField: document.getElementById('iv-cat-field'),
    diff: document.getElementById('iv-diff'),
    q: document.getElementById('iv-q'),
    undone: document.getElementById('iv-undone'),
    starred: document.getElementById('iv-starred'),
    starredField: document.getElementById('iv-starred-field'),
    reset: document.getElementById('iv-reset'),
    count: document.getElementById('iv-count'),
    elsewhere: document.getElementById('iv-elsewhere'),
    list: document.getElementById('iv-list'),
    empty: document.getElementById('iv-empty'),
    emptyHere: document.getElementById('iv-empty-here'),
    emptyAway: document.getElementById('iv-empty-away'),
    statTotal: document.getElementById('iv-stat-total'),
    statDone: document.getElementById('iv-stat-done'),
    statTotalLabel: document.getElementById('iv-stat-total-l'),
    diffField: document.getElementById('iv-diff-field'),
    statAxis: document.getElementById('iv-stat-axis'),
    statLenses: document.getElementById('iv-stat-lenses'),
    statMeta: document.getElementById('iv-stat-meta')
  };

  var DATA = null;       // the decrypted bank
  var ROWS = [];         // one entry per question, with its <li> and search text
  var LENS = {};         // key -> lens object
  var KINDS = {};        // key -> kind object  (질문 성격)
  var CATS = {};         // key -> label   (rehearsal bank)
  var CS_CATS = {};      // key -> label   (cs bank)
  var TERM_CATS = {};    // key -> label   (terms bank)
  /* `refs` targets, by id. `Object.create(null)`: a plain literal answers
     `x['constructor']` with a truthy function, a silently wrong row. */
  var TERM_BY_ID = Object.create(null);
  var CARD_BY_ID = Object.create(null);
  var done = new Set();
  var activeLens = '';   // '' = all
  var activeKind = '';   // '' = all

  /* Which bank is on screen. Every bank is built once into ROWS and the mode is
     just another filter predicate, so switching costs no rebuild. */
  var mode = 'interview';   // a key of BANKS

  /* Unknown ids are dropped, so "완료" can never exceed the rows on screen. */
  function loadProgress(validIds) {
    var out = new Set();
    var raw;
    try {
      raw = localStorage.getItem(PROGRESS_KEY);
    } catch (e) {
      return out;   /* private mode — progress just does not persist */
    }
    if (!raw) return out;
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return out;
    }
    if (!Array.isArray(parsed)) return out;
    parsed.forEach(function (id) {
      if (typeof id === 'string' && validIds.has(id)) out.add(id);
    });
    return out;
  }

  function saveProgress() {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(Array.from(done)));
    } catch (e) {
      /* Quota or private mode: the checkbox still works for this visit. */
    }
  }

  function textNode(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function dots(level) {
    var n = Math.max(1, Math.min(4, Number(level) || 1));
    var s = textNode('span', 'iv-dots', '●●●●'.slice(0, n) + '○○○○'.slice(0, 4 - n));
    s.setAttribute('aria-label', '난이도 ' + n + ' / 4');
    s.dataset.diff = String(n);
    return s;
  }

  function anchorsBlock(q) {
    var wrap = textNode('div', 'iv-anchors');
    wrap.appendChild(textNode('span', 'iv-anchors-label', '근거'));
    var list = textNode('ul', 'iv-anchor-list');

    if (!q.anchors || !q.anchors.length) {
      /* `evidence: none` is stated, or a blank 근거 reads as a missing anchor. */
      var li = textNode('li', 'iv-anchor iv-anchor-none', '이력서 밖 — 회사·상황에 따라 답이 달라지는 질문');
      list.appendChild(li);
    } else {
      q.anchors.forEach(function (a) {
        var li = textNode('li', 'iv-anchor');
        li.appendChild(textNode('code', 'iv-anchor-file', (a.file || '?') + '.yml'));
        li.appendChild(textNode('code', 'iv-anchor-id', a.id || '?'));
        if (a.label) li.appendChild(textNode('span', 'iv-anchor-label', a.label));
        list.appendChild(li);
      });
    }
    wrap.appendChild(list);
    return wrap;
  }

  function starBlock(q) {
    var star = q.star || {};
    var wrap = textNode('div', 'iv-star');

    function row(letter, name, value, blank) {
      var r = textNode('div', 'iv-star-row' + (blank ? ' iv-star-blank' : ''));
      r.appendChild(textNode('span', 'iv-star-key', letter));
      var b = textNode('div', 'iv-star-body');
      b.appendChild(textNode('span', 'iv-star-name', name));
      if (blank) {
        /* Not an <input>: a typed answer is worth keeping, and keeping it means
           writing decrypted content to disk. */
        b.appendChild(textNode('span', 'iv-star-line', ''));
      } else {
        b.appendChild(textNode('span', 'iv-star-text', value || ''));
      }
      r.appendChild(b);
      return r;
    }

    wrap.appendChild(row('S', '상황', star.s, false));
    wrap.appendChild(row('T', '과제', star.t, false));
    wrap.appendChild(row('A', '내가 한 것 — 소리 내어 답해 보세요', null, true));
    wrap.appendChild(row('R', '결과 — 수치까지', null, true));
    return wrap;
  }

  function factsBlock(q) {
    if (!q.facts || !q.facts.length) return null;
    var d = document.createElement('details');
    d.className = 'iv-facts';
    var s = textNode('summary', 'iv-facts-sum', '근거 확인 (' + q.facts.length + ')');
    d.appendChild(s);
    var ul = textNode('ul', 'iv-fact-list');
    q.facts.forEach(function (f) { ul.appendChild(textNode('li', 'iv-fact', f)); });
    d.appendChild(ul);
    return d;
  }

  /* Closed and placed AFTER 근거 확인: answer, check the facts, then compare.
     Labelled a draft because these are the only generated words on the page. */
  function draftBlock(q) {
    if (!q.draft || !q.draft.a) return null;
    var d = document.createElement('details');
    d.className = 'iv-draft';
    d.appendChild(textNode('summary', 'iv-draft-sum', '초안 보기'));

    var note = textNode('p', 'iv-draft-note',
      '이력서 근거만으로 쓴 초안입니다. 본인 표현으로 바꿔서 쓰세요.');
    d.appendChild(note);

    function part(letter, text) {
      var row = textNode('div', 'iv-draft-row');
      row.appendChild(textNode('span', 'iv-draft-key', letter));
      var body = textNode('div', 'iv-draft-body');
      String(text).split('\n').forEach(function (para) {
        if (!para.trim()) return;
        body.appendChild(textNode('p', 'iv-draft-text', para.trim()));
      });
      row.appendChild(body);
      return row;
    }
    d.appendChild(part('A', q.draft.a));
    if (q.draft.r) d.appendChild(part('R', q.draft.r));
    return d;
  }

  /* A follow-up is EITHER a bare string or `{q, a}`, and both shapes are
     permanent: a rehearsal follow-up often has no answer anyone but the reader
     can give. Normalised once for render and search. */
  function followPair(f) {
    if (typeof f === 'string') return { q: f, a: '' };
    return { q: (f && f.q) || '', a: (f && f.a) || '' };
  }

  function followText(list) {
    return (list || []).map(function (f) {
      var p = followPair(f);
      return p.a ? p.q + ' ' + p.a : p.q;
    /* Collapse newlines so a quoted phrase can still match across a paragraph break. */
    }).join(' ').replace(/\s+/g, ' ');
  }

  /* Answered follow-up = closed disclosure; unanswered = plain text, so the two
     are told apart before either is clicked. */
  function followBlock(q) {
    if (!q.follow_ups || !q.follow_ups.length) return null;
    var wrap = textNode('div', 'iv-follow');
    wrap.appendChild(textNode('span', 'iv-follow-label', '꼬리질문'));
    var ul = textNode('ul', 'iv-follow-list');
    q.follow_ups.forEach(function (f) {
      var p = followPair(f);
      if (!p.a) {
        ul.appendChild(textNode('li', 'iv-follow-item', p.q));
        return;
      }
      /* A modifier class, not `:has()`: Safari < 15.4 and Firefox < 121 would
         drop the rule and leave two markers on every answered row. */
      var li = textNode('li', 'iv-follow-item iv-follow-item-a');
      var d = document.createElement('details');
      d.className = 'iv-follow-d';
      var sum = textNode('summary', 'iv-follow-sum', p.q);
      /* The caret REPLACES the `↳`, inserted FIRST so it sits where the eye
         scans. A real element so it can be aria-hidden: the disclosure already
         announces its state. */
      var caret = textNode('span', 'iv-follow-caret', '▸');
      caret.setAttribute('aria-hidden', 'true');
      sum.insertBefore(caret, sum.firstChild);
      d.appendChild(sum);
      /* The border stays on the container: one per <p> would break the line
         into segments. */
      var body = textNode('div', 'iv-follow-a');
      String(p.a).split('\n').forEach(function (para) {
        if (!para.trim()) return;
        body.appendChild(textNode('p', 'iv-follow-p', para.trim()));
      });
      d.appendChild(body);
      li.appendChild(d);
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    return wrap;
  }

  /* Ref labels are on screen, so they are searchable. A term's `detail` is left
     out: the glossary row already carries it. */
  function refsText(q) {
    return (q.refs || []).map(function (id) {
      var t = TERM_BY_ID[id];
      if (t) return t.term + ' ' + (t.desc || '');
      var c = CARD_BY_ID[id];
      return c ? c.q : '';
    }).join(' ');
  }

  /* `refs` link into the OTHER banks. A glossary term opens IN PLACE (it fits
     under the question); a card NAVIGATES via the deep-link path and pushes
     history so Back returns. An unresolved id is dropped, not rendered dead. */
  function refsBlock(q) {
    if (!q.refs || !q.refs.length) return null;
    var rows = [];
    q.refs.forEach(function (id) {
      var t = TERM_BY_ID[id];
      if (t) { rows.push({ kind: 'term', id: id, term: t }); return; }
      var c = CARD_BY_ID[id];
      if (c) rows.push({ kind: 'card', id: id, q: c.q, bank: c.bank });
    });
    if (!rows.length) return null;

    var wrap = textNode('div', 'iv-refs');
    wrap.appendChild(textNode('span', 'iv-refs-label', '함께 보기'));
    var ul = textNode('ul', 'iv-refs-list');

    rows.forEach(function (r) {
      var li = textNode('li', 'iv-ref');
      if (r.kind === 'term') {
        var det = document.createElement('details');
        det.className = 'iv-ref-d';
        var sm = textNode('summary', 'iv-ref-sum');
        sm.appendChild(textNode('span', 'iv-ref-kind', '용어'));
        sm.appendChild(textNode('span', 'iv-ref-name', r.term.term));
        det.appendChild(sm);
        var bd = textNode('div', 'iv-ref-body');
        bd.appendChild(textNode('p', 'iv-ref-desc', r.term.desc));
        if (r.term.detail) bd.appendChild(textNode('p', 'iv-ref-detail', r.term.detail));
        det.appendChild(bd);
        li.appendChild(det);
      } else {
        var a = document.createElement('a');
        a.className = 'iv-ref-link';
        a.href = '#' + r.id;
        a.appendChild(textNode('span', 'iv-ref-kind', r.bank === 'cs' ? 'CS 지식' : '면접 질문'));
        a.appendChild(textNode('span', 'iv-ref-name', r.q));
        a.addEventListener('click', function (e) {
          e.preventDefault();
          if (history.pushState) {
            /* Stamp the current card first, or Back lands on an entry with no
               hash and `openDeepLink` has nothing to return to. */
            history.replaceState(null, '', '#' + q.id);
            history.pushState(null, '', '#' + r.id);
          } else {
            location.hash = r.id;
          }
          openDeepLink();
        });
        li.appendChild(a);
      }
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    return wrap;
  }

  /* Unlike `anchorsBlock`, renders NOTHING without anchors: most CS questions
     legitimately have none, so a "이력서 밖" line would be noise. */
  function csAnchorsBlock(q) {
    if (!q.anchors || !q.anchors.length) return null;
    var wrap = textNode('div', 'iv-anchors');
    wrap.appendChild(textNode('span', 'iv-anchors-label', '내 경험과 연결'));
    var list = textNode('ul', 'iv-anchor-list');
    q.anchors.forEach(function (a) {
      var li = textNode('li', 'iv-anchor');
      li.appendChild(textNode('code', 'iv-anchor-file', (a.file || '?') + '.yml'));
      li.appendChild(textNode('code', 'iv-anchor-id', a.id || '?'));
      if (a.label) li.appendChild(textNode('span', 'iv-anchor-label', a.label));
      list.appendChild(li);
    });
    wrap.appendChild(list);
    return wrap;
  }

  /* Closed by default: say it out loud, then open. */
  function csAnswerBlock(q) {
    var d = document.createElement('details');
    d.className = 'iv-answer';
    d.appendChild(textNode('summary', 'iv-answer-sum',
      '답변 확인 (' + q.answer.length + ')'));
    var ol = textNode('ol', 'iv-answer-list');
    q.answer.forEach(function (a) {
      ol.appendChild(textNode('li', 'iv-answer-item', a));
    });
    d.appendChild(ol);

    /* Inside the disclosure: shown up front it gives away the sharpest half. */
    if (q.trap) {
      var t = textNode('div', 'iv-trap');
      t.appendChild(textNode('span', 'iv-trap-label', '갈리는 지점'));
      t.appendChild(textNode('p', 'iv-trap-text', q.trap));
      d.appendChild(t);
    }
    return d;
  }

  function buildCsRow(q, index) {
    var li = textNode('li', 'iv-item iv-item-cs');
    li.dataset.id = q.id;

    var label = textNode('label', 'iv-done');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = done.has(q.id);
    box.setAttribute('aria-label', '완료 표시: ' + q.q);
    box.addEventListener('change', function () {
      if (box.checked) done.add(q.id); else done.delete(q.id);
      li.classList.toggle('is-done', box.checked);
      saveProgress();
      renderStats();
      if (el.undone.checked) applyFilters();
    });
    label.appendChild(box);
    li.appendChild(label);
    if (box.checked) li.classList.add('is-done');

    var d = document.createElement('details');
    d.className = 'iv-card';

    var sum = textNode('summary', 'iv-sum');
    var chips = textNode('div', 'iv-chips');
    var catChip = textNode('span', 'iv-chip iv-chip-cs', CS_CATS[q.category] || q.category);
    catChip.dataset.cat = q.category;
    chips.appendChild(catChip);
    chips.appendChild(dots(q.difficulty));
    if (q.starred) chips.appendChild(starChip());
    chips.appendChild(textNode('span', 'iv-num', '#' + (index + 1)));
    sum.appendChild(chips);
    sum.appendChild(textNode('span', 'iv-q-text', q.q));
    d.appendChild(sum);

    var body = textNode('div', 'iv-body');
    var a = csAnchorsBlock(q);
    if (a) body.appendChild(a);
    body.appendChild(csAnswerBlock(q));
    var fu = followBlock(q);
    if (fu) body.appendChild(fu);
    d.appendChild(body);

    li.appendChild(d);

    return {
      id: q.id,
      mode: 'cs',
      lens: '',
      kind: '',
      cat: q.category,
      diff: String(q.difficulty),
      starred: !!q.starred,
      node: li,
      hay: [
        q.q,
        (q.answer || []).join(' '),
        q.trap || '',
        followText(q.follow_ups),
        (q.anchors || []).map(function (x) { return (x.id || '') + ' ' + (x.label || ''); }).join(' ')
      ].join(' ').toLowerCase()
    };
  }

  /* The glossary: a term with its definition hidden is a flashcard. The
     checkbox makes `미완료만` mean "terms I have not marked as known". */
  function buildTermRow(t, index) {
    var li = textNode('li', 'iv-item iv-item-term');
    li.dataset.id = t.id;

    var label = textNode('label', 'iv-done');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = done.has(t.id);
    box.setAttribute('aria-label', '아는 용어로 표시: ' + t.term);
    box.addEventListener('change', function () {
      if (box.checked) done.add(t.id); else done.delete(t.id);
      li.classList.toggle('is-done', box.checked);
      saveProgress();
      renderStats();
      if (el.undone.checked) applyFilters();
    });
    label.appendChild(box);
    li.appendChild(label);
    if (box.checked) li.classList.add('is-done');

    var d = document.createElement('details');
    d.className = 'iv-card';

    var sum = textNode('summary', 'iv-sum');
    var chips = textNode('div', 'iv-chips');
    var catChip = textNode('span', 'iv-chip iv-chip-term', TERM_CATS[t.category] || t.category);
    catChip.dataset.cat = t.category;
    chips.appendChild(catChip);
    /* The wiki's own subsection; a second grouping scheme would disagree with it. */
    if (t.group) chips.appendChild(textNode('span', 'iv-group', t.group));
    chips.appendChild(textNode('span', 'iv-num', '#' + (index + 1)));
    sum.appendChild(chips);
    sum.appendChild(textNode('span', 'iv-q-text', t.term));
    d.appendChild(sum);

    var body = textNode('div', 'iv-body');
    body.appendChild(textNode('p', 'iv-term-desc', t.desc));
    /* A plain paragraph, NOT a nested disclosure: the card already is one. */
    if (t.detail) body.appendChild(textNode('p', 'iv-term-detail', t.detail));
    d.appendChild(body);

    li.appendChild(d);

    return {
      id: t.id,
      mode: 'terms',
      lens: '',
      kind: '',
      cat: t.category,
      diff: '',
      node: li,
      hay: [t.term, t.desc, t.detail || '', t.group || ''].join(' ').toLowerCase()
    };
  }

  /* Here the BODY IS THE SCRIPT, said aloud close to verbatim. Split into <p>
     on the newline: via textContent one node would collapse it into one block. */
  function buildScriptRow(sc, index) {
    var li = textNode('li', 'iv-item iv-item-script');
    li.dataset.id = sc.id;

    var label = textNode('label', 'iv-done');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = done.has(sc.id);
    box.setAttribute('aria-label', '연습 완료 표시: ' + sc.title);
    box.addEventListener('change', function () {
      if (box.checked) done.add(sc.id); else done.delete(sc.id);
      li.classList.toggle('is-done', box.checked);
      saveProgress();
      renderStats();
      if (el.undone.checked) applyFilters();
    });
    label.appendChild(box);
    li.appendChild(label);
    if (box.checked) li.classList.add('is-done');

    var d = document.createElement('details');
    d.className = 'iv-card';

    var sum = textNode('summary', 'iv-sum');
    var chips = textNode('div', 'iv-chips');
    var kindChip = textNode('span', 'iv-chip iv-chip-script', sc.kind === 'closing' ? '마무리' : '오프닝');
    kindChip.dataset.kind = sc.kind;
    chips.appendChild(kindChip);
    /* A target, not a measurement: over-running is how a 자기소개 goes wrong. */
    if (sc.seconds) chips.appendChild(textNode('span', 'iv-group', '약 ' + sc.seconds + '초'));
    chips.appendChild(textNode('span', 'iv-num', '#' + (index + 1)));
    sum.appendChild(chips);
    sum.appendChild(textNode('span', 'iv-q-text', sc.title));
    d.appendChild(sum);

    var body = textNode('div', 'iv-body');
    var paras = String(sc.body || '').split('\n').filter(function (line) {
      return line.trim() !== '';
    });
    paras.forEach(function (line) {
      body.appendChild(textNode('p', 'iv-script-para', line.trim()));
    });
    /* Where a reader checks every figure against the resume before saying it. */
    body.appendChild(anchorsBlock(sc));
    d.appendChild(body);

    li.appendChild(d);

    return {
      id: sc.id,
      mode: 'script',
      lens: '',
      kind: '',
      cat: '',
      diff: '',
      node: li,
      hay: [
        sc.title,
        sc.body,
        sc.kind,
        (sc.anchors || []).map(function (a) { return (a.id || '') + ' ' + (a.label || ''); }).join(' ')
      ].join(' ').toLowerCase()
    };
  }

  function buildRow(q, index) {
    var li = textNode('li', 'iv-item');
    li.dataset.id = q.id;

    /* OUTSIDE <details>: inside <summary> a click would also toggle the card. */
    var label = textNode('label', 'iv-done');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = done.has(q.id);
    box.setAttribute('aria-label', '완료 표시: ' + q.q);
    box.addEventListener('change', function () {
      if (box.checked) done.add(q.id); else done.delete(q.id);
      li.classList.toggle('is-done', box.checked);
      saveProgress();
      renderStats();
      if (el.undone.checked) applyFilters();
    });
    label.appendChild(box);
    li.appendChild(label);
    if (box.checked) li.classList.add('is-done');

    var d = document.createElement('details');
    d.className = 'iv-card';

    var sum = textNode('summary', 'iv-sum');
    var chips = textNode('div', 'iv-chips');
    if (hasLens()) {
      var lens = LENS[q.lens];
      var lensChip = textNode('span', 'iv-chip iv-chip-lens', lens ? lens.label : q.lens);
      lensChip.dataset.lens = q.lens;
      chips.appendChild(lensChip);
    }
    /* The 성격 chip, which the card is colour-coded by. */
    if (hasKind()) {
      var kind = KINDS[q.kind];
      var kindChip = textNode('span', 'iv-chip iv-chip-kind', kind ? kind.label : q.kind);
      kindChip.dataset.kind = q.kind;
      chips.appendChild(kindChip);
    }
    chips.appendChild(textNode('span', 'iv-chip', CATS[q.category] || q.category));
    chips.appendChild(dots(q.difficulty));
    if (q.starred) chips.appendChild(starChip());
    chips.appendChild(textNode('span', 'iv-num', '#' + (index + 1)));
    sum.appendChild(chips);
    sum.appendChild(textNode('span', 'iv-q-text', q.q));
    d.appendChild(sum);

    var body = textNode('div', 'iv-body');
    body.appendChild(anchorsBlock(q));
    body.appendChild(starBlock(q));
    var f = factsBlock(q);
    if (f) body.appendChild(f);
    var dr = draftBlock(q);
    if (dr) body.appendChild(dr);
    var fu = followBlock(q);
    if (fu) body.appendChild(fu);
    var rf = refsBlock(q);
    if (rf) body.appendChild(rf);
    d.appendChild(body);

    li.appendChild(d);

    return {
      id: q.id,
      mode: 'interview',
      lens: q.lens,
      kind: q.kind,
      cat: q.category,
      diff: String(q.difficulty),
      starred: !!q.starred,
      node: li,
      /* Lowercased once here, not on every keystroke. */
      hay: [
        q.q,
        (q.star && q.star.s) || '',
        (q.star && q.star.t) || '',
        (q.facts || []).join(' '),
        (q.draft && q.draft.a) || '',
        (q.draft && q.draft.r) || '',
        followText(q.follow_ups),
        refsText(q),
        (q.anchors || []).map(function (a) { return (a.id || '') + ' ' + (a.label || ''); }).join(' ')
      ].join(' ').toLowerCase()
    };
  }

  /* Query language: 공백 ANDs terms anywhere in the card (a literal substring
     only finds words written adjacently), "구문" matches literally, -단어
     excludes. */
  var SEARCH_RE = /-?"[^"]*"|\S+/g;

  function parseQuery(raw) {
    var pos = [];
    var neg = [];
    var m;
    SEARCH_RE.lastIndex = 0;
    while ((m = SEARCH_RE.exec(raw)) !== null) {
      var t = m[0];
      var not = false;
      /* A lone `-` is a search for a hyphen, not an exclusion of nothing. */
      if (t.charAt(0) === '-' && t.length > 1) { not = true; t = t.slice(1); }
      t = t.replace(/"/g, '').trim().toLowerCase();
      if (t) (not ? neg : pos).push(t);
    }
    return { pos: pos, neg: neg, on: pos.length + neg.length > 0 };
  }

  /* 초성 search. A syllable folds to exactly ONE 초성 char, so the folded string
     keeps its LENGTH and a hit's index is valid in the visible text. Any fold
     that changes length would misplace every highlight. */
  var CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ',
             'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  var JAMO_ONLY = /^[ㄱ-ㅎ]+$/;

  function fold(text) {
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      out += (c >= 0xac00 && c <= 0xd7a3)
        ? CHO[Math.floor((c - 0xac00) / 588)]
        : text.charAt(i);
    }
    return out;
  }

  /* Only an all-jamo term takes the 초성 path; one real syllable means a word. */
  function isCho(tok) { return JAMO_ONLY.test(tok); }

  function hit(row, tok) {
    if (row.hay.indexOf(tok) !== -1) return true;
    if (!isCho(tok)) return false;
    /* Built on first 초성 use and kept. */
    if (row.cho === null) row.cho = fold(row.hay);
    return row.cho.indexOf(tok) !== -1;
  }

  function matchesQuery(row, q) {
    var i;
    for (i = 0; i < q.neg.length; i++) if (hit(row, q.neg[i])) return false;
    for (i = 0; i < q.pos.length; i++) if (!hit(row, q.pos[i])) return false;
    return true;
  }

  /* Marks what is on screen, so an unlit row is one whose match is inside the
     closed card. Text nodes + <mark>, never innerHTML: the text contains `<`/`&`. */
  function rangesFor(text, tokens) {
    var low = text.toLowerCase();
    var cho = null;
    var out = [];
    tokens.forEach(function (t) {
      var hay = low;
      if (isCho(t)) {
        if (cho === null) cho = fold(low);
        hay = cho;
      }
      var from = 0;
      var i;
      while ((i = hay.indexOf(t, from)) !== -1) {
        out.push([i, i + t.length]);
        from = i + t.length;
      }
    });
    if (out.length < 2) return out;
    /* Merge overlaps ("무중단" + "중단") or two <mark>s would duplicate the text. */
    out.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var merged = [out[0]];
    for (var k = 1; k < out.length; k++) {
      var last = merged[merged.length - 1];
      if (out[k][0] <= last[1]) last[1] = Math.max(last[1], out[k][1]);
      else merged.push(out[k]);
    }
    return merged;
  }

  function highlight(row, tokens) {
    /* Row-level, so `applyFilters` can skip hidden rows it never marked. */
    row.marked = tokens.length > 0;
    row.hl.forEach(function (m) {
      var ranges = tokens.length ? rangesFor(m.text, tokens) : [];
      if (!ranges.length) {
        /* Only rewrite a node that actually carries marks. */
        if (m.marked) { m.el.textContent = m.text; m.marked = false; }
        return;
      }
      m.el.textContent = '';
      var at = 0;
      ranges.forEach(function (r) {
        if (r[0] > at) m.el.appendChild(document.createTextNode(m.text.slice(at, r[0])));
        m.el.appendChild(textNode('mark', 'iv-hit', m.text.slice(r[0], r[1])));
        at = r[1];
      });
      if (at < m.text.length) m.el.appendChild(document.createTextNode(m.text.slice(at)));
      m.marked = true;
    });
  }

  /* `starred:` is authored in the YAML so it survives other devices. The word
     rides with the glyph: a lone ★ is announced as "black star". */
  function starChip() {
    return textNode('span', 'iv-chip iv-chip-star', '\u2605 즐겨찾기');
  }

  function applyFilters() {
    var cat = el.cat.value;
    var diff = el.diff.value;
    var query = parseQuery(el.q.value);
    var undoneOnly = el.undone.checked;
    var starredOnly = el.starred.checked;
    var shown = 0;

    var inMode = 0;
    /* Other-bank rows the search term ALONE reaches; the other filters belong
       to the bank they were chosen in. */
    var elsewhere = {};

    ROWS.forEach(function (r) {
      var found = !query.on || matchesQuery(r, query);
      if (r.mode !== mode) {
        r.node.hidden = true;
        if (query.on && found) elsewhere[r.mode] = (elsewhere[r.mode] || 0) + 1;
        return;
      }
      inMode++;
      var ok =
        (!activeLens || r.lens === activeLens) &&
        (!activeKind || r.kind === activeKind) &&
        (!cat || r.cat === cat) &&
        (!diff || r.diff === diff) &&
        (!undoneOnly || !done.has(r.id)) &&
        (!starredOnly || r.starred) &&
        found;
      r.node.hidden = !ok;
      if (ok) {
        shown++;
        highlight(r, query.pos);
      } else if (r.marked) {
        /* Clear on the way OUT: the row may return under a different query. */
        highlight(r, []);
      }
    });

    var away = renderElsewhere(elsewhere);
    el.empty.hidden = shown !== 0;
    /* "Nothing matches" above buttons offering matches elsewhere is wrong. */
    el.emptyHere.hidden = away > 0;
    el.emptyAway.hidden = away === 0;
    /* Always stated, so a filtered view never reads as a shorter bank. The
       denominator is the ACTIVE bank only. */
    var noun = bank().noun;
    var line = shown === inMode
      ? inMode + noun
      : shown + ' / ' + inMode + noun;
    /* Repeated INTO the count line because it is the live region; a screen
       reader is never told the buttons below appeared. */
    if (away) line += ' · 다른 탭에 ' + away + '건';
    el.count.textContent = line;
  }

  /* One button per other bank the term reaches, or nothing at all. */
  function renderElsewhere(counts) {
    el.elsewhere.textContent = '';
    var total = 0;
    ['interview', 'cs', 'terms', 'script'].forEach(function (k) {
      var n = counts[k] || 0;
      if (!n || k === mode) return;
      total += n;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'iv-elsewhere-btn';
      b.textContent = BANKS[k].label + ' ' + n;
      /* The search term survives the switch; that is the point of the button. */
      b.addEventListener('click', function () { setMode(k); });
      el.elsewhere.appendChild(b);
    });
    el.elsewhere.hidden = total === 0;
    return total;
  }

  function rowsInMode() {
    return ROWS.filter(function (r) { return r.mode === mode; });
  }

  /* The lens axis exists only while there IS more than one lens; a one-button
     row answers nothing. Derived, not written into BANKS, so declaring a second
     lens restores the row, filter, chip and stat axis with no code change. */
  function hasLens() { return !!bank().lens && (DATA.lenses || []).length > 1; }

  /* Same gate for `kinds:`, deliberately NOT the lens: a lens is who is asking,
     a kind is what is being asked. */
  function hasKind() { return !!bank().kind && (DATA.kinds || []).length > 1; }

  function renderStats() {
    var rows = rowsInMode();
    el.statTotal.textContent = String(rows.length);
    el.statDone.textContent = String(rows.filter(function (r) {
      return done.has(r.id);
    }).length);

    /* Both labels move with the bank, or categories read as perspectives and
       definitions as questions. */
    el.statAxis.textContent = hasLens() ? bank().axis : '분야별';
    el.statTotalLabel.textContent = bank().total;
    el.statLenses.textContent = '';
    if (hasLens()) {
      (DATA.lenses || []).forEach(function (l) {
        var n = rows.filter(function (r) { return r.lens === l.key; }).length;
        var s = textNode('span', 'iv-mini', l.label + ' ' + n);
        s.dataset.lens = l.key;
        el.statLenses.appendChild(s);
      });
    } else {
      categoriesFor(mode).forEach(function (c) {
        var n = rows.filter(function (r) { return r.cat === c.key; }).length;
        el.statLenses.appendChild(textNode('span', 'iv-mini', c.label + ' ' + n));
      });
    }
  }

  /* EVERYTHING a bank answers differently, in one table. Scattered
     `mode === x ? a : b` ternaries silently filed each new bank under "질문";
     a row here cannot half-answer, so adding a bank means filling every column. */
  var BANKS = {
    interview: {
      label: '면접 질문', noun: '개 질문', total: '전체 질문', axis: '관점별',
      cats: 'categories', lens: true, kind: true, diff: true,
      placeholder: '질문 · 근거 · 꼬리질문에서 찾기'
    },
    cs: {
      label: 'CS 지식', noun: '개 질문', total: '전체 질문', axis: '분야별',
      cats: 'cs_categories', lens: false, kind: false, diff: true,
      placeholder: '질문 · 근거 · 꼬리질문에서 찾기'
    },
    terms: {
      label: '용어', noun: '개 용어', total: '전체 용어', axis: '분야별',
      cats: 'term_categories', lens: false, kind: false, diff: false,
      placeholder: '용어 · 설명에서 찾기'
    },
    script: {
      label: '스크립트', noun: '개 대본', total: '전체 대본', axis: '',
      cats: null, lens: false, kind: false, diff: false,
      placeholder: '대본 본문에서 찾기'
    }
  };

  function bank() { return BANKS[mode] || BANKS.interview; }

  function categoriesFor(m) {
    var key = (BANKS[m] || BANKS.interview).cats;
    if (!key) return [];
    return DATA[key] || [];
  }

  function fillCategorySelect() {
    el.cat.textContent = '';
    var all = document.createElement('option');
    all.value = '';
    all.textContent = '전체';
    el.cat.appendChild(all);

    categoriesFor(mode).forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.key;
      o.textContent = c.label;
      el.cat.appendChild(o);
    });
  }

  function setMode(next) {
    if (next === mode) return;
    mode = next;

    /* Axes the new bank does not share are cleared, or a carried-over value
       empties the list behind a control the reader cannot see. */
    activeLens = '';
    activeKind = '';
    el.cat.value = '';
    if (!bank().diff) el.diff.value = '';
    fillCategorySelect();

    syncFields();
    syncToggles();
    renderStats();
    applyFilters();
  }

  /* Which controls this bank asks about. Called on EVERY bank entry including
     the first, or the opening view shows whatever the markup declared. */
  function syncFields() {
    /* Hidden, not disabled: these are questions this bank does not ask. */
    el.lensField.hidden = !hasLens();
    el.kindField.hidden = !hasKind();
    el.diffField.hidden = !bank().diff;
    el.catField.hidden = categoriesFor(mode).length === 0;
    /* Uncheck on the way out, or it hides everything in a bank with no stars. */
    var anyStarred = ROWS.some(function (r) { return r.mode === mode && r.starred; });
    el.starredField.hidden = !anyStarred;
    if (!anyStarred) el.starred.checked = false;

    el.q.placeholder = bank().placeholder;
  }

  /* Built once — see `renderLensChips`. */
  function renderModeChips() {
    el.modeRow.textContent = '';

    function chip(key, label) {
      var n = ROWS.filter(function (r) { return r.mode === key; }).length;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'iv-mode';
      b.dataset.mode = key;
      b.textContent = label + ' ' + n;
      b.addEventListener('click', function () { setMode(key); });
      return b;
    }

    /* Fixed order, not `Object.keys(BANKS)`, so a new table row cannot reshuffle
       the toolbar. */
    ['interview', 'cs', 'terms', 'script'].forEach(function (k) {
      if (ROWS.some(function (r) { return r.mode === k; })) {
        el.modeRow.appendChild(chip(k, BANKS[k].label));
      }
    });
  }

  /* Built ONCE; `syncToggles` writes the pressed state. Rebuilding removes the
     button just pressed with Enter, and focus falls to <body>. */
  function renderLensChips() {
    el.lensRow.textContent = '';

    /* BOTH `full` and `short` go in the DOM and CSS shows one; choosing in JS
       would mean rebuilding on resize. */
    function chip(key, full, short, title) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'iv-lens';
      b.dataset.lens = key;
      if (short && short !== full) {
        b.appendChild(textNode('span', 'iv-lens-full', full));
        b.appendChild(textNode('span', 'iv-lens-short', short));
      } else {
        b.textContent = full;
      }
      if (title) b.title = title;
      b.addEventListener('click', function () {
        activeLens = (activeLens === key) ? '' : key;
        syncToggles();
        applyFilters();
      });
      return b;
    }

    el.lensRow.appendChild(chip('', '전체', '', '모든 관점'));
    (DATA.lenses || []).forEach(function (l) {
      el.lensRow.appendChild(chip(l.key, l.full || l.label, l.label, l.desc));
    });
  }

  /* Built ONCE — see `renderLensChips`. */
  function renderKindChips() {
    el.kindRow.textContent = '';

    function chip(key, full, short, title) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'iv-lens iv-kind';
      b.dataset.kind = key;
      if (short && short !== full) {
        b.appendChild(textNode('span', 'iv-lens-full', full));
        b.appendChild(textNode('span', 'iv-lens-short', short));
      } else {
        b.textContent = full;
      }
      if (title) b.title = title;
      b.addEventListener('click', function () {
        activeKind = (activeKind === key) ? '' : key;
        syncToggles();
        applyFilters();
      });
      return b;
    }

    el.kindRow.appendChild(chip('', '전체', '', '모든 성격'));
    (DATA.kinds || []).forEach(function (k) {
      el.kindRow.appendChild(chip(k.key, k.full || k.label, k.label, k.desc));
    });
  }

  /* The single place every toggle row's pressed state is written. */
  function syncToggles() {
    [].forEach.call(el.lensRow.querySelectorAll('.iv-lens'), function (b) {
      var on = b.dataset.lens === activeLens;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    [].forEach.call(el.kindRow.querySelectorAll('.iv-kind'), function (b) {
      var on = b.dataset.kind === activeKind;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    [].forEach.call(el.modeRow.querySelectorAll('.iv-mode'), function (b) {
      var on = b.dataset.mode === mode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function render(data) {
    DATA = data;

    (data.lenses || []).forEach(function (l) { LENS[l.key] = l; });
    (data.kinds || []).forEach(function (k) { KINDS[k.key] = k; });
    (data.categories || []).forEach(function (c) { CATS[c.key] = c.label; });
    (data.cs_categories || []).forEach(function (c) { CS_CATS[c.key] = c.label; });
    (data.term_categories || []).forEach(function (c) { TERM_CATS[c.key] = c.label; });

    var questions = data.questions || [];
    var cs = data.cs || [];
    var terms = data.terms || [];
    var script = data.script || [];

    /* Lookups for `refs`, built once rather than per row. */
    TERM_BY_ID = Object.create(null);
    terms.forEach(function (t) { TERM_BY_ID[t.id] = t; });
    CARD_BY_ID = Object.create(null);
    cs.forEach(function (q) { CARD_BY_ID[q.id] = { q: q.q, bank: 'cs' }; });
    questions.forEach(function (q) { CARD_BY_ID[q.id] = { q: q.q, bank: 'interview' }; });

    /* One progress set across every bank: ids are namespaced (`cs-`, `tm-`,
       `sc-`) and a test holds that shut. */
    var ids = new Set();
    questions.forEach(function (q) { ids.add(q.id); });
    cs.forEach(function (q) { ids.add(q.id); });
    terms.forEach(function (t) { ids.add(t.id); });
    script.forEach(function (sc) { ids.add(sc.id); });
    done = loadProgress(ids);

    var frag = document.createDocumentFragment();
    ROWS = questions.map(function (q, i) {
      var row = buildRow(q, i);
      frag.appendChild(row.node);
      return row;
    });
    cs.forEach(function (q, i) {
      var row = buildCsRow(q, i);
      frag.appendChild(row.node);
      ROWS.push(row);
    });
    terms.forEach(function (t, i) {
      var row = buildTermRow(t, i);
      frag.appendChild(row.node);
      ROWS.push(row);
    });
    script.forEach(function (sc, i) {
      var row = buildScriptRow(sc, i);
      frag.appendChild(row.node);
      ROWS.push(row);
    });
    el.list.appendChild(frag);

    /* `hl` captures the visible text before anything marks it; after a <mark>
       it is no longer recoverable in one piece. */
    ROWS.forEach(function (r) {
      r.cho = null;
      r.marked = false;
      r.hl = [].map.call(
        r.node.querySelectorAll('.iv-q-text, .iv-term-desc'),
        function (n) { return { el: n, text: n.textContent, marked: false }; }
      );
    });

    fillCategorySelect();

    if (data.meta && data.meta.generated) {
      el.statMeta.textContent = '생성 ' + data.meta.generated;
    }

    /* Only when a second bank has rows; a one-tab row answers nothing. */
    el.modeRow.hidden = cs.length + terms.length + script.length === 0;
    if (!el.modeRow.hidden) renderModeChips();

    renderLensChips();
    renderKindChips();
    syncFields();
    syncToggles();
    renderStats();
    applyFilters();

    el.cat.addEventListener('change', applyFilters);
    el.diff.addEventListener('change', applyFilters);
    el.q.addEventListener('input', applyFilters);
    el.undone.addEventListener('change', applyFilters);
    el.starred.addEventListener('change', applyFilters);
    el.reset.addEventListener('click', function () {
      activeLens = '';
      activeKind = '';
      el.cat.value = '';
      el.diff.value = '';
      el.q.value = '';
      el.undone.checked = false;
      el.starred.checked = false;
      /* Not a rebuild — that would drop focus off the reset button. */
      syncToggles();
      applyFilters();
    });

    /* `/` and Ctrl/Cmd+K focus the search box, Escape empties it. `isComposing`
       is not optional: mid-Hangul keydown carries the physical key, so a `/`
       would steal focus from the field being typed into. */
    document.addEventListener('keydown', function (e) {
      if (el.app.hidden || e.isComposing || e.altKey) return;
      if (e.key === 'Escape' && e.target === el.q && el.q.value) {
        e.preventDefault();
        el.q.value = '';
        applyFilters();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        el.q.focus();
        el.q.select();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      var t = e.target;
      var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                         t.tagName === 'SELECT' || t.isContentEditable);
      if (typing) return;
      if (e.key === '/') {
        e.preventDefault();
        el.q.focus();
        el.q.select();
      }
    });

    el.lock.hidden = true;
    el.app.hidden = false;
    /* Focus leaves the hidden form; a deep link takes it instead of the search box. */
    if (!openDeepLink()) el.q.focus();

    /* The other half of the `refs` pushState: re-read the hash on Back/Forward. */
    window.addEventListener('popstate', function () { openDeepLink(); });
  }

  /* A deep link, `/interview/#<id>` (from a `refs` link or a pasted URL). Runs
     after unlock because every card is behind the passphrase. Filters are
     cleared and the bank switched first, or the target may be hidden. */
  function openDeepLink() {
    var id = (location.hash || '').replace(/^#/, '');
    if (!id) return false;

    var hit = null;
    ROWS.some(function (r) {
      if (r.node.dataset.id === id) { hit = r; return true; }
      return false;
    });
    if (!hit) return false;

    activeLens = '';
    activeKind = '';
    el.cat.value = '';
    el.diff.value = '';
    el.q.value = '';
    el.undone.checked = false;
    el.starred.checked = false;
    setMode(hit.mode);
    syncToggles();
    applyFilters();

    hit.node.scrollIntoView({ block: 'center' });
    /* Focus, not just scroll, for screen readers. `-1` keeps the row out of the
       Tab order. */
    hit.node.setAttribute('tabindex', '-1');
    hit.node.focus();
    hit.node.classList.add('iv-linked');
    return true;
  }

  function setBusy(busy) {
    el.unlock.disabled = busy;
    el.pass.disabled = busy;
    el.unlock.textContent = busy ? '여는 중…' : '열기';
  }

  el.form.addEventListener('submit', function (e) {
    e.preventDefault();
    var pass = el.pass.value;
    if (!pass) return;

    el.msg.textContent = '';
    el.msg.classList.remove('is-error');
    setBusy(true);

    var payload = el.payload.dataset.payload || '';
    var iter = Number(el.payload.dataset.iter) || 310000;

    /* Yield a frame so "여는 중…" paints before the derivation blocks. */
    requestAnimationFrame(function () {
      window.IVCrypto.unlock(payload, pass, iter)
        .then(function (data) {
          el.pass.value = '';
          render(data);
        })
        .catch(function (err) {
          setBusy(false);
          el.msg.textContent = err.message;
          el.msg.classList.add('is-error');
          el.pass.value = '';
          el.pass.focus();
        });
    });
  });

  /* Local convenience, NOT a bypass: the build emits a boolean flag, never the
     passphrase, so a wrongly-true flag only prefills a password that fails the
     GCM tag. `make interview-leak-check` fails on the flag. */
  if (el.payload.dataset.dev === 'true') {
    el.pass.value = 'dev';
    el.msg.textContent = '개발 빌드입니다. INTERVIEW_PASSPHRASE 없이 빌드되어 개발용 비밀번호가 채워져 있습니다.';
  }

  /* Said up front: on a non-secure origin no password would work. */
  if (!window.IVCrypto.available()) {
    el.msg.textContent = '이 브라우저에서는 복호화를 할 수 없습니다. HTTPS로 접속했는지 확인해 주세요.';
    el.msg.classList.add('is-error');
    setBusy(true);
    el.unlock.textContent = '사용 불가';
  }
})();
