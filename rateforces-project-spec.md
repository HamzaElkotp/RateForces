# RateForces — Product & Technical Specification

**Document status:** Draft for implementation planning  
**Version:** 0.1  
**Date:** 2026-11-15  
**Product type:** Codeforces companion / personal training-round generator  
**Primary principle:** Keep the product small, fast, understandable, and dependable. Do not recreate Codeforces.

---

## 1. Product summary

RateForces helps a competitive programmer create a timed practice round from the Codeforces problemset. The user chooses a target problem rating, eligible years, duration, tags, tag-matching behavior, whether previously solved problems may be included, and the number of problems. RateForces selects and freezes a set of problem links. The user starts the round when ready, opens each problem on Codeforces, and submits solutions there.

While the round is running, RateForces synchronizes the user's public Codeforces submissions and updates each selected problem's status. It records attempts, accepted submission time, the accepted submission link, and manually tracked work intervals. When the round ends, it shows a summary and a timeline chart.

RateForces is a companion tool, not a replacement for Codeforces. It does not host problem statements, a compiler, a judge, or submissions.

### 1.1 Product goals

1. Make it quick to create a focused practice round for a chosen Codeforces difficulty.
2. Make the round feel like a real timed session without requiring the user to solve inside RateForces.
3. Reliably detect accepted solutions from Codeforces and associate them with the correct round.
4. Preserve a user's own round history and results without requiring a separate username/password account.
5. Keep the interface lightweight, readable, responsive, and comfortable in both light and dark themes.
6. Keep the codebase modular and maintainable without premature microservices or infrastructure.

### 1.2 Non-goals for the first release

- Hosting problem statements or source code.
- Compiling, judging, or submitting solutions.
- Replacing Codeforces profiles, ratings, standings, or contests.
- Social feeds, leaderboards, chat, or a large community system.
- Supporting multiple competitive-programming judges in the first release.
- Reproducing Codeforces rating changes. The selected problem rating is a difficulty filter, not a prediction of the user's rating change.

### 1.3 Product terminology

| Term | Meaning |
|---|---|
| Codeforces handle | The user's public Codeforces username. |
| Verified owner | A Codeforces handle whose control was proven using a one-time submission challenge. |
| Round | A saved, timed practice session owned by one verified user. |
| Round problem | A problem frozen into a particular round. |
| Attempt | A submission to a round problem during the round that has received a final verdict. |
| Work session | A manually started/stopped interval used to estimate active time spent on a problem. |
| Accepted time | The Codeforces submission timestamp of the first accepted submission during the round. |
| Round elapsed time | Accepted timestamp minus the round start timestamp. |
| Active work time | The sum of manually tracked work-session intervals for a problem. |

---

## 2. Important architecture decision: what “fully client-side” means

The application should be a **client-rendered Single Page Application (SPA)**. All screens, interactions, countdown rendering, filters, tables, charts, light/dark theme behavior, and navigation run in the browser. There is no need for server-side rendering.

However, the complete product cannot safely or reliably be a browser-only application because it requires:

- A persistent shared database for the problemset and a user's rounds.
- Private owner-only data access.
- A scheduled weekly problemset synchronization job.
- Background polling of Codeforces submissions while the browser may be closed or suspended.
- Centralized Codeforces API rate limiting.
- Secure verification challenges and session issuance.

Therefore, use this architecture:

```text
Browser (React SPA)
    | HTTPS / JSON
    v
Backend API (Express)
    |                    \
    v                     v
PostgreSQL            Codeforces API
    ^                     ^
    |                     |
Background worker --------+
  - weekly problem crawl
  - verification polling
  - user submission sync
  - round expiration/finalization
```

The browser must never connect directly to PostgreSQL and must never contain database credentials or Codeforces API secrets. The browser may display a local countdown between server refreshes, but the server is authoritative for all round timestamps and state transitions.

**Recommended wording:** “Client-rendered and browser-first,” not “backend-free” or “100% client-only.”

---

## 3. Recommended technology stack

Use a modular monolith in one repository. Keep the API and worker as separate runtime processes, but let them share domain logic and database code.

| Layer | Recommendation | Reason |
|---|---|---|
| Frontend | React + TypeScript + Vite | Lightweight SPA; no SSR requirement. |
| Styling | Tailwind CSS with CSS-variable design tokens | Fast, consistent styling and clean theme switching. |
| UI components | Small, selectively used accessible components (shadcn/ui is acceptable) | Avoid building every primitive while avoiding a heavy component framework. |
| Client data | TanStack Query | Query caching, invalidation, retries, and polling. |
| Routing | React Router | Straightforward SPA navigation. |
| Backend | Node.js + TypeScript + Express | Small REST API; easy to organize by feature modules. |
| Validation | Zod | Validate every external request and important configuration object. |
| Database | PostgreSQL | Relational ownership, constraints, arrays for tags, and reliable transactions. |
| ORM | Prisma | Typed schema and migrations; use SQL for specialized queries when necessary. |
| Background work | Separate TypeScript worker process using PostgreSQL-backed scheduling/leases | No Redis or microservice infrastructure needed initially. |
| Charts | Recharts or another small chart library | Only one primary result timeline is needed. |
| Tests | Vitest + API integration tests | Shared TypeScript test tooling and fast feedback. |

### 3.1 Architecture style

- Build a **modular monolith**, not microservices.
- Separate frontend, API, worker, shared domain types, and database concerns.
- Keep business logic out of Express route handlers and React components.
- Use feature-based modules (`auth`, `codeforces`, `problemset`, `rounds`, `analytics`).
- Use dependency injection only where it makes testing or external integrations easier. Do not introduce a complex DI framework.
- Keep functions small and single-purpose. Prefer explicit types and domain names over generic utility abstractions.
- Use transactions for operations that update a round and its problem rows together.

---

## 4. Main user journey

### 4.1 First-time use and Codeforces verification

1. The visitor opens RateForces.
2. They choose **Link Codeforces account** and enter their Codeforces handle.
3. The backend checks the handle through `user.info`.
4. The backend creates a short-lived, one-time verification challenge and records the latest known submission ID for that handle as the challenge baseline.
5. The UI explains which configured verification problem to open and tells the user to submit code that produces a **Compilation error (CE)**.
6. A background worker checks the handle's submissions. It looks for a new submission that:
   - Has a submission ID greater than the challenge baseline.
   - Targets the configured verification problem.
   - Has a final verdict of `COMPILATION_ERROR`.
   - Was created after the challenge was issued and before it expires.
7. Once found, the challenge is consumed and the handle is marked verified.
8. The backend issues an opaque session credential in a secure, HttpOnly cookie. No password or separate RateForces registration is needed.
9. The user is redirected to their dashboard.

**Verification caveat:** The challenge proves practical control of the Codeforces account because a new submission must be made from it. The public submission metadata is sufficient to detect a CE on the configured problem; RateForces does not need the user's source code. The challenge is time-bound and matched against the submission ID baseline to avoid accepting an old CE. Do not treat the public handle alone as authentication.

