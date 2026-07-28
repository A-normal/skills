---
name: dev-workflow
description: Evidence-first, risk-tiered preparation and controlled execution for modular software development. Use before planning, adding, modifying, deleting, refactoring, integrating, migrating, or documenting modules, components, services, APIs, schemas, configurations, workflows, permissions, state transitions, or data mappings. Also use for read-only requirement, contract, data-flow, or implementation-impact analysis. Align the current delivery increment with authoritative requirements, separate requirement evidence from implementation evidence, eliminate undisclosed material assumptions, produce an approved development contract, execute it without scope drift, and preserve resumable evidence for medium/high-risk or cross-session work.
---

# Development Workflow

Prepare modular software work with evidence, then execute the approved plan without changing its meaning.

## Load References

- Read [references/gates.md](references/gates.md) for every planning or change task.
- Read [references/ledger.md](references/ledger.md) for medium/high-risk work, cross-session work, or any pause and resume.
- Read [references/outputs.md](references/outputs.md) when reporting a gate, development contract, progress, pause, verification, or delivery.
- Read [references/examples.md](references/examples.md) only when classification or workflow behavior is unclear.
- Do not read `README.md` as agent instructions or requirement evidence; it is user-facing documentation only.

## Establish Context

1. Discover and follow the active instruction hierarchy, repository rules, user constraints, and authorized operations.
2. Classify the request:
   - `READ_ONLY`: inspect, explain, review, diagnose, or analyze impact without mutation.
   - `PLANNING`: produce requirements, contracts, or an implementation plan without implementation.
   - `CHANGE`: prepare and implement an artifact change.
3. Trust the current user to make task decisions unless active project rules define an additional approval requirement.
4. Treat user decisions as requirement evidence, not as proof of technical facts.
5. Stop before mutation until the applicable preparation gates are ready and implementation is authorized.

## Separate Evidence Lanes

- Derive requirements only from the current user's explicit decisions, valid customer or product requirements, approved acceptance criteria, and active project rules.
- Never derive or complete requirements from code, configuration, schemas, runtime behavior, tests, README files, comments, examples, naming, or historical artifacts.
- Use code, configuration, schemas, runtime behavior, and tests only to establish current technical facts, constraints, impacts, and implementation options.
- When requirements are silent but the implementation has behavior, mark the requirement `UNKNOWN`; do not silently preserve, remove, or reinterpret that behavior.
- Record enough source precision to find every material conclusion again.

## Establish Effective Requirements

1. Identify the active complete requirement baseline.
2. Confirm that a requirement document is valid for the current scope; otherwise treat it as `CANDIDATE_REQUIREMENT`.
3. Apply approved change documents as amendments:
   - Add only explicit additions.
   - Replace only explicitly identified requirements.
   - Remove only explicitly deleted requirements.
   - Inherit every unmentioned baseline requirement.
4. Build a change matrix for ambiguous overlap and obtain a user decision before treating the overlap as resolved.
5. Consolidate a stable baseline after a large amendment when the project workflow permits it.

## Align Direction And Scope

1. Pass Gate 0 before classifying implementation risk.
2. Tie the task to the project direction, current milestone, or explicit user outcome.
3. Define the current deliverable increment, its non-goals, and applicable project invariants.
4. Require completeness only for the current increment. Leave future requirements unknown when they are explicitly out of scope and the current design does not decide them prematurely.
5. Treat a new request during execution as either:
   - a later increment when it does not affect the current contract; or
   - an amendment that regresses the affected gates when it changes the current contract.

## Classify Risk

Use the deterministic rules in [references/gates.md](references/gates.md):

- Assign `LOW` only when every low-risk condition is satisfied.
- Assign at least `MEDIUM` when any medium-risk trigger applies.
- Assign `HIGH` when any high-risk trigger applies.
- Let the highest trigger win.
- Reclassify when new evidence changes the risk.
- Do not lower risk to save time, tokens, or reporting effort.

## Investigate Iteratively

- Iterate among requirement, technical, and contract discovery; do not enforce a read-only waterfall.
- Let gates control readiness to plan or mutate, not the order in which evidence may be inspected.
- Ask the user only for decisions or unavailable authority. Discover technical facts from the environment whenever safe and possible.
- Trace the affected path from requirement to entry point, owning boundary, changed contract or state, consumers, destination, and validation.
- Stop expanding discovery when every affected material edge is explained and no unexplained edge can change the plan or acceptance result.
- Pause with a checkpoint when the investigation budget ends before the affected path closes; never pass a gate by shrinking the evidence boundary.

