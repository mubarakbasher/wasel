# Card Speed Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator switch on one speed limit that is stamped on every card created afterwards, and tell them so in the create-card wizard.

**Architecture:** The setting is two columns on the operator's existing `user_print_settings` row, exposed through its own `/settings/card-speed` resource so no print-settings save can touch it. At creation the backend reads the setting in the same single query that already reads code length, stamps the speed on `voucher_meta`, and writes one per-card `radreply` row `Mikrotik-Rate-Limit := <s>/<s>`. The app gets a separate small model/service/provider, a section on the Voucher Printing screen, and a notice strip in the wizard's fixed bottom bar.

**Tech Stack:** PostgreSQL 16, Node/Express/TypeScript, Zod 4, Vitest + Supertest; Flutter, Riverpod (`StateNotifier`), Dio, flutter_test.

**Spec:** `docs/superpowers/specs/2026-11-16-card-speed-limit-design.md` (read it first; this plan argues from it).

## Global Constraints

- Work on `dev`; deploy to staging (`wa-sel.cloud`) only. Never touch `main` or prod.
- Migrations are append-only: never edit `043_user_print_settings.sql`; the new file is `047_card_speed_limit.sql`.
- Wire values for speeds are exactly `256k`, `512k`, `1M`, `2M`, `3M`, `4M`, `5M`, `10M` (lowercase `k`, uppercase `M`). Default `2M`. Format regex `^[1-9][0-9]{0,3}[kM]$`.
- The RADIUS row is exactly `(username, 'Mikrotik-Rate-Limit', ':=', '<s>/<s>')`, e.g. `1M/1M`. A wrong attribute name or operator makes that card fail to log in.
- `createVouchers` may issue exactly ONE `pool.query` for settings (tests index the mock queue, e.g. `mockQuery.mock.calls[6]`).
- The new radreply row is pushed LAST per card (existing tests assert row positions).
- Existing cards are never touched. No FreeRADIUS, dictionary, Docker or router-setup-script change.
- `upsertPrintSettings` and `printSettingsSchema` are not modified.
- Flutter widget tests pump with `theme: AppTheme.light`. Mobile CI runs `dart analyze --fatal-infos`.
- Do not regenerate any `package-lock.json`. No new dependencies.
- No per-task commits: the owner wants few, large commits. Commits happen in Task 7.

## Review Focus

Conditions the spec implies that are most likely to bite an operator; each has a pinned test in the task named.

1. **A stored speed that is no longer in the option list** (e.g. `8M` after the list changes): GET returns it unchanged, creation still applies `8M/8M`, the app shows it with no chip selected and does not crash. → Tasks 2, 3, 5.
2. **The wizard opens while the setting cannot be loaded** (offline, slow, older backend): no strip, no Speed row, creation still works, and the success dialog still shows the speed the server applied. → Task 6.
3. **Cards without a speed** (created before the feature, or a response with no `speedLimit` key): no Speed row anywhere, no crash. → Tasks 3, 6.
4. **Off then on again:** switching off keeps the chosen speed stored, so switching on shows the last speed, not 2M. → Tasks 2, 5.
5. **Largest batch:** 3000 data cards over 4 GB with validity and the limit on builds one radreply INSERT of 48,000 parameters. → Task 3.

## File Structure

| File | Responsibility |
|---|---|
| `backend/src/migrations/sql/047_card_speed_limit.sql` (new) | The three columns and the CHECK |
| `backend/src/utils/radius.ts` (modify) | `SPEED_VALUE_RE`, `buildSymmetricRateLimit` |
| `backend/src/validators/cardSpeed.validators.ts` (new) | Option list, default, PUT schema, types |
| `backend/src/services/cardSettings.service.ts` (new) | Read/write the speed setting; the one creation-time settings lookup |
| `backend/src/controllers/cardSpeed.controller.ts`, `backend/src/routes/cardSpeed.routes.ts` (new) | `GET/PUT /settings/card-speed` |
| `backend/src/routes/index.ts` (modify) | Mount the routes under `/settings` |
| `backend/src/services/printSettings.service.ts` (modify) | Remove `getCodeLength` |
| `backend/src/services/voucher.service.ts` (modify) | Apply the speed at creation; `speedLimit` in the DTO; code-taken SQL |
| `backend/src/utils/errorCodes.ts` (modify) | `CARD_SETTINGS_UNAVAILABLE` |
| `mobile/lib/models/card_speed_setting.dart`, `mobile/lib/services/card_speed_service.dart`, `mobile/lib/providers/card_speed_provider.dart` (new) | The setting on the app side |
| `mobile/lib/providers/auth_provider.dart` (modify) | Reset on logout |
| `mobile/lib/i18n/voucher_format.dart`, `mobile/lib/i18n/app_localizations.dart` (modify) | `localizedSpeedText`, strings |
| `mobile/lib/screens/settings/voucher_printing_screen.dart` (modify) | Card speed section |
| `mobile/lib/models/voucher.dart`, `mobile/lib/screens/vouchers/create_voucher_wizard.dart`, `mobile/lib/screens/vouchers/voucher_detail_screen.dart` (modify) | `speedLimit`, wizard row/strip/dialog, details row |

---

### Task 1: Migration 047

**Files:**
- Create: `backend/src/migrations/sql/047_card_speed_limit.sql`

**Interfaces:**
- Produces: `user_print_settings.speed_limit_enabled BOOLEAN NOT NULL DEFAULT false`, `user_print_settings.speed_limit VARCHAR(8) NOT NULL DEFAULT '2M'`, `voucher_meta.speed_limit VARCHAR(8)` (nullable).

