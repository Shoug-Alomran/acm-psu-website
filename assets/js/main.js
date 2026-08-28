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
    document.querySelectorAll('[data-year]').forEach(function (el) {
        el.textContent = String(new Date().getFullYear());
    });
}());
