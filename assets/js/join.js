/* Join page — FAQ accordion and public ACM AI guide. */
(function () {
    'use strict';

    document.querySelectorAll('.faq-trigger').forEach(function (trigger) {
        trigger.addEventListener('click', function () {
            var item = trigger.parentElement;
            var open = item.classList.toggle('active');
            trigger.setAttribute('aria-expanded', String(open));
        });
    });

    var assistant = document.createElement('script');
    assistant.src = '/assets/js/public-assistant-loader.js?v=20260901-1';
    assistant.defer = true;
    document.body.appendChild(assistant);
}());