- [ ] **Step 1: Write the migration**, following 043's style (header comment, idempotent statements, no down file):

```sql
ALTER TABLE user_print_settings ADD COLUMN IF NOT EXISTS speed_limit_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE user_print_settings ADD COLUMN IF NOT EXISTS speed_limit VARCHAR(8) NOT NULL DEFAULT '2M';

ALTER TABLE user_print_settings DROP CONSTRAINT IF EXISTS user_print_settings_speed_limit_check;
ALTER TABLE user_print_settings ADD CONSTRAINT user_print_settings_speed_limit_check
    CHECK (speed_limit ~ '^[1-9][0-9]{0,3}[kM]$');

-- Nullable, no default, no CHECK: catalog-only on a multi-million-row table.
ALTER TABLE voucher_meta ADD COLUMN IF NOT EXISTS speed_limit VARCHAR(8);
```

The header comment must say why a network speed setting lives on the print-settings row (creation reads code length and speed in one query) and that the option list is deliberately not in the CHECK.

- [ ] **Step 2: Apply it on the dev stack and verify**

Run: `docker compose -f docker-compose.dev.yml up -d`, then start the backend once (`cd backend && npm run dev`) so the runner applies 047, then:
`docker compose -f docker-compose.dev.yml exec postgres psql -U <dev user> -d <dev db> -c "\d user_print_settings" -c "\d voucher_meta" -c "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1"`
Expected: both new `user_print_settings` columns with their defaults, the named CHECK, `voucher_meta.speed_limit` nullable, latest migration 047. (Take the dev user/db names from the root `.env` / compose file; do not print secrets.)

- [ ] **Step 3: Verify the CHECK pattern**

Run in psql against dev: `SELECT '256K' ~ '^[1-9][0-9]{0,3}[kM]$' AS upper_k, '1M/1M' ~ '^[1-9][0-9]{0,3}[kM]$' AS pair, '10M' ~ '^[1-9][0-9]{0,3}[kM]$' AS ok;`
Expected: `f | f | t`. The constraint itself is exercised against real rows by the integration test in Task 2.

---

### Task 2: Speed setting API

**Files:**
- Modify: `backend/src/utils/radius.ts`
- Create: `backend/src/validators/cardSpeed.validators.ts`, `backend/src/services/cardSettings.service.ts`, `backend/src/controllers/cardSpeed.controller.ts`, `backend/src/routes/cardSpeed.routes.ts`
- Modify: `backend/src/routes/index.ts` (next to `router.use('/settings', printSettingsRoutes)` at line 108)
- Test: `backend/src/tests/cardSpeed.test.ts` (new), `backend/src/tests/cardSpeed.integration.test.ts` (new, opt-in)

**Interfaces:**
- Consumes: Task 1 columns.
- Produces:
  - `utils/radius.ts`: `export const SPEED_VALUE_RE = /^[1-9][0-9]{0,3}[kM]$/;` and `export function buildSymmetricRateLimit(speed: string): string` (returns `` `${speed}/${speed}` ``; throws `Error` when `speed` fails `SPEED_VALUE_RE`).
  - `validators/cardSpeed.validators.ts`: `SPEED_LIMIT_OPTIONS` (`as const`, the eight values in order), `DEFAULT_SPEED_LIMIT = '2M'`, `cardSpeedUpdateSchema = z.object({ enabled: z.boolean(), speed: z.enum(SPEED_LIMIT_OPTIONS) }).strict()`, `type CardSpeedUpdate`, `interface CardSpeedSetting { enabled: boolean; speed: string; options: readonly string[] }`.
  - `services/cardSettings.service.ts`:
    - `export const CARD_SPEED_UPSERT_SQL` (exported so the integration test runs the same text)
    - `getCardSpeedSetting(userId: string): Promise<CardSpeedSetting>`
    - `upsertCardSpeedSetting(userId: string, input: CardSpeedUpdate): Promise<CardSpeedSetting>`
  - HTTP: `GET /api/v1/settings/card-speed` and `PUT /api/v1/settings/card-speed`, both `authenticate`; PUT adds `validate({ body: cardSpeedUpdateSchema })`. Responses `200 { success: true, data: CardSpeedSetting }`.

- [ ] **Step 1: Write the failing tests** in `cardSpeed.test.ts` (same harness as `printSettings.test.ts`: `__mockPoolQuery`, `authHeader()`):

