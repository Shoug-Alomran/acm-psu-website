/* Join page — FAQ accordion and membership form submission.
 *
 * GitHub Pages serves static files only, so there is no server to receive the
 * form. Point FORM_ENDPOINT at a form backend that accepts a POST and returns
 * CORS headers (Formspree, Basin, Getform, a Google Apps Script web app, ...).
 * While it is left empty the form stays usable but tells applicants to use the
 * fallback contact link instead of silently dropping their answers.
 */

(function () {
    'use strict';

    var FORM_ENDPOINT = '';

    /* FAQ accordion. */
    document.querySelectorAll('.faq-trigger').forEach(function (trigger) {
        trigger.addEventListener('click', function () {
            var item = trigger.parentElement;
            var open = item.classList.toggle('active');
            trigger.setAttribute('aria-expanded', String(open));
        });
    });

    var form = document.getElementById('membership-form');
    if (!form) { return; }

    var status = document.getElementById('form-status');
    var submit = form.querySelector('.btn-submit');

    function setStatus(message, kind) {
        if (!status) { return; }
        status.hidden = false;
        status.textContent = message;
        status.className = 'form-status form-status--' + kind;
    }

    form.addEventListener('submit', function (event) {
        event.preventDefault();

        if (!form.reportValidity()) { return; }

        if (!FORM_ENDPOINT) {
            setStatus(
                'FORM BACKEND NOT CONFIGURED — applications are not being received yet. ' +
                'Please email acm@psu.edu.sa with your answers in the meantime.',
                'err'
            );
            return;
        }

        submit.disabled = true;
        setStatus('TRANSMITTING...', 'ok');

        fetch(FORM_ENDPOINT, {
            method: 'POST',
            headers: { Accept: 'application/json' },
            body: new FormData(form)
        }).then(function (response) {
            if (!response.ok) { throw new Error('HTTP ' + response.status); }
            form.reset();
            setStatus('HANDSHAKE COMPLETE — application received. We will be in touch.', 'ok');
        }).catch(function () {
            setStatus('TRANSMISSION FAILED — please retry, or email acm@psu.edu.sa.', 'err');
        }).finally(function () {
            submit.disabled = false;
        });
    });
}());
