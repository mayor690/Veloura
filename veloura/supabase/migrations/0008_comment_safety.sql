-- Comment safety: moderator flags, reader reports on comments, and a flag-aware create_comment.

-- A comment can arrive flagged (for example it mentions ages or minors) so staff see it first.
alter table comments add column if not exists flag text;
create index if not exists comments_flag_idx on comments (status, flag) where flag is not null;

-- ---------- reader reports on comments ----------
create table comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references comments on delete cascade,
  reporter_id uuid not null references profiles on delete cascade,
  reason text not null check (reason in ('possible_minor','non_consensual','illegal','spam','personal_info','other')),
  details text,
  status text not null default 'open' check (status in ('open','dismissed','actioned')),
  created_at timestamptz not null default now(),
  unique (comment_id, reporter_id)             -- one report per reader per comment
);
create index on comment_reports (status, created_at);
create index on comment_reports (reporter_id, created_at);
alter table comment_reports enable row level security;   -- server only, no policies

-- Readers report a live comment. Serious reasons pull it back into the review queue at once.
create or replace function create_comment_report(p_user uuid, p_comment uuid, p_reason text, p_details text)
returns text language plpgsql security definer set search_path = public as $$
declare n int; c comments%rowtype; po posts%rowtype; v_urgent boolean;
begin
  if p_reason not in ('possible_minor','non_consensual','illegal','spam','personal_info','other')
    then raise exception 'invalid_reason'; end if;
  if exists (select 1 from profiles where id = p_user and is_banned) then raise exception 'banned'; end if;

  select * into c from comments where id = p_comment and status = 'approved';
  if not found then raise exception 'comment_not_found'; end if;
  select * into po from posts where id = c.post_id;
  if po.author_id <> p_user and not has_access(p_user, po.category_id) then raise exception 'no_access'; end if;
  if c.user_id = p_user then raise exception 'own_comment'; end if;

  if (select count(*) from comment_reports where reporter_id = p_user and created_at > now() - interval '24 hours') >= 20
    then raise exception 'rate_limited'; end if;

  insert into comment_reports (comment_id, reporter_id, reason, details)
  values (p_comment, p_user, p_reason, nullif(btrim(p_details), ''))
  on conflict (comment_id, reporter_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return 'duplicate'; end if;

  v_urgent := p_reason in ('possible_minor','non_consensual','illegal');
  if v_urgent then
    -- Safety first: take the comment off the page and put it back in the review queue, flagged.
    update comments set status = 'pending', approved_at = null, flag = 'reported_' || p_reason
      where id = p_comment and status = 'approved';
    insert into audit_logs (actor_id, action, entity, entity_id, meta)
    values (null, 'comment.auto_hold', 'comment', p_comment::text, jsonb_build_object('reason', p_reason));
  end if;
  return case when v_urgent then 'urgent' else 'ok' end;
end $$;

-- create_comment now takes an optional flag from the app's pre-filter.
drop function if exists create_comment(uuid, uuid, text);
create or replace function create_comment(p_user uuid, p_post uuid, p_body text, p_flag text default null)
returns text language plpgsql security definer set search_path = public as $$
declare po posts%rowtype; v_body text := btrim(coalesce(p_body, ''));
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

  insert into comments (post_id, user_id, body, flag) values (p_post, p_user, v_body, nullif(btrim(coalesce(p_flag, '')), ''));
  return 'pending';
end $$;

-- Staff closing a comment also closes its open reports.
create or replace function close_comment_reports(p_comment uuid, p_status text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_status not in ('dismissed','actioned') then raise exception 'invalid_status'; end if;
  update comment_reports set status = p_status where comment_id = p_comment and status = 'open';
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function create_comment_report(uuid,uuid,text,text) from public, anon, authenticated;
revoke execute on function create_comment(uuid,uuid,text,text) from public, anon, authenticated;
revoke execute on function close_comment_reports(uuid,text) from public, anon, authenticated;
