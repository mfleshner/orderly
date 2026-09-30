-- Bring your restaurants (and your usuals) into a new group, and fill in a
-- joining member's usuals from their other groups.
--
-- Backward compatible: create_group keeps its (group_name, member_name) call shape;
-- restaurant_ids is a new optional argument defaulting to none.
--
-- Duplicates across your groups are merged by name + note (case-insensitive, trimmed).
-- When merged, the copy with your most recently updated usual wins.

-- Restaurants in every group you're an active member of, deduplicated, with your usual.
-- Shape: [{ id, name, note, groups: [group names], items: [{item_name, quantity, modifiers}], trying_note }]
create or replace function public.copyable_restaurants()
returns json
language sql stable security definer set search_path = public as $$
  with mine as (
    select r.id, r.name, r.note, g.name as group_name, o.id as order_id, o.trying_note, o.updated_at,
           exists (select 1 from public.order_items oi where oi.order_id = o.id) as has_items,
           lower(trim(r.name)) as k_name, lower(trim(coalesce(r.note, ''))) as k_note
    from public.restaurants r
    join public.groups g on g.id = r.group_id
    join public.members m on m.group_id = r.group_id and m.user_id = auth.uid() and m.removed_at is null
    left join public.orders o on o.restaurant_id = r.id and o.member_id = m.id
  ),
  best as (
    select distinct on (k_name, k_note) *
    from mine
    order by k_name, k_note, has_items desc, (order_id is not null) desc, updated_at desc nulls last
  )
  select coalesce(json_agg(json_build_object(
    'id', b.id,
    'name', b.name,
    'note', b.note,
    'groups', (select json_agg(distinct m2.group_name) from mine m2 where m2.k_name = b.k_name and m2.k_note = b.k_note),
    'items', coalesce((
      select json_agg(json_build_object('item_name', oi.item_name, 'quantity', oi.quantity, 'modifiers', oi.modifiers)
                      order by oi.sort_order)
      from public.order_items oi where oi.order_id = b.order_id
    ), '[]'::json),
    'trying_note', b.trying_note
  ) order by b.k_name, b.k_note), '[]'::json)
  from best b;
$$;

grant execute on function public.copyable_restaurants() to authenticated;

-- Replace create_group with a version that can also copy restaurants + the caller's usuals.
drop function if exists public.create_group(text, text);

create or replace function public.create_group(
  group_name text,
  member_name text,
  restaurant_ids uuid[] default '{}'
)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  gid uuid;
  me uuid;
  src record;
  new_rid uuid;
  new_oid uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  insert into public.groups (name, invite_code, created_by)
  values (trim(group_name), public.gen_invite_code(), uid)
  returning id into gid;
  insert into public.members (group_id, user_id, display_name, color)
  values (gid, uid, trim(member_name), public.pick_member_color(gid))
  returning id into me;

  -- Only restaurants from groups the caller is actively in; merge duplicates.
  for src in
    select distinct on (lower(trim(r.name)), lower(trim(coalesce(r.note, ''))))
           r.name, r.note, o.id as order_id, o.trying_note
    from public.restaurants r
    join public.members m on m.group_id = r.group_id and m.user_id = uid and m.removed_at is null
    left join public.orders o on o.restaurant_id = r.id and o.member_id = m.id
    where r.id = any(coalesce(restaurant_ids, '{}'))
    order by lower(trim(r.name)), lower(trim(coalesce(r.note, ''))),
             (exists (select 1 from public.order_items oi where oi.order_id = o.id)) desc,
             (o.id is not null) desc, o.updated_at desc nulls last
  loop
    insert into public.restaurants (group_id, name, note)
    values (gid, src.name, src.note)
    returning id into new_rid;

    if src.order_id is not null then
      insert into public.orders (restaurant_id, member_id, trying_note)
      values (new_rid, me, src.trying_note)
      returning id into new_oid;
      insert into public.order_items (order_id, item_name, quantity, modifiers, sort_order)
      select new_oid, item_name, quantity, modifiers, sort_order
      from public.order_items where order_id = src.order_id;
    end if;
  end loop;

  return gid;
end;
$$;

grant execute on function public.create_group(text, text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- When someone joins a group, fill in their usual at any restaurant there that
-- matches (by name, case-insensitive) one where they have a usual in another group.
-- Only fills restaurants where they have no order yet; never overwrites.
-- Prefers a match with the same note, then the most recently updated usual.
-- ---------------------------------------------------------------------------

create or replace function public.fill_usuals_from_other_groups(mid uuid)
returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  target public.members%rowtype;
  src record;
  new_oid uuid;
  filled int := 0;
begin
  select * into target from public.members where id = mid;
  if target.user_id is null then return 0; end if;

  for src in
    select distinct on (r.id) r.id as rid, o.id as order_id, o.trying_note
    from public.restaurants r
    join public.restaurants r2 on lower(trim(r2.name)) = lower(trim(r.name)) and r2.group_id <> r.group_id
    join public.members m2 on m2.group_id = r2.group_id and m2.user_id = target.user_id and m2.removed_at is null
    join public.orders o on o.restaurant_id = r2.id and o.member_id = m2.id
    where r.group_id = target.group_id
      and exists (select 1 from public.order_items oi where oi.order_id = o.id)
      and not exists (select 1 from public.orders mine where mine.restaurant_id = r.id and mine.member_id = mid)
    order by r.id,
             (lower(trim(coalesce(r2.note, ''))) = lower(trim(coalesce(r.note, '')))) desc,
             o.updated_at desc
  loop
    insert into public.orders (restaurant_id, member_id, trying_note)
    values (src.rid, mid, src.trying_note)
    returning id into new_oid;
    insert into public.order_items (order_id, item_name, quantity, modifiers, sort_order)
    select new_oid, item_name, quantity, modifiers, sort_order
    from public.order_items where order_id = src.order_id;
    filled := filled + 1;
  end loop;
  return filled;
end;
$$;

-- Internal only: called from join_group, not from the browser.
revoke execute on function public.fill_usuals_from_other_groups(uuid) from public, anon, authenticated;

-- Same as 0001's join_group, plus the fill step for the joining member.
create or replace function public.join_group(code text, member_name text, reclaim boolean default false)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  gid uuid;
  existing public.members%rowtype;
  nm text := trim(member_name);
  mid uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select id into gid from public.groups where invite_code = upper(trim(code));
  if gid is null then raise exception 'invalid_code'; end if;

  -- already in this group? just return it
  if exists (select 1 from public.members where group_id = gid and user_id = uid and removed_at is null) then
    return gid;
  end if;

  select * into existing from public.members
  where group_id = gid and lower(display_name) = lower(nm);

  if found then
    if not reclaim then raise exception 'name_taken'; end if;
    -- detach any other row this user may hold in the group (e.g. a removed one)
    update public.members set user_id = null where group_id = gid and user_id = uid and id <> existing.id;
    update public.members set user_id = uid, removed_at = null where id = existing.id;
    mid := existing.id;
  else
    insert into public.members (group_id, user_id, display_name, color)
    values (gid, uid, nm, public.pick_member_color(gid))
    returning id into mid;
  end if;

  perform public.fill_usuals_from_other_groups(mid);
  return gid;
end;
$$;

-- Make the Data API pick up the new function signature right away.
notify pgrst, 'reload schema';
