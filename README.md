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
# start the local model server (see "Local LLM" below); set SEED_ADMIN_PASSWORD in .env
npm run db:deploy                          # applies migrations, incl. the HNSW vector index
npm run db:seed                            # first admin — then delete SEED_ADMIN_PASSWORD from .env
npm run dev:api                            # :4000
npm run dev:worker                         # separate terminal

cd ../web
cp .env.example .env.local                 # JWT_PUBLIC_KEY_B64 + API_INTERNAL_URL
npm install && npm run dev                 # http://localhost:3005
```

### Local LLM (default)

All model calls stay on the machine, so no material text leaves it.

| Role | Served by | Model | Notes |
|---|---|---|---|
| Chat (tutor, flashcards, questions, roadmap) | [colibri](http://127.0.0.1:8000) — OpenAI-compatible server at `http://127.0.0.1:8000/v1` | `qwen3.6-colibri` (Qwen3.6-35B-A3B MoE, INT4 experts + INT8 trunk) | Start it with `npm run llm:start` (from `apps/api`) |
| Embeddings | the API and worker themselves (`EMBEDDING_PROVIDER=local`, transformers.js / ONNX on CPU) | `nomic-ai/nomic-embed-text-v1.5` | 768 dims, `search_document:` / `search_query:` prefixes. ~520 MB is downloaded once into `apps/api/.cache/models` |

colibri needs two settings that other servers don't:

- **No `/embeddings` endpoint**, so embeddings run in-process. It is the same nomic model Ollama served before, and
  its vectors match the stored ones exactly (cosine 1.0), so earlier uploads need no re-indexing.
- **Rejects `response_format`** ("grammars are not supported"), so `LLM_JSON_MODE=prompt` asks for JSON in the
  prompt. Replies are parsed leniently (code fences, `<think>` blocks and surrounding prose are tolerated) and
  validated with Zod, with one corrective retry.

`npm run llm:start` ([`apps/api/scripts/start-llm.ps1`](apps/api/scripts/start-llm.ps1)) sets the model up for
this app: 16k context instead of 64k, a fixed 12 GB RAM budget, thinking off, INT4 experts and an INT8 trunk.
`npm run llm:bench` times one real flashcard call so changes can be measured. Results on the dev machine
(i7-13620H, 32 GB RAM, NVMe; 1,359-token prompt):

| colibri configuration | Prompt reading | Writing | One call |
|---|---|---|---|
| `coli web --auto-tier` (original, 64k context) | 267 s | 1.5 tokens/s | 10.7 min |
| `llm:start -DenseBits 4` (INT4 trunk) | 310 s | 4.3 tokens/s | 7.8 min |
| **`llm:start`** (INT8 trunk, default) | **118 s** | **5.3 tokens/s** | **3.7 min** |

The experts were already INT4 in every run. Also storing the trunk in INT4 is *slower* on this CPU: it has fast
INT8 dot products (AVX-VNNI), while INT4 must be unpacked first. The speed-up comes from the smaller context, the
fixed RAM budget and turning thinking off.

Even so, expect minutes, not seconds:

- **Generation** (flashcards, questions, roadmap) runs after a document is processed and samples
  `GENERATION_MAX_BATCHES` sections. Each section takes 2 model calls (flashcards ~5 min, questions ~7 min). The default here is 3,
  so an upload takes about 40 min (measured: a 78-section PDF got 22 flashcards, 11 questions and its roadmap in
  39 min); use 10 with a GPU or hosted model. Each section is saved as soon as it is
  written, so cards and questions appear progressively, with a live percentage in the UI. A worker restart
  mid-run resumes from the last saved section. The worker also re-queues interrupted work by itself (on
  start-up and every 2 min). Real failures show **Retry** on the material (`POST /study-materials/:id/retries`).
- **Tutor** reads `TUTOR_TOP_K=4` passages, so answers take about 3–4 min when the model is idle. Answers are capped
  at `TUTOR_MAX_TOKENS=400` and `TUTOR_TIMEOUT_MS=600000` (10 min). The web
  proxy must allow longer: `API_PROXY_TIMEOUT_MS=660000` in `apps/web/.env.local`. A model that is down or
  busy returns a readable 503.
- `LLM_TIMEOUT_MS=900000` bounds each generation call, with `LLM_MAX_RETRIES=1`.

**Other servers.** Any OpenAI-compatible server works through `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_CHAT_MODEL`:

- **Ollama:** `npm run llm:setup` builds `edu-chat` from
  [`apps/api/ollama/edu-chat.Modelfile`](apps/api/ollama/edu-chat.Modelfile). Use `LLM_JSON_MODE=json_object`,
  plus `EMBEDDING_PROVIDER=api` and `EMBEDDING_MODEL=nomic-embed-text` if you want Ollama to serve embeddings
  too.
- **Hosted providers:** set the three variables above and clear the two prefix variables.
- **Separate embeddings endpoint:** set `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY`.
- **Different embedding size:** if the dimension changes, add a migration altering `vector(768)` and re-ingest
  materials.

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
| `POST /study-materials/:id/retries` (re-run failed processing or generation) | owner or `materials:moderate` |
| `DELETE /study-materials/:id` | owner or `materials:moderate` |
| `GET /exam-questions`, `GET /exam-questions/resources`, `PATCH /exam-questions/:id` | `questions:curate` (Admin, Examiner) |
| `GET/POST /exam-papers`, `GET/PATCH/DELETE /exam-papers/:id` | `exam-papers:manage` (Admin, Examiner) |
| `GET /exam-papers/available`, `POST /exam-papers/:id/{enrollments,sessions}` | `exams:take` (Student) |
| `GET /analytics/{frequently-missed-questions,concept-weaknesses,material-performance}` | `analytics:read` |
| `POST /tutor/queries` | `tutor:use` (Student) |
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
