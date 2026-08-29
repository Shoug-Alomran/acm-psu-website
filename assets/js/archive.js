(function () {
  'use strict';
  var manifest = window.PROJECT_ARCHIVE;
  var list = document.querySelector('[data-file-list]');
  if (!manifest || !list) return;
  var items = manifest.items || [], byId = {};
  items.forEach(function (item) { byId[item.id] = item; });
  var current = manifest.rootId || 'root', section = 'all', type = 'all', selected = null;
  var search = document.getElementById('file-search'), empty = document.querySelector('.file-empty');
  var preview = document.getElementById('preview'), stage = document.querySelector('[data-preview-stage]');
  var openLink = document.querySelector('[data-preview-open]'), downloadLink = document.querySelector('[data-preview-download]');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.archive-tabs a'));
  var filters = Array.prototype.slice.call(document.querySelectorAll('.type-filter'));
  var views = Array.prototype.slice.call(document.querySelectorAll('[data-view]'));
  var GLYPHS = {
    folder: '<path d="M3 6.6A1.6 1.6 0 0 1 4.6 5h4.1l1.9 2.5h9.8A1.6 1.6 0 0 1 22 9.1v8.3A1.6 1.6 0 0 1 20.4 19H4.6A1.6 1.6 0 0 1 3 17.4z"/>',
    folderStack: '<path d="M5.6 7.4V5.6A1.4 1.4 0 0 1 7 4.2h3.4l1.7 2.2h6.5a1.4 1.4 0 0 1 1.4 1.4v1.1"/><path d="M2 10.6A1.6 1.6 0 0 1 3.6 9h4.1l1.9 2.4h9.8A1.6 1.6 0 0 1 21 13v5.4A1.6 1.6 0 0 1 19.4 20H3.6A1.6 1.6 0 0 1 2 18.4z"/>',
    doc: '<path d="M6.5 3.2h7L18.5 8v12.8h-12z"/><path d="M13.3 3.2v5h5.2"/><path d="M9.4 13h6.2M9.4 16.2h6.2"/>',
    template: '<path d="M6.5 3.2h7L18.5 8v12.8h-12z"/><path d="M13.3 3.2v5h5.2"/><path d="M9.4 12.6h6.2M9.4 15.6h6.2M9.4 18.2h3.1" stroke-dasharray="2.2 2"/>',
    report: '<path d="M6.5 3.2h7L18.5 8v12.8h-12z"/><path d="M13.3 3.2v5h5.2"/><path d="M9.6 17.6v-3.1M12.5 17.6v-5.4M15.4 17.6v-2"/>',
    list: '<path d="M4.5 7h1.6M4.5 12h1.6M4.5 17h1.6M9.6 7h9.9M9.6 12h9.9M9.6 17h9.9"/>',
    slides: '<path d="M2.8 4.8h18.4v10.6H2.8z"/><path d="M12 15.4v3.4M9 20.2h6"/>',
    web: '<path d="M3 5.2h18v13.6H3z"/><path d="M3 9.4h18"/><path d="M5.9 7.3h1.3M9.1 7.3h1.3"/>',
    image: '<path d="M3 5.2h18v13.6H3z"/><path d="M3 15.2l4.7-4.6 4.1 4 3-2.5 6.2 5.3"/><circle cx="8.6" cy="9.1" r="1.5"/>',
    link: '<path d="M14.2 3.8h6v6"/><path d="M20.2 3.8l-8.8 8.8"/><path d="M18.2 13.6v5.2a1.6 1.6 0 0 1-1.6 1.6H5.4a1.6 1.6 0 0 1-1.6-1.6V7.6A1.6 1.6 0 0 1 5.4 6h5.2"/>'
  };
  function svg(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + GLYPHS[name] + '</svg>'; }
  function has(haystack, needle) { return haystack.indexOf(needle) !== -1; }
  function iconName(item) {
    var kind = (item.kind || '').toLowerCase();
    var hay = [item.kind, item.state, item.format, item.name].join(' ').toLowerCase();
    if (item.type === 'link') return 'link';
    if (item.type === 'folder') return has(kind, 'version') ? 'folderStack' : 'folder';
    if (item.type === 'media') return 'image';
    if (has(hay, 'slide') || has(hay, 'presentation') || has(hay, 'deck')) return 'slides';
    if (has(hay, 'cheat')) return 'list';
    if (has(hay, 'template')) return 'template';
    if (has(hay, 'report')) return 'report';
    if (item.type === 'html') return 'web';
    return 'doc';
  }
  function icon(item) { return svg(iconName(item)); }
  function badge(item) { return item.type === 'folder' ? 'DIR' : item.type === 'link' ? 'LINK' : item.format || item.type.toUpperCase(); }
  function children(id) { return items.filter(function (item) { return item.parent === id; }); }
  function pathFor(item) { var parts = [item.name], parent = item.parent; while (parent && parent !== manifest.rootId) { parts.unshift(byId[parent].name); parent = byId[parent].parent; } return '/' + parts.join('/'); }
  function folderPath(item) { return !item.parent || item.parent === manifest.rootId ? '/' : pathFor(byId[item.parent]); }
  function setText(name, value) { var el = document.querySelector('[data-preview-' + name + ']'); if (el) el.textContent = value || '—'; }
  function trail() { var result = [], id = current; while (id && id !== manifest.rootId) { result.unshift(byId[id]); id = byId[id].parent; } return result; }
  function renderCrumbs() {
    var nav = document.querySelector('[data-breadcrumb]'); if (!nav) return; nav.innerHTML = '';
    var root = document.createElement('button'); root.type = 'button'; root.textContent = manifest.rootName || 'ARCHIVE'; root.dataset.folder = manifest.rootId; nav.appendChild(root);
    trail().forEach(function (item) { var sep = document.createElement('span'); sep.textContent = '/'; sep.setAttribute('aria-hidden', 'true'); nav.appendChild(sep); var button = document.createElement('button'); button.type = 'button'; button.textContent = item.name; button.dataset.folder = item.id; nav.appendChild(button); });
  }
  function within(item, folderId) { if (folderId === manifest.rootId) return true; var parent = item.parent; while (parent) { if (parent === folderId) return true; parent = byId[parent] ? byId[parent].parent : null; } return false; }
  function isFlat() { return !!(search && search.value.trim()) || section !== 'all' || type !== 'all'; }
  function getVisible() {
    var query = search ? search.value.trim().toLowerCase() : '', flat = isFlat();
    return items.filter(function (item) { return (flat ? within(item, current) : item.parent === current) && (section === 'all' || item.section === section) && (type === 'all' || item.type === type) && (!query || [item.name, item.description, item.kind, pathFor(item)].join(' ').toLowerCase().indexOf(query) !== -1); })
      .sort(function (a, b) { return (a.type === 'folder' ? -1 : 1) - (b.type === 'folder' ? -1 : 1) || a.name.localeCompare(b.name); });
  }
  function render() {
    list.querySelectorAll('.file-row').forEach(function (row) { row.remove(); });
    var visible = getVisible(), flat = isFlat();
    visible.forEach(function (item) {
      var row = document.createElement('button'); row.type = 'button'; row.className = 'file-grid file-row'; row.dataset.id = item.id; row.dataset.type = item.type;
      if (selected === item.id) row.classList.add('selected');
      row.innerHTML = '<div class="fname"><span class="icon">' + icon(item) + '</span><span>' + item.name + '</span>' + (flat && item.parent !== current ? '<span class="fpath">' + folderPath(item) + '</span>' : '') + '</div><div><span class="ftype">' + badge(item) + '</span></div><div class="fcell col-section">' + item.section + '</div><div class="fcell col-updated">' + item.updated + '</div><div class="fcell col-size">' + (item.type === 'folder' ? children(item.id).length + ' items' : item.size || '—') + '</div><div class="file-act">' + (item.type === 'folder' ? '→' : '›') + '</div>';
      list.insertBefore(row, empty);
    });
    if (empty) empty.hidden = visible.length !== 0; renderCrumbs();
  }
  function showStage(item) {
    stage.innerHTML = '';
    if (item.type === 'media') { var img = document.createElement('img'); img.className = 'preview-media'; img.src = item.url; img.alt = item.name; stage.appendChild(img); }
    else if (item.type === 'pdf' || item.type === 'html') { var frame = document.createElement('iframe'); frame.className = 'preview-frame'; frame.src = item.url; frame.title = item.name + ' preview'; frame.loading = 'lazy'; stage.appendChild(frame); }
    else { var box = document.createElement('div'); box.className = 'preview-symbol'; box.innerHTML = '<span class="icon" aria-hidden="true">' + icon(item) + '</span><strong>' + item.name + '</strong><p>' + (item.description || '') + '</p>'; stage.appendChild(box); }
  }
  function select(item) {
    selected = item.id;
    list.querySelectorAll('.file-row').forEach(function (row) { row.classList.toggle('selected', row.dataset.id === item.id); });
    setText('name', item.name); setText('kind', item.kind); setText('bytes', item.description || item.size); setText('uploaded', item.updated); setText('path', pathFor(item)); setText('sha', item.state); showStage(item); preview.hidden = false;
    if (item.type === 'folder') { openLink.textContent = 'Open folder'; openLink.href = '#folder=' + item.id; openLink.dataset.folderTarget = item.id; downloadLink.hidden = true; }
    else { openLink.textContent = 'Open'; openLink.href = item.url; delete openLink.dataset.folderTarget; downloadLink.hidden = item.type === 'link'; downloadLink.href = item.url; if (item.type === 'link') downloadLink.removeAttribute('download'); else downloadLink.setAttribute('download', ''); }
  }
  function enter(id) { if (id !== manifest.rootId && (!byId[id] || byId[id].type !== 'folder')) return; current = id; selected = null; if (search) search.value = ''; render(); history.replaceState(null, '', '#folder=' + encodeURIComponent(id)); }
  list.addEventListener('click', function (event) { var row = event.target.closest('.file-row'); if (row) select(byId[row.dataset.id]); });
  list.addEventListener('dblclick', function (event) { var row = event.target.closest('.file-row'); if (row && byId[row.dataset.id].type === 'folder') enter(row.dataset.id); });
  document.querySelector('[data-breadcrumb]').addEventListener('click', function (event) { var button = event.target.closest('[data-folder]'); if (button) enter(button.dataset.folder); });
  openLink.addEventListener('click', function (event) { if (openLink.dataset.folderTarget) { event.preventDefault(); enter(openLink.dataset.folderTarget); } });
  document.getElementById('preview-close').addEventListener('click', function () { preview.hidden = true; selected = null; render(); });
  if (search) search.addEventListener('input', render);
  tabs.forEach(function (tab) { tab.addEventListener('click', function (event) { event.preventDefault(); tabs.forEach(function (t) { t.classList.remove('active'); }); tab.classList.add('active'); section = tab.dataset.section || 'all'; render(); }); });
  filters.forEach(function (button) { button.addEventListener('click', function () { filters.forEach(function (b) { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); }); button.classList.add('active'); button.setAttribute('aria-pressed', 'true'); type = button.dataset.type || 'all'; render(); }); });
  views.forEach(function (button) { button.addEventListener('click', function () { views.forEach(function (b) { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); }); button.classList.add('active'); button.setAttribute('aria-pressed', 'true'); list.classList.toggle('is-grid', button.dataset.view === 'grid'); }); });
  document.querySelectorAll('.pin-card').forEach(function (card) { var pinned = byId[card.dataset.target], pinIcon = card.querySelector('.icon'); if (pinned && pinIcon) pinIcon.innerHTML = icon(pinned); card.addEventListener('click', function () { var item = byId[card.dataset.target]; if (!item) return; current = item.parent; section = 'all'; type = 'all'; if (search) search.value = ''; tabs.forEach(function (t) { t.classList.toggle('active', t.dataset.section === 'all'); }); filters.forEach(function (b) { var active = b.dataset.type === 'all'; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); }); select(item); }); });
  var initial = decodeURIComponent((location.hash.match(/folder=([^&]+)/) || [])[1] || manifest.rootId); if (initial === manifest.rootId || (byId[initial] && byId[initial].type === 'folder')) current = initial;
  render();
}());
