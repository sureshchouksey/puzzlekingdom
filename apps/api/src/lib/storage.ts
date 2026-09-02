import { createClient } from "@supabase/supabase-js";
import { env } from "../env.js";

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

export async function uploadDocument(params: { buffer: Buffer; path: string; mimeType: string }) {
  const { error } = await supabase.storage
    .from(env.SUPABASE_STORAGE_BUCKET)
    .upload(params.path, params.buffer, { contentType: params.mimeType, upsert: false });
  if (error) throw error;
  return params.path;
}

export async function downloadDocument(path: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).download(path);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}
