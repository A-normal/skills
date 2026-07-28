# Usage Examples

Use these examples only to resolve classification or workflow ambiguity. Never copy an example requirement into a real project.

## Contents

- [Low-Risk Local Fix](#low-risk-local-fix)
- [Current Increment Inside A Larger Project](#current-increment-inside-a-larger-project)
- [Requirement Baseline With Amendment](#requirement-baseline-with-amendment)
- [Existing Code Does Not Define Requirements](#existing-code-does-not-define-requirements)
- [Medium-Risk User Interaction](#medium-risk-user-interaction)
- [High-Risk Migration](#high-risk-migration)
- [Failure During Execution](#failure-during-execution)
- [User Pause](#user-pause)
- [Read-Only Diagnosis](#read-only-diagnosis)
- [Tasks That Normally Do Not Trigger](#tasks-that-normally-do-not-trigger)

## Low-Risk Local Fix

```text
This private formatter emits an extra comma for an empty list. Make it return an empty string.
```

Expected behavior:

- Confirm the explicit behavior, local owner, callers, and validation path.
- Assign `LOW` only when no contract, persistence, state, permission, or consumer behavior changes.
- Evaluate the gates compactly and implement without a second authorization.

## Current Increment Inside A Larger Project

```text
Build order creation now. Refund and promotion behavior will be designed later.
```

Expected behavior:

- Align order creation with the project direction.
- Define the current increment as order creation.
- Mark refunds and promotions as explicit non-goals.
- Fully establish creation requirements and contracts without inventing future models.

## Requirement Baseline With Amendment

```text
The original approved specification still applies. This new document changes the approval flow but does not describe the rest of the product.
```

Expected behavior:

- Keep the original complete specification as the baseline.
- Build an `ADD/MODIFY/DELETE/INHERIT/AMBIGUOUS` matrix.
- Override only explicitly identified requirements.
- Ask for a decision on material ambiguous overlap.

## Existing Code Does Not Define Requirements

```text
Add a replacement endpoint. The old endpoint returns 200 for a missing record, but the new requirement does not define missing-record behavior.
```

Expected behavior:

- Record the existing 200 behavior as `STATIC_CONFIRMED` technical evidence only.
- Mark the new missing-record requirement `UNKNOWN`.
- Do not preserve or change the behavior until the user or an approved requirement resolves it.

## Medium-Risk User Interaction

```text
Keep search filters when the user returns from a detail page.
```

Expected behavior:

- Confirm entry and exit paths, reset conditions, URL or cache ownership, user feedback, and acceptance.
- Trace affected routes, state consumers, and requests.
- Produce the development contract and obtain one confirmation.
- Execute all approved tasks continuously afterward.

## High-Risk Migration

```text
Move account identifiers to a new schema and migrate existing records.
```

Expected behavior:

- Assign `HIGH`.
- Establish identity, compatibility, data transformation, rollback, partial failure, idempotency, and production authorization.
- Create a persistent ledger.
- Obtain implementation authorization and separate migration authorization where required.

## Failure During Execution

```text
An approved implementation fails its unit test.
```

Expected behavior:

- Fix it autonomously when it is an `IMPLEMENTATION_DEFECT` inside the approved contract.
- Regress the gate when the fix requires a new business rule, contract, dependency direction, or scope.
- Never weaken the test or acceptance criterion merely to pass.

## User Pause

```text
Pause now; the external API changed and I need to review the token budget.
```

Expected behavior:

- Stop starting new work.
- Reach the nearest safe boundary.
- Mark the increment `PAUSED`.
- Write the resume checkpoint.
- Reconcile the API, budget, requirements, gates, and external side effects before resuming.

## Read-Only Diagnosis

```text
Why does the page close after submission?
```

Expected behavior:

- Select `READ_ONLY`.
- Trace the submit request, handling, routing, and relevant runtime evidence.
- Keep implementation behavior separate from intended requirements.
- Explain confirmed behavior and missing evidence without mutating artifacts.

## Tasks That Normally Do Not Trigger

Do not invoke this workflow for translation, current time, exact prose formatting, or other tasks without modular software reasoning or artifact change.
