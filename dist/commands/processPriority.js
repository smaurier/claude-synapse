/**
 * The refresh embeds on every core it can get (17/11/2026: 8 of 14 cores for
 * 170 s when a 693 Ko file changed). It is background work: below normal
 * priority, it yields to whatever the person is actually doing. Called before
 * the embedding library starts its worker threads, which inherit it.
 */
import { constants, setPriority } from "node:os";
/** Best effort: a system that refuses the change leaves the refresh as it was. */
export function lowerOwnPriority(set = (priority) => setPriority(priority)) {
    try {
        set(constants.priority.PRIORITY_BELOW_NORMAL);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=processPriority.js.map