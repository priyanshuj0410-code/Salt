import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when both env vars are present, so the UI can show a setup hint otherwise. */
export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Supabase client. Null only if env vars are missing (e.g. before .env.local is
 * set up) so the app renders a configuration message instead of crashing.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string)
  : null;
