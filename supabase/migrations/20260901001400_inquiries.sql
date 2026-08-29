-- ===========================================================================
-- 0014 — Inquiries.
--
-- Questions sent through the website by visitors and members. Supabase is the
-- source of truth; the Google Sheet is an export of this table, never an input
-- to it.
--
-- The important structural decision here is that anonymous visitors have NO
-- policy on this table at all — not even INSERT. Submission goes through
-- submit_inquiry(), a SECURITY DEFINER function. That matters because a plain
-- INSERT policy would let anyone with the anon key set `status`, `assigned_to`
-- or `response` on the row they create, and would leave rate limiting with
-- nowhere to live. A function can validate, throttle, and control exactly
-- which columns a stranger gets to populate.
--
-- Internal notes live in their own table for the same reason interview notes
-- do: no policy mistake on `inquiries` can expose something that is not there.
-- ===========================================================================

create type inquiry_status as enum ('new', 'in_progress', 'answered', 'closed');

-- A table rather than an enum so a future committee can add a category
-- without a migration.
create table public.inquiry_categories (
    slug      text primary key,
    label     text not null,
    label_ar  text,
    rank      integer not null default 100,
    is_active boolean not null default true
);

insert into public.inquiry_categories (slug, label, label_ar, rank) values
    ('membership',   'Membership',   'العضوية',        10),
    ('events',       'Events',       'الفعاليات',       20),
    ('workshops',    'Workshops',    'الورش',           30),
    ('competitions', 'Competitions', 'المسابقات',       40),
    ('technical',    'Technical',    'الدعم التقني',    50),
    ('partnerships', 'Partnerships', 'الشراكات',        60),
    ('other',        'Other',        'أخرى',           999);

-- Human-friendly reference so an admin and a sender can talk about the same
-- inquiry without exchanging a UUID.
create sequence public.inquiry_reference_seq;

create table public.inquiries (
    id          uuid primary key default gen_random_uuid(),
    reference   text not null unique,

    -- ---- what the sender provided ----------------------------------------
    sender_name  text not null,
    sender_email citext not null,
    category     text references public.inquiry_categories (slug),
    subject      text not null,
    message      text not null,

    -- Set when a signed-in person submits, so they can follow their own
    -- inquiry. Null for anonymous visitors, which is the common case.
    submitted_by uuid references public.app_users (id) on delete set null,

    -- ---- handling --------------------------------------------------------
    status      inquiry_status not null default 'new',
    assigned_to uuid references public.app_users (id) on delete set null,
    assigned_at timestamptz,
    assigned_by uuid references public.app_users (id) on delete set null,

    -- The reply written for the sender. Kept apart from inquiry_notes so that
    -- "what we told them" and "what we said among ourselves" can never be
    -- confused for one another.
    response     text,
    responded_by uuid references public.app_users (id) on delete set null,
    responded_at timestamptz,

    -- Honest bookkeeping: the platform records a response, it does not send
    -- email. Until a mail provider is configured this stays false and the
    -- admin sends the reply themselves. See docs/SETUP.md step 6.
    response_delivered boolean not null default false,
    delivery_note      text,

    closed_at timestamptz,
    closed_by uuid references public.app_users (id) on delete set null,

    -- ---- context ---------------------------------------------------------
    source     text not null default 'website',
    -- Deliberately no IP address: it identifies a stranger's location and
    -- network, and a student club has no need to retain that. The user agent
    -- is kept only to tell a browser submission from a script.
    user_agent text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint inquiries_name_length    check (char_length(btrim(sender_name)) between 2 and 120),
    constraint inquiries_subject_length check (char_length(btrim(subject)) between 3 and 160),
    constraint inquiries_message_length check (char_length(btrim(message)) between 10 and 4000),
    constraint inquiries_email_shape    check (sender_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-zA-Z]{2,}$'),
    constraint inquiries_response_length check (response is null or char_length(response) <= 8000)
);

