# Block 12 — web UI verification

## Scope and contracts

Read `docs/api.md`, `docs/web-simulator.md`, `docs/testing-domains.md`, `DESIGN-cal.md`, the dashboard/auth/admin components, and the existing frontend tests before adding checks.

`docs/web-simulator.md` documents the guest/user/operator/owner UI capabilities, owner-only account-management navigation, account email read-only behavior, and the 12-character password minimum. `docs/api.md` describes the first-measurement empty state. Existing `AirDashboard.test.ts` already covers dashboard destinations, history periods, sensor context cards, settings content, and window-history summaries. Existing `Charts.test.ts` covers chart data and viewport interactions; those checks were not duplicated.

`DESIGN-cal.md` identifies itself as a Cal.com design analysis and describes booking-product components. It does not specify AirCheck page layouts. Tests therefore check behavior and accessible relationships documented by AirCheck or visible in the components, and do not assert Cal.com colors, layout, or copy as AirCheck requirements.

## Added checks

- `AirDashboard.ui.test.ts`: initial synchronization and keyboard skip link, successful no-measurement state, dashboard error and retry, and ventilation command availability by UI role. API and session responses are controlled test doubles; command calls are verified at the UI boundary.
- `SettingsPanel.ui.test.ts`: selected tab-to-panel accessibility relationships, disabled form controls for read-only access, and an announced settings error.
- `auth/AccountMenu.ui.test.ts`: account navigation for user/operator/owner, owner-only management link, sign-out refresh, and retry when session status is unavailable.
- `auth/auth-ui.test.ts`: password show/hide by click and keyboard, hiding after clearing the value, labelled sign-in/sign-up fields and documented password constraint, account loading/error retry, and read-only account email.
- `OwnerUsers.ui.test.ts`: pending, empty, and failed list requests.

## Results

Environment: Windows PowerShell; Node.js `v22.22.2`; npm `10.9.7`; Vitest `3.2.7`; React `19.2.8`; jsdom `30.1.1`; Testing Library React `16.3.3`, DOM `10.4.2`, and user-event `14.6.7`. The added packages are dev dependencies. No production package or source file changed.

New test files: **20 passed, 1 failed, 0 skipped** (21 tests across 5 files).

Full relevant UI set: **48 passed, 1 failed, 0 skipped** (49 tests across 11 files). The set includes the new files, existing dashboard/chart tests, and existing client-facing auth/access/air-quality helper tests. Server authorization suites and 3D scene tests were excluded as neighboring blocks.

The one failing regression check is `OwnerUsers.ui.test.ts`: when `/api/admin/users` fails, the component displays the error feedback and also renders `Список пуст.`. `OwnerUsers.tsx` leaves `users` as an empty array after a failed request, then renders the empty-list branch once `loading` becomes false. This conflates request failure with a successful empty response. The test remains red as requested; production code was not changed.

The first test startup stopped before executing tests because `@testing-library/react`'s peer dependency `@testing-library/dom` was absent. It was added as a dev dependency, and the results above are from the subsequent successful test collection and execution.

## Commands

New test set:

```powershell
npm test -- src/components/AirDashboard.ui.test.ts src/components/SettingsPanel.ui.test.ts src/components/OwnerUsers.ui.test.ts src/components/auth/AccountMenu.ui.test.ts src/components/auth/auth-ui.test.ts --maxWorkers=1 --minWorkers=1
```

Full relevant UI set:

```powershell
npm test -- src/components/AirDashboard.test.ts src/components/Charts.test.ts src/components/AirDashboard.ui.test.ts src/components/SettingsPanel.ui.test.ts src/components/OwnerUsers.ui.test.ts src/components/auth/AccountMenu.ui.test.ts src/components/auth/auth-ui.test.ts src/lib/air-quality.test.ts src/lib/auth-navigation.test.ts src/lib/auth-errors.test.ts src/lib/access-types.test.ts --maxWorkers=1 --minWorkers=1
```

Both `npm run typecheck` and `npm run lint` passed. In this package, `lint` is also `tsc --noEmit`. `git diff --check` passed.

## Limits

The Vitest environment is jsdom. It supports DOM interactions and keyboard events used above, but it does not calculate browser CSS layout. Responsive overflow, real viewport breakpoints, and visual layout were not verified; no browser runner was configured, and no browser dependency was added. The page-level tests mock the API/session boundary; they do not repeat backend role enforcement. Canvas/3D interaction was excluded.
