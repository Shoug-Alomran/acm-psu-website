-- Format Dr. Yasir Javed's existing public biography into the same short-lead,
-- multi-paragraph structure used by the hand-authored ACM profiles. This is a
-- presentation edit only; it preserves the facts already supplied by him.

update public.member_profiles p
set bio = $bio$Dr. Yasir Javed is a Computer Science academic at Prince Sultan University whose work focuses on secure AI adoption, AI-assisted cybersecurity, digital trust, cybersecurity governance, and technology-enhanced teaching.

His work combines academic teaching and applied research with ISO 27001 audit readiness, instructional design, faculty and workforce AI training, research supervision, and institutional quality initiatives. At Prince Sultan University, he contributes across Computer Science and cybersecurity education, the Instructional Design Unit, AI capacity-building programs, and higher-education quality assurance.

His research and professional interests include DDoS and intrusion-detection systems, 5G and 6G security, blockchain and IoT security, secure software development, AI governance, digital learning, and accessibility. His academic profile includes 147 publications, more than 3,500 citations, an h-index of 36, funded research projects, supervised students, and a patent.

As Faculty Advisor to ACM PSU, Dr. Yasir supports the responsible and effective adoption of technology through practical guidance, academic mentorship, cybersecurity governance, digital trust, and AI capability building.$bio$,
    updated_at = now()
from public.app_users u
where p.user_id = u.id
  and lower(u.email::text) = 'yjaved@psu.edu.sa';
