// End-to-end security & exam-engine smoke test against a RUNNING API (npm run dev:api / start:api).
// Usage (from apps/api):  SMOKE_ADMIN_PASSWORD=... npm run test:smoke
// Optional env: SMOKE_API_URL (default http://localhost:4000/api/v1), SMOKE_ORIGIN (default http://localhost:3005),
//               SMOKE_ADMIN_EMAIL (default admin@example.com). Uses DATABASE_URL from .env to seed/clean test data.
// Creates two throwaway student accounts (deactivated/left inactive) and temporary materials it deletes afterwards.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const API = process.env.SMOKE_API_URL ?? 'http://localhost:4000/api/v1';
const ORIGIN = process.env.SMOKE_ORIGIN ?? 'http://localhost:3005';
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? 'admin@example.com';
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;
if (!adminPassword) {
  console.error('Set SMOKE_ADMIN_PASSWORD to the seeded admin password.');
  process.exit(2);
}
try {
  await fetch(API + '/health');
} catch {
  console.error(`API not reachable at ${API}. Start it first: npm run dev:api`);
  process.exit(2);
}
const results = [];
const check = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);

function jar() {
  const cookies = {};
  return {
    header: () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '),
    store(res) {
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const [k, v] = pair.split('=');
        if (v) cookies[k] = v; else delete cookies[k];
      }
    },
    cookies,
  };
}
async function call(j, method, path, body, { origin = ORIGIN, raw } = {}) {
  const headers = {};
  if (origin) headers.origin = origin;
  if (j) headers.cookie = j.header();
  if (body !== undefined && !raw) headers['content-type'] = 'application/json';
  let res = await fetch(API + path, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  if (res.status === 429) {
    // Login is deliberately limited to 5/min; wait out the window instead of reporting a false failure.
    const wait = Number(res.headers.get('retry-after') ?? 60) + 1;
    console.log(`  (rate limit hit on ${path}, waiting ${wait}s — this is the throttle working)`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    res = await fetch(API + path, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  }
  j?.store(res);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

const admin = jar();
check('health is public', (await call(null, 'GET', '/health')).status === 200);
check('unauthenticated /users → 401', (await call(null, 'GET', '/users')).status === 401);
check('login without Origin → 403 (CSRF guard)', (await call(admin, 'POST', '/auth/sessions', { email: ADMIN_EMAIL, password: adminPassword }, { origin: null })).status === 403);
check('login from foreign Origin → 403', (await call(admin, 'POST', '/auth/sessions', { email: ADMIN_EMAIL, password: adminPassword }, { origin: 'https://evil.example' })).status === 403);
check('wrong password → 401', (await call(admin, 'POST', '/auth/sessions', { email: ADMIN_EMAIL, password: 'nope' })).status === 401);
check('unknown key in login body → 400 (strict schema)', (await call(admin, 'POST', '/auth/sessions', { email: ADMIN_EMAIL, password: adminPassword, role: 'ADMIN' })).status === 400);
const login = await call(admin, 'POST', '/auth/sessions', { email: ADMIN_EMAIL, password: adminPassword });
check('admin login → 200 + httpOnly cookies', login.status === 200 && admin.cookies.access_token && admin.cookies.refresh_token);
check('admin GET /users → 200', (await call(admin, 'GET', '/users')).status === 200);

const studentEmail = `student-${Date.now()}@example.com`;
const studentPw = 'StudentPass123';
check('provision with mass-assignment field → 400', (await call(admin, 'POST', '/users', { email: studentEmail, role: 'STUDENT', initialPassword: studentPw, isActive: false, tokenVersion: 9 })).status === 400);
check('weak password rejected → 400', (await call(admin, 'POST', '/users', { email: studentEmail, role: 'STUDENT', initialPassword: 'short' })).status === 400);
const prov = await call(admin, 'POST', '/users', { email: studentEmail, role: 'STUDENT', initialPassword: studentPw });
check('admin provisions student → 201, no password hash in response', prov.status === 201 && !('passwordHash' in prov.json));

const student = jar();
await call(student, 'POST', '/auth/sessions', { email: studentEmail, password: studentPw });
check('student GET /users → 403', (await call(student, 'GET', '/users')).status === 403);
check('student GET /analytics → 403', (await call(student, 'GET', '/analytics/material-performance')).status === 403);
check('student GET /exam-questions (answer keys) → 403', (await call(student, 'GET', '/exam-questions')).status === 403);
check('student GET /audit-logs → 403', (await call(student, 'GET', '/audit-logs')).status === 403);

// Upload with spoofed extension/MIME (plain text named .pdf) → rejected by magic-byte sniffing
const form = new FormData();
form.append('title', 'Fake PDF');
form.append('file', new Blob(['just text, not a pdf'], { type: 'application/pdf' }), 'evil.pdf');
const up = await fetch(API + '/study-materials/files', { method: 'POST', headers: { origin: ORIGIN, cookie: student.header() }, body: form });
check('spoofed PDF upload → 400', up.status === 400);
check('URL with credentials rejected → 400', (await call(student, 'POST', '/study-materials/urls', { title: 'x', url: 'http://user:pw@example.com/' })).status === 400);
check('URL on non-standard port rejected → 400', (await call(student, 'POST', '/study-materials/urls', { title: 'x', url: 'http://example.com:6379/' })).status === 400);

// Refresh-token rotation + reuse detection
const rt1 = student.cookies.refresh_token;
const r1 = await call(student, 'POST', '/auth/refresh');
check('refresh rotates token', r1.status === 200 && student.cookies.refresh_token !== rt1);
const replay = jar(); replay.cookies.refresh_token = rt1;
check('replayed old refresh token → 401', (await call(replay, 'POST', '/auth/refresh')).status === 401);
check('reuse revoked whole family (current token now dead)', (await call(student, 'POST', '/auth/refresh')).status === 401);
await call(student, 'POST', '/auth/sessions', { email: studentEmail, password: studentPw });

// ---- Exam engine: seed a material + approved questions directly ----
const prisma = new PrismaClient();
const studentRow = await prisma.user.findUnique({ where: { email: studentEmail } });
const adminRow = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
const material = await prisma.material.create({ data: { title: 'Smoke Material', fileUrl: 'https://example.com', fileType: 'URL', status: 'READY', visibility: 'PUBLISHED', uploadedById: adminRow.id } });
const privateMaterial = await prisma.material.create({ data: { title: 'Admin private', fileUrl: 'https://example.com/p', fileType: 'URL', status: 'READY', visibility: 'PRIVATE', uploadedById: adminRow.id } });
const opts = [{ id: 'A', text: 'one' }, { id: 'B', text: 'two' }, { id: 'C', text: 'three' }, { id: 'D', text: 'four' }];
for (const [i, tag] of ['photosynthesis', 'photosynthesis', 'respiration', 'respiration'].entries()) {
  await prisma.examQuestion.create({ data: { materialId: material.id, questionText: `Question ${i}?`, options: opts, correctAnswer: 'A', explanation: `Because A (${i})`, conceptTag: tag, reviewStatus: 'APPROVED' } });
}
await prisma.examQuestion.create({ data: { materialId: material.id, questionText: 'Pending Q?', options: opts, correctAnswer: 'A', explanation: 'x', conceptTag: 'pending', reviewStatus: 'PENDING' } });

check('student cannot read another user\'s PRIVATE material → 404', (await call(student, 'GET', `/study-materials/${privateMaterial.id}`)).status === 404);
check('student cannot start exam on PRIVATE material → 404', (await call(student, 'POST', '/exam-sessions', { materialId: privateMaterial.id, mode: 'EXAM', questionCount: 3 })).status === 404);

const exam = await call(student, 'POST', '/exam-sessions', { materialId: material.id, mode: 'EXAM', questionCount: 10 });
const leaked = JSON.stringify(exam.json).match(/correctAnswer|explanation|Because A/);
check('EXAM session started; only approved questions (4)', exam.status === 201 && exam.json.questions.length === 4);
check('EXAM payload leaks no answer key / explanation', !leaked);
const [q0, q1, q2] = exam.json.questions;
const a0 = await call(student, 'POST', `/exam-sessions/${exam.json.id}/answers`, { questionId: q0.id, selectedAnswer: 'A' });
check('EXAM answer returns only {saved:true}', a0.status === 200 && JSON.stringify(a0.json) === '{"saved":true}');
await call(student, 'POST', `/exam-sessions/${exam.json.id}/answers`, { questionId: q1.id, selectedAnswer: 'B' });
await call(student, 'POST', `/exam-sessions/${exam.json.id}/answers`, { questionId: q2.id, selectedAnswer: 'A' });
check('invalid option id → 400', (await call(student, 'POST', `/exam-sessions/${exam.json.id}/answers`, { questionId: q0.id, selectedAnswer: 'E' })).status === 400);
check('question outside session → 400', (await call(student, 'POST', `/exam-sessions/${exam.json.id}/answers`, { questionId: material.id, selectedAnswer: 'A' })).status === 400);

const other = jar();
const otherEmail = `other-${Date.now()}@example.com`;
await call(admin, 'POST', '/users', { email: otherEmail, role: 'STUDENT', initialPassword: studentPw });
await call(other, 'POST', '/auth/sessions', { email: otherEmail, password: studentPw });
check('other student cannot view session (IDOR) → 404', (await call(other, 'GET', `/exam-sessions/${exam.json.id}`)).status === 404);
check('other student cannot answer in session → 404', (await call(other, 'POST', `/exam-sessions/${exam.json.id}/answers`, { questionId: q0.id, selectedAnswer: 'A' })).status === 404);

const [s1, s2] = await Promise.all([
  call(student, 'POST', `/exam-sessions/${exam.json.id}/submissions`),
  call(student, 'POST', `/exam-sessions/${exam.json.id}/submissions`),
]);
check('concurrent double-submit: exactly one succeeds', [s1.status, s2.status].sort().join() === '200,409', `(${s1.status},${s2.status})`);
const result = (s1.status === 200 ? s1 : s2).json.result;
check('score = 2/4 = 50%', result.percentage === 50 && result.correctCount === 2, JSON.stringify({ p: result.percentage, c: result.correctCount }));
check('diagnostics grouped by concept, weakest first', result.diagnostics.conceptBreakdown.length === 2 && result.diagnostics.conceptBreakdown[0].accuracy <= result.diagnostics.conceptBreakdown[1].accuracy, JSON.stringify(result.diagnostics.weakestConcepts));
check('answer after submit → 409', (await call(student, 'POST', `/exam-sessions/${exam.json.id}/answers`, { questionId: q0.id, selectedAnswer: 'A' })).status === 409);

const learn = await call(student, 'POST', '/exam-sessions', { materialId: material.id, mode: 'LEARNING', questionCount: 3 });
const lq = learn.json.questions[0];
const fb = await call(student, 'POST', `/exam-sessions/${learn.json.id}/answers`, { questionId: lq.id, selectedAnswer: 'C' });
check('LEARNING gives instant feedback w/ justification', fb.json.feedback?.isCorrect === false && fb.json.feedback.correctAnswer === 'A' && fb.json.feedback.explanation.startsWith('Because'));
const fb2 = await call(student, 'POST', `/exam-sessions/${learn.json.id}/answers`, { questionId: lq.id, selectedAnswer: 'A' });
check('LEARNING answer locked after feedback (no answer farming)', fb2.json.alreadyAnswered === true && fb2.json.feedback.selectedAnswer === 'C');

const missed = await call(admin, 'GET', `/analytics/frequently-missed-questions?materialId=${material.id}`);
check('examiner analytics: frequently missed questions', missed.status === 200 && missed.json.length >= 1 && missed.json[0].mostCommonWrongAnswer, JSON.stringify(missed.json[0] ?? {}).slice(0, 120));

// Deprovisioning revokes live sessions immediately
await call(admin, 'PATCH', `/users/${studentRow.id}`, { isActive: false });
check('deprovisioned user\'s existing access token rejected → 401', (await call(student, 'GET', '/auth/me')).status === 401);
check('admin cannot deprovision self → 400', (await call(admin, 'PATCH', `/users/${adminRow.id}`, { isActive: false })).status === 400);

// pgvector cosine search SQL works
const DIMS = Number(process.env.EMBEDDING_DIMENSIONS ?? 768);
const vec = `[${Array.from({ length: DIMS }, (_, i) => (i === 0 ? 1 : 0)).join(',')}]`;
await prisma.$executeRaw`INSERT INTO document_chunks (id, material_id, chunk_index, content, token_count, embedding) VALUES (gen_random_uuid(), ${material.id}::uuid, 0, 'chunk', 1, ${vec}::vector)`;
const sim = await prisma.$queryRaw`SELECT 1 - (embedding <=> ${vec}::vector) AS similarity FROM document_chunks WHERE material_id = ANY(${[material.id]}::uuid[])`;
check('pgvector cosine similarity query', Math.abs(Number(sim[0].similarity) - 1) < 1e-6);

await prisma.material.deleteMany({ where: { id: { in: [material.id, privateMaterial.id] } } });
await prisma.$disconnect();

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
