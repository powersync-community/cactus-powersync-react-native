/**
 * L2-normalize a vector so that cosine similarity reduces to a dot product.
 * Pre-normalizing before storage makes retrieval numerically stable.
 */
export const normalizeVector = (vector: number[]): number[] => {
  if (!Array.isArray(vector) || vector.length === 0) return vector;
  let norm = 0;
  for (let i = 0; i < vector.length; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm) || 1;
  return vector.map((v) => v / norm);
};

export const cosineSimilarity = (a: number[] = [], b: number[] = []): number => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) {
    return 0;
  }

  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < length; i += 1) {
    const av = Number(a[i] ?? 0);
    const bv = Number(b[i] ?? 0);
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (!normA || !normB) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

export const parseEmbedding = (raw: string | null | undefined): number[] | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
