'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Copy, Loader2, Trash2 } from 'lucide-react';
import { deleteProject, duplicateProject } from '@/app/actions/projects';
import { Button } from '@/components/ui/button';

export function ProjectCardActions({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-3 flex items-center justify-end gap-1">
      {error && <span role="alert" className="mr-auto text-xs text-destructive">{error}</span>}
      {pending && <Loader2 className="mr-auto size-4 animate-spin text-steel" />}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Dupliquer ${title}`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await duplicateProject(id);
            if (r.ok) router.refresh();
            else setError(r.error);
          })
        }
      >
        <Copy />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Supprimer ${title}`}
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Supprimer définitivement « ${title} » ? Les exports associés seront aussi supprimés.`)) return;
          start(async () => {
            const r = await deleteProject(id);
            if (r.ok) router.refresh();
            else setError(r.error);
          });
        }}
      >
        <Trash2 />
      </Button>
    </div>
  );
}
