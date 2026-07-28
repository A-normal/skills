# Output Templates

Choose the shortest output that preserves evidence, state, blockers, and the next action. Do not emit empty ceremonial sections.

## Contents

- [Compact Decision](#compact-decision)
- [Requirement Change Matrix](#requirement-change-matrix)
- [Development Contract](#development-contract)
- [Focused Blocker](#focused-blocker)
- [Progress](#progress)
- [Verification Matrix](#verification-matrix)
- [Delivery](#delivery)

## Compact Decision

```markdown
## Evidence

- Direction: <source and alignment>
- Requirement: <source and confirmed behavior>
- Technical path: <file, symbol, module, configuration, or runtime evidence>
- Contract: <input, output, state, side effect, and consumer>
- Validation: <acceptance criterion and method>

## Decision

- Risk: LOW
- Gate 0 Direction: READY | BLOCKED
- Gate 1 Requirement: READY | BLOCKED
- Gate 2 Technical: READY | BLOCKED
- Gate 3 Data And Contract: READY | BLOCKED
- Gate 4 Development Contract: READY | BLOCKED | NOT_APPLICABLE
- Material unknowns: 0 | N
- Next action: <execute, inspect, decide, pause, or deliver>
```

## Requirement Change Matrix

```markdown
| Amendment item | Baseline requirement | Relationship | Evidence | Decision |
| --- | --- | --- | --- | --- |
| | | ADD / MODIFY / DELETE / INHERIT / AMBIGUOUS | | |
```

## Development Contract

```markdown
## Direction And Increment

- Authoritative direction:
- Current milestone:
- Increment outcome:
- Scope:
- Non-goals:
- Project invariants:

## Effective Requirements

| ID | Requirement | Source | Acceptance IDs | Status |
| --- | --- | --- | --- | --- |
| REQ-01 | | | AC-01 | CONFIRMED |

## Implementation Tasks

| ID | Requirement | Goal | Affected artifacts | Dependencies | Validation |
| --- | --- | --- | --- | --- | --- |
| TASK-01 | REQ-01 | | | | VAL-01 |

## Acceptance And Validation

| Acceptance ID | Criterion | Validation ID | Layer | Required | Authorization |
| --- | --- | --- | --- | --- | --- |
| AC-01 | | VAL-01 | static / runtime / integration / database / end-to-end / human | REQUIRED / N/A | |

## Risk And Authorization

- Risk:
- Risk triggers:
- Side effects:
- Containment or rollback:
- Separately authorized operations:
- Material unknowns:

## Gate Decision

- Gate 0 Direction:
- Gate 1 Requirement:
- Gate 2 Technical:
- Gate 3 Data And Contract:
- Gate 4 Development Contract:
- Implementation authorized: YES | NO
- Next action:
```

## Focused Blocker

```markdown
## Blocked

- Earliest blocked gate:
- Confirmed evidence:
- Exact unknown or conflict:
- Why it is material:
- Evidence already inspected:
- Required decision or authority:
- Focused question:
```

## Progress

```markdown
## Progress

- Increment:
- Completed task:
- Requirement mapping:
- Changed artifacts:
- Validation performed:
- Evidence recorded:
- Gate regression: NONE | <gate and reason>
- Ledger checkpoint:
- Next task:
```

## Verification Matrix

```markdown
| Validation ID | Acceptance ID | Layer | Requirement | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| VAL-01 | AC-01 | static | REQUIRED | PASSED / FAILED / PENDING | |
| VAL-02 | AC-02 | human | N/A | NOT_APPLICABLE | |
```

Derive the overall state:

- `VERIFIED`: every `REQUIRED` row is `PASSED`.
- `VERIFICATION_PENDING`: at least one `REQUIRED` row is `PENDING`.
- `VERIFICATION_FAILED`: at least one `REQUIRED` row is `FAILED`.

## Delivery

```markdown
## Delivery

- Increment state: VERIFIED | VERIFICATION_PENDING | VERIFICATION_FAILED
- Delivered behavior:
- Changed artifacts:
- Requirement-to-task mapping:
- Validation evidence:
- Not verified:
- External side effects:
- Known limitations and risks:
- Ledger state:
- Required follow-up:
```
