import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Sonde le modèle d'embeddings une seule fois, avant le fork des workers :
    // chauffe le cache partagé par les 8 fichiers d'intégration, et décide
    // s'ils doivent être ignorés (hors ligne) ou exigés (CI). Voir
    // tests/globalSetup.ts pour le raisonnement complet.
    globalSetup: ["tests/globalSetup.ts"],
    // Les tests d'intégration chargent un modèle de ~120 Mo : les délais par
    // défaut de vitest ne suffisent pas aux hooks sur cache froid. Les tests
    // eux-mêmes surchargent déjà au cas par cas (120_000) ; ceci couvre les
    // beforeAll/afterAll, que ces surcharges n'atteignent pas.
    hookTimeout: 120_000,
  },
});
