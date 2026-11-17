import { z } from 'zod';

/**
 * Public (browser-exposed) configuration. Only NEXT_PUBLIC_* values live here.
 * process.env.NEXT_PUBLIC_* must be referenced literally so Next.js can inline them.
 */
const PLACEHOLDER = /replace_me|your-project-ref|YOUR-/i;

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url().refine((v) => !PLACEHOLDER.test(v), 'placeholder value'),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20).refine((v) => !PLACEHOLDER.test(v), 'placeholder value'),
});

export type PublicEnv = z.infer<typeof PublicEnvSchema>;

export type PublicEnvResult = { ok: true; env: PublicEnv } | { ok: false; problems: string[] };

export function readPublicEnv(): PublicEnvResult {
  const parsed = PublicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (parsed.success) return { ok: true, env: parsed.data };
  // report variable names only — never values
  return { ok: false, problems: parsed.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`) };
}
