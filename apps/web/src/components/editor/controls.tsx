'use client';

import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

/** Small, touch-friendly property controls (min 44 px hit targets on touch devices). */

export function Section({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-b border-hairline px-4 py-5 last:border-b-0">
      <header>
        {eyebrow && <p className="eyebrow text-ultraviolet">{eyebrow}</p>}
        <h3 className="text-base text-lunar-white">{title}</h3>
      </header>
      {children}
    </section>
  );
}

export function SliderField({ id, label, value, min, max, step = 1, unit = 'px', onChange }: { id: string; label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-sm text-steel">{label}</Label>
        <span className="font-mono text-xs text-lunar-white tabular-nums">{Number.isInteger(step) ? value : value.toFixed(2)}{unit}</span>
      </div>
      <Slider id={id} value={[value]} min={min} max={max} step={step} onValueChange={(v) => v[0] !== undefined && onChange(v[0])} className="py-2" aria-label={label} />
    </div>
  );
}

export function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const hex = value.slice(0, 7);
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <Label htmlFor={id} className="text-sm text-steel">{label}</Label>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs uppercase text-steel">{hex}</span>
        <input
          id={id}
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value + value.slice(7))}
          className="size-9 cursor-pointer rounded-full border border-hairline bg-transparent p-0.5 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch-wrapper]:p-0"
        />
      </div>
    </div>
  );
}

export function SwitchField({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <div>
        <Label htmlFor={id} className="text-sm text-lunar-white">{label}</Label>
        {hint && <p className="text-xs text-steel">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
