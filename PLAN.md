# Usual Order — project plan (web version)

A fun project for a friend group: everyone logs their usual order at each restaurant, so whoever is picking up food opens one screen, sees everyone's order, and copies it in one tap.

Not a business. Optimize for: friends actually using it, zero-friction onboarding, and being fun to build.

## The one feature that matters

Open link → tap restaurant → see every member's usual → "Copy order" produces one text block ready to paste into a delivery app or read at the counter.

Everything else supports that path.

## Why web, not native

Friends won't install from an app store. A link works on every phone, needs no developer account or review, and can be added to the home screen as a PWA. Ship a web app; revisit native only if there's a reason later.

## Stack

- SvelteKit with `@sveltejs/adapter-static` (or Next.js with `output: 'export'`) in TypeScript — the app must build to a plain folder of static files, no server runtime
- Supabase — Postgres, anonymous auth, row-level security. All data access happens from the browser via the Supabase JS client; there is no backend of our own
- Tailwind for styling; mobile-first, one accent color, hairline dividers, no component library needed
- PWA manifest + service worker (basic, cache shell only) so it installs to the home screen

## Hosting

The app is deployed to the owner's existing domain, **flerdle.com**.

**Host: Netlify** (confirmed 2026-09-29). Netlify site name is `flerdle` (`flerdle.netlify.app`). DNS is managed at Squarespace (Google Domains successor): apex `A @ 75.2.60.5` (Netlify load balancer) and `CNAME www flerdle.netlify.app`. Both records are already correct; no DNS changes are needed. Responses carry `Server: Netlify` headers.

Requirements for the build:
- Static output only — `npm run build` produces a folder (`build/` or `out/`) that the host serves as-is

Deployment is Git-connected, not manual upload. On the host, connect the GitHub repo to the existing flerdle.com site with build command `npm run build` and output directory `build` (SvelteKit) or `out` (Next). Every push to `main` deploys to flerdle.com; branch pushes get preview URLs where the host supports them. If the host turns out to be GitHub Pages, deployment is a GitHub Actions workflow in the repo instead of a host-side setting — still automatic on push.
- SPA fallback so deep links like `/join/7KQ4M` serve `index.html`. Do this the host's way:
  - Netlify: `_redirects` file with `/* /index.html 200`
  - Cloudflare Pages: same `_redirects` file works
  - Vercel: `vercel.json` with a rewrite of `/(.*)` to `/index.html`
  - GitHub Pages: copy `index.html` to `404.html` at build time
  - Firebase Hosting: `rewrites` in `firebase.json`
- Supabase URL and anon key are public build-time constants (`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`). Set them as environment variables on the host's build settings; they are safe to ship in the bundle since RLS is the security boundary.
- Add `https://flerdle.com` to the Supabase project's allowed redirect URLs and site URL (needed if the email-upgrade flow is ever used)
- The existing flerdle.com content is replaced entirely. If the old game should stay reachable, build it into a `/old` subfolder instead.

Supabase free tier is sufficient. Note that free projects pause after a week of inactivity and take a few seconds to wake.

## Login

Anonymous accounts. No signup screen, no email, no password.

Flow:
1. Person opens `/join/{code}` from a text message
2. App calls `supabase.auth.signInAnonymously()` if there's no session yet
3. App asks for a display name
4. If that name already exists in the group, show "Is this you? Reclaim this name" — on yes, reassign that member row to the new user_id; on no, create a new member
5. Redirect to the group home

The account lives on that device. Provide a "Keep my account" option in settings that upgrades the anonymous user by adding an email (Supabase `updateUser({ email })`), so anyone who cares can log in from another device. Nobody is required to.

Group creator goes through the same anonymous flow, then creates a group and gets the invite link.

## v1 scope

In:
- Create a group; get a short invite code and shareable link
- Join a group by link; pick or reclaim a name
- Restaurants per group: free-text name + optional note (location, "the one on Eldorado")
- One usual order per member per restaurant: list of items with quantity and free-text modifiers
- Optional "trying" note per member per restaurant (single text field), with "Make this my usual" which replaces the usual
- Restaurant screen showing every member's usual, plus "Copy order"
- Members list: names, colors, remove a member, show the invite link

Out (for now):
- Email/password or social login
- Restaurant data from Google Places or any API
- Any ordering integration
- Notifications
- Native apps

## Data model

```
groups          id, name, invite_code (unique, 5 chars, no ambiguous letters), created_by, created_at
members         id, group_id, user_id (nullable), display_name, color, created_at
                unique (group_id, display_name)
restaurants     id, group_id, name, note, created_at
orders          id, restaurant_id, member_id, trying_note (text, nullable), updated_at
                unique (restaurant_id, member_id)
order_items     id, order_id, item_name, quantity (int, default 1), modifiers (text), sort_order
```

Notes:
- One order row per member per restaurant holds both the usual (order_items) and the trying note. No "kind" column — simpler.
- RLS: a user can read and write rows in a group where a members row has their user_id. Members with null user_id (removed or unclaimed) are editable by any group member.
- invite_code alphabet: `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (drop I, L, O, 0, 1).

## Screens (all mobile-first)

1. `/` — if in groups: list them; else: "Create a group" or "Have a link? Open it"
2. `/join/{code}` — name entry → group home
3. `/g/{id}` — restaurant list with search, "Add restaurant" inline at top
4. `/g/{id}/r/{id}` — the core screen. Each member row: color dot, name, usual summary, edit icon; trying note under it in a muted/warning color. Sticky bottom bar: "Copy order". Members with no order show "No usual yet — add one"
5. `/g/{id}/r/{id}/edit` — edit my order: item rows (name, qty, modifiers), add/remove/reorder, trying note field, save
6. `/g/{id}/members` — member list, invite link with copy button, remove member, "Keep my account" upgrade

## Copy format

```
Torchy's Tacos
Matt: Trailer Park (trashy), Green chile queso
Jake: 2x Fried Avocado (no pico), Unsweet tea
Sam: Kids quesadilla, Chips (no salsa)
```

One line per member with a usual, items comma-separated, modifiers in parentheses, quantity prefixed only when >1. Members without a usual are omitted.

## Build order

1. Supabase project: schema, RLS, seed script (one group, two restaurants, three members with orders)
2. App skeleton, Supabase client, anonymous sign-in on first load
3. Create group → invite link; join by link with name entry and reclaim
4. Restaurant list per group
5. Restaurant screen, read-only, with Copy order
6. Edit my order screen
7. Members screen with invite link and remove
8. PWA manifest, icon, home-screen install
9. Confirm the flerdle.com host, connect the GitHub repo to the site with the build command and output directory, set the Supabase env vars, add the SPA fallback config, push to `main`, verify a deep link like `/join/TEST1` loads
10. Text the link to friends

Send the link to friends after step 6. Fix what they complain about before doing 7–9 properly.

## Fun additions after v1 is in use

- "Surprise me" — random restaurant where everyone in the group has a usual
- "Who's picking up?" — one-tap claim so the group knows
- "Last ordered" timestamp per restaurant and a group log
- Trying leaderboard — who tries new things most
- Per-restaurant notes from anyone ("queso is huge, split it")
- Restaurant emoji or color picked by whoever adds it
- Dark mode

## Open decisions

- SvelteKit vs Next.js — builder's choice
- Whether "trying" should also allow items or stay a single text field (stay text for v1)
- Whether removed members keep their orders visible (hide them; keep the rows)
