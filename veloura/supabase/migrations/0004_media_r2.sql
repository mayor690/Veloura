-- Media lives in Cloudflare R2 (private bucket). Postgres only tracks upload sessions and object keys.

create type upload_status_t as enum ('initiated','verified','attached','aborted','rejected');

create table media_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  object_key text unique not null,              -- R2 key, random; never contains user or post ids
  kind media_type_t not null,
  mime_type text not null,
  declared_size_bytes bigint not null check (declared_size_bytes > 0),
  size_bytes bigint,                            -- confirmed from R2 after upload
  mode text not null check (mode in ('single','multipart')),
  r2_upload_id text,                            -- multipart upload id
  part_size int,
  part_count int,
  duration_ms int, width int, height int,       -- reported by the browser; moderators confirm by watching
  status upload_status_t not null default 'initiated',
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create index on media_uploads (user_id, created_at desc);
create index on media_uploads (status, created_at);
alter table media_uploads enable row level security;   -- no policies: server (service role) only

alter table posts add column consent_confirmed_at timestamptz;   -- poster confirmed 18+ and consent of everyone shown
alter table post_media add column upload_id uuid references media_uploads;
comment on column post_media.storage_path is 'Cloudflare R2 object key. Never a public URL.';

create table audit_logs (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  entity text,
  entity_id text,
  meta jsonb,
  created_at timestamptz not null default now()
);
alter table audit_logs enable row level security;       -- service role only

-- Atomic post creation: validates the uploads, creates the post (pending moderation) and its media rows.
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
          nullif(btrim(p_preview), ''), coalesce(p_is_premium, true), 'pending', now())
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

revoke execute on function create_post_with_media(uuid,uuid,text,text,text,boolean,boolean,uuid[])
  from public, anon, authenticated;
