/* Mount the public ACM AI guide on Join and Contact without duplicating page markup. */
(function () {
    'use strict';

    if (document.querySelector('[data-acm-ai-guide]')) return;
    var page = document.querySelector('.membership-hero');
    if (!page) return;

    var style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = '/assets/css/public-assistant.css?v=20260901-2';
    document.head.appendChild(style);

    var guide = document.createElement('section');
    guide.className = 'ai-guide';
    guide.setAttribute('data-acm-ai-guide', '');
    guide.setAttribute('aria-labelledby', 'acm-ai-guide-title');
    guide.innerHTML = '' +
        '<div class="ai-guide-header">' +
            '<div class="ai-guide-title" id="acm-ai-guide-title">ACM AI Guide</div>' +
            '<span class="mono-meta ai-guide-status">PUBLIC ASSISTANT</span>' +
        '</div>' +
        '<div class="ai-guide-body">' +
            '<p class="ai-guide-copy">Have a question before you apply or contact the committee? Ask here first. The guide answers public questions about membership, events, workshops and the application process.</p>' +
            '<div class="ai-guide-chips" aria-label="Suggested questions">' +
                '<button type="button" class="ai-guide-chip" data-ai-question="Do I need previous technical experience to join ACM PSU?">DO I NEED EXPERIENCE?</button>' +
                '<button type="button" class="ai-guide-chip" data-ai-question="How does the ACM PSU membership application process work?">HOW DO I JOIN?</button>' +
                '<button type="button" class="ai-guide-chip" data-ai-question="Can I register for a public ACM event without being a club member?">EVENTS WITHOUT MEMBERSHIP?</button>' +
                '<button type="button" class="ai-guide-chip" data-ai-question="What public ACM PSU events are currently coming up?">UPCOMING EVENTS</button>' +
            '</div>' +
            '<div class="ai-guide-log" data-ai-log aria-live="polite"></div>' +
            '<form class="ai-guide-form" data-ai-form>' +
                '<label class="sr-only" for="acm-ai-question">Ask the ACM AI Guide</label>' +
                '<input id="acm-ai-question" data-ai-input type="text" maxlength="700" autocomplete="off" placeholder="Ask about joining, events, workshops, interviews…">' +
                '<button type="submit" data-ai-submit>ASK</button>' +
            '</form>' +
            '<p class="mono-meta ai-guide-note">AI GUIDE // PUBLIC INFORMATION ONLY. DO NOT SHARE PASSWORDS, STUDENT IDS OR SENSITIVE INFORMATION. FOR COMMITTEE DECISIONS, USE THE CONTACT FORM.</p>' +
        '</div>';

    page.appendChild(guide);

    var script = document.createElement('script');
    script.src = '/assets/js/public-assistant.js?v=20260901-1';
    script.defer = true;
    document.body.appendChild(script);
}());
