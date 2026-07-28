# Evidence Gates And Risk Rules

Use these rules to determine whether the current deliverable increment may advance. Evaluate only applicable dimensions, but never omit a dimension because evidence is inconvenient.

## Contents

- [Evidence Status](#evidence-status)
- [Requirement Authority](#requirement-authority)
- [Effective Requirement Baseline](#effective-requirement-baseline)
- [Materiality](#materiality)
- [Risk Classification](#risk-classification)
- [Cross-Session Classification](#cross-session-classification)
- [Gate 0: Direction](#gate-0-direction)
- [Gate 1: Requirement](#gate-1-requirement)
- [Gate 2: Technical](#gate-2-technical)
- [Gate 3: Data And Contract](#gate-3-data-and-contract)
- [Gate 4: Development Contract](#gate-4-development-contract)
- [Gate Status](#gate-status)
- [Workflow By Risk](#workflow-by-risk)

## Evidence Status

Use:

- `USER_DECISION`: the current user explicitly decided a requirement or direction.
- `APPROVED_REQUIREMENT`: an active customer, product, acceptance, or project requirement supports the conclusion.
- `STATIC_CONFIRMED`: current code, configuration, schema, interface, or static test artifact supports a technical fact.
- `RUNTIME_VERIFIED`: executed runtime evidence supports a technical fact or acceptance result.
- `CANDIDATE_REQUIREMENT`: a document or statement may be relevant but its validity or scope is unconfirmed.
- `UNKNOWN`: required evidence is absent.
- `CONFLICTING`: applicable evidence disagrees.

Never use implementation evidence to change `UNKNOWN` requirement evidence into a requirement.

## Requirement Authority

Use requirement evidence from:

1. The current user's explicit decision.
2. Active project-level instructions or approved specifications.
3. Approved acceptance criteria, issue, PRD, or change document.
4. Active ADR, architecture rule, roadmap, or other authoritative project document when it explicitly governs the requirement.

Do not use code, configuration, schemas, runtime behavior, tests, README files, comments, examples, naming, or historical artifacts as requirement evidence.

Default to trusting the current user to make task decisions. Add approval checks only when active project rules require them. When valid requirement sources conflict, prefer none silently; record the conflict and obtain a user decision.

## Effective Requirement Baseline

Treat the most recent confirmed complete requirements as the active baseline. Treat a later partial document as an amendment rather than a replacement unless it explicitly supersedes the whole baseline.

For every amendment, classify each item:

| Relationship | Meaning |
| --- | --- |
| `ADD` | Introduce an explicit new requirement |
| `MODIFY` | Replace an explicitly identified baseline requirement |
| `DELETE` | Remove an explicitly identified baseline requirement |
| `INHERIT` | Keep an unmentioned baseline requirement |
| `AMBIGUOUS` | The overlap or effect cannot be confirmed |

Block affected requirement decisions while any material relationship remains `AMBIGUOUS`.

## Materiality

Treat an unknown or choice as material when two reasonable answers could change any of:

- Project direction, current scope, or business rule
- User-visible behavior or acceptance result
- API, schema, data meaning, or compatibility
- Permission, security, privacy, or tenancy
- State transition, persistence, or external side effect
- Module ownership, public interface, or dependency direction
- Error semantics, idempotency, rollback, or data-loss risk
- Required validation or the definition of completion

Treat equivalent local implementation choices as non-material when they preserve the approved contract, follow project conventions, remain easy to reverse, and cannot change acceptance results or risk boundaries.

Do not aim for zero assumptions. Eliminate or disclose every material assumption. If a non-material choice later becomes material, record it as a new unknown and regress the affected gate.

## Risk Classification

### Low Risk

Assign `LOW` only when all conditions are true:

- The requirement is explicit and has one reasonable interpretation.
- The change stays inside one known ownership boundary.
- It does not change a public contract, data meaning, permission, state, persistence, or external side effect.
- It has no production-environment impact.
- It is easy to reverse.
- Its validation method is known.
- It has zero material unknowns.

### Medium Risk

Assign at least `MEDIUM` when any trigger applies:

- Change user-visible behavior.
- Cross module boundaries or affect multiple consumers.
- Change an internal interface, configuration, state flow, or persistence behavior.
- Introduce a dependency or extension point.
- Carry a compatibility expectation.
- Require human acceptance.
- Require multiple independently executable implementation tasks.

### High Risk

Assign `HIGH` when any trigger applies:

- Affect identity, permission, security, privacy, secrets, or tenancy.
- Migrate, delete, overwrite, or irreversibly transform data.
- Affect money, billing, compliance, or audit.
- Execute in production or cause an external-system side effect.
- Break a public API, schema, protocol, or compatibility promise.
- Introduce material multi-system consistency, concurrency, idempotency, or rollback risk.
- Risk significant data corruption or service interruption.
- Leave a material high-risk dimension unresolved.

Apply the highest matching risk. Reclassify when evidence changes. Never downgrade to reduce effort.

## Cross-Session Classification

Treat work as cross-session when any condition applies:

- The user requests staged work or later continuation.
- Progress must wait for a decision, acceptance, authorization, or external system.
- Work is handed to another agent or developer.
- A turn ends with planned tasks incomplete.
- State must remain useful outside the current conversation.
- The task enters `PAUSED`.

Do not classify work as cross-session only because it touches many files, takes time, or emits progress updates during one continuous execution.

## Gate 0: Direction

Require evidence for:

- Authoritative project direction or explicit user outcome
- Current milestone or delivery outcome
- Contribution of the current increment
- In-scope and out-of-scope behavior
- Applicable project invariants
- Conflicts with active requirements or priorities

Use `READY` only when the increment aligns with an authoritative direction and has no material directional conflict.

## Gate 1: Requirement

Require evidence for each applicable item:

- Active complete baseline and applicable amendments
- Requested outcome
- Scope and non-goals
- Actors or callers
- Observable acceptance criteria
- Permissions and access behavior
- State transitions and lifecycle
- User-visible feedback and errors
- Exceptional and empty scenarios
- Compatibility or migration expectations
- Required validation boundary

Use `READY` only when every material requirement has one confirmed meaning.

## Gate 2: Technical

Require technical evidence for:

- Owning module and entry point
- Current callers and downstream consumers
- Existing implementation path and dependencies
- Existing capability available for reuse
- Repository and local conventions
- Interface, service, persistence, configuration, and runtime boundaries
- Verification capability
- Smallest viable change boundary
- Cross-module and operational risks

Use implementation artifacts only to establish current technical facts. Use `READY` only when the affected path is closed and the implementation location, dependency direction, reuse decision, and affected consumers are known.

## Gate 3: Data And Contract

For every material item, confirm applicable dimensions:

| Dimension | Required technical or requirement evidence |
| --- | --- |
| Source and owner | Authoritative producer, storage, configuration, interface, or explicit requirement |
| Identity | Canonical key, uniqueness rule, and correlation identifiers |
| Shape | Type, structure, request/response, entity, schema, or signature |
| Presence | Required/optional rule, nullability, default, and empty behavior |
| Validation | Accepted values, bounds, format, and rejection behavior |
| Mapping | Enum, dictionary, transformation, serialization, display, and fallback |
| Lifecycle | Create, read, update, delete, transition, and version behavior |
| Side effects | Persistence, events, caches, files, tasks, notifications, and external calls |
| Security | Permission, role, tenancy, row scope, and sensitive-data behavior |
| Errors | Codes, exceptions, retries, partial failure, idempotency, and rollback |
| Consumers | Callers, UI, jobs, integrations, reports, and compatibility promises |
| Destination | Final persistence, response, display, event, file, or external system |

Use `READY` only when every material item is traced across its complete affected path.

## Gate 4: Development Contract

Require:

- Requirement and acceptance identifiers
- Ordered implementation tasks
- Requirement mapping for every task
- Affected artifacts
- Inputs, processing, outputs, and side effects
- Existing capability to reuse
- Dependencies and execution order
- Validation mapping and authorization
- Risk containment and rollback where applicable
- Zero undisclosed material assumptions

Use `READY` only when every task is executable without another material choice.

## Gate Status

Use:

- `READY`: the gate has sufficient evidence for the current risk and evidence boundary, with zero blocking unknowns.
- `BLOCKED`: evidence is missing, invalid, conflicting, or requires a material decision.
- `NOT_APPLICABLE`: the gate does not apply to the task mode; state the reason.

Do not report confidence percentages. `READY` means ready to advance within the declared evidence boundary, not universal certainty.

When new evidence invalidates a gate, set that gate and every dependent gate to `BLOCKED`, stop affected mutation, and return to the earliest affected discovery work.

## Workflow By Risk

### Low

- Evaluate all applicable gates compactly.
- Do not create tracking identifiers or a persistent ledger unless the task becomes cross-session.
- Treat the explicit change request as implementation authorization.

### Medium

- Produce the complete development contract.
- Use `REQ`, `TASK`, `AC`, and `VAL` identifiers.
- Obtain one explicit confirmation before development.
- Maintain a persistent process ledger.

### High

- Produce the complete development contract.
- Use identifiers and a persistent ledger.
- Define containment, rollback, external effects, and recovery.
- Obtain one explicit confirmation before development.
- Obtain separate authorization for operations that require it.

### Read Only

- Apply only the gates needed to support the answer.
- Report technical or runtime conclusions within the inspected evidence boundary.
- Do not create implementation artifacts or mutate the project.
- Allow a useful diagnosis even when an implementation gate would remain blocked.
