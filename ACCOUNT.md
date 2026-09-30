# Account — feature spec (addendum to PLAN.md)

Not built yet. Written 2026-09-29 after a real case: a member joined a new group from a different browser than the one she used for the first group, and her usuals didn't carry over.

## The problem

Accounts are anonymous and live in one browser's storage. Brave, Safari and the home-screen app on the same phone are three separate accounts. Usuals and groups only follow you if you're on the same account.

Today the fix exists but is hidden: **Keep my account** on the Members screen attaches an email, and **Sign in with email** on that same screen restores it elsewhere. A new device has no groups, so it can never reach a Members screen, and nobody finds it.

## What to build

### 1. Account icon on the home screen

- A person icon at the top right of `/`, shown from the very first visit (empty state and the groups list alike).
- It opens `/account`.
- The Members screen keeps its "Keep my account" section but shortens it to a one-line link to `/account`.

### 2. The `/account` screen

Three states, decided from the current auth user:

| State | What it shows |
| --- | --- |
| Anonymous, no email | **Sign in with email** (primary): "Already use Usual Order on another phone? Enter the same email." Below it, **Save my account** (secondary): "Add an email so your groups and usuals follow you to a new phone or browser." |
| Email pending confirmation (`new_email` set) | "Waiting for you to confirm {email}. Check your inbox." with a resend button. |
| Email confirmed | "Saved as {email}. Sign in with this email on any device." |

Both actions take one email field. Copy is plain and short. Big buttons, phone-first.

### 3. Proof step: 6-digit code, not a link

An email alone can't prove identity, so the inbox gets a one-time proof. Use a **code typed into the app**, not a link:

- A link opens in the phone's default browser, which may not be the one the person is using. That's the same browser mix-up that caused this.
- A code keeps the person in the browser they started in.

Flow: enter email → "We emailed you a code" → 6-digit input (`inputmode="numeric"`, `autocomplete="one-time-code"`) → signed in. Same code step for saving an email the first time.

Supabase side:
- Sign in: `signInWithOtp({ email, options: { shouldCreateUser: false } })`, then `verifyOtp({ email, token, type: 'email' })`.
- Save email on an anonymous user: `updateUser({ email })`, then `verifyOtp({ email, token, type: 'email_change' })`.
- If sign-in says no user exists for that email, show: "No account uses that email yet. On the phone you already use, open Account and save your email first."

Until the template change below is made, ship with the existing email link (`emailRedirectTo` to the site origin). Switch to the code once the template includes it.

### 4. Guard against losing a throwaway account

Signing in replaces the anonymous account in this browser. If this browser already belongs to groups, warn before sending the code: "This browser has {n} group(s) under a separate account. Signing in switches to your saved account; those groups stay behind unless you save this account instead."

### 5. After sign-in

Land on `/`. The groups list loads for the signed-in user. Nothing else is needed: groups, usuals and runs already key off `auth.uid()`.

## Owner setup (dashboard, one time)

1. **Authentication → Email Templates → Magic Link**: add the code to the body, e.g. `Your Usual Order code is {{ .Token }}`. Do the same in **Change Email Address** if the save-email flow should also use a code.
2. **Email sending limits.** Supabase's built-in sender allows only a few emails per hour per project. Fine for testing. Before a bigger group relies on it, connect a free provider such as Resend under **Project Settings → Auth → SMTP**. Needs one DNS record on flerdle.com.
3. The Site URL and redirect URLs for flerdle.com and localhost are already set.

## Out of scope

- Passwords.
- Google or Apple sign-in. Google is free but needs a Google Cloud project; Apple needs a paid developer account. Email covers the need at this scale.
- Merging two anonymous accounts into one. Reclaim on the join screen already covers the single-group case.

## Build order

1. `/account` screen with the three states, using the existing email link.
2. Icon on the home screen; shorten the Members section to a link.
3. Warning when the browser already has groups.
4. Owner adds the template line; switch both flows to the 6-digit code.
5. Later: custom SMTP.
