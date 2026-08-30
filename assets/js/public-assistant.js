/* ACM PSU public AI guide for Join and Contact. */
(function () {
    'use strict';

    var FUNCTION_URL = 'https://cpcivikfjuutbbtxzlyj.supabase.co/functions/v1/prospective-member-assistant';
    var root = document.querySelector('[data-acm-ai-guide]');
    if (!root) return;

    var log = root.querySelector('[data-ai-log]');
    var form = root.querySelector('[data-ai-form]');
    var input = root.querySelector('[data-ai-input]');
    var submit = root.querySelector('[data-ai-submit]');
    var chips = root.querySelectorAll('[data-ai-question]');
    var history = [];

    function addMessage(role, text) {
        var item = document.createElement('div');
        item.className = 'ai-guide-message ai-guide-message--' + role;

        var label = document.createElement('span');
        label.className = 'mono-meta ai-guide-message-label';
        label.textContent = role === 'user' ? 'YOU' : 'ACM GUIDE';

        var body = document.createElement('p');
        body.textContent = text;

        item.appendChild(label);
        item.appendChild(body);
        log.appendChild(item);
        log.scrollTop = log.scrollHeight;
    }

    function setBusy(busy) {
        submit.disabled = busy;
        input.disabled = busy;
        submit.textContent = busy ? 'THINKING…' : 'ASK';
        root.classList.toggle('is-busy', busy);
    }

    async function ask(question) {
        var clean = String(question || '').trim();
        if (!clean) return;

        addMessage('user', clean);
        input.value = '';
        setBusy(true);

        try {
            var response = await fetch(FUNCTION_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: clean, history: history.slice(-6) })
            });
            var payload = await response.json().catch(function () { return {}; });
            if (!response.ok) throw new Error(payload.error || 'The ACM guide is unavailable.');

            var answer = String(payload.answer || '').trim();
            if (!answer) throw new Error('The ACM guide returned an empty answer.');

            addMessage('assistant', answer);
            history.push({ role: 'user', content: clean }, { role: 'assistant', content: answer });
            history = history.slice(-6);
        } catch (error) {
            addMessage('assistant', (error && error.message) || 'I could not answer right now. Please use the contact form or email acm@psu.edu.sa.');
        } finally {
            setBusy(false);
            input.focus();
        }
    }

    form.addEventListener('submit', function (event) {
        event.preventDefault();
        ask(input.value);
    });

    chips.forEach(function (chip) {
        chip.addEventListener('click', function () {
            ask(chip.getAttribute('data-ai-question'));
        });
    });

    addMessage('assistant', 'Ask me about joining ACM PSU, the application process, public events, workshops, competitions, or where to find the right page.');
}());
