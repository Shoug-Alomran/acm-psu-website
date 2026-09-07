/* Keep the admin request queue fresh while it is open.
 *
 * Extracted from an inline <script> in admin/requests.html so the page can
 * carry a `script-src 'self'` Content-Security-Policy; an inline block would
 * need 'unsafe-inline', which would defeat the policy.
 *
 * Reloading is skipped while a dialog is open, so a reload never discards what
 * an admin is part-way through reviewing.
 */
(function () {
    'use strict';
    window.setInterval(function () {
        if (
            document.visibilityState === 'visible' &&
            !document.querySelector('dialog[open]')
        ) {
            window.location.reload();
        }
    }, 10000);
}());
