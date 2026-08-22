/* Interview page — the only file here that touches the DOM.
 *
 * `crypto.js` is pure and is loaded first; it decides whether the payload opens.
 * Everything below assumes it did.
 *
 * NOTHING IS BUILT WITH innerHTML. Every string that came out of the ciphertext
 * reaches the page through `textContent`. The content is the user's own YAML, so
 * this is not defence against a hostile author — it is that a `<` in a question
 * about generics or a `&` in "Metrics & Traces" must render as itself, and a
 * markup path would silently eat it. `_data` is not HTML and is not treated as
 * any.
 *
 * STORAGE: `iv-progress-v1` only, and it holds question IDs and nothing else.
 * Not the questions, not the answers, not the passphrase. The page is encrypted
 * precisely so its content does not sit anywhere it does not have to; writing
 * the decrypted bank into localStorage would move a copy back out of that
 * envelope onto disk, permanently, on whatever machine last unlocked it. IDs
 * leak nothing on their own — `karpenter-ondemand-pin` is a slug, not a claim.
 *
 * The passphrase is deliberately NOT kept for the session. A refresh asks again.
 * That is the behaviour a page like this should have, and it costs one PBKDF2
 * derivation.
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
    cat: document.getElementById('iv-cat'),
    catField: document.getElementById('iv-cat-field'),
    diff: document.getElementById('iv-diff'),
    q: document.getElementById('iv-q'),
    undone: document.getElementById('iv-undone'),
    starred: document.getElementById('iv-starred'),
    starredField: document.getElementById('iv-starred-field'),
    reset: document.getElementById('iv-reset'),
    count: document.getElementById('iv-count'),
    list: document.getElementById('iv-list'),
    empty: document.getElementById('iv-empty'),
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
  var CATS = {};         // key -> label   (rehearsal bank)
  var CS_CATS = {};      // key -> label   (cs bank)
  var TERM_CATS = {};    // key -> label   (terms bank)
  var done = new Set();
  var activeLens = '';   // '' = all

  /* Which bank is on screen. Both are built once and live in ROWS together;
     the mode is just another filter predicate, so switching costs no rebuild
     and a row's open/closed state survives a round trip.

     They are two banks rather than two sections of one because the answer rule
     is opposite: the rehearsal bank leaves A and R blank on purpose, and a CS
     question carries its answer because there is a correct one. Rendering them
     through one card builder would mean a card that sometimes prints the answer
     and sometimes refuses to, with nothing on screen saying which rule is in
     force. */
  var mode = 'interview';   // 'interview' | 'cs' | 'terms'

  /* ------------------------------------------------------------- progress */

  /* Read defensively: storage is editable and a previous bank's ids may still be
     in there. Anything that is not a known id is dropped rather than kept, so
     the "완료" count can never exceed the number of questions on screen. */
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
      /* Quota or private mode. The checkbox still works for this visit; saying
         so on every toggle would be noise, and the footer already promises only
         that IDs are stored, not that they survive. */
    }
  }

  /* ---------------------------------------------------------------- build */

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
      /* `evidence: none` questions — salary, motivation, five-years. Marking them
         is the point: the user is answering from outside the resume, and a blank
         근거 line would read as a missing anchor rather than a deliberate one. */
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
        /* Not an <input>. Typing into this page would create an answer worth
           keeping, and keeping it means writing decrypted content to disk — the
           one thing the encryption exists to avoid. The blank is there to be
           spoken into. */
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

  /* Written by `interview-answer-drafter`, and absent on most questions. Closed
     by default and placed AFTER 근거 확인, so the order stays: answer it, check
     the facts, then compare. It is labelled as a draft rather than an answer
     because it is generated prose about the reader's own career — the one place
     on this page where the words are not theirs. */
  function draftBlock(q) {
    if (!q.draft || !q.draft.a) return null;
    var d = document.createElement('details');
    d.className = 'iv-draft';
    d.appendChild(textNode('summary', 'iv-draft-sum', '초안 보기'));

    var note = textNode('p', 'iv-draft-note',
      '이력서 근거만으로 쓴 초안입니다. 본인 표현으로 바꿔서 쓰세요.');
    d.appendChild(note);

    /* Split on the newline, the same way the script bank renders its body. Most
       drafts are one paragraph and come through unchanged; a draft that lays its
       answer out in steps keeps them apart instead of collapsing into a wall the
       reader has to re-parse every time they open the card. */
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

  /* A follow-up is EITHER a bare question string or `{q, a}`, and both shapes
     are permanent rather than a migration half-done. The CS bank asks things
     with a correct answer, so it carries one; the rehearsal bank mostly asks
     what only the reader knows ("이중화를 넣지 않은 것은 판단이었나요?"), and an
     answer written there would be words put in their mouth — the same line
     `interview-answer-drafter` is not allowed to cross. A blank is the honest
     state, so it stays representable.

     Normalising here means render and search ask one shape, not two. */
  function followPair(f) {
    if (typeof f === 'string') return { q: f, a: '' };
    return { q: (f && f.q) || '', a: (f && f.a) || '' };
  }

  function followText(list) {
    return (list || []).map(function (f) {
      var p = followPair(f);
      return p.a ? p.q + ' ' + p.a : p.q;
    }).join(' ');
  }

  /* An answered follow-up is a disclosure, closed — the same interaction
     `csAnswerBlock` makes: say it out loud, then open. An unanswered one is
     plain text, so the two are told apart before either is clicked. */
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
      /* The modifier moves the `↳` marker from the <li> onto the <summary>, so
         it travels with the text the summary's own padding moves — the plain
         item keeps the <li>'s marker. A `:has()` selector would express the
         same thing without the class, but it is the one selector this page
         cannot rely on: Safari below 15.4 and Firefox below 121 would drop the
         whole rule and leave two markers on every answered row. */
      var li = textNode('li', 'iv-follow-item iv-follow-item-a');
      var d = document.createElement('details');
      d.className = 'iv-follow-d';
      var sum = textNode('summary', 'iv-follow-sum', p.q);
      /* The caret REPLACES the `↳` on an answered row rather than joining it —
         one marker in the position the eye already scans, and its rotation is
         the open/closed state. Appended after the text it was easy to miss: on
         a question that wraps it lands wherever the last line happens to end.

         A real element rather than a `::after`, so it can be hidden from the
         accessibility tree — the disclosure already announces its own state,
         and a screen reader reading "▸" before every question is noise. It also
         keeps the glyph out of a copied selection. Inserted FIRST so its static
         position is the start of the first line, which is what the absolute
         placement below resolves against. */
      var caret = textNode('span', 'iv-follow-caret', '▸');
      caret.setAttribute('aria-hidden', 'true');
      sum.insertBefore(caret, sum.firstChild);
      d.appendChild(sum);
      d.appendChild(textNode('p', 'iv-follow-a', p.a));
      li.appendChild(d);
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    return wrap;
  }

  /* ------------------------------------------------------------- cs cards */

  /* Unlike `anchorsBlock`, this renders NOTHING when there are no anchors.
     There, a missing anchor is a declared state (`evidence: none`) and saying so
     is the point. Here most questions legitimately have none — a TCP handshake
     has no place in anyone's resume — so a "이력서 밖" line on 40 of 60 cards
     would be noise claiming to be information. */
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

  /* Closed by default, and that is the whole interaction: say it out loud, then
     open. An answer already on screen turns the card into something to read. */
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

    /* Inside the disclosure on purpose — it is part of the answer, and shown
       up front it hands over the sharpest half before the question is tried. */
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

  /* --------------------------------------------------------- term cards */

  /* The glossary. Same card shape as the other two banks on purpose: a term with
     its definition hidden is a flashcard, which is the same interaction
     `csAnswerBlock` already makes ("say it out loud, then open"), and the search
     still reaches the hidden text because `hay` carries it.

     It keeps the checkbox for a reason that only shows up here — with 299 rows,
     `미완료만` becomes "the terms I have not marked as known", which is the one
     filter a glossary this size actually needs. */
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
    /* The wiki's own subsection. Kept because it is the only thing separating
       61 IT 용어 rows into something a reader can navigate, and inventing a
       second grouping scheme here would make the two disagree. */
    if (t.group) chips.appendChild(textNode('span', 'iv-group', t.group));
    chips.appendChild(textNode('span', 'iv-num', '#' + (index + 1)));
    sum.appendChild(chips);
    sum.appendChild(textNode('span', 'iv-q-text', t.term));
    d.appendChild(sum);

    var body = textNode('div', 'iv-body');
    body.appendChild(textNode('p', 'iv-term-desc', t.desc));
    /* The long explanation is a plain second paragraph, NOT a nested disclosure.
       The card is already a `details` — term visible, definition hidden — so a
       disclosure here would put the thing this bank exists to say behind a
       second click. `detail` is required on every term and a test holds that
       shut, but the guard stays: a row that lost it must render one paragraph
       rather than the string "undefined". */
    if (t.detail) body.appendChild(textNode('p', 'iv-term-detail', t.detail));
    d.appendChild(body);

    li.appendChild(d);

    return {
      id: t.id,
      mode: 'terms',
      lens: '',
      cat: t.category,
      /* No difficulty on a definition. The empty string never equals the
         select's value when one is chosen, and the field is hidden in this
         bank, so the row can never be filtered out by it. */
      diff: '',
      node: li,
      hay: [t.term, t.desc, t.detail || '', t.group || ''].join(' ').toLowerCase()
    };
  }

  /* ------------------------------------------------------------- script cards */

  /* The fourth bank, and the fourth answer rule. `questions:` leaves its answer
     blank because a rehearsal answer has to be in the user's own words. `cs:`
     fills one in because there is a correct one. `terms:` makes the definition
     the row. Here the BODY IS THE SCRIPT — it exists to be said out loud, close
     to verbatim, so it is the only bank that carries a `seconds` target.

     Paragraphs are split on the newline and appended as separate <p>. The body
     reaches the DOM through textContent like everything else here, so a newline
     inside one node would collapse to a space and the whole 자기소개 would run
     together as a single block — which is exactly the shape nobody can read off
     a phone while waiting outside a meeting room. */
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
    /* A target, not a measurement. Said at a normal pace these land near it, and
       the number is here because over-running the opening is the single most
       common way a rehearsed 자기소개 goes wrong. */
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
    /* Every number in the body has to exist in the resume, and this is where a
       reader checks that before saying it in a room. Same block the rehearsal
       bank uses, for the same reason. */
    body.appendChild(anchorsBlock(sc));
    d.appendChild(body);

    li.appendChild(d);

    return {
      id: sc.id,
      mode: 'script',
      lens: '',
      cat: '',
      diff: '',
      node: li,
      hay: [sc.title, sc.body, sc.kind].join(' ').toLowerCase()
    };
  }

  /* ---------------------------------------------------------- ask cards */

  /* The fifth bank, and the first one that is not about answering. A list of
     questions on its own is a politeness ritual — what makes it useful is
     knowing what a given answer would MEAN, so every row carries `why` (what
     this is trying to find out) and `listen_for` (which answer is a good sign
     and which is a warning). Those two are the content; the question is just the
     way in. */
  function buildAskRow(a, index) {
    var li = textNode('li', 'iv-item iv-item-ask');
    li.dataset.id = a.id;

    var label = textNode('label', 'iv-done');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = done.has(a.id);
    box.setAttribute('aria-label', '물어볼 질문으로 표시: ' + a.q);
    box.addEventListener('change', function () {
      if (box.checked) done.add(a.id); else done.delete(a.id);
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
    var co = (DATA.ask_companies || []).filter(function (c) { return c.key === a.company; })[0];
    var coChip = textNode('span', 'iv-chip iv-chip-ask', co ? companyLabel(co) : a.company);
    coChip.dataset.company = a.company;
    chips.appendChild(coChip);
    /* Which round to ask it in. A question only the hiring manager can answer,
       asked of an executive, wastes the one slot the candidate gets. */
    if (a.stage) chips.appendChild(textNode('span', 'iv-group', a.stage + ' 면접'));
    chips.appendChild(textNode('span', 'iv-num', '#' + (index + 1)));
    sum.appendChild(chips);
    sum.appendChild(textNode('span', 'iv-q-text', a.q));
    d.appendChild(sum);

    var body = textNode('div', 'iv-body');
    if (a.why) {
      body.appendChild(textNode('p', 'iv-ask-label', '이 질문으로 알아내려는 것'));
      body.appendChild(textNode('p', 'iv-ask-text', a.why));
    }
    if (a.listen_for) {
      body.appendChild(textNode('p', 'iv-ask-label', '답을 어떻게 읽을 것인가'));
      body.appendChild(textNode('p', 'iv-ask-text', a.listen_for));
    }
    d.appendChild(body);

    li.appendChild(d);

    return {
      id: a.id,
      mode: 'ask',
      lens: '',
      cat: a.company,
      diff: '',
      node: li,
      hay: [a.q, a.why || '', a.listen_for || '', a.stage || ''].join(' ').toLowerCase()
    };
  }

  function buildRow(q, index) {
    var li = textNode('li', 'iv-item');
    li.dataset.id = q.id;

    /* The checkbox sits OUTSIDE <details>. Inside <summary> a click on it would
       also toggle the disclosure, so marking a question done would open or close
       it at the same time. */
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
    d.appendChild(body);

    li.appendChild(d);

    return {
      id: q.id,
      mode: 'interview',
      lens: q.lens,
      cat: q.category,
      diff: String(q.difficulty),
      starred: !!q.starred,
      node: li,
      /* Everything a search should reach, lowercased once at build time rather
         than on every keystroke across 55 rows. */
      hay: [
        q.q,
        (q.star && q.star.s) || '',
        (q.star && q.star.t) || '',
        (q.facts || []).join(' '),
        (q.draft && q.draft.a) || '',
        (q.draft && q.draft.r) || '',
        followText(q.follow_ups),
        (q.anchors || []).map(function (a) { return (a.id || '') + ' ' + (a.label || ''); }).join(' ')
      ].join(' ').toLowerCase()
    };
  }

  /* --------------------------------------------------------------- filter */

  /* The ★ chip. `starred:` is authored in the YAML, not toggled in the
     browser: the mark is a curated shortlist that has to survive being read on
     a different device, and localStorage would strand it on whichever machine
     set it. The progress set is stored because it is per-session; this is not.
     The label carries the word as well as the glyph — a lone ★ is announced as
     "black star" and reads as decoration. */
  function starChip() {
    return textNode('span', 'iv-chip iv-chip-star', '\u2605 즐겨찾기');
  }

  function applyFilters() {
    var cat = el.cat.value;
    var diff = el.diff.value;
    var term = el.q.value.trim().toLowerCase();
    var undoneOnly = el.undone.checked;
    var starredOnly = el.starred.checked;
    var shown = 0;

    var inMode = 0;

    ROWS.forEach(function (r) {
      if (r.mode !== mode) { r.node.hidden = true; return; }
      inMode++;
      var ok =
        (!activeLens || r.lens === activeLens) &&
        (!cat || r.cat === cat) &&
        (!diff || r.diff === diff) &&
        (!undoneOnly || !done.has(r.id)) &&
        (!starredOnly || r.starred) &&
        (!term || r.hay.indexOf(term) !== -1);
      r.node.hidden = !ok;
      if (ok) shown++;
    });

    el.empty.hidden = shown !== 0;
    /* Always stated, never silent: the default view is unfiltered, but a lens
       chip is one click away and 148 rows dropping to 11 with no line saying so
       reads as a shorter bank rather than a narrower view. The denominator is
       the ACTIVE bank, never the two summed — "12 / 208" would be counting rows
       that this view cannot show under any filter. */
    var noun = bank().noun;
    el.count.textContent = shown === inMode
      ? inMode + noun
      : shown + ' / ' + inMode + noun;
  }

  function rowsInMode() {
    return ROWS.filter(function (r) { return r.mode === mode; });
  }

  /* The lens axis exists only while there IS more than one lens. A chip row
     with a single button answers nothing — the same rule the troubleshooting
     page applies to its tree switcher and this page applies to its mode row.
     Derived rather than written into BANKS on purpose: retiring a lens then
     retires the row, the filter, the per-card chip and the stat axis together,
     and declaring a second one brings all four back with no code change. */
  function hasLens() { return !!bank().lens && (DATA.lenses || []).length > 1; }

  function renderStats() {
    var rows = rowsInMode();
    el.statTotal.textContent = String(rows.length);
    el.statDone.textContent = String(rows.filter(function (r) {
      return done.has(r.id);
    }).length);

    /* The breakdown strip carries whichever axis the active bank is filtered
       on — 관점 for the rehearsal bank, 분야 for CS, which has no lens. The
       LABEL has to move with it, or four CS categories sit under the word
       관점별 and read as interviewer perspectives. */
    el.statAxis.textContent = hasLens() ? bank().axis : '분야별';
    /* And the headline label with it — the 용어 bank counts definitions, and
       "전체 질문" over 299 of them is the same error the axis made when it
       called four CS categories interviewer perspectives. */
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

  /* ----------------------------------------------------------------- mode */

  /* EVERYTHING a bank answers differently, in one table.
     `categoriesFor` already existed for this reason — an inline ternary in two
     functions is what goes wrong when a third bank arrives, because one of them
     keeps answering "not cs, so rehearsal". A FOURTH bank proved the lesson was
     only half applied: five more ternaries of the shape `mode === 'terms' ? x :
     y` were still spread across `applyFilters`, `renderStats` and `setMode`, and
     every one of them silently files a new bank under "질문" — the script bank
     would have counted "2개 질문" and captioned its strip 전체 질문.
     A row here cannot half-answer: adding a bank means filling every column. */
  var BANKS = {
    interview: {
      label: '면접 질문', noun: '개 질문', total: '전체 질문', axis: '관점별',
      cats: 'categories', lens: true, diff: true,
      placeholder: '질문 · 근거 · 꼬리질문에서 찾기'
    },
    cs: {
      label: 'CS 지식', noun: '개 질문', total: '전체 질문', axis: '분야별',
      cats: 'cs_categories', lens: false, diff: true,
      placeholder: '질문 · 근거 · 꼬리질문에서 찾기'
    },
    terms: {
      label: '용어', noun: '개 용어', total: '전체 용어', axis: '분야별',
      cats: 'term_categories', lens: false, diff: false,
      placeholder: '용어 · 설명에서 찾기'
    },
    script: {
      label: '스크립트', noun: '개 대본', total: '전체 대본', axis: '',
      cats: null, lens: false, diff: false,
      placeholder: '대본 본문에서 찾기'
    },
    /* The only bank whose rows are questions the USER asks. Its category axis is
       the COMPANY, which is what makes it grow without code: adding a company to
       `ask_companies:` gives the select, the stat strip and the counts a new
       entry, and the rows follow by their `company` key. */
    ask: {
      label: '역질문', noun: '개 역질문', total: '전체 역질문', axis: '회사별',
      cats: 'ask_companies', lens: false, diff: false,
      placeholder: '역질문 · 의도 · 신호에서 찾기'
    }
  };

  function bank() { return BANKS[mode] || BANKS.interview; }

  /* A company is not the identity of an ask set — a (company, role) pair is.
     One employer can have two postings open, and a filter that says only
     "CJ대한통운" would silently merge two different interviews the day the
     second one is added. Composing it HERE rather than at each call site is
     what makes the select, the stat strip and the card chip agree without any
     of them knowing this bank is special. */
  function companyLabel(c) {
    return c.role ? c.label + ' · ' + c.role : c.label;
  }

  function categoriesFor(m) {
    var key = (BANKS[m] || BANKS.interview).cats;
    if (!key) return [];
    var list = DATA[key] || [];
    if (key !== 'ask_companies') return list;
    return list.map(function (c) {
      return { key: c.key, label: companyLabel(c) };
    });
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

    /* Category keys do not overlap between the banks, so a value carried across
       would match nothing and the list would empty out for a reason the reader
       never chose. Same for the lens, which neither CS nor the glossary has —
       and for difficulty, which the glossary has no concept of: leaving a
       chosen `3` behind would hide all 299 terms behind a hidden control. */
    activeLens = '';
    el.cat.value = '';
    if (!bank().diff) el.diff.value = '';
    fillCategorySelect();

    syncFields();
    syncToggles();
    renderStats();
    applyFilters();
  }

  /* Which controls this bank actually asks about. Called on EVERY entry to a
     bank including the first — boot used to skip it, so the opening view showed
     whatever the markup happened to declare, and that only looked right because
     the markup was written for the bank that opens. The day the rehearsal bank
     stopped having a lens axis, the row it no longer uses stayed on screen until
     the reader switched banks and came back. Same latent gap for 즐겨찾기 and the
     category select. */
  function syncFields() {
    /* Hidden rather than disabled: neither is a control that is temporarily
       unavailable here, they are questions this bank does not ask. */
    el.lensField.hidden = !hasLens();
    el.diffField.hidden = !bank().diff;
    /* A bank with no categories has nothing to put in the select, and an empty
       `전체`-only dropdown reads as a filter that lost its options. */
    el.catField.hidden = categoriesFor(mode).length === 0;
    /* Same rule, one bank down: 즐겨찾기 is curated per bank, so in one that has
       none the box could only ever empty the list. Reset it on the way out or a
       checked box follows the reader into a bank where it hides everything. */
    var anyStarred = ROWS.some(function (r) { return r.mode === mode && r.starred; });
    el.starredField.hidden = !anyStarred;
    if (!anyStarred) el.starred.checked = false;

    /* The placeholder names what the search actually reaches, and in the
       glossary that is not 근거 or 꼬리질문 — promising fields the bank does not
       have reads as a search that is broken rather than one looking elsewhere. */
    el.q.placeholder = bank().placeholder;
  }

  /* Built once, for the same reason `renderLensChips` is — see the note there. */
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

    /* Order is fixed here rather than taken from `Object.keys(BANKS)`, which is
       insertion-ordered and would quietly reshuffle the toolbar the day a bank
       is inserted mid-table. A bank with no rows renders no chip. */
    ['interview', 'cs', 'terms', 'script', 'ask'].forEach(function (k) {
      if (ROWS.some(function (r) { return r.mode === k; })) {
        el.modeRow.appendChild(chip(k, BANKS[k].label));
      }
    });
  }

  /* Built ONCE. The selected state is then written onto the existing buttons by
     `syncToggles`, never by rebuilding the row.

     Rebuilding is what the first version did, and it silently broke keyboard
     use: the button you just pressed Enter on was removed and replaced, so
     focus fell back to <body> and the next Tab restarted at the top of the
     document. Nothing errors, and with a mouse nothing looks wrong. */
  function renderLensChips() {
    el.lensRow.textContent = '';

    /* `full` is the long spelling ("실무 리드 / 시니어 DevOps"), `short` the one the
       stat strip above already uses. BOTH travel in the DOM and CSS shows one —
       the same split `.iv-btn-text` uses on the toolbar button. Choosing in JS
       would mean re-rendering on resize, and this row must never be rebuilt: the
       button the user pressed Enter on would be removed under them (see above).
       `display: none` also drops the hidden one from the accessibility tree, so a
       screen reader is read one name rather than both concatenated. */
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

  /* The single place the pressed state of both toggle rows is written. */
  function syncToggles() {
    [].forEach.call(el.lensRow.querySelectorAll('.iv-lens'), function (b) {
      var on = b.dataset.lens === activeLens;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    [].forEach.call(el.modeRow.querySelectorAll('.iv-mode'), function (b) {
      var on = b.dataset.mode === mode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* ---------------------------------------------------------------- start */

  function render(data) {
    DATA = data;

    (data.lenses || []).forEach(function (l) { LENS[l.key] = l; });
    (data.categories || []).forEach(function (c) { CATS[c.key] = c.label; });
    (data.cs_categories || []).forEach(function (c) { CS_CATS[c.key] = c.label; });
    (data.term_categories || []).forEach(function (c) { TERM_CATS[c.key] = c.label; });

    var questions = data.questions || [];
    var cs = data.cs || [];
    var terms = data.terms || [];
    var script = data.script || [];
    var ask = data.ask || [];

    /* One progress set across all three banks. The ids are disjoint by
       construction — the CS half is namespaced `cs-`, the glossary `tm-`, and a
       test holds both shut — so a mark can only ever belong to one card. */
    var ids = new Set();
    questions.forEach(function (q) { ids.add(q.id); });
    cs.forEach(function (q) { ids.add(q.id); });
    terms.forEach(function (t) { ids.add(t.id); });
    script.forEach(function (sc) { ids.add(sc.id); });
    ask.forEach(function (a) { ids.add(a.id); });
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
    ask.forEach(function (a, i) {
      var row = buildAskRow(a, i);
      frag.appendChild(row.node);
      ROWS.push(row);
    });
    el.list.appendChild(frag);

    fillCategorySelect();

    if (data.meta && data.meta.generated) {
      el.statMeta.textContent = '생성 ' + data.meta.generated;
    }

    /* Only rendered when there is a second bank to switch to. A tab row with one
       tab is a control that answers nothing. */
    /* The toggle appears as soon as ANY second bank has rows. Written as a
       chain of `&&` per bank it silently stops covering the newest one. */
    el.modeRow.hidden = cs.length + terms.length + script.length + ask.length === 0;
    if (!el.modeRow.hidden) renderModeChips();

    renderLensChips();
    syncFields();
    /* Both rows are built with no pressed state; this writes the initial one. */
    syncToggles();
    renderStats();
    applyFilters();

    el.cat.addEventListener('change', applyFilters);
    el.diff.addEventListener('change', applyFilters);
    el.q.addEventListener('input', applyFilters);
    el.undone.addEventListener('change', applyFilters);
    el.starred.addEventListener('change', applyFilters);
    el.starred.addEventListener('change', applyFilters);
    el.reset.addEventListener('click', function () {
      activeLens = '';
      el.cat.value = '';
      el.diff.value = '';
      el.q.value = '';
      el.undone.checked = false;
      el.starred.checked = false;
      /* Not a rebuild — that would drop focus off the reset button. */
      syncToggles();
      applyFilters();
    });

    el.lock.hidden = true;
    el.app.hidden = false;
    /* Move focus out of the now-hidden form, or a keyboard reader is left on a
       control that no longer exists. */
    el.q.focus();
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

    /* The derivation blocks for a few hundred ms by design. Yielding a frame
       first is what lets "여는 중…" actually paint before it starts. */
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

  /* Local convenience, and NOT a bypass. On a build that fell back to the dev
     passphrase, the field is prefilled with the literal 'dev' — the form still
     submits, still derives the key, still fails the GCM tag if it is wrong. The
     flag comes from the build; the value does not, so if `data-dev` were ever
     wrongly true in a real build the only consequence is a prefilled password
     that does not work. `make interview-leak-check` fails on the flag being
     present at all, which is what stops a locally-built _site from shipping. */
  if (el.payload.dataset.dev === 'true') {
    el.pass.value = 'dev';
    el.msg.textContent = '개발 빌드입니다. INTERVIEW_PASSPHRASE 없이 빌드되어 개발용 비밀번호가 채워져 있습니다.';
  }

  /* Said up front rather than after a failed attempt: on a non-secure origin
     there is no password that would work, and the error text for a wrong one
     would send the reader looking for the wrong problem. */
  if (!window.IVCrypto.available()) {
    el.msg.textContent = '이 브라우저에서는 복호화를 할 수 없습니다. HTTPS로 접속했는지 확인해 주세요.';
    el.msg.classList.add('is-error');
    setBusy(true);
    el.unlock.textContent = '사용 불가';
  }
})();
