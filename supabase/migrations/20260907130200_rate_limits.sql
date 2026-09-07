-- ===========================================================================
-- A rate limit that survives the process it was counted in.
--
-- prospective-member-assistant kept its counters in a module-level Map. Edge
-- Functions scale out and cold-start, so "15 requests per 15 minutes" was 15
-- per *isolate* — the real ceiling on a billed Cloudflare AI token was however
-- many isolates an attacker could cause to exist, which is not a ceiling.
--
-- club-records-sheet-sync had no limit at all on mode 'application_submitted',
-- the one mode a non-admin can reach: any applicant could drive unbounded
-- service-role collection and Google pushes.
--
-- Counting in the database is the fix for both. One table, one function, and
-- the limit is global because the state is.
-- ===========================================================================

create table if not exists public.rate_limit_hits (
    bucket      text        not null,
    hit_at      timestamptz not null default now(),
    id          bigserial   primary key
);

create index if not exists rate_limit_hits_bucket_time_idx
    on public.rate_limit_hits (bucket, hit_at desc);

comment on table public.rate_limit_hits is
    'One row per rate-limited action. Deliberately holds no identity beyond '
    'the opaque bucket string its caller composes, and is pruned on write.';

alter table public.rate_limit_hits enable row level security;

-- No policy for anon or authenticated, by design. Only rate_limit_take() —
-- security definer — reads or writes this table, so a caller can neither
-- inspect other people's buckets nor clear their own.

/**
 * Records one hit against `bucket_key` and reports whether it was allowed.
 *
 * Returns true when the action may proceed. The hit is only recorded when it
 * is allowed, so a caller that is already over the limit cannot extend its own
 * lockout by hammering — the window still drains on schedule.
 */
create or replace function public.rate_limit_take(
    bucket_key     text,
    window_seconds integer,
    max_hits       integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    used integer;
begin
    if bucket_key is null or btrim(bucket_key) = '' then
        raise exception 'A rate limit bucket key is required.' using errcode = '22023';
    end if;

    -- Opportunistic pruning. Rows older than a day cannot affect any window
    -- this project uses, and clearing them here means no scheduled job has to
    -- exist for the table to stay small.
    delete from public.rate_limit_hits where hit_at < now() - interval '1 day';

    select count(*) into used
      from public.rate_limit_hits
     where bucket = bucket_key
       and hit_at > now() - make_interval(secs => window_seconds);

    if used >= max_hits then
        return false;
    end if;

    insert into public.rate_limit_hits (bucket) values (bucket_key);
    return true;
end;
$$;

comment on function public.rate_limit_take(text, integer, integer) is
    'Shared counter for Edge Function rate limits. True when the action is '
    'allowed. Counting lives here rather than in an isolate because Edge '
    'Functions scale out, which made in-process counters per-isolate.';

-- Callable by a signed-in user so club-records-sheet-sync can throttle an
-- applicant using that applicant''s own client. The bucket key is composed by
-- the function''s caller, and the table stays unreadable either way.
grant execute on function public.rate_limit_take(text, integer, integer)
    to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The contact form's global ceiling
--
-- submit_inquiry refused every sender once 120 inquiries had been stored in an
-- hour. Per-email limits already cap one address at 3 per hour, so reaching
-- 120 rows meant 40 addresses — but any one attacker able to rotate addresses
-- could then close the form for every legitimate visitor. That is a one-line
-- denial of service against the club's only public contact route.
--
-- The ceiling now counts *distinct senders* rather than rows, which is the
-- number that actually indicates a flood rather than a busy afternoon. The
-- table deliberately stores no IP address (see 0014), so distinctness of the
-- sender is the strongest signal available without changing what is kept
-- about people who write in — and that constraint is worth keeping.
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
set search_path = public, pg_temp
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

    -- A ceiling that keeps a flood from filling the queue faster than a
    -- committee could ever read it.
    --
    -- This counts distinct senders, not rows. Counting rows meant one attacker
    -- rotating addresses could reach 120 and close the form for everybody --
    -- the per-email limits above already cap any single address at 3 an hour,
    -- so a row-count ceiling punished the wrong person. Locking the form now
    -- takes 120 separate addresses in one hour, while a genuinely busy hour
    -- with repeat correspondents no longer trips it.
    select count(distinct sender_email) into global_hour
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
