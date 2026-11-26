-- Trusted commenters: an admin switch (off by default) lets established accounts' comments go live at once.
-- A comment is auto-approved only when ALL of these hold:
--   * the switch comment_auto_approve is on,
--   * the app's pre-filter did not flag it,
--   * the account has at least comment_trust_min_approved approved comments,
--   * none of its comments were rejected or removed in the last 90 days,
--   * none of its comments has an open reader report.
-- Everything else waits for review exactly as before. Daily comment limits are unchanged.

alter table comments add column if not exists auto_approved boolean not null default false;
alter table comments add column if not exists moderated_at timestamptz;

-- Remember when staff (or a serious report) last took a comment down, so "rejected in the last 90 days" is exact.
create or replace function set_comment_moderated_at() returns trigger language plpgsql as $$
begin
  if new.status in ('rejected','removed') and new.status is distinct from old.status then new.moderated_at := now(); end if;
  return new;
end $$;
drop trigger if exists comments_moderated_at on comments;
create trigger comments_moderated_at before update of status on comments
  for each row execute function set_comment_moderated_at();

insert into site_settings (key, value) values
 ('comment_auto_approve', 'false'),
 ('comment_trust_min_approved', '5')
on conflict (key) do nothing;

create or replace function create_comment(p_user uuid, p_post uuid, p_body text, p_flag text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  po posts%rowtype; v_body text := btrim(coalesce(p_body, '')); v_flag text := nullif(btrim(coalesce(p_flag, '')), '');
  v_auto boolean; v_min int; v_trusted boolean := false;
begin
  if char_length(v_body) < 2 or char_length(v_body) > 1000 then raise exception 'invalid_body'; end if;
  select * into po from posts where id = p_post and status = 'approved' and held_at is null;
  if not found then raise exception 'post_not_found'; end if;
  if exists (select 1 from profiles where id = p_user and is_banned) then raise exception 'banned'; end if;
  if po.author_id <> p_user and not has_access(p_user, po.category_id) then raise exception 'no_access'; end if;

  if (select count(*) from comments where post_id = p_post and user_id = p_user and created_at > now() - interval '24 hours') >= 3
    then raise exception 'rate_limited'; end if;
  if (select count(*) from comments where user_id = p_user and created_at > now() - interval '24 hours') >= 20
    then raise exception 'rate_limited'; end if;
  if (select count(*) from comments where user_id = p_user and status = 'pending') >= 5
    then raise exception 'too_many_pending'; end if;

  select coalesce((select value = 'true'::jsonb from site_settings where key = 'comment_auto_approve'), false) into v_auto;
  select greatest(1, coalesce((select (value #>> '{}')::int from site_settings where key = 'comment_trust_min_approved'), 5)) into v_min;

  if v_auto and v_flag is null then
    v_trusted :=
      (select count(*) from comments where user_id = p_user and status = 'approved') >= v_min
      and not exists (select 1 from comments where user_id = p_user and status in ('rejected','removed')
                      and coalesce(moderated_at, created_at) > now() - interval '90 days')
      and not exists (select 1 from comment_reports r join comments c on c.id = r.comment_id
                      where c.user_id = p_user and r.status = 'open');
  end if;

  if v_trusted then
    insert into comments (post_id, user_id, body, flag, status, approved_at, auto_approved)
    values (p_post, p_user, v_body, null, 'approved', now(), true);
    return 'approved';
  end if;

  insert into comments (post_id, user_id, body, flag) values (p_post, p_user, v_body, v_flag);
  return 'pending';
end $$;

revoke execute on function create_comment(uuid,uuid,text,text) from public, anon, authenticated;
