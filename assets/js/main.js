/* ACM PSU — shared behaviour: scroll reveals, mobile nav, footer clock, public data. */

(function () {
    'use strict';

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* Reveal sections as they scroll into view. */
    var revealables = document.querySelectorAll('.reveal');

    if (reduceMotion || !('IntersectionObserver' in window)) {
        revealables.forEach(function (el) { el.classList.add('active'); });
    } else {
        var observer = new IntersectionObserver(function (entries, obs) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('active');
                    obs.unobserve(entry.target);
                }
            });
        }, { root: null, rootMargin: '0px', threshold: 0.15 });

        revealables.forEach(function (el) { observer.observe(el); });
    }

    /* Mobile navigation toggle. */
    var toggle = document.querySelector('.nav-toggle');
    var links = document.getElementById('nav-links');

    /*
     * Club/event positions are an authenticated member workflow. Public
     * visitors can discover events and join the club, but they should not see
     * internal member opportunities in the public-site header.
     */
    if (links) {
        links.querySelectorAll('a[href="positions.html"], a[href="/positions.html"]').forEach(function (link) {
            link.remove();
        });
    }

    if (toggle && links) {
        toggle.addEventListener('click', function () {
            var open = links.classList.toggle('open');
            toggle.setAttribute('aria-expanded', String(open));
        });

        links.addEventListener('click', function (event) {
            if (event.target.tagName === 'A') {
                links.classList.remove('open');
                toggle.setAttribute('aria-expanded', 'false');
            }
        });
    }

    /* Footer readout: local render time, refreshed once a minute. */
    var clock = document.querySelector('[data-clock]');

    if (clock) {
        var tick = function () {
            clock.textContent = new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
            }) + ' LOCAL';
        };
        tick();
        setInterval(tick, 60000);
    }

    /* Current year in the footer copyright. */
    document.querySelectorAll('[data-current-year]').forEach(function (el) {
        el.textContent = String(new Date().getFullYear());
    });

    function isArabic() {
        return document.documentElement.lang === 'ar';
    }

    function injectPublicEnhancementStyles() {
        if (document.getElementById('acm-public-enhancements')) return;
        var style = document.createElement('style');
        style.id = 'acm-public-enhancements';
        style.textContent = '' +
            '.leadership-label{margin:0 0 1rem;color:var(--text-muted);}' +
            '.faculty-advisors{margin-top:2rem;border-top:1px solid var(--border-color);padding-top:1.5rem;}' +
            '.faculty-advisor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;}' +
            '.faculty-advisor-card{border:1px solid var(--border-color);background:rgba(10,10,13,.72);padding:1.1rem 1.2rem;}' +
            '.faculty-advisor-card h3{margin:0 0 .35rem;font-size:1rem;}' +
            '.upcoming-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;}' +
            '.upcoming-card{border:1px solid var(--border-color);background:rgba(10,10,13,.78);padding:1.35rem;display:flex;flex-direction:column;gap:.85rem;min-height:220px;}' +
            '.upcoming-card:hover{border-color:rgba(59,130,246,.45);}' +
            '.upcoming-card-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;}' +
            '.upcoming-card h3{font-size:1.15rem;margin:0;}' +
            '.upcoming-date{color:var(--accent-blue);white-space:nowrap;}' +
            '.upcoming-card p{color:var(--text-muted);margin:0;line-height:1.65;}' +
            '.upcoming-card .project-links{margin-top:auto;}' +
            '.join-benefit-link{color:var(--accent-blue);text-decoration:underline;text-underline-offset:3px;}' +
            '@media(max-width:900px){.upcoming-grid{grid-template-columns:1fr}.faculty-advisor-grid{grid-template-columns:1fr}}';
        document.head.appendChild(style);
    }

    function applyHomeCopy() {
        if (!document.body || !document.querySelector('#about')) return;
        var ar = isArabic();
        var focusItems = document.querySelectorAll('#about .focus-item');
        var focusCopy = ar ? [
            ['هندسة البرمجيات', 'ويب · فل ستاك · تطوير بمساعدة الذكاء الاصطناعي'],
            ['البرمجة', 'حل المشكلات · الخوارزميات · المسابقات'],
            ['الأمن السيبراني', 'ويب · تشفير · أدلة رقمية · OSINT'],
            ['الورش والفعاليات', 'تعلّم · ابنِ · علّم · نافس']
        ] : [
            ['Software Engineering', 'WEB · FULL STACK · AI-ASSISTED DEVELOPMENT'],
            ['Programming', 'PROBLEM SOLVING · ALGORITHMS · COMPETITIONS'],
            ['Cybersecurity', 'WEB · CRYPTO · FORENSICS · OSINT'],
            ['Workshops & Events', 'LEARN · BUILD · TEACH · COMPETE']
        ];
        focusItems.forEach(function (item, index) {
            if (!focusCopy[index]) return;
            var title = item.querySelector('.focus-title');
            var meta = item.querySelector('.focus-meta');
            if (title) title.textContent = focusCopy[index][0];
            if (meta) meta.textContent = focusCopy[index][1];
        });

        var teamHeading = document.querySelector('#team .section-header h2');
        if (teamHeading) teamHeading.textContent = ar ? 'القيادة الحالية' : 'Current Leadership';
        var teamGrid = document.querySelector('#team .team-grid');
        if (teamGrid && !document.querySelector('[data-student-leadership-label]')) {
            var label = document.createElement('p');
            label.className = 'mono-meta leadership-label';
            label.dataset.studentLeadershipLabel = 'true';
            teamGrid.parentNode.insertBefore(label, teamGrid);
        }
        var studentLabel = document.querySelector('[data-student-leadership-label]');
        if (studentLabel) studentLabel.textContent = ar ? 'القيادة الطلابية' : 'STUDENT LEADERSHIP';

        var endingButton = document.querySelector('#join .btn-primary');
        if (endingButton) {
            var svg = endingButton.querySelector('svg');
            endingButton.childNodes[0].nodeValue = ar ? 'انضم إلى ACM ' : 'Join ACM PSU ';
            if (svg) endingButton.appendChild(svg);
        }
    }

    function applyJoinCopy() {
        var hero = document.querySelector('.membership-hero');
        if (!hero || !/join\.html$/.test(window.location.pathname)) return;
        var ar = isArabic();
        var title = hero.querySelector('.page-title');
        var intro = hero.querySelector('.membership-intro');
        if (title) title.textContent = ar ? 'انضم إلى ACM PSU' : 'Join ACM PSU';
        if (intro) intro.textContent = ar
            ? 'قدّم للانضمام إلى نادي ACM في جامعة الأمير سلطان. أنشئ حسابك، أرسل طلبك، وتابع حالته من بوابة الأعضاء.'
            : 'Apply to join the ACM student chapter at Prince Sultan University. Create your account, submit your application, and track its status from the member portal.';

        var benefits = hero.querySelector('.benefits-list');
        if (benefits && benefits.closest('.sidebar-section') && benefits.closest('.sidebar-section').querySelector('h3')) {
            var heading = benefits.closest('.sidebar-section').querySelector('h3');
            heading.textContent = ar ? 'مزايا العضوية' : 'MEMBERSHIP_BENEFITS';
            benefits.innerHTML = ar ?
                '<li class="benefit-item"><span class="benefit-icon">01</span><span class="benefit-text">المشاركة في <b>ورش ACM والفعاليات والمسابقات التقنية</b>.</span></li>' +
                '<li class="benefit-item"><span class="benefit-icon">02</span><span class="benefit-text">التقديم على <b>أدوار تنظيم الفعاليات والمشاريع</b> من خلال بوابة الأعضاء.</span></li>' +
                '<li class="benefit-item"><span class="benefit-icon">03</span><span class="benefit-text">بناء سجل موثق لمساهماتك في <b>المشاريع والورش والفعاليات</b>.</span></li>' +
                '<li class="benefit-item"><span class="benefit-icon">04</span><span class="benefit-text">تطوير خبرة عملية في <b>البرمجة والأمن السيبراني والعرض وتنظيم الفعاليات</b>.</span></li>' +
                '<li class="benefit-item"><span class="benefit-icon">05</span><span class="benefit-text">إمكانية الحصول على <a class="join-benefit-link" href="https://www.acm.org/" target="_blank" rel="noopener">اشتراك ACM.org</a> مقدم عبر النادي.</span></li>' :
                '<li class="benefit-item"><span class="benefit-icon">01</span><span class="benefit-text">Take part in <b>ACM workshops, events, and technical competitions</b>.</span></li>' +
                '<li class="benefit-item"><span class="benefit-icon">02</span><span class="benefit-text">Apply for <b>event and project organizing roles</b> through the member portal.</span></li>' +
                '<li class="benefit-item"><span class="benefit-icon">03</span><span class="benefit-text">Build a verified record of your <b>projects, workshops, and event contributions</b>.</span></li>' +
                '<li class="benefit-item"><span class="benefit-icon">04</span><span class="benefit-text">Gain practical experience in <b>programming, cybersecurity, presenting, and event organization</b>.</span></li>' +
                '<li class="benefit-item"><span class="benefit-icon">05</span><span class="benefit-text">Receive access to an <a class="join-benefit-link" href="https://www.acm.org/" target="_blank" rel="noopener">ACM.org membership subscription</a> provided through the club.</span></li>';
        }

        var faqItems = hero.querySelectorAll('.faq-item');
        if (faqItems[1]) {
            var q1 = faqItems[1].querySelector('.faq-trigger');
            var a1 = faqItems[1].querySelector('.faq-content');
            if (q1) {
                var q1svg = q1.querySelector('svg');
                q1.childNodes[0].nodeValue = ar ? 'كم يتطلب من الوقت؟ ' : 'What is the time commitment? ';
                if (q1svg) q1.appendChild(q1svg);
            }
            if (a1) a1.textContent = ar
                ? 'يعتمد الوقت على الفعاليات أو المشاريع أو الأدوار التي تختارينها، ويتم توضيح التوقعات لكل نشاط.'
                : 'The time commitment depends on the events, projects, or roles you choose. Expectations are communicated for each activity.';
        }
        if (faqItems[2]) {
            var q2 = faqItems[2].querySelector('.faq-trigger');
            var a2 = faqItems[2].querySelector('.faq-content');
            if (q2) {
                var q2svg = q2.querySelector('svg');
                q2.childNodes[0].nodeValue = ar ? 'متى يفتح التقديم؟ ' : 'When is recruitment open? ';
                if (q2svg) q2.appendChild(q2svg);
            }
            if (a2) a2.textContent = ar
                ? 'يفتح التقديم حسب دورة التجنيد الحالية. إذا كان التقديم مفتوحًا، استخدمي زر التقديم في هذه الصفحة؛ وإذا كان مغلقًا فتواصلي مع اللجنة.'
                : 'Recruitment opens by cycle. If applications are open, use the application button on this page; otherwise contact the committee.';
        }

        var preflight = hero.querySelector('.preflight-list');
        if (preflight) {
            preflight.innerHTML = ar
                ? '[✓] طالبة نشطة في PSU<br>[✓] بريد PSU<br>[✓] استعداد للتعلم والمشاركة<br>[ ] تم إرسال الطلب'
                : '[✓] ACTIVE PSU STUDENT<br>[✓] PSU EMAIL ADDRESS<br>[✓] WILLINGNESS TO LEARN & CONTRIBUTE<br>[ ] APPLICATION SUBMITTED';
        }
    }

    function ensureEnv(callback) {
        if (window.ACM_ENV && window.ACM_ENV.supabaseUrl && window.ACM_ENV.supabaseAnonKey) {
            callback(window.ACM_ENV);
            return;
        }
        var existing = document.querySelector('script[data-acm-env-loader]');
        if (existing) {
            existing.addEventListener('load', function () { if (window.ACM_ENV) callback(window.ACM_ENV); }, { once: true });
            return;
        }
        var script = document.createElement('script');
        script.src = '/assets/js/app/env.js?v=20260905-1';
        script.dataset.acmEnvLoader = 'true';
        script.addEventListener('load', function () { if (window.ACM_ENV) callback(window.ACM_ENV); }, { once: true });
        document.head.appendChild(script);
    }

    function apiGet(env, path) {
        return fetch(env.supabaseUrl + '/rest/v1/' + path, {
            headers: {
                apikey: env.supabaseAnonKey,
                Authorization: 'Bearer ' + env.supabaseAnonKey,
                Accept: 'application/json'
            }
        }).then(function (response) {
            if (!response.ok) throw new Error('Public data request failed');
            return response.json();
        });
    }

    function formatEventDate(value) {
        if (!value) return 'TBA';
        var date = new Date(value + 'T12:00:00');
        return date.toLocaleDateString(isArabic() ? 'ar-SA' : 'en-GB', {
            day: '2-digit', month: 'short', year: 'numeric'
        }).toUpperCase();
    }

    function eventStatusLabel(status) {
        if (isArabic()) return status === 'planning' ? 'قيد التخطيط' : 'نشط';
        return status === 'planning' ? 'PLANNING' : 'ACTIVE';
    }

    function renderUpcomingEvents(events) {
        var about = document.querySelector('#about');
        if (!about) return;
        var section = document.querySelector('#upcoming-events');
        if (!section) {
            section = document.createElement('section');
            section.id = 'upcoming-events';
            section.className = 'container reveal active';
            section.innerHTML = '<div class="section-header"><h2></h2><span class="mono-meta"></span></div><div class="upcoming-grid" data-upcoming-grid></div>';
            about.insertAdjacentElement('afterend', section);
        }
        section.querySelector('h2').textContent = isArabic() ? 'الفعاليات القادمة' : 'Upcoming Events';
        section.querySelector('.section-header .mono-meta').textContent = isArabic() ? 'بيانات مباشرة من سجل ACM' : 'LIVE FROM ACM RECORDS';
        var grid = section.querySelector('[data-upcoming-grid]');
        var upcoming = events.filter(function (event) {
            return event.starts_on && (event.status === 'active' || event.status === 'planning');
        }).slice(0, 3);
        if (!upcoming.length) {
            grid.innerHTML = '<div class="note-card"><p>' + (isArabic() ? 'لا توجد فعاليات عامة قادمة مسجلة حاليًا.' : 'No upcoming public events are currently listed.') + '</p></div>';
            return;
        }
        grid.innerHTML = upcoming.map(function (event) {
            var href = event.external_url || event.site_path || 'projects.html';
            var target = /^https?:\/\//.test(href) ? ' target="_blank" rel="noopener"' : '';
            var title = isArabic() && event.title_ar ? event.title_ar : event.title;
            return '<article class="upcoming-card">' +
                '<div class="upcoming-card-head"><div><span class="mono-meta tag active">' + eventStatusLabel(event.status) + '</span><h3>' + escapeHtml(title || 'ACM Event') + '</h3></div><span class="mono-meta upcoming-date">' + formatEventDate(event.starts_on) + '</span></div>' +
                '<p>' + escapeHtml(event.summary || (isArabic() ? 'فعالية عامة لنادي ACM في جامعة الأمير سلطان.' : 'A public ACM PSU event.')) + '</p>' +
                '<div class="project-links"><a class="link-arrow" href="' + escapeAttribute(href) + '"' + target + '>' + (isArabic() ? 'عرض التفاصيل ↗' : 'View event ↗') + '</a></div>' +
                '</article>';
        }).join('');
    }

    function renderFacultyAdvisors(advisors) {
        var team = document.querySelector('#team');
        if (!team) return;
        var block = team.querySelector('[data-faculty-advisors]');
        if (!block) {
            block = document.createElement('div');
            block.className = 'faculty-advisors';
            block.dataset.facultyAdvisors = 'true';
            var teamGrid = team.querySelector('.team-grid');
            if (teamGrid) teamGrid.insertAdjacentElement('afterend', block);
        }
        var publicAdvisors = advisors.filter(function (person) { return person.current_position === 'Faculty Advisor'; });
        block.innerHTML = '<p class="mono-meta leadership-label">' + (isArabic() ? 'المستشارون الأكاديميون' : 'FACULTY ADVISORS') + '</p>' +
            '<div class="faculty-advisor-grid">' + publicAdvisors.map(function (person) {
                var detail = person.department || (isArabic() ? 'جامعة الأمير سلطان' : 'Prince Sultan University');
                return '<div class="faculty-advisor-card"><h3>' + escapeHtml(person.name) + '</h3><div class="mono-meta"><span class="accent-text">' + (isArabic() ? 'مستشار أكاديمي' : 'Faculty Advisor') + '</span> // ' + escapeHtml(detail) + '</div></div>';
            }).join('') + '</div>';
    }

    function syncSelectedWork(events) {
        var cards = document.querySelectorAll('#projects .project-card');
        cards.forEach(function (card) {
            var titleEl = card.querySelector('.project-title');
            if (!titleEl) return;
            var event = events.find(function (row) { return row.title === titleEl.textContent.trim(); });
            if (!event) return;
            var dateMeta = card.querySelector('.meta-item:nth-child(2) .meta-value');
            if (dateMeta && event.starts_on) dateMeta.textContent = formatEventDate(event.starts_on);
            var eventLink = Array.prototype.find.call(card.querySelectorAll('a'), function (a) { return /Event Site/i.test(a.textContent); });
            if (eventLink && event.external_url) eventLink.href = event.external_url;
        });
    }

    function syncStructuredData(events) {
        var script = document.querySelector('script[type="application/ld+json"]');
        if (!script) return;
        try {
            var data = JSON.parse(script.textContent);
            var graph = Array.isArray(data['@graph']) ? data['@graph'] : [];
            graph = graph.filter(function (item) { return item['@type'] !== 'Event'; });
            events.filter(function (event) {
                return event.starts_on && (event.status === 'active' || event.status === 'planning');
            }).forEach(function (event) {
                var url = event.external_url || (event.site_path ? 'https://acm-psu.shoug-tech.com' + event.site_path : 'https://acm-psu.shoug-tech.com/projects.html');
                graph.push({
                    '@type': 'Event',
                    name: event.title,
                    description: event.summary || 'ACM PSU event.',
                    startDate: event.starts_on,
                    endDate: event.ends_on || event.starts_on,
                    eventStatus: 'https://schema.org/EventScheduled',
                    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
                    url: url,
                    location: {
                        '@type': 'Place',
                        name: 'Prince Sultan University',
                        address: {
                            '@type': 'PostalAddress',
                            addressLocality: 'Riyadh',
                            addressCountry: 'SA'
                        }
                    },
                    organizer: { '@id': 'https://acm-psu.shoug-tech.com/#chapter' }
                });
            });
            data['@graph'] = graph;
            script.textContent = JSON.stringify(data);
        } catch (_) {
            /* Leave the original structured data untouched if it cannot be parsed. */
        }
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttribute(value) {
        return escapeHtml(value).replace(/`/g, '&#096;');
    }

    var publicDataCache = { events: null, advisors: null };

    function renderCachedPublicData() {
        if (publicDataCache.events) {
            renderUpcomingEvents(publicDataCache.events);
            syncSelectedWork(publicDataCache.events);
            syncStructuredData(publicDataCache.events);
        }
        if (publicDataCache.advisors) renderFacultyAdvisors(publicDataCache.advisors);
    }

    function loadHomePublicData() {
        if (!document.querySelector('#about') || !document.querySelector('#team')) return;
        ensureEnv(function (env) {
            Promise.all([
                apiGet(env, 'projects?select=title,title_ar,status,summary,starts_on,ends_on,site_path,external_url&visibility=eq.public&kind=eq.event&deleted_at=is.null&order=starts_on.asc'),
                apiGet(env, 'public_member_directory?select=name,current_position,department,person_slug&current_position=eq.Faculty%20Advisor&order=name.asc')
            ]).then(function (results) {
                publicDataCache.events = results[0];
                publicDataCache.advisors = results[1];
                renderCachedPublicData();
            }).catch(function () {
                /* Public pages remain usable with their static content if live data is unavailable. */
            });
        });
    }

    injectPublicEnhancementStyles();
    applyHomeCopy();
    applyJoinCopy();
    loadHomePublicData();

    document.addEventListener('acm:languagechange', function () {
        applyHomeCopy();
        applyJoinCopy();
        renderCachedPublicData();
    });

    /* Site-wide command-palette search. */
    var nav = document.querySelector('.nav-inner');
    if (nav) {
        var utilities = nav.querySelector('.nav-utilities');
        if (!utilities) {
            utilities = document.createElement('div');
            utilities.className = 'nav-utilities';
            var navMeta = nav.querySelector('.nav-meta');
            if (navMeta) {
                nav.insertBefore(utilities, navMeta);
                utilities.appendChild(navMeta);
            } else {
                nav.appendChild(utilities);
            }
        }

        var searchItems = [
            { href: 'index.html', en: 'Home', ar: 'الرئيسية', detailEn: 'ACM PSU digital archive', detailAr: 'الأرشيف الرقمي لنادي ACM' },
            { href: 'index.html#about', en: 'About ACM PSU', ar: 'عن نادي ACM', detailEn: 'Focus areas, workshops and competitions', detailAr: 'مجالات النادي والورش والمسابقات' },
            { href: 'team.html', en: 'Team', ar: 'الأعضاء', detailEn: 'Executive council and chapter roster', detailAr: 'المجلس التنفيذي وقائمة أعضاء النادي' },
            { href: 'projects.html', en: 'Projects', ar: 'المشاريع', detailEn: 'Competitions, workshops and technical work', detailAr: 'المسابقات والورش والأعمال التقنية' },
            { href: 'projects/programming-jams/ai-programming-jam-26/archive.html', en: 'JAM.26 Resource Archive', ar: 'أرشيف موارد JAM.26', detailEn: 'Lessons, handouts, planning records and templates', detailAr: 'الدروس والنشرات وسجلات التخطيط والقوالب' },
            { href: 'projects/programming-jams/ai-programming-jam-26/', en: 'Programming Jam 2026', ar: 'معسكر البرمجة 2026', detailEn: 'AI-assisted web engineering case study', detailAr: 'دراسة حالة لهندسة الويب بالذكاء الاصطناعي' },
            { href: 'projects/ctfs/ctf-2.0/', en: 'CTF 2.0 Results', ar: 'نتائج CTF 2.0', detailEn: 'Verified scoreboard and competition report', detailAr: 'لوحة النتائج وتقرير المسابقة الموثّق' },
            { href: 'projects.html#workshops', en: 'Workshops', ar: 'الورش', detailEn: 'Programming and cybersecurity preparation', detailAr: 'ورش البرمجة والاستعداد للأمن السيبراني' },
            { href: 'join.html', en: 'Join ACM', ar: 'انضم إلى ACM', detailEn: 'Apply for the current chapter', detailAr: 'قدّم للانضمام إلى الدفعة الحالية' }
        ];

        var searchButton = document.createElement('button');
        searchButton.type = 'button';
        searchButton.className = 'site-search-trigger mono-meta';
        searchButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg><span class="search-trigger-label">Search</span><kbd>⌘K</kbd>';
        utilities.insertBefore(searchButton, utilities.querySelector('.lang-toggle'));

        var palette = document.createElement('div');
        palette.className = 'search-palette';
        palette.hidden = true;
        palette.innerHTML = '<div class="search-backdrop" data-search-close></div>' +
            '<section class="search-dialog" role="dialog" aria-modal="true" aria-labelledby="search-label">' +
                '<div class="search-input-row">' +
                    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>' +
                    '<label id="search-label" class="sr-only" for="site-search-input">Search the site</label>' +
                    '<input id="site-search-input" type="search" autocomplete="off" spellcheck="false">' +
                    '<button type="button" class="search-esc mono-meta" data-search-close>ESC</button>' +
                '</div>' +
                '<div class="search-results" role="listbox"></div>' +
                '<div class="search-help mono-meta"><span><kbd>↑↓</kbd> <b data-help-nav>navigate</b></span><span><kbd>↵</kbd> <b data-help-open>open</b></span><span><kbd>ESC</kbd> <b data-help-close>close</b></span></div>' +
            '</section>';
        document.body.appendChild(palette);

        var input = palette.querySelector('input');
        var results = palette.querySelector('.search-results');
        var activeIndex = 0;
        var filtered = searchItems.slice();

        function language() {
            return document.documentElement.lang === 'ar' ? 'ar' : 'en';
        }

        function copy() {
            var ar = language() === 'ar';
            searchButton.querySelector('.search-trigger-label').textContent = ar ? 'بحث' : 'Search';
            searchButton.setAttribute('aria-label', ar ? 'البحث في الموقع' : 'Search the site');
            input.placeholder = ar ? 'ابحث في الصفحات والمشاريع...' : 'Search pages and projects...';
            palette.querySelector('#search-label').textContent = ar ? 'البحث في الموقع' : 'Search the site';
            palette.querySelector('[data-help-nav]').textContent = ar ? 'تنقّل' : 'navigate';
            palette.querySelector('[data-help-open]').textContent = ar ? 'افتح' : 'open';
            palette.querySelector('[data-help-close]').textContent = ar ? 'إغلاق' : 'close';
        }

        function render() {
            var ar = language() === 'ar';
            var query = input.value.trim().toLocaleLowerCase();
            filtered = searchItems.filter(function (item) {
                return [item.en, item.ar, item.detailEn, item.detailAr].join(' ').toLocaleLowerCase().indexOf(query) !== -1;
            });
            activeIndex = Math.min(activeIndex, Math.max(filtered.length - 1, 0));
            if (!filtered.length) {
                results.innerHTML = '<div class="search-empty">' + (ar ? 'لا توجد نتائج مطابقة.' : 'No matching records.') + '</div>';
                return;
            }
            results.innerHTML = filtered.map(function (item, index) {
                return '<a class="search-result' + (index === activeIndex ? ' active' : '') + '" role="option" aria-selected="' + (index === activeIndex) + '" href="' + item.href + '">' +
                    '<span class="search-result-index mono-meta">0' + (index + 1) + '</span>' +
                    '<span><strong>' + (ar ? item.ar : item.en) + '</strong><small>' + (ar ? item.detailAr : item.detailEn) + '</small></span>' +
                    '<span class="search-result-arrow">↗</span></a>';
            }).join('');
        }

        function openSearch() {
            palette.hidden = false;
            document.body.classList.add('search-open');
            activeIndex = 0;
            input.value = '';
            copy();
            render();
            window.requestAnimationFrame(function () { input.focus(); });
        }

        function closeSearch() {
            palette.hidden = true;
            document.body.classList.remove('search-open');
            searchButton.focus();
        }

        searchButton.addEventListener('click', openSearch);
        palette.querySelectorAll('[data-search-close]').forEach(function (el) { el.addEventListener('click', closeSearch); });
        input.addEventListener('input', function () { activeIndex = 0; render(); });
        document.addEventListener('acm:languagechange', function () { copy(); if (!palette.hidden) { render(); } });
        document.addEventListener('keydown', function (event) {
            var tag = event.target.tagName;
            if (palette.hidden && ((event.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'))) {
                event.preventDefault(); openSearch(); return;
            }
            if (palette.hidden) { return; }
            if (event.key === 'Escape') { event.preventDefault(); closeSearch(); }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (!filtered.length) { return; }
                activeIndex = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length;
                render();
            }
            if (event.key === 'Enter' && filtered[activeIndex]) {
                event.preventDefault(); window.location.href = filtered[activeIndex].href;
            }
        });
        copy();
    }
}());
