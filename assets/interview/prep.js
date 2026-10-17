/* 면접 자료 — /interview/prep/
 *
 * Opens the payload `_plugins/interview_applications.rb` seals: one entry per
 * application, each with its slide deck as a whole HTML document and its
 * speaker script and Q&A notes as HTML the build rendered from Markdown.
 * Nothing is stored, the passphrase included.
 */
(function () {
  'use strict';

  var SLIDE_W = 1280;
  var SLIDE_H = 720;
  var SLIDE_GAP = 16;

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
      qna: document.getElementById('am-qna')
    }
  };

  /* Screen-only spacing between slides, plus print zoom reset: the deck keeps
     its own @page rule, so printing from here yields the same pages as the PDF. */
  var DECK_STYLE =
    '@media screen { html { background: #d9dee7; } body { background: transparent; }' +
    ' .slide { margin: 0 auto ' + SLIDE_GAP + 'px; box-shadow: 0 1px 4px rgba(15,23,42,.18); } }' +
    '@media print { html { zoom: 1 !important; } }';

  function fitDeck() {
    var doc = el.frame.contentDocument;
    if (!doc || !doc.documentElement) return;
    var scale = Math.min(1, el.frame.clientWidth / SLIDE_W);
    var count = doc.querySelectorAll('.slide').length;
    doc.documentElement.style.zoom = String(scale);
    el.frame.style.height = Math.ceil(count * (SLIDE_H + SLIDE_GAP) * scale) + 'px';
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
    el.frame.srcdoc = app.deck || '';
    selectTab('deck');
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

  el.tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () { selectTab(tab.dataset.tab); });
    tab.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var next = el.tabs[(i + (e.key === 'ArrowRight' ? 1 : el.tabs.length - 1)) % el.tabs.length];
      selectTab(next.dataset.tab);
      next.focus();
    });
  });

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
