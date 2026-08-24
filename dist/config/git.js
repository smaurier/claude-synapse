/**
 * Real git clone/pull for the hub — what bootstrap.ts's injected
 * cloneOrPullHub is wired to at the real CLI entrypoint. Shells out to the
 * system git binary (no git library dependency, one less thing to keep
 * light per the project's general bias against heavy native deps).
 *
 * Pull uses --ff-only deliberately: never merge/rebase automatically on
 * divergence. A silent auto-merge of the memory hub would be exactly the
 * kind of "more than one exemplar reconciled behind your back" situation
 * the whole jonction thesis ("zero merge by construction") exists to
 * avoid — surfacing a hard failure here is consistent with that, not an
 * unrelated caution.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
/** Thin, reusable git runner — exported for other modules (syncBrain.ts)
 *  that need more git subcommands than clone/pull. Returns stdout. */
export async function runGit(args, cwd) {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return stdout;
}
/** Trailing ".git" and trailing slashes are cosmetic — the same remote can be
 *  spelled several ways (SSH vs HTTPS form, trailing slash on a local path).
 *  Not a full URL-equivalence check (that would need to resolve SSH aliases,
 *  case-fold Windows paths, etc.) — just enough to not false-positive on the
 *  same spelling this codebase's own callers actually produce. */
function normalizeRemote(url) {
    return url.replace(/\/+$/, "").replace(/\.git$/, "");
}
export async function cloneOrPullHub(hubUrl, hubClonePath) {
    const alreadyCloned = existsSync(join(hubClonePath, ".git"));
    try {
        if (alreadyCloned) {
            // Adopting a pre-existing directory as the hub (rather than one this
            // code cloned itself) means hubClonePath's origin might be a repo the
            // caller never intended — pulling blindly would mix unrelated history
            // into what's supposed to be the one true memory hub. Checked BEFORE
            // any pull is attempted, never after.
            let actualOrigin;
            try {
                actualOrigin = (await execFileAsync("git", ["remote", "get-url", "origin"], { cwd: hubClonePath })).stdout.trim();
            }
            catch (err) {
                const cause = err instanceof Error ? err.message : String(err);
                throw new Error(`synapse: "${hubClonePath}" contient un ".git" mais son remote "origin" est illisible.\n` +
                    `Diagnostic : ${cause}\nCe n'est probablement pas un clone valide du hub attendu.`);
            }
            if (normalizeRemote(actualOrigin) !== normalizeRemote(hubUrl)) {
                throw new Error(`synapse: refus de synchroniser "${hubClonePath}" — son remote "origin" ("${actualOrigin}") ` +
                    `ne correspond pas au hub attendu ("${hubUrl}"). Adopter ce dossier comme hub le mélangerait ` +
                    `avec un dépôt différent. Vérifier le chemin, ou pointer vers le bon dossier.`);
            }
            await execFileAsync("git", ["pull", "--ff-only"], { cwd: hubClonePath });
        }
        else {
            await execFileAsync("git", ["clone", hubUrl, hubClonePath]);
        }
    }
    catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        // Message complet assemblé ici, une seule fois — trouvé le 14/08 (revue
        // de code) : l'ancienne version construisait un fragment "action" avec
        // des guillemets délibérément déséquilibrés, qui ne se lisait
        // correctement qu'une fois recollé dans le message englobant.
        const actionLabel = alreadyCloned
            ? `"git pull --ff-only" dans "${hubClonePath}"`
            : `"git clone" de "${hubUrl}" dans "${hubClonePath}"`;
        throw new Error(`synapse: échec de ${actionLabel}.\nDiagnostic : ${cause}\n` +
            (alreadyCloned
                ? `Cause probable : le hub local a divergé du distant (commits locaux non poussés, ou ` +
                    `historique réécrit côté distant) — --ff-only refuse volontairement toute fusion automatique. ` +
                    `Résoudre manuellement dans "${hubClonePath}" avant de réessayer.`
                : `Causes probables : URL invalide, pas d'accès (clé SSH/identifiants), ou "${hubClonePath}" ` +
                    `existe déjà et n'est ni vide ni un dépôt git.`));
    }
}
//# sourceMappingURL=git.js.map