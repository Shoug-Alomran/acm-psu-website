/* Team page — chapter-year selector.
 *
 * The current chapter is rendered in team.html so the page still works with
 * JavaScript disabled; this script swaps in other years on demand and keeps
 * the choice in the URL (?year=2025) so a roster can be linked to directly.
 *
 * ---------------------------------------------------------------------------
 * TO ADD A YEAR: add an entry to CHAPTERS below.
 *
 *   2025: {
 *       label: '2025',                 // shown in the dropdown and chips
 *       leads: [
 *           { name: 'Full Name', role: 'PRESIDENT', major: 'Software Engineering',
 *             college: 'College of Computer & Information Sciences',
 *             term: 'SEP 2025–MAY 2026', bio: 'Verified short biography.',
 *             progression: ['SEP 2025–JAN 2026 — Committee Member', 'JAN–MAY 2026 — President'],
 *             github: 'https://github.com/example', linkedin: 'https://linkedin.com/in/example',
 *             website: 'https://example.com', work: '', blueprint: '',
 *             id: '0x01_LEAD', photo: 'assets/img/people/2025/name.jpg' }
 *       ],
 *       members: [
 *           { name: 'Full Name', role: 'Cybersecurity Lead', id: '0x03',
 *             photo: 'assets/img/people/2025/name.jpg' }
 *       ]
 *   }
 *
 * Leave `leads` and `members` empty (or omit them) and the year renders an
 * "not yet digitised" placeholder instead. `photo` is optional.
 * --------------------------------------------------------------------------- */