create index inquiries_status_idx   on public.inquiries (status, created_at desc);
create index inquiries_category_idx on public.inquiries (category, created_at desc);
create index inquiries_assigned_idx on public.inquiries (assigned_to, status);
create index inquiries_email_idx    on public.inquiries (sender_email, created_at desc);
create index inquiries_sender_idx   on public.inquiries (submitted_by, created_at desc);

create index inquiries_search_idx on public.inquiries
    using gin (to_tsvector('simple',
        coalesce(sender_name, '') || ' ' || coalesce(sender_email::text, '') || ' ' ||
        coalesce(subject, '') || ' ' || coalesce(message, '')));

create trigger inquiries_touch
    before update on public.inquiries
    for each row execute function public.touch_updated_at();

comment on table public.inquiries is
    'Questions submitted through the website. Anonymous visitors have no policy '
    'on this table; submission goes through submit_inquiry(). Supabase is the '
    'source of truth — the Google Sheet is an export, never an input.';

comment on column public.inquiries.response_delivered is
    'False until an email provider is configured. The platform records the '
    'response; it does not currently send it. Do not display this as "sent".';

-- ---------------------------------------------------------------------------
-- Internal notes. Staff-only, and in their own table so nothing about them
-- can reach a sender through a column on the inquiry itself.
-- ---------------------------------------------------------------------------
create table public.inquiry_notes (
    id         uuid primary key default gen_random_uuid(),
    inquiry_id uuid not null references public.inquiries (id) on delete cascade,
    author_id  uuid references public.app_users (id) on delete set null,
    body       text not null,
    created_at timestamptz not null default now(),

    constraint inquiry_notes_body_length check (char_length(btrim(body)) between 1 and 4000)
);

create index inquiry_notes_inquiry_idx on public.inquiry_notes (inquiry_id, created_at);

comment on table public.inquiry_notes is
    'Internal admin discussion. No SELECT policy exists for anyone but staff, '
    'and the member-facing view of an inquiry does not join this table.';

