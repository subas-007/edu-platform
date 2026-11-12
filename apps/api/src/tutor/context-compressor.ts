/**
 * Shrinks retrieved passages to the sentences that matter for one question.
 *
 * On a CPU model, reading the prompt is most of a tutor answer's wait (~12 tokens/s), and
 * whole ~500-token passages are mostly text unrelated to the question. Each passage is cut
 * into short spans of adjacent sentences, every span is ranked by embedding similarity to
 * the question, and the best spans are kept up to a token budget. Kept spans stay in their
 * original order; a gap between them is marked with "…".
 */

/** Roughly one token per 4 characters of English text. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/** Spans are built from adjacent sentences up to about this many characters (~60 words). */
const SPAN_MAX_CHARS = 360;

export interface CompressiblePassage {
  content: string;
}

export interface CompressedPassage<T> {
  passage: T;
  text: string;
}

interface Span {
  passage: number;
  position: number;
  text: string;
  tokens: number;
}

/** Sentence boundaries, plus line breaks that start list items or headings. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/(?<=[.!?…])\s+(?=["“'(\[]?[A-Z0-9])|\n{2,}|\n(?=\s*(?:[-•*▪]|\d+[.)])\s)/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

/** Groups adjacent sentences into spans of at most SPAN_MAX_CHARS (a long sentence stands alone). */
export function buildSpans(text: string): string[] {
  const spans: string[] = [];
  let current = '';
  for (const sentence of splitSentences(text)) {
    if (current && current.length + sentence.length + 1 > SPAN_MAX_CHARS) {
      spans.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) spans.push(current);
  return spans;
}

const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);

const STOPWORDS = new Set(
  ('a an and are as at be by can could do does for from has have how i in is it its may might of on or ' +
    'should so that the their them then there these this to was were what when where which who why will ' +
    'with would you your about into than also not no if our we they he she explain describe tell me').split(' '),
);

/** Lower-cased content words, plurals folded ("assessments" → "assessment"). */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word));
}

/** BM25 keyword relevance of each span to the question (IDF taken over the spans themselves). */
export function keywordScores(question: string, spans: string[]): number[] {
  const queryTerms = [...new Set(terms(question))];
  const docs = spans.map(terms);
  const avgLength = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(1, docs.length) || 1;
  const idf = new Map(
    queryTerms.map((term) => {
      const df = docs.filter((d) => d.includes(term)).length;
      return [term, Math.log(1 + (docs.length - df + 0.5) / (df + 0.5))];
    }),
  );
  return docs.map((doc) =>
    queryTerms.reduce((score, term) => {
      const tf = doc.filter((t) => t === term).length;
      if (tf === 0) return score;
      return score + (idf.get(term) ?? 0) * ((tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * doc.length) / avgLength)));
    }, 0),
  );
}

/**
 * Embedding text costs CPU in proportion to its length (~2-4 s per 1,000 tokens here), so only
 * the spans a keyword ranking puts in the top CANDIDATE_FACTOR × budget are embedded; the
 * embedding similarity then makes the final choice (it also catches paraphrases).
 */
const CANDIDATE_FACTOR = 2;

/**
 * @param passages in retrieval order (most similar first)
 * @param embedSpans embeds span texts as documents (vectors L2-normalised, like the query's)
 * @returns the passages that kept at least one span, in their original order
 */
export async function compressPassages<T extends CompressiblePassage>(
  passages: T[],
  question: string,
  questionEmbedding: number[],
  budgetTokens: number,
  embedSpans: (texts: string[]) => Promise<number[][]>,
): Promise<CompressedPassage<T>[]> {
  const spans: Span[] = passages.flatMap((p, passage) =>
    buildSpans(p.content).map((text, position) => ({ passage, position, text, tokens: estimateTokens(text) })),
  );
  const total = spans.reduce((sum, s) => sum + s.tokens, 0);
  if (spans.length === 0 || total <= budgetTokens) {
    return passages.map((passage) => ({ passage, text: passage.content }));
  }

  // Keyword pre-selection; ties (e.g. no shared words) favour the better-retrieved passages.
  const keyword = keywordScores(question, spans.map((s) => s.text));
  const byKeyword = spans
    .map((span, i) => ({ span, score: keyword[i] }))
    .sort((a, b) => b.score - a.score || a.span.passage - b.span.passage || a.span.position - b.span.position);
  const candidates: Span[] = [];
  let candidateTokens = 0;
  for (const { span } of byKeyword) {
    if (candidateTokens >= budgetTokens * CANDIDATE_FACTOR) break;
    candidates.push(span);
    candidateTokens += span.tokens;
  }

  const vectors = await embedSpans(candidates.map((s) => s.text));
  const ranked = candidates
    .map((span, i) => ({ span, score: dot(vectors[i], questionEmbedding) }))
    .sort((a, b) => b.score - a.score);

  const kept = new Set<Span>();
  let used = 0;
  for (const { span } of ranked) {
    if (used + span.tokens > budgetTokens && kept.size > 0) continue; // the best span is always kept
    kept.add(span);
    used += span.tokens;
  }

  const result: CompressedPassage<T>[] = [];
  passages.forEach((passage, index) => {
    const own = spans.filter((s) => s.passage === index && kept.has(s));
    if (own.length === 0) return;
    let text = own[0].position > 0 ? '… ' : '';
    own.forEach((span, i) => {
      if (i > 0) text += span.position === own[i - 1].position + 1 ? ' ' : ' … ';
      text += span.text;
    });
    result.push({ passage, text });
  });
  return result;
}