The exact verification problem must be configured and tested before launch. Keep its `contestId` and `index` in configuration, not scattered throughout the codebase. If Codeforces changes the availability or judging behavior of that problem, an administrator must be able to replace it.

### 4.2 Create a round

1. The user opens **Create round**.
2. The user configures:
   - Target problem rating.
   - Problem year selection.
   - Round duration in minutes.
   - Number of problems.
   - Tags (optional).
   - Tag matching: **All selected tags** or **Any selected tag**.
   - Include previously solved problems (checkbox).
3. The UI previews the number of matching problems, if practical, and validates that enough eligible problems exist.
4. The backend generates the problem set, saves the round and its problem rows, and sets the round status to `LOBBY`.
5. The user enters the newly created round and reviews the selected problems.
6. The round does **not** start automatically. The user explicitly presses **Start round** when ready.

### 4.3 Run a round

For each problem, the user can:

- Open the Codeforces problem link.
- Mark the problem as **Start working**.
- Mark it as **Stop / Pause** while taking a break or switching tasks.
- Resume a paused problem.

RateForces continuously synchronizes the user's Codeforces submissions through the backend. When an accepted submission for a selected problem is detected during the round:

- The problem changes to **Solved** automatically.
- The first accepted submission's Codeforces timestamp is recorded.
- Its submission link is saved and displayed.
- Any open work session is closed automatically at the accepted timestamp.
- The problem's work timer is stopped; it cannot continue accumulating time after acceptance.

The round screen displays:

- Countdown to the round end.
- Round elapsed time.
- Total problems, solved problems, and remaining problems.
- Each problem's rating and tags.
- Problem status.
- Attempt count.
- Whether work tracking is active or paused.
- Acceptance time relative to round start.
- Link to the accepted submission when solved.
- Last successful Codeforces synchronization time / sync health.

### 4.4 Finish a round

When the server reaches `ends_at`, the round becomes `COMPLETED`.

The completed round page shows:

- Final solved / unsolved counts.
- Final problem table with attempts, work time, accepted time, and accepted submission link.
- Average active work time for solved problems that have valid work-session data.
- Longest active work time among solved problems with valid work-session data.
- A timeline chart showing cumulative accepted problems and remaining unsolved problems over round elapsed time.
- A clear note if a problem was accepted but the user never marked it as started (acceptance data exists; active work time is unavailable).

The result view must distinguish **round elapsed time** from **active work time**. They are different measurements and should not share one label.

---

## 5. Round configuration and problem selection

### 5.1 Configuration fields

| Field | Type | Required | Behavior |
|---|---|---:|---|
| `targetRating` | Integer | Yes | Exact Codeforces problem rating. Exclude problems whose rating is null. |
| `yearMode` | `SELECTED` or `RANDOM` | Yes | Select explicit years or use all eligible years for random selection. See open question Q2. |
| `selectedYears` | Integer array | Conditional | Required when `yearMode = SELECTED`; one or more years. |
| `durationMinutes` | Integer | Yes | Positive duration. Apply a documented product limit (for example, 5–300 minutes) and validate on the server. |
| `problemCount` | Integer | Yes | Number of problems to generate. This is required even though it was absent from the latest setting list. |
| `selectedTags` | String array | No | Empty means no tag restriction. Values must come from the tags in the stored problemset. |
| `tagMatchMode` | `ALL` or `ANY` | Conditional | Only relevant when one or more tags are selected. |
| `includeSolved` | Boolean | Yes | If false, remove problems already solved by this verified Codeforces user. |

### 5.2 Tag matching terminology

Use these user-facing labels:

- **All selected tags** — a problem must contain every selected tag (logical AND).
- **Any selected tag** — a problem must contain at least one selected tag (logical OR).

In the database/API use `tagMatchMode = ALL | ANY`.

Examples:

- Selected tags: `dp`, `graphs`; mode `ALL` → include a problem only when both tags are present.
- Selected tags: `dp`, `graphs`; mode `ANY` → include a problem when either tag (or both) is present.
- No selected tags → ignore tag matching mode and apply no tag filter.

### 5.3 Year selection

Recommended initial behavior:

- `SELECTED`: the user can select one or multiple years.
- `RANDOM`: no year restriction; random selection can use problems from every year currently stored.

The precise meaning of “Random” is still a product decision: it might instead mean “choose one random year, then select the whole round from that year.” The recommended default above is the simpler and more flexible behavior, but confirm it before implementing the final UI.

A problem's year must be derived from its contest's `startTimeSeconds`, converted to a UTC calendar year. Store the derived year on the problem row for fast filtering. Do not infer the year from the contest ID or the problem name.

### 5.4 Previously solved problems

- If `includeSolved = true`, do not exclude problems found in the user's accepted-problem cache.
- If `includeSolved = false`, exclude every problem with a known accepted submission in the user's Codeforces history before the round starts.
- A newly linked user may need an initial historical submission scan to build this cache. Show progress and do not silently treat an incomplete scan as complete.
- If the account's history has not been fully synchronized, either wait before generating an exclude-solved round or clearly warn that the result may include previously solved problems. Recommended behavior: wait for the initial sync when `includeSolved = false`.

### 5.5 Selection algorithm

The backend is the source of truth for generation. Never trust a problem list sent by the browser.

1. Validate the verified owner and all configuration fields.
2. Query stored problems using:
   - Exact `rating = targetRating`.
   - `year IN selectedYears` when `yearMode = SELECTED`.
   - Tag array contains all selected tags for `ALL`.
   - Tag array overlaps selected tags for `ANY`.
   - Exclude keys found in the owner's `user_solved_problems` cache when `includeSolved = false`.
3. Verify that the eligible candidate count is at least `problemCount`.
4. If there are not enough candidates, return a useful validation response with the eligible count. Do **not** silently loosen filters or duplicate a problem.
5. Randomly select exactly `problemCount` distinct problems.
6. Persist the selected problems and their display metadata as a round snapshot. Later changes to the central problemset must not change an existing round.
7. Save the round in `LOBBY` state.

Random selection should be uniformly random across eligible problems unless the product later chooses a year-balanced strategy. A seed may be recorded for debugging/reproducibility, but the seed must not be used as an authentication token.

### 5.6 Problem identity

Use a stable Codeforces problem key derived from the fields returned by Codeforces, preferably:

```text
cf:{contestId}:{index}:{problemsetName-or-empty}
```

Store `contestId`, `index`, and nullable `problemsetName` separately as indexed columns. A Codeforces problem's contest ID and index are the matching identity used when correlating submissions. Include `problemsetName` in the key to avoid accidental collisions if custom problemsets are supported later.

Build problem URLs in one tested helper. For ordinary Codeforces problems, use the canonical Codeforces problem URL. Do not build URLs ad hoc in React components.

