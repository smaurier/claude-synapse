import { AutoTokenizer } from "@huggingface/transformers";

const tokenizer = await AutoTokenizer.from_pretrained("Xenova/all-MiniLM-L6-v2");

// Generic, invented content on purpose — same properties as real memory
// files (accents, em-dashes, guillemets, code spans, wiki-links, Windows
// paths) without being an actual excerpt of anyone's real notes.
const samples = {
  "prose francaise avec accents": "Décision du 12/03/2026 (suite à une remarque d'une collègue « il faudrait vérifier ça ») : privilégier une architecture générique et documentée plutôt qu'une solution rapide mais fragile — c'est le critère qui prime sur la vitesse pure. Forme retenue : un module indépendant, installable seul, découplé du reste du système. Nom de code retenu : « Exemple ». Le principe central est « ne jamais dupliquer — toujours référencer ».",
  "markdown technique (code, liens, chemins)": "**Décision de conception n°2 (config utilisateur) tranchée le 10/03.** Pilotée par commandes, jamais d'édition manuelle de fichier requise (`/outil-init` au premier lancement, `/outil-config show/set` ensuite). Deux couches : config partagée dans le dépôt central (voir [[project_exemple]]), config locale (`C:\\Users\\exemple\\Documents\\projects\\exemple\\src\\config\\config.ts`). Séquence : 1) locale → 2) clone/pull → 3) config partagée → 4) jonction → 5) vérification.",
};

for (const [label, text] of Object.entries(samples)) {
  const chars800 = text.slice(0, 800);
  const encoded = await tokenizer(chars800);
  const tokenCount = encoded.input_ids.dims[1];
  console.log(`${label}: ${chars800.length} chars -> ${tokenCount} tokens (limite modele: 256)`);
}
