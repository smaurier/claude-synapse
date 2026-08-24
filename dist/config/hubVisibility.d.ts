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
export type VisibilityCheckResult = {
    checked: true;
    visibility: "private" | "public";
} | {
    checked: false;
    reason: string;
};
export declare function parseGithubOwnerRepo(hubUrl: string): {
    owner: string;
    repo: string;
} | null;
export declare function checkHubVisibility(hubUrl: string, fetchImpl?: typeof fetch): Promise<VisibilityCheckResult>;