---

## 6. Round lifecycle and timing rules

### 6.1 Round statuses

Use the following state machine:

```text
LOBBY --(owner presses Start)--> RUNNING
RUNNING --(server time >= ends_at)--> COMPLETED
LOBBY --(owner deletes/cancels)--> CANCELLED
```

No other transition is allowed in the first release. In particular, a completed round cannot be restarted; the user creates a new round.

### 6.2 Authoritative timestamps

On `Start round`, the backend must perform one transaction that:

1. Locks the round row.
2. Confirms the caller owns it and its status is `LOBBY`.
3. Captures one server-side UTC timestamp as `started_at`.
4. Computes `ends_at = started_at + durationMinutes`.
5. Changes status to `RUNNING`.

The browser displays a countdown derived from `ends_at - currentServerTime`. It must not decide whether a round is running or completed. The server must reject new work-session starts after the round has ended.

### 6.3 Problem work tracking

Use separate work-session rows so users can pause and resume without losing timing information.

- **Start working:** create a work-session row with `started_at`, `stopped_at = null`.
- **Stop / Pause:** close the currently open row with `stopped_at`.
- **Resume:** create a new work-session row.
- **Accepted:** automatically close any open work session at the Codeforces accepted timestamp.
- **Round end:** close any still-open work sessions at `ends_at`.

Derived values:

```text
activeWorkSeconds = sum(stopped_at - started_at for all work sessions)
roundElapsedToAcceptance = accepted_at - round.started_at
wallClockFromFirstStart = accepted_at - first_started_at
```

Only `activeWorkSeconds` should be used for the average and longest active-work-time statistics. `roundElapsedToAcceptance` is what should be displayed as “Solved at +MM:SS” or “Solved at HH:MM:SS into the round.”

If a problem is accepted but has no work-session start, record the accepted result and attempts, but show active work time as unavailable. Do not fabricate a duration by assuming the user started at the round start.

### 6.4 Problem status values

Suggested statuses:

- `PENDING` — not started and not accepted.
- `IN_PROGRESS` — currently has an open work session.
- `PAUSED` — has been manually started but has no open work session.
- `SOLVED` — an accepted submission was observed during the round.
- `EXPIRED` — the round ended and the problem was not accepted.

The round problem status is a cached state for quick rendering. Keep enough underlying submission/work-session records to recompute it if needed.

### 6.5 Submission counting

Recommended definition:

- A round attempt is a submission to that selected problem whose Codeforces creation timestamp is between the round's `started_at` and `ends_at`, inclusive, and which has reached a final verdict.
- Count the accepted submission as an attempt.
- Do not count transient `TESTING`, `SUBMITTED`, or verdict-missing states as final attempts.
- Store each submission ID once per round to prevent duplicate counts.
- Update an existing stored submission if Codeforces initially returned a pending verdict and later returns a final verdict.

If the product later prefers “wrong attempts only,” display that as a separate `failedAttempts` metric rather than changing the meaning of `attemptCount` silently.

### 6.6 Solved detection

A selected round problem becomes solved only when:

- The submission's problem identity matches the selected problem.
- The submission verdict is `OK`.
- The submission `creationTimeSeconds` falls inside the round's time interval.

Use the **first** such accepted submission as the round's accepted result. Save its submission ID, timestamp, and URL. An accepted submission after `ends_at` does not count as solved in that round.

The worker may discover a submission after the round page's countdown has reached zero. Because Codeforces provides the submission creation timestamp, a late synchronization can still correctly accept it when its timestamp falls inside the round interval. The completed results page should show a temporary “Final Codeforces sync pending” indicator until the final reconciliation has run.

---

## 7. Codeforces integration

### 7.1 Official API methods used

Use the official Codeforces API rather than scraping HTML pages for core application data.

| API method | Purpose | Main data needed |
|---|---|---|
| `user.info` | Validate the entered handle and read public profile metadata | Canonical handle, current rating/rank where available |
| `user.status` | Verify a challenge, import solve history, and detect round submissions | Submission ID, creation timestamp, problem identity, verdict |
| `problemset.problems` | Import the Codeforces problemset | Problem identity, name, type, rating, tags, problem statistics |
| `contest.list` | Map problem contests to dates/years | Contest ID, start timestamp, name, type |

Official references:

