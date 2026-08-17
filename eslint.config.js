// Minimal, targeted linter — backlog item 17 (posé 16/08, cadré et construit le 17/08).
// Scope deliberately narrow: only what `tsc --strict` cannot catch on its own — two rule
// families, not a preset. Deliberately NOT extending recommended/recommendedTypeChecked:
// tried that first, it pulled in ~50 unrelated stylistic findings (require-await,
// no-unnecessary-type-assertion, preserve-caught-error, no-unsafe-return...) — exactly the
// bikeshedding this scope explicitly ruled out (see docs/DESIGN.md / backlog note 16/08).
// Prettier / generalist style rules also explicitly excluded for the same reason.
// Only src/ and tests/ are linted: the only trees covered by tsconfig.eslint.json's typed
// program, and no-floating-promises needs type info to fire.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Real async bug class on a codebase this async (backlog rationale, 16/08) — not a
      // style preference. Found 6 real hits on first run: CLI entrypoints (main()/run...())
      // called without await/void, so an unhandled rejection would exit the process
      // silently instead of surfacing as a non-zero exit code.
      "@typescript-eslint/no-floating-promises": "error",

      // Turns the manual security grep already done by hand (16/08, docs/DESIGN.md
      // Security notes: "no shell string concatenation, no child_process.exec, no eval")
      // into an automatic, regression-proof check instead of relying on a future
      // manual re-pass.
      "no-eval": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node:child_process",
              importNames: ["exec", "execSync"],
              message:
                "exec/execSync run through a shell — use execFile/execFileSync (array args, no shell string concatenation) instead.",
            },
            {
              name: "child_process",
              importNames: ["exec", "execSync"],
              message:
                "exec/execSync run through a shell — use execFile/execFileSync (array args, no shell string concatenation) instead.",
            },
          ],
        },
      ],
    },
  },
);
