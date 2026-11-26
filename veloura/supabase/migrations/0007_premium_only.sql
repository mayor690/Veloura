-- Veloura is premium-only: there is no free content. Every post needs an active unlock to read, react or comment.

update posts set is_premium = true where not is_premium;
alter table posts alter column is_premium set default true;
alter table posts add constraint posts_premium_only check (is_premium);   -- the column stays, but can never be false

-- Posts are always created as premium, whatever the caller passes.
create or replace function create_post_with_media(
  p_user uuid, p_category uuid, p_title text, p_body text, p_preview text,
  p_is_premium boolean, p_consent boolean, p_upload_ids uuid[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_post uuid; v_media int; v_n int; v_videos int;
begin
  if not coalesce(p_consent, false) then raise exception 'consent_required'; end if;
  if exists (select 1 from profiles where id = p_user and is_banned) then raise exception 'banned'; end if;
  if not exists (select 1 from categories where id = p_category and is_active) then raise exception 'invalid_category'; end if;

  v_media := coalesce(array_length(p_upload_ids, 1), 0);
  if coalesce(length(btrim(p_body)), 0) = 0 and v_media = 0 then raise exception 'empty_post'; end if;
  if v_media > 7 then raise exception 'too_much_media'; end if;
  if (select count(*) from posts where author_id = p_user and status = 'pending') >= 10
    then raise exception 'too_many_pending'; end if;

  if v_media > 0 then
    perform 1 from media_uploads
      where id = any(p_upload_ids) and user_id = p_user and status = 'verified' for update;
    select count(*), count(*) filter (where kind = 'video') into v_n, v_videos
      from media_uploads where id = any(p_upload_ids) and user_id = p_user and status = 'verified';
    if v_n <> v_media then raise exception 'invalid_upload'; end if;
    if v_videos > 1 then raise exception 'too_much_media'; end if;
  end if;

  insert into posts (author_id, category_id, title, body, preview_text, is_premium, status, consent_confirmed_at)
  values (p_user, p_category, nullif(btrim(p_title), ''), nullif(btrim(p_body), ''),
          nullif(btrim(p_preview), ''), true, 'pending', now())
  returning id into v_post;

  if v_media > 0 then
    insert into post_media (post_id, type, storage_path, mime_type, size_bytes, duration_ms, width, height,
                            status, sort_order, upload_id)
    select v_post, m.kind, m.object_key, m.mime_type, m.size_bytes, m.duration_ms, m.width, m.height,
           'ready', (u.ord - 1)::int, m.id
    from unnest(p_upload_ids) with ordinality as u(id, ord)
    join media_uploads m on m.id = u.id;

    update media_uploads set status = 'attached' where id = any(p_upload_ids);
  end if;
  return v_post;
end $$;

-- Reacting and commenting need an active unlock for the post's category (authors may join their own posts).
create or replace function set_reaction(p_user uuid, p_post uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare po posts%rowtype;
begin
  select * into po from posts where id = p_post and status = 'approved' and held_at is null;
  if not found then raise exception 'post_not_found'; end if;
  if exists (select 1 from profiles where id = p_user and is_banned) then raise exception 'banned'; end if;
  if po.author_id <> p_user and not has_access(p_user, po.category_id) then raise exception 'no_access'; end if;

  if p_kind is null then
    delete from post_reactions where post_id = p_post and user_id = p_user;
  else
    if p_kind not in ('like','love','fire') then raise exception 'invalid_kind'; end if;
    insert into post_reactions (post_id, user_id, kind) values (p_post, p_user, p_kind)
    on conflict (post_id, user_id) do update set kind = excluded.kind;
  end if;
  return post_engagement(p_post, p_user);
end $$;

create or replace function create_comment(p_user uuid, p_post uuid, p_body text)
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

  insert into comments (post_id, user_id, body) values (p_post, p_user, v_body);
  return 'pending';
end $$;

revoke execute on function create_post_with_media(uuid,uuid,text,text,text,boolean,boolean,uuid[]) from public, anon, authenticated;
revoke execute on function set_reaction(uuid,uuid,text) from public, anon, authenticated;
revoke execute on function create_comment(uuid,uuid,text) from public, anon, authenticated;