## Build The Development Contract

After Gates 0-3 are ready:

1. Split the current increment into ordered, independently executable tasks.
2. Assign lightweight `REQ`, `TASK`, `AC`, and `VAL` identifiers for medium/high-risk work.
3. Map every task to a requirement, every requirement to acceptance criteria, and every required acceptance criterion to a validation method.
4. Define affected artifacts, inputs, processing, outputs, side effects, reuse, dependencies, risks, containment or rollback, and authorization boundaries.
5. Ensure the plan introduces no undisclosed material assumption.
6. Pass Gate 4 only when the contract is executable without another material choice.

## Authorize Development

- For `LOW` risk, treat an explicit change request as implementation authorization after the compact gates are ready.
- For `MEDIUM` or `HIGH` risk, present the integrated development contract and obtain one explicit confirmation before entering `READY_TO_DEVELOP`.
- Do not request confirmation for every planned task after development is authorized.
- Treat builds, migrations, deployments, service starts, destructive operations, and external side effects as separately authorized when project or user rules require it.
- For `PLANNING`, stop after Gate 4 without mutation.

## Execute The Approved Contract

After `READY_TO_DEVELOP`:

1. Execute planned tasks in dependency order.
2. Make non-material implementation choices autonomously within project conventions and the approved boundary.
3. After each meaningful task, verify its acceptance mapping, record evidence, check for gate regression, and continue.
4. Avoid unrelated refactoring, cleanup, formatting, dependencies, compatibility behavior, or scope expansion.
5. Never modify requirements or weaken validation to make an implementation pass.
6. Classify failures:
   - Repair `IMPLEMENTATION_DEFECT` autonomously when the repair remains inside the approved contract.
   - Regress the affected gate for `PLAN_INVALIDATED` or `REQUIREMENT_CONFLICT`.
   - Pause for `ENVIRONMENT_FAILURE` or `UNAUTHORIZED_ACTION_REQUIRED`.
7. Report non-blocking progress without waiting for confirmation between tasks.

## Pause And Resume

- Pause when the user explicitly requests it, the environment changes materially, a budget limit is reached, a requirement changes, a material unknown appears, an authorization is missing, or a failure crosses the approved boundary.
- Stop starting new work immediately. If an active operation cannot stop safely, reach the nearest safe boundary and report its state.
- Create or update the resume checkpoint described in [references/ledger.md](references/ledger.md).
- Treat every paused task as cross-session work.
- On resume, reconcile the checkpoint with actual files, configuration, runtime, and external state; refresh drift-prone evidence; apply requirement amendments; rerun affected gates; and continue from the first incomplete valid task.
- Do not repeat an external side effect until its prior completion and idempotency are confirmed.
- Treat pause as neither cancellation nor automatic rollback.

## Verify And Complete

- Classify each validation layer as `REQUIRED` or `N/A`: static, automated runtime, integration, database, end-to-end, and human acceptance.
- Require human acceptance only when user interaction, visual behavior, business workflow, subjective quality, or otherwise non-automatable behavior makes it material.
- Derive status from evidence:
  - Use `VERIFICATION_PENDING` when implementation exists but required evidence is missing.
  - Use `VERIFICATION_FAILED` when required validation fails.
  - Use `VERIFIED` only when every required acceptance criterion has passing evidence.
- Never present static inspection as runtime verification.
- Deliver changed artifacts, requirement mapping, validation evidence, unverified items, side effects, risks, limitations, and required follow-up.

## Preserve Process State

- Maintain the process ledger for every medium/high-risk or cross-session increment.
- Mark the ledger as a non-authoritative process artifact; never use it as a requirement source.
- Synchronize it after every material decision, gate change, task result, validation result, side effect, pause, resume, cancellation, or delivery.
- Pause when a required ledger update fails.
- Treat ledger updates as outputs of the current workflow; do not recursively trigger a new workflow for them.
- Obtain authorization before creating the first repository-resident ledger when the current task does not already authorize it.

## Completion Rule

Declare the current increment complete only when:

- Gate 0 Direction: `READY`
- Gate 1 Requirement: `READY`
- Gate 2 Technical: `READY`
- Gate 3 Data And Contract: `READY`
- Gate 4 Development Contract: `READY`
- Material unknowns: `0`
- Required validation evidence: complete
- Execution status: `VERIFIED`

Otherwise report the exact non-terminal state and next action without claiming completion.
