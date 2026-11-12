# Edu Platform

Secure, AI-assisted study platform with three isolated roles (Admin, Examiner, Student), a multimodal
ingestion pipeline (PDF, DOCX, PNG/JPEG via OCR, web URLs), RAG tutoring on pgvector, AI-generated
flashcards / questions / roadmaps, and a dual-mode (Learning / Exam) assessment engine.

```
Browser ──HTTPS──► Next.js (apps/web)  ── /api/v1/* proxied ──►  NestJS API (apps/api)  ──► PostgreSQL 16 + pgvector
          edge middleware verifies JWT                          global guards:                ▲
          with PUBLIC key only                                  throttle → authn → RBAC       │
                                                                        │ enqueue             │
                                                                        ▼                     │
                                                                 Redis / BullMQ ──► Worker process (apps/api/src/worker.ts)
                                                                                    parse → OCR → chunk → embed → generate
```

## Quick start

```bash
docker compose up -d                       # Postgres+pgvector & Redis on loopback
                                           # (port clash? put POSTGRES_HOST_PORT=55432 in ./.env)
cd apps/api
cp .env.example .env
npm install
npm run keys:generate                      # paste private+public into apps/api/.env, public into apps/web/.env.local
npm run llm:setup                          # local model in Ollama (see "AI models" below); set SEED_ADMIN_PASSWORD in .env
npm run db:deploy                          # applies migrations, incl. the HNSW vector index
npm run db:seed                            # first admin — then delete SEED_ADMIN_PASSWORD from .env
npm run dev:api                            # :4000
npm run dev:worker                         # separate terminal

cd ../web
cp .env.example .env.local                 # JWT_PUBLIC_KEY_B64 + API_INTERNAL_URL
npm install && npm run dev                 # http://localhost:3005
```

### AI models: local (free) or hosted (student's own key)

Each student chooses under **Settings → AI model** who answers their tutor questions and writes flashcards and
questions from the documents they upload:

