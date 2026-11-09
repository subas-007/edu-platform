# Material pipeline fixes — 2026-11-09

Fixes for four problems found during student testing. All four came from **one failure in the
generation pipeline plus a UI that hid it**.

## Reported problems

1. After uploading a material, no flashcards or exam questions were generated, and no roadmap was shown.
2. The Flashcards page did not show the newly uploaded document.
3. The AI tutor replied "Sorry, the tutor is unavailable right now."
4. Learning & exam mode did not list the latest uploaded material.

## Root causes

| # | Cause |
|---|---|
| 1 | Flashcard/question/roadmap generation is a separate background job that runs after the document is read. On a CPU-only machine it takes 20+ minutes for a large PDF, and nothing was saved until the very end. The worker restarted mid-job, BullMQ failed the job as *"stalled more than allowable limit"*, and nothing retried it. The material still showed **Ready** with 0 flashcards, 0 questions and no roadmap. |
| 2, 4 | The Flashcards and Learning & exam pages only listed materials that already had flashcards or questions. A material whose generation failed, or was still running, did not appear at all. |
| 3 | The web app proxies `/api/v1` to the API through Next.js rewrites, which abort after **30 s** by default. A tutor answer takes about 10 s on an idle CPU model, but 1–2 minutes when it is queued behind generation calls. The proxy timed out and the UI showed a generic error. |
| — | A URL upload ("Vibe coding") failed because the site returned HTTP 403. The app retried three times and then showed "Processing failed. Please retry." |

## Changes

### Generation pipeline (API worker)
- **Generation status is tracked.** Migration `20261108180000_material_generation_status` adds
  `generation_status` (`PENDING | GENERATING | COMPLETED | FAILED`), `generation_progress` (0–100) and
  `generation_error` to `materials`. Existing rows are backfilled: rows with a roadmap become `COMPLETED`.
- **Progress is saved as it goes.** Each section's flashcards and questions are written to the database as soon as they
  are produced, so students see content appear while generation runs.
- **Restarts resume.** Completed section indexes are kept in the job data, so a restarted or retried job
  continues where it stopped. Workers allow 5 stalls (`maxStalledCount`) with a 120 s lock.
- **Self-healing.** The new `PipelineRecoveryService` runs in the worker on start-up and every 2 minutes. It
  re-queues processing or generation jobs that were lost or killed by a restart, and marks genuine failures as
  `FAILED` so the UI can offer Retry.
- **Shorter model queue.** Generation runs one material at a time and makes its model calls one after another,
  so tutor questions wait behind at most one call.
- **Configurable cost.** `GENERATION_MAX_BATCHES` (default 10; set to 5 on the CPU-only machine) limits model
  calls per material. A large PDF now takes about 10–15 minutes, and the first cards appear within minutes.
- **No silent empty results.** A run that produces no flashcards or questions ends as `FAILED` with an explanation.
- Re-running generation only deletes questions that no answer, paper or session references.

### Retry
- New endpoint `POST /study-materials/:id/retries`, available to the owner or `materials:moderate`.
  - A failed **processing** run re-ingests from the stored file or URL.
  - A failed **generation** run is re-queued, keeping any sections already saved.
  - Anything else returns `409`. Other users get `404`. Every retry is written to the audit log.
- `enqueueUniqueJob` removes a finished job before re-adding it under the same id. Otherwise BullMQ silently
  ignores the new job.

### Tutor
- The web proxy timeout is raised to 300 s (`experimental.proxyTimeout` in `apps/web/next.config.ts`).
- Tutor calls use `TUTOR_TIMEOUT_MS` (default 240 s) and are not retried, so the API answers before the proxy
  gives up.
- A model that is down, unreachable or timing out returns **503** with a readable message. The UI shows it, and
  after 15 s shows a "still thinking" hint.

### URL uploads
- A website answering with a 4xx status is now a permanent failure with a clear message, for example "The website
  refused access (HTTP 403). Save the page as a PDF and upload the file instead." It is no longer retried.
  5xx responses are still retried.

### Web UI
- A single pipeline badge everywhere: Queued → Reading document → Generating *n*% → Ready / Failed.
- **Flashcards** and **Learning & exam mode** list every document, newest first, with its status:
  - while a document is generating, the page shows a progress bar;
  - if something failed, it shows the reason and a **Retry** button;
  - new cards are added to the deck without losing the student's place.
- The material study page shows generation progress and Retry, and loads the roadmap once generation finishes.
- My materials, the dashboard and the admin/examiner library show generation status and Retry.
- The "is ready" notification now fires when flashcards and questions are actually done.

## Configuration

New optional variables in `apps/api/.env` (documented in `.env.example`):

```env
GENERATION_MAX_BATCHES=5   # 10 with a GPU or hosted model
TUTOR_TIMEOUT_MS=240000    # keep below the 300 s web proxy timeout
```

## Verification

| Check | Result |
|---|---|
| API and web typecheck, web production build | pass |
| Security smoke test (`npm run test:smoke`) | 40/40 |
| Feature end-to-end suite | 59/59 (10 new: status/progress, retry 202/409/404, failed-processing retry, HTTP 403 message) |
| Tutor through the web proxy on :3005 while generation was running | **200 in 119 s** (would previously fail at 30 s) |
| Recovery of the real stalled material | re-queued automatically after the worker restart; at 45% it already had 11 flashcards and 8 questions |
| Student pages (`/student`, materials, flashcards, practice, tutor) on the dev server | render with HTTP 200 |

Not yet done: a visual pass in a browser.

## Deploying

1. `cd apps/api && npx prisma migrate deploy && npx prisma generate`
2. Restart the API, the worker and the web app.
3. Materials left half-generated by the old code are picked up automatically by the worker within about 2 minutes.
