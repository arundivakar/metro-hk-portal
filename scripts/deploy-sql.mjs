import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const projectRef = process.env.VITE_SUPABASE_URL.replace('https://', '').split('.')[0];
const serviceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

// Read the SQL
const sql = fs.readFileSync('supabase/migrations/033_fn_get_all_stations_spend.sql', 'utf8');

console.log('Trying to create function via SQL API...');
console.log('Project:', projectRef);

// The Supabase Management API requires a Personal Access Token (pat), not service role key.
// However, Supabase has an unofficial SQL runner endpoint via its dashboard proxy.
// The standard approach that works is to use the `supabase-js` client with service role key
// combined with executing raw SQL via `rpc('pg_query', {query: ...})` if enabled,
// OR by using the Postgres connection string directly.

// Try connection string via pg
try {
  const pg = await import('pg').catch(() => null);
  if (!pg) {
    console.log('pg module not available. Try: npm install pg');
  } else {
    console.log('pg module available! Trying connection...');
    // Supabase connection string pattern
    const connectionString = `postgresql://postgres.${projectRef}:${process.env.SUPABASE_DB_PASSWORD}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`;
    const client = new pg.default.Client({ connectionString });
    await client.connect();
    const result = await client.query(sql);
    console.log('SQL executed successfully!', result);
    await client.end();
  }
} catch (err) {
  console.error('pg approach failed:', err.message);
}

// Show what we need to manually run
console.log('\n=============================');
console.log('MANUAL SQL TO RUN IN SUPABASE SQL EDITOR:');
console.log('=============================');
console.log(sql);
