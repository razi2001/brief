import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { generateExtensionToken, hashToken } from "@/lib/tokens";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const token = generateExtensionToken();
  const admin = createAdminSupabase();
  const { error } = await admin.from("extension_tokens").insert({
    user_id: userId,
    token_hash: hashToken(token),
    label: "chrome-extension",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ token }); // returned once, plaintext never stored
}
