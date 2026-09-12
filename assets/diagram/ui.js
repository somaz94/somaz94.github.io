/* Architecture diagram editor — palette, canvas interaction, inspector.
 * Depends on assets/diagram/icons.js and assets/diagram/engine.js.
 */
(function (global) {
  'use strict';

  var E = global.DiagramEngine;
  var el = E.el;
  var fmt = E.fmt;

  var GRID = 10;
  var MIN_ZOOM = 0.2;
  var MAX_ZOOM = 4;
  var STORAGE_KEY = 'dg-diagram-v1';   // legacy single slot; migrated into the library
  var INDEX_KEY = 'dg-index-v1';
  var DOC_PREFIX = 'dg-doc-';
  /* Shared with the other seven tool pages since the theme toggle was rolled
     out to all of them — the same reason /career/ moved off `careerDarkMode`:
     pages a reader moves between must answer the same question the same way.
     The old key is adopted once and deleted, so nobody who had set a theme here
     loses it. What does NOT change is this page's default: with nothing stored
     it opens LIGHT rather than following the OS, because the canvas paints the
     diagram's own white background and dark chrome around it is a worse first
     impression. The other tools default to the OS. */
  var THEME_KEY = 'tool-theme';
  var LEGACY_THEME_KEY = 'dg-theme';
  var HELP_KEY = 'dg-help-seen';

  /* Every shortcut already answers to both modifiers — `onKeyDown` tests
   * `ev.ctrlKey || ev.metaKey` — so this is purely about naming them. The
   * static copy is authored with the Windows names and swapped at boot; a Mac
   * reader who is told "Ctrl" will press the key that does nothing. */
  /* Every hint is concatenated rather than picked with `||`: Chrome reports
   * `userAgentData.platform` as "macOS" — lower-case `m`, and truthy — so a
   * first-match-wins chain stops there and a case-sensitive /Mac/ then misses.
   * Headless Chrome returns "" for the same field, which is why that spelling
   * has to be tested for explicitly rather than discovered in a browser run. */
  var IS_MAC = /mac|iphone|ipad|ipod/i.test([
    (navigator.userAgentData && navigator.userAgentData.platform) || '',
    navigator.platform || '',
    navigator.userAgent || ''
  ].join(' '));
  var MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';
  var ALT_KEY = IS_MAC ? '⌥' : 'Alt';
  var SHIFT_KEY = IS_MAC ? '⇧' : 'Shift';

  /* Read, never re-derived. The pre-paint script in `diagram.html` decides
   * whether this is an embed and records it on the root element; parsing the
   * query string a second time here is how the stylesheet and the behaviour
   * eventually end up disagreeing about it. */
  var EMBED = document.documentElement.hasAttribute('data-embed');

  var SWATCHES = [
    '#334155', '#dc2626', '#ea580c', '#d97706', '#16a34a',
    '#0891b2', '#2563eb', '#7c3aed', '#db2777', '#64748b'
  ];

  var state = {
    model: E.emptyModel(),
    docId: '',       // which library entry `model` belongs to
    docs: [],        // the index: [{ id, title, updated }]
    baseline: null,
    selection: [],
    selectedEdge: null,
    view: { x: 0, y: 0, k: 1 },
    hoverNode: null,
    drag: null,
    spaceDown: false,
    history: E.createHistory(80),
    dirty: false,
    labelEdit: null
  };

  var dom = {};
  var renderQueued = false;
  var quotaWarned = false;

  // ---------------------------------------------------------------- helpers

  function $(id) { return document.getElementById(id); }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function snap(v, enabled) { return enabled === false ? v : Math.round(v / GRID) * GRID; }

  function byId(id) {
    for (var i = 0; i < state.model.nodes.length; i++) {
      if (state.model.nodes[i].id === id) return state.model.nodes[i];
    }
    return null;
  }

  function edgeById(id) {
    for (var i = 0; i < state.model.edges.length; i++) {
      if (state.model.edges[i].id === id) return state.model.edges[i];
    }
    return null;
  }

  function selectedNodes() {
    return state.selection.map(byId).filter(Boolean);
  }

  /** Screen coordinates -> model coordinates. */
  function toModel(clientX, clientY) {
    var r = dom.canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left - state.view.x) / state.view.k,
      y: (clientY - r.top - state.view.y) / state.view.k
    };
  }

  function toast(message, kind) {
    var node = document.createElement('div');
    node.className = 'dg-toast' + (kind === 'error' ? ' dg-toast--error' : '');
    node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    node.textContent = message;
    dom.toasts.appendChild(node);
    setTimeout(function () {
      node.style.transition = 'opacity .25s';
      node.style.opacity = '0';
      setTimeout(function () { node.remove(); }, 260);
    }, kind === 'error' ? 4200 : 2200);
  }

  // ---------------------------------------------------------------- history

  /* History stores the state as it was BEFORE each change. `baseline` is that
   * pre-change snapshot; mutations happen in place on state.model and commit()
   * files the baseline away, so the first undo actually moves. */
  function commit(label) {
    state.history.push(state.baseline);
    state.baseline = E.clone(state.model);
    state.dirty = true;
    scheduleRender();
    saveLocal();
    if (label) setStatus(label);
  }

  function undo() {
    var prev = state.history.undo(E.clone(state.model));
    if (!prev) return;
    state.model = prev;
    state.baseline = E.clone(prev);
    pruneSelection();
    scheduleRender();
    saveLocal();
    setStatus('Undo');
  }

  function redo() {
    var next = state.history.redo(E.clone(state.model));
    if (!next) return;
    state.model = next;
    state.baseline = E.clone(next);
    pruneSelection();
    scheduleRender();
    saveLocal();
    setStatus('Redo');
  }

  function pruneSelection() {
    state.selection = state.selection.filter(function (id) { return !!byId(id); });
    if (state.selectedEdge && !edgeById(state.selectedEdge)) state.selectedEdge = null;
  }

  // ---------------------------------------------------------------- persistence

  /* A library, not a single slot. The index is one small record — id, title and
   * timestamp per diagram — and each diagram's model sits under its own key, so
   * opening the page reads the index plus exactly one model rather than every
   * diagram the user has ever drawn.
   *
   * `dg-diagram-v1` was that single slot. It is migrated in on first boot and
   * then removed: leaving it behind means the next boot has two candidates for
   * "your last diagram" and no way to tell which is current. */

  function docKey(id) { return DOC_PREFIX + id; }

  function newDocId() { return E.nextId('d').slice(2); }

  function readStore(key) {
    try { return localStorage.getItem(key); } catch (err) { return null; }
  }

  function writeStore(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (err) {
      /* Private mode or a full quota. The editor still works — it just will not
       * resume, and with a library holding several diagrams that is worth
       * saying out loud rather than swallowing. Once, not on every keystroke. */
      if (!quotaWarned) {
        quotaWarned = true;
        toast('This browser will not store diagrams — export the JSON to keep them.', 'error');
      }
      return false;
    }
  }

  function removeStore(key) {
    try { localStorage.removeItem(key); } catch (err) { /* ignore */ }
  }

  /** Stored state is untrusted, the index no less than a model: validate, never cast. */
  function readIndex() {
    var raw = readStore(INDEX_KEY);
    if (!raw) return null;
    var data;
    try { data = JSON.parse(raw); } catch (err) { return null; }
    if (!data || !Array.isArray(data.docs)) return null;
    var docs = [];
    data.docs.forEach(function (d) {
      if (!d || typeof d.id !== 'string' || !d.id) return;
      docs.push({
        id: d.id,
        title: typeof d.title === 'string' ? d.title : 'Untitled diagram',
        updated: typeof d.updated === 'number' && isFinite(d.updated) ? d.updated : 0
      });
    });
    return { docs: docs, active: typeof data.active === 'string' ? data.active : '' };
  }

  function writeIndex() {
    writeStore(INDEX_KEY, JSON.stringify({
      v: 1, active: state.docId, docs: state.docs
    }));
  }

  function docEntry(id) {
    for (var i = 0; i < state.docs.length; i++) {
      if (state.docs[i].id === id) return state.docs[i];
    }
    return null;
  }

  function byRecent(a, b) { return b.updated - a.updated; }

  function saveLocal() {
    /* An embed shows someone else's diagram inside a third-party page. Writing
     * it into this browser's library would mean every post that embeds one
     * silently files a copy under the reader's own diagrams. */
    if (EMBED) return;
    if (!state.docId) return;
    if (!writeStore(docKey(state.docId), E.toJSON(state.model))) return;
    var entry = docEntry(state.docId);
    if (!entry) return;
    entry.title = state.model.title;
    entry.updated = Date.now();
    writeIndex();
    renderLibrary();
  }

  function loadDoc(id) {
    var raw = readStore(docKey(id));
    if (!raw) return null;
    try { return E.fromJSON(raw); } catch (err) { return null; }
  }

  /* Registers a model as a new entry and makes it the active one. Returns false
   * when the write failed: the entry still joins the in-memory list so the
   * session stays coherent, it simply will not survive a reload. */
  function addDoc(model) {
    var entry = { id: newDocId(), title: model.title, updated: Date.now() };
    var stored = writeStore(docKey(entry.id), E.toJSON(model));
    state.docs.unshift(entry);
    state.docId = entry.id;
    if (stored) writeIndex();
    return stored;
  }

  /* One-time move off the single slot. The legacy key is dropped only once the
   * copy is safely written — a failed write must leave the old diagram where it
   * is rather than on the floor. An existing library keeps its active diagram;
   * the migrated one joins the list without stealing focus. */
  function migrateLegacy() {
    var raw = readStore(STORAGE_KEY);
    if (!raw) return;
    var model = null;
    try { model = E.fromJSON(raw); } catch (err) { /* unreadable — drop it */ }
    if (!model || !model.nodes.length) { removeStore(STORAGE_KEY); return; }
    var previous = state.docId;
    if (!addDoc(model)) return;
    if (previous) { state.docId = previous; writeIndex(); }
    removeStore(STORAGE_KEY);
  }

  /* Restores the library and the diagram that was open. Always leaves a valid
   * `state.docId` behind, so every later save has somewhere to go. Returns
   * whether an existing diagram was restored. */
  function bootLibrary() {
    var index = readIndex();
    state.docs = index ? index.docs : [];
    state.docId = index ? index.active : '';
    migrateLegacy();

    // Drop entries whose model went missing — a partial clear of site data, or
    // a write that failed after the index had already been updated.
    state.docs = state.docs.filter(function (d) { return readStore(docKey(d.id)) !== null; });

    var model = state.docId ? loadDoc(state.docId) : null;
    if (!model && state.docs.length) {
      var recent = state.docs.slice().sort(byRecent)[0];
      state.docId = recent.id;
      model = loadDoc(recent.id);
    }
    if (!model) {
      state.docId = '';
      state.model = E.emptyModel();
      addDoc(state.model);
      return false;
    }
    state.model = model;
    writeIndex();
    return true;
  }

  // ---------------------------------------------------------------- library

  /* Switching, creating, copying and deleting entries. Every one of these ends
   * at `adoptLoadedModel()`, which is the single place that brings the editor
   * into line with a model that has just been swapped underneath it. */

  function copyTitle(title) {
    return ((title || 'Untitled diagram') + ' copy').slice(0, 120);
  }

  /* An opened file, a share link or a template on a busy canvas becomes a NEW
   * entry rather than overwriting what is open. That is what retires the "this
   * replaces what is on the canvas" confirmations — nothing is replaced now. */
  function openAsNewDoc(model) {
    saveLocal();                 // flush the outgoing diagram before switching away
    state.model = model;
    addDoc(model);
    adoptLoadedModel();
    renderLibrary();
  }

  function newDiagram() {
    openAsNewDoc(E.emptyModel());
    closeLibrary();
    setStatus('New diagram');
  }

  function switchDoc(id) {
    closeLibrary();
    if (id === state.docId) return;
    var model = loadDoc(id);
    if (!model) { toast('That diagram could not be read', 'error'); return; }
    saveLocal();
    state.docId = id;
    state.model = model;
    adoptLoadedModel();
    renderLibrary();
    setStatus('Opened “' + (model.title || 'Untitled diagram') + '”');
  }

  function duplicateDoc(id) {
    // The open diagram is duplicated from memory, not from storage: an edit
    // made since the last save is on screen and has to be in the copy.
    var model = id === state.docId ? E.clone(state.model) : loadDoc(id);
    if (!model) { toast('That diagram could not be read', 'error'); return; }
    model.title = copyTitle(model.title);
    openAsNewDoc(model);
    closeLibrary();
    setStatus('Duplicated');
  }

  function deleteDoc(id) {
    var entry = docEntry(id);
    if (!entry) return;
    if (!global.confirm('Delete “' + (entry.title || 'Untitled diagram') +
                        '”? This cannot be undone.')) return;

    removeStore(docKey(id));
    state.docs = state.docs.filter(function (d) { return d.id !== id; });

    if (id === state.docId) {
      // The open one went. Fall through to the next most recent, or a blank
      // canvas — the editor must never be left without an active entry.
      var next = state.docs.slice().sort(byRecent)[0];
      var model = next ? loadDoc(next.id) : null;
      if (model) {
        state.docId = next.id;
        state.model = model;
      } else {
        state.docId = '';
        state.model = E.emptyModel();
        addDoc(state.model);
      }
      adoptLoadedModel();
    }

    writeIndex();
    renderLibrary();
    toast('Deleted “' + (entry.title || 'Untitled diagram') + '”');
  }

  // ------------------------------------------------------- library menu

  function relativeTime(ts) {
    if (!ts) return '';
    var mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hours = Math.round(mins / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.round(hours / 24);
    if (days < 7) return days + 'd ago';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  var DUPLICATE_PATH = 'M9.5 8.5h9.5v11h-9.5zM5 15.5V4.5h11';
  var TRASH_PATH = 'M4.5 7h15M9.5 7V4.8h5V7M6.8 7l.9 12.2h8.6L17.2 7';

  function docAction(label, path, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dg-doc-action';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    var svg = document.createElementNS(E.SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(E.SVG_NS, 'path');
    p.setAttribute('d', path);
    svg.appendChild(p);
    btn.appendChild(svg);
    btn.addEventListener('click', onClick);
    return btn;
  }

  /* The count on the button is always live; the list itself is only rebuilt
   * while the menu is open, because `saveLocal()` calls this on every commit
   * and on every keystroke in the title field. */
  function renderLibrary() {
    if (!dom.docsCount) return;
    dom.docsCount.textContent = String(state.docs.length);
    if (!dom.docsMenu || dom.docsMenu.hidden) return;

    dom.docsList.textContent = '';
    state.docs.slice().sort(byRecent).forEach(function (entry) {
      var li = document.createElement('li');
      li.className = 'dg-doc' + (entry.id === state.docId ? ' is-active' : '');

      var open = document.createElement('button');
      open.type = 'button';
      open.className = 'dg-doc-open';
      open.setAttribute('role', 'menuitem');
      if (entry.id === state.docId) open.setAttribute('aria-current', 'true');
      var name = document.createElement('b');
      name.textContent = entry.title || 'Untitled diagram';
      var when = document.createElement('span');
      when.textContent = relativeTime(entry.updated);
      open.appendChild(name);
      open.appendChild(when);
      open.addEventListener('click', function () { switchDoc(entry.id); });

      li.appendChild(open);
      li.appendChild(docAction('Duplicate', DUPLICATE_PATH, function () { duplicateDoc(entry.id); }));
      li.appendChild(docAction('Delete', TRASH_PATH, function () { deleteDoc(entry.id); }));
      dom.docsList.appendChild(li);
    });
  }

  function libraryOpen() { return dom.docsMenu && !dom.docsMenu.hidden; }

  function openLibrary() {
    dom.docsMenu.hidden = false;
    dom.docsBtn.setAttribute('aria-expanded', 'true');
    renderLibrary();
  }

  function closeLibrary() {
    if (!dom.docsMenu) return;
    dom.docsMenu.hidden = true;
    dom.docsBtn.setAttribute('aria-expanded', 'false');
  }

  // ---------------------------------------------------------------- palette

  // ------------------------------------------------------- custom icons

  /* Icon sets we are not allowed to redistribute — Azure's above all, whose
   * terms permit drawing with the icons but not shipping the set — can still
   * be used here: the user brings their own SVGs and they never leave this
   * browser. IndexedDB rather than localStorage because a vendor icon pack is
   * hundreds of files and would blow the 5 MB string quota.
   */
  var CUSTOM_DB = 'dg-custom-icons';
  var CUSTOM_STORE = 'icons';

  function withCustomStore(mode, run) {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { resolve(null); return; }
      var open = indexedDB.open(CUSTOM_DB, 1);
      open.onupgradeneeded = function () {
        open.result.createObjectStore(CUSTOM_STORE, { keyPath: 'key' });
      };
      open.onerror = function () { reject(open.error); };
      open.onsuccess = function () {
        var db = open.result;
        var tx = db.transaction(CUSTOM_STORE, mode);
        var out = run(tx.objectStore(CUSTOM_STORE));
        tx.oncomplete = function () { db.close(); resolve(out && out.result); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      };
    });
  }

  function loadCustomIcons() {
    return withCustomStore('readonly', function (store) { return store.getAll(); })
      .then(function (rows) { return E.Icons.setCustom(rows || []); })
      .catch(function () { return []; });
  }

  /* Everything below treats the file as hostile. It is the user's own SVG, but
   * "the user's own" includes one they were handed, and the body is inlined
   * into this document rather than sandboxed in an <img>. */
  var SVG_ELEMENTS = {
    svg: 1, g: 1, path: 1, circle: 1, ellipse: 1, rect: 1, line: 1,
    polyline: 1, polygon: 1, defs: 1, lineargradient: 1, radialgradient: 1,
    stop: 1, clippath: 1, mask: 1, pattern: 1, use: 1, symbol: 1,
    text: 1, tspan: 1, title: 1, desc: 1, style: 1
  };

  function sanitiseNode(node, key) {
    var kids = [].slice.call(node.children || []);
    kids.forEach(function (child) {
      if (!SVG_ELEMENTS[child.tagName.toLowerCase()]) { child.remove(); return; }
      sanitiseNode(child, key);
    });
    [].slice.call(node.attributes || []).forEach(function (attr) {
      var name = attr.name.toLowerCase();
      var value = attr.value;
      // Event handlers, and anything pointing outside this document.
      if (name.indexOf('on') === 0) { node.removeAttribute(attr.name); return; }
      if (/^(href|xlink:href|src)$/.test(name) && value.trim().charAt(0) !== '#') {
        node.removeAttribute(attr.name);
        return;
      }
      if (/javascript:|data:text\/html/i.test(value)) node.removeAttribute(attr.name);
    });
    if (node.tagName.toLowerCase() === 'style') {
      // Keep class-based fills working, drop anything that can fetch.
      node.textContent = String(node.textContent)
        .replace(/@import[^;]*;?/gi, '')
        .replace(/url\((?!\s*['"]?#)[^)]*\)/gi, 'none');
    }
    // Same collision problem the build script solves: many icons inlined into
    // one document must not share gradient or clip-path ids.
    var id = node.getAttribute && node.getAttribute('id');
    if (id) node.setAttribute('id', key + '-' + id);
  }

  function rewriteIdRefs(markup, key) {
    return markup
      .replace(/url\(\s*['"]?#([^)'"]+)['"]?\s*\)/g,
        function (_, id) { return 'url(#' + key + '-' + id + ')'; })
      .replace(/(\b(?:xlink:href|href)\s*=\s*")#([^"]+)"/g,
        function (_, attr, id) { return attr + '#' + key + '-' + id + '"'; });
  }

  function parseSvgFile(text, key) {
    var doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    var svg = doc.documentElement;
    if (!svg || svg.tagName.toLowerCase() !== 'svg' ||
        doc.getElementsByTagName('parsererror').length) {
      return null;
    }
    sanitiseNode(svg, key);
    var viewBox = svg.getAttribute('viewBox');
    if (!viewBox) {
      var w = parseFloat(svg.getAttribute('width')) || 24;
      var h = parseFloat(svg.getAttribute('height')) || 24;
      viewBox = '0 0 ' + w + ' ' + h;
    }
    var body = rewriteIdRefs(svg.innerHTML, key).trim();
    return body ? { viewBox: viewBox, body: body } : null;
  }

  function iconKeyFor(filename) {
    var slug = filename.replace(/\.svg$/i, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    return 'custom:' + (slug || 'icon');
  }

  function iconNameFor(filename) {
    // Vendor packs ship names like "10021-icon-service-Kubernetes-Services.svg";
    // drop the leading catalogue number and the redundant "icon service" noise.
    return filename.replace(/\.svg$/i, '')
      .replace(/^\d+[-_\s]*/, '')
      .replace(/^icon[-_\s]*service[-_\s]*/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Icon';
  }

  function importSvgFiles(files) {
    var list = [].slice.call(files).filter(function (f) { return /\.svg$/i.test(f.name); });
    if (!list.length) { toast('No .svg files in that selection', 'error'); return; }

    return Promise.all(list.map(function (file) {
      return file.text().then(function (text) {
        var key = iconKeyFor(file.name);
        var parsed = parseSvgFile(text, key);
        if (!parsed) return null;
        return { key: key, name: iconNameFor(file.name),
                 viewBox: parsed.viewBox, body: parsed.body };
      }).catch(function () { return null; });
    })).then(function (rows) {
      var good = rows.filter(Boolean);
      if (!good.length) { toast('Could not read any of those SVGs', 'error'); return; }
      return withCustomStore('readwrite', function (store) {
        good.forEach(function (row) { store.put(row); });
      }).then(loadCustomIcons).then(function () {
        var skipped = list.length - good.length;
        toast('Imported ' + good.length + ' icon' + (good.length === 1 ? '' : 's') +
              (skipped ? ' — ' + skipped + ' skipped' : ''));
        paletteRepaint();
        scheduleRender();
      });
    });
  }

  function removeCustomIcon(icon) {
    var inUse = state.model.nodes.filter(function (n) { return n.icon === icon.key; }).length;
    // Deleting an icon the current diagram uses is allowed, but it turns those
    // nodes into placeholders, so say so before rather than after.
    var warning = inUse
      ? '\n\n' + inUse + (inUse === 1 ? ' node in this diagram uses' : ' nodes in this diagram use') +
        ' it and will show a placeholder.'
      : '';
    if (!confirm('Remove “' + icon.name + '” from your imported icons?' + warning)) return;
    withCustomStore('readwrite', function (store) { store.delete(icon.key); })
      .then(loadCustomIcons)
      .then(function () {
        toast('Removed ' + icon.name);
        paletteRepaint();
        scheduleRender();
      });
  }

  function clearCustomIcons() {
    if (!confirm('Remove every imported icon? Diagrams using them will show placeholders.')) return;
    withCustomStore('readwrite', function (store) { store.clear(); })
      .then(loadCustomIcons)
      .then(function () {
        toast('Imported icons removed');
        paletteRepaint();
        scheduleRender();
      });
  }

  function buildPalette() {
    var groups = E.Icons.groups();
    var activeTab = groups[0].id;
    var query = '';

    groups.forEach(function (g) {
      var tab = document.createElement('button');
      tab.className = 'dg-tab';
      tab.type = 'button';
      tab.textContent = g.label;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(g.id === activeTab));
      tab.addEventListener('click', function () {
        activeTab = g.id;
        dom.tabs.querySelectorAll('.dg-tab').forEach(function (t) {
          t.setAttribute('aria-selected', String(t === tab));
        });
        paint();
        // A group's path data arrives on first view. paint() has already drawn
        // the tiles as placeholders, so this only fills them in.
        ensureGroups(g.id).then(repaintIfActive(g.id));
      });
      dom.tabs.appendChild(tab);
    });

    function matches(icon) {
      if (!query) return true;
      return (icon.name + ' ' + icon.key + ' ' + icon.category).toLowerCase().indexOf(query) >= 0;
    }

    function customActions() {
      var wrap = document.createElement('div');
      wrap.className = 'dg-custom-actions';

      var note = document.createElement('p');
      note.textContent = 'Bring your own SVGs — a vendor pack such as Azure’s, ' +
        'or your team’s internal marks. They are stored in this browser and ' +
        'never uploaded.';
      wrap.appendChild(note);

      var row = document.createElement('div');
      row.className = 'dg-row';

      var add = document.createElement('button');
      add.type = 'button';
      add.className = 'dg-btn dg-btn--primary';
      add.textContent = 'Import SVG…';
      add.addEventListener('click', function () { dom.customFile.click(); });
      row.appendChild(add);

      if (E.Icons.customIcons().length) {
        var clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'dg-btn dg-btn--danger';
        clear.textContent = 'Remove all';
        clear.addEventListener('click', clearCustomIcons);
        row.appendChild(clear);
      }

      wrap.appendChild(row);
      return wrap;
    }

    function paint() {
      var host = dom.palette;
      host.textContent = '';

      var group = groups.filter(function (g) { return g.id === activeTab; })[0];
      if (!query && group && group.custom) host.appendChild(customActions());

      // A search spans every group; browsing stays inside the active tab.
      var pool = query ? E.Icons.all().filter(matches) : group.icons.slice();

      if (!pool.length) {
        var empty = document.createElement('p');
        empty.className = 'dg-empty';
        empty.textContent = query
          ? 'No icon matches “' + query + '”.'
          : 'Nothing imported yet.';
        host.appendChild(empty);
        return;
      }

      var order = [];
      var buckets = Object.create(null);
      pool.forEach(function (icon) {
        var key = query ? groupLabel(icon.group) : icon.category;
        if (!buckets[key]) { buckets[key] = []; order.push(key); }
        buckets[key].push(icon);
      });

      order.forEach(function (name) {
        var head = document.createElement('p');
        head.className = 'dg-cat';
        head.textContent = name;
        host.appendChild(head);

        var grid = document.createElement('div');
        grid.className = 'dg-grid';
        buckets[name].forEach(function (icon) { grid.appendChild(paletteItem(icon)); });
        host.appendChild(grid);
      });

      // Every repaint rebuilds the tiles, so the single tab stop has to be
      // re-declared or the palette drops out of the tab order entirely.
      var tiles = host.querySelectorAll('.dg-item');
      if (tiles.length) tiles[0].tabIndex = 0;
    }

    function groupLabel(id) {
      for (var i = 0; i < groups.length; i++) if (groups[i].id === id) return groups[i].label;
      return id;
    }

    function repaintIfActive(id) {
      // Ignore a chunk that lands after the user has moved on — repainting
      // then would throw away whatever they are looking at now.
      return function () { if (query || activeTab === id) paint(); };
    }

    dom.search.addEventListener('input', function () {
      query = dom.search.value.trim().toLowerCase();
      paint();
      // Searching spans every group, so it is the one action that needs all
      // of them. Once, on the first keystroke; afterwards they are cached.
      if (query) ensureGroups().then(function () { if (query) paint(); });
    });
    dom.search.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { dom.search.value = ''; query = ''; paint(); }
    });

    paint();
    ensureGroups(activeTab).then(repaintIfActive(activeTab));
    buildCredits(groups);
    paletteRepaint = paint;
  }

  // Lets a custom-icon import refresh the palette without rebuilding its tabs.
  var paletteRepaint = function () {};

  function paletteTiles() {
    return Array.prototype.slice.call(dom.palette.querySelectorAll('.dg-item'));
  }

  /** Exactly one tile is tabbable at a time; this is the one. */
  function setRovingTile(tile) {
    paletteTiles().forEach(function (t) { t.tabIndex = t === tile ? 0 : -1; });
  }

  /* Grid movement. The columns are laid out by CSS, so the row width is read
   * back off the rendered positions rather than assumed — a hard-coded count
   * would be wrong the moment the panel is resized. */
  function movePaletteFocus(ev, tile) {
    var keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (keys.indexOf(ev.key) < 0) return;
    var tiles = paletteTiles();
    var at = tiles.indexOf(tile);
    if (at < 0) return;
    ev.preventDefault();

    var perRow = 1;
    var top = tile.getBoundingClientRect().top;
    for (var i = at + 1; i < tiles.length; i++) {
      if (tiles[i].getBoundingClientRect().top !== top) break;
      perRow++;
    }
    for (var j = at - 1; j >= 0; j--) {
      if (tiles[j].getBoundingClientRect().top !== top) break;
      perRow++;
    }

    var next = at;
    if (ev.key === 'ArrowRight') next = at + 1;
    else if (ev.key === 'ArrowLeft') next = at - 1;
    else if (ev.key === 'ArrowDown') next = at + perRow;
    else if (ev.key === 'ArrowUp') next = at - perRow;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = tiles.length - 1;

    next = clamp(next, 0, tiles.length - 1);
    if (next === at) return;
    setRovingTile(tiles[next]);
    tiles[next].focus();
  }

  /* Loading a chunk can fill in nodes already sitting on the canvas — dropped
   * while it was still in flight, or restored from a saved diagram — so every
   * load schedules a repaint of the canvas as well as the palette. */
  function ensureGroups(ids) {
    return E.Icons.ensure(ids).then(function (result) {
      scheduleRender();
      return result;
    });
  }

  function paletteItem(icon) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dg-item' + (icon.mono ? ' dg-item--mono' : '');
    btn.title = icon.name;
    btn.setAttribute('aria-label', 'Add ' + icon.name);

    var svg = document.createElementNS(E.SVG_NS, 'svg');
    svg.setAttribute('viewBox', icon.viewBox);
    svg.setAttribute('aria-hidden', 'true');
    // The tile exists before its chunk does; keep the layout and the caption
    // so the grid does not reflow when the paths arrive.
    if (icon.body == null) btn.classList.add('is-loading');
    else svg.innerHTML = icon.body;
    btn.appendChild(svg);

    var caption = document.createElement('span');
    caption.textContent = icon.name;
    btn.appendChild(caption);

    /* Roving tabindex. Every tile used to be its own tab stop, which put 271
     * of them between the page and the canvas — reachable in principle and
     * unreachable in practice. The palette is one stop now, and the arrow keys
     * move inside it; `paint()` marks exactly one tile `0`. */
    btn.tabIndex = -1;
    btn.addEventListener('pointerdown', function (ev) { startPaletteDrag(ev, icon); });
    btn.addEventListener('focus', function () { setRovingTile(btn); });
    btn.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        addIconAtCenter(icon);
        return;
      }
      movePaletteFocus(ev, btn);
    });
    if (icon.group !== 'custom') return btn;

    /* Imported icons get a remove control. A button cannot contain another
     * button, so it is a sibling inside a positioned wrapper rather than
     * nested in the tile — which also keeps it off the drag path, since the
     * pointer lands on the control, not the tile underneath. */
    var wrap = document.createElement('div');
    wrap.className = 'dg-item-wrap';
    wrap.appendChild(btn);

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'dg-item-remove';
    remove.textContent = '×';
    remove.title = 'Remove ' + icon.name;
    remove.setAttribute('aria-label', 'Remove ' + icon.name);
    remove.addEventListener('click', function () { removeCustomIcon(icon); });
    wrap.appendChild(remove);
    return wrap;
  }

  /* Attribution is a licence condition for the Kubernetes set and simple
   * courtesy for the CC0 ones — it is not decoration, do not drop it. A group
   * may cite more than one upstream set, and two groups may cite the same one,
   * so this flattens and de-duplicates by text. */
  function buildCredits(groups) {
    var seen = [];
    groups.forEach(function (g) {
      (g.credits || []).forEach(function (credit) {
        if (!credit.text || seen.indexOf(credit.text) >= 0) return;
        seen.push(credit.text);
        var p = document.createElement('p');
        p.style.margin = '0 0 3px';
        if (credit.url) {
          var a = document.createElement('a');
          a.href = credit.url;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = credit.text;
          p.appendChild(a);
        } else {
          p.textContent = credit.text;
        }
        dom.credit.appendChild(p);
      });
    });
  }

  // ---------------------------------------------------------------- adding nodes

  function viewportCenter() {
    var r = dom.canvas.getBoundingClientRect();
    return toModel(r.left + r.width / 2, r.top + r.height / 2);
  }

  function addIconAtCenter(icon) {
    // Tapping a tile on mobile happens with the palette covering the canvas;
    // get out of the way so the result is actually visible.
    closePanels();
    var c = viewportCenter();
    addIcon(icon, c.x - 32, c.y - 32);
  }

  /* Every add ends the same way — file the node, select it, name the undo step.
   * `front` is false for groups: array order is z-order and a boundary box has
   * to paint behind whatever it wraps. */
  function placeNode(node, label, front) {
    if (front === false) state.model.nodes.unshift(node);
    else state.model.nodes.push(node);
    select([node.id]);
    commit(label);
    return node;
  }

  function addIcon(icon, x, y) {
    return placeNode(E.makeNode('icon', {
      icon: icon.key,
      label: icon.name,
      x: snap(x), y: snap(y)
    }), 'Added ' + icon.name);
  }

  /* Boundary boxes are almost always one of a handful of cloud constructs, so
   * the preset sets label + colour + fill in one step. */
  var GROUP_PRESETS = [
    { key: 'group',     label: 'Group',              color: '#2563eb', alpha: 0.06 },
    { key: 'vpc',       label: 'VPC',                color: '#2563eb', alpha: 0.05 },
    { key: 'public',    label: 'Public subnet',      color: '#16a34a', alpha: 0.05 },
    { key: 'private',   label: 'Private subnet',     color: '#7c3aed', alpha: 0.05 },
    { key: 'az',        label: 'Availability Zone',  color: '#0891b2', alpha: 0.04 },
    { key: 'region',    label: 'Region',             color: '#64748b', alpha: 0.04 },
    { key: 'account',   label: 'AWS Account',        color: '#ea580c', alpha: 0.04 },
    { key: 'cluster',   label: 'Kubernetes Cluster', color: '#326ce5', alpha: 0.05 },
    { key: 'namespace', label: 'Namespace',          color: '#db2777', alpha: 0.05 },
    { key: 'sg',        label: 'Security Group',     color: '#dc2626', alpha: 0.04 },
    { key: 'onprem',    label: 'On-premise',         color: '#334155', alpha: 0.04 }
  ];

  function addGroup() {
    var chosen = selectedNodes().filter(function (n) { return n.type !== 'group'; });
    var box;
    if (chosen.length) {
      // Wrapping the current selection is the common case for VPC / cluster boxes.
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      chosen.forEach(function (n) {
        var b = E.nodeBounds(n);
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
      });
      box = { x: minX - 30, y: minY - 42, w: (maxX - minX) + 60, h: (maxY - minY) + 72 };
    } else {
      var c = viewportCenter();
      box = { x: snap(c.x - 160), y: snap(c.y - 110), w: 320, h: 220 };
    }
    placeNode(E.makeNode('group', {
      x: snap(box.x), y: snap(box.y),
      w: Math.max(120, snap(box.w)), h: Math.max(90, snap(box.h))
    }), 'Added group', false);
  }

  function applyGroupPreset(node, preset) {
    node.label = preset.label;
    node.color = preset.color;
    node.fill = rgba(preset.color, preset.alpha);
  }

  function addText() {
    closePanels();
    var c = viewportCenter();
    placeNode(E.makeNode('text', {
      x: snap(c.x - 60), y: snap(c.y - 10), label: 'Label'
    }), 'Added text');
  }

  function addNote() {
    closePanels();
    var c = viewportCenter();
    placeNode(E.makeNode('note', {
      x: snap(c.x - 90), y: snap(c.y - 45),
      label: 'Double-click to edit this note.'
    }), 'Added note');
  }

  // ---------------------------------------------------------------- selection

  function select(ids, additive) {
    if (!additive) state.selection = [];
    state.selectedEdge = null;
    (ids || []).forEach(function (id) {
      if (state.selection.indexOf(id) < 0) state.selection.push(id);
    });
    scheduleRender();
    renderInspector();
  }

  /* ------------------------------------------------------- keyboard access
   *
   * Nothing here was reachable without a mouse. The canvas took no focus and
   * held no focusable children, so Tab walked straight past it: `T` and `N`
   * could add a node, and from that moment on it could not be selected, moved,
   * deleted, connected or inspected. Everything below exists to close that.
   *
   * Traversal is in reading order rather than z-order. Array order is z-order
   * and means something to the renderer, but "the next one down the page" is
   * what someone stepping through a diagram is actually asking for. */
  function selectableOrder() {
    return state.model.nodes.slice().sort(function (a, b) {
      return (a.y - b.y) || (a.x - b.x);
    }).map(function (n) { return n.id; });
  }

  function canvasHasFocus() {
    return document.activeElement === dom.canvas;
  }

  /* Keyboard selection is useless if it lands on something off-screen. Pans by
   * the smallest amount that brings the node inside the viewport rather than
   * centring it: re-centring on every Tab makes a diagram impossible to follow. */
  function revealNode(node) {
    if (!node) return;
    var r = dom.canvas.getBoundingClientRect();
    var k = state.view.k, pad = 48;
    var left = state.view.x + node.x * k;
    var top = state.view.y + node.y * k;
    var right = left + node.w * k;
    var bottom = top + node.h * k;
    var dx = 0, dy = 0;
    if (left < pad) dx = pad - left;
    else if (right > r.width - pad) dx = Math.max(pad - left, (r.width - pad) - right);
    if (top < pad) dy = pad - top;
    else if (bottom > r.height - pad) dy = Math.max(pad - top, (r.height - pad) - bottom);
    if (!dx && !dy) return;
    state.view.x += dx;
    state.view.y += dy;
    applyView();
  }

  /* The status pill is `aria-live`, so naming the selection there is what makes
   * the move audible. `describeNode` is the same text the node's `<title>`
   * carries, so the two can never describe it differently. */
  function selectAndReveal(id, position, total) {
    select([id]);
    var node = byId(id);
    revealNode(node);
    if (node) setStatus(E.describeNode(node) + ' — ' + position + ' of ' + total);
  }

  function stepSelection(back) {
    var order = selectableOrder();
    if (!order.length) return false;
    var current = state.selection.length
      ? order.indexOf(state.selection[state.selection.length - 1]) : -1;
    var next = current < 0 ? (back ? order.length - 1 : 0) : current + (back ? -1 : 1);
    // Off either end, the selection is dropped and the key is left alone, so
    // focus leaves the canvas the way Tab normally would. A canvas that never
    // gives Tab back is a trap, whatever else it gets right.
    if (next < 0 || next >= order.length) { select([]); return false; }
    selectAndReveal(order[next], next + 1, order.length);
    return true;
  }

  function selectEdge(id) {
    state.selection = [];
    state.selectedEdge = id;
    scheduleRender();
    renderInspector();
  }

  function deleteSelection() {
    var ids = state.selection.slice();
    if (state.selectedEdge) {
      state.model.edges = state.model.edges.filter(function (e) { return e.id !== state.selectedEdge; });
      state.selectedEdge = null;
      commit('Deleted connection');
      renderInspector();
      return;
    }
    if (!ids.length) return;
    state.model.nodes = state.model.nodes.filter(function (n) { return ids.indexOf(n.id) < 0; });
    state.model.edges = state.model.edges.filter(function (e) {
      return ids.indexOf(e.from) < 0 && ids.indexOf(e.to) < 0;
    });
    state.selection = [];
    commit(ids.length > 1 ? 'Deleted ' + ids.length + ' items' : 'Deleted');
    renderInspector();
  }

  function duplicateSelection() {
    var chosen = selectedNodes();
    if (!chosen.length) return;
    var map = Object.create(null);
    var copies = chosen.map(function (n) {
      var copy = E.clone(n);
      copy.id = E.nextId(n.type);
      copy.x += 24; copy.y += 24;
      map[n.id] = copy.id;
      return copy;
    });
    copies.forEach(function (c) {
      if (c.type === 'group') state.model.nodes.unshift(c);
      else state.model.nodes.push(c);
    });
    // Carry over any edge whose two ends were both duplicated.
    state.model.edges.slice().forEach(function (e) {
      if (map[e.from] && map[e.to]) {
        var copy = E.clone(e);
        copy.id = E.nextId('edge');
        copy.from = map[e.from];
        copy.to = map[e.to];
        state.model.edges.push(copy);
      }
    });
    select(copies.map(function (c) { return c.id; }));
    commit('Duplicated');
  }

  function nudge(dx, dy) {
    var chosen = selectedNodes();
    if (!chosen.length) return;
    chosen.forEach(function (n) { n.x += dx; n.y += dy; });
    commit();
  }

  // ---------------------------------------------------------------- view

  function applyView() {
    // The inline editor is positioned in screen pixels, so any pan or zoom
    // would leave it stranded away from the text it is editing. Commit first.
    if (state.labelEdit) endLabelEdit(false);
    dom.viewport.setAttribute('transform',
      'translate(' + fmt(state.view.x) + ' ' + fmt(state.view.y) + ') scale(' + fmt(state.view.k) + ')');
    dom.gridPattern.setAttribute('patternTransform',
      'translate(' + fmt(state.view.x) + ' ' + fmt(state.view.y) + ') scale(' + fmt(state.view.k) + ')');
    dom.zoomLevel.textContent = Math.round(state.view.k * 100) + '%';
  }

  function zoomAt(clientX, clientY, factor) {
    var r = dom.canvas.getBoundingClientRect();
    var px = clientX - r.left, py = clientY - r.top;
    var k1 = clamp(state.view.k * factor, MIN_ZOOM, MAX_ZOOM);
    if (k1 === state.view.k) return;
    // Keep the model point under the cursor pinned while the scale changes.
    state.view.x = px - (px - state.view.x) * (k1 / state.view.k);
    state.view.y = py - (py - state.view.y) * (k1 / state.view.k);
    state.view.k = k1;
    applyView();
  }

  function zoomCentered(factor) {
    var r = dom.canvas.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  }

  function fitToContent() {
    var r = dom.canvas.getBoundingClientRect();
    if (!state.model.nodes.length) {
      state.view = { x: 0, y: 0, k: 1 };
      applyView();
      return;
    }
    var box = E.modelBounds(state.model, 60);
    var k = clamp(Math.min(r.width / box.w, r.height / box.h), MIN_ZOOM, 1.6);
    state.view.k = k;
    state.view.x = (r.width - box.w * k) / 2 - box.x * k;
    state.view.y = (r.height - box.h * k) / 2 - box.y * k;
    applyView();
  }

  // ---------------------------------------------------------------- rendering

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      render();
    });
  }

  function render() {
    E.renderContent(dom.content, dom.defs, state.model);
    renderOverlay();
    dom.hint.hidden = state.model.nodes.length > 0;
    dom.undoBtn.disabled = !state.history.canUndo();
    dom.redoBtn.disabled = !state.history.canRedo();
  }

  function renderOverlay() {
    var layer = dom.overlay;
    while (layer.firstChild) layer.removeChild(layer.firstChild);

    // Invisible fat paths give thin connections a usable click target.
    state.model.edges.forEach(function (edge) {
      var from = byId(edge.from), to = byId(edge.to);
      if (!from || !to) return;
      var source = dom.content.querySelector('[data-edge="' + cssEscape(edge.id) + '"]');
      if (!source) return;
      var d = source.getAttribute('d');
      var hitPath = el('path', { d: d, class: 'dg-edge-hit', 'data-edge-hit': edge.id }, layer);
      hitPath.addEventListener('pointerdown', function (ev) {
        ev.stopPropagation();
        selectEdge(edge.id);
      });
      if (state.selectedEdge === edge.id) {
        el('path', { d: d, class: 'dg-edge-selected' }, layer);
      }
    });

    selectedNodes().forEach(function (node) {
      var b = E.nodeBounds(node);
      el('rect', {
        x: fmt(b.x - 4), y: fmt(b.y - 4),
        width: fmt(b.w + 8), height: fmt(b.h + 8),
        rx: 7, class: 'dg-sel-outline'
      }, layer);
      if (node.type !== 'text') addHandles(layer, node);
    });

    // Ports are the only way to draw a connection, so on the selected node they
    // are shown outright — behind a hover they were effectively undiscoverable.
    var selectedOne = state.selection.length === 1 ? byId(state.selection[0]) : null;
    if (selectedOne && selectedOne.type !== 'text') addPorts(layer, selectedOne, true);
    else if (state.hoverNode && state.hoverNode.type !== 'text') addPorts(layer, state.hoverNode, false);

    if (state.drag && state.drag.kind === 'marquee' && state.drag.rect) {
      var m = state.drag.rect;
      el('rect', {
        x: fmt(m.x), y: fmt(m.y), width: fmt(m.w), height: fmt(m.h), class: 'dg-marquee'
      }, layer);
    }

    if (state.drag && state.drag.kind === 'link' && state.drag.current) {
      var a = E.sidePoint(state.drag.node, state.drag.side);
      var b2 = state.drag.current;
      el('path', {
        d: 'M' + fmt(a.x) + ' ' + fmt(a.y) + 'L' + fmt(b2.x) + ' ' + fmt(b2.y),
        class: 'dg-linking'
      }, layer);
      if (state.drag.target) {
        var tb = E.nodeBounds(state.drag.target);
        el('rect', {
          x: fmt(tb.x - 5), y: fmt(tb.y - 5),
          width: fmt(tb.w + 10), height: fmt(tb.h + 10),
          rx: 8, class: 'dg-drop-target'
        }, layer);
      }
    }

    if (state.drag && state.drag.kind === 'palette' && state.drag.preview) {
      var p = state.drag.preview;
      el('rect', {
        x: fmt(p.x), y: fmt(p.y), width: 64, height: 64, rx: 8, class: 'dg-drop-target'
      }, layer);
    }
  }

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
  }

  var HANDLE_DIRS = [
    ['nw', 0, 0], ['ne', 1, 0], ['se', 1, 1], ['sw', 0, 1]
  ];

  /* A finger is not a cursor: grab areas sized for a mouse are missed by a
   * thumb. Both the ports and the resize handles grow their *hit* area on a
   * coarse pointer while the visible dot stays put — the drawn size is about
   * how the canvas looks, not about whether it can be hit.
   *
   * The ports get the full 44px the rest of the page is held to; they are the
   * only way to draw a connection and deserve it. The handles settle for 26,
   * because a corner and the side port next to it are only half a node apart
   * and two 44px discs there would fight over every tap. */
  var COARSE = !!(global.matchMedia && global.matchMedia('(pointer: coarse)').matches);

  function addHandles(layer, node) {
    var size = 8 / state.view.k;
    var hit = (COARSE ? 26 : 8) / state.view.k;
    HANDLE_DIRS.forEach(function (dir) {
      var hx = node.x + node.w * dir[1];
      var hy = node.y + node.h * dir[2];
      function grab(ev) {
        ev.stopPropagation();
        beginResize(ev, node, dir[0]);
      }
      if (hit > size) {
        el('rect', {
          x: fmt(hx - hit / 2), y: fmt(hy - hit / 2),
          width: fmt(hit), height: fmt(hit), class: 'dg-handle-hit'
        }, layer).addEventListener('pointerdown', grab);
      }
      var rect = el('rect', {
        x: fmt(hx - size / 2), y: fmt(hy - size / 2),
        width: fmt(size), height: fmt(size), rx: fmt(size / 4),
        class: 'dg-handle', 'data-dir': dir[0]
      }, layer);
      rect.addEventListener('pointerdown', grab);
    });
  }

  var PORT_SIDES = ['n', 'e', 's', 'w'];

  function addPorts(layer, node, visible) {
    var g = el('g', { class: 'dg-ports' + (visible ? ' is-visible' : '') }, layer);
    var r = 5 / state.view.k;
    PORT_SIDES.forEach(function (side) {
      var p = E.sidePoint(node, side);
      // A generous transparent disc under a small visible dot keeps the
      // grab area usable at any zoom level — 24px across for a cursor, the
      // full 44 for a finger.
      var hit = el('circle', {
        cx: fmt(p.x), cy: fmt(p.y), r: fmt(r * (COARSE ? 4.4 : 2.4)), class: 'dg-port-hit'
      }, g);
      var dot = el('circle', {
        cx: fmt(p.x), cy: fmt(p.y), r: fmt(r), class: 'dg-port'
      }, g);
      function begin(ev) {
        ev.stopPropagation();
        dot.classList.add('is-active');
        beginLink(ev, node, side);
      }
      hit.addEventListener('pointerdown', begin);
      dot.addEventListener('pointerdown', begin);
    });
  }

  function setStatus(text) {
    dom.status.textContent = text || defaultStatus();
    if (text) {
      clearTimeout(setStatus._t);
      setStatus._t = setTimeout(function () { dom.status.textContent = defaultStatus(); }, 1800);
    }
  }

  function defaultStatus() {
    var n = state.model.nodes.length, e = state.model.edges.length;
    return n + ' node' + (n === 1 ? '' : 's') + ' · ' + e + ' connection' + (e === 1 ? '' : 's');
  }

  // ---------------------------------------------------------------- dragging

  /* Drags listen on `window` rather than using setPointerCapture. Capture is
   * silently lost whenever the captured element is re-rendered mid-drag (the
   * palette repaints on every search keystroke), which strands the gesture:
   * the move and up events leak to whatever is underneath and the drop never
   * commits. Window listeners cannot be stranded that way. */
  function bindDrag(onMove, onEnd) {
    function move(ev) { onMove(ev); }
    function end(ev) {
      global.removeEventListener('pointermove', move, true);
      global.removeEventListener('pointerup', end, true);
      global.removeEventListener('pointercancel', end, true);
      onEnd(ev);
    }
    global.addEventListener('pointermove', move, true);
    global.addEventListener('pointerup', end, true);
    global.addEventListener('pointercancel', end, true);
  }

  /* Panning has two entry points that must behave identically — an embed, where
   * every press pans, and the editor's middle / right button and held Space. */
  function startPanDrag(ev) {
    ev.preventDefault();
    dom.stage.dataset.mode = 'panning';
    state.drag = {
      kind: 'pan',
      startX: ev.clientX, startY: ev.clientY,
      originX: state.view.x, originY: state.view.y
    };
    bindDrag(onDragMove, onDragEnd);
  }

  function beginResize(ev, node, dir) {
    state.drag = {
      kind: 'resize', dir: dir, node: node,
      start: toModel(ev.clientX, ev.clientY),
      origin: { x: node.x, y: node.y, w: node.w, h: node.h },
      moved: false
    };
    bindDrag(onDragMove, onDragEnd);
  }

  function beginLink(ev, node, side) {
    dom.stage.dataset.mode = 'connect';
    state.drag = {
      kind: 'link', node: node, side: side,
      current: toModel(ev.clientX, ev.clientY),
      target: null
    };
    bindDrag(onDragMove, onDragEnd);
    scheduleRender();
  }

  function startPaletteDrag(ev, icon) {
    if (ev.button !== 0) return;
    ev.preventDefault();

    var drag = {
      kind: 'palette', icon: icon,
      startX: ev.clientX, startY: ev.clientY,
      moved: false, preview: null
    };
    state.drag = drag;

    bindDrag(function (mv) {
      if (!drag.moved &&
          Math.hypot(mv.clientX - drag.startX, mv.clientY - drag.startY) < 5) return;
      drag.moved = true;
      var r = dom.canvas.getBoundingClientRect();
      var inside = mv.clientX >= r.left && mv.clientX <= r.right &&
                   mv.clientY >= r.top && mv.clientY <= r.bottom;
      if (inside) {
        var p = toModel(mv.clientX, mv.clientY);
        drag.preview = { x: snap(p.x - 32), y: snap(p.y - 32) };
      } else {
        drag.preview = null;
      }
      scheduleRender();
    }, function () {
      state.drag = null;
      if (!drag.moved) addIconAtCenter(icon);
      else if (drag.preview) addIcon(icon, drag.preview.x, drag.preview.y);
      else scheduleRender();
    });
  }

  /** On mobile the panels slide over the canvas and hide the toggle that
   *  opened them, so touching the canvas has to dismiss them too. */
  function closePanels() {
    dom.leftPanel.classList.remove('is-open');
    dom.rightPanel.classList.remove('is-open');
  }

  function panelsOpen() {
    return dom.leftPanel.classList.contains('is-open') ||
           dom.rightPanel.classList.contains('is-open');
  }

  /* ------------------------------------------------------------------ touch
   *
   * Panning was reachable three ways — middle button, right button, space bar —
   * and a touch screen has none of them, so a finger on empty canvas drew a
   * marquee and the diagram never moved at all. The canvas also sets
   * `touch-action: none`, which is what lets a node be dragged without the page
   * scrolling underneath it, but it hands us the browser's pinch as well. Both
   * gestures therefore have to be implemented here.
   *
   * This layer owns touch panning outright rather than borrowing `bindDrag`:
   * fingers arrive and leave independently, and a gesture that changes from one
   * finger to two and back has to survive without the pan being tied to the
   * lifetime of whichever pointer happened to start it. */

  var touches = {};      // live touch pointers, by pointerId
  var pinch = null;      // last two-finger sample while pinching
  var touchPan = null;   // one-finger pan owned by this layer

  function touchList() {
    return Object.keys(touches).map(function (id) { return touches[id]; });
  }

  function pinchSample(pts) {
    return {
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      x: (pts[0].x + pts[1].x) / 2,
      y: (pts[0].y + pts[1].y) / 2
    };
  }

  function startTouchPan() {
    var pts = touchList();
    if (pts.length !== 1) return;
    pinch = null;
    touchPan = {
      startX: pts[0].x, startY: pts[0].y,
      originX: state.view.x, originY: state.view.y
    };
    dom.stage.dataset.mode = 'panning';
  }

  function startPinch() {
    var pts = touchList();
    if (pts.length !== 2) return;
    // Finish whatever the first finger had started rather than abandoning it —
    // `onDragEnd` commits a move that actually moved, so a node does not end up
    // displaced with a stale history baseline behind it.
    if (state.drag) onDragEnd();
    touchPan = null;
    pinch = pinchSample(pts);
    dom.stage.dataset.mode = 'panning';
  }

  function onTouchMove(ev) {
    var pt = touches[ev.pointerId];
    if (!pt) return;
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    var pts = touchList();

    if (pinch && pts.length === 2) {
      var now = pinchSample(pts);
      if (pinch.dist > 0 && now.dist > 0) zoomAt(now.x, now.y, now.dist / pinch.dist);
      // Two fingers pan as well as zoom. Without this the diagram is pinned in
      // place while it scales, which reads as the gesture being half-broken.
      state.view.x += now.x - pinch.x;
      state.view.y += now.y - pinch.y;
      applyView();
      pinch = now;
      return;
    }

    if (touchPan && pts.length === 1) {
      state.view.x = touchPan.originX + (pts[0].x - touchPan.startX);
      state.view.y = touchPan.originY + (pts[0].y - touchPan.startY);
      applyView();
    }
  }

  function onTouchEnd(ev) {
    if (!touches[ev.pointerId]) return;
    delete touches[ev.pointerId];
    var pts = touchList();
    // Lifting one finger out of a pinch must not freeze the canvas: hand the
    // gesture on to a one-finger pan from wherever the survivor is now.
    if (pts.length === 1 && (pinch || touchPan)) { startTouchPan(); return; }
    if (pts.length) return;
    pinch = null;
    touchPan = null;
    dom.stage.dataset.mode = state.spaceDown ? 'pan' : 'select';
  }

  function onCanvasPointerDown(ev) {
    if (panelsOpen()) { closePanels(); return; }

    /* So the keyboard picks up where the mouse left off: select a node with a
     * click and Tab / Enter / the arrows work on it immediately. Styled through
     * `:focus-visible`, so this does not paint a ring around every click. */
    if (document.activeElement !== dom.canvas) dom.canvas.focus({ preventScroll: true });

    if (ev.pointerType === 'touch') {
      touches[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      if (touchList().length >= 2) { ev.preventDefault(); startPinch(); return; }
    }

    /* An embed is a picture you can move around, not an editor. Every press
     * pans, wherever it lands — including on a node, which must not be
     * draggable when there is nowhere to save the result to. */
    if (EMBED) {
      if (ev.pointerType === 'touch') { startTouchPan(); return; }
      startPanDrag(ev);
      return;
    }

    if (ev.button === 1 || ev.button === 2 || state.spaceDown) {
      startPanDrag(ev);
      return;
    }
    if (ev.button !== 0) return;

    var p = toModel(ev.clientX, ev.clientY);
    var node = E.nodeAt(state.model, p.x, p.y);

    if (!node) {
      if (!ev.shiftKey) select([]);
      /* Touch gets a pan here, not a rubber band. There is no modifier to
       * choose between the two, and a marquee is the less useful of them on a
       * screen you cannot see around your own hand. */
      if (ev.pointerType === 'touch') { startTouchPan(); return; }
      state.drag = { kind: 'marquee', start: p, rect: null, additive: ev.shiftKey };
      bindDrag(onDragMove, onDragEnd);
      return;
    }

    if (ev.shiftKey) {
      var at = state.selection.indexOf(node.id);
      if (at >= 0) state.selection.splice(at, 1);
      else state.selection.push(node.id);
      state.selectedEdge = null;
      renderInspector();
    } else if (state.selection.indexOf(node.id) < 0) {
      select([node.id]);
    }

    var chosen = selectedNodes();
    state.drag = {
      kind: 'move',
      start: p,
      moved: false,
      free: ev.altKey,
      items: chosen.map(function (n) { return { node: n, x: n.x, y: n.y }; })
    };
    bindDrag(onDragMove, onDragEnd);
    scheduleRender();
  }

  /** Hover feedback only — every active drag is handled by onDragMove. */
  function onCanvasHover(ev) {
    if (state.drag) return;
    var p = toModel(ev.clientX, ev.clientY);
    var hovered = E.nodeAt(state.model, p.x, p.y);
    if (hovered !== state.hoverNode) {
      state.hoverNode = hovered;
      if (!state.selection.length) scheduleRender();
    }
  }

  function onDragMove(ev) {
    var drag = state.drag;
    if (!drag) return;

    if (drag.kind === 'palette') return;  // its own handler owns the preview

    if (drag.kind === 'pan') {
      state.view.x = drag.originX + (ev.clientX - drag.startX);
      state.view.y = drag.originY + (ev.clientY - drag.startY);
      applyView();
      return;
    }

    var p = toModel(ev.clientX, ev.clientY);

    if (drag.kind === 'move') {
      var dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) * state.view.k < 3) return;
      drag.moved = true;
      drag.items.forEach(function (item) {
        item.node.x = drag.free ? item.x + dx : snap(item.x + dx);
        item.node.y = drag.free ? item.y + dy : snap(item.y + dy);
      });
      scheduleRender();
      return;
    }

    if (drag.kind === 'resize') {
      var o = drag.origin;
      var ddx = p.x - drag.start.x, ddy = p.y - drag.start.y;
      var minW = drag.node.type === 'group' ? 90 : 24;
      var minH = drag.node.type === 'group' ? 70 : 24;
      var next = { x: o.x, y: o.y, w: o.w, h: o.h };

      if (drag.dir.indexOf('e') >= 0) next.w = o.w + ddx;
      if (drag.dir.indexOf('s') >= 0) next.h = o.h + ddy;
      if (drag.dir.indexOf('w') >= 0) { next.x = o.x + ddx; next.w = o.w - ddx; }
      if (drag.dir.indexOf('n') >= 0) { next.y = o.y + ddy; next.h = o.h - ddy; }

      if (drag.node.type === 'icon') {
        // Icons stay square so the glyph never distorts.
        var side = Math.max(minW, snap(Math.max(next.w, next.h)));
        if (drag.dir.indexOf('w') >= 0) next.x = o.x + o.w - side;
        if (drag.dir.indexOf('n') >= 0) next.y = o.y + o.h - side;
        next.w = next.h = side;
      } else {
        next.w = Math.max(minW, snap(next.w));
        next.h = Math.max(minH, snap(next.h));
        if (drag.dir.indexOf('w') >= 0) next.x = snap(o.x + o.w - next.w);
        if (drag.dir.indexOf('n') >= 0) next.y = snap(o.y + o.h - next.h);
      }

      drag.node.x = next.x; drag.node.y = next.y;
      drag.node.w = next.w; drag.node.h = next.h;
      drag.moved = true;
      scheduleRender();
      return;
    }

    if (drag.kind === 'link') {
      drag.current = p;
      var over = E.nodeAt(state.model, p.x, p.y);
      drag.target = over && over.id !== drag.node.id ? over : null;
      scheduleRender();
      return;
    }

    if (drag.kind === 'marquee') {
      drag.rect = {
        x: Math.min(drag.start.x, p.x), y: Math.min(drag.start.y, p.y),
        w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y)
      };
      scheduleRender();
    }
  }

  function onDragEnd() {
    var drag = state.drag;
    state.drag = null;
    dom.stage.dataset.mode = state.spaceDown ? 'pan' : 'select';
    if (!drag || drag.kind === 'palette') return;

    if (drag.kind === 'move' && drag.moved) { commit(); return; }
    if (drag.kind === 'resize' && drag.moved) { commit(); return; }

    if (drag.kind === 'link') {
      if (drag.target) {
        var exists = state.model.edges.some(function (e) {
          return e.from === drag.node.id && e.to === drag.target.id;
        });
        if (exists) {
          toast('Those two are already connected.');
        } else {
          state.model.edges.push(E.makeEdge(drag.node.id, drag.target.id, { fromSide: drag.side }));
          commit('Connected');
        }
      }
      scheduleRender();
      return;
    }

    if (drag.kind === 'marquee' && drag.rect) {
      var r = drag.rect;
      var inside = state.model.nodes.filter(function (n) {
        var b = E.nodeBounds(n);
        return b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
      }).map(function (n) { return n.id; });
      select(inside, drag.additive);
      return;
    }

    scheduleRender();
  }

  function onWheel(ev) {
    ev.preventDefault();
    if (ev.ctrlKey || ev.metaKey) {
      zoomAt(ev.clientX, ev.clientY, Math.pow(0.99, ev.deltaY));
      return;
    }
    var unit = ev.deltaMode === 1 ? 16 : 1;
    if (ev.shiftKey) {
      state.view.x -= ev.deltaY * unit;
    } else {
      state.view.x -= ev.deltaX * unit;
      state.view.y -= ev.deltaY * unit;
    }
    applyView();
  }

  function onDoubleClick(ev) {
    if (EMBED) return;
    var p = toModel(ev.clientX, ev.clientY);
    var node = E.nodeAt(state.model, p.x, p.y);
    if (node) {
      select([node.id]);
      beginLabelEdit(node);
      return;
    }
    /* A double-click on an edge used to do nothing beyond selecting it, which
     * reads as the editor ignoring the gesture when the same one on a node
     * opens an editor. The overlay's fat hit path is what the pointer is
     * actually over — the drawn line is far too thin to hit reliably. */
    var hit = ev.target && ev.target.closest && ev.target.closest('[data-edge-hit]');
    if (!hit) return;
    var edge = edgeById(hit.getAttribute('data-edge-hit'));
    if (!edge) return;
    selectEdge(edge.id);
    beginLabelEdit(edge);
  }

  // ------------------------------------------------------- inline labels

  /* An HTML textarea laid over the canvas, not a `<foreignObject>`: the latter
   * does not survive PNG rasterisation, and the editor is transient anyway —
   * nothing about it should reach the export.
   *
   * The box is measured from the rendered `<text>` rather than recomputed from
   * the model, so it lands exactly where the glyphs are and cannot drift when
   * a renderer changes. A node with no label yet has no `<text>` to measure,
   * so that case falls back to where the renderer would put one. */
  var LABEL_STYLES = {
    icon: { size: 12.5, weight: 500, align: 'center' },
    group: { size: 12.5, weight: 600, align: 'left' },
    note: { size: 13, weight: 400, align: 'left' },
    text: { size: 15, weight: 400, align: 'left' },
    edge: { size: 11.5, weight: 500, align: 'center' }
  };

  /* Nodes and edges share this editor. An edge is told apart by having no
   * `type`, and only the *empty label* fallback has to care: the measured
   * branch just finds the rendered `<text>` and lands on the glyphs, which is
   * the same problem either way.
   *
   * With no label to measure, an edge has no box to fall back on — so the
   * position comes off the drawn path with `getPointAtLength`, which is right
   * whatever the routing did and needs to know nothing about it. */
  function labelEditBox(node) {
    var canvas = dom.canvas.getBoundingClientRect();
    var isEdge = !node.type;
    var g = dom.content.querySelector(
      (isEdge ? 'g[data-edge-group="' : 'g[data-node="') + cssEscape(node.id) + '"]');
    var text = g && g.querySelector('text');
    if (text && (node.label || '').length) {
      var r = text.getBoundingClientRect();
      return {
        left: r.left - canvas.left - 4,
        top: r.top - canvas.top - 3,
        width: Math.max(r.width + 8, 56),
        height: r.height + 6
      };
    }
    if (isEdge) {
      var path = g && g.querySelector('[data-edge]');
      var box = path && path.getBoundingClientRect();
      var mid = { x: 0, y: 0 };
      if (path && path.getTotalLength) {
        var at = path.getPointAtLength(path.getTotalLength() / 2);
        var pk = state.view.k;
        mid.x = at.x * pk + state.view.x;
        mid.y = at.y * pk + state.view.y;
      } else if (box) {
        mid.x = box.left - canvas.left + box.width / 2;
        mid.y = box.top - canvas.top + box.height / 2;
      }
      return { left: mid.x - 50, top: mid.y - 11, width: 100, height: 22 };
    }
    var k = state.view.k;
    var sx = node.x * k + state.view.x;
    var sy = node.y * k + state.view.y;
    var w = node.w * k, h = node.h * k;
    if (node.type === 'group') {
      return { left: sx + 8 * k, top: sy + 6 * k, width: Math.max(w - 16 * k, 80), height: 20 * k };
    }
    if (node.type === 'note') {
      return { left: sx + 7 * k, top: sy + 7 * k, width: Math.max(w - 14 * k, 80), height: Math.max(h - 14 * k, 24) };
    }
    if (node.type === 'text') {
      return { left: sx, top: sy, width: Math.max(w, 90), height: Math.max(h, 22) };
    }
    return { left: sx - w * 0.35, top: sy + h + 4 * k, width: w * 1.7, height: 20 * k };
  }

  function beginLabelEdit(node) {
    endLabelEdit(false);
    var box = labelEditBox(node);
    var base = LABEL_STYLES[node.type || 'edge'];
    var size = (node.fontSize || base.size) * (node.type === 'icon' || node.type === 'group' ? 1 : 1);

    var area = document.createElement('textarea');
    area.className = 'dg-inline-edit';
    area.value = node.label || '';
    area.spellcheck = false;
    area.rows = 1;
    area.style.left = box.left + 'px';
    area.style.top = box.top + 'px';
    area.style.width = box.width + 'px';
    area.style.height = box.height + 'px';
    /* iOS Safari zooms the whole viewport when a focused control computes below
     * 16px, and it does not zoom back out afterwards. Every LABEL_STYLES size is
     * 12.5-15px, so at anything under about 1.3x zoom this field is under the
     * threshold — and double-tapping a node to rename it is the most-used text
     * control on the page, which meant the canvas ended up half off screen after
     * a rename. iOS reads the COMPUTED size, so the fix is to compute 16px and
     * scale the box back down: the glyphs still land on the label being edited
     * and still track the canvas zoom, because the transform undoes exactly what
     * the font-size added. Width and height are divided by the same factor for
     * the same reason, and `transform-origin` keeps the top-left corner — which
     * `box` already positioned — where it is.
     *
     * Only on a coarse pointer. A scale transform costs a little text sharpness,
     * and a mouse has no zoom behaviour to pay that for. */
    var px = (node.type === 'icon' || node.type === 'group' ? base.size : size)
      * state.view.k;
    if (px < 16 && window.matchMedia('(pointer: coarse)').matches) {
      var shrink = px / 16;
      area.style.fontSize = '16px';
      area.style.transformOrigin = 'top left';
      area.style.transform = 'scale(' + shrink + ')';
      area.style.width = box.width / shrink + 'px';
      area.style.height = box.height / shrink + 'px';
    } else {
      area.style.fontSize = px + 'px';
    }
    area.style.fontWeight = node.bold ? 700 : base.weight;
    area.style.textAlign = node.type === 'note' ? (node.align || 'left') : base.align;
    area.style.color = node.textColor || node.color || 'inherit';

    dom.stage.appendChild(area);
    state.labelEdit = { node: node, before: node.label || '', el: area };

    area.addEventListener('input', function () {
      node.label = area.value;
      scheduleRender();          // live preview behind the field
    });
    area.addEventListener('keydown', function (ev) {
      ev.stopPropagation();      // never let a shortcut fire mid-edit
      if (ev.key === 'Escape') { ev.preventDefault(); endLabelEdit(true); }
      // Shift+Enter is a newline; labels are rendered line by line.
      else if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); endLabelEdit(false); }
    });
    area.addEventListener('blur', function () { endLabelEdit(false); });

    area.focus();
    area.select();
  }

  function endLabelEdit(revert) {
    var edit = state.labelEdit;
    if (!edit) return;
    state.labelEdit = null;
    var changed = edit.node.label !== edit.before;
    if (revert) {
      edit.node.label = edit.before;
      scheduleRender();
    } else if (changed) {
      // `state.baseline` still holds the pre-edit snapshot, so one commit
      // covers the whole typing session rather than one per keystroke.
      commit('Renamed');
    }
    edit.el.remove();
    /* The editor sits on the canvas, so that is where focus belongs once it
     * closes — otherwise a keyboard rename ends on `<body>` and the next Tab
     * restarts at the top of the document instead of carrying on through the
     * diagram. Only when nothing else has claimed focus: blurring onto a
     * toolbar button must not be yanked back. */
    if (!document.activeElement || document.activeElement === document.body) {
      dom.canvas.focus({ preventScroll: true });
    }
    renderInspector();
  }

  // ---------------------------------------------------------------- inspector

  function renderInspector() {
    var host = dom.inspector;
    host.textContent = '';

    var edge = state.selectedEdge ? edgeById(state.selectedEdge) : null;
    var nodes = selectedNodes();

    if (edge) { inspectEdge(host, edge); return; }
    if (!nodes.length) { inspectCanvas(host); return; }
    if (nodes.length > 1) { inspectMany(host, nodes); return; }
    inspectNode(host, nodes[0]);
  }

  function field(host, labelText, control) {
    var wrap = document.createElement('div');
    wrap.className = 'dg-field';
    if (labelText) {
      var label = document.createElement('label');
      label.className = 'dg-label';
      label.textContent = labelText;
      if (control.id) label.setAttribute('for', control.id);
      wrap.appendChild(label);
    }
    wrap.appendChild(control);
    host.appendChild(wrap);
    return control;
  }

  function textInput(id, value, onChange) {
    var input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.className = 'dg-input';
    input.value = value || '';
    input.addEventListener('input', function () { onChange(input.value); });
    input.addEventListener('change', function () { commit(); });
    return input;
  }

  function textArea(id, value, onChange) {
    var area = document.createElement('textarea');
    area.id = id;
    area.className = 'dg-textarea';
    area.rows = 2;
    area.value = value || '';
    area.addEventListener('input', function () { onChange(area.value); });
    area.addEventListener('change', function () { commit(); });
    return area;
  }

  function numberInput(id, value, min, max, onChange) {
    var input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.className = 'dg-input';
    input.min = min; input.max = max;
    input.value = value;
    input.addEventListener('input', function () {
      var n = Number(input.value);
      if (isFinite(n)) onChange(clamp(n, min, max));
    });
    input.addEventListener('change', function () { commit(); });
    return input;
  }

  /** A stored colour is only usable in a native picker as `#rrggbb`. */
  function hexOr(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
  }

  /* `input` fires continuously while the picker is open, so it only repaints;
   * `change` fires once the user settles, which is the one worth undoing. */
  function colorInput(id, value, onInput, afterCommit) {
    var input = document.createElement('input');
    input.type = 'color';
    input.id = id;
    input.className = 'dg-input dg-input--color';
    input.value = value;
    input.addEventListener('input', function () { onInput(input.value); });
    input.addEventListener('change', function () {
      commit();
      if (afterCommit) afterCommit();
    });
    return input;
  }

  var SIDE_LABELS = [
    ['auto', 'Auto'], ['n', 'Top'], ['e', 'Right'], ['s', 'Bottom'], ['w', 'Left']
  ];

  function sideSelect(id, current, onPick) {
    var select = document.createElement('select');
    select.id = id;
    select.className = 'dg-select';
    SIDE_LABELS.forEach(function (pair) {
      var option = document.createElement('option');
      option.value = pair[0];
      option.textContent = pair[1];
      option.selected = pair[0] === (current || 'auto');
      select.appendChild(option);
    });
    select.addEventListener('change', function () {
      onPick(select.value);
      commit();
    });
    return select;
  }

  function segmented(options, current, onPick) {
    var wrap = document.createElement('div');
    wrap.className = 'dg-seg';
    options.forEach(function (opt) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = opt.label;
      btn.title = opt.title || opt.label;
      btn.setAttribute('aria-pressed', String(opt.value === current));
      btn.addEventListener('click', function () {
        onPick(opt.value);
        commit();
        renderInspector();
      });
      wrap.appendChild(btn);
    });
    return wrap;
  }

  function swatches(current, onPick) {
    var wrap = document.createElement('div');
    wrap.className = 'dg-swatches';
    SWATCHES.forEach(function (color) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dg-swatch';
      btn.style.background = color;
      btn.title = color;
      btn.setAttribute('aria-label', 'Colour ' + color);
      btn.setAttribute('aria-pressed', String(color.toLowerCase() === String(current).toLowerCase()));
      btn.addEventListener('click', function () {
        onPick(color);
        commit();
        renderInspector();
      });
      wrap.appendChild(btn);
    });
    return wrap;
  }

  function heading(host, text) {
    var h = document.createElement('p');
    h.className = 'dg-panel-title';
    h.style.margin = '0 0 9px';
    h.textContent = text;
    host.appendChild(h);
  }

  function inspectCanvas(host) {
    var note = document.createElement('div');
    note.className = 'dg-inspector-empty';
    note.innerHTML =
      'Nothing selected.<br>Drag an icon from the left, ' +
      'or click one to drop it in the middle.';
    host.appendChild(note);

    heading(host, 'Canvas');

    // The topbar title input is hidden on narrow screens, so it also lives here.
    field(host, 'Title', textInput('dg-f-title', state.model.title, function (v) {
      state.model.title = v;
      dom.titleInput.value = v;
      saveLocal();
    }));

    field(host, 'Background', colorInput('dg-f-bg', state.model.background || '#ffffff',
      function (v) {
        state.model.background = v;
        applyCanvasBackground();
      }));

    heading(host, 'Export');
    field(host, 'PNG scale', prefSegmented([
      { label: '1×', value: 1 }, { label: '2×', value: 2 },
      { label: '3×', value: 3 }, { label: '4×', value: 4 }
    ], exportPrefs.scale, function (v) {
      exportPrefs.scale = v;
      saveExportPrefs();
    }));
    field(host, 'On export', prefSegmented([
      { label: 'Background', value: false },
      { label: 'Transparent', value: true }
    ], exportPrefs.transparent, function (v) {
      exportPrefs.transparent = v;
      saveExportPrefs();
    }));

    appendShortcuts(host);
  }

  /* Looks like `segmented`, but deliberately does not `commit()`: an export
   * option is not a change to the diagram and has no business in the undo
   * stack or in the autosave. */
  function prefSegmented(options, current, onPick) {
    var wrap = document.createElement('div');
    wrap.className = 'dg-seg';
    options.forEach(function (opt) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = opt.label;
      btn.setAttribute('aria-pressed', String(opt.value === current));
      btn.addEventListener('click', function () { onPick(opt.value); renderInspector(); });
      wrap.appendChild(btn);
    });
    return wrap;
  }

  function inspectMany(host, nodes) {
    heading(host, nodes.length + ' items selected');

    field(host, 'Colour', swatches(nodes[0].color, function (color) {
      nodes.forEach(function (n) { n.color = color; });
    }));

    /* Six alignments rather than two. Left and top alone meant every other
     * arrangement had to be nudged by hand, and the missing four are the same
     * one-line reduction over the selection. `edge` picks the extreme to snap
     * to; `centre` averages the span so the row lands on its own midline. */
    function align(label, pick) {
      actions.appendChild(actionButton(label, function () {
        pick(nodes);
        commit('Aligned');
      }));
    }
    function extent(list, axis, sizeKey) {
      var lo = Infinity, hi = -Infinity;
      list.forEach(function (n) {
        lo = Math.min(lo, n[axis]);
        hi = Math.max(hi, n[axis] + n[sizeKey]);
      });
      return { lo: lo, hi: hi, mid: (lo + hi) / 2 };
    }

    var actions = document.createElement('div');
    actions.className = 'dg-actions';

    align('Align left', function (ns) {
      var x = extent(ns, 'x', 'w').lo;
      ns.forEach(function (n) { n.x = x; });
    });
    align('Align centre', function (ns) {
      var mid = extent(ns, 'x', 'w').mid;
      ns.forEach(function (n) { n.x = Math.round(mid - n.w / 2); });
    });
    align('Align right', function (ns) {
      var hi = extent(ns, 'x', 'w').hi;
      ns.forEach(function (n) { n.x = hi - n.w; });
    });
    align('Align top', function (ns) {
      var y = extent(ns, 'y', 'h').lo;
      ns.forEach(function (n) { n.y = y; });
    });
    align('Align middle', function (ns) {
      var mid = extent(ns, 'y', 'h').mid;
      ns.forEach(function (n) { n.y = Math.round(mid - n.h / 2); });
    });
    align('Align bottom', function (ns) {
      var hi = extent(ns, 'y', 'h').hi;
      ns.forEach(function (n) { n.y = hi - n.h; });
    });

    actions.appendChild(actionButton('Distribute horizontally', function () {
      distribute(nodes, 'x', 'w');
    }));
    actions.appendChild(actionButton('Distribute vertically', function () {
      distribute(nodes, 'y', 'h');
    }));
    actions.appendChild(actionButton('Wrap in a group', addGroup));
    actions.appendChild(actionButton('Duplicate', duplicateSelection));
    actions.appendChild(actionButton('Delete', deleteSelection, 'dg-btn--danger'));
    host.appendChild(actions);
  }

  function distribute(nodes, axis, sizeKey) {
    if (nodes.length < 3) { toast('Pick at least three items to distribute.'); return; }
    var sorted = nodes.slice().sort(function (a, b) { return a[axis] - b[axis]; });
    var first = sorted[0], last = sorted[sorted.length - 1];
    var span = (last[axis] + last[sizeKey]) - first[axis];
    var used = sorted.reduce(function (sum, n) { return sum + n[sizeKey]; }, 0);
    var gap = (span - used) / (sorted.length - 1);
    var cursor = first[axis];
    sorted.forEach(function (n) {
      n[axis] = Math.round(cursor);
      cursor += n[sizeKey] + gap;
    });
    commit('Distributed');
  }

  function actionButton(label, onClick, extraClass) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dg-btn' + (extraClass ? ' ' + extraClass : '');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  var TYPE_TITLES = { group: 'Group', text: 'Text', note: 'Note' };

  function inspectNode(host, node) {
    var icon = node.type === 'icon' ? E.Icons.get(node.icon) : null;
    heading(host, node.type === 'icon' ? (icon ? icon.name : 'Icon') : TYPE_TITLES[node.type]);

    if (node.type === 'group') {
      var preset = document.createElement('select');
      preset.id = 'dg-f-preset';
      preset.className = 'dg-select';
      GROUP_PRESETS.forEach(function (p) {
        var option = document.createElement('option');
        option.value = p.key;
        option.textContent = p.label;
        option.selected = p.label === node.label;
        preset.appendChild(option);
      });
      preset.addEventListener('change', function () {
        var chosen = GROUP_PRESETS.filter(function (p) { return p.key === preset.value; })[0];
        if (!chosen) return;
        applyGroupPreset(node, chosen);
        commit('Applied ' + chosen.label);
        renderInspector();
      });
      field(host, 'Preset', preset);
    }

    field(host, 'Label', textArea('dg-f-label', node.label, function (v) { node.label = v; }));

    if (node.type === 'note') {
      var noteRow = document.createElement('div');
      noteRow.className = 'dg-row';
      noteRow.appendChild(numberInput('dg-f-size', node.fontSize || 13, 8, 48, function (v) {
        node.fontSize = v;
        scheduleRender();
      }));
      noteRow.appendChild(colorInput('dg-f-fill', hexOr(node.fill, '#fff9db'), function (v) {
        node.fill = v;
        scheduleRender();
      }));
      field(host, 'Font size / fill', noteRow);

      field(host, 'Align', segmented([
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' }
      ], node.align || 'left', function (v) { node.align = v; }));

      field(host, 'Weight', segmented([
        { value: false, label: 'Regular' }, { value: true, label: 'Bold' }
      ], !!node.bold, function (v) { node.bold = v; }));

      textColourField(host, node, '#334155');
    }

    if (node.type === 'text') {
      field(host, 'Font size', numberInput('dg-f-size', node.fontSize || 15, 8, 96, function (v) {
        node.fontSize = v;
      }));
      field(host, 'Weight', segmented([
        { value: false, label: 'Regular' }, { value: true, label: 'Bold' }
      ], !!node.bold, function (v) { node.bold = v; }));
    }

    if (node.type === 'group') {
      field(host, 'Border', segmented([
        { value: true, label: 'Dashed' }, { value: false, label: 'Solid' }
      ], node.dashed !== false, function (v) { node.dashed = v; }));

      var fill = document.createElement('input');
      fill.type = 'range';
      fill.className = 'dg-input';
      fill.style.padding = '0';
      fill.min = 0; fill.max = 30; fill.step = 1;
      fill.value = Math.round(fillAlpha(node.fill) * 100);
      fill.addEventListener('input', function () {
        node.fill = rgba(node.color, Number(fill.value) / 100);
        scheduleRender();
      });
      fill.addEventListener('change', function () { commit(); });
      field(host, 'Fill opacity', fill);

      textColourField(host, node, '#2563eb');
    }

    // Now that text has its own colour, name what this one actually drives.
    var accentLabel = node.type === 'group' ? 'Border & fill'
                    : node.type === 'note' ? 'Border'
                    : 'Colour';
    field(host, accentLabel, swatches(node.color, function (color) {
      node.color = color;
      if (node.type === 'group') node.fill = rgba(color, fillAlpha(node.fill));
    }));

    if (node.type !== 'text') {
      var row = document.createElement('div');
      row.className = 'dg-row';
      row.appendChild(numberInput('dg-f-w', Math.round(node.w), 16, 2000, function (v) {
        node.w = v;
        if (node.type === 'icon') node.h = v;
        scheduleRender();
      }));
      row.appendChild(numberInput('dg-f-h', Math.round(node.h), 16, 2000, function (v) {
        node.h = v;
        if (node.type === 'icon') node.w = v;
        scheduleRender();
      }));
      field(host, 'Size (w × h)', row);
    }

    var actions = document.createElement('div');
    actions.className = 'dg-actions';
    if (node.type !== 'group') {
      /* Array order is z-order, so both of these are one splice. "Send to back"
       * was missing, which left overlap only fixable by raising everything
       * else — n clicks to do what one should. */
      actions.appendChild(actionButton('Bring to front', function () {
        var i = state.model.nodes.indexOf(node);
        state.model.nodes.splice(i, 1);
        state.model.nodes.push(node);
        commit('Brought to front');
      }));
      actions.appendChild(actionButton('Send to back', function () {
        var i = state.model.nodes.indexOf(node);
        state.model.nodes.splice(i, 1);
        state.model.nodes.unshift(node);
        commit('Sent to back');
      }));
    }
    actions.appendChild(actionButton('Duplicate', duplicateSelection));
    actions.appendChild(actionButton('Delete', deleteSelection, 'dg-btn--danger'));
    host.appendChild(actions);
  }

  function inspectEdge(host, edge) {
    heading(host, 'Connection');
    field(host, 'Label', textInput('dg-f-label', edge.label, function (v) { edge.label = v; }));

    field(host, 'Route', segmented([
      { value: 'orthogonal', label: 'Step' },
      { value: 'straight', label: 'Line' },
      { value: 'curve', label: 'Curve' }
    ], edge.route, function (v) { edge.route = v; }));

    field(host, 'Arrow', segmented([
      { value: 'none', label: 'None' },
      { value: 'end', label: 'End' },
      { value: 'both', label: 'Both' }
    ], edge.arrow, function (v) { edge.arrow = v; }));

    field(host, 'Stroke', segmented([
      { value: 'solid', label: 'Solid' },
      { value: 'dashed', label: 'Dashed' },
      { value: 'flow', label: 'Flow' }
    ], edge.animated ? 'flow' : (edge.dashed ? 'dashed' : 'solid'), function (v) {
      edge.animated = v === 'flow';
      edge.dashed = v === 'dashed';
    }));

    field(host, 'Width', numberInput('dg-f-width', edge.width, 1, 8, function (v) {
      edge.width = v;
      scheduleRender();
    }));

    field(host, 'Colour', swatches(edge.color, function (color) { edge.color = color; }));

    // Auto-routing has no obstacle avoidance, so a long connection can end up
    // running underneath other nodes. Pinning the sides is the way out.
    var sides = document.createElement('div');
    sides.className = 'dg-row';
    sides.appendChild(sideSelect('dg-f-fromside', edge.fromSide, function (v) { edge.fromSide = v; }));
    sides.appendChild(sideSelect('dg-f-toside', edge.toSide, function (v) { edge.toSide = v; }));
    field(host, 'Anchor (from → to)', sides);

    var actions = document.createElement('div');
    actions.className = 'dg-actions';
    actions.appendChild(actionButton('Reverse direction', function () {
      var from = edge.from, fromSide = edge.fromSide;
      edge.from = edge.to; edge.fromSide = edge.toSide;
      edge.to = from; edge.toSide = fromSide;
      commit('Reversed');
    }));
    actions.appendChild(actionButton('Delete', deleteSelection, 'dg-btn--danger'));
    host.appendChild(actions);
  }

  function appendShortcuts(host) {
    var rows = [
      ['Pan', 'Space + drag / wheel'],
      ['Zoom', MOD_KEY + ' + wheel'],
      ['Multi-select', SHIFT_KEY + ' + click'],
      ['Step through', 'Tab / ' + SHIFT_KEY + ' + Tab'],
      ['Rename', 'Enter'],
      ['Connect', 'Drag a side dot'],
      ['Free move', ALT_KEY + ' + drag'],
      ['Duplicate', MOD_KEY + ' + D'],
      ['Group', MOD_KEY + ' + G'],
      ['Zoom out / in', MOD_KEY + ' + - / +'],
      ['Fit', MOD_KEY + ' + 0'],
      ['Undo', MOD_KEY + ' + Z'],
      ['Help', '?']
    ];
    var wrap = document.createElement('div');
    wrap.className = 'dg-shortcuts';
    rows.forEach(function (r) {
      var line = document.createElement('div');
      var name = document.createElement('span');
      name.textContent = r[0];
      var key = document.createElement('kbd');
      key.textContent = r[1];
      line.appendChild(name);
      line.appendChild(key);
      wrap.appendChild(line);
    });
    host.appendChild(wrap);
  }

  /* Boxes carry two colours the user cares about — the fill behind the text and
   * the text itself — but they shared one `color` until now. Auto/Custom is a
   * segmented pair rather than a bare picker so "follow the accent colour" stays
   * reachable after a custom one has been set; picking a colour implies Custom. */
  function textColourField(host, node, fallback) {
    var accent = hexOr(node.color, fallback);
    var row = document.createElement('div');
    row.className = 'dg-row';

    row.appendChild(segmented([
      { value: false, label: 'Auto' }, { value: true, label: 'Custom' }
    ], !!node.textColor, function (v) {
      node.textColor = v ? accent : '';
    }));

    // Re-renders after committing so picking a colour flips Auto → Custom.
    row.appendChild(colorInput('dg-f-textcolour', hexOr(node.textColor, accent), function (v) {
      node.textColor = v;
      scheduleRender();
    }, renderInspector));

    field(host, 'Text colour', row);
  }

  function fillAlpha(fill) {
    var m = /rgba?\([^)]*,\s*([\d.]+)\s*\)/.exec(fill || '');
    return m ? Number(m[1]) : 0.06;
  }

  /** Channels of a #rgb / #rrggbb colour, or null when it is neither. */
  function hexToRgb(hex, fallback) {
    var h = String(hex || fallback).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    var n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  /** Relative luminance of a #rgb / #rrggbb colour, 0 (black) to 1 (white). */
  function luminance(hex) {
    var c = hexToRgb(hex, '#ffffff');
    if (!c) return 1;
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  }

  /** The grid must read against the canvas colour, not the surrounding chrome. */
  function applyCanvasBackground() {
    var color = state.model.background || '#ffffff';
    dom.canvasBg.setAttribute('fill', color);
    dom.gridDot.setAttribute(
      'fill',
      luminance(color) > 0.5 ? 'rgba(15,23,42,0.16)' : 'rgba(255,255,255,0.18)'
    );
  }

  /* Falls back rather than emitting `rgba(NaN,…)`: a group's colour comes back
   * off untrusted stored JSON, and an unparseable one used to reach the DOM. */
  function rgba(hex, alpha) {
    var c = hexToRgb(hex, '#2563eb') || hexToRgb('#2563eb');
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + alpha + ')';
  }

  // ---------------------------------------------------------------- export

  /* Export options are a property of this browser, not of the diagram: two
   * people opening the same JSON should not inherit each other's PNG scale.
   * They stay out of the model, which also keeps `fromJSON`'s whitelist and the
   * share-link payload exactly as they were. */
  var EXPORT_KEY = 'dg-export-v1';
  var exportPrefs = { scale: 2, transparent: false };

  function loadExportPrefs() {
    var raw = readStore(EXPORT_KEY);
    if (!raw) return;
    try {
      var p = JSON.parse(raw) || {};
      if ([1, 2, 3, 4].indexOf(p.scale) >= 0) exportPrefs.scale = p.scale;
      exportPrefs.transparent = !!p.transparent;
    } catch (err) { /* keep the defaults */ }
  }

  function saveExportPrefs() {
    writeStore(EXPORT_KEY, JSON.stringify(exportPrefs));
  }

  function safeFilename() {
    var base = (state.model.title || 'diagram').trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
    return (base || 'diagram').toLowerCase().slice(0, 60);
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* The engine has honoured `background: false` since it was written; nothing
   * ever asked for it. Dropping a diagram onto a slide or a dark README wanted
   * exactly that, and it was one line away the whole time. */
  function exportOpts() {
    return { background: !exportPrefs.transparent };
  }

  function exportSvg() {
    if (!state.model.nodes.length) { toast('The canvas is empty.', 'error'); return; }
    var svg = E.buildExportSvg(state.model, dom.content, dom.defs, exportOpts());
    download(new Blob([E.serialize(svg)], { type: 'image/svg+xml;charset=utf-8' }),
             safeFilename() + '.svg');
    toast(exportPrefs.transparent ? 'SVG downloaded (transparent)' : 'SVG downloaded');
  }

  function exportPng() {
    if (!state.model.nodes.length) { toast('The canvas is empty.', 'error'); return; }
    var svg = E.buildExportSvg(state.model, dom.content, dom.defs, exportOpts());
    E.toPngBlob(svg, exportPrefs.scale).then(function (blob) {
      download(blob, safeFilename() + '.png');
      toast('PNG downloaded (' + exportPrefs.scale + '×' +
            (exportPrefs.transparent ? ', transparent' : '') + ')');
    }).catch(function (err) {
      toast(err.message || 'PNG export failed', 'error');
    });
  }

  /* The model already round-trips through `toJSON`/`fromJSON`; this is the file
   * plumbing that makes it reachable. It is the only way a diagram leaves this
   * browser — autosave is per-origin, so without it a reinstall loses the lot. */
  function exportJson() {
    if (!state.model.nodes.length) { toast('The canvas is empty.', 'error'); return; }
    download(new Blob([E.toJSON(state.model)], { type: 'application/json;charset=utf-8' }),
             safeFilename() + '.json');
    toast('JSON downloaded');
  }

  function importJson(file) {
    if (!file) return;
    if (!/\.json$/i.test(file.name)) { toast('That is not a .json diagram', 'error'); return; }
    file.text().then(function (text) {
      var model = E.fromJSON(text);   // a whitelist, so a hand-edited file cannot smuggle anything in
      if (!model.nodes.length) { toast('That file has no nodes', 'error'); return; }
      openAsNewDoc(model);
      toast('Opened ' + file.name);
    }).catch(function () {
      toast('Could not read that diagram file', 'error');
    });
  }

  // --------------------------------------------------------- templates

  /* Starter diagrams, as terse tuples rather than full model objects so each
   * one reads as a picture of the architecture instead of a wall of geometry.
   * Groups are listed before icons because array order is z-order, and an
   * outer boundary has to be listed before the boxes that sit inside it.
   *
   *   groups: [ref, x, y, w, h, label, presetKey]
   *   icons:  [ref, iconKey, x, y, label]
   *   edges:  [fromRef, toRef, label, dashed, fromSide, toSide]
   *
   * The optional sides matter: edge routing has no obstacle avoidance, so a
   * long run will happily pass under a node. Pinning the anchors is the escape
   * hatch, and a starter diagram is exactly where it should be demonstrated.
   */
  var TEMPLATES = [
    {
      key: 'aws-3tier',
      name: 'Three-tier on AWS',
      blurb: 'Edge, app and data tiers across public and private subnets',
      title: 'Three-tier web application',
      groups: [
        ['vpc', 300, 40, 720, 500, 'VPC 10.0.0.0/16', 'vpc'],
        ['pub', 340, 110, 320, 150, 'Public subnet', 'public'],
        ['app', 340, 320, 320, 180, 'Private subnet — app', 'private'],
        ['data', 690, 320, 300, 180, 'Private subnet — data', 'private']
      ],
      icons: [
        ['users', 'gen:users', 40, 240, 'Users'],
        ['dns', 'aws:route53', 160, 120, 'Route 53'],
        ['cdn', 'aws:cloudfront', 160, 260, 'CloudFront'],
        ['static', 'aws:s3', 160, 480, 'Static assets'],
        ['alb', 'aws:elb', 460, 150, 'ALB'],
        ['ecs', 'aws:ecs', 460, 370, 'ECS service'],
        ['rds', 'aws:rds', 730, 370, 'RDS'],
        ['cache', 'aws:elasticache', 860, 370, 'ElastiCache']
      ],
      edges: [
        ['users', 'dns', 'DNS'],
        ['dns', 'cdn', 'alias'],
        ['cdn', 'static', 'static', true, 's', 'n'],
        ['cdn', 'alb', 'origin'],
        ['alb', 'ecs'],
        ['ecs', 'rds', 'SQL'],
        ['ecs', 'cache', 'cache', true]
      ]
    },
    {
      key: 'eks',
      name: 'EKS cluster',
      blurb: 'Ingress to pods inside a namespace, with a managed database',
      title: 'EKS workload',
      groups: [
        ['vpc', 280, 40, 780, 540, 'VPC', 'vpc'],
        ['cluster', 460, 100, 570, 450, 'EKS cluster', 'cluster'],
        ['ns', 500, 260, 340, 200, 'namespace: prod', 'namespace']
      ],
      icons: [
        ['users', 'gen:users', 40, 260, 'Users'],
        ['dns', 'aws:route53', 150, 260, 'Route 53'],
        ['alb', 'aws:elb', 320, 260, 'ALB'],
        ['ing', 'k8s:ing', 520, 150, 'Ingress'],
        ['svc', 'k8s:svc', 660, 150, 'Service'],
        ['deploy', 'k8s:deploy', 540, 330, 'Deployment'],
        ['pod', 'k8s:pod', 700, 330, 'Pod'],
        ['rds', 'aws:rds', 320, 430, 'RDS']
      ],
      edges: [
        ['users', 'dns', 'DNS'],
        ['dns', 'alb'],
        ['alb', 'ing'],
        ['ing', 'svc'],
        ['svc', 'deploy'],
        ['deploy', 'pod'],
        ['pod', 'rds', 'SQL', false, 's', 'e']
      ]
    },
    {
      key: 'gitops',
      name: 'GitOps pipeline',
      blurb: 'Commit to running pods, the pull way — Argo CD watches the config repo',
      title: 'GitOps delivery',
      groups: [
        ['cluster', 700, 90, 360, 340, 'Kubernetes cluster', 'cluster']
      ],
      icons: [
        ['dev', 'gen:user', 40, 220, 'Developer'],
        ['src', 'eco:github-icon', 160, 220, 'App repo'],
        ['ci', 'eco:docker-icon', 300, 120, 'Build image'],
        ['reg', 'eco:harbor', 300, 330, 'Registry'],
        ['cfg', 'eco:git-icon', 440, 220, 'Config repo'],
        ['argo', 'eco:argo-icon', 570, 220, 'Argo CD'],
        ['deploy', 'k8s:deploy', 750, 160, 'Deployment'],
        ['pod', 'k8s:pod', 900, 160, 'Pod'],
        ['svc', 'k8s:svc', 750, 310, 'Service']
      ],
      edges: [
        ['dev', 'src', 'push'],
        ['src', 'ci', 'CI'],
        ['ci', 'reg', 'push image'],
        ['ci', 'cfg', 'bump tag'],
        ['cfg', 'argo', 'watch', true],
        ['argo', 'deploy', 'sync'],
        ['deploy', 'pod'],
        ['svc', 'pod', '', false, 'n', 's']
      ]
    }
  ];

  function buildTemplate(tpl) {
    var model = E.emptyModel();
    model.title = tpl.title;
    var byRef = Object.create(null);

    (tpl.groups || []).forEach(function (g) {
      var node = E.makeNode('group', { x: g[1], y: g[2], w: g[3], h: g[4] });
      var preset = GROUP_PRESETS.filter(function (pr) { return pr.key === g[6]; })[0];
      if (preset) applyGroupPreset(node, preset);
      node.label = g[5];          // the preset supplies its own; ours is more specific
      byRef[g[0]] = node;
      model.nodes.push(node);
    });
    (tpl.icons || []).forEach(function (i) {
      var node = E.makeNode('icon', { icon: i[1], x: i[2], y: i[3], label: i[4] });
      byRef[i[0]] = node;
      model.nodes.push(node);
    });
    (tpl.edges || []).forEach(function (e) {
      var from = byRef[e[0]], to = byRef[e[1]];
      if (!from || !to) return;
      model.edges.push(E.makeEdge(from.id, to.id, {
        label: e[2] || '', dashed: !!e[3],
        fromSide: e[4] || 'auto', toSide: e[5] || 'auto'
      }));
    });
    return model;
  }

  /* On an empty canvas the template fills the diagram that is already open —
   * which is the only state the hint is visible in. Anywhere else it opens as
   * its own entry, so a starter diagram can never eat a drawing. */
  function applyTemplate(tpl) {
    var model = buildTemplate(tpl);
    if (state.model.nodes.length) {
      openAsNewDoc(model);
    } else {
      state.model = model;
      adoptLoadedModel();
    }
    toast('Started from ' + tpl.name);
  }

  function buildTemplateButtons() {
    var wrap = document.createElement('div');
    wrap.className = 'dg-templates';
    var head = document.createElement('p');
    head.className = 'dg-templates-head';
    head.textContent = 'or start from a template';
    wrap.appendChild(head);

    TEMPLATES.forEach(function (tpl) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dg-template';
      var name = document.createElement('b');
      name.textContent = tpl.name;
      var blurb = document.createElement('span');
      blurb.textContent = tpl.blurb;
      btn.appendChild(name);
      btn.appendChild(blurb);
      btn.addEventListener('click', function () { applyTemplate(tpl); });
      wrap.appendChild(btn);
    });
    dom.hint.appendChild(wrap);
  }

  // ------------------------------------------------------- share by URL

  /* The whole diagram travels in the location hash, so a link needs no server
   * and nothing is uploaded — the hash is never sent to one. `deflate-raw` via
   * the native CompressionStream keeps it short; where that is missing the
   * payload is the plain bytes, which still works and is just longer. The
   * one-letter prefix says which, so the format can change later.
   */
  var SHARE_DEFLATE = 'd1.';
  var SHARE_PLAIN = 'p1.';
  /* The hash we put there ourselves, so the `hashchange` listener can tell it
   * apart from one the user pasted. Without this, falling back to "the link is
   * in the address bar" fires the listener and asks whether to open the
   * diagram that is already open. */
  var ownHash = '';
  // Past this, mail clients and chat apps start wrapping or truncating links.
  var SHARE_WARN_LENGTH = 4000;

  function bytesToBase64Url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToBytes(text) {
    var b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function encodeShare(model) {
    var json = E.toJSON(model);
    if (!global.CompressionStream) {
      return Promise.resolve(SHARE_PLAIN + bytesToBase64Url(new TextEncoder().encode(json)));
    }
    var stream = new Blob([json]).stream()
      .pipeThrough(new CompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (buf) {
      return SHARE_DEFLATE + bytesToBase64Url(new Uint8Array(buf));
    });
  }

  function decodeShare(hash) {
    // Wrapped so a synchronous throw — `atob` on a truncated payload is the
    // usual one — comes back as a rejection the caller can actually catch.
    return Promise.resolve().then(function () {
      var deflated = hash.indexOf(SHARE_DEFLATE) === 0;
      if (!deflated && hash.indexOf(SHARE_PLAIN) !== 0) throw new Error('unknown link');
      var bytes = base64UrlToBytes(hash.slice(3));
      if (!deflated) return new TextDecoder().decode(bytes);
      if (!global.DecompressionStream) throw new Error('cannot decompress here');
      var stream = new Blob([bytes]).stream()
        .pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).text();
    });
  }

  function shareLink() {
    if (!state.model.nodes.length) { toast('The canvas is empty.', 'error'); return; }
    encodeShare(state.model).then(function (payload) {
      var url = location.origin + location.pathname + '#' + payload;
      if (url.length > SHARE_WARN_LENGTH) {
        toast('Link is ' + Math.round(url.length / 1000) + 'k characters — some apps will cut it. Send the JSON instead.',
              'error');
      }
      var done = function () { toast('Share link copied'); };
      // Clipboard access can be refused; putting the link in the address bar
      // still gives the user something to copy by hand.
      var fallback = function () {
        ownHash = '#' + payload;
        location.hash = payload;
        toast('Link is in the address bar — copy it from there');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, fallback);
      } else {
        fallback();
      }
    }).catch(function () {
      toast('Could not build a share link', 'error');
    });
  }

  /* Returns true when the page was opened with a shared diagram, so the caller
   * knows not to restore the autosave over the top of it. */
  function loadFromHash() {
    var hash = (location.hash || '').replace(/^#/, '');
    if (!hash || !/^[dp]1\./.test(hash)) return null;
    // The model is returned rather than installed: the caller decides where it
    // lands, and since a share link now opens as its own library entry it must
    // not touch `state.model` on the way past.
    return decodeShare(hash).then(function (json) {
      var model = E.fromJSON(json);
      if (!model.nodes.length) throw new Error('empty');
      // Drop the hash straight away: the diagram is local from here, and a URL
      // that still claims to be the shared one would go stale on the first edit.
      // An embed is the exception — the hash IS its content, nothing is edited,
      // and the "open in the editor" link is built from it.
      if (!EMBED) history.replaceState(null, '', location.pathname + location.search);
      return model;
    }).catch(function () {
      toast('That share link could not be read', 'error');
      history.replaceState(null, '', location.pathname + location.search);
      return null;
    });
  }

  /* Shared by the boot path and the hashchange path: `state.model` has already
   * been swapped, this brings the rest of the editor into line with it. */
  function adoptLoadedModel() {
    state.baseline = E.clone(state.model);
    state.history = E.createHistory(80);
    select([]);
    dom.titleInput.value = state.model.title;
    applyCanvasBackground();
    render();
    renderInspector();
    setStatus();
    saveLocal();
    ensureGroups(E.Icons.groupsFor(state.model.nodes.map(function (n) { return n.icon; })))
      .then(fitToContent);
    fitToContent();
  }

  function clearAll() {
    if (state.model.nodes.length &&
        !global.confirm('Clear the whole canvas? This cannot be undone with Ctrl+Z after a reload.')) {
      return;
    }
    var title = state.model.title;
    state.model = E.emptyModel();
    state.model.title = title;
    state.selection = [];
    state.selectedEdge = null;
    commit('Cleared');
    renderInspector();
  }

  // ---------------------------------------------------------------- keyboard

  function isTyping(target) {
    if (!target) return false;
    var tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  /* Fit and zoom, the three shortcuts an embed keeps — it has no editing keys,
   * so they would otherwise be spelled out twice. Returns whether one fired. */
  function viewShortcut(ev, mod) {
    if (!mod) return false;
    if (ev.key === '0') { ev.preventDefault(); fitToContent(); return true; }
    if (ev.key === '=' || ev.key === '+') { ev.preventDefault(); zoomCentered(1.2); return true; }
    if (ev.key === '-') { ev.preventDefault(); zoomCentered(1 / 1.2); return true; }
    return false;
  }

  function onKeyDown(ev) {
    // While the dialog is up it owns the keyboard — Escape closes it, and no
    // other shortcut reaches the canvas underneath. Tab still moves focus.
    if (helpIsOpen()) {
      if (ev.key === 'Escape') { ev.preventDefault(); closeHelp(); }
      return;
    }

    // Escape shuts the library before it reaches the canvas, where it would
    // clear the selection instead and leave the menu standing.
    if (libraryOpen() && ev.key === 'Escape') {
      ev.preventDefault();
      closeLibrary();
      dom.docsBtn.focus();
      return;
    }

    /* Tab walks the diagram, but only while the canvas itself holds focus —
     * everywhere else it has to keep moving between controls. */
    if (ev.key === 'Tab' && !EMBED && canvasHasFocus() && !isTyping(ev.target)) {
      if (stepSelection(ev.shiftKey)) ev.preventDefault();
      return;
    }

    // Enter and F2 open the label editor, the keyboard counterpart of a
    // double-click. Gated on canvas focus: elsewhere Enter belongs to whatever
    // button the user has tabbed onto.
    if ((ev.key === 'Enter' || ev.key === 'F2') && !EMBED && canvasHasFocus() &&
        state.selection.length === 1) {
      var only = byId(state.selection[0]);
      if (only) { ev.preventDefault(); beginLabelEdit(only); return; }
    }

    if (ev.key === ' ' && !isTyping(ev.target)) {
      if (!state.spaceDown) {
        state.spaceDown = true;
        if (!state.drag) dom.stage.dataset.mode = 'pan';
      }
      ev.preventDefault();
      return;
    }

    var mod = ev.ctrlKey || ev.metaKey;

    // An embed keeps the view controls and nothing that would edit or add.
    if (EMBED) { viewShortcut(ev, mod); return; }

    if (mod && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      ev.shiftKey ? redo() : undo();
      renderInspector();
      return;
    }
    if (mod && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); renderInspector(); return; }

    if (isTyping(ev.target)) return;

    if (mod && ev.key.toLowerCase() === 'a') {
      ev.preventDefault();
      select(state.model.nodes.map(function (n) { return n.id; }));
      return;
    }
    if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); duplicateSelection(); return; }
    if (mod && ev.key.toLowerCase() === 'g') { ev.preventDefault(); addGroup(); return; }
    if (viewShortcut(ev, mod)) return;

    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteSelection(); return; }
    if (ev.key === 'Escape') { select([]); return; }
    if (ev.key === '?') { ev.preventDefault(); openHelp(); return; }
    if (ev.key === 't' || ev.key === 'T') { addText(); return; }
    if (ev.key === 'n' || ev.key === 'N') { addNote(); return; }

    var step = ev.shiftKey ? GRID * 5 : GRID;
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); nudge(-step, 0); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); nudge(step, 0); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); nudge(0, -step); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); nudge(0, step); }
  }

  function onKeyUp(ev) {
    if (ev.key === ' ') {
      state.spaceDown = false;
      if (!state.drag) dom.stage.dataset.mode = 'select';
    }
  }

  // ---------------------------------------------------------------- help

  /* Shown once unprompted on a first visit. The editor's two least guessable
   * moves — side dots are the only way to connect, and group presets only
   * appear once a group is selected — cost nothing to explain up front and are
   * expensive to stumble onto. After that it is behind the toolbar button. */
  /* Rewrites the Windows-authored modifier names in the markup — the `<kbd>`
   * runs inside the dialog and the toolbar tooltips — into the host platform's.
   * Runs once at boot; the shortcut list in the inspector builds itself from
   * the same constants, so the two can't disagree. */
  function localiseModifiers() {
    if (!IS_MAC) return;
    document.querySelectorAll('[data-mod]').forEach(function (el) {
      el.textContent = MOD_KEY;
    });
    document.querySelectorAll('.dg-toolbar [title], .dg-zoombar [title]').forEach(function (el) {
      el.title = el.title
        .replace(/\bCtrl\b/g, MOD_KEY)
        .replace(/\bAlt\b/g, ALT_KEY)
        .replace(/\bShift\b/g, SHIFT_KEY);
    });
  }

  function openHelp() {
    dom.help.hidden = false;
    dom.helpClose.focus();
    try { localStorage.setItem(HELP_KEY, '1'); } catch (err) { /* ignore */ }
  }

  function closeHelp() {
    if (dom.help.hidden) return;
    dom.help.hidden = true;
    dom.helpBtn.focus();
  }

  function helpIsOpen() {
    return dom.help && !dom.help.hidden;
  }

  // ---------------------------------------------------------------- theme

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    dom.themeBtn.setAttribute('aria-pressed', String(theme === 'dark'));
    dom.themeBtn.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    try { localStorage.setItem(THEME_KEY, theme); } catch (err) { /* ignore */ }
  }

  function initTheme() {
    var stored = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
      if (stored !== 'dark' && stored !== 'light') {
        var legacy = localStorage.getItem(LEGACY_THEME_KEY);
        if (legacy === 'dark' || legacy === 'light') {
          stored = legacy;
          localStorage.setItem(THEME_KEY, stored);
        }
      }
      localStorage.removeItem(LEGACY_THEME_KEY);
    } catch (err) { /* ignore */ }
    // Light by default even when the OS prefers dark — must stay in step with
    // the pre-paint script in diagram.html, or the chrome flashes on load.
    applyTheme(stored === 'dark' ? 'dark' : 'light');
    dom.themeBtn.addEventListener('click', function () {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
  }

  // ---------------------------------------------------------------- boot

  function cacheDom() {
    dom = {
      stage: $('dg-stage'),
      canvas: $('dg-canvas'),
      viewport: $('dg-viewport'),
      content: $('dg-content'),
      overlay: $('dg-overlay'),
      defs: $('dg-defs'),
      gridPattern: $('dg-grid-pattern'),
      gridDot: $('dg-grid-dot'),
      canvasBg: $('dg-canvas-bg'),
      palette: $('dg-palette'),
      tabs: $('dg-tabs'),
      search: $('dg-search'),
      credit: $('dg-credit'),
      inspector: $('dg-inspector'),
      hint: $('dg-hint'),
      status: $('dg-status'),
      zoomLevel: $('dg-zoom-level'),
      toasts: $('dg-toasts'),
      undoBtn: $('dg-undo'),
      redoBtn: $('dg-redo'),
      themeBtn: $('dg-theme'),
      titleInput: $('dg-title'),
      docs: $('dg-docs'),
      docsBtn: $('dg-docs-btn'),
      docsMenu: $('dg-docs-menu'),
      docsList: $('dg-docs-list'),
      docsCount: $('dg-docs-count'),
      leftPanel: $('dg-left'),
      rightPanel: $('dg-right'),
      help: $('dg-help-backdrop'),
      helpBtn: $('dg-help'),
      helpClose: $('dg-help-close'),
      customFile: $('dg-custom-file'),
      openFile: $('dg-open-file')
    };
  }

  function bindCanvas() {
    dom.canvas.addEventListener('pointerdown', onCanvasPointerDown);
    /* Bound once for the life of the page rather than per gesture: fingers
     * arrive and leave independently, so there is no single drag whose
     * lifetime they could hang off. Every one of these returns immediately for
     * a pointer id the touch layer is not tracking, which is all of them until
     * a finger actually lands on the canvas. */
    global.addEventListener('pointermove', onTouchMove, true);
    global.addEventListener('pointerup', onTouchEnd, true);
    global.addEventListener('pointercancel', onTouchEnd, true);
    dom.canvas.addEventListener('pointermove', onCanvasHover);
    dom.canvas.addEventListener('dblclick', onDoubleClick);
    dom.canvas.addEventListener('wheel', onWheel, { passive: false });
    dom.canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
  }

  function bindToolbar() {
    $('dg-add-group').addEventListener('click', addGroup);
    $('dg-add-text').addEventListener('click', addText);
    $('dg-add-note').addEventListener('click', addNote);
    dom.undoBtn.addEventListener('click', function () { undo(); renderInspector(); });
    dom.redoBtn.addEventListener('click', function () { redo(); renderInspector(); });
    $('dg-export-svg').addEventListener('click', exportSvg);
    $('dg-export-png').addEventListener('click', exportPng);
    $('dg-export-json').addEventListener('click', exportJson);
    $('dg-share').addEventListener('click', shareLink);
    $('dg-open').addEventListener('click', function () { dom.openFile.click(); });
    dom.openFile.addEventListener('change', function () {
      importJson(dom.openFile.files[0]);
      dom.openFile.value = '';   // so re-picking the same file fires `change`
    });

    $('dg-clear').addEventListener('click', clearAll);
    $('dg-fit').addEventListener('click', fitToContent);
    $('dg-zoom-in').addEventListener('click', function () { zoomCentered(1.2); });
    $('dg-zoom-out').addEventListener('click', function () { zoomCentered(1 / 1.2); });
    $('dg-zoom-reset').addEventListener('click', function () {
      state.view.k = 1;
      applyView();
    });

    $('dg-toggle-palette').addEventListener('click', function () {
      var open = dom.leftPanel.classList.contains('is-open');
      closePanels();
      if (!open) dom.leftPanel.classList.add('is-open');
    });
    $('dg-toggle-inspector').addEventListener('click', function () {
      var open = dom.rightPanel.classList.contains('is-open');
      closePanels();
      if (!open) dom.rightPanel.classList.add('is-open');
    });
    document.querySelectorAll('.dg-panel-close').forEach(function (btn) {
      btn.addEventListener('click', closePanels);
    });

    dom.helpBtn.addEventListener('click', openHelp);
    dom.helpClose.addEventListener('click', closeHelp);
    dom.help.addEventListener('pointerdown', function (ev) {
      // Backdrop only — a drag that starts inside the dialog must not close it.
      if (ev.target === dom.help) closeHelp();
    });
  }

  function bindDropZone() {
    // Dropping a .json on the canvas is the same import. `dragover` must be
    // cancelled or the browser navigates to the file instead.
    dom.stage.addEventListener('dragover', function (ev) {
      if (!ev.dataTransfer || !ev.dataTransfer.types.includes('Files')) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
      dom.stage.classList.add('is-file-over');
    });
    dom.stage.addEventListener('dragleave', function (ev) {
      if (ev.target === dom.stage) dom.stage.classList.remove('is-file-over');
    });
    dom.stage.addEventListener('drop', function (ev) {
      if (!ev.dataTransfer || !ev.dataTransfer.files.length) return;
      ev.preventDefault();
      dom.stage.classList.remove('is-file-over');
      var file = ev.dataTransfer.files[0];
      if (/\.svg$/i.test(file.name)) importSvgFiles(ev.dataTransfer.files);
      else importJson(file);
    });
  }

  function bindLibrary() {
    dom.docsBtn.addEventListener('click', function () {
      if (libraryOpen()) closeLibrary(); else openLibrary();
    });
    $('dg-doc-new').addEventListener('click', newDiagram);
    /* Closing on an outside press is bound to `document`, so it has to ignore
     * presses inside the menu — including the ones that rebuild it, where the
     * clicked row is gone from the DOM by the time this would run. */
    document.addEventListener('pointerdown', function (ev) {
      if (!libraryOpen() || dom.docs.contains(ev.target)) return;
      closeLibrary();
    });
  }

  /* Restores the library and decodes a share link, in that order: the library
   * always goes first so `state.docId` is valid before anything can save, and
   * a shared model then joins it as its own entry rather than racing the
   * autosave for the canvas. Returns the pending share, if there is one. */
  function bootModel() {
    if (!EMBED) {
      var restored = bootLibrary();
      if (restored && state.model.nodes.length) toast('Restored your last diagram');
    }
    var shared = loadFromHash();
    state.baseline = E.clone(state.model);

    dom.titleInput.value = state.model.title;
    dom.titleInput.addEventListener('input', function () {
      state.model.title = dom.titleInput.value;
      saveLocal();
    });

    applyCanvasBackground();
    return shared;
  }

  function openShared(model) {
    if (!model) return;   // the failure toast has already gone up
    if (EMBED) {
      // Straight onto the canvas: an embed has no library to file it in.
      state.model = model;
      adoptLoadedModel();
      return;
    }
    openAsNewDoc(model);
    toast('Opened a shared diagram');
  }

  function bindShare(shared) {
    if (shared) shared.then(openShared);

    /* Pasting a share link while already on this page only changes the hash —
     * a same-document navigation, so nothing reloads and `init` never re-runs.
     * Without this the link would appear to do nothing at all. */
    global.addEventListener('hashchange', function () {
      if (EMBED) return;   // nothing pastes a link into an iframe
      // Ignore the hash we wrote ourselves when the clipboard was refused.
      if (location.hash === ownHash) { ownHash = ''; return; }
      if (!/^#[dp]1\./.test(location.hash || '')) return;
      var incoming = loadFromHash();
      if (incoming) incoming.then(openShared);
    });
  }

  function init() {
    cacheDom();

    E.Icons.init();
    initTheme();
    loadExportPrefs();
    localiseModifiers();
    // The palette and the starter templates are editor furniture; an embed
    // shows neither, so neither is built.
    if (!EMBED) {
      buildPalette();
      buildTemplateButtons();
    }

    dom.customFile.addEventListener('change', function () {
      var files = dom.customFile.files;
      // Reset first: picking the same file twice must fire `change` again.
      Promise.resolve(importSvgFiles(files)).then(function () {
        dom.customFile.value = '';
      });
    });
    // Imported icons live in IndexedDB, so they arrive after first paint —
    // a diagram using them draws placeholders for a frame, then fills in.
    loadCustomIcons().then(function (list) {
      if (!list.length) return;
      paletteRepaint();
      scheduleRender();
    });

    var shared = bootModel();

    bindCanvas();
    bindToolbar();
    bindDropZone();
    bindLibrary();

    applyView();
    render();
    renderInspector();
    renderLibrary();
    setStatus();
    if (state.model.nodes.length) fitToContent();

    // A restored diagram can reference groups the opening tab never loads —
    // an EKS drawing with a Terraform node, say. Pull exactly those.
    var restored = E.Icons.groupsFor(state.model.nodes.map(function (n) { return n.icon; }));
    if (restored.length) ensureGroups(restored);

    bindShare(shared);

    if (EMBED) {
      // Same page, same hash, without `?embed` — the model travels in the
      // fragment, so this is the whole link.
      $('dg-embed-open').href = location.pathname + location.hash;
      return;   // the how-to dialog belongs to the editor, not to a picture
    }

    var seenHelp = true;
    try { seenHelp = !!localStorage.getItem(HELP_KEY); } catch (err) { /* ignore */ }
    if (!seenHelp) openHelp();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.DiagramUI = {
    state: state,
    render: render,
    inspect: renderInspector,
    fit: fitToContent,
    exportOpts: exportOpts
  };
})(window);
