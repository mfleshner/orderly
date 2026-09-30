# Usual Order

Everyone logs their usual order at each restaurant. Whoever is picking up food opens one screen, sees everyone's order, and copies it in one tap.

Static SvelteKit SPA + Supabase (Postgres, anonymous auth, RLS). No backend of our own. Deployed to **flerdle.com** on Netlify. See [PLAN.md](PLAN.md) for the product plan and [RUNS.md](RUNS.md) for runs.

## Local setup

Requires Node 22 (`nvm use 22`).

```sh
npm install
cp .env.example .env   # fill in your Supabase URL + anon key
npm run dev
```

## Supabase setup (one time)

1. Create a project at supabase.com (free tier is fine).
2. **Authentication → Sign In / Providers**: enable **Allow anonymous sign-ins**.
3. **SQL Editor**: paste and run `supabase/migrations/0001_init.sql`, then `supabase/migrations/0002_runs.sql`.
4. Open the app once locally so an anonymous user exists, then run `supabase/seed.sql` in the SQL Editor. This creates a test group with invite code `TEST1` (members Matt, Jake, Sam, all reclaimable) and one open run at Torchy's.
5. **Authentication → URL Configuration**: set Site URL to `https://flerdle.com` and add `https://flerdle.com/**` and `http://localhost:5173/**` to Redirect URLs (only needed for the optional "Keep my account" email flow).
6. **Project Settings → API**: copy the Project URL and the anon/publishable key into `.env` and into Netlify.

## Deploy (Netlify, flerdle.com)

`netlify.toml` sets the build command, publish directory (`build`), Node 22, and the SPA fallback so deep links like `/join/7KQ4M` load.

1. In Netlify, open the existing **flerdle** site → **Site configuration → Build & deploy → Link repository** and pick this GitHub repo, branch `main`.
2. **Environment variables**: add `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`.
3. Push to `main`. Every push deploys; branch pushes get deploy previews.
4. Check `https://flerdle.com/join/TEST1` loads.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on http://localhost:5173 |
| `npm run build` | Static site into `build/` |
| `npm run preview` | Serve the production build locally |
| `npm run check` | Type-check Svelte + TS |
| `npm run test:db` | Run migrations, seed, and RLS tests in an in-memory Postgres |
