# QQ Music Owner QR Login Design

## 1. Goal

Replace the process-wide QQ Music cookie with an in-app QR login flow. Each browser owns an isolated QQ Music credential, while every QQ Music operation inside a room uses the room owner's credential.

Confirmed behavior:

- QQ Music is the only provider in this phase.
- A room always uses the room owner's QQ Music account, regardless of which member starts an operation.
- If the owner is not logged in or the credential has expired, QQ Music parsing is blocked.
- There is no fallback to `QQ_MUSIC_COOKIE` for room operations.
- Existing playback, queue synchronization, permissions, and non-QQ providers remain unchanged.

## 2. Current Constraints

The backend currently reads one QQ Music cookie from a file or `QQ_MUSIC_COOKIE`. `musicAdapter.ts` applies it to all Tencent requests. The frontend's `nonce` identifies a browser for room participation, but it is sent by the client and is not suitable as proof of credential ownership.

QQ Music parsing happens through three paths that must use the same room credential policy:

1. Link parsing through `/api/parse-text`.
2. Playlist import through the WebSocket import command and background import job.
3. Lazy queue-item resolution when switching to an unresolved song.

The QQ Music web login flow is not a stable public OAuth contract. Its protocol must therefore be isolated behind an adapter and treated as replaceable integration code.

## 3. Chosen Approach

Implement the QR login flow directly in the existing Node backend, behind a `QQMusicAuthProvider` interface. The backend owns the upstream cookie jar, polls login status, extracts the minimum required QQ Music cookies, encrypts them, and never returns them to the browser.

Alternatives rejected for this phase:

- A separately deployed QQMusicApi service adds another runtime and still requires local multi-account isolation.
- Playwright-based login is heavier, consumes a browser process per login, and complicates deployment.

The provider boundary allows either alternative to replace the direct protocol implementation later without changing room or credential storage code.

## 4. Identity and Ownership

### 4.1 Device session

The backend issues a random opaque `acl_sid` cookie when a browser first accesses an auth-aware endpoint.

Cookie properties:

- `HttpOnly`
- `SameSite=Lax` by default
- `Secure` in production
- Path `/`

For an explicitly supported cross-site frontend/backend deployment, use `SameSite=None` together with `Secure`, exact CORS origins, and credentialed requests. Wildcard CORS is not allowed when device sessions are enabled.
- Rotatable and revocable

The raw session identifier is not stored in logs. The database stores a SHA-256 hash of it. Requests resolve the cookie to an internal `deviceSessionId`.

The existing `nonce` remains in use for room participation compatibility, but it does not authorize credential reads, writes, or deletion.

### 4.2 Room owner binding

New rooms persist `ownerSessionId` at creation. It is internal and must not be included in room responses or WebSocket broadcasts.

Existing rooms have no binding. The first browser that passes the existing room-owner permission check may claim the empty `ownerSessionId`. This preserves existing rooms without making later credential access depend on the forgeable `nonce`. Once set, the binding cannot be replaced by a normal room request.

### 4.3 Credential selection

Every QQ Music operation that includes a room ID resolves credentials in this order:

1. Load the room.
2. Read its internal `ownerSessionId`.
3. Load the active QQ Music account for that device session.
4. Decrypt credentials only for the duration of the upstream request.
5. If any step fails, return `QQ_AUTH_REQUIRED` without calling QQ Music.

Members never supply a credential ID or owner session ID.

## 5. Data Model

The schema must be implemented for both SQLite and PostgreSQL repositories.

### `device_sessions`

| Column | Purpose |
| --- | --- |
| `id` | Internal random ID |
| `token_hash` | SHA-256 hash of `acl_sid`, unique |
| `created_at` | Creation timestamp |
| `last_seen_at` | Last successful use |
| `revoked_at` | Optional revocation timestamp |

### `music_accounts`

| Column | Purpose |
| --- | --- |
| `id` | Internal random ID |
| `device_session_id` | Owning browser session |
| `provider` | `qq` in this phase |
| `account_id` | QQ Music account identifier when available |
| `display_name` | Non-secret display name |
| `avatar_url` | Non-secret avatar URL |
| `credential_ciphertext` | AES-256-GCM encrypted credential JSON |
| `credential_iv` | Random encryption IV |
| `credential_tag` | Authentication tag |
| `status` | `active`, `expired`, or `revoked` |
| `expires_at` | Known expiry, otherwise nullable |
| `created_at` | Creation timestamp |
| `updated_at` | Last credential update |

