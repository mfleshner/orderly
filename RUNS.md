# Runs — feature spec (addendum to PLAN.md)

This is a follow-on to PLAN.md. It adds one concept, **runs**, and confirms the host. Read PLAN.md first; nothing there is superseded except the hosting details below.

## Hosting (confirmed)

The site is on **Netlify** as `flerdle.netlify.app`, with `flerdle.com` as the custom domain.

- Add a `static/_redirects` file (SvelteKit) or `public/_redirects` (Next) containing exactly:
  ```
  /*  /index.html  200
  ```
  This makes deep links like `/join/7KQ4M` and `/g/{id}/run/{id}` load the app.
- Connect the GitHub repo in Netlify: Site configuration → Build & deploy → link repository. Build command `npm run build`, publish directory `build` (SvelteKit) or `out` (Next).
- Set `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` under Site configuration → Environment variables.
- Netlify makes a preview URL for every branch push automatically.
- Replace the existing site content; the old `flerdle.com` game is retired.

## Why runs exist

A group can be large (a hospital unit with 40 nurses) but only a handful are eating on any given day, and it's a different handful each time. Nobody will maintain a schedule. A **run** is one trip to one restaurant with a specific set of people, so "Copy order" reads from the run instead of the whole group.

For a small friend group, a run is the same feature with everyone included by default — no separate mode.

## Data model additions

```
runs               id, group_id, restaurant_id, started_by (member_id), note (text), status ('open' | 'closed'), created_at, closed_at
run_participants   id, run_id, member_id, override_text (text, nullable), created_at
                   unique (run_id, member_id)
```

- `override_text` is a one-off order for this run only ("no queso today, add a taco"). Null means "my usual."
- RLS: same rule as everything else — readable and writable by members of the group.
- Runs don't change `orders` or `order_items`. They point at existing usuals.

## Version 1: pass-the-phone

This mirrors what the target group already does: one person starts a run and hands their phone around. Nobody else needs the app.

Flow:
1. On a restaurant screen, tap **Start a run**. Optional note ("leaving 11:30"). A run is created with `status = 'open'`, and the person starting it is added as a participant.
2. The run screen shows two sections: **In** (participants, with their usual or override) and **Everyone else** (remaining group members as a tappable list, most-recently-included first).
3. Pass the phone. Each person taps their name in **Everyone else**. That opens a confirm sheet showing their usual for this restaurant with two buttons: **That's it** (adds them as a participant, override null) and **Something different** (text field → adds them with `override_text`). If they have no usual yet, the sheet is the order editor; saving creates their usual and adds them.
4. After **Something different**, ask once: "Make this your usual?" Yes updates their `orders`/`order_items`; no leaves the usual alone.
5. Tapping a name in **In** lets you remove them or edit the override.
6. **Copy order** at the bottom reads participants only. Same text format as PLAN.md; overrides replace the usual line for that person.
7. **Close run** sets `status = 'closed'`. Closed runs are read-only but still copyable.

Speed target: for a returning person, tap name → tap **That's it** → done, under five seconds. No login, no navigation.

Remember the last run's participant list per restaurant so that **Everyone else** is sorted with recent participants at the top.

## Version 2: opt-in (build after v1 is in use)

Same run, but people can join from their own phones.

1. Starting a run also posts it as a banner at the top of the group home ("Sarah is going to Torchy's — leaving 11:30 — 4 in") and gives it a shareable link `/g/{group}/run/{id}`.
2. Anyone in the group opens it and taps **I'm in**. Same confirm sheet as v1 (usual vs. something different), but for themselves. Tapping again lets them change or leave.
3. The runner's screen updates live. Use Supabase Realtime (`supabase.channel(...).on('postgres_changes', { table: 'run_participants', filter: 'run_id=eq.{id}' }, ...)`) from the browser; fall back to polling every 5 seconds if Realtime isn't set up. No server code of our own is needed.
4. Pass-the-phone still works on the same run — the runner can add people directly, and opt-ins land in the same list.
5. Closing the run hides the banner and disables **I'm in**.

Out of scope: notifications to people who don't have the app open, timers that auto-close, payment splitting.

## Screens added

- `/g/{id}/r/{id}/run/new` — start a run (note field, Start button). Can be a sheet on the restaurant screen instead of a route.
- `/g/{id}/run/{id}` — the run screen described above. Same URL for runner and participants; what you can tap depends on whether you're the starter.
- Group home gets a banner for any open run in the group (v2), and a **Recent runs** list under the restaurants (nice to have).

## Build order

1. Tables and RLS for `runs` and `run_participants`, plus seed data with one open run
2. Start a run from the restaurant screen
3. Run screen: In / Everyone else lists, confirm sheet, copy order, close
4. "Make this your usual?" prompt after an override
5. Ship v1 and use it
6. Open-run banner on group home and the shareable run link
7. **I'm in** for self-join, Realtime subscription on the run screen
8. Recent runs list

## Open decisions

- Should a group be able to have more than one open run at once? Yes — different restaurants, different times. Show all open runs in the banner area.
- Auto-close stale runs? Not in v1; a run stays open until closed. Maybe hide open runs older than 12 hours from the banner later.
