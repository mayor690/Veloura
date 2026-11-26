-- Earnings: only a user's FIRST approved comment on a post earns the author points, once, on the day it was approved.
-- Readers can still comment as often as the daily limits allow, and every approved comment still shows on the page
-- and in the public comment count. Later comments by the same account on the same post earn nothing, on any day.
-- If that first comment is later removed, the account earns nothing more on that post (it does not "move" to the next one).
-- Past payouts are not changed; this only affects earnings runs from now on.

create or replace function earn_points(p_date date, wv int, wr int, wc int)
returns table (post_id uuid, creator_id uuid, views int, reactions int, comments int, points numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.author_id, v.n::int, r.n::int, c.n::int, (v.n * wv + r.n * wr + c.n * wc)::numeric
  from posts p
  join profiles a on a.id = p.author_id and not a.is_banned
  cross join lateral (
    select count(*) as n from post_views pv join profiles u on u.id = pv.viewer_id
    where pv.post_id = p.id and pv.view_date = p_date and pv.viewer_id <> p.author_id and not u.is_banned) v
  cross join lateral (
    select count(*) as n from post_reactions x join profiles u on u.id = x.user_id
    where x.post_id = p.id and (x.created_at at time zone 'Africa/Lagos')::date = p_date
      and x.user_id <> p.author_id and not u.is_banned) r
  cross join lateral (
    -- one row per commenter: their earliest approval on this post
    select count(*) as n
    from (
      select distinct on (cm.user_id) cm.user_id, cm.status, cm.approved_at
      from comments cm
      where cm.post_id = p.id and cm.approved_at is not null and cm.user_id <> p.author_id
      order by cm.user_id, cm.approved_at
    ) f
    join profiles u on u.id = f.user_id
    where f.status = 'approved' and (f.approved_at at time zone 'Africa/Lagos')::date = p_date and not u.is_banned) c
  where p.status = 'approved' and p.held_at is null;
$$;
