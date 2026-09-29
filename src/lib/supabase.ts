import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

const url = env.PUBLIC_SUPABASE_URL;
const key = env.PUBLIC_SUPABASE_ANON_KEY;

/** True when env vars are set. The layout shows a setup message instead of crashing when false. */
export const supabaseConfigured = Boolean(url && key);

export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-anon-key', {
	auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
