/* Projects page — category tabs and live search over the case-study cards. */

(function () {
    'use strict';

    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
    var search = document.getElementById('project-search');
    var cards = Array.prototype.slice.call(document.querySelectorAll('.case-study-card'));
    var emptyState = document.querySelector('.empty-state');
    var counter = document.querySelector('[data-result-count]');

    if (!cards.length) { return; }

    var activeCategory = 'all';

    function apply() {
        var query = (search ? search.value : '').trim().toLowerCase();
        var visible = 0;

        cards.forEach(function (card) {
            var category = (card.dataset.category || '').toLowerCase();
            var matchesCategory = activeCategory === 'all' || category === activeCategory;
            var matchesQuery = !query || card.textContent.toLowerCase().indexOf(query) !== -1;
            var show = matchesCategory && matchesQuery;

            card.hidden = !show;
            if (show) { visible += 1; }
        });

        if (emptyState) { emptyState.hidden = visible !== 0; }
        if (counter) { counter.textContent = String(visible).padStart(2, '0'); }
    }

    tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
            tabs.forEach(function (other) {
                other.classList.remove('active');
                other.setAttribute('aria-pressed', 'false');
            });
            tab.classList.add('active');
            tab.setAttribute('aria-pressed', 'true');
            activeCategory = (tab.dataset.filter || 'all').toLowerCase();
            apply();
        });
    });

    if (search) {
        search.addEventListener('input', apply);
    }

    apply();
}());