```ts
describe('buildSymmetricRateLimit', () => {
  it.each([['1M', '1M/1M'], ['256k', '256k/256k'], ['10M', '10M/10M']])('%s -> %s', (s, out) => {
    expect(buildSymmetricRateLimit(s)).toBe(out);
  });
  it.each(['256K', '1M/1M', '0M', '', '1m', '12345M'])('throws on %s', (s) => {
    expect(() => buildSymmetricRateLimit(s)).toThrow();
  });
});

describe('GET /api/v1/settings/card-speed', () => {
  it('401 without auth');
  it('returns off, 2M and the eight options when no row exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // expect res.body.data toEqual { enabled: false, speed: '2M', options: [...SPEED_LIMIT_OPTIONS] }
  });
  it('returns the stored row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ speed_limit_enabled: true, speed_limit: '1M' }] });
    // data.enabled === true, data.speed === '1M'
  });
  it('returns a stored speed that is not in the option list unchanged', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ speed_limit_enabled: true, speed_limit: '8M' }] });
    // data.speed === '8M'
  });
  it('selects by the authenticated user id', /* params[0] === TEST_USER.userId */);
});

describe('PUT /api/v1/settings/card-speed', () => {
  it('401 without auth');
  it('upserts only the speed columns and returns the saved value', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ speed_limit_enabled: true, speed_limit: '1M' }] });
    // send { enabled: true, speed: '1M' } -> 200, data { enabled: true, speed: '1M', options }
    // expect(mockQuery).toHaveBeenCalledOnce()
    // const [sql, params] = mockQuery.mock.calls[0]
    // sql matches /ON CONFLICT \(user_id\)/ and /RETURNING\s+speed_limit_enabled,\s*speed_limit/
    // sql does NOT match /code_length|template_id|default_columns|knobs/
    // params toEqual [TEST_USER.userId, true, '1M']
  });
  it('stores the speed when switching off, so it is remembered', /* send { enabled: false, speed: '5M' } -> params [id, false, '5M'] */);
  it.each([
    { enabled: true, speed: '9M' }, { enabled: true, speed: '256K' }, { enabled: true, speed: '1M/1M' },
    { enabled: true, speed: null }, { enabled: true }, { speed: '1M' },
    { enabled: 'yes', speed: '1M' }, { enabled: true, speed: '1M', extra: 1 },
  ])('400 VALIDATION_ERROR for %j and issues no query');
});

describe('print settings stay separate', () => {
  it('PUT /settings/print never names the speed columns', async () => {
    // queue the row mock as printSettings.test.ts does, PUT DEFAULT_PRINT_SETTINGS
    // expect(mockQuery.mock.calls[0][0]).not.toMatch(/speed_limit/)
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run src/tests/cardSpeed.test.ts`
Expected: FAIL (modules not found / 404).

- [ ] **Step 3: Implement** the files listed under Interfaces.
  - `getCardSpeedSetting`: `SELECT speed_limit_enabled, speed_limit FROM user_print_settings WHERE user_id = $1`; no row → `{ enabled: false, speed: DEFAULT_SPEED_LIMIT }`; always adds `options: SPEED_LIMIT_OPTIONS`. Log and rethrow on error, as `getPrintSettings` does.
  - `CARD_SPEED_UPSERT_SQL`: `INSERT INTO user_print_settings (user_id, speed_limit_enabled, speed_limit) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET speed_limit_enabled = EXCLUDED.speed_limit_enabled, speed_limit = EXCLUDED.speed_limit, updated_at = NOW() RETURNING speed_limit_enabled, speed_limit`.
  - Controller mirrors `printSettings.controller.ts` (`req.user!.id`, `next(error)`).

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && npx vitest run src/tests/cardSpeed.test.ts src/tests/printSettings.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the opt-in real-PostgreSQL test** `cardSpeed.integration.test.ts`, copying the guard and schema handling of `voucherCodeReuse.integration.test.ts` (`VOUCHER_PG_INTEGRATION=1` + `INTEGRATION_DATABASE_URL`, localhost only, run-unique schema dropped in `afterAll`, `vi.importActual('pg')`). In the schema create a minimal `user_print_settings` with 043's columns and defaults (no FK, no trigger), then execute the `user_print_settings` statements of `047_card_speed_limit.sql` read from disk. Cases:
  - upsert on an empty table creates a row with `code_length 8`, `template_id 'classic'` and the given speed;
  - upsert on a row that has `code_length 10`, `knobs {"showPrice":true}` changes only the two speed columns;
  - the print-settings upsert statement (copy its SQL text from `printSettings.service.ts`) run on a row with the limit on leaves `speed_limit_enabled = true` and `speed_limit` unchanged;
  - direct `UPDATE ... SET speed_limit = '1M/1M'` and `'256K'` are rejected by `user_print_settings_speed_limit_check`.

- [ ] **Step 6: Run it against the dev database**

Run: `cd backend && VOUCHER_PG_INTEGRATION=1 INTEGRATION_DATABASE_URL=<dev url on 127.0.0.1:5436> npx vitest run src/tests/cardSpeed.integration.test.ts`
Expected: PASS. Without the env vars the file reports skipped.

---

### Task 3: Card creation applies the speed

**Files:**
- Modify: `backend/src/services/cardSettings.service.ts` (add the creation lookup)
- Modify: `backend/src/services/printSettings.service.ts` (delete `getCodeLength`, lines 117-140, and the now-unused `DEFAULT_CODE_LENGTH` import if nothing else uses it)
- Modify: `backend/src/services/voucher.service.ts` (`VoucherMetaRow` 14-29, `VoucherInfo` 31-55, `VOUCHER_CODE_TAKEN_SQL` 128-142, `assembleVoucherInfo` 382-404, `insertRadiusEntriesV2` 490-567, `createVouchers` 574-774)
- Modify: `backend/src/utils/errorCodes.ts`
- Test: `backend/src/tests/cardSpeed.test.ts`, `backend/src/tests/voucher.test.ts`, `backend/src/tests/printSettings.test.ts`, `backend/src/tests/voucherCodeReuse.integration.test.ts`

**Interfaces:**
- Consumes: `SPEED_VALUE_RE`, `buildSymmetricRateLimit`, `DEFAULT_CODE_LENGTH`.
- Produces:
  - `cardSettings.service.ts`: `interface CardCreationSettings { codeLength: number; speedLimit: string | null }`, `export const CARD_CREATION_SETTINGS_SQL`, `getCardCreationSettings(userId: string): Promise<CardCreationSettings>`.
  - `ErrorCodes.CARD_SETTINGS_UNAVAILABLE = 'CARD_SETTINGS_UNAVAILABLE'`.
  - `VoucherMetaRow.speed_limit?: string | null`; `VoucherInfo.speedLimit: string | null` on every card response (create, list, detail, update, admin).

