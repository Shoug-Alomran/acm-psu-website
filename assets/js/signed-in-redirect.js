/* Send an already signed-in visitor straight to their portal.
 *
 * Extracted from an inline <script> in join.html so the page can carry a
 * `script-src 'self'` Content-Security-Policy: an inline block would need
 * 'unsafe-inline', which turns the policy off for exactly the attack it exists
 * to stop. Loaded in <head> without `defer` so the redirect happens before the
 * application form paints.
 */
(function () {
    'use strict';
    try {
        var raw = localStorage.getItem('acm-psu-auth');
        if (!raw) return;
        var stored = JSON.parse(raw);
        var session = stored && (stored.currentSession || stored.session || stored);
        if (session && session.access_token && session.refresh_token) {
            window.location.replace('/portal/index.html');
        }
    } catch (_) {
        /* Invalid or unavailable storage: treat the visitor as signed out. */
    }
}());