Add a unique constraint on `(device_session_id, provider)`.

### `rooms`

Add nullable `owner_session_id`. Repository domain types may expose this only to server-side services; response builders must remove it.

QR login sessions remain in memory with a short TTL because the current deployment is single-process. They are not persisted and are invalid after a restart.

## 6. Backend Components

### `deviceSessionService`

- Issues and validates `acl_sid`.
- Creates and updates `device_sessions`.
- Provides Express and WebSocket session resolution.
- Rejects revoked or unknown sessions.

### `credentialCrypto`

- Encrypts and decrypts credential JSON using AES-256-GCM.
- Reads a mandatory `MUSIC_CREDENTIAL_ENCRYPTION_KEY` from the environment.
- Fails startup in production if the key is missing or malformed.
- Never logs plaintext, ciphertext, cookie names with values, or decrypted objects.

### `musicCredentialStore`

- Upserts one provider account per device session.
- Returns public account summaries separately from decrypted credentials.
- Marks credentials expired after confirmed upstream authentication failures.
- Deletes or revokes credentials on logout.

### `qqMusicAuthProvider`

Interface responsibilities:

- Create an upstream QR login transaction.
- Return QR image data and an expiry timestamp.
- Poll and normalize upstream state.
- Produce validated QQ Music credentials after confirmation.
- Optionally refresh credentials when the upstream flow supports it.

Normalized states:

```text
pending -> scanned -> confirmed
   |          |          |
 expired    expired     failed
```

Unknown upstream responses become `failed`; they are not interpreted as successful login.

### `roomMusicCredentialResolver`

- Resolves the room owner's active credential.
- Returns a typed `QQ_AUTH_REQUIRED` error when unavailable.
- Supplies credentials to QQ adapter calls without changing non-QQ adapter behavior.

## 7. API Design

All endpoints use the device session cookie. Mutating endpoints validate `Origin` against configured frontend origins.

### `POST /api/music-auth/qq/qr`

Creates a QR transaction bound to the current device session.

Response data:

```json
{
  "loginId": "opaque-random-id",
  "qrImage": "data:image/png;base64,...",
  "expiresAt": 0,
  "status": "pending"
}
```

Only one active QQ login transaction is allowed per device session. Creating another invalidates the previous one.

### `POST /api/music-auth/qq/qr/:loginId/poll`

Polls upstream state. The transaction must belong to the current device session. On confirmation, credentials are validated and stored before returning `confirmed`. POST is used because confirmation persists credentials and is therefore not a read-only operation.

The endpoint returns only state and public account summary. It never returns cookies, tokens, redirect query parameters, or upstream response bodies.

### `GET /api/music-auth/qq/account`

Returns `disconnected`, `active`, or `expired`, plus public profile fields.

### `DELETE /api/music-auth/qq/account`

Revokes the current browser's QQ Music account and cancels active QR transactions.

### `GET /api/rooms/:roomId/music-auth`

Returns room-safe state:

```json
{
  "provider": "qq",
  "status": "ready | owner_login_required | waiting_for_owner",
  "canLogin": true
}
```

It does not reveal the owner's session or full QQ account identifier.

### Existing request changes

`/api/parse-text` must receive `roomId` for QQ Music links. WebSocket handshakes must carry the signed device session cookie, and playlist/lazy-resolution jobs must pass `roomId` into the credential resolver.

## 8. Music Adapter Changes

Replace the process-global `getTencentCookie()` lookup with an explicit request context:

```ts
interface MusicResolveContext {
  roomId?: string
  qqCredential?: QQMusicCredential
}
```

QQ parsing and playlist functions require a resolved room credential. Other providers ignore `qqCredential`.

The environment cookie remains available only for explicitly identified maintenance tooling during migration. It must not be reachable from room parsing, importing, queue switching, or playback paths.

Background playlist jobs capture only `roomId`, not plaintext credentials. Each upstream operation resolves the current owner credential immediately before use so logout and expiry take effect during a long import.

## 9. Frontend Behavior

