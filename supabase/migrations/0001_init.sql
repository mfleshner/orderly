-- Usual Order: schema, RLS, and RPCs.
-- Apply with `supabase db push` or paste into the Supabase SQL editor.


-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique check (invite_code ~ '^[A-Z0-9]{5}$'), -- generated codes use the unambiguous alphabet (see gen_invite_code)
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.members (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 30),
  color        text not null,
  removed_at   timestamptz,                -- soft remove: hidden from lists, row and orders kept
  created_at   timestamptz not null default now(),
  unique (group_id, display_name)
);
create index members_user_id_idx on public.members(user_id);
create index members_group_id_idx on public.members(group_id);

create table public.restaurants (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  note       text,
  created_at timestamptz not null default now()
);
create index restaurants_group_id_idx on public.restaurants(group_id);

create table public.orders (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  member_id     uuid not null references public.members(id) on delete cascade,
  trying_note   text,
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, member_id)
);
create index orders_restaurant_id_idx on public.orders(restaurant_id);

create table public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  item_name  text not null check (char_length(item_name) between 1 and 120),
  quantity   int not null default 1 check (quantity between 1 and 99),
  modifiers  text,
  sort_order int not null default 0
);
create index order_items_order_id_idx on public.order_items(order_id);

-- ---------------------------------------------------------------------------
-- Helpers (security definer so RLS policies don't recurse into members)
-- ---------------------------------------------------------------------------

create or replace function public.is_group_member(gid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members
    where group_id = gid and user_id = auth.uid() and removed_at is null
  );
$$;

create or replace function public.is_restaurant_member(rid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.restaurants r
    join public.members m on m.group_id = r.group_id
    where r.id = rid and m.user_id = auth.uid() and m.removed_at is null
  );
$$;

create or replace function public.is_order_member(oid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    join public.members m on m.group_id = r.group_id
    where o.id = oid and m.user_id = auth.uid() and m.removed_at is null
  );
$$;

-- Member colors: a fixed palette, least-used color in the group wins.
create or replace function public.pick_member_color(gid uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  palette text[] := array[
    '#e0533c','#2f7fd6','#2aa876','#d9a021','#9256d9',
    '#d6479c','#1fa3a3','#e07a1f','#5e6ad2','#6e8b3d'
  ];
  chosen text;
begin
  select c into chosen
  from unnest(palette) with ordinality as p(c, ord)
  left join public.members m on m.group_id = gid and m.color = p.c
  group by p.c, p.ord
  order by count(m.id), p.ord
  limit 1;
  return chosen;
end;
$$;

create or replace function public.gen_invite_code()
returns text
language plpgsql volatile as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..5 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.groups where invite_code = code);
  end loop;
  return code;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs called from the browser
-- ---------------------------------------------------------------------------

-- Create a group and add the caller as its first member. Returns the group id.
create or replace function public.create_group(group_name text, member_name text)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  gid uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  insert into public.groups (name, invite_code, created_by)
  values (trim(group_name), public.gen_invite_code(), uid)
  returning id into gid;
  insert into public.members (group_id, user_id, display_name, color)
  values (gid, uid, trim(member_name), public.pick_member_color(gid));
  return gid;
end;
$$;

-- Look up a group by invite code. Callable before you are a member: the code is the secret.
-- Returns the group and the names in it (so the join screen can offer "Is this you?").
create or replace function public.preview_invite(code text)
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', g.id,
    'name', g.name,
    'members', coalesce((
      select json_agg(json_build_object('id', m.id, 'display_name', m.display_name, 'claimed', m.user_id is not null)
                      order by m.display_name)
      from public.members m where m.group_id = g.id and m.removed_at is null
    ), '[]'::json),
    'already_member', exists (
      select 1 from public.members m where m.group_id = g.id and m.user_id = auth.uid() and m.removed_at is null
    )
  )
  from public.groups g
  where g.invite_code = upper(trim(code));
