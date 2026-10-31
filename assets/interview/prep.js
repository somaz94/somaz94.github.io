/* 면접 자료 — /interview/prep/
 *
 * Opens the payload `_plugins/interview_applications.rb` seals: one entry per
 * application, each with its slide deck as a whole HTML document and its
 * speaker script, Q&A notes and optional glossary as HTML the build rendered
 * from Markdown.
 * Nothing is stored, the passphrase included.
 */
(function () {
  'use strict';

  var SLIDE_W = 1280;
  var SLIDE_H = 720;
  var SLIDE_GAP = 16;
  var LINK_STRIP = 40;   // page px under each slide for its 스크립트 link

  var el = {
    payload: document.getElementById('iv-payload'),
    lock: document.getElementById('iv-lock'),
    form: document.getElementById('iv-form'),
    pass: document.getElementById('iv-pass'),
    unlock: document.getElementById('iv-unlock'),
    msg: document.getElementById('iv-lock-msg'),
    app: document.getElementById('am-app'),
    label: document.getElementById('am-label'),
    picker: document.getElementById('am-picker'),
    frame: document.getElementById('am-deck-frame'),
    print: document.getElementById('am-print'),
    tabs: Array.prototype.slice.call(document.querySelectorAll('.am-tab')),
    panels: {
      deck: document.getElementById('am-deck'),
      script: document.getElementById('am-script'),
      qna: document.getElementById('am-qna'),
      glossary: document.getElementById('am-glossary')
    },
    glossaryTab: document.getElementById('am-tab-glossary'),
    back: document.getElementById('am-back'),
    deckWrap: document.getElementById('am-deck-wrap')
  };

  var scriptFor = Object.create(null);   // slide id -> script heading id

  /* Screen-only spacing between slides, plus print zoom reset: the deck keeps
     its own @page rule, so printing from here yields the same pages as the PDF. */
  var DECK_STYLE =
    '@media screen { html { background: #d9dee7; } body { background: transparent; }' +
    ' .slide { margin: 0 auto var(--am-gap, ' + SLIDE_GAP + 'px); box-shadow: 0 1px 4px rgba(15,23,42,.18); } }' +
    '@media print { html { zoom: 1 !important; } }';

  function deckScale() { return Math.min(1, el.frame.clientWidth / SLIDE_W); }

  /* In slide px, so the strip stays LINK_STRIP page px however small the slides are scaled. */
  function deckGap(scale) { return Math.max(SLIDE_GAP, Math.ceil(LINK_STRIP / scale)); }

  function slideTop(i, scale) { return i * (SLIDE_H + deckGap(scale)) * scale; }

  function slides() {
    var doc = el.frame.contentDocument;
    return doc ? Array.prototype.slice.call(doc.querySelectorAll('.slide')) : [];
  }

  function fitDeck() {
    var doc = el.frame.contentDocument;
    if (!doc || !doc.documentElement) return;
    var scale = deckScale();
    var count = doc.querySelectorAll('.slide').length;
    doc.documentElement.style.zoom = String(scale);
    doc.documentElement.style.setProperty('--am-gap', deckGap(scale) + 'px');
    el.frame.style.height = Math.ceil(slideTop(count, scale)) + 'px';
    placeScriptLinks(scale);
  }

  /* In the gap under each slide, in page pixels: laid over a slide, a link
     covered its content once a phone scaled the slide to a quarter. */
  function placeScriptLinks(scale) {
    Array.prototype.slice.call(el.deckWrap.querySelectorAll('.am-to-script')).forEach(function (a) { a.remove(); });
    var side = Math.max(0, (el.frame.clientWidth - SLIDE_W * scale) / 2) + 8;
    slides().forEach(function (s, i) {
      if (!s.id || !scriptFor[s.id]) return;
      var a = document.createElement('a');
      a.className = 'am-to-script';
      a.href = '#' + encodeURIComponent(scriptFor[s.id]);
      a.textContent = 'p.' + (i + 1) + ' 스크립트';
      a.style.top = Math.round(slideTop(i, scale) + SLIDE_H * scale + 6) + 'px';
      a.style.right = Math.round(side) + 'px';
      el.deckWrap.appendChild(a);
    });
  }

  /* script.md names each section's slide in a trailing `<!-- <slide id> -->` on
     its heading, which kramdown keeps; that comment is the whole mapping. */
  function linkScript() {
    scriptFor = Object.create(null);
    Array.prototype.forEach.call(el.panels.script.querySelectorAll('h2, h3, h4'), function (h) {
      var slide = null;
      Array.prototype.forEach.call(h.childNodes, function (n) {
        if (n.nodeType === 8 && /^[a-z0-9-]+$/.test(n.data.trim())) slide = n.data.trim();
      });
      if (!slide || !h.id) return;
      scriptFor[slide] = h.id;
      var a = document.createElement('a');
      a.className = 'am-map';
      a.href = '#' + slide;
      a.textContent = '슬라이드 보기';
      h.appendChild(a);
    });
  }

  /* Bound once: every srcdoc assignment fires it again for the new deck. */
  el.frame.addEventListener('load', function () {
    var doc = el.frame.contentDocument;
    if (!doc || !doc.head) return;
    var style = doc.createElement('style');
    style.textContent = DECK_STYLE;
    doc.head.appendChild(style);
    fitDeck();
  });

  function selectTab(name) {
    el.tabs.forEach(function (tab) {
      var on = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      el.panels[tab.dataset.tab].hidden = !on;
    });
    /* A hidden iframe measures 0 wide, so the deck is fitted when it is shown. */
    if (name === 'deck') fitDeck();
  }

  /* Two-column term tables stack on a phone; see .am-defs in prep.css. */
  function markDefinitionTables(root) {
    Array.prototype.forEach.call(root.querySelectorAll('table'), function (table) {
      var first = table.querySelector('tr');
      if (first && first.children.length === 2) table.classList.add('am-defs');
    });
  }

  function showApp(app) {
    el.label.textContent = app.label || '';
    document.title = (app.label ? app.label + ' · ' : '') + '면접 자료';
    Array.prototype.forEach.call(el.picker.children, function (b) {
      b.setAttribute('aria-pressed', b.dataset.id === app.id ? 'true' : 'false');
    });
    /* innerHTML is deliberate here: the build rendered the user's own Markdown,
       and a table or heading must arrive as markup, not as escaped text. */
    el.panels.script.innerHTML = app.script || '';
    el.panels.qna.innerHTML = app.qna || '';
    el.panels.glossary.innerHTML = app.glossary || '';
    el.glossaryTab.hidden = !app.glossary;
    markDefinitionTables(el.panels.qna);
    markDefinitionTables(el.panels.glossary);
    linkScript();
    el.frame.srcdoc = app.deck || '';
    selectTab('deck');
    el.back.hidden = true;
    document.body.classList.remove('am-has-back');
  }

  function render(data) {
    var apps = (data && data.applications) || [];
    el.lock.hidden = true;
    el.app.hidden = false;
    apps.forEach(function (app) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'am-pick';
      b.dataset.id = app.id;
      b.textContent = app.label || app.id;
      b.addEventListener('click', function () { showApp(app); });
      el.picker.appendChild(b);
    });
    el.picker.hidden = apps.length < 2;
    if (apps.length) showApp(apps[0]);
  }

  el.tabs.forEach(function (tab) {
    tab.addEventListener('click', function () { selectTab(tab.dataset.tab); });
    tab.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var shown = el.tabs.filter(function (t) { return !t.hidden; });
      var i = shown.indexOf(tab);
      var next = shown[(i + (e.key === 'ArrowRight' ? 1 : shown.length - 1)) % shown.length];
      selectTab(next.dataset.tab);
      next.focus();
    });
  });

  function panelOf(node) {
    for (var name in el.panels) {
      if (el.panels[name].contains(node)) return name;
    }
    return null;
  }

  function currentTab() {
    var on = el.tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0];
    return on ? on.dataset.tab : 'deck';
  }

  /* A slide lives in the frame's own document, so it is found by position. */
  function locate(id) {
    var node = id && document.getElementById(id);
    if (node && panelOf(node)) return { panel: panelOf(node), node: node };
    var index = slides().map(function (s) { return s.id; }).indexOf(id);
    return id && index !== -1 ? { panel: 'deck', index: index } : null;
  }

  function flash(node) {
    node.classList.remove('am-hit');
    void node.offsetWidth;
    node.classList.add('am-hit');
  }

  function jumpTo(id) {
    var t = locate(id);
    if (!t) return;
    selectTab(t.panel);
    if (t.panel !== 'deck') {
      t.node.scrollIntoView();
      flash(t.node.closest('tr, h2, h3, h4') || t.node);
      return;
    }
    var scale = deckScale();
    var tabs = document.querySelector('.am-tabs');
    var stuck = (parseFloat(getComputedStyle(tabs).top) || 0) + tabs.offsetHeight;
    var y = el.frame.getBoundingClientRect().top + window.scrollY + slideTop(t.index, scale);
    window.scrollTo(0, Math.max(0, y - stuck - 8));
    var ring = document.createElement('div');
    ring.className = 'am-slide-hit';
    ring.style.top = Math.round(slideTop(t.index, scale)) + 'px';
    ring.style.left = Math.round(Math.max(0, (el.frame.clientWidth - SLIDE_W * scale) / 2)) + 'px';
    ring.style.width = Math.round(SLIDE_W * scale) + 'px';
    ring.style.height = Math.round(SLIDE_H * scale) + 'px';
    ring.addEventListener('animationend', function () { ring.remove(); });
    el.deckWrap.appendChild(ring);
  }

  /* Answers link into the glossary tab, and slides and script sections into each other. The browser cannot scroll to
     an id inside a hidden panel, so the jump happens here, and each one is a
     history entry so the phone's back gesture returns to the answer it left. */
  history.scrollRestoration = 'manual';

  /* Korean particle: '으로' after a final consonant other than ㄹ, else '로' ("용어 설명으로", "Q&A로"). */
  function withRo(word) {
    var code = word.charCodeAt(word.length - 1) - 0xac00;
    var jong = code >= 0 && code < 11172 ? code % 28 : 0;
    return word + (jong && jong !== 8 ? '으로' : '로');
  }

  /* `depth` counts the jumps still undone, so the button survives a jump from one
     term to another and disappears only on the entry the first jump left. */
  function updateBack(s) {
    var from = s && s.depth > 0 && el.tabs.filter(function (t) { return t.dataset.tab === s.from; })[0];
    el.back.hidden = !from;
    document.body.classList.toggle('am-has-back', !!from);
    if (from) el.back.textContent = '← ' + withRo(from.textContent) + ' 돌아가기';
  }

  el.app.addEventListener('click', function (e) {
    var a = e.target.closest('.am-doc a[href^="#"], .am-deck-wrap a[href^="#"]');
    if (!a) return;
    var id = decodeURIComponent(a.getAttribute('href').slice(1));
    if (!locate(id)) return;
    e.preventDefault();
    var cur = history.state || {};
    var depth = cur.depth || 0;
    var from = currentTab();
    history.replaceState({ tab: from, y: window.scrollY, depth: depth, from: cur.from }, '');
    var next = { id: id, depth: depth + 1, from: from };
    history.pushState(next, '', '#' + id);
    jumpTo(id);
    updateBack(next);
  });

  window.addEventListener('popstate', function (e) {
    var s = e.state;
    if (s && s.tab) {
      selectTab(s.tab);
      window.scrollTo(0, s.y || 0);
    } else if (s && s.id) {
      jumpTo(s.id);
    }
    updateBack(s);
  });

  el.back.addEventListener('click', function () { history.back(); });

  el.print.addEventListener('click', function () {
    if (el.frame.contentWindow) el.frame.contentWindow.print();
  });

  window.addEventListener('resize', function () {
    if (!el.panels.deck.hidden) fitDeck();
  });

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
      window.PrivateEnvelope.unlock(payload, pass, iter, {
        messages: { empty: '이 페이지에 암호화된 내용이 없습니다. 자료 없이 빌드된 것 같습니다.' }
      })
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
     passphrase. `make interview-leak-check` fails on the flag. */
  if (el.payload.dataset.dev === 'true') {
    el.pass.value = 'dev';
    el.msg.textContent = '개발 빌드입니다. INTERVIEW_PASSPHRASE 없이 빌드되어 개발용 비밀번호가 채워져 있습니다.';
  }

  if (!window.PrivateEnvelope.available()) {
    el.msg.textContent = '이 브라우저에서는 복호화를 할 수 없습니다. HTTPS로 접속했는지 확인해 주세요.';
    el.msg.classList.add('is-error');
    setBusy(true);
    el.unlock.textContent = '사용 불가';
  }
})();