- [ ] **Step 1: Write the failing unit tests for the lookup** in `cardSpeed.test.ts`:

```ts
describe('getCardCreationSettings', () => {
  it('no row -> { codeLength: 8, speedLimit: null }');
  it('limit off -> speedLimit null', /* row { code_length: 10, speed_limit_enabled: false, speed_limit: '1M' } -> { codeLength: 10, speedLimit: null } */);
  it('limit on -> the stored speed', /* enabled true, '1M' -> speedLimit '1M' */);
  it('limit on with a speed outside the option list still applies it', /* '8M' -> '8M' */);
  it('row without the speed columns reads as off', /* { code_length: 8 } -> speedLimit null */);
  it('limit on with a malformed stored speed throws 503 CARD_SETTINGS_UNAVAILABLE', /* '1M/1M' */);
  it('query error throws 503 CARD_SETTINGS_UNAVAILABLE', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    await expect(getCardCreationSettings('u')).rejects.toMatchObject({ statusCode: 503, code: 'CARD_SETTINGS_UNAVAILABLE' });
  });
  it('is one query that selects all three columns', () => {
    expect(CARD_CREATION_SETTINGS_SQL).toMatch(/code_length/);
    expect(CARD_CREATION_SETTINGS_SQL).toMatch(/speed_limit_enabled/);
    expect(CARD_CREATION_SETTINGS_SQL).toMatch(/speed_limit\b/);
    // and after a call: expect(mockQuery).toHaveBeenCalledOnce()
  });
});
```

(Use the `AppError` property names as they exist in `middleware/errorHandler.ts`.)

- [ ] **Step 2: Update `voucher.test.ts`**
  - `mockPrintSettingsQuery(mq, len = DEFAULT_CODE_LENGTH, speed: { enabled: boolean; speed: string } = { enabled: false, speed: '2M' })` returns `{ code_length, speed_limit_enabled, speed_limit }`.
  - Replace the describe at 482-529 with `'card settings unavailable'`: same setup, the settings query rejects, expect `503`, `res.body.error.code === 'CARD_SETTINGS_UNAVAILABLE'`, and `expect(mockClientQuery).not.toHaveBeenCalled()`.
  - Add `describe('POST … — speed limit')` using the existing success test (172-215) as the template:

```ts
it('limit on, time card without validity: stamps voucher_meta and writes one Mikrotik-Rate-Limit row', async () => {
  // mockPrintSettingsQuery(mockQuery, 8, { enabled: true, speed: '1M' })
  // client queue gains one slot: BEGIN, UPDATE subscriptions, INSERT voucher_meta (row { ...MOCK_VOUCHER_ROW, speed_limit: '1M' }),
  //   INSERT radcheck, INSERT radreply, SAVEPOINT, INSERT analytics, RELEASE, COMMIT
  // voucher_meta call: SQL matches /speed_limit/; params[8] === '1M' (9 params per row)
  // radreply call: params toEqual [<code>, 'Mikrotik-Rate-Limit', ':=', '1M/1M']
  // res.status 201; res.body.data[0].speedLimit === '1M'
});
it('limit on, data card over 4 GB with validity: four rows per card, rate limit last', async () => {
  // body { limitType: 'data', limitValue: 5, limitUnit: 'GB', validitySeconds: 86400, count: 1, price: 5 }, speed '256k'
  // attributes in radreply params, in order: Session-Timeout, Mikrotik-Total-Limit, Mikrotik-Total-Limit-Gigawords, Mikrotik-Rate-Limit
  // last value === '256k/256k'
});
it('limit off: no Mikrotik-Rate-Limit anywhere and speed_limit is null', async () => {
  // no client call's params include 'Mikrotik-Rate-Limit'; voucher_meta params[8] === null; data[0].speedLimit === null
});
it('ignores a speedLimit sent by the client', async () => {
  // body { ...validBody, speedLimit: '10M' } with the limit off -> same assertions as the previous test
});
it('3000 data cards over 4 GB with validity and the limit on build one 48,000-parameter radreply INSERT', async () => {
  // count 3000; INSERT voucher_meta mock returns 3000 rows; radreply params length === 48000
});
it('a card whose voucher_meta row has no speed_limit reports speedLimit null', /* GET /:vid with MOCK_VOUCHER_ROW */);
it('VOUCHER_CODE_TAKEN_SQL also checks radreply', () => { expect(VOUCHER_CODE_TAKEN_SQL).toMatch(/radreply/); });
```

  - In `printSettings.test.ts` remove the `getCodeLength` import (line 6) and its describe (261-288); those cases now live in `cardSpeed.test.ts`.

- [ ] **Step 3: Run to verify they fail**

Run: `cd backend && npx vitest run src/tests/cardSpeed.test.ts src/tests/voucher.test.ts`
Expected: FAIL (missing export, 201 instead of 503, no rate-limit row).

