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
    lensRow: document.getElementById('iv-lens-row'),
    cat: document.getElementById('iv-cat'),
    diff: document.getElementById('iv-diff'),
    q: document.getElementById('iv-q'),
    undone: document.getElementById('iv-undone'),
    reset: document.getElementById('iv-reset'),
    count: document.getElementById('iv-count'),
    list: document.getElementById('iv-list'),
    empty: document.getElementById('iv-empty'),
    statTotal: document.getElementById('iv-stat-total'),
    statDone: document.getElementById('iv-stat-done'),
    statLenses: document.getElementById('iv-stat-lenses'),
    statMeta: document.getElementById('iv-stat-meta')
  };

  var DATA = null;       // the decrypted bank
  var ROWS = [];         // one entry per question, with its <li> and search text
  var LENS = {};         // key -> lens object
  var CATS = {};         // key -> label
  var done = new Set();
  var activeLens = '';   // '' = all

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

    function part(letter, text) {
      var row = textNode('div', 'iv-draft-row');
      row.appendChild(textNode('span', 'iv-draft-key', letter));
      row.appendChild(textNode('p', 'iv-draft-text', text));
      return row;
    }
    d.appendChild(part('A', q.draft.a));
    if (q.draft.r) d.appendChild(part('R', q.draft.r));
    return d;
  }

  function followBlock(q) {
    if (!q.follow_ups || !q.follow_ups.length) return null;
    var wrap = textNode('div', 'iv-follow');
    wrap.appendChild(textNode('span', 'iv-follow-label', '꼬리질문'));
    var ul = textNode('ul', 'iv-follow-list');
    q.follow_ups.forEach(function (f) { ul.appendChild(textNode('li', 'iv-follow-item', f)); });
    wrap.appendChild(ul);
    return wrap;
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
    var lens = LENS[q.lens];
    var lensChip = textNode('span', 'iv-chip iv-chip-lens', lens ? lens.label : q.lens);
    lensChip.dataset.lens = q.lens;
    chips.appendChild(lensChip);
    chips.appendChild(textNode('span', 'iv-chip', CATS[q.category] || q.category));
    chips.appendChild(dots(q.difficulty));
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
      lens: q.lens,
      cat: q.category,
      diff: String(q.difficulty),
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
        (q.follow_ups || []).join(' '),
        (q.anchors || []).map(function (a) { return (a.id || '') + ' ' + (a.label || ''); }).join(' ')
      ].join(' ').toLowerCase()
    };
  }

  /* --------------------------------------------------------------- filter */

  function applyFilters() {
    var cat = el.cat.value;
    var diff = el.diff.value;
    var term = el.q.value.trim().toLowerCase();
    var undoneOnly = el.undone.checked;
    var shown = 0;

    ROWS.forEach(function (r) {
      var ok =
        (!activeLens || r.lens === activeLens) &&
        (!cat || r.cat === cat) &&
        (!diff || r.diff === diff) &&
        (!undoneOnly || !done.has(r.id)) &&
        (!term || r.hay.indexOf(term) !== -1);
      r.node.hidden = !ok;
      if (ok) shown++;
    });

    el.empty.hidden = shown !== 0;
    /* Always stated, never silent: the default view is unfiltered, but a lens
       chip is one click away and 55 rows dropping to 11 with no line saying so
       reads as a shorter bank rather than a narrower view. */
    el.count.textContent = shown === ROWS.length
      ? ROWS.length + '개 질문'
      : shown + ' / ' + ROWS.length + '개 질문';
  }

  function renderStats() {
    el.statTotal.textContent = String(ROWS.length);
    el.statDone.textContent = String(done.size);

    el.statLenses.textContent = '';
    (DATA.lenses || []).forEach(function (l) {
      var n = ROWS.filter(function (r) { return r.lens === l.key; }).length;
      var s = textNode('span', 'iv-mini', l.label + ' ' + n);
      s.dataset.lens = l.key;
      el.statLenses.appendChild(s);
    });
  }

  function renderLensChips() {
    el.lensRow.textContent = '';

    function chip(key, label, title) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'iv-lens' + (activeLens === key ? ' is-on' : '');
      b.dataset.lens = key;
      b.textContent = label;
      if (title) b.title = title;
      b.setAttribute('aria-pressed', activeLens === key ? 'true' : 'false');
      b.addEventListener('click', function () {
        activeLens = (activeLens === key) ? '' : key;
        renderLensChips();
        applyFilters();
      });
      return b;
    }

    el.lensRow.appendChild(chip('', '전체', '모든 관점'));
    (DATA.lenses || []).forEach(function (l) {
      el.lensRow.appendChild(chip(l.key, l.full || l.label, l.desc));
    });
  }

  /* ---------------------------------------------------------------- start */

  function render(data) {
    DATA = data;

    (data.lenses || []).forEach(function (l) { LENS[l.key] = l; });
    (data.categories || []).forEach(function (c) { CATS[c.key] = c.label; });

    var questions = data.questions || [];
    var ids = new Set(questions.map(function (q) { return q.id; }));
    done = loadProgress(ids);

    var frag = document.createDocumentFragment();
    ROWS = questions.map(function (q, i) {
      var row = buildRow(q, i);
      frag.appendChild(row.node);
      return row;
    });
    el.list.appendChild(frag);

    (data.categories || []).forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.key;
      o.textContent = c.label;
      el.cat.appendChild(o);
    });

    if (data.meta && data.meta.generated) {
      el.statMeta.textContent = '생성 ' + data.meta.generated;
    }

    renderLensChips();
    renderStats();
    applyFilters();

    el.cat.addEventListener('change', applyFilters);
    el.diff.addEventListener('change', applyFilters);
    el.q.addEventListener('input', applyFilters);
    el.undone.addEventListener('change', applyFilters);
    el.reset.addEventListener('click', function () {
      activeLens = '';
      el.cat.value = '';
      el.diff.value = '';
      el.q.value = '';
      el.undone.checked = false;
      renderLensChips();
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
