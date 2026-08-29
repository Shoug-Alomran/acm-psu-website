-- The prior repair intentionally used pg_get_functiondef so public signatures
-- stayed untouched, but PostgreSQL preserves the lowercase PL/pgSQL body text.
-- Apply the body replacements against that exact representation.

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
            'set status = case when approve then ''approved'' else ''rejected'' end,',
            'set status = (case when approve then ''approved'' else ''rejected'' end)::request_status,'
        );
        execute definition;
    end loop;
end;
$$;

do $$
declare
    target regprocedure :=
        'public.respond_to_inquiry(uuid,text,boolean,boolean,text)'::regprocedure;
    definition text;
begin
    select pg_get_functiondef(target) into definition;
    definition := replace(definition,
        'response           = btrim(response)',
        'response           = btrim(respond_to_inquiry.response)');
    definition := replace(definition,
        'delivery_note      = delivery_note',
        'delivery_note      = respond_to_inquiry.delivery_note');
    definition := replace(definition,
        'when status = ''new'' then',
        'when inquiries.status = ''new'' then');
    definition := replace(definition,
        'else status end',
        'else inquiries.status end');
    definition := replace(definition,
        'char_length(btrim(response))',
        'char_length(btrim(respond_to_inquiry.response))');
    execute definition;
end;
$$;
