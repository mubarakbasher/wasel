# Append this to your existing CLAUDE.md

## Sub-Agent Routing

When a task arrives, the orchestrator delegates by layer. **Never let one agent cross layer boundaries** — always delegate.

| Task area | Agent |
|---|---|
| Flutter screens, widgets, Riverpod, GoRouter, Dio client | `flutter-mobile` |
| Express routes, controllers, services, Zod, JWT issuance, tier enforcement | `backend-api` |
| `radcheck` / `radreply` / `radacct` rows, CoA, WireGuard peers, RouterOS API | `radius-networking` |
| App-side schema migrations, indexes, Redis keys, query plans | `database-schema` |
| Jest/Vitest/flutter_test, integration tests, coverage | `test-writer` |
| Docker Compose, CI, VPS, FreeRADIUS container config | `devops-infra` |
| Pre-merge security review (auth, crypto, secrets) | `security-auditor` |
| Pre-merge cross-cutting architecture review | `code-reviewer` |

## Parallel Dispatch Rules

**Run in parallel** when tasks are in different layers and touch different files.
Example: backend endpoint + Flutter screen + test suite can all run at once.

**Run sequentially** when there's a data dependency:
- `database-schema` migration BEFORE `backend-api` endpoint that uses it
- `backend-api` endpoint BEFORE `flutter-mobile` screen that calls it
- Any RADIUS-touching work: `radius-networking` BEFORE `backend-api` wires it up

**Always run last:** `security-auditor` + `code-reviewer` in parallel, before merge.

## Feature workflow template

For any non-trivial feature, the orchestrator's plan should look like:

```
Phase 1 (sequential):
  - database-schema: migration + indexes
  - radius-networking: if RADIUS/WG/RouterOS involved

Phase 2 (parallel):
  - backend-api: endpoints + Zod schemas
  - flutter-mobile: screens + providers
  - test-writer: test suite for both

Phase 3 (parallel):
  - security-auditor: audit diff
  - code-reviewer: architecture review
```
