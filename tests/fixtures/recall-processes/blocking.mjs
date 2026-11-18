// Bloque 10 s, comme le chargement du modèle ONNX sous charge (appel natif).
const end = Date.now() + 10_000;
while (Date.now() < end) { /* travail synchrone */ }
process.stdout.write(JSON.stringify({ additionalContext: "trop tard" }));
