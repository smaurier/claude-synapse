/**
 * Visibility check for the hub before linking (gap flagged in the design
 * doc since 13/08, never implemented until now): /synapse-init must refuse
 * to link a PUBLIC hub. The secrets scanner protects content; this protects
 * the repo's visibility setting itself, a different failure mode entirely.
 *
 * GitHub only, unauthenticated (no token needed — keeps setup friction at
 * zero, matches the project's "léger" bias). A private repo and a
 * nonexistent one both 404 on the unauthenticated API; both are safe to
 * treat as "not verifiably public" here — the clone step itself will fail
 * separately and clearly if the repo doesn't actually exist.
 *
 * GitLab/Bitbucket/self-hosted git are NOT supported by this check —
 * deliberately reported as "couldn't verify" rather than silently assumed
 * safe, so the caller can warn instead of a false sense of security.
 */

export type VisibilityCheckResult =
  | { checked: true; visibility: "private" | "public" }
  | { checked: false; reason: string };

export function parseGithubOwnerRepo(hubUrl: string): { owner: string; repo: string } | null {
  const stripGitSuffix = (s: string): string => s.replace(/\.git$/, "");

  const ssh = hubUrl.match(/^git@github\.com:([^/]+)\/(.+)$/);
  if (ssh) return { owner: ssh[1]!, repo: stripGitSuffix(ssh[2]!) };

  const https = hubUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  if (https) return { owner: https[1]!, repo: stripGitSuffix(https[2]!) };

  return null;
}

export async function checkHubVisibility(
  hubUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VisibilityCheckResult> {
  const parsed = parseGithubOwnerRepo(hubUrl);
  if (!parsed) {
    return { checked: false, reason: "hôte non reconnu — seul GitHub est supporté par la vérification automatique" };
  }

  let res: Response;
  try {
    res = await fetchImpl(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
  } catch (err) {
    return { checked: false, reason: `appel à l'API GitHub impossible (${err instanceof Error ? err.message : String(err)})` };
  }

  if (res.status === 404) {
    return { checked: true, visibility: "private" };
  }
  if (res.status === 200) {
    const data = (await res.json()) as { private?: boolean };
    return { checked: true, visibility: data.private ? "private" : "public" };
  }
  return { checked: false, reason: `réponse inattendue de l'API GitHub (HTTP ${res.status})` };
}
