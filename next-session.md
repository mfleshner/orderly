# Next session: pick up here

Last updated 2026-09-29.

## Where things stand

- **Repo:** https://github.com/mfleshner/orderly on `main`. Everything is pushed, and pushes to `main` deploy to flerdle.com.
- **App:** built from PLAN.md, plus runs v1 (pass-the-phone) from RUNS.md. Type-check and build are clean.
- **Database tests:** `npm run test:db` runs both migrations and the seed in an in-memory Postgres. All 38 tests pass.
- **Local env:** `.env` is written. It holds the Supabase URL and the publishable key, and git ignores it.
- **Node:** use Node 22 (`nvm use 22`).

## Supabase (done 2026-09-29)

- The project is named **Orderly**, with ref `hpzrnbmaresmyjjabuwz`, in region us-west-2.
- The URL is `https://hpzrnbmaresmyjjabuwz.supabase.co`.
- Both migrations have run, anonymous sign-ins are on, and the site URL is set.
- A phone-size walkthrough against the live database passed end to end: create a group, join, orders, Copy order, and a run.
- The test group is **Taco Tuesday**, invite code `686SR`, with Matt, Jake and Sam and an open run at Torchy's. The seed file was not used.
- **Delete the access token** you pasted earlier. It isn't needed.

## Netlify (done 2026-09-29)

- The `flerdle` site, on mpaulfrank18's team, is linked to `mfleshner/orderly`, branch `main`. Every push to `main` deploys.
- Both environment variables are set.
- **Live and checked:** `https://flerdle.com/join/686SR` loads and shows the group from the database. The service worker and manifest load, and there are no console errors.

## To do next

1. **Text the invite link to friends.** Fix what they complain about. PLAN.md says to do that before polishing more.
2. **Delete the Supabase access token** from earlier (Supabase → Account → Access Tokens).

## Later

- **Runs v2 from RUNS.md:** "I'm in" from your own phone, and live updates through Supabase Realtime. The migration already adds the runs tables to the realtime feed.
- **Commit email:** commits use your heads-up.com work email. Say so if the repo should use a personal email instead.
