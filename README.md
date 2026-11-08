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
                                           # (port clash? POSTGRES_HOST_PORT=55432 docker compose up -d)
cd apps/api
cp .env.example .env
npm install
npm run keys:generate                      # paste private+public into apps/api/.env, public into apps/web/.env.local
npm run llm:setup                          # local LLM via Ollama (see below); set SEED_ADMIN_PASSWORD in .env
npm run db:deploy                          # applies migrations, incl. the HNSW vector index
npm run db:seed                            # first admin — then delete SEED_ADMIN_PASSWORD from .env
npm run dev:api                            # :4000
npm run dev:worker                         # separate terminal

cd ../web
cp .env.example .env.local                 # JWT_PUBLIC_KEY_B64 + API_INTERNAL_URL
npm install && npm run dev                 # http://localhost:3005
```

### Local LLM (default)

All model calls go through Ollama's OpenAI-compatible endpoint (`http://localhost:11434/v1`), so no
material text leaves the machine. Install [Ollama](https://ollama.com), then `npm run llm:setup` (from
`apps/api`) pulls the models and builds the chat model:

| Role | Model | Notes |
|---|---|---|
| Chat (tutor, flashcards, questions, roadmap) | `edu-chat` | `qwen2.5:7b` with an 8k context window — defined in [`apps/api/ollama/edu-chat.Modelfile`](apps/api/ollama/edu-chat.Modelfile) |
| Embeddings | `nomic-embed-text` | 768 dims; uses `search_document:` / `search_query:` prefixes |

Runs on CPU (~5 GB RAM); generation for a material takes minutes, hence `LLM_TIMEOUT_MS=300000`. To switch to a
hosted provider instead, set `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_CHAT_MODEL`, clear the two prefix variables and,
if the embedding size changes, add a migration altering `vector(768)` and re-ingest materials.

## Layout

| Path | Responsibility |
|---|---|
| `apps/api/src/common/security/permissions.ts` | **Single source of truth** for role → permission mapping |
| `apps/api/src/common/guards/` | `JwtAuthGuard` (authn, DB-backed revocation), `PermissionsGuard` (deny-by-default RBAC), Origin check |
| `apps/api/src/auth/` | ES256 access tokens, rotating refresh tokens with reuse detection, httpOnly cookies |
| `apps/api/src/study-materials/` | Upload/URL intake, magic-byte validation, private storage, `MaterialAccessPolicy` (object-level authz) |
| `apps/api/src/ingestion/` | Worker: extractors, SSRF-safe fetcher, chunker, embeddings |
| `apps/api/src/generation/` | Worker: flashcards, questions (Zod-validated), roadmap |
| `apps/api/src/tutor/` | RAG: authz-scoped vector search → grounded answer with citations |
| `apps/api/src/exam-sessions/` | Learning/Exam engine, row-locked answering & submission, diagnostics |
| `apps/api/src/exam-questions/`, `analytics/` | Examiner curation & performance analytics |
| `apps/web/src/app/(admin|examiner|student)/` | Isolated role dashboards |

### API surface (`/api/v1`, kebab-case)

| Method & route | Permission |
|---|---|
| `POST /auth/sessions`, `POST /auth/refresh`, `POST /auth/logout` | public (rate-limited) |
| `GET /auth/me` | authenticated |
| `GET/POST /users`, `PATCH /users/:id` | `users:manage` (Admin) |
| `GET /audit-logs` | `audit-logs:read` (Admin) |
| `GET /study-materials[/:id[/flashcards]]` | authenticated + object policy |
| `POST /study-materials/files`, `POST /study-materials/urls` | `materials:upload` (all roles) |
| `PATCH /study-materials/:id/visibility` | `materials:publish` (Admin, Examiner) |
| `DELETE /study-materials/:id` | owner or `materials:moderate` |
| `GET /exam-questions`, `PATCH /exam-questions/:id` | `questions:curate` (Admin, Examiner) |
| `GET /analytics/{frequently-missed-questions,concept-weaknesses,material-performance}` | `analytics:read` |
| `POST /tutor/queries` | `tutor:use` (Student) |
| `POST /exam-sessions`, `POST /exam-sessions/:id/{answers,submissions}` | `exams:take` (Student, owner only) |
| `GET /exam-sessions/:id` | owner or `exam-results:read-all` |
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
