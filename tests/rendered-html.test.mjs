import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Cardfolio replaces every temporary starter marker", async () => {
  const [page, layout, authGate, component, storage, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AuthGate.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/TrackerApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /AuthGate/);
  assert.match(authGate, /signInWithOtp/);
  assert.match(layout, /Cardfolio/);
  assert.match(component, /5\/24 by cardholder/);
  assert.match(component, /Action queue/);
  assert.match(component, /cardAction\(account, data\.accounts, referenceDate, data\.actionRules\)/);
  assert.match(component, /opened \{formatDate\(account\.approvedOn \|\| account\.appliedOn\)\}/);
  assert.match(component, /Signup bonuses in progress/);
  assert.match(component, /Qualification period/);
  assert.match(component, /kind-pill/);
  assert.match(component, /Usage by card/);
  assert.match(component, /creditPreviewGroups/);
  assert.match(component, /credit-preview-accounts/);
  assert.match(component, /Sorted by card opening date, newest first/);
  assert.match(component, /String\(b\.account\.approvedOn\)\.localeCompare\(String\(a\.account\.approvedOn\)\)/);
  assert.match(component, /Important credits/);
  assert.match(component, /Clear, office supply, and wireless/);
  assert.match(component, /Credits this period/);
  assert.match(component, /Usage is tracked separately for this exact card/);
  assert.match(component, /selectedAccountCredits/);
  assert.match(component, /Card types/);
  assert.match(component, /Action rules/);
  assert.match(component, /submitActionRule/);
  assert.match(component, /New rule/);
  assert.match(component, /Annual fee/);
  assert.match(component, /How was this card closed\?/);
  assert.match(component, /Reopen/);
  assert.match(component, /Declined/);
  assert.match(component, /Review account details and track the credits available on this specific card/);
  assert.match(component, /cardSortHeader\("card", "Card"\)/);
  assert.match(component, /cardSortHeader\("nextAction", "Next action"\)/);
  assert.match(component, /undoLastAction/);
  assert.match(component, /"Undo"/);
  assert.match(storage, /action === "updateAccount"/);
  assert.match(storage, /action === "reopenAccount"/);
  assert.match(storage, /action === "createActionRule"/);
  assert.match(storage, /action === "updateActionRule"/);
  assert.doesNotMatch(component, /closed in Cardfolio/i);
  assert.doesNotMatch(storage, /closed in Cardfolio/i);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
