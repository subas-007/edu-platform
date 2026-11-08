import { Injectable } from '@nestjs/common';
import { toVectorLiteral } from '../ai/llm.service';
import { PrismaService } from '../prisma/prisma.service';

export interface RetrievedChunk {
  id: string;
  materialId: string;
  materialTitle: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

@Injectable()
export class TutorRetrievalRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cosine-similarity search restricted to an explicit, pre-authorised list of
   * material ids — retrieval can never surface chunks the caller cannot read.
   * Fully parameterised: no string interpolation into SQL.
   */
  findSimilarChunks(embedding: number[], materialIds: string[], limit: number) {
    return this.prisma.$queryRaw<RetrievedChunk[]>`
      SELECT c.id,
             c.material_id AS "materialId",
             m.title       AS "materialTitle",
             c.chunk_index AS "chunkIndex",
             c.content,
             1 - (c.embedding <=> ${toVectorLiteral(embedding)}::vector) AS similarity
        FROM document_chunks c
        JOIN materials m ON m.id = c.material_id
       WHERE c.material_id = ANY(${materialIds}::uuid[])
         AND c.embedding IS NOT NULL
       ORDER BY c.embedding <=> ${toVectorLiteral(embedding)}::vector
       LIMIT ${limit}`;
  }
}
