import { AutoTokenizer } from "@huggingface/transformers";

const tokenizer = await AutoTokenizer.from_pretrained("Xenova/all-MiniLM-L6-v2");

const samples = {
  "prose francaise avec accents": "Décision du 22/07/2026 (suite remarque d'un collègue « tu pourrais le vendre ») : PAS de produit payant (risque plateforme, niche, zéro douve) — mais une version générique et saine en open-source, c'est LE volet qui intéresse Sylvain (la vitrine GitHub et l'article LinkedIn sont annexes pour lui). Forme retenue : un plugin Claude Code (marketplace GitHub, comme caveman) — hooks + commandes + install, PAS un repo de scripts à copier. Totalement découplé du système privé de Sylvain : module indépendant, installable seul. Nom tranché le 01/08/2026 : Synapse (repo probable : claude-synapse). La synapse est le lien dans le cerveau — le nom porte la thèse « don't sync — link ».",
  "markdown technique (code, liens, chemins)": "**Problème de conception n°2 (config utilisateur) tranché le 13/08.** Piloté par commandes, jamais d'édition manuelle de fichier requise (`/synapse-init` au premier lancement, `/synapse-config show/set` ensuite) — pattern repris de claudebase. Deux couches : config partagée dans le repo hub (voir [[project_radar_signaux]]), config locale (`C:\\Users\\lrtechnologies\\Documents\\projects\\claude-synapse\\src\\config\\config.ts`). Séquence : 1) locale → 2) clone/pull → 3) config partagée → 4) jonction → 5) vérification.",
};

for (const [label, text] of Object.entries(samples)) {
  const chars800 = text.slice(0, 800);
  const encoded = await tokenizer(chars800);
  const tokenCount = encoded.input_ids.dims[1];
  console.log(`${label}: ${chars800.length} chars -> ${tokenCount} tokens (limite modele: 256)`);
}
