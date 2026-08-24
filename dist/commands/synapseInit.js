/**
 * The CLI-facing entrypoint for /synapse-init — wires bootstrap.ts's
 * injected dependencies to the real implementations (git.ts, jonction.ts)
 * and derives machineId automatically (os.hostname()) rather than asking
 * the user, to keep first-run friction low.
 *
 * createHubLink is wired to ensureHubLink(), not createLink() directly:
 * bootstrap() calls it unconditionally on every run, so a bare createLink()
 * would throw on a second /synapse-init (the link already exists) even
 * when it's already correct — ensureHubLink() is what makes re-running
 * /synapse-init safe (problème 1's idempotence design, only actually wired
 * up here). The action it took (no-op / created / recreated / backed up)
 * is captured via closure so the caller can report it — bootstrap.ts's
 * createHubLink signature returns void, and widening that tested interface
 * just to carry this one extra bit wasn't worth it.
 *
 * Visibility check runs BEFORE anything else — refuses outright (never
 * even clones) if the hub is confirmed public. Security gap flagged in the
 * design since 13/08, closed 14/08. GitHub-only (see hubVisibility.ts); for
 * any other host the check can't run, so it surfaces a warning in the
 * result instead of silently proceeding as if verified.
 */
import { hostname } from "node:os";
import { bootstrap } from "../config/bootstrap.js";
import { defaultHubClonePath, defaultLocalConfigPath } from "../config/config.js";
import { cloneOrPullHub } from "../config/git.js";
import { checkHubVisibility } from "../config/hubVisibility.js";
import { ensureHubLink, verifyWriteThrough } from "../jonction/jonction.js";
export async function runSynapseInit(opts) {
    const visibility = await checkHubVisibility(opts.hubUrl);
    if (visibility.checked && visibility.visibility === "public") {
        throw new Error(`synapse: refus d'initialiser — le hub "${opts.hubUrl}" est PUBLIC sur GitHub. ` +
            `La mémoire personnelle ne doit jamais vivre dans un dépôt public. Rendre le dépôt privé avant de réessayer.`);
    }
    const visibilityWarning = visibility.checked
        ? undefined
        : `synapse: visibilité du hub non vérifiable automatiquement (${visibility.reason}) — vérifier manuellement que ce dépôt est privé.`;
    const hubClonePath = opts.hubClonePath ?? defaultHubClonePath(opts.pluginDataDir);
    let link;
    await bootstrap({
        hubUrl: opts.hubUrl,
        localConfigPath: defaultLocalConfigPath(opts.pluginDataDir),
        hubClonePath,
        linkPath: opts.linkPath,
        machineId: hostname(),
        ...(opts.corpusRoot !== undefined ? { corpusRoot: opts.corpusRoot } : {}),
        cloneOrPullHub,
        createHubLink: (hub, linkPath) => {
            link = ensureHubLink(hub, linkPath);
        },
        verifyLink: verifyWriteThrough,
    });
    // bootstrap() only reaches this point after createHubLink ran without
    // throwing, so `link` is always set — the `!` documents that invariant
    // rather than working around a real possibility of it being undefined.
    // visibilityWarning is spread conditionally, not just possibly-undefined:
    // exactOptionalPropertyTypes treats "present but undefined" as distinct
    // from "absent", and the type says absent.
    return { hubClonePath, link: link, ...(visibilityWarning ? { visibilityWarning } : {}) };
}
//# sourceMappingURL=synapseInit.js.map