-- Repair defects found by `supabase db lint --linked` after the initial chain
-- was first exercised against PostgreSQL. The original migrations carry the
-- same corrections so a fresh database is born correct; this forward migration
-- repairs databases that already applied them.

alter function public.scrub_sensitive(jsonb) stable;

do $$
declare
    target regprocedure;
    definition text;
begin
    foreach target in array array[
        'public.resolve_profile_removal(uuid,boolean,text)'::regprocedure,
        'public.resolve_position_request(uuid,boolean,uuid,date,text)'::regprocedure,
        'public.resolve_member_request(uuid,boolean,text,text)'::regprocedure
    ] loop
        select pg_get_functiondef(target) into definition;
        definition := replace(
            definition,
            'set status = CASE' || chr(10) ||
            '                WHEN approve THEN ''approved''::text' || chr(10) ||
            '                ELSE ''rejected''::text' || chr(10) ||
            '            END,',
            'set status = (CASE' || chr(10) ||
            '                WHEN approve THEN ''approved''::text' || chr(10) ||
            '                ELSE ''rejected''::text' || chr(10) ||
            '            END)::request_status,'
        );
        execute definition;
    end loop;
end;
$$;

-- Parameter names in this RPC intentionally match column names. Qualifying
-- both sides removes PL/pgSQL ambiguity without changing its public signature.
do $$
declare
    target regprocedure :=
        'public.respond_to_inquiry(uuid,text,boolean,boolean,text)'::regprocedure;
    definition text;
begin
    select pg_get_functiondef(target) into definition;
    definition := replace(definition,
        'response = btrim(response)',
        'response = btrim(respond_to_inquiry.response)');
    definition := replace(definition,
        'delivery_note = delivery_note',
        'delivery_note = respond_to_inquiry.delivery_note');
    definition := replace(definition,
        'WHEN status = ''new''::inquiry_status',
        'WHEN inquiries.status = ''new''::inquiry_status');
    definition := replace(definition,
        'ELSE status',
        'ELSE inquiries.status');
    definition := replace(definition,
        'char_length(btrim(response))',
        'char_length(btrim(respond_to_inquiry.response))');
    execute definition;
end;
$$;
