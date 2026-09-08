-- ===========================================================================
-- 0066 — submit_inquiry: the rate limits were comparing a parameter to itself.
--
-- The function body opens with `#variable_conflict use_variable`, which tells
-- plpgsql that an identifier matching both a variable and a column is the
-- VARIABLE. Three of its queries then referenced columns whose names are also
-- parameters, so those references silently stopped meaning the column:
--
--     where sender_email = clean_email
--
-- resolved to `<the sender_email parameter> = clean_email` — a comparison of a
-- value with a lowercased copy of itself, and never a filter on the table. It
-- raises no error, which is why it survived since 0014. The effect:
--
--   * for an address typed without surrounding whitespace the two are equal
--     (citext compares case-insensitively), so the predicate is always true
--     and the per-sender limits counted EVERY inquiry in the window. Three
--     messages from three different people in an hour closed the contact form
--     for everyone with "You have already sent several messages";
--   * for an address with leading or trailing space they differ, the predicate
--     is always false, and that sender had no limit at all.
--
--     Neither is the rule anybody intended, and the two failure modes swap
--     over on something as invisible as a trailing space.
--
-- 20260907130200 then rewrote the global ceiling from count(*) to
-- count(distinct sender_email) to stop one attacker rotating addresses from
-- locking the form. Under the same pragma that counts distinct values of a
-- constant, which is 1 — so the ceiling can never be reached and the flood
-- protection that migration exists to fix is currently absent entirely. The
-- count(*) version it replaced did work.
--
-- Fixed by aliasing the table, so every one of these names is unambiguously a
-- column regardless of what the pragma prefers. The pragma is kept: it is
-- doing useful work for the INSERT below, where the column names and the
-- parameter names deliberately match.
-- ===========================================================================

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
      from public.inquiries i
     where i.sender_email = clean_email
       and i.created_at > now() - interval '1 hour';

    if recent_hour >= 3 then
        raise exception
            'You have already sent several messages in the last hour. '
            'Please wait a little before sending another.'
            using errcode = '54000';
    end if;

    select count(*) into recent_day
      from public.inquiries i
     where i.sender_email = clean_email
       and i.created_at > now() - interval '24 hours';

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
    select count(distinct i.sender_email) into global_hour
      from public.inquiries i
     where i.created_at > now() - interval '1 hour';

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
