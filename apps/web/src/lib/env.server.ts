import 'server-only';
import { z } from 'zod';

/** Server-only secrets. Importing this module from a Client Component fails the build. */
const PLACEHOLDER = /replace_me|your-project-ref|YOUR-/i;
const secret = z.string().min(20).refine((v) => !PLACEHOLDER.test(v), 'placeholder value');

const ServerEnvSchema = z.object({
  SUPABASE_SECRET_KEY: secret,
  PEXELS_API_KEY: secret.optional(),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export function readServerEnv(): { ok: true; env: ServerEnv } | { ok: false; problems: string[] } {
  const parsed = ServerEnvSchema.safeParse({
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    // optional until Phase 4: an empty or template value means "not configured"
    PEXELS_API_KEY: process.env.PEXELS_API_KEY && !PLACEHOLDER.test(process.env.PEXELS_API_KEY) ? process.env.PEXELS_API_KEY : undefined,
  });
  if (parsed.success) return { ok: true, env: parsed.data };
  return { ok: false, problems: parsed.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`) };
}
