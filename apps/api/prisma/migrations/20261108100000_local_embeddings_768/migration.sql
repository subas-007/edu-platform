-- Switch embeddings to the local Ollama model nomic-embed-text (768 dimensions).
-- Existing vectors cannot be cast between dimensions, so they are cleared; re-ingest
-- materials afterwards (the column was empty when this migration was written).
DROP INDEX IF EXISTS document_chunks_embedding_hnsw_idx;
UPDATE document_chunks SET embedding = NULL WHERE embedding IS NOT NULL;
ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(768);
CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx
  ON document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
