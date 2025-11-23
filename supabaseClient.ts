import { createClient } from '@supabase/supabase-js';

// Safely access environment variables with fallback to prevent crashes if env is undefined
// This handles cases where Vite hasn't fully injected env vars yet or they are missing
const env = (import.meta as any).env || {};

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;

export const supabase = (supabaseUrl && supabaseAnonKey) 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : null;