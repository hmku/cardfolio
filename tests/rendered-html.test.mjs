import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Cardfolio replaces every temporary starter marker", async () => {
  const [page, layout, authGate, component, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AuthGate.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/TrackerApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /AuthGate/);
  assert.match(authGate, /signInWithOtp/);
  assert.match(layout, /Cardfolio/);
  assert.match(component, /5\/24 by cardholder/);
  assert.match(component, /Annual fee watchlist/);
  assert.match(component, /Signup bonuses in progress/);
  assert.match(component, /Qualification period/);
  assert.match(component, /kind-pill/);
  assert.match(component, /Usage by card/);
  assert.match(component, /Card types/);
  assert.match(component, /Annual fee/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
