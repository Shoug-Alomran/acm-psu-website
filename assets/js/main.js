/* ACM PSU — public-site bootstrap.
 * Hides recruitment navigation for authenticated users, then loads the
 * shared public-site runtime and public event registration actions.
 */
(function () {
    'use strict';

    function hasStoredSession() {
        try {
            var raw = localStorage.getItem('acm-psu-auth');
            if (!raw) return false;
            var stored = JSON.parse(raw);
            var session = stored && (stored.currentSession || stored.session || stored);
            return Boolean(session && session.access_token && session.refresh_token);
        } catch (_) {
            return false;
        }
    }

    if (hasStoredSession()) {
        document.querySelectorAll('#nav-links a[href="join.html"], #nav-links a[href="/join.html"]').forEach(function (link) {
            link.remove();
        });
    }

    var runtime = document.createElement('script');
    runtime.src = '/assets/js/main-core.js?v=20260905-1';
    runtime.async = false;
    runtime.addEventListener('load', function () {
        var registration = document.createElement('script');
        registration.src = '/assets/js/upcoming-registration.js?v=20260905-2';
        registration.async = false;
        document.head.appendChild(registration);
    });
    document.head.appendChild(runtime);
}());