-- ---------------------------------------------------------------------------
-- Submission.
--
-- The only way an inquiry is created. A stranger controls exactly five fields;
-- everything else — status, assignment, response — is set by staff later.
--
-- Spam handling, in order of usefulness:
--   * a honeypot field no human sees and no human fills in
--   * per-email and global rate limits inside the same transaction
--   * length and shape constraints on the table itself
--
-- A determined attacker with the anon key can still submit at the rate limit.
-- That is a moderation problem rather than a security one; if it becomes real,
-- add Cloudflare Turnstile in front of this — see docs/SETUP.md step 7.
-- ---------------------------------------------------------------------------
create or replace function public.submit_inquiry(
    sender_name  text,
    sender_email text,
    category     text,
    subject      text,
    message      text,
    -- Rendered off-screen and left empty by real people. Bots fill every
    -- field they find.
    website      text default null,
    user_agent   text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
    new_reference text;
    clean_email   citext := lower(btrim(sender_email))::citext;
    recent_hour   integer;
    recent_day    integer;
    global_hour   integer;
    new_id        uuid;
begin
    -- Honeypot: accept quietly and record nothing. Telling a bot it failed
    -- only teaches it which field to leave alone next time.
    if website is not null and btrim(website) <> '' then
        return 'INQ-RECEIVED';
    end if;

    if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-zA-Z]{2,}$' then
        raise exception 'That does not look like a valid email address.'
            using errcode = '22023';
    end if;

    select count(*) into recent_hour
      from public.inquiries
     where sender_email = clean_email
       and created_at > now() - interval '1 hour';

    if recent_hour >= 3 then
        raise exception
            'You have already sent several messages in the last hour. '
            'Please wait a little before sending another.'
            using errcode = '54000';
    end if;

    select count(*) into recent_day
      from public.inquiries
     where sender_email = clean_email
       and created_at > now() - interval '24 hours';

    if recent_day >= 10 then
        raise exception
            'That is a lot of messages from one address today. '
            'Please email the club directly instead.'
            using errcode = '54000';
    end if;

    -- A crude ceiling that keeps a flood from filling the queue faster than
    -- a committee could ever read it.
    select count(*) into global_hour
      from public.inquiries
     where created_at > now() - interval '1 hour';

    if global_hour >= 120 then
        raise exception
            'The contact form is temporarily unavailable. Please try again '
            'shortly, or email the club directly.'
            using errcode = '54000';
    end if;

    new_reference := 'INQ-' || to_char(now(), 'YYYY') || '-' ||
                     lpad(nextval('public.inquiry_reference_seq')::text, 4, '0');

    -- Take responsibility for this transaction's audit entry so the inquiries
    -- row trigger stands down. Without this a signed-in sender produces two
    -- rows for one submission: the trigger's generic 'inquiry.created' and the
    -- richer 'inquiry.submitted' written below. (An anonymous sender never hit
    -- it, because the trigger skips when auth.uid() is null — which is exactly
    -- the kind of difference that hides a bug until a member reports it.)
    perform public.audit_context(null, null, 'created'::audit_decision, false, null);

    insert into public.inquiries (
        reference, sender_name, sender_email, category, subject, message,
        submitted_by, user_agent
    )
    values (
        new_reference,
        btrim(sender_name),
        clean_email,
        -- An unknown category from a crafted request falls back rather than
        -- failing the foreign key and losing the message.
        coalesce((select c.slug from public.inquiry_categories c
                   where c.slug = category and c.is_active), 'other'),
        btrim(subject),
        btrim(message),
        auth.uid(),
        left(coalesce(user_agent, ''), 300)
    )
    returning id into new_id;

    -- The audit entry records that an inquiry arrived. The message body is
    -- deliberately NOT copied into audit metadata — it is one row away, and
    -- duplicating it would spread personal correspondence across two tables.
    perform public.write_audit(
        action       => 'inquiry.submitted',
        category     => 'inquiries',
        entity_type  => 'inquiry',
        entity_id    => new_id::text,
        entity_label => new_reference || ' — ' || btrim(subject),
        decision     => 'created',
        summary      => 'Inquiry received from ' || btrim(sender_name),
        metadata     => jsonb_build_object(
                          'reference', new_reference,
                          'category', category,
                          'signed_in', auth.uid() is not null),
        actor_kind   => (case when auth.uid() is null then 'system' else 'member' end)::audit_actor_kind
    );

    return new_reference;
end;
$$;

-- Anyone may send the club a question. That is the point of a contact form.
grant execute on function public.submit_inquiry(text, text, text, text, text, text, text)
    to anon, authenticated;

-- ===========================================================================
-- Handling an inquiry.
--
-- Each step is an RPC so the change and its audit entry are one transaction,
-- and so the message body is never copied into audit metadata — the entry
-- points at the inquiry, which is one row away.
-- ===========================================================================

