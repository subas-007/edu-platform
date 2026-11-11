// Measures the local model on a real app workload: one flashcard-generation call over three
// stored document chunks (the same prompt the worker sends).
//
//   npm run llm:bench               # 2 runs (the first warms the model's expert cache)
//   npm run llm:bench -- 3          # N runs
//
// Reports time-to-first-token (prompt reading) and decode speed (tokens/s) separately,
// because a slow model is slow for different reasons in each phase. Needs a built API
// (dist/) for the prompts, the database for the sample text, and the model server running.
import 'dotenv/config';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { FLASHCARD_SYSTEM_PROMPT, formatChunksForPrompt } = require('../dist/ai/prompts.js');

const runs = Number(process.argv[2] ?? 2);
const base = process.env.LLM_BASE_URL ?? 'http://127.0.0.1:8000/v1';
const model = process.env.LLM_CHAT_MODEL;
const jsonByPrompt = process.env.LLM_JSON_MODE === 'prompt';

const prisma = new PrismaClient();
// A fixed, realistic sample: chunks 10-12 of the oldest material with at least 13 chunks.
const [material] = await prisma.$queryRaw`
  SELECT m.id, m.title FROM materials m
   WHERE (SELECT count(*) FROM document_chunks c WHERE c.material_id = m.id) >= 13
   ORDER BY m.created_at ASC LIMIT 1`;
if (!material) throw new Error('Need a processed material with at least 13 chunks to benchmark');
const chunks = await prisma.documentChunk.findMany({
  where: { materialId: material.id, chunkIndex: { in: [10, 11, 12] } },
  orderBy: { chunkIndex: 'asc' },
  select: { chunkIndex: true, content: true, tokenCount: true },
});
await prisma.$disconnect();

const userPrompt = formatChunksForPrompt(chunks.map((c) => ({ label: `C${c.chunkIndex}`, content: c.content })));
const systemPrompt = jsonByPrompt
  ? `${FLASHCARD_SYSTEM_PROMPT}\nRespond with the JSON object only: no markdown, no explanations.`
  : FLASHCARD_SYSTEM_PROMPT;
const promptTokens = chunks.reduce((s, c) => s + c.tokenCount, 0);
console.log(`model ${model} @ ${base}`);
console.log(`sample: "${material.title}" chunks 10-12 (~${promptTokens} tokens of document text)\n`);

for (let run = 1; run <= runs; run++) {
  const started = performance.now();
  let firstTokenAt = 0;
  let pieces = 0;
  let text = '';
  let usage;
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LLM_API_KEY ?? 'x'}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      stream: true,
      stream_options: { include_usage: true },
      ...(jsonByPrompt ? {} : { response_format: { type: 'json_object' } }),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:') || line === 'data: [DONE]') continue;
      const event = JSON.parse(line.slice(5));
      if (event.usage) usage = event.usage;
      const delta = event.choices?.[0]?.delta?.content;
      if (delta) {
        if (!firstTokenAt) firstTokenAt = performance.now();
        pieces++;
        text += delta;
      }
    }
  }
  const ended = performance.now();
  const outputTokens = usage?.completion_tokens ?? pieces;
  const ttft = (firstTokenAt - started) / 1000;
  const decodeSecs = (ended - firstTokenAt) / 1000;
  let cards = '?';
  try {
    cards = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)).flashcards.length;
  } catch {
    /* reported as ? */
  }
  console.log(
    `run ${run}: total ${((ended - started) / 1000).toFixed(1)} s | prompt (time to first token) ${ttft.toFixed(1)} s` +
      `${usage?.prompt_tokens ? ` for ${usage.prompt_tokens} tokens` : ''}` +
      ` | output ${outputTokens} tokens at ${(Math.max(outputTokens - 1, 1) / decodeSecs).toFixed(2)} tokens/s | ${cards} flashcards`,
  );
}
