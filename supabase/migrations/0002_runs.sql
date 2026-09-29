-- Runs: one trip to one restaurant with a specific set of people (see RUNS.md).
-- Runs never change orders/order_items; they point at existing usuals.

create table public.runs (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  started_by    uuid references public.members(id) on delete set null,
  note          text check (char_length(note) <= 120),
  status        text not null default 'open' check (status in ('open', 'closed')),
  created_at    timestamptz not null default now(),
  closed_at     timestamptz
);
create index runs_group_status_idx on public.runs(group_id, status);
create index runs_restaurant_idx on public.runs(restaurant_id, created_at desc);

create table public.run_participants (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.runs(id) on delete cascade,
  member_id     uuid not null references public.members(id) on delete cascade,
  override_text text check (char_length(override_text) <= 300),  -- null = "my usual"
  created_at    timestamptz not null default now(),
  unique (run_id, member_id)
);
create index run_participants_run_idx on public.run_participants(run_id);
create index run_participants_member_idx on public.run_participants(member_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Caller is a group member of the run's group.
create or replace function public.is_run_member(rid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.runs r
    join public.members m on m.group_id = r.group_id
    where r.id = rid and m.user_id = auth.uid() and m.removed_at is null
  );
$$;

-- Run is open and the participant member belongs to the run's group (writes only).
create or replace function public.can_write_participant(rid uuid, mid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.runs r
    join public.members caller on caller.group_id = r.group_id
    join public.members target on target.group_id = r.group_id
    where r.id = rid and r.status = 'open'
      and caller.user_id = auth.uid() and caller.removed_at is null
      and target.id = mid
  );
$$;

grant execute on function public.is_run_member(uuid) to authenticated;
grant execute on function public.can_write_participant(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Start a run at a restaurant. The caller's member is the starter and first participant.
create or replace function public.start_run(rid uuid, run_note text default null)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  gid uuid;
  me uuid;
  new_id uuid;
begin
  select group_id into gid from public.restaurants where id = rid;
  if gid is null then raise exception 'not_allowed'; end if;
  select id into me from public.members
  where group_id = gid and user_id = auth.uid() and removed_at is null;
  if me is null then raise exception 'not_allowed'; end if;

  insert into public.runs (group_id, restaurant_id, started_by, note)
  values (gid, rid, me, nullif(trim(coalesce(run_note, '')), ''))
  returning id into new_id;

  insert into public.run_participants (run_id, member_id) values (new_id, me);
  return new_id;
end;
$$;

grant execute on function public.start_run(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.runs, public.run_participants to authenticated;

alter table public.runs             enable row level security;
alter table public.run_participants enable row level security;

create policy runs_select on public.runs for select to authenticated
  using (public.is_group_member(group_id));
-- Only open runs can be edited (note / close). Closed runs are read-only.
create policy runs_update on public.runs for update to authenticated
  using (public.is_group_member(group_id) and status = 'open')
  with check (public.is_group_member(group_id));

create policy run_participants_select on public.run_participants for select to authenticated
  using (public.is_run_member(run_id));
create policy run_participants_insert on public.run_participants for insert to authenticated
  with check (public.can_write_participant(run_id, member_id));
create policy run_participants_update on public.run_participants for update to authenticated
  using (public.can_write_participant(run_id, member_id))
  with check (public.can_write_participant(run_id, member_id));
create policy run_participants_delete on public.run_participants for delete to authenticated
  using (public.can_write_participant(run_id, member_id));

-- Realtime (RUNS.md v2): broadcast participant changes. Harmless if unused.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.run_participants, public.runs;
  end if;
end $$;