- [ ] **Step 4: Implement**
  - `getCardCreationSettings`: one `pool.query(CARD_CREATION_SETTINGS_SQL, [userId])` with `SELECT code_length, speed_limit_enabled, speed_limit FROM user_print_settings WHERE user_id = $1`. No row → defaults, off. `speed_limit_enabled !== true` → `speedLimit: null`. Enabled and `SPEED_VALUE_RE` fails → log and throw. Query error → log and throw. Both throws: `new AppError(503, 'Card settings are temporarily unavailable. Please try again.', 'CARD_SETTINGS_UNAVAILABLE')`. Its doc comment states that this deliberately replaces the 2026-11-10 fail-open: a silently unlimited batch cannot be repaired.
  - `createVouchers`: replace line 598 with the new lookup; compute `const rateLimitValue = speedLimit ? buildSymmetricRateLimit(speedLimit) : null;` once, beside `normalizedValue`. Add `speed_limit` as the last column and a ninth parameter per row in the `voucher_meta` INSERT. In the radreply loop push `(cred.username, 'Mikrotik-Rate-Limit', ':=', rateLimitValue)` after the data-limit rows when `rateLimitValue` is set. Leave the `rrPlaceholders.length > 0` guard as is. Update the block comment (706-713) and add `speedLimit` to the "Vouchers created" log.
  - `insertRadiusEntriesV2`: add a trailing parameter `speedLimit: string | null` and the same row at the end.
  - `assembleVoucherInfo`: `speedLimit: row.speed_limit ?? null`.
  - `VOUCHER_CODE_TAKEN_SQL`: add `UNION SELECT username FROM radreply WHERE username = ANY($1::text[])` and one sentence to its comment (a leftover reply row would be inherited by the new card; `radreply_username_idx` serves it).
  - `voucherCodeReuse.integration.test.ts`: create a `radreply` table in its run-unique schema and add a "radreply-only code is reported taken" case, or the existing cases break on the missing table.

- [ ] **Step 5: Run the whole backend suite**

Run: `cd backend && npx tsc --noEmit && npm run lint && npx vitest run`
Expected: all pass. `errorCodes.contract.test.ts` passes because the new code is declared.

---

### Task 4: App model, service, provider and logout reset

**Files:**
- Create: `mobile/lib/models/card_speed_setting.dart`, `mobile/lib/services/card_speed_service.dart`, `mobile/lib/providers/card_speed_provider.dart`
- Modify: `mobile/lib/providers/auth_provider.dart` (`_resetUserScopedProviders`, 115-140)
- Test: `mobile/test/models/card_speed_setting_test.dart`, `mobile/test/providers/card_speed_provider_test.dart` (new)

**Interfaces:**
- Consumes: `GET/PUT /settings/card-speed` (Task 2 shape).
- Produces:

```dart
class CardSpeedSetting {
  final bool enabled;
  final String speed;          // wire value, e.g. '1M'
  final List<String> options;  // wire values from the server, in order
  const CardSpeedSetting({this.enabled = false, this.speed = '2M', this.options = const []});
  factory CardSpeedSetting.fromJson(Map<String, dynamic> json); // wrong or missing types fall back to defaults, never throws
  CardSpeedSetting copyWith({bool? enabled, String? speed});
}

class CardSpeedService {
  Future<CardSpeedSetting?> fetch();   // null when the server answers 404 (backend without the feature)
  Future<CardSpeedSetting> update({required bool enabled, required String speed});
}

class CardSpeedState {
  final CardSpeedSetting? setting;
  final bool isLoading;
  final bool unavailable;      // true after a 404
  final String? error;
}

class CardSpeedNotifier extends StateNotifier<CardSpeedState> {
  CardSpeedNotifier({CardSpeedService? service});
  Future<void> load();   // always fetches; never throws
  Future<void> save({required bool enabled, required String speed}); // optimistic; never throws
  void reset();
}

final cardSpeedProvider = StateNotifierProvider<CardSpeedNotifier, CardSpeedState>((ref) => CardSpeedNotifier());
```

- [ ] **Step 1: Write the failing tests** (a hand-written fake `CardSpeedService` with completers so order can be controlled):

```dart
// card_speed_setting_test.dart
test('fromJson reads enabled, speed and options');
test('fromJson falls back on wrong types', () {
  final s = CardSpeedSetting.fromJson({'enabled': 'yes', 'speed': 5, 'options': 'x'});
  expect(s.enabled, false); expect(s.speed, '2M'); expect(s.options, isEmpty);
});
test('fromJson keeps a speed that is not in options', /* speed '8M' kept */);

// card_speed_provider_test.dart
test('load publishes the fetched setting');
test('load on 404 sets unavailable and no setting');
test('load failure sets error and keeps the previous setting');
test('save applies optimistically, then the server value');
test('save failure rolls back to the last server-confirmed value and sets error');
test('two overlapping failed saves end on the confirmed value, not an optimistic one', () async {
  // confirmed: off/2M. save(on, 2M) and save(on, 1M) both fail -> state.setting is off/2M
});
test('saves reach the server in call order', /* service receives (true,'2M') then (true,'1M') */);
test('a fetch that a save overtook is discarded', () async {
  // start load() (fetch pending, would return off/2M), then save(on,'1M') completes, then the fetch completes
  // -> state.setting.enabled is true and speed '1M'
});
test('reset clears setting, error and unavailable');
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd mobile && flutter test test/models/card_speed_setting_test.dart test/providers/card_speed_provider_test.dart`
Expected: FAIL (files do not exist).

- [ ] **Step 3: Implement.** The notifier keeps the last server-confirmed setting and a monotonically increasing edit counter; saves run through one private async queue (do not reuse `_renderLock` from `print_settings_provider.dart`); a save response is applied only when no newer save is queued; `load()` drops its result if the counter moved while it was fetching. Errors go through `errorToDisplay` (`utils/error_messages.dart`). The service uses `ApiClient().dio` like `PrintSettingsService` and maps a `DioException` with status 404 to `null`. No secure-storage cache: the wizard and the screen both need the network anyway.

