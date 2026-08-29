/* Archive detail page — section tabs, type filters, file search, and the
 * preview pane that reflects whichever row is selected. */

(function () {
    'use strict';

    var rows = Array.prototype.slice.call(document.querySelectorAll('.file-row'));
    if (!rows.length) { return; }

    var sectionTabs = Array.prototype.slice.call(document.querySelectorAll('.archive-tabs a'));
    var typeFilters = Array.prototype.slice.call(document.querySelectorAll('.type-filter'));
    var search = document.getElementById('file-search');
    var empty = document.querySelector('.file-empty');
    var crumb = document.querySelector('[data-crumb]');
    var preview = document.getElementById('preview');
    var closeBtn = document.getElementById('preview-close');
    var openLink = document.querySelector('[data-preview-open]');
    var downloadLink = document.querySelector('[data-preview-download]');

    var section = 'all';
    var type = 'all';

    function apply() {
        var query = (search ? search.value : '').trim().toLowerCase();
        var visible = 0;

        rows.forEach(function (row) {
            var matchesSection = section === 'all' || row.dataset.section === section;
            // Directories are structural, so they only show in the unfiltered view.
            var matchesType = type === 'all' ? true : row.dataset.type === type;
            var matchesQuery = !query || row.dataset.name.toLowerCase().indexOf(query) !== -1;
            var show = matchesSection && matchesType && matchesQuery;

            row.hidden = !show;
            if (show) { visible += 1; }
        });

        if (empty) { empty.hidden = visible !== 0; }
    }

    function select(row) {
        rows.forEach(function (r) { r.classList.remove('selected'); });
        row.classList.add('selected');

        var d = row.dataset;
        var set = function (attr, value) {
            var el = document.querySelector('[data-preview-' + attr + ']');
            if (el) { el.textContent = value || '—'; }
        };

        set('name', d.name);
        set('kind', d.kind);
        set('bytes', d.bytes || d.size);
        set('uploaded', d.uploaded || d.updated);
        set('path', d.path);
        set('sha', d.sha);

        if (openLink && d.url) { openLink.href = d.url; }
        if (downloadLink && d.url) {
            downloadLink.href = d.url;
            if (/^https?:\/\//.test(d.url)) { downloadLink.removeAttribute('download'); }
            else { downloadLink.setAttribute('download', ''); }
        }

        if (preview) { preview.hidden = false; }
    }

    rows.forEach(function (row) {
        row.addEventListener('click', function () { select(row); });
    });

    sectionTabs.forEach(function (tab) {
        tab.addEventListener('click', function (event) {
            event.preventDefault();
            sectionTabs.forEach(function (t) { t.classList.remove('active'); });
            tab.classList.add('active');
            section = tab.dataset.section || 'all';
            if (crumb) { crumb.textContent = section === 'all' ? 'ALL_FILES' : section; }
            apply();
        });
    });

    typeFilters.forEach(function (btn) {
        btn.addEventListener('click', function () {
            typeFilters.forEach(function (b) {
                b.classList.remove('active');
                b.setAttribute('aria-pressed', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
            type = btn.dataset.type || 'all';
            apply();
        });
    });

    if (search) { search.addEventListener('input', apply); }

    if (closeBtn && preview) {
        closeBtn.addEventListener('click', function () {
            preview.hidden = true;
            rows.forEach(function (r) { r.classList.remove('selected'); });
        });
    }

    /* List/grid view toggle is presentational only for now — keep the pressed
       state honest rather than pretending it switches layouts. */
    var viewBtns = Array.prototype.slice.call(document.querySelectorAll('.view-toggle .icon-btn'));
    viewBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
            viewBtns.forEach(function (b) {
                b.classList.remove('active');
                b.setAttribute('aria-pressed', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
        });
    });

    /* Pinned cards jump to their row in the list. */
    document.querySelectorAll('.pin-card').forEach(function (card) {
        card.addEventListener('click', function () {
            var target = card.dataset.target;
            var row = rows.filter(function (r) { return r.dataset.name === target; })[0];
            if (!row) { return; }
            section = 'all';
            type = 'all';
            if (search) { search.value = ''; }
            sectionTabs.forEach(function (t) { t.classList.toggle('active', t.dataset.section === 'all'); });
            typeFilters.forEach(function (b) {
                b.classList.toggle('active', b.dataset.type === 'all');
                b.setAttribute('aria-pressed', String(b.dataset.type === 'all'));
            });
            if (crumb) { crumb.textContent = 'ALL_FILES'; }
            apply();
            select(row);
            row.scrollIntoView({ block: 'nearest' });
        });
    });

    apply();
}());
