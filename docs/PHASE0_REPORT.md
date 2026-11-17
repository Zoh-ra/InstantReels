# Rapport d'ingénierie — Phase 0 (16/11/2026)

## 1. Dépôt
Branche active `feature/projetInitial` (à jour avec origin), un seul commit, seul fichier `README.md`. Aucun code existant à préserver. `main` non touchée. Node 20.11.1 (compatible Next 16, Node 22 LTS recommandé), npm 10.2.4, FFmpeg absent localement (Remotion fournit ses propres binaires).

## 2. Classeur Excel — très propre, mais à valider
- 77 429 mots, 6 236 versets, 114 sourates : comptes identiques au Hafs standard. 0 doublon, 0 trou, 0 référence malformée.
- Plage déclarée `A1:AMD1048576` (mise en forme parasite) → import en streaming limité à A–E.
- Texte arabe en **encodage QPC Hafs** (Complexe Roi Fahd) — 263/286 versets de la sourate 2 identiques octet par octet à Quran.com.
- **Ne jamais normaliser** : 23 870 cellules changeraient sous NFC.
- `۞` attaché au 1er mot de 199 versets, `۩` au dernier mot de 15 versets.
- **Écarts à revoir humainement** (sourate 2 seulement) : 2:91, 2:128 (shadda manquante), 2:144 (kasra au lieu de fatha), 2:181 (segmentation). Français : 59:15:9 (parenthèse non fermée), 76:18:4 (`cou(e`). Vérification complète des 114 sourates prévue en Phase 2.

## 3. QR code France
Lisible : `https://qr.codes/FGWXbJ`, correction d'erreur H, ~29×29 modules, logo central, lisible même réduit à 160 px. **Risque** : c'est un lien de redirection dynamique d'un service tiers. Zone de silence ~2 modules → on ajoutera une marge blanche.

## 4. Pipeline 4K
Faisable avec Remotion 4.0.544 + worker Node dédié (Docker), H.264 High @ L5.1, yuv420p, AAC, remux faststart, validation FFprobe + détection d'images noires + décodage QR sur images extraites. Durée de rendu 4K à mesurer (ordre de grandeur : minutes). Fallback 1080p systématique.

## 5. Traductions (IDs vérifiés sur l'API)
Hamidullah = 31, Hilali & Khan = 203, Knut Bernström = 48. Les conditions Quran Foundation autorisent l'usage dans des vidéos sociales avec crédit, interdisent le cache > 7 jours hors Content Sync, mais **ne couvrent pas les droits d'auteur des traducteurs/éditeurs** → autorisation écrite à demander.

## 6. Mise à jour du 16/11/2026 après clarifications

- **Police (D-04)** : comparaison de rendu réelle (Chrome/HarfBuzz) de 5 polices sur 15 mots difficiles → **KFGQPC HAFS v0.18** seule correcte avec l'encodage du classeur (tanwin ouvert, hamza sur tatweel, petits signes). Scheherazade New, Amiri Quran et Traditional Arabic affichent des signes faux. Voir `TYPOGRAPHY.md` et `assets/font-comparison/`.
- **Mot à mot (D-07)** : le classeur du Dr Nonnenmacher est l'unique source ; les sources externes servent uniquement à signaler des écarts.
- **۞ / ۩ (D-08)** : conservés, rendus par la police KFGQPC.
- **QR (D-09)** : QR France conservé, modèle prévu pour un QR généré depuis une URL permanente.
- **Remotion (D-01)** : licence gratuite (développeur individuel) ; conditions en cas de transfert documentées.
- **Tanzil (D-02/D-03)** : les trois traductions existent (`fr.hamidullah`, `en.hilali`, `sv.bernstrom`), stockables, mais **usage non commercial uniquement** sans permission des éditeurs.
- **Moteur de rendu (D-06)** : comparaison Remotion / Revideo / pipeline open source → recommandation d'un pipeline open source Playwright + FFmpeg, à valider par un prototype.

## 7. Décisions à approuver (version initiale)
Voir `DECISIONS.md` : D-01 licence Remotion, D-02 droits des traductions, D-04 police coranique (bloquant), D-07 écarts du classeur, D-08 affichage ۞/۩, D-09 QR dynamique.

## 8. Points bloquants restants (avant / pendant la phase 1)

| # | Point | Bloque | Qui |
|---|---|---|---|
| B-01 | Choisir le moteur de rendu (D-06) : pipeline open source recommandé ou Remotion | le prototype de rendu en début de phase 1 | vous |
| B-02 | Créer un projet Supabase (ou accepter un développement 100 % local via Docker, déjà installé — Docker 27.3) et renseigner `.env.local` vous-même | branchement Supabase en phase 1 | vous |
| B-03 | Autoriser l'installation de FFmpeg sur votre poste (`winget install Gyan.FFmpeg`) | le prototype de rendu | vous |
| B-04 | Accepter les conditions de Tanzil.net pour télécharger texte et traductions (je ne coche pas « I agree » à votre place) | import mode B (phase 2) | vous |
| B-05 | Validation des captures KFGQPC par une personne compétente en lecture coranique | phase 3 (éditeur) | vous / relecteur |
| B-06 | Autorisation écrite du Dr Nonnenmacher pour publier son mot à mot dans des vidéos + texte d'attribution | publication des vidéos | vous |
| B-07 | Droits des traductions pour tout usage non strictement non commercial (Complexe Roi Fahd, éditeur de Bernström) | publication mode B | vous |
| B-08 | Relecture des écarts du classeur (2:91, 2:128, 2:144, 2:181, 59:15:9, 76:18:4 + vérification complète en phase 2) | publication des versets concernés | équipe du Dr Nonnenmacher |
| B-09 | (Recommandé) Passer à Node 22 LTS ; Node 20.11.1 reste compatible | rien | vous |

Seuls B-01 à B-03 concernent le démarrage de la phase 1 ; les autres peuvent avancer en parallèle.
