# Code review — 2026-09-29

Scope: duplication, organization, and UI consistency. Reviewed the components, CSS,
core logic, browser data layer, server routes, and project documentation. Base:
`9334dc4` on `main`. Changes are prepared locally on `review/code-organization-ui-consistency` for
independent review before release. GitHub rejected remote branch creation with
403 “Resource not accessible by integration”; the branch has NOT been pushed.
The complete deliverable is `cardfolio-review.patch`; apply it on a branch based on
`9334dc4` (or use a three-way apply against a newer main). Production is unchanged.

## Implemented

- **One card-status presentation**: `app/lib/presentation/card-status.ts` replaces the
  separate Cards and Credits implementations. Both now use the same review, bonus,
  pending, fee, and recent-change tags. Cards keeps its existing urgency filter/row
  shading; all unearned open-card bonuses remain amber until overdue. Core reminder
  scheduling and financial calculations are unchanged.
- **Honest fee language**: the app knows an approval anniversary, not a statement
  posting. Annual fee reviews say “fee anniversary” instead of “fee posted.”
- **Historical holdings**: old products with remaining credits show their successor
  or closure, rather than borrowing the current product's bonus/review tasks.
- **Shared card identity**: `CardDetails.tsx` owns the cardholder dot, short card name,
  initials/number, and last digits. Desktop Cards now shows last digits, like phone
  tiles and credit rows. Account drawer headings use full product names as specified
  in AGENTS.md. Desktop rows have a real keyboard-accessible card button.
- **Clearer module responsibilities**: framework-free display helpers and labels live
  under `app/lib/presentation/`; React primitives remain in `ui.tsx`. The to-do list,
  its wording, and its expand state live in `DueList.tsx`. `CellTarget` belongs to
  `CreditCell.tsx`, so the account editor no longer imports a list view's types.
- **Stable dialog/toast lifecycle**: `useDialogFocus` focuses on opening, traps Tab in
  the topmost dialog, closes only that dialog on Escape, and restores the opener.
  `useEffectEvent` avoids restarting focus/timers because a parent creates a new
  callback. Drawers lock background scrolling. Credit long-press timers clean up
  when their cells unmount.
- **UI consistency**: Credits has an empty search state; status pills and product
  summaries can wrap on phones; shared spacing styles replace repeated inline
  overrides. Removed unused styles for the former viewer/filter/footer UI. Settings
  now calls the shared list “To do”; applied/closed dates use the shared full formatter.
- Added regression coverage for overdue/earned bonuses, pending/closed states, old
  holdings, fee wording, urgency priority, and future-dated product changes.

## Follow-ups found (pre-existing, not changed in this branch)

1. **High: multi-step data writes can partially succeed.** In `app/lib/data.ts`,
   `setCreditUse` deletes existing usage before inserting its replacement. A failed
   insert loses the previous log; concurrent requests can produce unexpected totals.
   Product changes, undo, and account edits also make several requests without a
   transaction. Add transactional Supabase RPCs with appropriate membership checks
   and failure/concurrency tests in a separate migration-backed change.
2. **Medium: Settings clears drafts after failed saves.** `Portfolio.write` normally
   catches an error and resolves. Settings' Add credit/Add person forms then clear
   their input in `.then`, even when nothing was saved. Invite has the same pattern.
   Make success/failure explicit (reject, or return a result), retain failed drafts,
   and prevent duplicate submission; coordinate error toasts with callers.
3. **Medium: reloads can race and delayed callbacks outlive their subscription.**
   `Portfolio.reload` has no request-generation guard; an older response can replace
   newer data. Realtime's cleanup does not clear its pending reload timer, and the
   sheet-sync timer has no unmount cleanup. Extract a small portfolio-loading hook
   with stale-response protection and explicit timer cleanup before adding more UI.
4. **Organization: keep further splitting proportional.** `SettingsDrawer` contains
   product/credit/person editors; `AccountDrawer` contains the product-change editor.
   Extract those feature components when changing their behavior. Don't split the
   small core modules or add a broad state library solely to reduce line counts.
5. **Theme duplication**: the explicit-dark and system-dark palettes duplicate token
   values. Consolidate if/when adding a theme setting, preserving all three modes.

## Validation and release checks

- `npm run check` passed: lint, TypeScript, all 17 regression tests, and production build.
- Actual components rendered locally with the checked-in sheet snapshot and synthetic
  last digits. Temporary test route removed before the final build and push.
- Browser: 1280px desktop and 390px phone Cards/Credits, no document overflow, no
  console errors/error overlay, empty Credits search, drawer scroll lock, forward and
  reverse Tab wrap, nested credit-menu Escape leaving the drawer open.
- No production login, household writes, migrations, dependency changes, or deployment.
- A signed-in preview smoke test remains for the release agent: live household loading,
  search, status filters, closed toggle, to-do navigation, account/Settings edits, credit
  used/partial/off/undo, and light/dark layouts. Use test data for writes; the production
  test member sees real household data (AGENTS.md).

## Release-agent handoff

Apply the supplied `cardfolio-review.patch` to `hmku/cardfolio` on a new branch named
`review/code-organization-ui-consistency`; it is based on `9334dc4`. Independently
review the resulting diff against current `main`. Read AGENTS.md, this review, and TODO.md. Evaluate the shared
status wording/colors, historical holdings, identity labels, component boundaries,
and dialog/toast lifecycle; amend or reject suggestions that don't improve the app.
Check for regressions, reconcile any newer changes on main, and run `npm run check`.
Smoke-test the signed-in UI at phone and desktop widths in light/dark mode, especially
credit use/partial/enrollment/undo, drawers/nested menus, filters, closed cards, and
to-do navigation. Assess the pre-existing follow-ups separately and don't blindly
combine migration work with this UI refactor. Once satisfied, merge the accepted
changes into main and release through the existing Vercel workflow. Verify the
production deployment and report the released commit, checks, and deferred work.

## Release notes (merge into main)

Accepted with amendments after reconciling with the five commits that landed on `main` after
`9334dc4` (iOS date inputs, drawer refresh after product changes, the violet "kept with a fee"
tone, hidden closed cards on Credits, and TODO updates):

- `card-status.ts` gained the `kept` tone (priority: alert, due, info, kept) and its test.
- Fee-soon tags stay neutral: amber is reserved for bonuses in progress, which also shade the row.
- Review tags read "Keep or close? $695 fee, renewed Sep 13" / "renews in 12d"; bonus tags
  keep "172d left".
- `.tag` wraps with `overflow-wrap: break-word`, not `anywhere`, so narrow columns don't
  break words mid-letter; phone tile names keep their bolder weight.

The pre-existing follow-ups above are tracked in TODO.md under "Review follow-ups".
