// scripts/get-token.js
// Usage: node scripts/get-token.js <email> <password>
// Fetches the custom backend ADMIN_TOKEN via Supabase Auth exchange.

const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const fs = require("fs");

// Load env variables
try {
  const envLocalPath = path.join(__dirname, "..", ".env.local");
  if (fs.existsSync(envLocalPath)) {
    const envLines = fs.readFileSync(envLocalPath, "utf-8").split(/\r?\n/);
    for (const line of envLines) {
      const match = line.match(/^\s*([^#=]+)\s*=\s*(.*)\s*$/);
      if (match) {
        const key = match[1].trim();
        let val = match[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (e) {
  console.log("⚠️ Could not auto-load .env.local:", e.message);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://54.253.245.248:7860";

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error("Usage: node scripts/get-token.js <email> <password>");
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Error: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in .env.local");
  process.exit(1);
}

async function run() {
  console.log(`▶ Connecting to Supabase at ${SUPABASE_URL}...`);
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
  });

  console.log(`▶ Logging in as ${email}...`);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Supabase Auth failed: ${error.message}`);
  }

  const idToken = data.session?.access_token;
  if (!idToken) {
    throw new Error("Failed to retrieve Supabase session access token.");
  }

  console.log(`▶ Exchanging session token with backend at ${API_URL}...`);
  let res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_token: idToken }),
  });

  if (res.status === 404) {
    console.log("▶ Account not found on backend. Automatically registering account on backend...");
    const username = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "_");
    res = await fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id_token: idToken,
        username: username,
        display_name: username,
      }),
    });
  }

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Backend token exchange failed (${res.status}): ${errorText}`);
  }

  const { access_token } = await res.json();
  if (!access_token) {
    throw new Error("Backend did not return an access token.");
  }

  console.log("\n🔑 SUCCESS! Your backend ADMIN_TOKEN is:\n");
  console.log(access_token);

  // Automatically update ADMIN_TOKEN in .env.local
  try {
    const envLocalPath = path.join(__dirname, "..", ".env.local");
    if (fs.existsSync(envLocalPath)) {
      let content = fs.readFileSync(envLocalPath, "utf-8");
      if (content.includes("ADMIN_TOKEN=")) {
        content = content.replace(/ADMIN_TOKEN=.*(\r?\n|$)/, `ADMIN_TOKEN=${access_token}\n`);
      } else {
        content += `\nADMIN_TOKEN=${access_token}\n`;
      }
      fs.writeFileSync(envLocalPath, content, "utf-8");
      console.log("\n✅ Automatically updated ADMIN_TOKEN in .env.local!");
    }
  } catch (e) {
    console.log("⚠️ Could not update .env.local automatically:", e.message);
  }
}

run().catch(err => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
