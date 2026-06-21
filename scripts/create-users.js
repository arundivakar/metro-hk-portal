import { createClient } from '@supabase/supabase-js';
import path from 'path';

// Load .env file (Native in Node 22)
process.loadEnvFile(path.resolve(process.cwd(), '.env'));

const supabaseUrl = process.env.VITE_SUPABASE_URL;
// We MUST use the service_role key to bypass auth/encryption restrictions
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ ERROR: Missing VITE_SUPABASE_URL or VITE_SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function run() {
  console.log("🚀 Starting automated user creation via Supabase Admin API...");

  // 1. Fetch all stations
  const { data: stations, error: stationErr } = await supabase
    .from('stations')
    .select('id, code, name')
    .eq('is_active', true);

  if (stationErr) {
    console.error("❌ Failed to fetch stations:", stationErr.message);
    process.exit(1);
  }

  console.log(`Found ${stations.length} active stations. Generating users...\n`);

  for (const st of stations) {
    const scEmail = `sc_${st.code.toLowerCase()}@metro.local`;
    const hksEmail = `hks_${st.code.toLowerCase()}@metro.local`;

    // ==========================================
    // 1. Create Station Controller
    // ==========================================
    console.log(`⏳ Creating SC for ${st.name}...`);
    const { data: scAuth, error: scAuthErr } = await supabase.auth.admin.createUser({
      email: scEmail,
      password: 'Kmrl1234'
    });

    if (scAuthErr) {
      if (scAuthErr.message.includes('already exists')) {
         console.log(`   ➡️ SC already exists. Skipping...`);
      } else {
         console.error(`   ❌ SC Auth Error:`, scAuthErr);
      }
    } else if (scAuth?.user) {
      // Insert Profile
      await supabase.from('users_profile').insert({
        id: scAuth.user.id,
        full_name: `${st.name} Controller`,
        role: 'SC',
        employee_id: `SC-${st.code}`
      });
      // Link Station
      await supabase.from('user_stations').insert({
        user_id: scAuth.user.id,
        station_id: st.id
      });
      console.log(`   ✅ Created SC successfully.`);
    }

    // ==========================================
    // 2. Create HK Supervisor
    // ==========================================
    console.log(`⏳ Creating HKS for ${st.name}...`);
    const { data: hksAuth, error: hksAuthErr } = await supabase.auth.admin.createUser({
      email: hksEmail,
      password: 'Hks1234'
    });

    if (hksAuthErr) {
      if (hksAuthErr.message.includes('already exists')) {
         console.log(`   ➡️ HKS already exists. Skipping...`);
      } else {
         console.error(`   ❌ HKS Auth Error:`, hksAuthErr);
      }
    } else if (hksAuth?.user) {
      // Insert Profile
      await supabase.from('users_profile').insert({
        id: hksAuth.user.id,
        full_name: `${st.name} HK Supervisor`,
        role: 'HKS',
        employee_id: `HK-${st.code}`
      });
      // Link Station
      await supabase.from('user_stations').insert({
        user_id: hksAuth.user.id,
        station_id: st.id
      });
      console.log(`   ✅ Created HKS successfully.`);
    }
  }

  console.log("\n🎉 All 50 users have been successfully generated via the secure Admin API!");
}

run();
