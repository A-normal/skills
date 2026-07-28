# Process Ledger And Recovery

Use a persistent process ledger for every medium/high-risk increment, every cross-session increment, and every paused task. Use an existing project issue, task record, or documentation convention when available. Do not impose a repository path without evidence or user authorization.

## Contents

- [Artifact Identity](#artifact-identity)
- [Ledger Contents](#ledger-contents)
- [Project Structure](#project-structure)
- [Synchronization](#synchronization)
- [Pause Checkpoint](#pause-checkpoint)
- [Resume](#resume)

## Artifact Identity

Place a visible notice at the top:

> This is a development workflow process record. It is not a customer requirement, product rule, acceptance authority, or source for deriving requirements. Follow the cited active requirement sources.

Include:

```yaml
artifact_type: dev-workflow-process-ledger
authority: process-record-only
is_requirement_source: false
project:
increment_id:
workflow_run_id:
risk_level:
status:
plan_version:
checkpoint_sequence:
created_at:
updated_at:
evidence_valid_as_of:
```

Use statuses:

- `PREPARING`
- `READY_TO_DEVELOP`
- `EXECUTING`
- `PAUSED`
- `BLOCKED`
- `VERIFICATION_PENDING`
- `VERIFIED`
- `CANCELLED`
- `SUPERSEDED`

## Ledger Contents

Record:

- Active requirement baseline and amendment references
- Project direction and current increment
- Risk level and trigger evidence
- Current gate states
- Material decisions and their sources
- `REQ -> TASK -> AC -> VAL` mappings
- Completed, active, and pending tasks
- Changed artifacts
- External side effects already executed
- Validation results and evidence locations
- Open material questions
- Pause reason, resume prerequisites, and next safe action
- Append-only state transition history

Never copy a process conclusion into the requirement baseline without a separately authorized requirement change.

## Project Structure

Prefer:

```text
project workflow index
  -> increment ledger A
  -> increment ledger B
  -> increment ledger C
```

Keep the project index lightweight: record the increment identifier, outcome, state, and ledger location. Keep each increment's detailed process in its own ledger.

Allow only one active execution flow to update an increment ledger. Other flows may read it. When another flow or developer has advanced the ledger or artifacts, pause and reconcile before writing.

## Synchronization

Synchronize the ledger after:

- A material user decision
- A requirement amendment
- A gate or risk change
- Plan approval or revision
- Task start, completion, or failure
- Validation execution or result change
- External side effect
- Pause, resume, cancellation, supersession, or delivery

Use this order:

```text
perform one meaningful step
capture the actual result
update the ledger
start the next step
```

Never record a future step as complete. Pause when a required ledger update fails.

Treat ledger updates as non-recursive outputs of the current workflow. Include initial repository-resident ledger creation in the authorized plan; otherwise emit the checkpoint in the conversation.

## Pause Checkpoint

Record:

```markdown
## Resume Checkpoint

- Pause reason:
- User intent at pause:
- Risk level:
- Last completed task:
- In-progress task:
- Current artifact state:
- Changes already made:
- Verification completed:
- Verification pending:
- External side effects already executed:
- Open processes or temporary state:
- Current gate states:
- Invalidated gates:
- New or unresolved questions:
- Resume prerequisites:
- Exact next safe action:
```

Stop starting new tasks as soon as the user asks to pause. If an active operation cannot stop safely, reach the nearest safe boundary and record the actual outcome.

Do not interpret pause as cancellation or rollback. Execute a rollback only when it is authorized and the approved containment plan says leaving the current state is more dangerous.

## Resume

Before continuing:

1. Re-read active instructions, the effective requirement baseline, amendments, and the checkpoint.
2. Compare the ledger with actual files, configuration, runtime, and external state.
3. Refresh drift-prone evidence.
4. Resolve concurrent changes or mark the increment `BLOCKED`.
5. Apply new requirements as amendments.
6. Reclassify risk and rerun every affected gate.
7. Confirm completed external side effects and their idempotency.
8. Increment `checkpoint_sequence`.
9. Continue from the first incomplete task that remains valid.

Do not trust the ledger as proof that reality has not changed. Treat it as the last durable checkpoint and reconcile after every unexpected interruption.