Add a compact QQ Music account control to the room owner management area.

Owner states:

- Disconnected: show `登录 QQ 音乐`.
- QR pending: show QR code, countdown, refresh, and cancel.
- Scanned: show `已扫码，请在手机确认`.
- Connected: show public avatar/name and `退出登录`.
- Expired: show `登录已过期，请重新扫码`.

Member states:

- Ready: no login control is required.
- Owner not ready: show `等待房主登录 QQ 音乐` when a QQ operation is attempted.

The dialog polls at a bounded interval and stops on confirmation, expiry, close, unmount, or network failure. Opening the dialog does not recreate the player or reconnect the room WebSocket.

## 10. Error Handling

Use stable application error codes:

- `QQ_AUTH_REQUIRED`: no owner credential.
- `QQ_AUTH_EXPIRED`: credential rejected or known expired.
- `QQ_QR_EXPIRED`: login QR expired.
- `QQ_QR_FAILED`: upstream login flow failed.
- `QQ_AUTH_FORBIDDEN`: a non-owner attempts an owner-only account action.

Authentication failures are distinct from content-not-found and rate-limit errors. Only a confirmed QQ authentication response marks a stored credential expired; timeouts and generic 5xx responses do not.

## 11. Security Requirements

- Never expose QQ cookies to frontend code, WebSocket messages, API responses, logs, analytics, or error objects.
- Redact `Cookie`, `Set-Cookie`, login callback URLs, QR transaction secrets, encryption fields, and upstream payloads from logs.
- Require HTTPS when `Secure` cookies are enabled.
- Use random, high-entropy IDs for device and QR sessions.
- Bind every QR status request to the initiating device session.
- Rate-limit QR creation and status polling per device session and IP.
- Validate request origin on cookie-authenticated mutations, including QR polling.
- Keep decrypted credentials in local function scope and discard references after use.
- Do not include encrypted credential columns in generic repository serialization.
- Document that the QQ Music integration depends on an unofficial web protocol and may require maintenance or raise service-policy concerns.

## 12. Migration and Compatibility

1. Add nullable schema fields and new tables without removing the old environment setting.
2. Deploy device sessions and room owner binding.
3. Deploy QR login and account status UI.
4. Route all room QQ operations through the owner credential resolver.
5. Verify no room path calls the global cookie lookup.
6. Deprecate `QQ_MUSIC_COOKIE` in `.env.example` and README after migration verification.

Existing rooms lazily bind their owner session as described above. Existing QQ queue entries with an already resolved audio URL continue playing. Entries that need lazy resolution require the bound owner's active login.

Both SQLite and PostgreSQL builds must implement equivalent migrations and repositories even though the current local deployment defaults to SQLite.

## 13. Testing

### Unit tests

- Device session issuance, hashing, expiry, and revocation.
- AES-GCM round trip, wrong-key failure, and tamper detection.
- QR state normalization and TTL cleanup.
- Credential selection always uses `room.ownerSessionId`.
- Members cannot select or replace credentials.
- Auth failures are separated from transient upstream failures.

### Integration tests

- Two browsers connect different QQ accounts without credential crossover.
- A member-triggered parse/import uses the owner's mocked credential.
- Missing or expired owner credentials block QQ requests before upstream calls.
- Playlist background and lazy queue resolution re-resolve owner credentials.
- Logout immediately affects subsequent room operations.
- SQLite and PostgreSQL repositories satisfy the same contract tests.
- API and WebSocket responses contain no credential material.

### Manual checks

- QR pending, scanned, confirmed, expired, refresh, cancel, and logout states.
- Owner and member messaging.
- Existing non-QQ parsing and playback remain unchanged.
- Player instance is not recreated by auth UI state changes.
- Mobile dialog does not overflow at 375 px.

## 14. Acceptance Criteria

- Different browsers can store different QQ Music accounts.
- A room uses only its owner's account for every QQ Music operation.
- No owner login means no QQ Music upstream parsing request is made.
- No room operation falls back to the global QQ cookie.
- QQ credentials are encrypted at rest and never sent to the frontend.
- Credential expiry produces a clear owner re-login path.
- SQLite and PostgreSQL builds pass.
- README and `.env.example` describe the new flow and required encryption key without including secrets.
