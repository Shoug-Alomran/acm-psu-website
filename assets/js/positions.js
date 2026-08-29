/* Open project assignments. Uses the same Apps Script deployment as join.js. */
(function () {
    'use strict';

    /* Paste the /exec URL from the Apps Script deployment here. */
    var FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyDWZwnInrMmVG6hXQS970_zsNUDVMoXpdL07lmsnZtEirL7qtQFgvKotNOyfxN0hCwNg/exec';
    var list = document.getElementById('position-list');
    var loadState = document.getElementById('positions-load-state');
    var refresh = document.getElementById('positions-refresh');
    var dialog = document.getElementById('position-dialog');
    var form = document.getElementById('position-form');
    var formStatus = document.getElementById('position-form-status');
    var submit = form && form.querySelector('[type="submit"]');

    if (!list || !form || !dialog) { return; }

    function escapeHtml(value) {
        var node = document.createElement('div');
        node.textContent = String(value || '');
        return node.innerHTML;
    }

    function escapeAttr(value) {
        return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function splitItems(value) {
        return String(value || '').split(/\n|\|/).map(function (item) { return item.trim(); }).filter(Boolean);
    }

    function renderItems(value) {
        var items = splitItems(value);
        return items.length ? '<ul>' + items.map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('') + '</ul>' : '<p>Details provided during onboarding.</p>';
    }

    function render(positions) {
        if (!positions.length) {
            list.innerHTML = '<div class="positions-empty"><strong>NO OPEN ASSIGNMENTS</strong><span>Check back when the next project sprint begins.</span></div>';
            return;
        }
        list.innerHTML = positions.map(function (position) {
            var full = position.remaining <= 0 || position.status === 'closed';
            var availability = full ? 'POSITION FILLED' : position.remaining + ' OF ' + position.capacity + ' PLACES REMAINING';
            var buttonText = full ? (position.waitlist ? 'Join waitlist' : 'Registration closed') : 'Sign up for assignment';
            return '<article class="position-card" data-position-id="' + escapeAttr(position.id) + '">' +
                '<div class="position-card-index mono-meta">' + escapeHtml(position.id) + '</div>' +
                '<div class="position-card-main"><div class="position-card-top"><div><p class="mono-meta accent-text">' + escapeHtml(position.project) + '</p><h3>' + escapeHtml(position.title) + '</h3></div><span class="position-status ' + (full ? 'is-full' : '') + '">' + availability + '</span></div>' +
                '<p class="position-summary">' + escapeHtml(position.summary) + '</p>' +
                '<div class="position-details"><section><h4>Responsibilities</h4>' + renderItems(position.responsibilities) + '</section><section><h4>Requirements</h4>' + renderItems(position.requirements) + '</section></div>' +
                '<dl class="position-meta"><div><dt>Commitment</dt><dd>' + escapeHtml(position.commitment) + '</dd></div><div><dt>Deadline</dt><dd>' + escapeHtml(position.deadline) + '</dd></div><div><dt>Selection</dt><dd>' + escapeHtml(position.selection) + '</dd></div></dl>' +
                '<button class="btn-submit position-apply" type="button" data-id="' + escapeAttr(position.id) + '" data-title="' + escapeAttr(position.title) + '" data-project="' + escapeAttr(position.project) + '" ' + (full && !position.waitlist ? 'disabled' : '') + '>' + buttonText + '</button></div></article>';
        }).join('');
    }

    function loadPositions() {
        if (!FORM_ENDPOINT) {
            loadState.textContent = 'REGISTRY NOT CONFIGURED — follow apps-script/SETUP.md to connect the positions sheet.';
            loadState.classList.add('is-error');
            list.innerHTML = '';
            return Promise.resolve();
        }
        refresh.disabled = true;
        loadState.hidden = false;
        loadState.textContent = 'SYNCING AVAILABILITY...';
        loadState.classList.remove('is-error');
        return fetch(FORM_ENDPOINT + '?action=positions&t=' + Date.now())
            .then(function (response) { if (!response.ok) { throw new Error('HTTP ' + response.status); } return response.json(); })
            .then(function (result) { if (!result || result.status !== 'ok') { throw new Error('Invalid registry response'); } render(result.positions || []); loadState.hidden = true; })
            .catch(function () { loadState.hidden = false; loadState.textContent = 'REGISTRY UNAVAILABLE — refresh the page or contact the chapter board.'; loadState.classList.add('is-error'); })
            .finally(function () { refresh.disabled = false; });
    }

    list.addEventListener('click', function (event) {
        var button = event.target.closest('.position-apply');
        if (!button || button.disabled) { return; }
        form.reset();
        form.elements.positionId.value = button.dataset.id;
        document.getElementById('position-dialog-title').textContent = button.dataset.title;
        document.getElementById('position-dialog-project').textContent = button.dataset.project + ' / ASSIGNMENT REQUEST';
        formStatus.hidden = true;
        dialog.showModal();
    });

    dialog.querySelector('.position-dialog-close').addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('click', function (event) { if (event.target === dialog) { dialog.close(); } });
    refresh.addEventListener('click', loadPositions);

    form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!form.reportValidity()) { return; }
        var payload = { action: 'positionSignup' };
        new FormData(form).forEach(function (value, key) { payload[key] = typeof value === 'string' ? value.trim() : value; });
        submit.disabled = true;
        formStatus.hidden = false;
        formStatus.className = 'form-status form-status--ok';
        formStatus.textContent = 'VERIFYING CAPACITY...';
        fetch(FORM_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
            .then(function (response) { if (!response.ok) { throw new Error('HTTP ' + response.status); } return response.json(); })
            .then(function (result) {
                if (!result || result.status !== 'ok') { throw new Error((result && result.message) || 'Request rejected'); }
                formStatus.textContent = result.assignmentStatus === 'waitlisted' ? 'POSITION FULL — you have been added to the waitlist.' : 'ASSIGNMENT RESERVED — your request has been recorded. Watch your PSU email for confirmation.';
                form.reset();
                return loadPositions();
            })
            .catch(function (error) { formStatus.className = 'form-status form-status--err'; formStatus.textContent = String(error.message || error); })
            .finally(function () { submit.disabled = false; });
    });

    loadPositions();
}());
