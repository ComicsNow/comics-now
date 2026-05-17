# Plan 11 — Wire up `validateComicId` at all comic-id boundaries

**Category:** Missing functionality — wire up, don't delete.

## Finding

`server/validation.js:200 validateComicId` enforces a 40-char hex SHA. It is exported and unit-tested (`tests/validation.test.js:76`), but **no production route calls it**. Every endpoint that reads `comicId` from `req.params` or `req.body` accepts arbitrary input:

| File | Handler |
|---|---|
| `server/routes/user/progress.js:24` | `GET /api/v1/progress/:comicId` |
| `server/routes/user/progress.js:98` | `POST /api/v1/sync/update` (body) |
| `server/routes/user/progress.js:165` | `POST /api/v1/comics/status` (body) |
| `server/routes/user/devices.js:136` | device-related comicId param |
| `server/routes/user/reading.js:10` | `POST /api/v1/comics/manga-mode` (body) |
| `server/routes/user/reading.js:211` | `POST /api/v1/comics/continuous-mode` (body) |
| `server/routes/user/reading-lists.js:200, 230, 252, 271, 288` | reading-list comic operations |

## Steps

1. Ensure `validateComicId` is in `extendedDeps` (`server/routes/index.js:46`). If missing, import it and add it to the bag.
2. For each handler above:
   - Destructure `validateComicId` from `deps` at the top of `attach`.
   - Right after extracting the id from req, validate:
     ```js
     const v = validateComicId(comicId);
     if (!v.valid) return res.status(400).json({ message: v.error });
     const cleanId = v.sanitized;
     ```
   - Use `cleanId` (not the raw value) for the rest of the handler.
3. For array inputs (`comicIds` in reading-lists), validate each element; reject on the first bad one.
4. Do this **one file per commit** so a bad rollout can be reverted granularly.

## Test strategy

### Before
- `npm test` — green baseline. `tests/validation.test.js` already covers `validateComicId` in isolation.
- For each endpoint, capture a baseline curl with a valid 40-char hex id (200/expected) and a baseline curl with an obviously invalid id like `' OR 1=1; --` or `../etc/passwd` (currently the server probably 404s or 500s after a DB miss — record the exact response).

### After
- `npm test` — green.
- Re-run each baseline curl:
  - Valid id → same response as before.
  - Invalid id → must now be `400 {"message": "Invalid comic ID format"}`.
- Add **route-level** integration tests under `tests/server/` (next to the existing `tests/server/services` tree) that hit each affected handler with a malformed id and assert `400`. One test per handler.

## On failure

Per shared policy.
- **Real user reports a valid id was rejected:** the SHA generation logic must produce something other than 40 lowercase hex. Inspect the actual id, then either fix the id generator (in `server/utils.js createId`) or loosen `validateComicId`'s regex — but only with the user's call.
- **Existing integration test fails:** likely the test was using a fixture id that doesn't match the 40-hex format. **Ask the user** before changing the test; usually the fix is to update the fixture id to a real SHA1.
- **Endpoint returns `500` instead of `400`:** the validation block was placed after a DB lookup. Move it to the top of the handler.
