'use client';

import type { BoxStyle, Branding, RenderDocument, TitleStyle, VerseDecoration } from '@instantreels/core';

/**
 * Editor state = the RenderDocument itself (single source of truth for preview and export).
 * Actions only touch presentation settings; Quranic words/translations are never editable here.
 */
export type EditorAction =
  | { type: 'boxStyle'; patch: Partial<BoxStyle> }
  | { type: 'title'; patch: Partial<TitleStyle> }
  | { type: 'branding'; patch: Partial<Omit<Branding, 'qr'>> }
  | { type: 'qr'; patch: Partial<NonNullable<Branding['qr']>> }
  | { type: 'arabicMarker'; patch: Partial<VerseDecoration['arabicMarker']> }
  | { type: 'frenchNumber'; patch: Partial<VerseDecoration['frenchNumber']> }
  | { type: 'bismillah'; patch: Partial<RenderDocument['bismillah']> }
  | { type: 'technicalLabels'; value: boolean };

export function editorReducer(doc: RenderDocument, a: EditorAction): RenderDocument {
  switch (a.type) {
    case 'boxStyle':
      return { ...doc, boxStyle: { ...doc.boxStyle, ...a.patch } };
    case 'title':
      return { ...doc, title: { ...doc.title, ...a.patch } };
    case 'branding':
      return { ...doc, branding: { ...doc.branding, ...a.patch } };
    case 'qr':
      return doc.branding.qr ? { ...doc, branding: { ...doc.branding, qr: { ...doc.branding.qr, ...a.patch } } } : doc;
    case 'arabicMarker':
      return { ...doc, verseDecoration: { ...doc.verseDecoration, arabicMarker: { ...doc.verseDecoration.arabicMarker, ...a.patch } } };
    case 'frenchNumber':
      return { ...doc, verseDecoration: { ...doc.verseDecoration, frenchNumber: { ...doc.verseDecoration.frenchNumber, ...a.patch } } };
    case 'bismillah':
      return { ...doc, bismillah: { ...doc.bismillah, ...a.patch } };
    case 'technicalLabels':
      return { ...doc, showTechnicalLabels: a.value };
  }
}

export const SURAH_LATIN_NAMES: Record<number, string> = { 1: 'Al-Fâtiha', 9: 'At-Tawba' };
