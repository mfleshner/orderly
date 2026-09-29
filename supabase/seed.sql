-- Seed: one group, two restaurants, three members with orders.
-- Members are unclaimed (user_id null) so you can reclaim them via /join/TEST1.
-- Run after the migration. Safe to re-run: it deletes the TEST1 group first.

delete from public.groups where invite_code = 'TEST1';

do $$
declare
  seed_user uuid;
  gid uuid; torchys uuid; whataburger uuid;
  matt uuid; jake uuid; sam uuid;
  o uuid;
begin
  -- groups.created_by must reference a real auth user; use the first one that exists.
  select id into seed_user from auth.users order by created_at limit 1;
  if seed_user is null then
    raise exception 'Open the app once (anonymous sign-in creates an auth user), then re-run the seed.';
  end if;

  insert into public.groups (name, invite_code, created_by)
  values ('The Usual Crew', 'TEST1', seed_user) returning id into gid;

  insert into public.members (group_id, display_name, color) values (gid, 'Matt', '#e0533c') returning id into matt;
  insert into public.members (group_id, display_name, color) values (gid, 'Jake', '#2f7fd6') returning id into jake;
  insert into public.members (group_id, display_name, color) values (gid, 'Sam',  '#2aa876') returning id into sam;

  insert into public.restaurants (group_id, name, note) values (gid, 'Torchy''s Tacos', 'the one on Eldorado') returning id into torchys;
  insert into public.restaurants (group_id, name, note) values (gid, 'Whataburger', null) returning id into whataburger;

  -- Torchy's
  insert into public.orders (restaurant_id, member_id) values (torchys, matt) returning id into o;
  insert into public.order_items (order_id, item_name, quantity, modifiers, sort_order) values
    (o, 'Trailer Park', 1, 'trashy', 0), (o, 'Green chile queso', 1, null, 1);

  insert into public.orders (restaurant_id, member_id, trying_note) values (torchys, jake, 'Brushfire, extra hot') returning id into o;
  insert into public.order_items (order_id, item_name, quantity, modifiers, sort_order) values
    (o, 'Fried Avocado', 2, 'no pico', 0), (o, 'Unsweet tea', 1, null, 1);

  insert into public.orders (restaurant_id, member_id) values (torchys, sam) returning id into o;
  insert into public.order_items (order_id, item_name, quantity, modifiers, sort_order) values
    (o, 'Kids quesadilla', 1, null, 0), (o, 'Chips', 1, 'no salsa', 1);

  -- Whataburger (Sam has no usual here)
  insert into public.orders (restaurant_id, member_id) values (whataburger, matt) returning id into o;
  insert into public.order_items (order_id, item_name, quantity, modifiers, sort_order) values
    (o, '#1 Whataburger', 1, 'no onions', 0), (o, 'Dr Pepper', 1, 'large', 1);

  insert into public.orders (restaurant_id, member_id) values (whataburger, jake) returning id into o;
  insert into public.order_items (order_id, item_name, quantity, modifiers, sort_order) values
    (o, 'Honey Butter Chicken Biscuit', 2, null, 0);
end $$;
