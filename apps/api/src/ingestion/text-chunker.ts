export interface TextChunk {
  chunkIndex: number;
  content: string;
  tokenCount: number;
}

const CHARS_PER_TOKEN = 4; // heuristic; swap for a real tokenizer if exact budgets matter

export const estimateTokenCount = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN);

/**
 * Semantic-ish chunking: splits on paragraphs, then sentences, packing units up
 * to ~targetTokens and carrying ~overlapTokens of trailing sentences into the
 * next chunk so concepts spanning a boundary remain retrievable.
 */
export function chunkTextForEmbedding(
  text: string,
  targetTokens = 500,
  overlapTokens = 75,
): TextChunk[] {
  const maxChars = targetTokens * CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN;

  const units = text
    .split(/\n{2,}/)
    .flatMap((paragraph) => paragraph.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [paragraph])
    .flatMap((sentence) => hardSplit(sentence.trim(), maxChars))
    .filter((unit) => unit.length > 0);

  const chunks: TextChunk[] = [];
  let current: string[] = [];
  let currentLength = 0;

  const flush = () => {
    const content = current.join(' ').trim();
    if (content.length >= 40) {
      chunks.push({ chunkIndex: chunks.length, content, tokenCount: estimateTokenCount(content) });
    }
  };

  for (const unit of units) {
    if (currentLength + unit.length > maxChars && current.length > 0) {
      flush();
      const overlap: string[] = [];
      let overlapLength = 0;
      for (let i = current.length - 1; i >= 0 && overlapLength < overlapChars; i--) {
        overlap.unshift(current[i]);
        overlapLength += current[i].length;
      }
      current = overlap;
      currentLength = overlapLength;
    }
    current.push(unit);
    currentLength += unit.length + 1;
  }
  if (current.length) flush();
  return chunks;
}

function hardSplit(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) parts.push(text.slice(i, i + maxChars));
  return parts;
}

/** 0..1 readability/complexity heuristic feeding the roadmap time estimates. */
export function estimateTextComplexity(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const sentences = Math.max(1, (text.match(/[.!?]+/g) ?? []).length);
  const avgSentenceLength = words.length / sentences; // ~15 easy, ~30 hard
  const longWordRatio = words.filter((w) => w.replace(/\W/g, '').length >= 9).length / words.length;
  const lexicalDiversity = new Set(words.map((w) => w.toLowerCase())).size / words.length;
  const score =
    0.45 * clamp((avgSentenceLength - 12) / 20) +
    0.35 * clamp(longWordRatio / 0.25) +
    0.2 * clamp(lexicalDiversity / 0.6);
  return Math.round(score * 100) / 100;
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));
