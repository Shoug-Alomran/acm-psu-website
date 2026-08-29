/* ACM PSU — shared behaviour: scroll reveals, mobile nav, footer clock. */

(function () {
    'use strict';

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* Reveal sections as they scroll into view. */
    var revealables = document.querySelectorAll('.reveal');

    if (reduceMotion || !('IntersectionObserver' in window)) {
        revealables.forEach(function (el) { el.classList.add('active'); });
    } else {
        var observer = new IntersectionObserver(function (entries, obs) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('active');
                    obs.unobserve(entry.target);
                }
            });
        }, { root: null, rootMargin: '0px', threshold: 0.15 });

        revealables.forEach(function (el) { observer.observe(el); });
    }

    /* Mobile navigation toggle. */
    var toggle = document.querySelector('.nav-toggle');
    var links = document.getElementById('nav-links');

    if (toggle && links) {
        toggle.addEventListener('click', function () {
            var open = links.classList.toggle('open');
            toggle.setAttribute('aria-expanded', String(open));
        });

        links.addEventListener('click', function (event) {
            if (event.target.tagName === 'A') {
                links.classList.remove('open');
                toggle.setAttribute('aria-expanded', 'false');
            }
        });
    }

    /* Footer readout: local render time, refreshed once a minute. */
    var clock = document.querySelector('[data-clock]');

    if (clock) {
        var tick = function () {
            clock.textContent = new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
            }) + ' LOCAL';
        };
        tick();
        setInterval(tick, 60000);
    }

    /* Current year in the footer copyright. */
    document.querySelectorAll('[data-current-year]').forEach(function (el) {
        el.textContent = String(new Date().getFullYear());
    });

    /* Site-wide command-palette search. */
    var nav = document.querySelector('.nav-inner');
    if (nav) {
        var utilities = nav.querySelector('.nav-utilities');
        if (!utilities) {
            utilities = document.createElement('div');
            utilities.className = 'nav-utilities';
            var navMeta = nav.querySelector('.nav-meta');
            if (navMeta) {
                nav.insertBefore(utilities, navMeta);
                utilities.appendChild(navMeta);
            } else {
                nav.appendChild(utilities);
            }
        }

        var searchItems = [
            { href: 'index.html', en: 'Home', ar: 'الرئيسية', detailEn: 'ACM PSU digital archive', detailAr: 'الأرشيف الرقمي لنادي ACM' },
            { href: 'index.html#about', en: 'About ACM PSU', ar: 'عن نادي ACM', detailEn: 'Focus areas, workshops and competitions', detailAr: 'مجالات النادي والورش والمسابقات' },
            { href: 'team.html', en: 'Team', ar: 'الأعضاء', detailEn: 'Executive council and chapter roster', detailAr: 'المجلس التنفيذي وقائمة أعضاء النادي' },
            { href: 'projects.html', en: 'Projects', ar: 'المشاريع', detailEn: 'Competitions, workshops and technical work', detailAr: 'المسابقات والورش والأعمال التقنية' },
            { href: 'positions.html', en: 'Open Positions', ar: 'المهام المتاحة', detailEn: 'Volunteer assignments on active projects', detailAr: 'مهام تطوعية في المشاريع النشطة' },
            { href: 'projects/programming-jams/ai-programming-jam-26/archive.html', en: 'JAM.26 Resource Archive', ar: 'أرشيف موارد JAM.26', detailEn: 'Lessons, handouts, planning records and templates', detailAr: 'الدروس والنشرات وسجلات التخطيط والقوالب' },
            { href: 'projects/programming-jams/ai-programming-jam-26/', en: 'Programming Jam 2026', ar: 'معسكر البرمجة 2026', detailEn: 'AI-assisted web engineering case study', detailAr: 'دراسة حالة لهندسة الويب بالذكاء الاصطناعي' },
            { href: 'projects/ctfs/ctf-2.0/', en: 'CTF 2.0 Results', ar: 'نتائج CTF 2.0', detailEn: 'Verified scoreboard and competition report', detailAr: 'لوحة النتائج وتقرير المسابقة الموثّق' },
            { href: 'projects.html#workshops', en: 'Workshops', ar: 'الورش', detailEn: 'Programming and cybersecurity preparation', detailAr: 'ورش البرمجة والاستعداد للأمن السيبراني' },
            { href: 'join.html', en: 'Join ACM', ar: 'انضم إلى ACM', detailEn: 'Apply for the current chapter', detailAr: 'قدّم للانضمام إلى الدفعة الحالية' }
        ];

        var searchButton = document.createElement('button');
        searchButton.type = 'button';
        searchButton.className = 'site-search-trigger mono-meta';
        searchButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg><span class="search-trigger-label">Search</span><kbd>⌘K</kbd>';
        utilities.insertBefore(searchButton, utilities.querySelector('.lang-toggle'));

        var palette = document.createElement('div');
        palette.className = 'search-palette';
        palette.hidden = true;
        palette.innerHTML = '<div class="search-backdrop" data-search-close></div>' +
            '<section class="search-dialog" role="dialog" aria-modal="true" aria-labelledby="search-label">' +
                '<div class="search-input-row">' +
                    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>' +
                    '<label id="search-label" class="sr-only" for="site-search-input">Search the site</label>' +
                    '<input id="site-search-input" type="search" autocomplete="off" spellcheck="false">' +
                    '<button type="button" class="search-esc mono-meta" data-search-close>ESC</button>' +
                '</div>' +
                '<div class="search-results" role="listbox"></div>' +
                '<div class="search-help mono-meta"><span><kbd>↑↓</kbd> <b data-help-nav>navigate</b></span><span><kbd>↵</kbd> <b data-help-open>open</b></span><span><kbd>ESC</kbd> <b data-help-close>close</b></span></div>' +
            '</section>';
        document.body.appendChild(palette);

        var input = palette.querySelector('input');
        var results = palette.querySelector('.search-results');
        var activeIndex = 0;
        var filtered = searchItems.slice();

        function language() {
            return document.documentElement.lang === 'ar' ? 'ar' : 'en';
        }

        function copy() {
            var ar = language() === 'ar';
            searchButton.querySelector('.search-trigger-label').textContent = ar ? 'بحث' : 'Search';
            searchButton.setAttribute('aria-label', ar ? 'البحث في الموقع' : 'Search the site');
            input.placeholder = ar ? 'ابحث في الصفحات والمشاريع...' : 'Search pages and projects...';
            palette.querySelector('#search-label').textContent = ar ? 'البحث في الموقع' : 'Search the site';
            palette.querySelector('[data-help-nav]').textContent = ar ? 'تنقّل' : 'navigate';
            palette.querySelector('[data-help-open]').textContent = ar ? 'افتح' : 'open';
            palette.querySelector('[data-help-close]').textContent = ar ? 'إغلاق' : 'close';
        }

        function render() {
            var ar = language() === 'ar';
            var query = input.value.trim().toLocaleLowerCase();
            filtered = searchItems.filter(function (item) {
                return [item.en, item.ar, item.detailEn, item.detailAr].join(' ').toLocaleLowerCase().indexOf(query) !== -1;
            });
            activeIndex = Math.min(activeIndex, Math.max(filtered.length - 1, 0));
            if (!filtered.length) {
                results.innerHTML = '<div class="search-empty">' + (ar ? 'لا توجد نتائج مطابقة.' : 'No matching records.') + '</div>';
                return;
            }
            results.innerHTML = filtered.map(function (item, index) {
                return '<a class="search-result' + (index === activeIndex ? ' active' : '') + '" role="option" aria-selected="' + (index === activeIndex) + '" href="' + item.href + '">' +
                    '<span class="search-result-index mono-meta">0' + (index + 1) + '</span>' +
                    '<span><strong>' + (ar ? item.ar : item.en) + '</strong><small>' + (ar ? item.detailAr : item.detailEn) + '</small></span>' +
                    '<span class="search-result-arrow">↗</span></a>';
            }).join('');
        }

        function openSearch() {
            palette.hidden = false;
            document.body.classList.add('search-open');
            activeIndex = 0;
            input.value = '';
            copy();
            render();
            window.requestAnimationFrame(function () { input.focus(); });
        }

        function closeSearch() {
            palette.hidden = true;
            document.body.classList.remove('search-open');
            searchButton.focus();
        }

        searchButton.addEventListener('click', openSearch);
        palette.querySelectorAll('[data-search-close]').forEach(function (el) { el.addEventListener('click', closeSearch); });
        input.addEventListener('input', function () { activeIndex = 0; render(); });
        document.addEventListener('acm:languagechange', function () { copy(); if (!palette.hidden) { render(); } });
        document.addEventListener('keydown', function (event) {
            var tag = event.target.tagName;
            if (palette.hidden && ((event.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'))) {
                event.preventDefault(); openSearch(); return;
            }
            if (palette.hidden) { return; }
            if (event.key === 'Escape') { event.preventDefault(); closeSearch(); }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (!filtered.length) { return; }
                activeIndex = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length;
                render();
            }
            if (event.key === 'Enter' && filtered[activeIndex]) {
                event.preventDefault(); window.location.href = filtered[activeIndex].href;
            }
        });
        copy();
    }
}());
