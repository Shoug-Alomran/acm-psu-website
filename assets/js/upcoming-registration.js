/* Adds event registration actions from canonical Supabase project data. */
(function () {
    'use strict';

    function ensureEnv(callback) {
        if (window.ACM_ENV && window.ACM_ENV.supabaseUrl && window.ACM_ENV.supabaseAnonKey) {
            callback(window.ACM_ENV);
            return;
        }
        var existing = document.querySelector('script[data-acm-env-loader]');
        if (existing) {
            existing.addEventListener('load', function () {
                if (window.ACM_ENV) callback(window.ACM_ENV);
            }, { once: true });
            return;
        }
        var script = document.createElement('script');
        script.src = '/assets/js/app/env.js?v=20260905-1';
        script.dataset.acmEnvLoader = 'true';
        script.addEventListener('load', function () {
            if (window.ACM_ENV) callback(window.ACM_ENV);
        }, { once: true });
        document.head.appendChild(script);
    }

    function isArabic() {
        return document.documentElement.lang === 'ar';
    }

    function normalize(value) {
        return String(value || '').trim().toLowerCase();
    }

    function applyRegistrationButtons(events) {
        var section = document.querySelector('#upcoming-events');
        if (!section) return false;

        section.querySelectorAll('.upcoming-card').forEach(function (card) {
            var titleEl = card.querySelector('h3');
            var links = card.querySelector('.project-links');
            if (!titleEl || !links) return;

            var title = normalize(titleEl.textContent);
            var event = events.find(function (row) {
                return normalize(row.title) === title || normalize(row.title_ar) === title;
            });
            if (!event || !event.registration_url) return;
            if (links.querySelector('[data-event-register]')) return;

            var register = document.createElement('a');
            register.href = event.registration_url;
            register.className = 'btn btn-primary';
            register.dataset.eventRegister = 'true';
            register.textContent = isArabic() ? 'سجل الآن' : 'Register';
            if (/^https?:\/\//.test(event.registration_url)) {
                register.target = '_blank';
                register.rel = 'noopener';
            }
            links.insertBefore(register, links.firstChild);
        });
        return true;
    }

    ensureEnv(function (env) {
        fetch(env.supabaseUrl + '/rest/v1/projects?select=title,title_ar,registration_url&visibility=eq.public&kind=eq.event&deleted_at=is.null&registration_url=not.is.null', {
            headers: {
                apikey: env.supabaseAnonKey,
                Authorization: 'Bearer ' + env.supabaseAnonKey,
                Accept: 'application/json'
            }
        }).then(function (response) {
            if (!response.ok) throw new Error('Registration data request failed');
            return response.json();
        }).then(function (events) {
            /*
             * The public runtime re-renders the upcoming-event cards from its
             * cached Supabase data on every language switch, which discards the
             * buttons injected here. Re-apply them rather than only re-labelling,
             * and register this before the early return below so the listener is
             * attached even when the first pass succeeds.
             */
            document.addEventListener('acm:languagechange', function () {
                applyRegistrationButtons(events);
            });

            if (applyRegistrationButtons(events)) return;
            var observer = new MutationObserver(function () {
                if (applyRegistrationButtons(events)) observer.disconnect();
            });
            observer.observe(document.body, { childList: true, subtree: true });
            window.setTimeout(function () { observer.disconnect(); }, 10000);
        }).catch(function () {
            /* The event cards remain usable without registration enhancements. */
        });
    });
}());
