/* ACM PSU — Arabic / English switching.
 *
 * The site is authored in English; this layer swaps the rendered text at
 * runtime rather than duplicating every page into an /ar directory. It walks
 * the DOM's text nodes and a short list of user-visible attributes, looks each
 * up in the dictionary below, and writes the Arabic in place — keeping the
 * original in a WeakMap so switching back to English is exact.
 *
 * Anything absent from the dictionary is left alone on purpose. That is how the
 * terminal-styled tokens (IDs like 0x03, file names, SHA hashes, DIR paths)
 * stay legible in both languages.
 *
 * TO TRANSLATE NEW COPY: add "English source text": "Arabic" to DICT below. The
 * key must match the page text exactly once trimmed. Text split across inline
 * elements is several text nodes, so each fragment needs its own entry.
 *
 * Dynamic content (the team-year roster, project filtering, the archive file
 * browser) is re-rendered by other scripts after this one runs, so a
 * MutationObserver re-applies the translation to anything newly inserted.
 */

(function () {
    'use strict';

    var STORAGE_KEY = 'acm-lang';

    var DICT = {

        /* --- Navigation and chrome, shared by every page --- */
        'Skip to content': 'تخطَّ إلى المحتوى',
        'ACM PSU — home': 'ACM PSU — الصفحة الرئيسية',
        'Toggle navigation': 'إظهار القائمة',
        'About': 'عن النادي',
        'Team': 'الأعضاء',
        'Projects': 'المشاريع',
        'Archive': 'الأرشيف',
        'Join': 'انضم إلينا',
        'SYS.ARCHIVE_': 'الأرشيف_',
        '// ONLINE': '// متصل',
        'SYS.ARCHIVE // 404': 'الأرشيف // 404',
        'STATUS: ENROLLMENT_OPEN': 'الحالة: التسجيل مفتوح',

        /* --- Footer --- */
        'ACM PRINCE SULTAN UNIVERSITY': 'ACM جامعة الأمير سلطان',
        'Prince Sultan University': 'جامعة الأمير سلطان',
        'College of Computer and Information Sciences': 'كلية علوم الحاسب والمعلومات',
        'RENDERED:': 'وقت العرض:',
        'DIRECTORY_STATUS:': 'حالة الدليل:',
        'COMMITTED': 'مُثبّت',
        'RECORDS SHOWN:': 'السجلات المعروضة:',
        'AUTH_SESSION:': 'الجلسة:',
        'GUEST_USER': 'زائر',

        /* --- Home page --- */
        'ACM PSU — Digital Archive': 'ACM جامعة الأمير سلطان — الأرشيف الرقمي',
        'ACM.PSU / CURRENT CHAPTER /': 'ACM.PSU / الدفعة الحالية /',
        'Association for Computing Machinery.': 'جمعية آلات الحاسب (ACM).',
        'A student-led technical collective. We build systems, master algorithms, organize competitions, and engineer the future of software development at PSU. This is our digital archive.':
            'تجمّع تقني يقوده الطلبة. نبني الأنظمة، ونتقن الخوارزميات، وننظّم المسابقات، ونصنع مستقبل تطوير البرمجيات في جامعة الأمير سلطان. هذا هو أرشيفنا الرقمي.',
        'Explore Archive': 'تصفّح الأرشيف',
        'Join ACM': 'انضم إلى ACM',

        'System Focus': 'مجالات تركيزنا',
        'CORE COMPETENCIES // V.26': 'التخصصات الأساسية // إصدار 26',
        'Software Engineering': 'هندسة البرمجيات',
        'ARCHITECTURE, FULL-STACK, SYSTEMS': 'بناء المعماريات، التطوير المتكامل، الأنظمة',
        'Competitive Programming': 'البرمجة التنافسية',
        'ALGORITHMS, DATA STRUCTURES, ICPC': 'الخوارزميات، هياكل البيانات، ICPC',
        'Cybersecurity (CTF)': 'الأمن السيبراني (CTF)',
        'CRYPTOGRAPHY, REVERSE ENG, FORENSICS': 'التشفير، الهندسة العكسية، التحليل الجنائي',
        'Hackathons & Jams': 'الهاكاثونات والمعسكرات',
        'RAPID PROTOTYPING, IDEATION, DEPLOY': 'النمذجة السريعة، توليد الأفكار، الإطلاق',

        'Current Generation': 'الدفعة الحالية',
        'STATUS: ACTIVE CHAPTER': 'الحالة: دفعة نشطة',
        'President': 'رئيس النادي',
        'VP of Engineering': 'نائبة الرئيس للشؤون الهندسية',
        'Head of Cyber': 'مسؤول الأمن السيبراني',
        'View Complete Roster': 'عرض القائمة الكاملة',

        'Selected Work': 'أعمال مختارة',
        'BUILT BY ACM // PRODUCTION ENV': 'من تنفيذ ACM // بيئة تشغيل فعلية',
        'PROJECT_ID': 'رقم_المشروع',
        'DEPLOYMENT_YEAR': 'سنة_الإطلاق',
        'AI Programming Jam Platform': 'منصّة معسكر الذكاء الاصطناعي البرمجي',
        'A custom-built, real-time evaluation environment designed for the annual PSU AI Jam. Supports automated grading of machine learning models against hidden datasets with live leaderboards.':
            'بيئة تقييم لحظية مبنية خصيصًا لمعسكر الذكاء الاصطناعي السنوي في جامعة الأمير سلطان. تدعم التصحيح الآلي لنماذج تعلّم الآلة مقابل بيانات مخفية، مع لوحة نتائج مباشرة.',
        'PSU Capture The Flag Infrastructure': 'البنية التحتية لمسابقة CTF في جامعة الأمير سلطان',
        'Containerized CTF platform handling 500+ concurrent users. Features dynamic scoring, isolated challenge environments via Docker, and real-time attack-defense visualization metrics.':
            'منصّة CTF تعمل بالحاويات وتستوعب أكثر من 500 مستخدم في آنٍ واحد. تتضمن احتساب نقاط ديناميكي، وبيئات تحدٍّ معزولة عبر Docker، ومؤشرات مباشرة لعمليات الهجوم والدفاع.',
        'Case Study': 'دراسة الحالة',
        'Visit Repo': 'زيارة المستودع',
        'Live Demo': 'عرض مباشر',

        'Archive Directory': 'دليل الأرشيف',
        'HISTORICAL DATA // READ-ONLY': 'بيانات تاريخية // للقراءة فقط',
        'MEMBERS': 'الأعضاء',
        'EVENTS': 'الفعاليات',
        'LEADERSHIP': 'القيادة',
        '12 COMMITTED': '12 فعالية مؤكدة',
        '24 EXECUTED': '24 فعالية منفّذة',
        '18 EXECUTED': '18 فعالية منفّذة',
        'ACTIVE CHAPTER': 'دفعة نشطة',
        'ARCHIVED': 'مؤرشَف',
        'F. AL-DOSARI': 'ف. الدوسري',
        'S. AL-AMRI': 'س. العمري',
        'M. KHAN': 'م. خان',
        'Query Full Archive Database': 'استعراض قاعدة بيانات الأرشيف كاملة',

        'SYS.MSG: EOF NOT REACHED': 'رسالة النظام: لم نبلغ النهاية بعد',
        "The Archive Isn't Finished.": 'الأرشيف لم يكتمل بعد.',
        'Your code, your designs, your leadership could define the next block.':
            'كودك، وتصاميمك، وقيادتك قد تكون هي الفصل القادم في هذا الأرشيف.',
        'Initialize Membership': 'ابدأ عضويتك',

        /* --- Shared people names --- */
        'Faisal Al-Dosari': 'فيصل الدوسري',
        'Nouf Al-Saud': 'نوف آل سعود',
        'Omar Tariq': 'عمر طارق',
        'Sara Ibrahim': 'سارة إبراهيم',
        'Khalid Mansour': 'خالد منصور',
        'Lina Ahmed': 'لينا أحمد',
        'Yazeed Fawaz': 'يزيد فواز',
        'Dana Sultan': 'دانة سلطان',
        'Hamza Ali': 'حمزة علي',
        'Reem Khalid': 'ريم خالد',
        'Portrait of Faisal Al-Dosari': 'صورة فيصل الدوسري',
        'Portrait of Nouf Al-Saud': 'صورة نوف آل سعود',
        'Portrait of Omar Tariq': 'صورة عمر طارق',
        'Portrait of Sara Ibrahim': 'صورة سارة إبراهيم',
        'Portrait of Khalid Mansour': 'صورة خالد منصور',
        'Portrait of Lina Ahmed': 'صورة لينا أحمد',
        'Portrait of Yazeed Fawaz': 'صورة يزيد فواز',
        'Portrait of Dana Sultan': 'صورة دانة سلطان',
        'Portrait of Hamza Ali': 'صورة حمزة علي',
        'Portrait of Reem Khalid': 'صورة ريم خالد',

        /* --- Team page --- */
        'People / 2026 — ACM PSU': 'الأعضاء / 2026 — ACM جامعة الأمير سلطان',
        'DIRECTORY': 'الدليل',
        'PEOPLE': 'الأعضاء',
        'People': 'الأعضاء',
        'Executive Council': 'المجلس التنفيذي',
        'LEVEL_01 // ADMINISTRATION': 'المستوى_01 // الإدارة',
        'General Assembly': 'الجمعية العمومية',
        'LEVEL_02 // CONTRIBUTORS [42]': 'المستوى_02 // المساهمون [42]',
        'PRESIDENT': 'رئيس النادي',
        'VP ENGINEERING': 'نائبة الرئيس للهندسة',
        'Computer Science // Senior': 'علوم الحاسب // السنة الرابعة',
        'Software Engineering // Junior': 'هندسة البرمجيات // السنة الثالثة',
        'Cybersecurity Lead': 'مسؤول الأمن السيبراني',
        'UI/UX Architect': 'مصمّمة تجربة المستخدم',
        'Full-Stack Dev': 'مطوّر متكامل',
        'Algorithmic Lead': 'مسؤولة الخوارزميات',
        'Systems Admin': 'مسؤول الأنظمة',
        'DevOps Engineer': 'مهندسة DevOps',
        'Project Liaison': 'منسّق المشاريع',
        'Front-end Lead': 'مسؤولة الواجهات الأمامية',
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

        /* --- Projects page --- */
        'Projects Archive — ACM PSU': 'أرشيف المشاريع — ACM جامعة الأمير سلطان',
        'Technical': 'المجموعة',
        'Collection.': 'التقنية.',
        'Filter projects by category': 'تصفية المشاريع حسب التصنيف',
        'ALL': 'الكل',
        'CYBER': 'الأمن',
        'HACKATHON': 'هاكاثون',
        'SYSTEMS': 'أنظمة',
        'Search projects': 'ابحث في المشاريع',
        'grep search_projects...': 'grep ابحث_في_المشاريع...',
        'Neural Nexus AI Jam': 'معسكر Neural Nexus للذكاء الاصطناعي',
        'Advanced model evaluation platform for rapid prototyping of LLM agents. Features real-time token tracking and automated benchmarking.':
            'منصّة تقييم متقدّمة للنماذج، مخصّصة للنمذجة السريعة لوكلاء النماذج اللغوية. تتضمن تتبّعًا لحظيًا للتوكنات وقياسًا آليًا للأداء.',
        'Aegis CTF Engine': 'محرّك Aegis لمسابقات CTF',
        'Distributed infrastructure for offensive security competitions. Includes dynamic environment isolation via Kubernetes and binary exploit tracking.':
            'بنية تحتية موزّعة لمسابقات الأمن الهجومي. تشمل عزلًا ديناميكيًا للبيئات عبر Kubernetes وتتبّعًا لثغرات الملفات التنفيذية.',
        'Global Vision Hack': 'هاكاثون Global Vision',
        'Management system for high-throughput coding competitions. Integrated mentoring queue, live hardware inventory, and participant telemetry.':
            'نظام إدارة لمسابقات البرمجة عالية الكثافة. يشمل قائمة انتظار للإرشاد، وجردًا مباشرًا للأجهزة، وتتبّعًا لبيانات المشاركين.',
        'Kernel Labs Workshop': 'ورشة Kernel Labs',
        'A deep-dive series into Linux kernel development and systems programming. Over 100 student participants contributing to open source modules.':
            'سلسلة متعمّقة في تطوير نواة لينكس وبرمجة الأنظمة. شارك فيها أكثر من 100 طالب وساهموا في وحدات مفتوحة المصدر.',
        'View Case Study': 'عرض دراسة الحالة',
        'CYBERSECURITY': 'الأمن السيبراني',
        'WORKSHOP': 'ورشة عمل',
        'NO RECORDS MATCH THIS QUERY.': 'لا توجد سجلات مطابقة لهذا البحث.',

        /* --- Join page --- */
        'Initialize Membership — ACM PSU': 'ابدأ عضويتك — ACM جامعة الأمير سلطان',
        '[ ACTION: INITIALIZE_MEMBERSHIP ]': '[ الإجراء: بدء_العضوية ]',
        'Join the Collective': 'انضم إلى التجمّع',
        'ACM PSU is looking for the next generation of engineers, researchers, and hackers. Complete the handshake protocol below to apply for the 2026 cohort.':
            'نادي ACM في جامعة الأمير سلطان يبحث عن الجيل القادم من المهندسين والباحثين والمبرمجين. أكمل النموذج أدناه للتقديم على دفعة 2026.',
        'Full Name': 'الاسم الكامل',
        'STR_REQ': 'حقل مطلوب',
        'e.g. Faisal Al-Dosari': 'مثال: فيصل الدوسري',
        'PSU Email': 'البريد الجامعي',
        'EMAIL_VALIDATE': 'بريد إلكتروني',
        'Student ID': 'الرقم الجامعي',
        'ID_REQ': 'رقم مطلوب',
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
        'AI / Data Science': 'الذكاء الاصطناعي / علم البيانات',
        'UI/UX Design': 'تصميم تجربة المستخدم',
        'LinkedIn / GitHub / Portfolio': 'لينكدإن / GitHub / معرض الأعمال',
        'OPTIONAL': 'اختياري',
        'What would you like to gain experience in?': 'في أي مجال تود اكتساب الخبرة؟',
        'Briefly describe your interests and what you hope to contribute...':
            'اكتب باختصار عن اهتماماتك وما تطمح إلى الإسهام به...',
        'Leave this field empty': 'اترك هذا الحقل فارغًا',
        'Execute Handshake [Enter]': 'إرسال الطلب [Enter]',

        'MEMBERSHIP_BENEFITS': 'مزايا_العضوية',
        'Access to': 'الوصول إلى',
        'ACM Lab Hardware': 'أجهزة مختبر ACM',
        '(GPU clusters, IoT kits).': '(وحدات معالجة رسومية، وأطقم إنترنت الأشياء).',
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
        'What is the time commitment?': 'كم من الوقت يتطلب الالتزام؟',
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
            'لم يتم ربط النموذج بعد — الطلبات غير مستلمة حاليًا. يرجى إرسال إجاباتك إلى acm@psu.edu.sa في هذه الأثناء.',
        'HANDSHAKE COMPLETE — application received. We will be in touch.':
            'تم الإرسال بنجاح — استلمنا طلبك وسنتواصل معك قريبًا.',
        'TRANSMISSION FAILED — please retry, or email acm@psu.edu.sa.':
            'فشل الإرسال — يرجى المحاولة مجددًا أو مراسلتنا على acm@psu.edu.sa.',

        /* --- 404 --- */
        'Record Not Found': 'الصفحة غير موجودة',
        'The path you requested is not in the archive. It may have been moved, renamed, or never committed.':
            'المسار الذي طلبته غير موجود في الأرشيف. ربما تم نقله أو تغيير اسمه أو لم يُضف أصلًا.',
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
        'WORKSHOPS': 'الورش',
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
        'DOC': 'رسمية',
        'Terminal running model evaluations': 'طرفية تعرض تقييم النماذج',
        'Server racks powering the CTF infrastructure': 'خوادم تشغّل البنية التحتية لمسابقة CTF',
        'Workstations set up for a hackathon': 'محطات عمل مجهّزة لهاكاثون',
        'Laptop open during a systems programming workshop': 'حاسب محمول أثناء ورشة برمجة الأنظمة',
        'Code editor showing the AI Jam evaluation environment': 'محرر أكواد يعرض بيئة تقييم معسكر الذكاء الاصطناعي',
        'Dashboard of live CTF scoring metrics': 'لوحة تعرض نتائج مسابقة CTF مباشرةً'
    };

    /* Month names appear inside otherwise-untranslatable file dates, so they are
     * substituted within a string rather than matched whole. */
    var MONTHS = {
        'JAN': 'يناير', 'FEB': 'فبراير', 'MAR': 'مارس', 'APR': 'أبريل',
        'MAY': 'مايو', 'JUN': 'يونيو', 'JUL': 'يوليو', 'AUG': 'أغسطس',
        'SEP': 'سبتمبر', 'OCT': 'أكتوبر', 'NOV': 'نوفمبر', 'DEC': 'ديسمبر'
    };
    var MONTH_RE = /\b(\d{1,2}) (JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) (\d{4})\b/g;

    /* Attributes whose values are read by people (or screen readers). */
    var ATTRS = ['placeholder', 'aria-label', 'title', 'alt', 'label'];

    var originalText = new WeakMap();   // text node -> English source
    var originalAttr = new WeakMap();   // element  -> { attr: English source }
    var applying = false;
    var current = 'en';

    function translate(source) {
        var key = source.trim();
        if (!key) { return null; }

        if (Object.prototype.hasOwnProperty.call(DICT, key)) {
            return source.replace(key, DICT[key]);
        }

        // Fall back to date substitution for "24 SEP 2026" style strings.
        if (MONTH_RE.test(key)) {
            MONTH_RE.lastIndex = 0;
            return source.replace(MONTH_RE, function (_, day, mon, year) {
                return day + ' ' + MONTHS[mon] + ' ' + year;
            });
        }
        MONTH_RE.lastIndex = 0;
        return null;
    }

    function applyToTextNodes(root, lang) {
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
            if (!originalText.has(node)) { originalText.set(node, node.nodeValue); }
            var source = originalText.get(node);
            var translated = lang === 'ar' ? translate(source) : null;
            var next = translated || source;
            if (node.nodeValue !== next) { node.nodeValue = next; }
        }
    }

    function applyToAttributes(root, lang) {
        var selector = ATTRS.map(function (a) { return '[' + a + ']'; }).join(',');
        var elements = Array.prototype.slice.call(root.querySelectorAll(selector));
        if (root.nodeType === 1 && root.matches && root.matches(selector)) {
            elements.push(root);
        }

        elements.forEach(function (el) {
            var cache = originalAttr.get(el);
            if (!cache) { cache = {}; originalAttr.set(el, cache); }

            ATTRS.forEach(function (attr) {
                if (!el.hasAttribute(attr)) { return; }
                if (!(attr in cache)) { cache[attr] = el.getAttribute(attr); }
                var source = cache[attr];
                var translated = lang === 'ar' ? translate(source) : null;
                el.setAttribute(attr, translated || source);
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

        // <title> lives in <head>, outside the body walk.
        var titleNode = document.querySelector('title');
        if (titleNode) { apply(titleNode, current); }

        var button = document.querySelector('.lang-toggle');
        if (button) {
            button.textContent = current === 'ar' ? 'EN' : 'عربي';
            button.setAttribute('aria-label',
                current === 'ar' ? 'Switch to English' : 'التبديل إلى العربية');
            button.lang = current === 'ar' ? 'en' : 'ar';
        }

        if (persist) {
            try { localStorage.setItem(STORAGE_KEY, current); } catch (e) { /* private mode */ }
        }
    }

    function buildToggle() {
        var nav = document.querySelector('.nav-inner');
        if (!nav || document.querySelector('.lang-toggle')) { return; }

        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'lang-toggle mono-meta';
        button.textContent = 'عربي';

        var meta = nav.querySelector('.nav-meta');
        if (meta) { nav.insertBefore(button, meta); } else { nav.appendChild(button); }

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
                if (applying || current !== 'ar') { return; }
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
