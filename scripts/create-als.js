import { createClient } from '@supabase/supabase-js';
import path from 'path';

process.loadEnvFile(path.resolve(process.cwd(), '.env'));

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function run() {
  console.log("Creating ALS user...");
  const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
    email: 'als@metro.local',
    password: 'AlsPassword123'
  });

  if (authErr) {
    console.error("Error creating ALS auth user:", authErr);
    process.exit(1);
  }

  await supabase.from('users_profile').insert({
    id: authUser.user.id,
    full_name: 'Agency Level Supervisor',
    role: 'ALS',
    employee_id: 'ALS-001'
  });

  console.log("ALS user created successfully!");
  console.log("Email: als@metro.local");
  console.log("Password: AlsPassword123");
}

run();
