/* Projects page — category tabs and live search over the case-study cards. */

(function () {
    'use strict';

    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
    var search = document.getElementById('project-search');
    var cards = Array.prototype.slice.call(document.querySelectorAll('.case-study-card'));
    var emptyState = document.querySelector('.empty-state');
    var counter = document.querySelector('[data-result-count]');

    if (!cards.length) { return; }

    var validCategories = tabs.map(function (tab) {
        return (tab.dataset.filter || 'all').toLowerCase();
    });
    var requestedCategory = window.location.hash.slice(1).toLowerCase();
    var activeCategory = validCategories.indexOf(requestedCategory) !== -1 ? requestedCategory : 'all';

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

    function selectCategory(category) {
        activeCategory = validCategories.indexOf(category) !== -1 ? category : 'all';
        tabs.forEach(function (tab) {
            var isActive = (tab.dataset.filter || 'all').toLowerCase() === activeCategory;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-pressed', String(isActive));
        });

        var projectsNav = document.querySelector('.nav-links a[href="projects.html"]');
        var archiveNav = document.querySelector('.nav-links a[href="projects.html#workshops"]');
        if (projectsNav && archiveNav) {
            var archiveActive = activeCategory === 'workshops';
            projectsNav.classList.toggle('active', !archiveActive);
            archiveNav.classList.toggle('active', archiveActive);
            if (archiveActive) {
                projectsNav.removeAttribute('aria-current');
                archiveNav.setAttribute('aria-current', 'page');
            } else {
                archiveNav.removeAttribute('aria-current');
                projectsNav.setAttribute('aria-current', 'page');
            }
        }
        apply();
    }

    tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
            var category = (tab.dataset.filter || 'all').toLowerCase();
            selectCategory(category);
            history.replaceState(null, '', category === 'all' ? window.location.pathname : '#' + category);
        });
    });

    window.addEventListener('hashchange', function () {
        selectCategory(window.location.hash.slice(1).toLowerCase());
    });

    if (search) {
        search.addEventListener('input', apply);
    }

    selectCategory(activeCategory);
}());
