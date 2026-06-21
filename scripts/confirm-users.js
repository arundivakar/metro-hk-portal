import { createClient } from '@supabase/supabase-js';
import path from 'path';

process.loadEnvFile(path.resolve(process.cwd(), '.env'));

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function run() {
  console.log("Fetching all users...");
  const { data: users, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) {
    console.error("Error listing users:", listErr);
    process.exit(1);
  }

  for (const user of users.users) {
    if (!user.email_confirmed_at) {
      console.log(`Confirming user: ${user.email}`);
      const { error: updateErr } = await supabase.auth.admin.updateUserById(user.id, {
        email_confirm: true
      });
      if (updateErr) {
        console.error(`Error confirming ${user.email}:`, updateErr);
      } else {
        console.log(`Successfully confirmed ${user.email}`);
      }
    } else {
      console.log(`User ${user.email} is already confirmed.`);
    }
  }
}

run();