- [ ] **Step 4: Add both resets to `_resetUserScopedProviders`**: `printSettingsProvider.notifier.reset()` (missing today) and `cardSpeedProvider.notifier.reset()`, each inside `safeReset`. Extend the existing logout test for user-scoped providers if there is one under `mobile/test/providers/`; otherwise add `test('logout clears print settings and card speed state')`.

- [ ] **Step 5: Run to verify they pass**

Run: `cd mobile && dart analyze --fatal-infos && flutter test test/models test/providers`
Expected: PASS, no analyzer issues.

---

### Task 5: Voucher Printing screen section, labels and strings

**Files:**
- Modify: `mobile/lib/i18n/voucher_format.dart`, `mobile/lib/i18n/app_localizations.dart` (both `_en` and `_ar`)
- Modify: `mobile/lib/screens/settings/voucher_printing_screen.dart` (`initState` 33-42, `build` children 131-132)
- Test: `mobile/test/i18n/voucher_format_test.dart`, `mobile/test/screens/voucher_printing_screen_test.dart`, `mobile/test/i18n/backend_error_codes_test.dart`

**Interfaces:**
- Consumes: `cardSpeedProvider`, `CardSpeedSetting` (Task 4).
- Produces:
  - `String localizedSpeedText(BuildContext c, String wire)` in `voucher_format.dart`: `'1M'` → `speed.mega` with `1`; `'256k'` → `speed.kilo` with `256`; a symmetric pair such as `'1M/1M'` is treated as `'1M'`; anything else is returned unchanged.
  - Widget keys: `Key('cardSpeedSwitch')`, `Key('cardSpeedChip_<wire>')`, `Key('cardSpeedCaption')`.
  - Strings (all later tasks use these keys):

| Key | English | Arabic |
|---|---|---|
| `speed.mega` | `{0}M` | `{0} ميجا` |
| `speed.kilo` | `{0}K` | `{0} كيلو` |
| `settings.cardSpeed` | `Card Speed` | `سرعة الكروت` |
| `settings.limitCardSpeed` | `Limit card speed` | `تحديد سرعة الكروت` |
| `settings.limitCardSpeedHint` | `Applies to new cards only. Cards already created keep their speed.` | `يُطبَّق على الكروت الجديدة فقط. الكروت المُنشأة سابقاً تبقى كما هي.` |
| `settings.cardSpeedCaption` | `Download and upload: {0} each` | `التحميل والرفع: {0} لكل منهما` |
| `vouchers.speed` | `Speed` | `السرعة` |
| `vouchers.speedLimitNotice` | `Speed limit is on: these cards will be limited to {0}.` | `تحديد السرعة مفعّل: هذه الكروت ستكون محدودة بسرعة {0}.` |
| `vouchers.speedLimitChange` | `Change` | `تغيير` |
| `error.CARD_SETTINGS_UNAVAILABLE` | `Couldn't read your card settings. Please try again.` | `تعذّرت قراءة إعدادات الكروت. حاول مرة أخرى.` |

  Also change `settings.voucherPrintingSubtitle` to `Templates, code length, speed limit` and extend the Arabic line the same way.

- [ ] **Step 1: Write the failing tests**

```dart
// voucher_format_test.dart (use the file's existing pump helper for en and ar)
testWidgets('localizedSpeedText en', /* '1M' -> '1M', '256k' -> '256K', '1M/1M' -> '1M', '1M/2M' -> '1M/2M', 'fast' -> 'fast' */);
testWidgets('localizedSpeedText ar', /* '1M' -> '1 ميجا', '256k' -> '256 كيلو' */);

// voucher_printing_screen_test.dart — add a fake CardSpeedNotifier (records save() calls, load() is a no-op)
// and override cardSpeedProvider in EVERY existing pump of this screen so no test hits the network.
testWidgets('speed section is hidden when the backend does not offer it', /* unavailable: true -> find.byKey(Key('cardSpeedSwitch')) findsNothing */);
testWidgets('limit off shows the switch and no chips');
testWidgets('limit on shows one chip per server option with the saved speed selected and the caption', /* 8 chips; chip 2M selected; caption contains '2M' */);
testWidgets('a saved speed that is not an option selects no chip and still shows in the caption', /* speed '8M' */);
testWidgets('tapping a chip saves enabled true with that speed', /* tap cardSpeedChip_1M -> save(enabled: true, speed: '1M') */);
testWidgets('switching on sends the remembered speed', /* setting off/'5M' -> tap switch -> save(enabled: true, speed: '5M') */);
testWidgets('switching off sends the current speed', /* on/'1M' -> save(enabled: false, speed: '1M') */);
testWidgets('lays out at 320 px wide in Arabic without overflow', /* as create_voucher_wizard_test.dart 296-341 does: Cairo font, 320x569, locale ar */);
```

  In `backend_error_codes_test.dart` raise the ratchet at line ~113 from 85 to 86. That test reads `backend/src/utils/errorCodes.ts`; it passes once Task 3 is in the tree.

- [ ] **Step 2: Run to verify they fail**

