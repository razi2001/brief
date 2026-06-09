import { createClient } from "@supabase/supabase-js";

// Ensures the private "briefs" Storage bucket exists. Idempotent: if the bucket
// already exists, logs and continues. Run with env loaded:
//   node --env-file=.env.local scripts/ensure-bucket.mjs
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const { error } = await admin.storage.createBucket("briefs", { public: false });
if (error) {
  // Supabase returns an error when the bucket already exists; don't fail on that.
  console.log(`createBucket("briefs"): ${error.message} (continuing)`);
} else {
  console.log('createBucket("briefs"): created (private)');
}

const { data: buckets, error: listError } = await admin.storage.listBuckets();
if (listError) {
  console.error("listBuckets failed:", listError.message);
  process.exit(1);
}
console.log(
  "buckets:",
  buckets.map((b) => ({ name: b.name, public: b.public }))
);
const has = buckets.some((b) => b.name === "briefs");
console.log(has ? "OK: 'briefs' bucket exists" : "ERROR: 'briefs' bucket missing");
if (!has) process.exit(1);
