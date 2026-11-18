/**
 * The refresh embeds on every core it can get (17/11/2026: 8 of 14 cores for
 * 170 s when a 693 Ko file changed). It is background work: below normal
 * priority, it yields to whatever the person is actually doing. Called before
 * the embedding library starts its worker threads, which inherit it.
 */
/** Best effort: a system that refuses the change leaves the refresh as it was. */
export declare function lowerOwnPriority(set?: (priority: number) => void): boolean;
