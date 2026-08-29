-- ===========================================================================
-- 0019 — Rollback-contained capability smoke test.
--
-- The existing security smoke test proves the system refuses what it should.
-- This one proves it PERMITS what it should, which is the failure mode a
-- tightly locked-down schema actually suffers from: every deny is correct and
-- nobody can get anything done.
--
-- Unlike that test, this switches PostgreSQL role with `set local role`, so
-- row level security is genuinely in force. Running as the owner would bypass
-- every policy and prove nothing.
--
-- All fixtures, including audit rows, are discarded by the AC999 rollback at
-- the end. Nothing here persists.
-- ===========================================================================

do $$
declare
    applicant_id uuid := gen_random_uuid();
    member_id    uuid := gen_random_uuid();
    other_id     uuid := gen_random_uuid();
    project_id   uuid;
    opening_id   uuid;
    folder_id    uuid;
    position_id  uuid;
    reference    text;
    visible      integer;
    remaining    integer;
    denied       boolean;
begin
  begin
    ------------------------------------------------------------------ fixtures
    insert into auth.users
      (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated',
           'authenticated', v.email, '', now(),
           '{"provider":"email","providers":["email"]}',
           jsonb_build_object('full_name', v.name), now(), now()
      from (values
        (applicant_id, 'cap-applicant@invalid.example', 'Capability Applicant'),
        (member_id,    'cap-member@invalid.example',    'Capability Member'),
        (other_id,     'cap-other@invalid.example',     'Capability Other')
      ) as v(id, email, name);

    select id into position_id from public.positions where slug = 'member';

    insert into public.memberships (user_id, status, started_on, chapter_year)
    values (member_id, 'active', current_date, public.current_chapter_year()),
           (other_id,  'active', current_date, public.current_chapter_year());

    insert into public.projects (slug, title, kind, status, visibility, chapter_year)
    values ('cap-test-project', 'Capability Test Project', 'event', 'active',
            'internal', public.current_chapter_year())
    returning id into project_id;

    insert into public.event_positions (project_id, title, openings, is_open)
    values (project_id, 'Capability Test Role', 2, true)
    returning id into opening_id;

    insert into public.archive_folders (project_id, name, slug, section, visibility)
    values (project_id, 'Capability Files', 'capability-files', 'files', 'internal')
    returning id into folder_id;

    -- Another member already holds one of the two openings, so the capacity
    -- arithmetic below has something real to be wrong about.
    insert into public.event_position_applications
      (event_position_id, user_id, availability, status)
    values (opening_id, other_id, 'Anytime', 'approved');

    ---------------------------------------------------------------- anon
    execute 'set local role anon';
    perform set_config('request.jwt.claim.sub', '', true);

    -- A stranger must be able to send the club a question.
    reference := public.submit_inquiry(
        'Capability Visitor', 'cap-visitor@invalid.example', 'membership',
        'How do I join?', 'I would like to know how to join the ACM chapter.',
        null, 'capability-smoke');
    if reference is null or reference not like 'INQ-%' then
        raise exception 'Anonymous visitors cannot submit an inquiry (got %)', reference;
    end if;

    -- ...and must not be able to read the queue back. With the table
    -- privilege withheld this now fails at the SQL layer rather than
    -- returning an empty set, so accept either outcome — both mean no.
    denied := false;
    begin
        select count(*) into visible from public.inquiries;
        if visible > 0 then
            raise exception 'Anonymous visitors can read % inquiries', visible;
        end if;
        denied := true;
    exception when insufficient_privilege then
        denied := true;
    end;
    if not denied then
        raise exception 'Anonymous visitors can read the inquiry queue';
    end if;

    -- The public form needs its category list and the public settings.
    if (select count(*) from public.inquiry_categories) = 0 then
        raise exception 'Anonymous visitors cannot read inquiry categories';
    end if;
    if (select count(*) from public.app_settings) = 0 then
        raise exception 'Anonymous visitors cannot read public settings';
    end if;
    if (select count(*) from public.positions) = 0 then
        raise exception 'Anonymous visitors cannot read the position catalogue';
    end if;

    -- event_position_availability evaluates as its owner so the capacity
    -- counts are true. That removes the underlying policies from the path, so
    -- the view's own predicate is the only thing standing between a stranger
    -- and a list of unannounced internal event roles.
    denied := false;
    begin
        select count(*) into visible from public.event_position_availability;
        if visible > 0 then
            raise exception
                'Anonymous visitors can enumerate % event openings', visible;
        end if;
        denied := true;
    exception when insufficient_privilege then
        denied := true;
    end;
    if not denied then
        raise exception 'Event openings are exposed to anonymous visitors';
    end if;

    execute 'reset role';

    ----------------------------------------------------------- applicant
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', applicant_id::text, true);

    insert into public.applications
      (user_id, full_name, student_id, psu_email, major, academic_year, interests)
    values (applicant_id, 'Capability Applicant', '202099999',
            'cap-applicant@psu.edu.sa', 'Software Engineering', 'Year 2',
            array['programming']);

    if (select count(*) from public.applications where user_id = applicant_id) <> 1 then
        raise exception 'An applicant cannot read back their own application';
    end if;

    -- An applicant may still browse the public archive and set an avatar, but
    -- must not see internal material.
    if (select count(*) from public.projects where id = project_id) <> 0 then
        raise exception 'An applicant can see internal projects';
    end if;
    if (select count(*) from public.event_position_availability
         where event_position_id = opening_id) <> 0 then
        raise exception 'An applicant can see internal event openings';
    end if;

    execute 'reset role';

    -------------------------------------------------------------- member
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', member_id::text, true);

    -- Their own profile is theirs to change, with no review.
    update public.member_profiles
       set bio = 'Capability test bio', visibility = 'public',
           interests = array['programming', 'cybersecurity']
     where user_id = member_id;
    if (select visibility from public.member_profiles where user_id = member_id)
       <> 'public' then
        raise exception 'A member cannot change their own profile visibility';
    end if;

    -- Submitting work for verification.
    insert into public.contributions (user_id, project_id, type_slug, title, status)
    values (member_id, project_id, 'programming', 'Capability test contribution',
            'submitted');

    -- Submitting a file to the archive.
    insert into public.archive_submissions
      (submitted_by, project_id, folder_id, title, category, external_url,
       suggested_visibility, status)
    values (member_id, project_id, folder_id, 'Capability test submission',
            'other', 'https://example.com/capability', 'internal', 'submitted');

    -- Volunteering for an event role.
    insert into public.event_position_applications
      (event_position_id, user_id, availability, status)
    values (opening_id, member_id, 'Weekday afternoons', 'pending');

    -- Asking for a position, and asking to leave.
    insert into public.position_change_requests
      (user_id, requested_position_id, reason, status)
    values (member_id, position_id, 'Capability test reason', 'pending');

    insert into public.member_requests (user_id, kind, message, status)
    values (member_id, 'profile_removal', 'Capability test request', 'pending');

    -- Their dashboard numbers must be readable and must be their own.
    if (select count(*) from public.member_stats where user_id = member_id) <> 1 then
        raise exception 'A member cannot read their own statistics';
    end if;

    -- Internal project material is visible to members.
    if (select count(*) from public.projects where id = project_id) <> 1 then
        raise exception 'An active member cannot see internal projects';
    end if;
    if (select count(*) from public.archive_folders where id = folder_id) <> 1 then
        raise exception 'An active member cannot see internal archive folders';
    end if;

    -- THE REGRESSION THIS TEST EXISTS FOR: capacity must be counted across
    -- everyone, not just the rows this member is allowed to see. One of the
    -- two openings is already held by another member.
    select epa.remaining into remaining
      from public.event_position_availability epa
     where epa.event_position_id = opening_id;
    if remaining is distinct from 1 then
        raise exception
            'Event capacity is computed through the caller''s row filter: '
            'expected 1 remaining of 2, got %', remaining;
    end if;

    -- Truthful counts must not have come at the cost of exposing who applied.
    if exists (
        select 1
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'event_position_availability'
           and column_name in ('user_id', 'sender_email', 'availability',
                               'note', 'admin_note', 'decided_by', 'submitted_by')
    ) then
        raise exception
            'event_position_availability exposes applicant identity or '
            'application content';
    end if;

    -- And the denials that matter, from the same session.
    denied := false;
    begin
        update public.memberships set status = 'alumni' where user_id = member_id;
        if (select status from public.memberships where user_id = member_id) = 'alumni' then
            denied := false;
        else
            denied := true;   -- policy matched no row, so nothing changed
        end if;
    exception when others then denied := true;
    end;
    if not denied then
        raise exception 'A member was able to change their own membership status';
    end if;

    if (select count(*) from public.contributions where user_id = other_id) <> 0 then
        raise exception 'A member can read another member''s contributions';
    end if;
    if (select count(*) from public.audit_log) <> 0 then
        raise exception 'A member can read the audit log';
    end if;
    if (select count(*) from public.inquiry_notes) <> 0 then
        raise exception 'A member can read internal inquiry notes';
    end if;

    execute 'reset role';

    raise exception using errcode = 'AC999', message = 'rollback capability fixtures';
  exception when sqlstate 'AC999' then
    execute 'reset role';
  end;

  if exists (select 1 from auth.users
              where id in (applicant_id, member_id, other_id)) then
      raise exception 'Capability fixture rollback failed';
  end if;

  raise notice
    'verified: anonymous submission, applicant application, member profile/'
    'contribution/submission/volunteering/requests, correct event capacity '
    'with no applicant identity exposed and no anonymous access, and the '
    'matching denials';
end;
$$;