create or replace function public.assign_inquiry(
    inquiry_id uuid,
    assignee   uuid,
    reason     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    row_before record;
    old_name   text;
    new_name   text;
begin
    if not public.is_staff() then
        raise exception 'Only staff may assign inquiries.' using errcode = '42501';
    end if;

    select * into row_before from public.inquiries where id = inquiry_id for update;
    if row_before is null then
        raise exception 'Inquiry not found.';
    end if;

    if assignee is not null and not exists (
        select 1 from public.admin_assignments a
        where a.user_id = assignee and a.revoked_at is null) then
        raise exception 'Inquiries can only be assigned to an admin or reviewer.';
    end if;

    select full_name into old_name from public.app_users where id = row_before.assigned_to;
    select full_name into new_name from public.app_users where id = assignee;

    perform public.audit_context(reason, null, 'updated'::audit_decision, false, null);

    update public.inquiries
       set assigned_to = assignee,
           assigned_at = case when assignee is null then null else now() end,
           assigned_by = case when assignee is null then null else auth.uid() end,
           -- Picking something up is the same act as starting on it.
           status = case when assignee is not null and status = 'new'
                         then 'in_progress' else status end
     where id = inquiry_id;

    perform public.write_audit(
        action       => case when assignee is null then 'inquiry.unassigned'
                             when row_before.assigned_to is null then 'inquiry.assigned'
                             else 'inquiry.reassigned' end,
        category     => 'inquiries',
        entity_type  => 'inquiry',
        entity_id    => inquiry_id::text,
        entity_label => row_before.reference || ' — ' || row_before.subject,
        decision     => 'updated',
        summary      => coalesce(old_name, 'Unassigned') || ' → ' ||
                        coalesce(new_name, 'Unassigned'),
        reason       => reason,
        before_state => jsonb_build_object('assigned_to', coalesce(old_name, 'none'),
                                           'status', row_before.status),
        after_state  => jsonb_build_object('assigned_to', coalesce(new_name, 'none'),
                                           'status', case when assignee is not null
                                                          and row_before.status = 'new'
                                                     then 'in_progress'
                                                     else row_before.status end),
        metadata     => jsonb_build_object('reference', row_before.reference)
    );
end;
$$;

create or replace function public.set_inquiry_status(
    inquiry_id uuid,
    new_status inquiry_status,
    reason     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    row_before record;
    given      text;
begin
    if not public.is_staff() then
        raise exception 'Only staff may change an inquiry''s status.' using errcode = '42501';
    end if;

    select * into row_before from public.inquiries where id = inquiry_id for update;
    if row_before is null then
        raise exception 'Inquiry not found.';
    end if;
    if row_before.status = new_status then
        raise exception 'This inquiry is already %.', replace(new_status::text, '_', ' ');
    end if;

    -- Closing something without answering it, and reopening something that
    -- was closed, are both worth an explanation.
    if (new_status = 'closed' and row_before.status <> 'answered')
       or row_before.status = 'closed' then
        given := public.require_reason(reason,
            case when row_before.status = 'closed'
                 then 'reopen a closed inquiry'
                 else 'close an inquiry that was never answered' end);
    else
        given := reason;
    end if;

    perform public.audit_context(given, null, 'updated'::audit_decision, false, null);

    update public.inquiries
       set status    = new_status,
           closed_at = case when new_status = 'closed' then now() else null end,
           closed_by = case when new_status = 'closed' then auth.uid() else null end
     where id = inquiry_id;

    perform public.write_audit(
        action       => case when new_status = 'closed' then 'inquiry.closed'
                             when row_before.status = 'closed' then 'inquiry.reopened'
                             else 'inquiry.status_changed' end,
        category     => 'inquiries',
        entity_type  => 'inquiry',
        entity_id    => inquiry_id::text,
        entity_label => row_before.reference || ' — ' || row_before.subject,
        decision     => 'updated',
        summary      => initcap(replace(row_before.status::text, '_', ' ')) || ' → ' ||
                        initcap(replace(new_status::text, '_', ' ')),
        reason       => given,
        before_state => jsonb_build_object('status', row_before.status),
        after_state  => jsonb_build_object('status', new_status),
        metadata     => jsonb_build_object('reference', row_before.reference)
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Recording a response.
--
-- This stores what the club is telling the sender. It does NOT send email —
-- no mail provider is configured, and pretending otherwise would leave people
-- believing a reply went out when it did not. `response_delivered` stays false
-- until an admin confirms they sent it, or until an email function sets it.
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_inquiry(
    inquiry_id     uuid,
    response       text,
    mark_answered  boolean default true,
    mark_delivered boolean default false,
    delivery_note  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    row_before record;
begin
    if not public.is_staff() then
        raise exception 'Only staff may respond to inquiries.' using errcode = '42501';
    end if;
    if response is null or char_length(btrim(response)) < 10 then
        raise exception 'Write a response of at least a sentence before saving it.';
    end if;

    select * into row_before from public.inquiries where id = inquiry_id for update;
    if row_before is null then
        raise exception 'Inquiry not found.';
    end if;

    perform public.audit_context(null, null, 'updated'::audit_decision, false, null);

    update public.inquiries
       set response           = btrim(respond_to_inquiry.response),
           responded_by       = auth.uid(),
           responded_at       = now(),
           response_delivered = mark_delivered,
           delivery_note      = respond_to_inquiry.delivery_note,
           status             = case when mark_answered then 'answered'::inquiry_status
                                     when inquiries.status = 'new' then 'in_progress'::inquiry_status
                                     else inquiries.status end
     where id = inquiry_id;

    -- The response text is not copied here: it is on the inquiry itself, and
    -- duplicating correspondence across two tables serves nobody.
    perform public.write_audit(
        action       => 'inquiry.responded',
        category     => 'inquiries',
        entity_type  => 'inquiry',
        entity_id    => inquiry_id::text,
        entity_label => row_before.reference || ' — ' || row_before.subject,
        decision     => 'updated',
        summary      => 'Response recorded for ' || row_before.sender_name ||
                        case when mark_delivered then ' (marked as sent)'
                             else ' (not yet sent)' end,
        before_state => jsonb_build_object('status', row_before.status,
                                           'has_response', row_before.response is not null),
        after_state  => jsonb_build_object(
                          'status', case when mark_answered then 'answered' else row_before.status end,
                          'has_response', true,
                          'delivered', mark_delivered),
        metadata     => jsonb_build_object('reference', row_before.reference,
                                           'response_length', char_length(btrim(respond_to_inquiry.response)))
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal notes. The body is never written into the audit log — only the
-- fact that a note was added, and by whom.
-- ---------------------------------------------------------------------------
create or replace function public.add_inquiry_note(
    inquiry_id uuid,
    body       text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    row_before record;
    note_id    uuid;
begin
    if not public.is_staff() then
        raise exception 'Only staff may add internal notes.' using errcode = '42501';
    end if;
    if body is null or btrim(body) = '' then
        raise exception 'An internal note cannot be empty.';
    end if;

    select * into row_before from public.inquiries where id = inquiry_id;
    if row_before is null then
        raise exception 'Inquiry not found.';
    end if;

    insert into public.inquiry_notes (inquiry_id, author_id, body)
    values (inquiry_id, auth.uid(), btrim(body))
    returning id into note_id;

    perform public.write_audit(
        action       => 'inquiry.note_added',
        category     => 'inquiries',
        entity_type  => 'inquiry',
        entity_id    => inquiry_id::text,
        entity_label => row_before.reference || ' — ' || row_before.subject,
        decision     => 'noted',
        summary      => 'Internal note added',
        metadata     => jsonb_build_object('reference', row_before.reference)
    );

    return note_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Queue counts for the admin overview and the inquiries page.
-- ---------------------------------------------------------------------------
create or replace function public.inquiry_counts()
returns table (
    new_count         bigint,
    in_progress_count bigint,
    answered_count    bigint,
    closed_count      bigint,
    unassigned_count  bigint,
    mine_count        bigint,
    awaiting_send     bigint
)
language sql
stable
security definer
set search_path = public
as $$
    select
        count(*) filter (where i.status = 'new'),
        count(*) filter (where i.status = 'in_progress'),
        count(*) filter (where i.status = 'answered'),
        count(*) filter (where i.status = 'closed'),
        count(*) filter (where i.assigned_to is null and i.status <> 'closed'),
        count(*) filter (where i.assigned_to = auth.uid() and i.status <> 'closed'),
        -- Responses written but not yet actually sent to the sender.
        count(*) filter (where i.response is not null and not i.response_delivered)
    from public.inquiries i
    where public.is_staff();
$$;

-- ===========================================================================
-- Row level security.
--
-- Anonymous visitors get NO policy on either table. They submit through
-- submit_inquiry(), which is SECURITY DEFINER, and can read nothing back.
-- ===========================================================================

alter table public.inquiries         enable row level security;
alter table public.inquiry_notes     enable row level security;
alter table public.inquiry_categories enable row level security;

-- The category list is needed to render the public form.
create policy inquiry_categories_select on public.inquiry_categories
    for select to anon, authenticated using (is_active);

create policy inquiry_categories_write_admin on public.inquiry_categories
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

-- Staff read the queue.
create policy inquiries_select_staff on public.inquiries
    for select to authenticated using (public.is_staff());

-- A signed-in person may follow the inquiries they submitted themselves, and
-- only those. There is deliberately no path from one member to another's.
create policy inquiries_select_own on public.inquiries
    for select to authenticated
    using (submitted_by is not null and submitted_by = auth.uid());

-- All writes go through the RPCs above, which check the caller's role and
-- write an audit entry in the same transaction. Club admins keep a direct
-- UPDATE path as a fallback; the row trigger records anything done that way.
create policy inquiries_write_admin on public.inquiries
    for all to authenticated
    using (public.is_club_admin()) with check (public.is_club_admin());

-- Internal notes: staff only, with no policy for the sender at all. A member
-- reading their own inquiry has no route to this table.
create policy inquiry_notes_staff on public.inquiry_notes
    for all to authenticated
    using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- What a member may see of their own inquiry.
--
-- A column allow-list rather than a filter, for the same reason as
-- my_decision_history: internal handling columns are not selected here at all,
-- so there is nothing for a policy mistake to expose.
-- ---------------------------------------------------------------------------
create view public.my_inquiries
with (security_invoker = false) as
select
    i.id,
    i.reference,
    i.created_at,
    i.category,
    i.subject,
    i.message,
    i.status,
    i.response,            -- what the club told them
    i.responded_at
from public.inquiries i
where i.submitted_by is not null
  and i.submitted_by = auth.uid();

comment on view public.my_inquiries is
    'A member''s own inquiries. Does not select assigned_to, responded_by, '
    'delivery_note or any internal column, and does not join inquiry_notes.';

grant select on public.my_inquiries to authenticated;

-- ---------------------------------------------------------------------------
-- Audit safety net for anything written directly rather than through an RPC.
-- ---------------------------------------------------------------------------
create trigger inquiries_audit
    after insert or update or delete on public.inquiries
    for each row execute function public.audit_row_change('inquiries', 'inquiry', 'reference');

grant execute on function public.assign_inquiry(uuid, uuid, text) to authenticated;
grant execute on function public.set_inquiry_status(uuid, inquiry_status, text) to authenticated;
grant execute on function public.respond_to_inquiry(uuid, text, boolean, boolean, text) to authenticated;
grant execute on function public.add_inquiry_note(uuid, text) to authenticated;
grant execute on function public.inquiry_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- Export shape for the Inquiries worksheet.
--
-- The message body is included because the point of the sheet is to review
-- what people asked. It returns nothing to a non-admin, like every other
-- export function.
-- ---------------------------------------------------------------------------
create or replace function public.export_inquiries()
returns table (
    reference    text,
    submitted_on date,
    sender_name  text,
    sender_email text,
    category     text,
    subject      text,
    message      text,
    status       text,
    assigned_to  text,
    responded_on date,
    response_sent text
)
language sql
stable
security definer
set search_path = public
as $$
    select
        i.reference,
        i.created_at::date,
        i.sender_name,
        i.sender_email::text,
        coalesce(c.label, i.category),
        i.subject,
        i.message,
        replace(i.status::text, '_', ' '),
        u.full_name,
        i.responded_at::date,
        case when i.response is null then 'No response yet'
             when i.response_delivered then 'Sent'
             else 'Written, not sent' end
    from public.inquiries i
    left join public.inquiry_categories c on c.slug = i.category
    left join public.app_users u on u.id = i.assigned_to
    where public.is_club_admin()      -- no admin, no rows
    order by i.created_at desc;
$$;

revoke execute on function public.export_inquiries() from anon;
grant execute on function public.export_inquiries() to authenticated;

comment on function public.export_inquiries is
    'Feeds the Inquiries worksheet. Internal notes are deliberately absent — '
    'they are club deliberation, not a record of what was asked or answered.';
