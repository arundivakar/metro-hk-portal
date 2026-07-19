import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables.\n' +
    'Please copy .env.example to .env and fill in your Supabase project URL and anon key.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

/**
 * Utility to fetch all rows for a query, bypassing the 1000-row Supabase API limit.
 * @param {object} queryBuilder - The Supabase query builder object (e.g. supabase.from('...').select('...').gte('...'))
 * @returns {Promise<{data: any[], error: any}>}
 */
export async function fetchAll(queryBuilder) {
  let allData = [];
  let step = 1000;
  let hasMore = true;
  for (let i = 0; i < 20 && hasMore; i++) {
    const { data, error } = await queryBuilder.range(i * step, (i + 1) * step - 1);
    if (error) return { data: null, error };
    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allData = allData.concat(data);
      if (data.length < step) hasMore = false;
    }
  }
  return { data: allData, error: null };
}