(function () {
    'use strict';

    var CURRENT = '2026';

    var CHAPTERS = {
        '2026': { label: '2026', current: true },
        '2025': { label: '2025', leads: [], members: [] },
        '2024': { label: '2024', leads: [], members: [] },
        '2023': { label: '2023', leads: [], members: [] },
        '2022': { label: '2022', leads: [], members: [] },
        '2016': { label: 'ORIGIN_2016', leads: [], members: [] }
    };

    var ORDER = ['2026', '2025', '2024', '2023', '2022', '2016'];

    var roster = document.getElementById('roster');
    var select = document.getElementById('year-select');
    var chipBox = document.getElementById('year-chips');
    if (!roster || !select || !chipBox) { return; }

    /* The markup already in the page is the current chapter — keep it so we can
       restore it verbatim rather than re-rendering it from data. */
    var currentMarkup = roster.innerHTML;

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function hasPeople(chapter) {
        return !!chapter && (
            (chapter.leads && chapter.leads.length) ||
            (chapter.members && chapter.members.length)
        );
    }

    function photoBox(person, cls) {
        if (person.photo) {
            return '<img src="' + esc(person.photo) + '" alt="Portrait of ' +
                esc(person.name) + '" class="' + cls + '" loading="lazy">';
        }
        // No photo on file: render the initials instead of a broken image.
        var initials = String(person.name || '?').trim().split(/\s+/)
            .slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase();
        return '<div class="' + cls + '" style="display:flex;align-items:center;' +
            'justify-content:center;background:var(--bg-base);font-family:var(--font-display);' +
            'font-size:2rem;color:var(--text-dark);">' + esc(initials) + '</div>';
    }

    function profileAttrs(person) {
        var progression = Array.isArray(person.progression)
            ? person.progression.join('|')
            : (person.progression || '');
        return ' data-person-name="' + esc(person.name) + '"' +
            ' data-person-role="' + esc(person.role || 'Member') + '"' +
            ' data-person-major="' + esc(person.major || '') + '"' +
            ' data-person-college="' + esc(person.college || '') + '"' +
            ' data-person-id="' + esc(person.id || '—') + '"' +
            ' data-person-year="' + esc(person.year || '') + '"' +
            ' data-person-term="' + esc(person.term || '') + '"' +
            ' data-person-bio="' + esc(person.bio || '') + '"' +
            ' data-person-progression="' + esc(progression) + '"' +
            ' data-person-github="' + esc(person.github || '') + '"' +
            ' data-person-linkedin="' + esc(person.linkedin || '') + '"' +
            ' data-person-website="' + esc(person.website || '') + '"' +
            ' data-person-work="' + esc(person.work || '') + '"' +
            ' data-person-blueprint="' + esc(person.blueprint || '') + '"';
    }

    function renderLead(person) {
        return '<div class="lead-card person-card" role="button" tabindex="0" aria-haspopup="dialog"' +
            ' aria-label="View profile for ' + esc(person.name) + '"' +
            profileAttrs(person) + '>' +
            photoBox(person, 'lead-img') +
            '<div class="lead-content"><div>' +
            '<span class="tag tag-active">' + esc(person.role || 'OFFICER') + '</span>' +
            '<h3 class="lead-name">' + esc(person.name) + '</h3>' +
            '<p class="mono-meta">' + esc(person.major || '') + '</p>' +
            '</div><div class="mono-meta dim-text">ID: ' + esc(person.id || '—') + '</div>' +
            '</div></div>';
    }

    function renderMember(person) {
        return '<div class="member-card person-card" role="button" tabindex="0" aria-haspopup="dialog"' +
            ' aria-label="View profile for ' + esc(person.name) + '"' +
            profileAttrs(person) + '>' +
            '<div class="member-img-box">' + photoBox(person, '') + '</div>' +
            '<div class="member-info">' +
            '<h4 class="member-name">' + esc(person.name) + '</h4>' +
            '<div class="mono-meta">' + esc(person.role || '') + '</div>' +
            '<div class="mono-meta member-id">ID: ' + esc(person.id || '—') + '</div>' +
            '</div></div>';
    }

    function renderChapter(year) {
        var chapter = CHAPTERS[year];

        if (chapter && chapter.current) {
            roster.innerHTML = currentMarkup;
            return;
        }

        if (!hasPeople(chapter)) {
            roster.innerHTML =
                '<div class="roster-empty">' +
                '<div class="headline">Roster not yet digitised</div>' +
                '<p class="mono-meta">GEN_' + esc(year) + ' // NO RECORDS IN THE ARCHIVE</p>' +
                '<p class="mono-meta dim-text">If you have photos or a member list from this ' +
                'chapter, send them to the committee and we will add them.</p>' +
                '</div>';
            return;
        }

        var html = '';

        if (chapter.leads && chapter.leads.length) {
            html += '<div class="section-label"><h2>Executive Council</h2>' +
                '<span class="mono-meta">LEVEL_01 // ADMINISTRATION</span></div>' +
                '<div class="lead-grid">' + chapter.leads.map(renderLead).join('') + '</div>';
        }

        if (chapter.members && chapter.members.length) {
            html += '<div class="section-label"><h2>General Assembly</h2>' +
                '<span class="mono-meta">LEVEL_02 // CONTRIBUTORS [' +
                chapter.members.length + ']</span></div>' +
                '<div class="members-grid">' + chapter.members.map(renderMember).join('') + '</div>';
        }

        roster.innerHTML = html;
    }

    function setYear(year, push) {
        if (!CHAPTERS[year]) { year = CURRENT; }

        renderChapter(year);

        var label = CHAPTERS[year].label;
        var titleYear = document.querySelector('[data-year-label]');
        var gen = document.querySelector('[data-gen-label]');
        if (titleYear) { titleYear.textContent = '/ ' + label; }
        if (gen) { gen.textContent = 'GEN_' + year; }
        document.title = 'People / ' + label + ' — ACM PSU';

        if (select.value !== year) { select.value = year; }

        chipBox.querySelectorAll('.year-chip').forEach(function (chip) {
            chip.setAttribute('aria-pressed', String(chip.dataset.year === year));
        });

        if (push) {
            var url = year === CURRENT
                ? window.location.pathname
                : window.location.pathname + '?year=' + year;
            window.history.pushState({ year: year }, '', url);
        }
    }

    /* Build the dropdown and the quick-jump chips from CHAPTERS. */
    select.innerHTML = ORDER.map(function (year) {
        var chapter = CHAPTERS[year];
        var suffix = chapter.current
            ? ' — CURRENT CHAPTER'
            : (hasPeople(chapter) ? '' : ' — NO RECORDS');
        return '<option value="' + year + '">' + esc(chapter.label) + suffix + '</option>';
    }).join('');

    chipBox.innerHTML = ORDER.filter(function (y) { return y !== CURRENT; })
        .map(function (year) {
            var chapter = CHAPTERS[year];
            var empty = hasPeople(chapter) ? '' : ' is-empty';
            return '<button type="button" class="tag year-chip' + empty +
                '" data-year="' + year + '" aria-pressed="false">' +
                esc(chapter.label) + '</button>';
        }).join('');

    select.addEventListener('change', function () { setYear(select.value, true); });

    chipBox.addEventListener('click', function (event) {
        var chip = event.target.closest('.year-chip');
        if (!chip) { return; }
        setYear(chip.dataset.year, true);
        document.getElementById('main').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    window.addEventListener('popstate', function () {
        var params = new URLSearchParams(window.location.search);
        setYear(params.get('year') || CURRENT, false);
    });

    /* Honour ?year= on first load. */
    var initial = new URLSearchParams(window.location.search).get('year');
    setYear(initial && CHAPTERS[initial] ? initial : CURRENT, false);

    var profileDialog = document.getElementById('person-dialog');
    var profileClose = profileDialog && profileDialog.querySelector('.person-dialog-close');

    function initials(name) {
        return String(name || '?').trim().split(/\s+/).slice(0, 2)
            .map(function (word) { return word.charAt(0); }).join('').toUpperCase();
    }

    function setProfile(field, value) {
        var target = profileDialog.querySelector('[data-profile-' + field + ']');
        if (target) { target.textContent = value || '—'; }
    }

    function openProfile(card) {
        if (!profileDialog || !card) { return; }
        setProfile('name', card.dataset.personName);
        setProfile('role', card.dataset.personRole);
        setProfile('major', card.dataset.personMajor);
        setProfile('college', card.dataset.personCollege || card.dataset.personMajor);
        setProfile('year', card.dataset.personYear || document.querySelector('[data-year-label]').textContent.replace('/', '').trim());
        setProfile('id', card.dataset.personId);
        setProfile('term', card.dataset.personTerm || 'Current chapter');
        setProfile('service', card.dataset.personTerm || card.dataset.personYear || '—');
        setProfile('initials', initials(card.dataset.personName));

        var bioSection = profileDialog.querySelector('[data-profile-bio-section]');
        var bio = card.dataset.personBio || '';
        var bioContainer = profileDialog.querySelector('[data-profile-bio]');
        var bioParagraphs = bio.trim().split(/\n\s*\n/).filter(Boolean);
        bioContainer.innerHTML = bioParagraphs.map(function (paragraph, index) {
            return '<p' + (index === 0 ? ' class="bio-lead"' : '') + '>' +
                esc(paragraph.trim()) + '</p>';
        }).join('');
        bioSection.hidden = !bio;

        var majorRow = profileDialog.querySelector('[data-profile-major-row]');
        majorRow.hidden = !card.dataset.personMajor;

        var progressionSection = profileDialog.querySelector('[data-profile-progression-section]');
        var progression = (card.dataset.personProgression || '').split('|').filter(Boolean);
        progressionSection.hidden = !progression.length;
        profileDialog.querySelector('[data-profile-progression]').innerHTML = progression.map(function (item) {
            var parts = item.split(' — ');
            return '<li><span>' + esc(parts.shift()) + '</span><strong>' + esc(parts.join(' — ')) + '</strong></li>';
        }).join('');

        var linkData = [
            ['GitHub', card.dataset.personGithub],
            ['LinkedIn', card.dataset.personLinkedin],
            ['SHOUG.TECH', card.dataset.personWebsite],
            ['Work Hub', card.dataset.personWork],
            ['Blueprint', card.dataset.personBlueprint]
        ].filter(function (entry) { return entry[1]; });
        var linksSection = profileDialog.querySelector('[data-profile-links-section]');
        linksSection.hidden = !linkData.length;
        profileDialog.querySelector('[data-profile-links]').innerHTML = linkData.map(function (entry) {
            return '<a href="' + esc(entry[1]) + '" rel="noopener">' + esc(entry[0]) + '<span>↗</span></a>';
        }).join('');
        profileDialog.showModal();
    }

    roster.addEventListener('click', function (event) {
        var card = event.target.closest('.person-card');
        if (card) { openProfile(card); }
    });

    roster.addEventListener('keydown', function (event) {
        var card = event.target.closest('.person-card');
        if (card && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            openProfile(card);
        }
    });

    if (profileClose) {
        profileClose.addEventListener('click', function () { profileDialog.close(); });
        profileDialog.addEventListener('click', function (event) {
            if (event.target === profileDialog) { profileDialog.close(); }
        });
    }
}());
