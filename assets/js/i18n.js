/* ACM PSU — Arabic / English switching.
 *
 * The site is authored in English; this layer swaps the rendered text at
 * runtime rather than duplicating every page into an /ar directory. It walks
 * the DOM's text nodes and the user-visible attributes, looks each up in the
 * dictionary below, and writes the Arabic in place — keeping the English in a
 * WeakMap so switching back is exact.
 *
 * Anything absent from the dictionary is left alone on purpose. That is how the
 * terminal-styled tokens (IDs like 0x26_JAM, file names, SHA hashes, DIR paths,
 * ACM{...} flag format) stay identical in both languages.
 *
 * TO TRANSLATE NEW COPY: add "English source": "Arabic" to DICT below. Matching
 * ignores surrounding and repeated whitespace, so wrapped paragraphs can be
 * written on one line here. Text broken up by inline elements (<b>, <span>)
 * arrives as several separate text nodes, so each fragment needs its own entry.
 *
 * Dynamic content (the team-year roster, project filtering, the archive file
 * browser) is rendered by other scripts after this one runs, so a
 * MutationObserver re-applies the translation to anything newly inserted.
 */

(function () {
    'use strict';

    var STORAGE_KEY = 'acm-lang';

    var DICT = {

        /* --- Navigation and chrome, shared across pages --- */
        'Skip to content': 'تخطَّ إلى المحتوى',
        'ACM PSU — home': 'ACM PSU — الصفحة الرئيسية',
        'Toggle navigation': 'إظهار القائمة',
        'About': 'عن النادي',
        'Team': 'الأعضاء',
        'Projects': 'المشاريع',
        'Positions': 'المهام',
        'Archive': 'الأرشيف',
        'Join': 'انضم إلينا',
        'Portal': 'البوابة',
        'Contact': 'تواصل معنا',
        'Ask us anything': 'اسألنا أي شيء',
        'Digital Archive': 'الأرشيف الرقمي',
        'SYS.ARCHIVE_': 'الأرشيف_',
        '// ONLINE': '// متصل',
        'SYS.ARCHIVE // 404': 'الأرشيف // 404',
        'STATUS: ENROLLMENT_OPEN': 'الحالة: التسجيل_مفتوح',
        'STATUS: RECRUITING': 'الحالة: استقبال_المتطوعين',

        /* --- Footer --- */
        'ACM PRINCE SULTAN UNIVERSITY': 'ACM جامعة الأمير سلطان',
        'Prince Sultan University': 'جامعة الأمير سلطان',
        'College of Computer and Information Sciences': 'كلية علوم الحاسب والمعلومات',
        'College of Computer & Information Sciences': 'كلية علوم الحاسب والمعلومات',
        'RENDERED:': 'وقت العرض:',
        'DIRECTORY_STATUS:': 'حالة_الدليل:',
        'COMMITTED': 'مُثبّت',
        'RECORDS SHOWN:': 'السجلات المعروضة:',
        'AUTH_SESSION:': 'الجلسة:',
        'GUEST_USER': 'زائر',

        /* --- Home --- */
        'ACM PSU — Digital Archive': 'ACM جامعة الأمير سلطان — الأرشيف الرقمي',
        'ACM.PSU / CURRENT CHAPTER /': 'ACM.PSU / الدفعة الحالية /',
        'Association for Computing Machinery.': 'جمعية آلات الحاسب (ACM).',
        'The ACM student chapter at the College of Computer & Information Sciences. We run programming and cybersecurity competitions, teach the workshops that lead into them, and keep the record of every chapter that came before. This is our digital archive.':
            'نادي ACM الطلابي في كلية علوم الحاسب والمعلومات. ننظّم مسابقات في البرمجة والأمن السيبراني، ونقدّم الورش التي تُهيّئ لها، ونحفظ سجل كل دفعة سبقتنا. هذا هو أرشيفنا الرقمي.',
        'Explore Projects': 'تصفّح المشاريع',
        'Join ACM': 'انضم إلى ACM',

        'System Focus': 'مجالات تركيزنا',
        'CORE COMPETENCIES // V.26': 'التخصصات الأساسية // إصدار 26',
        'AI-Assisted Engineering': 'الهندسة بمساعدة الذكاء الاصطناعي',
        'PLAN, BUILD, DEBUG, DEPLOY': 'تخطيط، بناء، تصحيح، إطلاق',
        'Full-Stack Web': 'تطوير الويب المتكامل',
        'FIREBASE, GITHUB, VERCEL, CLOUDFLARE': 'FIREBASE، GITHUB، VERCEL، CLOUDFLARE',
        'Cybersecurity (CTF)': 'الأمن السيبراني (CTF)',
        'CRYPTOGRAPHY, WEB, FORENSICS, OSINT': 'التشفير، الويب، التحليل الجنائي، الاستخبارات المفتوحة',
        'Workshops & Competitions': 'الورش والمسابقات',
        'TEACH FIRST, THEN COMPETE': 'نُعلّم أولًا، ثم نتنافس',

        'Current Generation': 'الدفعة الحالية',
        'STATUS: ACTIVE CHAPTER': 'الحالة: دفعة نشطة',
        'Muhammad Yawar Hayat': 'محمد ياور حياة',
        'Shoug Alomran': 'شوق العمران',
        'President': 'رئيس النادي',
        'Vice President': 'نائبة الرئيس',
        'View Complete Roster': 'عرض القائمة الكاملة',

        'Selected Work': 'أعمال مختارة',
        'BUILT BY ACM // PRODUCTION ENV': 'من تنفيذ ACM // بيئة تشغيل فعلية',
        'PROJECT_ID': 'رقم_المشروع',
        'COMPETITION_DAY': 'يوم_المسابقة',
        'ACM Programming Jam 2026': 'معسكر ACM للبرمجة 2026',
        'An AI-assisted web engineering competition. Every team receives the same application brief, then plans it in Excalidraw, designs it, builds it with AI assistants and Firebase, ships it to Vercel behind a real domain, absorbs a mid-competition change request, and presents the result. Three preparation workshop days run 15–17 September; the brief stays locked until competition day.':
            'مسابقة في هندسة الويب بمساعدة الذكاء الاصطناعي. يستلم كل فريق الوصف نفسه للتطبيق المطلوب، ثم يخطّط له في Excalidraw، ويصمّمه، ويبنيه بأدوات الذكاء الاصطناعي وFirebase، وينشره على Vercel تحت نطاق حقيقي، ويستوعب طلب تغيير في منتصف المسابقة، ثم يقدّم النتيجة. تسبقها ثلاثة أيام من الورش التحضيرية من 15 إلى 17 سبتمبر، ويبقى وصف المشروع سريًا حتى يوم المسابقة.',
        'Case Study': 'دراسة الحالة',
        'Event Site': 'موقع الفعالية',
        'ACM/CyberTech CTF 3.0': 'مسابقة ACM/CyberTech CTF 3.0',
        'A three-hour jeopardy-style Capture The Flag run jointly with the CyberTech Club. Four attack vectors — cryptography, web, forensics and OSINT — scaled from Very Easy to Insane. Teams of two to three submit flags in':
            'مسابقة التقاط الأعلام على مدى ثلاث ساعات بنظام Jeopardy، تُقام بالشراكة مع نادي CyberTech. أربعة مسارات — التشفير، والويب، والتحليل الجنائي، والاستخبارات مفتوحة المصدر — بمستويات صعوبة تتدرّج من السهل جدًا إلى الجنوني. تتنافس فرق من فردين إلى ثلاثة بإرسال الأعلام بصيغة',
        'format for points on a live scoreboard. Saturday 24 October 2026, 10:00–13:00, Auditorium B105.':
            'لكسب النقاط على لوحة نتائج مباشرة. السبت 24 أكتوبر 2026، من 10:00 إلى 13:00، قاعة B105.',
        'CTF 2.0 Results': 'نتائج CTF 2.0',

        'Club Collaborations': 'التعاون مع الأندية',
        'SHARED PROJECTS // DOCUMENTED HISTORY': 'مشاريع مشتركة // تاريخ موثّق',
        "Building PSU's Capture The Flag series together.": 'نبني معًا سلسلة مسابقات التقاط الأعلام في جامعة الأمير سلطان.',
        'The ACM Club and CyberTech Club collaborate on the ACM/CyberTech Capture The Flag series at Prince Sultan University. The partnership brings students together around practical cybersecurity training, challenge-based competition and a shared record of each edition. Published materials currently document three editions, from the inaugural CTF 1.0 through the upcoming CTF 3.0.':
            'يتعاون ناديا ACM وCyberTech في تنظيم سلسلة مسابقات ACM/CyberTech لالتقاط الأعلام في جامعة الأمير سلطان. تجمع هذه الشراكة الطلاب حول التدريب العملي في الأمن السيبراني، والمنافسة القائمة على التحديات، وتوثيق مشترك لكل نسخة. توثّق المواد المنشورة حاليًا ثلاث نسخ، بدءًا من CTF 1.0 الافتتاحية وحتى CTF 3.0 القادمة.',
        'Explore CTF 3.0': 'استكشف CTF 3.0',
        'View CTF 2.0 Results': 'عرض نتائج CTF 2.0',
        'COLLABORATORS': 'الجهات المتعاونة',
        'ACM CLUB × CYBERTECH CLUB': 'نادي ACM × نادي CYBERTECH',
        'MILESTONE': 'المحطة',
        'INAUGURAL JOINT CTF': 'أول مسابقة CTF مشتركة',
        'ARCHIVE MATERIAL PENDING': 'مواد الأرشيف قيد الانتظار',
        'PAST EDITION': 'نسخة سابقة',
        'VERIFIED OUTCOME': 'نتيجة موثّقة',
        '11 TEAMS // 852 SUBMISSIONS // HZ WON': '11 فريقًا // 852 محاولة // فوز HZ',
        'PUBLIC RECORD': 'السجل العام',
        'RESULTS + PRIVACY-SAFE REPORT': 'النتائج + تقرير يحمي الخصوصية',
        'CURRENT PROGRAMME': 'البرنامج الحالي',
        '04 TRAINING TRACKS + CAPTURE THE FLAG': '04 مسارات تدريبية + مسابقة التقاط الأعلام',
        'COMPETITION': 'المسابقة',
        '24 OCT 2026 // AUDITORIUM B105': '24 أكتوبر 2026 // قاعة B105',
        'ACTIVE': 'نشط',
        'The Collaboration': 'الشراكة',
        'A continuing joint series': 'سلسلة مشتركة مستمرة',
        "CTF 3.0 continues the Capture The Flag series organized jointly by the ACM Club and CyberTech Club at Prince Sultan University's College of Computer and Information Sciences. The collaboration connects ACM's wider computing community with CyberTech's cybersecurity focus in one practical programme.":
            'تواصل CTF 3.0 سلسلة مسابقات التقاط الأعلام التي ينظمها ناديا ACM وCyberTech معًا في كلية علوم الحاسب والمعلومات بجامعة الأمير سلطان. تجمع الشراكة مجتمع ACM الأوسع في الحوسبة مع تركيز CyberTech على الأمن السيبراني ضمن برنامج عملي واحد.',
        'Training before competition': 'التدريب قبل المنافسة',
        'The shared programme is broader than competition day. Preparation workshops introduce the same four domains used in the CTF—cryptography, web security, digital forensics and OSINT—before participants enter the cyber range.':
            'يمتد البرنامج المشترك إلى ما هو أبعد من يوم المسابقة. تعرّف الورش التحضيرية بالمجالات الأربعة المستخدمة في CTF — التشفير، وأمن الويب، والتحليل الجنائي الرقمي، والاستخبارات مفتوحة المصدر — قبل دخول المشاركين إلى الميدان السيبراني.',
        'A record across editions': 'سجل يمتد عبر النسخ',
        'The archive identifies CTF 1.0 as the inaugural joint edition, preserves verified results and aggregate analytics from CTF 2.0, and documents the schedule and format of CTF 3.0 as the current collaboration.':
            'يوثّق الأرشيف CTF 1.0 بوصفها النسخة المشتركة الافتتاحية، ويحفظ النتائج الموثّقة والتحليلات الإجمالية من CTF 2.0، ويسجّل جدول وصيغة CTF 3.0 بوصفها الشراكة الحالية.',
        'Open the collaboration archive': 'افتح أرشيف الشراكة',

        'Archive Directory': 'دليل الأرشيف',
        'HISTORICAL DATA // READ-ONLY': 'بيانات تاريخية // للقراءة فقط',
        'FLAGSHIP EVENTS': 'الفعاليات الرئيسية',
        'WORKSHOP DAYS': 'أيام الورش',
        '07 SCHEDULED': '07 مجدولة',
        'LEADERSHIP': 'القيادة',
        'M. Y. HAYAT': 'م. ي. حياة',
        'ACTIVE CHAPTER': 'دفعة نشطة',
        'TEAMS RANKED': 'الفرق المصنّفة',
        'SUBMISSIONS': 'المحاولات',
        '852 // 89 CAPTURED': '852 // 89 علمًا',
        'WINNER': 'الفائز',
        'HZ — 3,800 PTS': 'HZ — 3,800 نقطة',
        'RESULTS VERIFIED': 'النتائج موثّقة',
        'EDITION': 'النسخة',
        'FIRST ACM/CYBERTECH CTF': 'أول مسابقة ACM/CYBERTECH',
        'RECORDS': 'السجلات',
        'NOT YET DIGITISED': 'لم تُؤرشف بعد',
        'STATUS': 'الحالة',
        'ARCHIVE PENDING': 'بانتظار الأرشفة',
        'ARCHIVED': 'مؤرشَف',
        'Open the CTF 2.0 Results Archive': 'افتح أرشيف نتائج CTF 2.0',
        'Browse the JAM.26 Resource Archive': 'تصفّح أرشيف موارد JAM.26',

        'SYS.MSG: EOF NOT REACHED': 'رسالة النظام: لم نبلغ النهاية بعد',
        "The Archive Isn't Finished.": 'الأرشيف لم يكتمل بعد.',
        'Your code, your designs, your leadership could define the next block.':
            'كودك، وتصاميمك، وقيادتك قد تكون هي الفصل القادم في هذا الأرشيف.',
        'Initialize Membership': 'ابدأ عضويتك',

        /* --- Team --- */
        'People / 2026 — ACM PSU': 'الأعضاء / 2026 — ACM جامعة الأمير سلطان',
        'DIRECTORY': 'الدليل',
        'PEOPLE': 'الأعضاء',
        'People': 'الأعضاء',
        'GEN_2026': 'دفعة_2026',
        'Executive Council': 'المجلس التنفيذي',
        'LEVEL_01 // ADMINISTRATION': 'المستوى_01 // الإدارة',
        'PRESIDENT': 'رئيس النادي',
        'VICE PRESIDENT': 'نائبة الرئيس',
        'General Assembly': 'الجمعية العمومية',
        'PEOPLE / PROFILE': 'الأعضاء / الملف الشخصي',
        'Member profile': 'الملف الشخصي للعضو',
        'Role': 'الدور',
        'Major': 'التخصص',
        'College': 'الكلية',
        'Chapter': 'الدفعة',
        'ACM service': 'الخدمة في ACM',
        'Record ID': 'معرّف السجل',
        'RECORD:': 'السجل:',
        'Current chapter': 'الدفعة الحالية',
        'BIO': 'نبذة',
        'ROLE PROGRESSION': 'التدرّج في الأدوار',
        'CONNECTED SYSTEMS': 'الروابط والمنصات',
        'Close profile': 'إغلاق الملف الشخصي',
        'BLUEPRINT ↗': 'بلو برنت ↗',
        'LEVEL_02 // ROSTER PENDING': 'المستوى_02 // القائمة قيد الإعداد',
        'Committee roster in progress': 'قائمة اللجان قيد الإعداد',
        'GEN_2026 // ORGANISING COMMITTEE NOT YET PUBLISHED': 'دفعة_2026 // لم تُنشر اللجنة المنظّمة بعد',
        'Names and roles for the JAM.26 and CTF 3.0 organising committees are confirmed as each event team is finalised. If you are on a committee and want your entry added, send your name, role and photo to the chapter board.':
            'تُعتمد أسماء وأدوار اللجان المنظّمة لمعسكر JAM.26 ومسابقة CTF 3.0 فور اكتمال فريق كل فعالية. إذا كنت عضوًا في إحدى اللجان وترغب بإضافة بياناتك، أرسل اسمك ودورك وصورتك إلى مجلس إدارة النادي.',
        'HISTORICAL RECURSION // SELECT PREVIOUS GENERATION': 'أرشيف الدفعات // اختر دفعة سابقة',
        'Select chapter year': 'اختر سنة الدفعة',
        '2026 — CURRENT CHAPTER': '2026 — الدفعة الحالية',
        '2025 — NO RECORDS': '2025 — لا توجد سجلات',
        '2024 — NO RECORDS': '2024 — لا توجد سجلات',
        '2023 — NO RECORDS': '2023 — لا توجد سجلات',
        '2022 — NO RECORDS': '2022 — لا توجد سجلات',
        'ORIGIN_2016 — NO RECORDS': 'التأسيس_2016 — لا توجد سجلات',
        'ORIGIN_2016': 'التأسيس_2016',
        'Roster not yet digitised': 'لم تُؤرشف قائمة هذه الدفعة بعد',
        'If you have photos or a member list from this chapter, send them to the committee and we will add them.':
            'إذا كان لديك صور أو قائمة بأعضاء هذه الدفعة، أرسلها إلى اللجنة وسنضيفها إلى الأرشيف.',

        /* --- Projects --- */
        'Technical Collection — ACM PSU': 'المجموعة التقنية — ACM جامعة الأمير سلطان',
        'Workshop Resource Archive': 'أرشيف موارد الورش',
        '03 DAYS // 14 DOCUMENTS': '03 أيام // 14 مستندًا',
        'The working library behind JAM.26: participant-facing lessons and checklists, instructor planning records, and reusable templates for future workshops and competitions. Draft planning files are labeled separately from published learning material so participants can tell what is ready to use.':
            'المكتبة العملية خلف JAM.26: دروس وقوائم تحقق للمشاركين، وسجلات تخطيط للمدربين، وقوالب قابلة لإعادة الاستخدام في الورش والمسابقات المستقبلية. تُصنّف ملفات التخطيط الأولية بصورة منفصلة عن المواد التعليمية المنشورة حتى يعرف المشاركون ما هو جاهز للاستخدام.',
        'Participant Learning Material': 'مواد تعلم المشاركين',
        'PUBLISHED': 'منشور',
        'Planning & Development Workflow': 'التخطيط ومسار التطوير',
        'Requirements, Excalidraw system mapping, Variant UI planning, local tooling, Git/GitHub and responsible AI-assisted implementation.':
            'المتطلبات، ورسم النظام في Excalidraw، وتخطيط الواجهة في Variant، وأدوات التطوير المحلية، وGit/GitHub، والتنفيذ المسؤول بمساعدة الذكاء الاصطناعي.',
        'Read lesson': 'اقرأ الدرس',
        'Checklist PDF': 'قائمة التحقق PDF',
        'Full-Stack Development & Debugging': 'تطوير Full-Stack وتصحيح الأخطاء',
        'Firebase Authentication, Firestore persistence, user-owned data, security rules, browser evidence and systematic debugging.':
            'مصادقة Firebase، واستمرارية البيانات في Firestore، وملكية المستخدم للبيانات، وقواعد الأمان، وأدلة المتصفح، والتصحيح المنهجي.',
        'Deployment, Discovery & Optimization': 'النشر والاكتشاف والتحسين',
        'Vercel deployment, Cloudflare DNS, production verification, search discovery, PageSpeed analysis and production debugging.':
            'النشر عبر Vercel، وDNS عبر Cloudflare، والتحقق من بيئة الإنتاج، واكتشاف البحث، وتحليل PageSpeed، وتصحيح مشكلات الإنتاج.',
        'Instructor Workshop Plans': 'خطط الورش للمدربين',
        'WORKING DRAFTS': 'مسودات عمل',
        'These filled planning records contain objectives, prerequisites, preparation tasks, lesson timing, demonstrations, exercises, prompt examples, troubleshooting guidance and post-workshop review fields. “TBD” and “Not Started” values remain part of the source planning documents.':
            'تحتوي سجلات التخطيط المعبأة على الأهداف والمتطلبات السابقة ومهام التحضير وتوقيت الدروس والعروض والتمارين وأمثلة الأوامر وإرشادات معالجة المشكلات وحقول مراجعة ما بعد الورشة. تبقى قيم «يحدد لاحقًا» و«لم يبدأ» جزءًا من مستندات التخطيط الأصلية.',
        'Planning record · PDF': 'سجل تخطيط · PDF',
        'Reusable Project Templates': 'قوالب مشاريع قابلة لإعادة الاستخدام',
        'BLANK TEMPLATES': 'قوالب فارغة',
        'Blank structures for future ACM projects. These are working templates rather than event announcements; placeholder fields must be completed and reviewed before publication.':
            'هياكل فارغة لمشاريع ACM المستقبلية. هذه قوالب عمل وليست إعلانات فعاليات؛ يجب إكمال الحقول المؤقتة ومراجعتها قبل النشر.',
        'Workshop': 'ورشة',
        'Judging': 'التحكيم',
        'Challenge': 'التحدي',
        'Organizer': 'التنظيم',
        'Supplemental Resource': 'مورد إضافي',
        'Archive integrity note': 'ملاحظة نزاهة الأرشيف',
        'A second copy of the JAM planning files was uploaded under the CTF 3.0 workshop directory. File hashes and content are identical, including the AI web-development curriculum, so those copies are retained as source material but are not published or described as CTF training.':
            'رُفعت نسخة ثانية من ملفات تخطيط JAM داخل دليل ورش CTF 3.0. تتطابق بصمات الملفات ومحتواها، بما في ذلك منهج تطوير الويب بالذكاء الاصطناعي؛ لذلك تُحفظ تلك النسخ كمواد مصدر ولا تُنشر أو توصف كتدريب لمسابقة CTF.',
        'Technical': 'المجموعة',
        'Collection.': 'التقنية.',
        'Filter projects by category': 'تصفية المشاريع حسب التصنيف',
        'ALL': 'الكل',
        'JAM': 'المعسكر',
        'CTF': 'CTF',
        'WORKSHOPS': 'الورش',
        'Search projects': 'ابحث في المشاريع',
        'grep search_projects...': 'grep ابحث_في_المشاريع...',
        'COMPETITION: 19 SEP 2026': 'المسابقة: 19 سبتمبر 2026',
        'COMPETITION: 24 OCT 2026': 'المسابقة: 24 أكتوبر 2026',
        'STATUS: RESULTS VERIFIED': 'الحالة: النتائج موثّقة',
        'RUNS: 15–17 SEP 2026': 'تُقام: 15–17 سبتمبر 2026',
        'RUNS: 21–22 OCT 2026': 'تُقام: 21–22 أكتوبر 2026',
        'An AI-assisted web engineering competition. Every team gets the same brief, then plans, designs, builds, deploys and presents a working application — and adapts to a requirement change mid-competition. Scored out of 100 across seven categories.':
            'مسابقة في هندسة الويب بمساعدة الذكاء الاصطناعي. يستلم كل فريق الوصف نفسه، ثم يخطّط ويصمّم ويبني وينشر ويقدّم تطبيقًا يعمل فعليًا، مع التعامل مع تغيير في المتطلبات أثناء المسابقة. التقييم من 100 درجة موزّعة على سبعة معايير.',
        'Three hours, four attack vectors: cryptography, web, forensics and OSINT. Teams of two to three, difficulty scaled Very Easy through Insane, flags submitted as':
            'ثلاث ساعات وأربعة مسارات: التشفير، والويب، والتحليل الجنائي، والاستخبارات مفتوحة المصدر. فرق من فردين إلى ثلاثة، بمستويات صعوبة من السهل جدًا إلى الجنوني، وتُرسل الأعلام بصيغة',
        'against a live scoreboard. Auditorium B105, 10:00–13:00.':
            'على لوحة نتائج مباشرة. قاعة B105، من 10:00 إلى 13:00.',
        'CTF 2.0 — Results Archive': 'CTF 2.0 — أرشيف النتائج',
        'The previous edition, in full: 11 teams, 16+ challenges, 852 flag submissions at a 10.4% solve rate, and a final leaderboard topped by HZ on 3,800 points. Includes per-challenge solve notes and the official competition report.':
            'النسخة السابقة كاملةً: 11 فريقًا، وأكثر من 16 تحديًا، و852 محاولة إرسال بنسبة حل 10.4٪، ولوحة نتائج نهائية تصدّرها فريق HZ بـ 3,800 نقطة. تتضمن ملاحظات الحل لكل تحدٍّ والتقرير الرسمي للمسابقة.',
        'JAM.26 Workshop Programme': 'برنامج ورش JAM.26',
        'Three days that walk through the exact workflow used on competition day: planning and requirements, full-stack build and systematic debugging, then deployment, domains, search indexing and PageSpeed measurement. Developed and taught by Shoug Alomran.':
            'ثلاثة أيام تمرّ على مسار العمل نفسه المستخدم يوم المسابقة: التخطيط وتحديد المتطلبات، ثم البناء المتكامل والتصحيح المنهجي، ثم النشر والنطاقات وفهرسة محركات البحث وقياس الأداء عبر PageSpeed. من إعداد وتقديم شوق العمران.',
        'CTF 3.0 Training Workshops': 'ورش التدريب على CTF 3.0',
        'Preparation sessions across the four competition categories — web exploitation, applied cryptography, digital forensics and intelligence gathering — so first-time competitors arrive with a working toolkit. Titles and instructors to be announced.':
            'جلسات تحضيرية تغطي مسارات المسابقة الأربعة — استغلال الويب، والتشفير التطبيقي، والتحليل الجنائي الرقمي، وجمع المعلومات — ليصل المتسابقون الجدد بأدوات جاهزة للعمل. تُعلن العناوين والمدرّبون لاحقًا.',
        'AI / WEB': 'ذكاء اصطناعي / ويب',
        'CYBERSECURITY': 'الأمن السيبراني',
        'WORKSHOP': 'ورشة عمل',
        'ARCHIVE': 'أرشيف',
        'View Case Study': 'عرض دراسة الحالة',
        'Open Event Site': 'افتح موقع الفعالية',
        'View Results': 'عرض النتائج',
        'Open Resource Archive': 'افتح أرشيف الموارد',
        'NO RECORDS MATCH THIS QUERY.': 'لا توجد سجلات مطابقة لهذا البحث.',
        'ACM Programming Jam 2026 banner': 'لافتة معسكر ACM للبرمجة 2026',
        'ACM/CyberTech CTF 3.0 banner': 'لافتة مسابقة ACM/CyberTech CTF 3.0',
        'CTF 2.0 final scoreboard': 'لوحة النتائج النهائية لمسابقة CTF 2.0',

        /* --- Open positions --- */
        'Open Positions — ACM PSU': 'المهام المتاحة — ACM جامعة الأمير سلطان',
        'Choose Your': 'اختر مجال',
        'Contribution.': 'مساهمتك.',
        'Every opening shows the same information to every member: the work, requirements, commitment, capacity, deadline, and selection method. Places are confirmed by the server in submission order.':
            'تُعرض المعلومات نفسها لكل عضو في كل مهمة: العمل المطلوب، والمتطلبات، والالتزام، والسعة، والموعد النهائي، وطريقة الاختيار. يؤكد النظام المقاعد حسب ترتيب وصول الطلبات.',
        'FAIR_ACCESS_PROTOCOL': 'بروتوكول_الفرص_العادلة',
        'One active assignment per student. Registration closes automatically at capacity; organizers may enable a timestamped waitlist.':
            'مهمة نشطة واحدة لكل طالب. يُغلق التسجيل تلقائيًا عند اكتمال العدد، ويمكن للمنظمين تفعيل قائمة انتظار مؤرخة.',
        'LIVE REGISTRY': 'السجل المباشر',
        'Open assignments': 'المهام المتاحة',
        'Refresh availability': 'تحديث المقاعد',
        'CONNECTING TO ASSIGNMENT REGISTRY...': 'جارٍ الاتصال بسجل المهام...',
        'REGISTRY NOT CONFIGURED — follow apps-script/SETUP.md to connect the positions sheet.': 'لم يُربط سجل المهام بعد — اتبع ملف apps-script/SETUP.md لربط الجدول.',
        'Responsibilities': 'المسؤوليات',
        'Requirements': 'المتطلبات',
        'Commitment': 'الالتزام',
        'Deadline': 'الموعد النهائي',
        'Selection': 'طريقة الاختيار',
        'Sign up for assignment': 'سجّل في المهمة',
        'Registration closed': 'التسجيل مغلق',
        'Join waitlist': 'انضم لقائمة الانتظار',
        'Claim position': 'طلب المهمة',
        'Full name': 'الاسم الكامل',
        'PSU email': 'البريد الجامعي',
        'Why are you interested?': 'لماذا تهتم بهذه المهمة؟',
        'MAX 600 CHARACTERS': '600 حرف كحد أقصى',
        'Briefly explain your interest and any relevant experience.': 'اشرح باختصار اهتمامك وأي خبرة ذات صلة.',
        'I have read the responsibilities, availability, and time commitment, and I can complete this assignment.': 'قرأت المسؤوليات والمقاعد المتاحة والالتزام الزمني، ويمكنني إكمال هذه المهمة.',
        'Submit assignment request': 'إرسال طلب المهمة',
        'NO OPEN ASSIGNMENTS': 'لا توجد مهام متاحة',
        'Check back when the next project sprint begins.': 'تحقق مجددًا عند بدء مرحلة المشروع القادمة.',

        /* --- Join --- */
        'Initialize Membership — ACM PSU': 'ابدأ عضويتك — ACM جامعة الأمير سلطان',
        '[ ACTION: INITIALIZE_MEMBERSHIP ]': '[ الإجراء: بدء_العضوية ]',
        'Join the Collective': 'انضم إلى التجمّع',
        'ACM PSU is looking for the next generation of engineers, researchers, and hackers. Complete the handshake protocol below to apply for the 2026 cohort.':
            'نادي ACM في جامعة الأمير سلطان يبحث عن الجيل القادم من المهندسين والباحثين والمبرمجين. أكمل النموذج أدناه للتقديم على دفعة 2026.',
        'Full Name': 'الاسم الكامل',
        'STR_REQ': 'حقل_مطلوب',
        'e.g. Faisal Al-Dosari': 'مثال: فيصل الدوسري',
        'PSU Email': 'البريد الجامعي',
        'EMAIL_VALIDATE': 'بريد_إلكتروني',
        'Student ID': 'الرقم الجامعي',
        'ID_REQ': 'رقم_مطلوب',
        'e.g. 221100234': 'مثال: 221100234',
        'Major': 'التخصص',
        'e.g. Computer Science': 'مثال: علوم الحاسب',
        'Academic Year': 'السنة الدراسية',
        'Select Year': 'اختر السنة',
        'Freshman (Y1)': 'السنة الأولى',
        'Sophomore (Y2)': 'السنة الثانية',
        'Junior (Y3)': 'السنة الثالثة',
        'Senior (Y4)': 'السنة الرابعة',
        'Graduate': 'دراسات عليا',
        'What are you interested in?': 'ما الذي يهمّك؟',
        'Select Core': 'اختر المجال',
        'Select an interest': 'اختر اهتمامًا',
        'Technical tracks': 'المسارات التقنية',
        'Club contribution roles': 'أدوار المساهمة في النادي',
        'SELECT ALL THAT APPLY': 'اختر كل ما ينطبق',
        'SELECT AT LEAST ONE INTEREST.': 'اختر اهتمامًا واحدًا على الأقل.',
        'Software Engineering': 'هندسة البرمجيات',
        'Cybersecurity': 'الأمن السيبراني',
        'AI / Data Science': 'الذكاء الاصطناعي / علم البيانات',
        'Competitive Programming': 'البرمجة التنافسية',
        'UI/UX Design': 'تصميم تجربة المستخدم',
        'Workshop Content Development': 'إعداد محتوى الورش',
        'Workshop Presenting / Teaching': 'تقديم الورش / التدريب',
        'Content Writing / Social Media': 'كتابة المحتوى / التواصل الاجتماعي',
        'Graphic Design / Branding': 'التصميم الجرافيكي / الهوية البصرية',
        'Photography / Video Production': 'التصوير / إنتاج الفيديو',
        'Event Planning / Operations': 'تخطيط الفعاليات / التشغيل',
        'Community Outreach / Partnerships': 'التواصل المجتمعي / الشراكات',
        'Website / Technical Support': 'الموقع الإلكتروني / الدعم التقني',
        'LinkedIn / GitHub / Portfolio': 'لينكدإن / GitHub / معرض الأعمال',
        'OPTIONAL': 'اختياري',
        'What would you like to gain experience in?': 'في أي مجال تودّ اكتساب الخبرة؟',
        'Briefly describe your interests and what you hope to contribute...':
            'اكتب باختصار عن اهتماماتك وما تطمح إلى الإسهام به...',
        'Leave this field empty': 'اترك هذا الحقل فارغًا',
        'Execute Handshake [Enter]': 'إرسال الطلب [Enter]',

        'MEMBERSHIP_BENEFITS': 'مزايا_العضوية',
        'Access to': 'الوصول إلى',
        'ACM Lab Hardware': 'أجهزة مختبر ACM',
        '(GPU clusters, IoT kits).': '(وحدات معالجة رسومية وأطقم إنترنت الأشياء).',
        'Exclusive entry to': 'دخول حصري إلى',
        'Member Jams': 'معسكرات الأعضاء',
        'and regional ICPC training.': 'والتدريب الإقليمي على ICPC.',
        'Professional': 'شبكة',
        'Network Tunneling': 'تواصل مهنية',
        'to PSU alumni at tech giants.': 'مع خريجي الجامعة في كبرى شركات التقنية.',
        'Contributor credits on': 'توثيق مساهماتك في',
        'ACM Production Systems': 'أنظمة ACM التشغيلية',

        'FAQ_REGISTRY': 'الأسئلة_الشائعة',
        'Do I need prior experience?': 'هل أحتاج إلى خبرة سابقة؟',
        'No. We look for curiosity and logical aptitude. If you can learn, you can join.':
            'لا. نبحث عن الفضول والقدرة على التفكير المنطقي. إذا كنت مستعدًا للتعلّم، فمكانك معنا.',
        'What is the time commitment?': 'كم يتطلب الالتزام من وقت؟',
        'Standard members commit ~3-5 hours/week for workshops and project sprints.':
            'يخصّص العضو عادةً من 3 إلى 5 ساعات أسبوعيًا للورش ومراحل تنفيذ المشاريع.',
        'Application deadline?': 'ما آخر موعد للتقديم؟',
        'Recruitment cycles happen at the start of every semester. Current cycle ends Oct 15.':
            'يفتح باب الانضمام مع بداية كل فصل دراسي. الدورة الحالية تنتهي في 15 أكتوبر.',

        'PRE_FLIGHT_CHECK': 'تحقق_قبل_الإرسال',
        '[✓] ACTIVE PSU STUDENT ID': '[✓] رقم جامعي فعّال',
        '[✓] PASSION FOR PROBLEM SOLVING': '[✓] شغف بحل المشكلات',
        '[✓] BASIC GIT KNOWLEDGE (PREFERRED)': '[✓] إلمام أساسي بـ Git (يُفضّل)',
        '[ ] FORM SUBMITTED': '[ ] تم إرسال النموذج',

        'TRANSMITTING...': 'جارٍ الإرسال...',
        'FORM BACKEND NOT CONFIGURED — applications are not being received yet. Please email acm@psu.edu.sa with your answers in the meantime.':
            'لم يُربط النموذج بعد — الطلبات غير مستلمة حاليًا. يرجى إرسال إجاباتك إلى acm@psu.edu.sa في هذه الأثناء.',
        'HANDSHAKE COMPLETE — application received. We will be in touch.':
            'تم الإرسال بنجاح — استلمنا طلبك وسنتواصل معك قريبًا.',
        'TRANSMISSION FAILED — please retry, or email acm@psu.edu.sa.':
            'فشل الإرسال — يرجى المحاولة مجددًا أو مراسلتنا على acm@psu.edu.sa.',

        /* --- 404 --- */
        'Record Not Found': 'الصفحة غير موجودة',
        'The path you requested is not in the archive. It may have been moved, renamed, or never committed.':
            'المسار الذي طلبته غير موجود في الأرشيف. ربما نُقل أو غُيّر اسمه أو لم يُضف أصلًا.',
        'Return to Index': 'العودة إلى الرئيسية',

        /* --- Archive project page --- */
        'AI Programming Jam — ACM PSU Archive': 'معسكر الذكاء الاصطناعي البرمجي — أرشيف ACM',
        'AI Programming Jam': 'معسكر الذكاء الاصطناعي البرمجي',
        'An intensive 48-hour competitive programming event focusing on the implementation of generative models and algorithmic efficiency. Includes workshops, official submissions, and event collateral.':
            'فعالية برمجة تنافسية مكثّفة على مدى 48 ساعة، تركّز على بناء النماذج التوليدية وكفاءة الخوارزميات. تشمل الورش والمشاركات الرسمية ومواد الفعالية.',
        'STATUS: ARCHIVED': 'الحالة: مؤرشَف',
        '34 FILES': '34 ملفًا',
        '8 DIRECTORIES': '8 مجلدات',
        'LAST UPDATED: 26 SEP 2026': 'آخر تحديث: 26 سبتمبر 2026',
        'ALL PROJECTS': 'كل المشاريع',
        'Archive sections': 'أقسام الأرشيف',
        'ALL FILES': 'كل الملفات',
        'WEBSITE': 'الموقع',
        'BRANDING': 'الهوية البصرية',
        'DOCUMENTS': 'المستندات',
        'REGISTRATION': 'التسجيل',
        'RESULTS': 'النتائج',
        'ALL_FILES': 'كل_الملفات',
        'List view': 'عرض كقائمة',
        'Grid view': 'عرض كشبكة',
        'Search files': 'ابحث في الملفات',
        'search_files...': 'ابحث_في_الملفات...',
        'Filter files by type': 'تصفية الملفات حسب النوع',
        'MEDIA': 'وسائط',
        'LINKS': 'روابط',
        'PINNED / 04': 'مثبّت / 04',
        'Official Website': 'الموقع الرسمي',
        'Competition Rules': 'قواعد المسابقة',
        'Workshop Material': 'مواد الورش',
        'Final Results': 'النتائج النهائية',
        'NAME': 'الاسم',
        'TYPE': 'النوع',
        'SECTION': 'القسم',
        'UPDATED': 'آخر تحديث',
        'SIZE': 'الحجم',
        'ACT': 'إجراء',
        'ROOT': 'الجذر',
        '12 ITEMS': '12 عنصرًا',
        '45 ITEMS': '45 عنصرًا',
        '8 ITEMS': '8 عناصر',
        '2 ITEMS': 'عنصران',
        'NO FILES MATCH THIS QUERY.': 'لا توجد ملفات مطابقة لهذا البحث.',
        'FILE PREVIEW': 'معاينة الملف',
        'Close preview': 'إغلاق المعاينة',
        'Zoom in': 'تكبير',
        'Zoom out': 'تصغير',
        'Type': 'النوع',
        'Size': 'الحجم',
        'Uploaded': 'تاريخ الرفع',
        'Path': 'المسار',
        'Adobe PDF': 'مستند PDF',
        'HTML Document': 'مستند HTML',
        'PNG Image': 'صورة PNG',
        'Excel Workbook': 'جدول Excel',
        'CSV Document': 'ملف CSV',
        'Internet Shortcut': 'اختصار إنترنت',
        'PowerPoint Presentation': 'عرض PowerPoint',
        'ZIP Archive': 'أرشيف ZIP',
        'Directory': 'مجلد',
        'OPEN': 'فتح',
        'DOWNLOAD': 'تنزيل',
        'OFFICIAL': 'وثيقة',
        'DOC': 'رسمية'
    };

    /* Dates like "24 SEP 2026" appear inside file metadata that is otherwise
     * untranslatable, so months are substituted within the string. */
    var MONTHS = {
        JAN: 'يناير', FEB: 'فبراير', MAR: 'مارس', APR: 'أبريل',
        MAY: 'مايو', JUN: 'يونيو', JUL: 'يوليو', AUG: 'أغسطس',
        SEP: 'سبتمبر', OCT: 'أكتوبر', NOV: 'نوفمبر', DEC: 'ديسمبر'
    };
    var MONTH_RE = /(\d{1,2}) (JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) (\d{4})/g;

    /* Attributes whose values are read by people or screen readers. */
    var ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];

    /* Whitespace-normalised lookup, so wrapped source paragraphs match the
     * single-line keys written above. */
    var LOOKUP = {};
    var REVERSE_LOOKUP = {};
    Object.keys(DICT).forEach(function (key) {
        var english = key.replace(/\s+/g, ' ').trim();
        var arabic = DICT[key].replace(/\s+/g, ' ').trim();
        LOOKUP[english] = DICT[key];
        /* Keep the first English source when two labels intentionally share
         * one Arabic translation. Either source restores readable English. */
        if (!Object.prototype.hasOwnProperty.call(REVERSE_LOOKUP, arabic)) {
            REVERSE_LOOKUP[arabic] = key;
        }
    });

    var originalText = new WeakMap();   // text node -> English source
    var originalAttr = new WeakMap();   // element   -> { attr: English source }
    var applying = false;
    var current = 'en';

    function translate(source) {
        var parts = /^(\s*)([\s\S]*?)(\s*)$/.exec(source);
        var lead = parts[1], core = parts[2], trail = parts[3];
        if (!core) { return null; }

        var normalised = core.replace(/\s+/g, ' ');
        if (Object.prototype.hasOwnProperty.call(LOOKUP, normalised)) {
            return lead + LOOKUP[normalised] + trail;
        }

        MONTH_RE.lastIndex = 0;
        if (MONTH_RE.test(core)) {
            MONTH_RE.lastIndex = 0;
            return lead + core.replace(MONTH_RE, function (_, day, month, year) {
                return day + ' ' + MONTHS[month] + ' ' + year;
            }) + trail;
        }
        return null;
    }

    /* Dynamic components can be inserted between a language click and the
     * MutationObserver callback. If their first observed value is Arabic,
     * recover the authored English here instead of caching Arabic as source. */
    function englishSource(value) {
        var parts = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
        var normalised = parts[2].replace(/\s+/g, ' ');
        if (Object.prototype.hasOwnProperty.call(REVERSE_LOOKUP, normalised)) {
            return parts[1] + REVERSE_LOOKUP[normalised] + parts[3];
        }
        return value;
    }

    function applyToTextNodes(root, lang) {
        if (!root) { return; }
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: function (node) {
                var tag = node.parentNode && node.parentNode.nodeName;
                if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
                    return NodeFilter.FILTER_REJECT;
                }
                return node.nodeValue.trim()
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            }
        });

        var node;
        while ((node = walker.nextNode())) {
            if (!originalText.has(node)) {
                originalText.set(node, englishSource(node.nodeValue));
            }
            var source = originalText.get(node);
            var next = (lang === 'ar' && translate(source)) || source;
            if (node.nodeValue !== next) { node.nodeValue = next; }
        }
    }

    function applyToAttributes(root, lang) {
        if (!root || root.nodeType !== 1) { return; }

        var selector = ATTRS.map(function (a) { return '[' + a + ']'; }).join(',');
        var elements = Array.prototype.slice.call(root.querySelectorAll(selector));
        if (root.matches && root.matches(selector)) { elements.push(root); }

        elements.forEach(function (el) {
            var cache = originalAttr.get(el);
            if (!cache) { cache = {}; originalAttr.set(el, cache); }

            ATTRS.forEach(function (attr) {
                if (!el.hasAttribute(attr)) { return; }
                if (!(attr in cache)) {
                    cache[attr] = englishSource(el.getAttribute(attr));
                }
                var source = cache[attr];
                el.setAttribute(attr, (lang === 'ar' && translate(source)) || source);
            });
        });
    }

    function apply(root, lang) {
        applying = true;
        applyToTextNodes(root, lang);
        applyToAttributes(root, lang);
        applying = false;
    }

    function setLanguage(lang, persist) {
        current = lang === 'ar' ? 'ar' : 'en';

        var html = document.documentElement;
        html.lang = current;
        html.dir = current === 'ar' ? 'rtl' : 'ltr';

        apply(document.body, current);
        applyToTextNodes(document.querySelector('title'), current);

        var button = document.querySelector('.lang-toggle');
        if (button) {
            button.setAttribute('aria-label',
                current === 'ar' ? 'Switch to English' : 'التبديل إلى العربية');
            button.setAttribute('data-active-lang', current);
            button.querySelectorAll('[data-lang-option]').forEach(function (option) {
                var isActive = option.getAttribute('data-lang-option') === current;
                option.classList.toggle('active', isActive);
                option.setAttribute('aria-hidden', isActive ? 'false' : 'true');
            });
        }

        if (persist) {
            try { localStorage.setItem(STORAGE_KEY, current); } catch (e) { /* private mode */ }
        }

        document.dispatchEvent(new CustomEvent('acm:languagechange', {
            detail: { language: current }
        }));
    }

    /* The archive page has no <nav>, so the toggle joins its action row. */
    function buildToggle() {
        if (document.querySelector('.lang-toggle')) { return; }

        var host = document.querySelector('.nav-inner') || document.querySelector('.archive-actions');
        if (!host) { return; }

        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'lang-toggle mono-meta';
        button.innerHTML = '<span data-lang-option="ar">AR</span><span class="lang-divider" aria-hidden="true">/</span><span data-lang-option="en">EN</span>';

        var utilities = host.querySelector('.nav-utilities');
        if (!utilities) {
            utilities = document.createElement('div');
            utilities.className = 'nav-utilities';
            var meta = host.querySelector('.nav-meta');
            if (meta) {
                host.insertBefore(utilities, meta);
                utilities.appendChild(meta);
            } else {
                host.appendChild(utilities);
            }
        }
        utilities.appendChild(button);

        button.addEventListener('click', function () {
            setLanguage(current === 'ar' ? 'en' : 'ar', true);
        });
    }

    function stored() {
        try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    }

    function start() {
        buildToggle();
        setLanguage(stored() === 'ar' ? 'ar' : 'en', false);

        /* team.js, projects.js and archive.js rewrite parts of the page after
         * load; translate whatever they insert. */
        if ('MutationObserver' in window) {
            new MutationObserver(function (records) {
                if (applying) { return; }
                records.forEach(function (record) {
                    Array.prototype.forEach.call(record.addedNodes, function (node) {
                        if (node.nodeType === 1) { apply(node, current); }
                        else if (node.nodeType === 3) { applyToTextNodes(node.parentNode, current); }
                    });
                });
            }).observe(document.body, { childList: true, subtree: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    window.ACMLang = {
        get: function () { return current; },
        set: function (lang) { setLanguage(lang, true); }
    };
}());
