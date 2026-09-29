import type { User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from './supabase';

/** Reactive auth state. `ready` flips true once we have an (anonymous) user or an error. */
export const auth = $state<{ user: User | null; ready: boolean; error: string | null }>({
	user: null,
	ready: false,
	error: null
});

let started: Promise<User | null> | null = null;

/**
 * Ensure there is a session. Signs in anonymously on first visit.
 * Safe to call from anywhere; only runs once.
 */
export function ensureSession(): Promise<User | null> {
	if (started) return started;
	started = (async () => {
		if (!supabaseConfigured) {
			auth.error =
				'Supabase is not configured. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY.';
			auth.ready = true;
			return null;
		}
		try {
			const { data } = await supabase.auth.getSession();
			let user = data.session?.user ?? null;
			if (!user) {
				const res = await supabase.auth.signInAnonymously();
				if (res.error) throw res.error;
				user = res.data.user;
			}
			auth.user = user;
			supabase.auth.onAuthStateChange((_evt, session) => {
				auth.user = session?.user ?? null;
			});
			return user;
		} catch (e) {
			auth.error = e instanceof Error ? e.message : String(e);
			return null;
		} finally {
			auth.ready = true;
		}
	})();
	return started;
}

/** "Keep my account": attach an email to the anonymous user so they can sign in elsewhere. */
export async function upgradeWithEmail(email: string) {
	const { error } = await supabase.auth.updateUser(
		{ email },
		{ emailRedirectTo: window.location.origin }
	);
	if (error) throw error;
}

/** Sign in on a new device with a magic link (for users who added an email). */
export async function sendMagicLink(email: string) {
	const { error } = await supabase.auth.signInWithOtp({
		email,
		options: { shouldCreateUser: false, emailRedirectTo: window.location.origin }
	});
	if (error) throw error;
}