Run: `cd mobile && flutter test test/i18n/voucher_format_test.dart test/screens/voucher_printing_screen_test.dart`
Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `initState`: inside the existing microtask also call `ref.read(cardSpeedProvider.notifier).load()` unconditionally.
  - `_buildSpeedLimitSection(CardSpeedState cs)` goes right after `_buildCodeLengthSection` in the list. Render nothing when `cs.unavailable`, or when `cs.setting == null` and there is no error. When `cs.setting == null` with an error: `SectionHeader` + `InlineErrorBanner` + a retry `TextButton` (`common.retry`) calling `load()`.
  - Otherwise: `SectionHeader(settings.cardSpeed)`; `AppCard(padding: EdgeInsets.zero)` holding the `SwitchListTile` (title `settings.limitCardSpeed`, subtitle `settings.limitCardSpeedHint`, same `contentPadding` as the knob switches at 278-286), and when enabled a `Divider(height: 1, color: AppColors.border)` then a padded, start-aligned `Wrap` (`spacing`/`runSpacing: AppSpacing.sm`) of `ChoiceChip`s styled like the wizard's (create_voucher_wizard.dart 536-553) with `showCheckmark: false`, then the caption. A save error shows as an `InlineErrorBanner` above the card.
  - Every control calls `ref.read(cardSpeedProvider.notifier).save(...)` with BOTH values.

- [ ] **Step 4: Run to verify they pass**

Run: `cd mobile && dart analyze --fatal-infos && flutter test test/i18n test/screens/voucher_printing_screen_test.dart`
Expected: PASS (the ratchet test needs Task 3 present).

---

### Task 6: Wizard notice, applied speed, card details

**Files:**
- Modify: `mobile/lib/models/voucher.dart` (field list 2-22, `fromJson` 126-164, `toJson` 166-190)
- Modify: `mobile/lib/screens/vouchers/create_voucher_wizard.dart` (`initState` 53-63, `_showSuccessDialog` 134-210, summary rows 792-799, `_buildBottomBar` 838-885)
- Modify: `mobile/lib/screens/vouchers/voucher_detail_screen.dart` (after the validity row, 405-409)
- Test: `mobile/test/screens/wizard_step3_speed_limit_test.dart` (new), `mobile/test/screens/voucher_detail_screen_test.dart`, `mobile/test/screens/wizard_step3_code_digits_test.dart`, `mobile/test/screens/create_voucher_wizard_test.dart`

**Interfaces:**
- Consumes: `cardSpeedProvider` (Task 4), `localizedSpeedText` and the string keys (Task 5), `speedLimit` in card JSON (Task 3).
- Produces: `Voucher.speedLimit` (`String?`, `null` when the key is absent or not a string); widget keys `Key('speedLimitStrip')`, `Key('speedLimitChange')`, `Key('appliedSpeedText')`.

- [ ] **Step 1: Write the failing tests.** Base the new file on `wizard_step3_code_digits_test.dart` (its fakes, `_buildApp`, `_advanceToStep3`), adding a fake `CardSpeedNotifier` that counts `load()` calls and a `_FakeVouchersNotifier.createVouchers` that returns a given list.

```dart
testWidgets('limit on: step 3 shows the Speed row and the strip above Create', (tester) async {
  // cardSpeed: enabled true, speed '1M'
  // after _advanceToStep3: find.byKey(Key('speedLimitStrip')) findsOneWidget, WITHOUT scrolling
  // strip text contains '1M'; summary has a row labelled 'Speed' with value '1M'
});
testWidgets('the strip is not shown on steps 1 and 2');
testWidgets('limit off: no strip and no Speed row');
testWidgets('setting not loaded (error or unavailable): no strip, no Speed row, Create still works');
testWidgets('load() is called when the wizard opens even if the provider already holds a value', /* loadCalls == 1 */);
testWidgets('Change opens Voucher Printing', /* tap Key('speedLimitChange') -> GoRouter location '/settings/voucher-printing' (wrap in a minimal GoRouter) */);
testWidgets('strip fits at 320x569 in Arabic with the keyboard open', (tester) async {
  // MediaQuery viewInsets bottom 280, locale ar, Cairo font loaded as in create_voucher_wizard_test.dart 296-302
  // expect(tester.takeException(), isNull)
});
testWidgets('success dialog shows the speed the server applied', /* created vouchers have speedLimit '1M' -> Key('appliedSpeedText') contains '1M' */);
testWidgets('success dialog shows no speed when the created cards have none');
testWidgets('success dialog shows the applied speed even when the setting never loaded');

// voucher_detail_screen_test.dart
testWidgets('shows a Speed row when the card has a speed', /* speedLimit '256k' -> 'Speed' and '256K' */);
testWidgets('shows no Speed row when speedLimit is null');

// voucher model (add to the existing model test file, or the detail test file if none exists)
test('Voucher.fromJson reads speedLimit and tolerates a missing key', /* {'speedLimit': '1M'} -> '1M'; no key -> null; 5 -> null */);
```

  Override `cardSpeedProvider` with the fake in `wizard_step3_code_digits_test.dart` and `create_voucher_wizard_test.dart` too, so they do not start a real request.

- [ ] **Step 2: Run to verify they fail**

