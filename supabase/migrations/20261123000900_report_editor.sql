-- Editable drafts and legacy template drafts share one immutable revision stream.
-- The public archive still reads only separately reviewed publication snapshots.
create function private.clean_report_layout(p_layout jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_title text;
  v_heading text;
  v_body text;
  v_section jsonb;
  v_sections jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_layout) is distinct from 'object' then
    raise exception 'REPORT_INVALID_INPUT';
  end if;
  if octet_length(p_layout::text) > 262144 then
    raise exception 'REPORT_LAYOUT_TOO_LARGE';
  end if;
  if p_layout - array['title', 'source', 'sections'] <> '{}'::jsonb
    or jsonb_typeof(p_layout->'title') is distinct from 'string'
    or jsonb_typeof(p_layout->'sections') is distinct from 'array'
    or jsonb_typeof(p_layout->'source') is distinct from 'string'
    or p_layout->>'source' not in ('template', 'blank') then
    raise exception 'REPORT_INVALID_INPUT';
  end if;

  v_title := regexp_replace(p_layout->>'title', '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if char_length(v_title) not between 1 and 120 or jsonb_array_length(p_layout->'sections') > 24 then
    raise exception 'REPORT_INVALID_INPUT';
  end if;
  for v_section in select value from jsonb_array_elements(p_layout->'sections') with ordinality order by ordinality loop
    if jsonb_typeof(v_section) is distinct from 'object' then raise exception 'REPORT_INVALID_INPUT'; end if;
    if v_section - array['heading', 'body'] <> '{}'::jsonb
      or jsonb_typeof(v_section->'heading') is distinct from 'string'
      or jsonb_typeof(v_section->'body') is distinct from 'string' then
      raise exception 'REPORT_INVALID_INPUT';
    end if;
    v_heading := regexp_replace(v_section->>'heading', '^[[:space:]]+|[[:space:]]+$', '', 'g');
    v_body := v_section->>'body';
    if char_length(v_heading) not between 1 and 120 or char_length(v_body) > 24000 then
      raise exception 'REPORT_INVALID_INPUT';
    end if;
    v_sections := v_sections || jsonb_build_array(jsonb_build_object('heading', v_heading, 'body', v_body));
  end loop;
  return jsonb_build_object('method', 'editable', 'source', p_layout->>'source', 'title', v_title, 'sections', v_sections);
end;
$$;

create function public.save_project_report_layout(p_project_id uuid, p_kind text, p_expected_number integer, p_layout jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_current integer; v_draft jsonb; v_revision public.project_report_revisions;
begin
  -- The project row lock serializes layout saves, legacy saves, and owner publication writes.
  perform private.lock_report_owner(p_project_id);
  perform private.require_report_kind(p_kind);
  select coalesce(max(r.revision_number), 0) into v_current from public.project_report_revisions r
    where r.project_id = p_project_id and r.kind = p_kind;
  if p_expected_number is distinct from v_current then raise exception 'REPORT_REVISION_CONFLICT'; end if;
  v_draft := private.clean_report_layout(p_layout);

  insert into public.project_report_revisions (project_id, kind, revision_number, created_by, inputs, draft)
    values (p_project_id, p_kind, v_current + 1, auth.uid(), '{}'::jsonb, v_draft)
    returning * into v_revision;
  return private.report_revision_json(v_revision);
end;
$$;

-- Owners may still save generated drafts through legacy clients until this report type
-- switches to an editable layout. Both save paths lock and authorize the same owner.
create or replace function public.save_project_report(p_project_id uuid, p_kind text, p_expected_number integer, p_inputs jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_current integer; v_method text; v_inputs jsonb; v_revision public.project_report_revisions;
begin
  perform private.lock_report_owner(p_project_id);
  perform private.require_report_kind(p_kind);
  v_inputs := private.clean_report_inputs(p_inputs);
  select r.revision_number, r.draft->>'method' into v_current, v_method from public.project_report_revisions r
    where r.project_id = p_project_id and r.kind = p_kind order by r.revision_number desc limit 1;
  if v_method = 'editable' then raise exception 'REPORT_LAYOUT_LOCKED'; end if;
  v_current := coalesce(v_current, 0);
  if p_expected_number is distinct from v_current then raise exception 'REPORT_REVISION_CONFLICT'; end if;
  insert into public.project_report_revisions (project_id, kind, revision_number, created_by, inputs, draft)
    values (p_project_id, p_kind, v_current + 1, auth.uid(), v_inputs, private.build_report_draft(p_project_id, p_kind, v_inputs))
    returning * into v_revision;
  return private.report_revision_json(v_revision);
end;
$$;

revoke all on function private.clean_report_layout(jsonb), public.save_project_report_layout(uuid,text,integer,jsonb)
  from public, anon, authenticated;
grant execute on function public.save_project_report_layout(uuid,text,integer,jsonb) to authenticated;