$$;

-- Join a group by invite code with a display name.
-- If the name exists and reclaim = true, the existing member row is reassigned to the caller
-- (also un-removes it). If it exists and reclaim = false, raises 'name_taken'.
create or replace function public.join_group(code text, member_name text, reclaim boolean default false)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  gid uuid;
  existing public.members%rowtype;
  nm text := trim(member_name);
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
  else
    insert into public.members (group_id, user_id, display_name, color)
    values (gid, uid, nm, public.pick_member_color(gid));
  end if;
  return gid;
end;
$$;

-- Replace a member's usual for a restaurant in one call. Creates the order row if needed.
-- items: [{ item_name, quantity, modifiers }]
create or replace function public.save_order(rid uuid, mid uuid, items json, trying text)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  oid uuid;
  gid uuid;
begin
  select group_id into gid from public.restaurants where id = rid;
  if gid is null or not public.is_group_member(gid) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from public.members where id = mid and group_id = gid) then
    raise exception 'member_not_in_group';
  end if;

  insert into public.orders (restaurant_id, member_id, trying_note)
  values (rid, mid, nullif(trim(coalesce(trying, '')), ''))
  on conflict (restaurant_id, member_id) do update
    set trying_note = excluded.trying_note, updated_at = now()
  returning id into oid;

  delete from public.order_items where order_id = oid;
  insert into public.order_items (order_id, item_name, quantity, modifiers, sort_order)
  select oid,
         left(trim(i->>'item_name'), 120),
         greatest(1, least(99, coalesce((i->>'quantity')::int, 1))),
         nullif(trim(coalesce(i->>'modifiers', '')), ''),
         ord - 1
  from json_array_elements(items) with ordinality as t(i, ord)
  where trim(coalesce(i->>'item_name', '')) <> '';

  return oid;
end;
$$;

-- Soft-remove a member (or leave, when mid is your own member). Keeps the row and orders.
create or replace function public.remove_member(mid uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  gid uuid;
begin
  select group_id into gid from public.members where id = mid;
  if gid is null or not public.is_group_member(gid) then raise exception 'not_allowed'; end if;
  update public.members set removed_at = now(), user_id = null where id = mid;
end;
$$;

grant execute on function public.create_group(text, text) to authenticated;
grant execute on function public.preview_invite(text) to authenticated;
grant execute on function public.join_group(text, text, boolean) to authenticated;
grant execute on function public.save_order(uuid, uuid, json, text) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.is_restaurant_member(uuid) to authenticated;
grant execute on function public.is_order_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- A user can read and write rows in any group where a members row has their user_id.
-- ---------------------------------------------------------------------------

-- Explicit table privileges so this works even with "Automatically expose new tables" off.
-- Anonymous sign-ins use the `authenticated` role; RLS below is the real boundary.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.groups, public.members, public.restaurants, public.orders, public.order_items
  to authenticated;

alter table public.groups      enable row level security;
alter table public.members     enable row level security;
alter table public.restaurants enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

create policy groups_select on public.groups for select to authenticated
  using (public.is_group_member(id));
create policy groups_update on public.groups for update to authenticated
  using (public.is_group_member(id)) with check (public.is_group_member(id));

create policy members_select on public.members for select to authenticated
  using (public.is_group_member(group_id));
create policy members_insert on public.members for insert to authenticated
  with check (public.is_group_member(group_id));
create policy members_update on public.members for update to authenticated
  using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));
create policy members_delete on public.members for delete to authenticated
  using (public.is_group_member(group_id));

create policy restaurants_all on public.restaurants for all to authenticated
  using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));

create policy orders_all on public.orders for all to authenticated
  using (public.is_restaurant_member(restaurant_id)) with check (public.is_restaurant_member(restaurant_id));

create policy order_items_all on public.order_items for all to authenticated
  using (public.is_order_member(order_id)) with check (public.is_order_member(order_id));