- [Codeforces API introduction and limits](https://codeforces.com/apiHelp)
- [Codeforces API methods](https://codeforces.com/apiHelp/methods)
- [Codeforces API returned objects](https://codeforces.com/apiHelp/objects)

Relevant verified API facts as of this document date:

- The API returns a JSON response with `status`, `comment`, and `result` fields.
- Codeforces documents a maximum request frequency of one request every two seconds.
- `problemset.problems` returns problem and problem-statistics lists and supports tag filtering.
- `contest.list` returns contest objects with `startTimeSeconds` when available.
- `user.status` returns submissions sorted in decreasing submission-ID order. Submission objects include `id`, `creationTimeSeconds`, `problem`, and `verdict`.
- The submission verdict enum includes `COMPILATION_ERROR` and `OK`.
- `includeSources` is not needed. Do not request or store user source code.

Treat Codeforces API availability and rate limits as external dependencies. Build retries, timeouts, logging, and user-facing degraded states around them.

### 7.2 Centralized API client and rate limiter

All Codeforces requests must pass through one backend integration module and one shared rate limiter.

Responsibilities:

- Build request URLs and parameters in one place.
- Apply a global minimum request spacing of at least two seconds. A slightly larger safety interval is recommended.
- Parse the API envelope and convert Codeforces failures into typed integration errors.
- Add request timeouts.
- Retry transient network failures and temporary server errors with exponential backoff and jitter.
- Do not aggressively retry `Call limit exceeded`; delay and re-queue.
- Cache low-change data such as contest metadata and tags.
- Log method name, duration, status, and error class, but never log session tokens.

Do not let React components call `codeforces.com/api` directly. This protects the application from per-tab polling storms, CORS inconsistencies, and uncoordinated rate-limit usage.

### 7.3 Account verification algorithm

Use a configurable verification problem and a one-time server-side challenge.

```text
START
  Validate handle with user.info
  Fetch newest user submission and record baseline submission ID
  Create challenge(handle, target problem, baseline ID, expiresAt)
  Tell user to submit code that results in Compilation error on target problem

POLL
  Fetch recent submissions for handle
  Find a submission where:
    submission.id > baseline ID
    submission.problem matches target problem
    submission.verdict == COMPILATION_ERROR
    submission.creationTimeSeconds >= challenge.createdAt
    current time <= challenge.expiresAt

SUCCESS
  Atomically consume challenge
  Mark Codeforces handle verified
  Issue secure owner session
```

Use a short expiration window (for example, 10 minutes) and permit only one successful consumption. If the user does not complete it, allow them to request a new challenge after the existing one expires or is cancelled.

The special problem should be a stable ordinary Codeforces problem that can be submitted to by a normal user. Validate the process manually against real Codeforces behavior before release. If no CE is detected, provide a retry path and a clear explanation; do not mark the account verified based only on a typed handle.

### 7.4 Initial solved-history import

To know whether a candidate problem was solved before the round, build a per-user cache from `user.status`:

1. Start from the newest submissions (`from=1`).
2. Fetch pages in descending submission-ID order.
3. For every `OK` submission, upsert the problem into `user_solved_problems` with the first known accepted timestamp and submission ID.
4. Continue until the history is exhausted or a known completed checkpoint is reached.
5. Mark the initial history sync complete only after all pages have been processed.
6. Save the latest submission ID as the incremental sync checkpoint.

This initial scan can take time for accounts with extensive histories because of the API rate limit. Show a visible sync state (for example, “Importing your Codeforces history”) and allow the user to use features that do not require the solved cache if appropriate. Do not pretend a partial scan is complete.

After the initial scan, incremental synchronization should process new submissions and update the solved cache. A newly observed `OK` submission adds the corresponding problem to the solved cache.

### 7.5 Active-round submission synchronization

- Maintain one synchronization schedule per unique verified Codeforces handle, not one request per round.
- Multiple active rounds belonging to the same owner should share the same submission fetch.
- Poll active handles on a best-effort interval (an initial target of 15–30 seconds is reasonable for a low-volume MVP, subject to the global API limiter and active-user count).
- Fetch recent submissions, deduplicate by submission ID, and associate each submission with matching active round problems.
- Store only the submission fields required for round tracking. Do not keep source code.
- Continue reconciliation briefly after a round ends so delayed API responses can be incorporated.
- Display `lastSyncedAt` and a stale/degraded indicator if synchronization is delayed.

The exact polling interval must be load-tested with the global two-second limit. It cannot be guaranteed for an unlimited number of simultaneously active users.

### 7.6 Problemset import and weekly refresh

Use the following data pipeline:

**Initial import**

1. Fetch `contest.list` and store contest metadata.
2. Fetch `problemset.problems` and its problem statistics.
3. Match each problem's `contestId` to contest metadata.
4. Derive the UTC year from `startTimeSeconds`.
5. Upsert the problem metadata and statistics.
6. Record import counts, duration, last successful time, and errors.

**Weekly refresh**

1. Fetch the complete current problemset because the API does not expose a “created since” cursor/filter for this endpoint.
2. Compare returned records against stored problem keys.
3. Insert newly discovered problems whose contest year is the current UTC year.
4. Update changed current-year metadata and statistics.
5. Do not routinely rewrite archived historical years. Record any newly discovered non-current-year problem as an anomaly for review or a manual historical refresh.
6. Save a successful crawl timestamp only after the whole import transaction/batch has completed safely.

**Year rollover**

At the start of a new UTC year:

- The previous year becomes historical/archive data.
- Run a full initial import for the new current year.
- Continue weekly full-response comparisons, applying normal updates to the new current year.

Use idempotent upserts and batch database writes. A failed crawl must not leave a half-updated state that appears successful.

---

## 8. Data model

The schema below is a logical design. Exact Prisma field names and database types can be refined during implementation, but ownership and uniqueness rules must be preserved.

### 8.1 `cf_users`

One row per linked Codeforces account.

| Field | Type / notes |
|---|---|
| `id` | UUID primary key |
| `handle` | Canonical handle returned by Codeforces |
| `handle_normalized` | Normalized lookup value; unique if compatible with Codeforces handle semantics |
| `rating` | Nullable integer snapshot |
| `rank` | Nullable string snapshot |
| `verified_at` | Timestamp |
| `history_sync_status` | `PENDING`, `RUNNING`, `COMPLETED`, `FAILED` |
| `history_sync_cursor` | Latest/oldest pagination checkpoint as needed |
| `last_seen_submission_id` | Incremental checkpoint |
| `last_synced_at` | Timestamp |
| `next_sync_at` | Scheduler field |
| `created_at`, `updated_at` | Timestamps |

Do not use the public handle itself as the authorization secret.

### 8.2 `owner_sessions`

| Field | Type / notes |
|---|---|
| `id` | UUID primary key |
| `cf_user_id` | FK to `cf_users` |
| `token_hash` | Hash of a cryptographically random opaque session token; unique |
| `expires_at` | Timestamp |
| `revoked_at` | Nullable timestamp |
| `created_at`, `last_used_at` | Timestamps |

The raw token is sent once in a secure HttpOnly cookie and is never stored in the database or logged. Rotate/revoke sessions as needed.

### 8.3 `verification_challenges`

| Field | Type / notes |
|---|---|
| `id` | UUID primary key |
| `handle` | Handle being verified |
| `target_contest_id`, `target_problem_index` | Verification problem identity |
| `baseline_submission_id` | Latest submission ID observed before challenge creation |
| `status` | `PENDING`, `VERIFIED`, `EXPIRED`, `CANCELLED` |
| `created_at`, `expires_at`, `verified_at` | Timestamps |

Add an index on `(handle, status, expires_at)`. Challenge consumption must be atomic.

### 8.4 `contests`

| Field | Type / notes |
|---|---|
| `contest_id` | Codeforces contest ID; primary key |
| `name` | Contest name |
| `type` | Contest type (`CF`, `IOI`, `ICPC`) where provided |
| `start_time_seconds` | Nullable Unix timestamp |
| `start_year_utc` | Nullable derived year |
| `phase` | Current/last known phase |
| `fetched_at` | Last import timestamp |

### 8.5 `problems`

| Field | Type / notes |
|---|---|
| `problem_key` | Stable primary key string |
| `contest_id` | Nullable integer / FK to contest metadata when available |
| `problemset_name` | Nullable string |
| `problem_index` | Problem index such as `A`, `B1`, `F2` |
| `name` | Problem name |
| `type` | `PROGRAMMING` or `QUESTION` where returned |
| `rating` | Nullable integer |
| `tags` | PostgreSQL `text[]` |
| `solved_count` | Nullable integer |
| `year` | Nullable small integer derived from contest start time |
| `problem_url` | Canonical URL generated/validated by the backend |
| `source_fetched_at` | Timestamp |
| `updated_at` | Timestamp |

Indexes:

- B-tree on `rating`.
- B-tree on `year`.
- B-tree on `(year, rating)`.
- GIN index on `tags`.
- Unique key for Codeforces problem identity.

Problems with no reliable year or no rating can remain stored, but they must not match a year- or rating-specific round unless the product explicitly defines such behavior.

### 8.6 `user_solved_problems`

This is a derived cache of problems accepted by a verified user before or outside a particular round.

| Field | Type / notes |
|---|---|
| `cf_user_id` | FK |
| `problem_key` | FK to `problems` |
| `first_solved_at` | Timestamp |
| `accepted_submission_id` | Codeforces submission ID |
| `last_confirmed_at` | Timestamp |

Use `(cf_user_id, problem_key)` as the primary/unique key.

### 8.7 `rounds`

| Field | Type / notes |
|---|---|
| `id` | UUID primary key |
| `owner_user_id` | FK to `cf_users` |
| `status` | `LOBBY`, `RUNNING`, `COMPLETED`, `CANCELLED` |
| `target_rating` | Integer |
| `year_mode` | `SELECTED` or `RANDOM` |
| `selected_years` | Integer array |
| `duration_minutes` | Integer |
| `problem_count` | Integer |
| `selected_tags` | Text array |
| `tag_match_mode` | Nullable `ALL` / `ANY` |
| `include_solved` | Boolean |
| `started_at`, `ends_at`, `completed_at` | Nullable timestamps as appropriate |
| `created_at`, `updated_at` | Timestamps |

Add `(owner_user_id, created_at DESC)` for dashboard history. Every read/update/delete must check `owner_user_id` from the authenticated session.

### 8.8 `round_problems`

| Field | Type / notes |
|---|---|
| `id` | UUID primary key |
| `round_id` | FK to `rounds` |
| `problem_key` | FK to `problems` |
| `order_index` | Integer |
| `status` | `PENDING`, `IN_PROGRESS`, `PAUSED`, `SOLVED`, `EXPIRED` |
| `first_started_at` | Nullable timestamp |
| `accepted_at` | Nullable timestamp |
| `accepted_submission_id` | Nullable Codeforces submission ID |
| `accepted_submission_url` | Nullable URL |
| `attempt_count` | Cached integer |
| `failed_attempt_count` | Cached integer |
| `active_work_seconds` | Cached integer |
| `created_at`, `updated_at` | Timestamps |

Constraints:

- Unique `(round_id, problem_key)`.
- Unique `(round_id, order_index)`.
- Index `(round_id, status)`.

### 8.9 `problem_work_sessions`

| Field | Type / notes |
|---|---|
| `id` | UUID primary key |
| `round_problem_id` | FK to `round_problems` |
| `started_at` | Timestamp |
| `stopped_at` | Nullable timestamp |
| `stop_reason` | Nullable `MANUAL`, `ACCEPTED`, `ROUND_ENDED` |
| `created_at` | Timestamp |

Enforce at most one open work session per round problem. Use a partial unique index or a transaction/row lock to guarantee this under concurrent requests.

### 8.10 `round_problem_submissions`

Store only submissions relevant to a selected problem in a round.

| Field | Type / notes |
|---|---|
| `id` | UUID primary key |
| `round_problem_id` | FK to `round_problems` |
| `codeforces_submission_id` | Integer |
| `verdict` | Codeforces verdict string, nullable while pending |
| `creation_time_seconds` | Integer |
| `submission_url` | URL |
| `first_seen_at`, `last_seen_at` | Timestamps |

Unique `(round_problem_id, codeforces_submission_id)`. This table supports idempotent sync and accurate attempt counts without storing every submission in the user's account history.

### 8.11 `sync_runs` / worker state

Keep operational records for crawls and large account-history imports:

- Job type (`PROBLEMSET_INITIAL`, `PROBLEMSET_WEEKLY`, `USER_HISTORY_IMPORT`, `USER_INCREMENTAL_SYNC`, `ROUND_RECONCILIATION`).
- Status (`QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`).
- Started/completed timestamps.
- Pages/records processed.
- Error code/message (sanitized).
- Retry count.

These records make failed synchronization diagnosable and prevent the UI from displaying false success.

---

## 9. Backend module structure and API contract

### 9.1 Suggested repository layout

```text
rateforces/
├── apps/
│   ├── web/
│   │   └── src/
│   │       ├── app/
│   │       ├── pages/
│   │       ├── features/
│   │       │   ├── auth/
│   │       │   ├── dashboard/
│   │       │   ├── round-builder/
│   │       │   ├── round-room/
│   │       │   └── round-results/
│   │       ├── components/
│   │       ├── hooks/
│   │       ├── lib/
│   │       └── styles/
│   ├── api/
│   │   └── src/
│   │       ├── app.ts
│   │       ├── server.ts
│   │       ├── middleware/
│   │       └── modules/
│   │           ├── auth/
│   │           ├── codeforces/
│   │           ├── problemset/
│   │           ├── rounds/
│   │           └── health/
│   └── worker/
│       └── src/
│           ├── worker.ts
│           ├── scheduler/
│           └── jobs/
├── packages/
│   ├── database/
│   │   ├── prisma/
│   │   └── src/
│   ├── shared/
│   │   └── src/
│   └── config/
├── docs/
├── package.json
└── pnpm-workspace.yaml
```

The exact workspace tool can be chosen by the implementation agent. A pnpm workspace is a sensible default. Do not create a separate package for every small helper.

### 9.2 Backend modules

**`auth`**

- Verification challenge lifecycle.
- Owner session creation, validation, refresh/revocation.
- Authenticated-user middleware.
- Ownership authorization helpers.

**`codeforces`**

- Typed Codeforces API client.
- Global request limiter.
- API response parser and error mapping.
- User info and submission synchronization services.
- Problem/contest normalization.

**`problemset`**

- Initial/weekly import.
- Contest-year mapping.
- Tag/rating/year filter queries.
- Eligible-problem count and selection query.

**`rounds`**

- Round creation and validation.
- Round lifecycle transitions.
- Problem work-session commands.
- Submission-to-round matching.
- Round results and analytics calculations.

**`health`**

- Liveness and readiness endpoints.
- Database connectivity status.
- Worker heartbeat / last successful crawl status (without exposing secrets).

### 9.3 REST API endpoints

Use a versioned prefix: `/api/v1`.

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/auth/verification` | Start verification for a Codeforces handle. |
| `GET` | `/auth/verification/:challengeId` | Check verification status; issue session cookie once verified. |
| `POST` | `/auth/logout` | Revoke current session and clear cookie. |
| `GET` | `/me` | Return verified owner profile and sync status. |
| `GET` | `/problemset/filters` | Return available years, ratings, and tags. |
| `GET` | `/problemset/preview` | Return eligible count for a validated draft configuration. |
| `POST` | `/rounds` | Generate and save a round in `LOBBY`. |
| `GET` | `/rounds` | List rounds owned by the authenticated user. |
| `GET` | `/rounds/:roundId` | Get a round and its problem states. |
| `POST` | `/rounds/:roundId/start` | Start a `LOBBY` round. |
| `POST` | `/rounds/:roundId/problems/:problemId/start` | Start/resume a problem work session. |
| `POST` | `/rounds/:roundId/problems/:problemId/stop` | Pause a problem work session. |
| `GET` | `/rounds/:roundId/results` | Get completed results and chart series. |
| `DELETE` | `/rounds/:roundId` | Cancel/delete a `LOBBY` round according to retention rules. |
| `GET` | `/health` | Liveness/readiness status. |

Do not add a client-callable endpoint that triggers arbitrary Codeforces polling. The worker owns external synchronization.

### 9.4 API conventions

- Validate every request body, query, and route parameter with Zod.
- Use a consistent response envelope, for example `{ data, error, requestId }`.
- Use meaningful HTTP status codes.
- Never return ORM records blindly. Map database rows to explicit response DTOs.
- Return UTC ISO timestamps (or clearly documented Unix seconds for Codeforces-derived values) consistently.
- Use pagination for round history if it grows.
- Add request IDs to logs and error responses.
- Never expose stack traces, database errors, raw Codeforces error payloads, or token hashes to the client.

---

## 10. Frontend pages and interaction requirements

### 10.1 Pages

1. **Landing / Link account**
   - Product explanation in one or two sentences.
   - Codeforces handle input.
   - Verification instructions and current challenge status.
   - No email/password registration flow.

2. **Dashboard**
   - User handle and current profile snapshot.
   - Create-round primary action.
   - Recent rounds with status, rating, duration, date, and solve count.
   - Codeforces history sync state when relevant.

3. **Round builder**
   - Rating selector.
   - Year selector with selected/multiple/random mode.
   - Duration input.
   - Problem count input.
   - Searchable tag multi-select.
   - All-tags / Any-tag selector.
   - Include-solved checkbox.
   - Live eligible-problem count and helpful empty-state messages.
   - Create button disabled when configuration is invalid or the eligible count is insufficient.

4. **Round lobby**
   - Round configuration summary.
   - Selected problem list and Codeforces links.
   - Clear **Start round** action.
   - The countdown must not run in the lobby.

5. **Running round**
   - Prominent countdown.
   - Solved / remaining progress.
   - Compact problem list/table.
   - Open problem, start work, pause/resume controls.
   - Attempt count and accepted submission link.
   - Visible sync freshness indicator.

6. **Round results**
   - Summary metrics.
   - Accepted/remaining timeline chart.
   - Detailed problem table.
   - Clear handling for problems with unavailable active-work time.

### 10.2 Running-round data refresh

The frontend should refresh the round state from the backend periodically (for example, every 5 seconds while active) using TanStack Query. This is independent of Codeforces polling: the worker polls Codeforces at a slower, centrally limited interval and the frontend reads the latest stored result.

A WebSocket or Server-Sent Events channel is not necessary for the MVP. Add one only if measured latency or request volume justifies it.

### 10.3 UX states

Every async feature must have:

- Loading state.
- Empty state.
- Success state.
- Recoverable error state with retry.
- Offline/degraded state where relevant.

Do not silently show stale submission status as live. Display `Last synced ...` and use a neutral stale indicator when the last successful synchronization is old.

---

## 11. Visual design direction

The interface should feel close to a focused developer utility: clean, compact, and quick, not like a large social platform.

### 11.1 Design characteristics

- Minimal navigation and few top-level screens.
- Calm neutral backgrounds with restrained accent colors.
- Comfortable contrast in both themes.
- Clear typography hierarchy; use tabular numerals for timers and metrics.
- Compact but readable problem rows.
- Consistent spacing and alignment.
- Subtle borders and surface changes rather than heavy shadows.
- Minimal transitions; avoid distracting animations during a timed round.
- Responsive layout, with the running timer and key actions remaining visible on mobile.

### 11.2 Suggested palette direction

Use theme tokens rather than hard-coded colors in components. Starting point (adjust after visual review):

**Light theme**

- Background: soft cool off-white (`#F6F8FA`).
- Main surface: white (`#FFFFFF`).
- Secondary surface: very light slate (`#EEF2F6`).
- Main text: deep slate (`#17212B`).
- Muted text: slate gray (`#667085`).
- Borders: soft gray (`#DDE3EA`).
- Accent: calm blue/teal (`#3478A8` or `#238A88`).
- Success: muted green; warning: warm amber; error: restrained red.

**Dark theme**

- Background: deep blue-charcoal (`#111820`).
- Main surface: `#18222D`.
- Secondary surface: `#202D3A`.
- Main text: soft near-white (`#E8EEF4`).
- Muted text: cool gray (`#A0ADBA`).
- Borders: `#2D3B49`.
- Accent: slightly brighter blue/teal with sufficient contrast.

These are starting tokens, not final brand colors. Verify contrast ratios for text, controls, focus rings, and status indicators. Never communicate solved/unsolved state by color alone; include text or an icon label.

### 11.3 Theme behavior

- Provide a visible Light / Dark / System preference.
- Persist the selected preference locally in the browser.
- Respect `prefers-color-scheme` for System.
- Avoid flashing the wrong theme before React loads.

**Design reference note:** The reference URL was reachable but returned no readable page content in the inspection, and no image attachment was available in the conversation files. The implementation agent should use the user's supplied reference image when it is available, while following the visual direction above in the meantime.

---

## 12. Security, privacy, and ownership

### 12.1 No password account, but authenticated ownership is still required

A verified Codeforces account identifies the owner, but the public handle is not a secret. After verification, issue a cryptographically random opaque session token and store only its hash in the database.

Recommended browser session:

- `Secure` cookie in production.
- `HttpOnly`.
- `SameSite=Lax` (or stricter if compatible with deployment).
- Appropriate expiration and revocation.
- HTTPS only.

Use Origin checks and CSRF protection appropriate to the cookie setup. Keep CORS restricted to the deployed frontend origin.

### 12.2 Owner-only access

Every round query and mutation must be scoped to the authenticated `cf_user_id`. A UUID is not authorization. Do not rely on hiding buttons in React; enforce ownership in the API/service layer and preferably use database constraints where useful.

### 12.3 Data minimization

- Store Codeforces handle and only the profile fields needed by the UI.
- Store only solved-problem keys for the historical solve cache.
- Store only submissions relevant to a particular round, plus required synchronization checkpoints.
- Do not fetch or retain source code.
- Do not expose one user's round history to another user.
- Provide a way to revoke the session and, later, delete all RateForces data for a linked handle.

### 12.4 Operational security

- Keep secrets in environment variables or a secret manager.
- Validate and normalize handles and tags.
- Add request rate limits to verification and round-generation endpoints.
- Prevent repeated verification challenges from becoming an API-polling abuse vector.
- Use SQL transactions for challenge consumption, round start, and work-session transitions.
- Avoid logging cookies, bearer tokens, or sensitive authentication values.

---

## 13. Reliability, performance, and scalability

### 13.1 Database query performance

- Use the rating/year composite index and GIN tag index for round generation.
- Store `year` as a materialized column instead of calculating it at query time.
- Store cached round counters for fast active-round rendering, but retain the underlying submission/work-session rows as the source for recomputation.
- Use batched upserts for problemset crawls.
- Keep all Codeforces API calls outside user-facing request handlers when they may take a long time.

### 13.2 Worker concurrency

- Run a single worker initially.
- Use PostgreSQL locks/leases (`FOR UPDATE SKIP LOCKED` or an equivalent safe lease mechanism) when claiming jobs.
- Ensure only one weekly problemset crawl runs at a time.
- Ensure a Codeforces handle cannot be synchronized concurrently by multiple workers.
- Use bounded retries and a dead-letter/failed status rather than infinite retry loops.

### 13.3 Failure handling

| Failure | Expected behavior |
|---|---|
| Codeforces API timeout | Keep the last known state, retry with backoff, show stale sync status. |
| Codeforces rate-limit error | Requeue after a safe delay; do not rapidly retry. |
| Weekly crawl fails | Preserve the previous complete problemset snapshot; report failed job. |
| User history import fails | Retain progress/checkpoint and resume safely. |
| Browser closes during round | Round and Codeforces sync continue on the backend. |
| Browser clock is wrong | Server timestamps remain authoritative. |
| User opens a private round URL while logged out | Redirect to account linking; after login, enforce ownership. |
| User submits after round end | Do not count it for that round. |
| Codeforces submission appears late in API | Reconcile based on its actual creation timestamp. |

### 13.4 Retention

Keep rounds and results until the owner deletes them or a future retention policy is introduced. Keep the global problemset as shared reference data. Define a cleanup policy for expired verification challenges and revoked sessions.

---

## 14. Analytics definitions

Use consistent calculations in one backend analytics service.

### 14.1 Core metrics

- `totalProblems`: number of problems selected for the round.
- `solvedProblems`: number with a qualifying accepted submission inside the round interval.
- `remainingProblems`: `totalProblems - solvedProblems`.
- `solveRate`: `solvedProblems / totalProblems * 100`.
- `attemptCount`: number of final-verdict submissions for the problem during the round.
- `failedAttemptCount`: number of final-verdict submissions whose verdict is not `OK`.
- `roundElapsedToAcceptance`: `accepted_at - round.started_at`.
- `activeWorkSeconds`: sum of recorded work-session durations.
- `averageActiveWorkSeconds`: arithmetic mean of active work time among solved problems with a recorded work start/session.
- `longestActiveWorkSeconds`: maximum active work time among solved problems with recorded work time.

If no solved problem has work-session data, average and longest active work time should be shown as unavailable, not zero.

### 14.2 Timeline chart

Recommended chart:

- X-axis: elapsed round time, starting at 0 and ending at the configured duration.
- Series 1: cumulative accepted problems (step line; increments at each accepted timestamp).
- Series 2: remaining unsolved problems (step line; decrements at each accepted timestamp).

The chart should use accepted submission timestamps from Codeforces, not the time at which the worker happened to poll the API. Sort accepted events by `creationTimeSeconds`. If multiple acceptances share the same second, apply a stable ordering by submission ID.

### 14.3 Missing work-time data

A user can submit without pressing Start working. In that case:

- The problem still counts as solved if the accepted timestamp falls within the round.
- Attempts and accepted submission link are still displayed.
- Active work time is `N/A`.
- Exclude it from active-work averages and longest-active-work calculations.

This prevents misleading statistics.

---

## 15. Testing strategy

### 15.1 Unit tests

- Tag `ALL` and `ANY` matching.
- Exact rating filtering.
- Selected-year and random-year-mode filtering.
- Previously solved exclusion.
- Random distinct problem selection and insufficient-candidate handling.
- Problem key construction and Codeforces URL construction.
- Unix timestamp conversion and UTC year derivation.
- Round state transitions.
- Work-session start, pause, resume, acceptance auto-stop, and round-end auto-stop.
- Attempt counting and submission deduplication.
- Accepted submission boundary conditions (`started_at`, `ends_at`).
- Average/longest active-work calculations.

### 15.2 Integration tests

Use a test PostgreSQL database and mock Codeforces API responses.

- Verification success, expiration, stale submission, wrong problem, wrong verdict, and duplicate challenge consumption.
- Initial user history import over multiple pages.
- Incremental user sync and reprocessing a pending submission after its verdict changes.
- Weekly problemset upsert and idempotent re-run.
- Round creation and ownership enforcement.
- Starting the round and rejecting a second start.
- Cross-owner access denied for read, start, pause, and delete.
- Submission sync updates only matching active/completed rounds.
- Late-discovered accepted submission inside the round window updates final result.

### 15.3 End-to-end tests

- Link a test Codeforces handle (or use a deterministic mocked integration environment).
- Generate a round with a known fixture problemset.
- Verify lobby has no running countdown.
- Start the round and see the countdown.
- Start/pause/resume a problem.
- Simulate wrong answer and accepted submissions.
- Verify attempts, solved state, acceptance time, and submission link.
- Let the round expire and inspect the result chart.
- Switch light/dark themes and verify responsive layouts.

### 15.4 External integration contract tests

Keep sample sanitized API responses for `user.info`, `user.status`, `problemset.problems`, and `contest.list`. Tests should protect the normalizer against missing optional fields, null ratings, missing contest timestamps, and absent verdicts.

---

## 16. Implementation roadmap

Build in vertical slices. Each phase should leave the application runnable.

### Phase 0 — Repository and foundations

- Create the workspace and TypeScript configurations.
- Set up React/Vite frontend, Express API, worker entry point, PostgreSQL, and Prisma.
- Add health endpoint, environment validation, lint/format scripts, and test runner.
- Add shared API response types and error handling.
- Create the initial migration.

**Exit criteria:** local app starts, API health check passes, database connects, and migrations run from a clean database.

### Phase 1 — Codeforces data foundation

- Implement typed Codeforces API client and global rate limiter.
- Implement `contest.list` and `problemset.problems` import.
- Normalize contest/problem records and derive UTC year.
- Store ratings, tags, and problem statistics.
- Add initial admin/dev-only crawl command and weekly worker schedule.
- Add filter endpoint for years, ratings, and tags.

**Exit criteria:** database contains searchable problem data and repeated imports are idempotent.

### Phase 2 — Account verification and owner sessions

- Implement handle validation.
- Implement challenge creation and CE detection on the configured special problem.
- Implement secure session cookies and authenticated-user middleware.
- Implement dashboard profile display.
- Implement initial solved-history import and incremental checkpointing.

**Exit criteria:** a user can prove control of a Codeforces handle without a RateForces password and can access only their own session.

### Phase 3 — Round generation and lobby

- Implement configuration validation and eligible-problem query.
- Implement tag modes, year modes, include-solved behavior, and exact rating filter.
- Implement candidate count preview.
- Generate and persist an immutable problem selection.
- Build round builder, dashboard history, and lobby screen.

**Exit criteria:** users can create a valid round, see its selected problems, and the timer remains stopped until Start is pressed.

### Phase 4 — Running round and submission sync

- Implement server-authoritative start and end timestamps.
- Implement work-session start/pause/resume.
- Implement per-handle active submission polling.
- Match submissions to round problems and deduplicate them.
- Auto-solve on accepted verdict and auto-stop active work sessions.
- Build running-round UI, timer, progress, attempts, accepted links, and sync freshness.

**Exit criteria:** a real or mocked Codeforces accepted submission updates the correct running round without browser-side polling of Codeforces.

### Phase 5 — Results and analytics

- Finalize expired rounds.
- Implement metrics and timeline chart.
- Implement late-sync reconciliation.
- Build the results page and complete-round history view.

**Exit criteria:** all calculations are covered by tests and the result page can be reproduced from stored events.

### Phase 6 — Polish and release readiness

- Implement light/dark/system theme.
- Responsive layouts and accessibility pass.
- Add rate-limit/error/stale-data UX.
- Add structured logs, worker health, database backups, and deployment configuration.
- Run end-to-end tests and a small concurrency test for multiple active handles.

**Exit criteria:** deployable MVP with documented environment variables, migrations, worker startup, recovery steps, and smoke tests.

### Later features (not required for MVP)

- Share/invite links. Recommended model: share a round definition or problem set, but give every participant their own independent round state and Codeforces account linkage. Never mix participants' attempts or work times.
- Custom round titles and reusable presets.
- Export results (CSV/JSON/image).
- More advanced year distribution (uniform by year, weighted by year, or one random year).
- Other judges, only after the Codeforces integration is stable.

---

## 17. MVP acceptance criteria

The MVP is complete only when all of the following are true:

1. A user can verify a Codeforces handle through a new CE submission on the configured problem.
2. The user does not need a RateForces email/password registration.
3. Only the verified owner can read or modify their rounds.
4. The system has a stored Codeforces problemset with rating, tags, and derived year.
5. Weekly problemset refreshes are idempotent and centrally rate-limited.
6. A user can generate a round with exact rating, year selection, duration, problem count, tags, ALL/ANY behavior, and include-solved option.
7. The generated round opens in a lobby and does not start until the owner presses Start.
8. The backend owns `started_at` and `ends_at`.
9. The user can manually start, pause, and resume work tracking for a problem.
10. Accepted submissions are detected from Codeforces and automatically mark matching round problems solved.
11. The system records attempts, accepted timestamp, and accepted submission URL.
12. The countdown, solved count, remaining count, and sync freshness are shown during the round.
13. The completed round displays accurate result metrics and the accepted/remaining timeline chart.
14. A browser closing does not stop the round or its backend synchronization.
15. Light and dark themes are usable and responsive.
16. Automated tests cover selection logic, lifecycle/timing, verification, ownership, submission deduplication, and analytics.

---

## 18. Open questions to confirm before implementation

The specification uses reasonable defaults so development can begin, but these points should be confirmed before the corresponding feature is finalized.

### Q1. Number of problems

How many problems should a round contain? Recommendation: make it a required numeric setting, with a sensible default (for example, 5) and an allowed range chosen after testing.

### Q2. Meaning of Random year

Should Random mean:

- A. Select problems randomly across all years; or
- B. Choose one random year, then select all round problems from that year?

Recommendation: A for more varied rounds.

### Q3. Rating selection

Should the rating be an exact problem rating (recommended for the MVP), or should the user select a range such as 1500–1700?

### Q4. Attempt count

The proposed definition counts every final-verdict submission during the round, including the accepted submission. Should the UI also show a separate wrong/failed-attempt count? Recommendation: yes, show both when useful.

### Q5. Manual Stop behavior

The proposed behavior treats Stop as Pause, allowing the user to resume later and accumulating active work time across multiple work sessions. Is that what you intend?

### Q6. Previously solved history

Are you comfortable with the first account link triggering a full historical `user.status` scan? It may take time for accounts with very large submission histories because of Codeforces' API request limit. Recommendation: yes, with visible progress and safe resumability.

### Q7. Inviting other users

Should invitations be included in the first release? Recommendation: postpone them. Later, make each participant's run and problem state independent, even when they use the same shared problem set.

### Q8. Gym and custom problemsets

Should the initial dataset include only the regular Codeforces problemset, or also Gym/custom problemsets? Recommendation: regular problemset only for MVP; Gym/custom sets add access and year-mapping edge cases.

### Q9. Round deletion and history

Can owners delete completed rounds, or should completed history be permanent? Recommendation: allow owner deletion with a confirmation; do not auto-delete.

### Q10. Account handle changes

If a user renames their Codeforces handle, should they re-verify the new handle and keep their old RateForces round history under the same owner identity? Recommendation: support re-verification and preserve historical rounds, but treat it as a separate account-management feature after the MVP.

---

## 19. Instructions for the AI coding agent

Treat this document as the source of truth unless the product owner gives a newer decision.

1. Before changing code, inspect the existing repository and report its current structure, stack, and conventions. Do not overwrite an existing project blindly.
2. Implement the phases in order. Do not jump straight to UI polish while the data model and Codeforces integration are untested.
3. Do not invent Codeforces API fields. Use the official API documentation and the response fixtures in tests.
4. Centralize Codeforces requests and enforce the global rate limit. No browser component may call Codeforces directly.
5. Keep all timestamps in UTC in the backend/database. Convert them for display only at the UI boundary.
6. The backend is authoritative for round lifecycle, work-session transitions, submission matching, and analytics.
7. Use database transactions/locks for state transitions that could race.
8. Make synchronization idempotent. Re-running a job or receiving the same submission twice must not duplicate attempts or solve events.
9. Enforce ownership on every round endpoint. Never assume a UUID is a permission check.
10. Keep the application a modular monolith. Do not introduce microservices, Redis, WebSockets, or complex infrastructure without a demonstrated need.
11. Avoid giant components and giant service files. Organize by feature and keep domain logic in independently testable functions.
12. Use explicit DTOs between frontend and backend. Do not expose Prisma models directly.
13. Add tests alongside each feature; do not postpone all testing until the end.
14. Do not silently weaken problem filters when there are not enough candidates.
15. Do not fabricate work time when the user did not start a problem timer.
16. Do not count submissions made after the round end as accepted during the round.
17. Build accessible loading, empty, stale, and error states.
18. Keep visual design consistent through shared theme tokens and reusable components.
19. Document environment variables, migrations, worker startup, local development, and deployment commands.
20. At the end of each phase, provide: files changed, decisions made, tests run, known limitations, and the exact next phase.

---

## 20. Source references and implementation notes

Official Codeforces API documentation used for the integration design:

- API introduction, response envelope, anonymous access, and request frequency: <https://codeforces.com/apiHelp>
- API methods (`contest.list`, `problemset.problems`, `user.info`, `user.status`): <https://codeforces.com/apiHelp/methods>
- API objects (`Contest`, `Problem`, `Submission`, `User` and their fields): <https://codeforces.com/apiHelp/objects>

The documented API behavior can change. Re-check these official pages and test the real API before production deployment, especially the request limit, returned fields, and verification-problem behavior.
