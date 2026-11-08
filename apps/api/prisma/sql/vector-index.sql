-- Prisma cannot express pgvector indexes; apply after migrations with `npm run db:vector-index`.
-- HNSW + cosine distance matches the `<=>` operator used in TutorRetrievalRepository.
CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx
  ON document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Append-only audit log: the application role should not be able to rewrite history.
-- In production run the API as a dedicated DB role and uncomment:
-- REVOKE UPDATE, DELETE ON audit_logs FROM edu_app;