Run: `cd mobile && flutter test test/screens/wizard_step3_speed_limit_test.dart test/screens/voucher_detail_screen_test.dart`
Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `Voucher`: `final String? speedLimit;` parsed with an `is String` check; included in `toJson`.
  - Wizard `initState`: `Future.microtask(() => ref.read(cardSpeedProvider.notifier).load());` unconditionally. Leave the print-settings load guard as it is.
  - A getter for the active speed: the setting's `speed` when `setting?.enabled == true`, else `null`.
  - Summary: after the code-length row, a `_buildSummaryRow(context.tr('vouchers.speed'), localizedSpeedText(context, speed))` when the speed is non-null.
  - `_buildBottomBar`: wrap the existing `Row` in a `Column(mainAxisSize: MainAxisSize.min)`. When `_currentStep == 2` and the speed is non-null, put the strip above it with an `AppSpacing.sm` gap: a rounded container (`AppColors.primary` at 0.08 alpha, as the step-1 hint box at 426-448) holding `Icon(Icons.info_outline, size: 16)`, an `Expanded` text (`vouchers.speedLimitNotice`, `AppTypography.footnote`, `maxLines: 2`, ellipsis) and a compact `TextButton` (`vouchers.speedLimitChange`, zero minimum size, shrink-wrapped tap target) that calls `context.push('/settings/voucher-printing')`.
  - `_showSuccessDialog`: read `vouchers.isNotEmpty ? vouchers.first.speedLimit : null`; when non-null add, under the "ready" text, `Text('${ctx.tr('vouchers.speed')}: ${localizedSpeedText(ctx, applied)}')` with `Key('appliedSpeedText')`.
  - Details: `if (v.speedLimit != null)` an `_InfoRow(label: vouchers.speed, value: localizedSpeedText(context, v.speedLimit!), icon: Icons.speed)` after the validity row.

- [ ] **Step 4: Run the whole app suite**

Run: `cd mobile && dart analyze --fatal-infos && flutter test`
Expected: all pass, no analyzer issues.

---

### Task 7: Review, docs, commit, staging

**Files:**
- Modify: `docs/BACKEND_SCHEMA.md` (migration list ~92, ER diagram ~189-195, §3.15 ~488-499 including the `getCodeLength` sentence, radreply row ~514), `docs/PROJECT_STATE.md` (new dated section; amend the 11-10 "fails open" line ~30), `docs/STAGING.md` (add the speed check to the E2E list)

- [ ] **Step 1: Security audit and cross-cutting review** of the full diff (`security-auditor`, then `code-reviewer`). Fix what they confirm; re-run the suites.

- [ ] **Step 2: Full local verification**

Run: `cd backend && npx tsc --noEmit && npm run lint && npx vitest run` and `cd mobile && dart analyze --fatal-infos && flutter test`
Expected: all green.

Then on the dev stack, with a dev account token:
`curl -s localhost:3000/api/v1/settings/card-speed -H "Authorization: Bearer $T"` → off, `2M`, eight options.
`curl -s -X PUT … -d '{"enabled":true,"speed":"1M"}'` → on, `1M`.
PUT the current `/settings/print` document back unchanged, GET card-speed again → still on, `1M`.
Create 2 cards, then `SELECT username, attribute, op, value FROM radreply WHERE username = ANY(...)` → one `Mikrotik-Rate-Limit := 1M/1M` per card; `SELECT speed_limit FROM voucher_meta …` → `1M`.
Switch off, create 1 card → no rate-limit row, `speed_limit` NULL; the two earlier cards unchanged.

- [ ] **Step 3: Update the docs** listed above. In `PROJECT_STATE.md` record: what shipped to `dev`, that creation now fails closed on a settings read error, the FastTrack finding and its testing trap, and that nothing is released to operators until the router-side handling is decided.

- [ ] **Step 4: Commit on `dev`** (run the project `verify` skill before the code commits):
  1. `docs(plan): card speed limit design and implementation plan` — the spec and this plan.
  2. `feat(backend): per-card speed limit — setting API, creation stamping, fail-closed settings read` — migration, backend source and tests.
  3. `feat(mobile): card speed limit — settings section, wizard notice, applied speed` — app source and tests.
  4. `docs(state): card speed limit on dev + staging` — after Step 6.

- [ ] **Step 5: Deploy `dev` to staging** following `docs/STAGING.md`. Confirm migration 047 applied on staging and `GET https://api.wa-sel.cloud/api/v1/settings/card-speed` answers for a staging account.

- [ ] **Step 6: Staging checks**
  - Build `flutter build apk --debug --dart-define=API_BASE_URL=https://api.wa-sel.cloud/api/v1` and confirm `arm64-v8a/libflutter.so` is inside the APK.
  - With the owner on a phone: switch the limit on, pick 1M, create a batch on router `test`; confirm the strip, the success dialog and the card details. Switch it off, create again: the new card has no speed and the earlier card still shows 1M.

---

### Task 8: Router proof on the staging L009 (needs the owner's phone; runs alongside the build)

No code. Outcome is a written result in `docs/PROJECT_STATE.md` and a decision for the owner.

- [ ] **Step 1:** Over the staging backend's RouterOS access, read `/ip/firewall/filter` on router `test` and record whether an enabled rule with `action=fasttrack-connection` exists (remember `routeros-client` returns camelCased keys).
- [ ] **Step 2:** Give one unused staging card a limit by hand: `INSERT INTO radreply (username, attribute, op, value) VALUES ('<code>', 'Mikrotik-Rate-Limit', ':=', '1M/1M');` on the staging database only.
- [ ] **Step 3:** The owner logs a phone into the staging hotspot with that card and runs a speed test. **Torch, sniffer and traffic generator must be closed**, or FastTrack is inactive and the result is false. Record download/upload, and `/queue simple print` (expect a dynamic queue for the user at `1M/1M`).
- [ ] **Step 4:** If the speed is not held near 1M: add `accept` rules for the hotspot network in both directions above the FastTrack rule (MikroTik's documented exclusion), have the phone reconnect so no old fasttracked connection survives, and repeat Step 3. Note router CPU during the test. Remove or keep the rules as the owner prefers; record which.
- [ ] **Step 5:** Delete the hand-added radreply row. Write the result into `docs/PROJECT_STATE.md` and bring the owner the decision: Wasel applies the router fix over the API, or the app warns and gives one command to paste.