| Option | Cost | Speed (measured, i7-13620H CPU) | Privacy |
|---|---|---|---|
| **Local model** (default): Qwen3 4B in [Ollama](https://ollama.com) on this server | free | tutor answer ~20–35 s; one flashcard call ~40 s | documents never leave the server |
| **Hosted model**: the student's own API key for Anthropic, OpenAI, Google Gemini, Groq or OpenRouter | billed to the student's account | seconds | the passages answering each question go to that provider (the page says so) |

Staff uploads always use the local model. Document search (embeddings) always runs in-process with
`nomic-ai/nomic-embed-text-v1.5` (768 dims, ~520 MB downloaded once into `apps/api/.cache/models`), so it is the same
whichever model answers.

**Local model setup.** Install Ollama (`winget install Ollama.Ollama` on Windows), then `npm run llm:setup` in
`apps/api`. It pulls `qwen3:4b-instruct` (2.5 GB) and builds `edu-chat` from
[`apps/api/ollama/edu-chat.Modelfile`](apps/api/ollama/edu-chat.Modelfile) with an 8k context (Ollama's 4k default is
too small for a generation prompt plus its JSON answer). In `apps/api/.env`: `LLM_BASE_URL=http://127.0.0.1:11434/v1`,
`LLM_API_KEY=ollama`, `LLM_CHAT_MODEL=edu-chat`, `LLM_JSON_MODE=json_object`. `npm run llm:bench` times one real
flashcard call.

Why this model: the earlier default, Qwen3.6-35B on colibri, needs ~22 GB and did not fit in this laptop's free RAM,
so it re-read weights from disk on every question (prompt reading 4–12 tokens/s; a tutor answer took 2–9 minutes).
Qwen3 4B fits in RAM: prompt reading ~85 tokens/s, writing ~12–14 tokens/s. Same tutor question, same passages:

| Model | First words | Full answer |
|---|---|---|
| Qwen3.6-35B on colibri (warm) | 82 s | 110 s |
| **Qwen3 4B on Ollama** | **10 s** | **22 s** |

`qwen3.5:4b` was also tried and dropped: it "thinks" before answering and spent the whole answer budget on hidden
reasoning. colibri still works (`npm run llm:start`, `LLM_BASE_URL=http://127.0.0.1:8000/v1`, `LLM_JSON_MODE=prompt`).

**Hosted models.** Set `LLM_CREDENTIALS_KEY` (32 random bytes, base64:
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`); without it only the local model is
offered. Then:

- Saving a hosted choice first makes one tiny test call with the key, so a wrong key, model or empty account is
  reported on the settings page, not mid-answer. **Load models from my account** lists the models the key can use.
- Keys are encrypted with AES-256-GCM before storage, never returned by the API (only `…last4`), usable only for that
  student's own requests, and deleted with **Delete my saved key**. Changes are audited without the key. Rotating
  `LLM_CREDENTIALS_KEY` makes saved keys unreadable; students are asked to enter them again.
- Provider endpoints are fixed in code ([`hosted-providers.ts`](apps/api/src/ai/providers/hosted-providers.ts)):
  students cannot point the server at another address.
- Claude models go through the official Anthropic SDK with effort `low` (short, factual answers) and, on Claude
  Opus 5.5 / Sonnet 5.5, server-side refusal fallbacks. The others use their OpenAI-compatible APIs.
- With a hosted model the tutor sends whole passages and more chat history, and uploads sample
  `GENERATION_MAX_BATCHES_HOSTED=10` sections. A key that stops working gives a clear message in the tutor, and
  generation stops with that reason instead of retrying.

**Tutor behaviour (both options).**

- The answer streams (`POST /tutor/queries/stream`, server-sent events): the UI names the model answering, shows
  each step (searching, picking passages, the model reading them with a progress bar and time estimate) and then the
  text as it is written. **Stop** cancels the model request.
- On the local model only the sentences most relevant to the question are sent, up to
  `TUTOR_CONTEXT_TOKENS=1200` (keyword pre-filter, then embedding similarity; ~3 s), with the last
  `TUTOR_HISTORY_MESSAGES=4` chat messages. A tutor question goes before background generation, which cancels its
  model call and repeats it afterwards (`TUTOR_PRIORITY=true`). Opening the tutor page warms the model up.
- Limits: `TUTOR_MAX_TOKENS=400`, `TUTOR_TIMEOUT_MS=180000`; the web proxy must allow longer
  (`API_PROXY_TIMEOUT_MS` in `apps/web/.env.local`).

**Generation.** A student upload is only stored and indexed: the tutor can use it at once, and it gets a study
roadmap (sections and reading times) without a model call. On the document's study page the student then asks for
**flashcards** or **practice questions** separately, and picks the model for that run: **Local** (free) or
**Hosted** (the provider and key saved under Settings → AI model). Once some exist, **More** adds new ones (aimed
at the sections with the fewest so far, skipping repeats) and **Regenerate** writes a fresh set that replaces the
old one when it is ready (questions already answered are kept). The first run also names the roadmap sections.
**Stop** ends a queued or running run within a few seconds (the model call is cancelled); what it already made
is kept and nothing is removed, so a stopped Regenerate leaves the earlier set in place.
API: `POST /study-materials/:id/generations` with `{kind: FLASHCARDS|QUESTIONS, engine: LOCAL|HOSTED, mode: REPLACE|MORE}`;
`POST /study-materials/:id/generations/:kind/stop`.
Measured on the local model (2-section PDF): 6 flashcards in 45 s, 5 questions in about 2 min, 5 more flashcards in 18 s.

Staff uploads still generate flashcards, questions and the roadmap automatically after processing, sampling
`GENERATION_MAX_BATCHES=6` sections (questions go to the examiner review queue).
Each section is saved as soon as it is written, so items appear progressively, with a live percentage. Interrupted
work is resumed or re-queued by the worker (on start-up and every 2 min); real failures show **Retry** on the material
(`POST /study-materials/:id/retries`). `LLM_TIMEOUT_MS=300000` bounds each local call.

**Embeddings elsewhere.** `EMBEDDING_PROVIDER=api` with `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` uses an
OpenAI-compatible `/embeddings` endpoint instead. If the dimension changes, add a migration altering `vector(768)`
and re-ingest materials.

## Features by role

**Student workspace**: dashboard with stats; materials (upload by drag-and-drop); **flashcards** with deck/list
views and **PDF / CSV download** (CSV imports into Anki, Quizlet, Excel); **learning mode** (instant feedback with
explanation and source passage) and **exam mode** (timed, feedback only after submission); **AI tutor** that answers
only from the **documents the student selects**; **exam programs** to enroll in and sit; **results & certificates**
with a downloadable score card for every attempt and a **certificate PDF for exam-mode scores above 70%**.

**Examiner / administrator**: **question bank categorised by resource** (approve, reject, fix answers, filter by
concept); **exam programs**: assemble an ad-hoc question paper from the approved bank for chosen resources and
concepts (no extra AI calls), review it, then publish; students enroll and sit it with attempt limits; see each
candidate's results. Re-uploading an already-analysed document **reuses its chunks, embeddings, flashcards,
questions and roadmap** (matched by a content hash) instead of calling the LLM again.

**Shell**: dark slate-blue theme with aqua accents; collapsible sidebar (drawer on mobile); top bar with search
(`/` or Ctrl+K), notifications and a profile menu.

## Layout

| Path | Responsibility |
|---|---|
| `apps/api/src/common/security/permissions.ts` | **Single source of truth** for role → permission mapping |
| `apps/api/src/common/guards/` | `JwtAuthGuard` (authn, DB-backed revocation), `PermissionsGuard` (deny-by-default RBAC), Origin check |
| `apps/api/src/auth/` | ES256 access tokens, rotating refresh tokens with reuse detection, httpOnly cookies |
| `apps/api/src/study-materials/` | Upload/URL intake, magic-byte validation, private storage, `MaterialAccessPolicy` (object-level authz) |
| `apps/api/src/ingestion/` | Worker: extractors, SSRF-safe fetcher, chunker, embeddings, `MaterialReuseService` (content-hash dedup) |
| `apps/api/src/generation/` | Worker: resumable, progress-reporting flashcard/question (Zod-validated)/roadmap generation; `PipelineRecoveryService` re-queues interrupted work |
| `apps/api/src/tutor/` | RAG: authz-scoped vector search → grounded answer with citations |
| `apps/api/src/exam-sessions/` | Learning/Exam engine, row-locked answering & submission, diagnostics |
| `apps/api/src/exam-questions/`, `analytics/` | Question bank (by resource) & performance analytics |
| `apps/api/src/exam-papers/` | Exam programs: ad-hoc papers from the bank, enrollment, attempts |
| `apps/api/src/documents/` | Server-rendered PDFs: certificates, score cards, flashcard sheets |
| `apps/api/src/notifications/` | Derived notification feed |
| `apps/web/src/app/(admin|examiner|student)/` | Isolated role dashboards |
| `apps/web/src/components/shell/` | App shell: sidebar, search, notifications, profile menu |

### API surface (`/api/v1`, kebab-case)

| Method & route | Permission |
|---|---|
| `POST /auth/sessions`, `POST /auth/refresh`, `POST /auth/logout` | public (rate-limited) |
| `GET /auth/me` | authenticated |
| `GET/POST /users`, `PATCH /users/:id` | `users:manage` (Admin) |
| `GET /audit-logs` | `audit-logs:read` (Admin) |
| `GET /study-materials[/:id[/flashcards]]` (`?search=`) | authenticated + object policy |
| `GET /study-materials/:id/flashcards/export?format=pdf|csv` | authenticated + object policy |
| `POST /study-materials/files`, `POST /study-materials/urls` | `materials:upload` (all roles) |
| `PATCH /study-materials/:id/visibility` | `materials:publish` (Admin, Examiner) |
| `POST /study-materials/:id/generations` (generate flashcards or questions with a chosen model; replace or add more) | owner or `materials:moderate` |
| `POST /study-materials/:id/generations/:kind/stop` (stop that run; items already made are kept) | owner or `materials:moderate` |
| `POST /study-materials/:id/retries` (re-run failed processing or generation) | owner or `materials:moderate` |
| `DELETE /study-materials/:id` | owner or `materials:moderate` |
| `GET /exam-questions`, `GET /exam-questions/resources`, `PATCH /exam-questions/:id` | `questions:curate` (Admin, Examiner) |
| `GET/POST /exam-papers`, `GET/PATCH/DELETE /exam-papers/:id` | `exam-papers:manage` (Admin, Examiner) |
| `GET /exam-papers/available`, `POST /exam-papers/:id/{enrollments,sessions}` | `exams:take` (Student) |
| `GET /analytics/{frequently-missed-questions,concept-weaknesses,material-performance}` | `analytics:read` |
| `POST /tutor/queries`, `POST /tutor/queries/stream` (SSE), `POST /tutor/warmup` | `tutor:use` (Student) |
| `GET/PUT /me/ai-settings`, `POST /me/ai-settings/models`, `DELETE /me/ai-settings/key` | `tutor:use` (Student, own settings) |
| `POST /exam-sessions`, `POST /exam-sessions/:id/{answers,submissions}` | `exams:take` (Student, owner only) |
| `GET /exam-sessions` (own history) | `exams:take` |
| `GET /exam-sessions/:id`, `GET …/scorecard`, `GET …/certificate` (PDF) | owner or `exam-results:read-all` |
| `GET /notifications` | authenticated |
| `GET /study-roadmaps/:materialId`, `PUT …/progress` | `roadmaps:use` |

## Security controls

**Identity & sessions**
- argon2id password hashing; constant-time-ish login (dummy hash for unknown e-mails); generic errors.
- No self-registration — admins provision users (least privilege by default).
- ES256 access tokens (15 min) with pinned algorithm/issuer/audience; web tier holds only the **public** key.
- Opaque refresh tokens stored as SHA-256, rotated on every use; replay of a rotated token revokes the whole family.
- Each request re-reads `role`, `isActive`, `tokenVersion` from the DB → role changes/deprovisioning take effect immediately.
- Cookies: `httpOnly`, `SameSite=Strict`, `Secure` in production; refresh cookie scoped to `/api/v1/auth`.

**Authorisation**
- Global guards in order: rate limit → authenticate → RBAC. A route without an explicit policy is **denied** (fails closed).
- Object-level checks (`MaterialAccessPolicy`, session ownership) return 404 to avoid existence leaks.
- RAG retrieval is restricted to an already-authorised material id list, so the tutor can't leak private content.
- Students never receive `correctAnswer`/`explanation` during an exam; answer-key endpoints are examiner-only.

**Input handling**
- Zod `.strict()` schemas on every body/query (rejects mass-assignment like `{ "role": "ADMIN" }`); control-char stripping.
- Uploads: 20 MB cap, memory-only multer, **magic-byte** detection (client MIME/filename ignored), PNG dimension cap, server-generated storage keys, path-traversal guard, files outside web root with `0600`.
- URL ingestion: http(s) only, standard ports, no credentials; DNS-pinned connection lookup blocks private/loopback/link-local/metadata/IPv4-mapped/6to4 ranges (defeats DNS rebinding); every redirect re-validated; 5 MB/time limits; content-type allow-list; JSDOM without script execution.
- All SQL is parameterised (Prisma or tagged-template `$queryRaw`).

**LLM safety**
- Material text is wrapped in delimiters and declared untrusted data; delimiter-closing tags are neutralised.
- Tutor refuses without calling the LLM when no chunk passes the similarity threshold; prompt forbids outside knowledge.
- Generated JSON is Zod-validated (e.g. `correctAnswer` must match an option); staff-material questions require examiner approval before use in exams.
- Per-route rate limits on tutor & uploads (cost/abuse control).
- Students' hosted-model API keys: AES-256-GCM at rest (`LLM_CREDENTIALS_KEY` kept out of the database), never
  returned or logged, verified with a test call before saving, and only sent to a fixed list of provider endpoints (no
  user-supplied URLs, so no SSRF).

**Exam integrity**
- Certificates are generated server-side only for exam-mode results above 70%; exam-program answer keys are never shown to candidates (the bank stays reusable). Attempt limits are enforced under a row lock on the enrollment.
- Content-hash reuse never crosses access boundaries: students only reuse analysis from material they can already read, and receive only approved questions from someone else's material.
- Question set frozen at session start (crypto shuffle); server-side deadline; `SELECT … FOR UPDATE` serialises answer/submit races; Learning-mode answers locked after feedback (no answer farming).

**Transport & platform**
- Helmet, CORS allow-list, Origin check on all mutating requests, 256 KB JSON limit, CSP/HSTS/frame-deny headers on the web tier, audit log for auth events, provisioning, publishing, deletion and curation.

## Verified locally

Smoke-tested against a real Postgres+pgvector/Redis stack: 40 checks covering 401/403 paths, CSRF Origin
rejection, mass-assignment rejection, spoofed upload rejection, refresh-token rotation & reuse detection, IDOR on
materials and exam sessions, no answer-key leakage in Exam mode, concurrent double-submit (exactly one wins),
scoring & concept diagnostics, Learning-mode feedback/locking, analytics, instant revocation on deprovisioning,
pgvector cosine search, login throttling (429 after 5/min), and SSRF blocking (loopback, metadata IP, RFC1918,
IPv4-mapped IPv6, decimal IPs, and public hostnames that resolve to loopback).

### Re-running the checks yourself

```bash
cd apps/api
npm run typecheck && (cd ../web && npx tsc --noEmit)    # both should exit silently
npm run dev:api                                          # terminal 1 (needs Postgres + Redis up)
SMOKE_ADMIN_PASSWORD='<seeded admin password>' npm run test:smoke   # terminal 2 → "40/40 passed"
```

PowerShell: `$env:SMOKE_ADMIN_PASSWORD='...'; npm run test:smoke`. The run pauses ~60 s once when it hits the
5-per-minute login limit — that is the throttle working. It leaves two throwaway `student-*@example.com` /
`other-*@example.com` accounts behind (the first deactivated) and deletes its temporary materials.

## Production hardening checklist (not yet done)

- [ ] Object storage (S3/GCS) adapter + malware scanning (e.g. ClamAV) before ingestion.
- [ ] Run the worker in a sandbox (container with no inbound network, memory/CPU limits) — DOCX zip-bombs and OCR are the main resource risks.
- [ ] Self-host Tesseract `traineddata` (it currently downloads from a CDN on first use).
- [ ] Redis-backed throttler storage when running more than one API replica; per-account login lockout.
- [ ] Nonce-based CSP to drop `'unsafe-inline'`.
- [ ] Dedicated DB role without `UPDATE/DELETE` on `audit_logs`; secrets from a vault/KMS; key rotation via `kid`.
- [ ] MFA for Admin/Examiner; password reset flow; forced password change on first login for provisioned accounts.
- [ ] Unit/integration test suites (Jest + Testcontainers) and CI; OpenTelemetry tracing.
- [ ] `EMBEDDING_DIMENSIONS` ≠ 768 requires changing `vector(768)` in the schema and re-embedding.
