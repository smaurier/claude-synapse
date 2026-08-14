import { describe, it, expect } from "vitest";
import { isAuditOverdue } from "../src/commands/refreshIndex.js";

describe("isAuditOverdue", () => {
  it("is overdue when never audited (lastAuditAt is null)", () => {
    expect(isAuditOverdue(null, 14)).toBe(true);
  });

  it("is overdue when lastAuditAt is unparseable", () => {
    expect(isAuditOverdue("pas-une-date", 14)).toBe(true);
  });

  it("is not overdue when well within the cadence window", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(isAuditOverdue(yesterday, 14)).toBe(false);
  });

  it("is overdue once the cadence window has passed", () => {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    expect(isAuditOverdue(fifteenDaysAgo, 14)).toBe(true);
  });
});
