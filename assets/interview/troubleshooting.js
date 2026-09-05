/* 트러블슈팅 — /interview/troubleshooting/
 *
 * Unlocks the SAME ciphertext the parent page carries and renders only the
 * `triage:` half of it. Everything else in the decrypted bank is ignored here,
 * which is the whole reason the two pages can share one payload: the page a
 * reader opens decides what is built, not what was encrypted.
 *
 * Nothing is stored. The parent keeps progress marks because a 159-question
 * rehearsal set is walked over days; a diagnosis order is opened when something
 * is already on fire and read top to bottom, so a checkbox here would only ever
 * be stale. The passphrase is not held either — a refresh asks again.
 *
 * Nothing is built with innerHTML. The content is the user's own YAML, so this
 * is not a defence against a hostile author — it is that `<` in a shell snippet
 * and `&` in `Metrics & Traces` have to render as themselves, and a markup path
 * eats them silently.
 */
(function () {
  'use strict';

  var el = {
    payload: document.getElementById('iv-payload'),
    lock: document.getElementById('iv-lock'),
    form: document.getElementById('iv-form'),
    pass: document.getElementById('iv-pass'),
    unlock: document.getElementById('iv-unlock'),
    msg: document.getElementById('iv-lock-msg'),
    app: document.getElementById('iv-app'),
    title: document.getElementById('ts-title'),
    lede: document.getElementById('ts-lede'),
    treeRow: document.getElementById('ts-tree-row'),
    q: document.getElementById('ts-q'),
    layerSel: document.getElementById('ts-layer'),
    first: document.getElementById('ts-first'),
    silent: document.getElementById('ts-silent'),
    count: document.getElementById('ts-count'),
    toc: document.getElementById('ts-toc'),
    tocList: document.getElementById('ts-toc-list'),
    layers: document.getElementById('ts-layers'),
    empty: document.getElementById('ts-empty')
  };

  var ROWS = [];      // { node, layer, first, silent, hay }
  var SECTIONS = [];  // { node, key }

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function pad(i) { return (i < 10 ? '0' : '') + i; }

  /* ------------------------------------------------------------- render */

  /* The three labels are per LAYER, not global. Most layers read 증상 / 확인 /
     조치, but 흔한 오진 is not a symptom list — its rows are 오해 / 실제 / 대응, and
     calling a misconception a symptom would be plainly wrong on every card.

     Declared on the layer rather than the item because all rows in a layer
     answer the same three questions; per item it would be a field repeated
     seven times with one value. */
  var TRIAD = ['증상', '확인', '조치'];

  function buildItem(item, layerKey, labels) {
    var flags = item.flags || [];
    var isFirst = flags.indexOf('first') !== -1;
    var isSilent = flags.indexOf('silent') !== -1;

    var li = node('li', 'ts-item');
    var head = node('div', 'ts-item-head');
    head.appendChild(node('h3', null, item.title));
    if (isFirst) head.appendChild(node('span', 'ts-chip ts-chip-first', '1순위'));
    if (isSilent) head.appendChild(node('span', 'ts-chip ts-chip-silent', '조용히 실패'));
    li.appendChild(head);

    if (item.note) {
      li.appendChild(node('p', 'ts-note', item.note));
    } else {
      var dl = node('dl', 'ts-triad');
      var L = labels && labels.length === 3 ? labels : TRIAD;
      [[L[0], item.symptom], [L[1], item.check], [L[2], item.fix]].forEach(function (pair) {
        var row = document.createElement('div');
        row.appendChild(node('dt', null, pair[0]));
        var dd = node('dd');
        /* `fix` is a string OR a list of branches — "if p50 too, then X; if only
           p99, then Y". Flattened into one sentence the branch reads as a single
           instruction, which is the opposite of what it says. A list keeps the
           two answers apart and keeps the condition attached to its own. */
        if (Array.isArray(pair[1])) {
          var ul = node('ul', 'ts-branch');
          pair[1].forEach(function (b) { ul.appendChild(node('li', null, b)); });
          dd.appendChild(ul);
        } else {
          dd.textContent = pair[1] || '';
        }
        row.appendChild(dd);
        dl.appendChild(row);
      });
      li.appendChild(dl);
    }

    /* An optional snippet — a query or a command that IS the answer, where
       retyping it from prose is the step people get wrong. `textContent`, so a
       `<` in a shell redirect and the `[5m]` brackets survive; `<pre>` so the
       line breaks where the author put it and scrolls rather than wrapping
       mid-identifier. */
    if (item.code) {
      var pre = node('pre', 'ts-code');
      pre.appendChild(node('code', null, item.code));
      li.appendChild(pre);
    }

    ROWS.push({
      node: li,
      layer: layerKey,
      first: isFirst,
      silent: isSilent,
      /* `.flat()` would be ES2019; this file stays ES5 like its siblings. The
         concat spread flattens the one level `fix` can have. */
      hay: [].concat(item.title, item.symptom, item.check, item.fix || '',
                     item.note || '', item.code || '')
        .filter(Boolean).join(' ').toLowerCase()
    });
    return li;
  }

  /* Wipes what the previous tree built. Rebuilding rather than hiding keeps the
     layer numbers meaningful: they are positions WITHIN a tree, so a tree that
     starts at 03 because the previous one owned 00-02 would be wrong. */
  function reset() {
    ROWS = [];
    SECTIONS = [];
    el.layers.textContent = '';
    el.tocList.textContent = '';
    el.layerSel.textContent = '';
    var all = document.createElement('option');
    all.value = '';
    all.textContent = '전체';
    el.layerSel.appendChild(all);
  }

  function render(bank, treeKey) {
    var items = bank.triage || [];
    var cats = (bank.triage_categories || []).filter(function (c) {
      /* A layer with no `tree` belongs to the first one declared — so a bank
         written before trees existed still renders instead of vanishing. */
      return (c.tree || (bank.triage_trees || [{}])[0].key) === treeKey;
    });

    reset();

    /* The declaration list is the ORDER, and the numbers printed beside each
       layer come from its position here. Grouping off the items' own order
       instead would renumber the whole page the day one item moves. */
    cats.forEach(function (cat, i) {
      var mine = items.filter(function (t) { return t.category === cat.key; });
      if (!mine.length) return;   /* a declared-but-empty layer renders nothing */

      var sec = node('section', 'ts-layer');
      sec.id = 'ts-' + cat.key;

      var head = node('div', 'ts-layer-head');
      head.appendChild(node('span', 'ts-layer-n', pad(i)));
      head.appendChild(node('h2', null, cat.label));
      sec.appendChild(head);

      var ul = node('ul', 'ts-items');
      mine.forEach(function (t) { ul.appendChild(buildItem(t, cat.key, cat.labels)); });
      sec.appendChild(ul);
      el.layers.appendChild(sec);
      SECTIONS.push({ node: sec, key: cat.key });

      var opt = document.createElement('option');
      opt.value = cat.key;
      opt.textContent = cat.label;
      el.layerSel.appendChild(opt);

      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#ts-' + cat.key;
      a.appendChild(node('span', 'ts-toc-n', pad(i)));
      a.appendChild(node('span', null, cat.label));
      /* Jumping to a layer that the filter has hidden scrolls to nothing, so the
         link widens the view first. */
      a.addEventListener('click', function () {
        if (!el.layerSel.value) return;
        el.layerSel.value = '';
        apply();
      });
      li.appendChild(a);
      el.tocList.appendChild(li);
    });

    el.toc.hidden = SECTIONS.length < 2;
  }

  /* ------------------------------------------------------------- filter */

  function apply() {
    var needle = el.q.value.trim().toLowerCase();
    var layer = el.layerSel.value;
    var wantFirst = el.first.checked;
    var wantSilent = el.silent.checked;
    var shown = 0;

    ROWS.forEach(function (r) {
      var ok =
        (!layer || r.layer === layer) &&
        (!wantFirst || r.first) &&
        (!wantSilent || r.silent) &&
        (!needle || r.hay.indexOf(needle) !== -1);
      r.node.hidden = !ok;
      if (ok) shown++;
    });

    /* A layer whose items are all filtered out hides its heading too — left in
       place it reads as a section that genuinely holds nothing, which is a
       different claim from "nothing here matched". */
    SECTIONS.forEach(function (s) {
      s.node.hidden = !ROWS.some(function (r) { return r.layer === s.key && !r.node.hidden; });
    });

    /* Never silent: the page opens unfiltered, so saying nothing would let a
       narrowed view pass for the whole document. */
    el.count.textContent = shown === ROWS.length
      ? ROWS.length + '개 항목'
      : shown + ' / ' + ROWS.length + '개 항목';
    el.empty.hidden = shown !== 0;
  }

  function wireFilters() {
    el.q.addEventListener('input', apply);
    el.layerSel.addEventListener('change', apply);
    el.first.addEventListener('change', apply);
    el.silent.addEventListener('change', apply);
    el.q.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      el.q.value = '';
      el.layerSel.value = '';
      el.first.checked = false;
      el.silent.checked = false;
      apply();
    });
  }

  /* -------------------------------------------------------------- unlock */

  function show(text, bad) {
    el.msg.textContent = text;
    el.msg.classList.toggle('is-bad', !!bad);
  }

  function showTree(bank, tree) {
    el.title.textContent = tree.title || tree.label || '';
    el.lede.textContent = tree.lede || '';
    render(bank, tree.key);
    apply();
    [].forEach.call(el.treeRow.querySelectorAll('.ts-tree'), function (b) {
      var on = b.dataset.tree === tree.key;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function start(bank) {
    if (!(bank.triage || []).length) {
      show('이 빌드에는 트러블슈팅 항목이 없습니다.', true);
      return;
    }
    var trees = bank.triage_trees || [];
    if (!trees.length) {
      show('트러블슈팅 트리가 선언돼 있지 않습니다.', true);
      return;
    }

    /* Built ONCE, and the pressed state is written in place by `showTree`.
       Rebuilding the row inside its own click handler removes the button the
       user just pressed Enter on, dropping focus to <body> — the bug the parent
       page records for its own toggle rows. */
    if (trees.length > 1) {
      trees.forEach(function (t) {
        var b = node('button', 'ts-tree', t.label || t.key);
        b.type = 'button';
        b.dataset.tree = t.key;
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', function () { showTree(bank, t); });
        el.treeRow.appendChild(b);
      });
      el.treeRow.hidden = false;
    }

    wireFilters();
    showTree(bank, trees[0]);
    el.lock.hidden = true;
    el.app.hidden = false;
    el.q.focus();
  }

  function init() {
    if (!el.payload) return;
    var payload = el.payload.dataset.payload || '';
    var iter = parseInt(el.payload.dataset.iter, 10) || 310000;

    if (!window.IVCrypto || !window.IVCrypto.available()) {
      show('이 브라우저에서는 복호화를 지원하지 않습니다. HTTPS로 접속했는지 확인해 주세요.', true);
      el.unlock.disabled = true;
      return;
    }
    if (!payload) {
      show('이 빌드에는 내용이 들어 있지 않습니다.', true);
      el.unlock.disabled = true;
      return;
    }
    /* A FLAG, never the passphrase — the plugin emits only a boolean, and the
       literal below is the well-known local value. If this were ever wrongly
       true in a real build the worst case is a prefilled password that does not
       work, which is not the same bug as shipping the real one. */
    if (el.payload.dataset.dev === 'true') el.pass.value = 'dev';

    el.form.addEventListener('submit', function (e) {
      e.preventDefault();
      var pass = el.pass.value;
      if (!pass) return;
      el.unlock.disabled = true;
      show('여는 중…');
      window.IVCrypto.unlock(payload, pass, iter)
        .then(start)
        .catch(function (err) {
          show((err && err.message) || '열지 못했습니다.', true);
          el.unlock.disabled = false;
          el.pass.select();
        });
    });
  }

  init();
})();
