'use client';

import { useState, type FormEvent } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const sb = createSupabaseBrowserClient();
    if (!sb) {
      setState('error');
      setMessage('Supabase n’est pas configuré sur ce serveur.');
      return;
    }
    setState('sending');
    const redirect = new URL('/auth/callback', window.location.origin);
    redirect.searchParams.set('next', next);
    const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirect.toString(), shouldCreateUser: true } });
    if (error) {
      setState('error');
      setMessage(error.status === 429 ? 'Trop de demandes — réessayez dans quelques minutes.' : error.message);
    } else {
      setState('sent');
    }
  }

  if (state === 'sent') {
    return (
      <div role="status" className="mt-6 rounded-xl border border-aurora-mint/40 bg-aurora-mint/10 p-4 text-sm">
        Lien envoyé à <strong>{email}</strong>. Ouvrez-le sur cet appareil pour vous connecter.
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">Adresse e-mail</Label>
        <Input id="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 rounded-full px-4" aria-invalid={state === 'error'} />
      </div>
      {state === 'error' && <p role="alert" className="text-sm text-destructive">{message}</p>}
      <Button type="submit" size="lg" className="w-full gap-2" disabled={state === 'sending' || !/^\S+@\S+\.\S+$/.test(email)}>
        {state === 'sending' ? <Loader2 className="animate-spin" /> : <Mail />} Recevoir le lien de connexion
      </Button>
    </form>
  );
}
