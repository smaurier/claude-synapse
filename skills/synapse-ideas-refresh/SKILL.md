---
description: Recoupe le registre d'idées du hub contre son état réel et le met à jour — jugement du modèle, jamais déclenché à l'aveugle par un hook.
allowed-tools: [Read, Grep, Glob, Edit, Write, Bash]
---

# /synapse-ideas-refresh

Complément de `/synapse-doctor`, pas un remplaçant. `/synapse-doctor` est mécanique
(frontmatter, péremption, doublons — aucun jugement) ; ceci demande l'inverse, exactement
comme `/brain-audit` : **c'est Claude qui juge**, un algorithme ne peut pas dire honnêtement
si une idée a avancé. D'où la même règle non négociable que `/brain-audit` : jamais déclenché
à l'aveugle par `SessionStart` ou `/synapse-doctor` — seul le signal de retard l'est (voir
`refreshIndexCli.js`), jamais le travail lui-même.

## 1. Trouver (ou poser) le registre canonique

Chercher dans le hub un fichier de type `reference` dont la description indique clairement
qu'il consolide toutes les idées (mots-clés : « toutes les idées », « synthèse », « registre
unique »). S'il existe, c'est la cible à mettre à jour. S'il n'y en a aucun et que c'est la
première invocation sur ce hub, demander à l'utilisateur où il veut que ça vive plutôt que d'en
créer un sans lui demander — un hub neuf n'a pas forcément encore cette convention.

## 2. Rassembler les idées

Toute fiche qui porte une idée pas encore lancée : un registre dédié s'il existe (ex.
business/produit), les fiches de projets dormants, et toute piste parquée liée à un chantier
actif. Respecter toute séparation déjà documentée dans le hub (ex. perso/pro, si une règle
`feedback_*` l'impose) — ne jamais mélanger des mondes que l'utilisateur garde volontairement
séparés.

## 3. Recouper, pas recopier

Pour chaque idée, vérifier son état **réel** contre `MEMORY.md` et le reste du corpus — pas
contre le statut que le fichier source affiche lui-même, qui peut être périmé de plusieurs
mois (une idée peut être devenue un vrai projet sans que sa ligne d'origine ait bougé).

⚠️ **Un constat de recherche/terrain n'est pas une décision de clore une idée.** Si une
vérification trouve un obstacle (marché occupé, case non chiffrée, verrou juridique),
formuler ça en constat (« obstacle identifié », « à requalifier »), jamais en verdict de
clôture (« écartée », « abandonnée ») — sauf si l'utilisateur a lui-même explicitement dit de
ne pas relancer cette piste précise.

## 4. Mettre à jour, puis marquer fait

Éditer le registre canonique avec les statuts recoupés. Une fois l'édition faite (et
seulement à ce moment-là, jamais avant) :

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/commands/ideasRefreshCli.js" "${CLAUDE_PLUGIN_DATA}"
```

Ça avance `lastIdeasRefreshAt`, ce qui éteint le signal de retard jusqu'à la prochaine
échéance (`ideasRefreshCadenceDays`, configurable via `/synapse-config set
ideasRefreshCadenceDays <jours>`).
