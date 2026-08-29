/* Join page — FAQ accordion.
 *
 * The membership form used to live on this page and post to a Google Apps
 * Script web app. Applications now go through the member portal instead
 * (/portal/apply.html), where an applicant gets an account, a status page they
 * can check, and a dashboard the moment they are accepted. This page explains
 * what membership involves and sends people there.
 *
 * apps-script/Code.gs is kept because positions.html still uses it.
 */

(function () {
    'use strict';

    document.querySelectorAll('.faq-trigger').forEach(function (trigger) {
        trigger.addEventListener('click', function () {
            var item = trigger.parentElement;
            var open = item.classList.toggle('active');
            trigger.setAttribute('aria-expanded', String(open));
        });
    });
}());
