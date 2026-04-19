# Wasel Sub-Agents — Setup & Usage

## Install

From your repo root:

```bash
# Copy the agents folder
cp -r claude-agents/.claude/agents ./.claude/

# Append the routing section to your existing CLAUDE.md
cat claude-agents/CLAUDE_MD_ADDITION.md >> CLAUDE.md
```

Then restart Claude Code. Verify with:

```
/agents
```

You should see: `flutter-mobile`, `backend-api`, `radius-networking`, `database-schema`, `security-auditor`, `test-writer`, `devops-infra`, `code-reviewer`.

## Cost optimization

Run the orchestrator (main session) on Opus, workers on Sonnet:

```bash
export CLAUDE_CODE_SUBAGENT_MODEL="claude-sonnet-4-6"
```

The `security-auditor`, `radius-networking`, and `code-reviewer` agents pin themselves to Opus in their YAML — leave those alone, their reasoning quality matters more than cost.

## Optional: Agent Teams mode

If you want the agents to message each other mid-task (e.g. backend-api asks radius-networking a question without round-tripping through the orchestrator):

```bash
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
claude
```

## Example prompts

### Small feature — add "set voucher expiry" field
```
Add a voucher expiry field end-to-end.

Phase 1 — database-schema:
  Add expires_at timestamptz to voucher_batches.
  Add Expiration attribute to radreply on voucher insert path.

Phase 2 (parallel):
  - radius-networking: make sure voucher insert writes Expiration
    correctly and expired vouchers get Auth-Type := Reject
  - backend-api: accept optional expiresAt on POST /routers/:id/vouchers,
    validate it's future, pass to voucher service
  - flutter-mobile: add date picker to voucher create screen,
    display expiry on voucher card
  - test-writer: integration test proving expired voucher auth fails

Phase 3 (parallel):
  - security-auditor + code-reviewer on the full diff
```

### Big feature — session disconnect from the app
```
Implement "disconnect session" from the Sessions screen.

Step 1 — radius-networking:
  Add CoA Disconnect helper that takes router_id + session id,
  looks up WG IP, sends Disconnect-Request with the right secret,
  returns success/failure. Unit tests with a mock CoA server.

Step 2 (parallel):
  - backend-api: POST /routers/:id/sessions/:sessionId/disconnect,
    tier-checked (any tier allowed), audit-logged
  - flutter-mobile: disconnect button on session row with
    confirmation dialog, optimistic UI + rollback on failure
  - test-writer: full integration test end-to-end

Step 3: security-auditor + code-reviewer in parallel.
```

### Research / exploration (no code changes)
```
I'm seeing some routers flip between "degraded" and "online" every minute.
Use 3 sub-agents in parallel to investigate:

  - radius-networking: check if WG handshake interval or API timeout
    tuning could cause this
  - backend-api: review the status-computation code and any caching
  - database-schema: check if there's a race in how status is stored

Each reports findings, don't modify code yet.
```

## When parallel dispatch goes wrong

- **Two agents edit the same file** → move one to a different phase, or split by folder
- **Flutter model doesn't match backend response** → you skipped the contract step; let backend-api finish, then hand the final schema to flutter-mobile
- **Reviews contradict each other** → orchestrator arbitrates; security-auditor wins on security topics, code-reviewer wins on architecture

## Iteration

These agents are a starting point. After 2-3 weeks of use, revisit each file and:
- Delete rules that never fired
- Add rules for mistakes you kept catching in review
- Tighten `description` fields if an agent keeps getting picked for wrong tasks

The `description` field is what the orchestrator matches against — rewrite it based on how you actually delegate.
