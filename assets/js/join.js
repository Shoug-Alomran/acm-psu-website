/* Join page — FAQ accordion and membership form submission.
 *
 * GitHub Pages serves static files only, so the form posts to a Google Apps
 * Script web app (see apps-script/Code.gs) that appends each application as a
 * row in the registration spreadsheet. Paste the /exec URL from the Apps Script
 * deployment into FORM_ENDPOINT below.
 *
 * The request is deliberately sent as text/plain so the browser treats it as a
 * "simple" request: Apps Script does not answer CORS preflight (OPTIONS), so an
 * application/json content type would fail before it ever reached the script.
 * doPost parses the body as JSON regardless of the declared content type.
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

        var payload = {};
        new FormData(form).forEach(function (value, key) {
            payload[key] = typeof value === 'string' ? value.trim() : value;
        });

        submit.disabled = true;
        setStatus('TRANSMITTING...', 'ok');

        fetch(FORM_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        }).then(function (response) {
            if (!response.ok) { throw new Error('HTTP ' + response.status); }
            return response.json();
        }).then(function (result) {
            if (!result || result.status !== 'ok') {
                throw new Error((result && result.message) || 'rejected');
            }
            form.reset();
            setStatus('HANDSHAKE COMPLETE — application received. We will be in touch.', 'ok');
        }).catch(function () {
            setStatus('TRANSMISSION FAILED — please retry, or email acm@psu.edu.sa.', 'err');
        }).finally(function () {
            submit.disabled = false;
        });
    });
}());
