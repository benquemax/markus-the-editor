/**
 * Embeddings Provider
 *
 * Provides text embeddings for semantic search.
 * Supports multiple providers:
 * - Local ONNX (all-MiniLM-L6-v2) - default, works offline
 * - API-based embeddings via OpenAI-compatible endpoints
 * - TF-IDF fallback when no ML is available
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Embedding provider type.
 */
export type EmbeddingProvider = 'local' | 'api' | 'tfidf'

/**
 * Configuration for embedding provider.
 */
export interface EmbeddingConfig {
  /** Provider type */
  provider: EmbeddingProvider
  /** Model name (for ONNX or API) */
  model?: string
  /** API endpoint (for API provider) */
  endpoint?: string
  /** API key (for API provider) */
  apiKey?: string
  /** Embedding dimension (auto-detected if not specified) */
  dimension?: number
}

/**
 * Result of embedding a text.
 */
export interface EmbeddingResult {
  /** Embedding vector */
  vector: number[]
  /** Token count of input */
  tokens: number
  /** Processing time in ms */
  processingTime: number
}

// ============================================================================
// Abstract Provider
// ============================================================================

/**
 * Abstract base class for embedding providers.
 */
export abstract class BaseEmbeddingProvider {
  abstract readonly provider: EmbeddingProvider
  abstract readonly dimension: number

  /**
   * Generate embedding for a single text.
   */
  abstract embed(text: string): Promise<EmbeddingResult>

  /**
   * Generate embeddings for multiple texts.
   */
  abstract embedBatch(texts: string[]): Promise<EmbeddingResult[]>

  /**
   * Calculate cosine similarity between two vectors.
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same dimension')
    }

    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
    if (magnitude === 0) return 0

    return dotProduct / magnitude
  }
}

// ============================================================================
// TF-IDF Fallback Provider
// ============================================================================

/**
 * TF-IDF based embedding provider.
 * Works without any ML dependencies, but less accurate.
 */
export class TFIDFEmbeddingProvider extends BaseEmbeddingProvider {
  readonly provider: EmbeddingProvider = 'tfidf'
  readonly dimension: number

  /** Vocabulary map */
  private vocabulary = new Map<string, number>()
  /** Document frequency for each term */
  private documentFrequency = new Map<string, number>()
  /** Total documents seen */
  private totalDocuments = 0

  constructor(dimension: number = 384) {
    super()
    this.dimension = dimension
  }

  /**
   * Tokenize text into terms.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2)
  }

  /**
   * Add document to the index for IDF calculation.
   */
  addDocument(text: string): void {
    const terms = new Set(this.tokenize(text))
    this.totalDocuments++

    for (const term of terms) {
      if (!this.vocabulary.has(term)) {
        this.vocabulary.set(term, this.vocabulary.size)
      }
      this.documentFrequency.set(
        term,
        (this.documentFrequency.get(term) || 0) + 1
      )
    }
  }

  /**
   * Generate TF-IDF embedding.
   */
  async embed(text: string): Promise<EmbeddingResult> {
    const start = Date.now()
    const terms = this.tokenize(text)

    // Calculate term frequency
    const tf = new Map<string, number>()
    for (const term of terms) {
      tf.set(term, (tf.get(term) || 0) + 1)
    }

    // Calculate TF-IDF vector (sparse to dense)
    const vector = new Array(this.dimension).fill(0)
    const maxTf = Math.max(...tf.values(), 1)

    for (const [term, freq] of tf.entries()) {
      const vocabIndex = this.vocabulary.get(term)
      if (vocabIndex === undefined) continue

      // Normalized TF
      const normalizedTf = freq / maxTf

      // IDF with smoothing
      const df = this.documentFrequency.get(term) || 1
      const idf = Math.log((this.totalDocuments + 1) / (df + 1)) + 1

      // TF-IDF value
      const tfidf = normalizedTf * idf

      // Hash to dimension (simple modulo hash)
      const hashIndex = vocabIndex % this.dimension
      vector[hashIndex] += tfidf
    }

    // L2 normalize
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= norm
      }
    }

    return {
      vector,
      tokens: terms.length,
      processingTime: Date.now() - start
    }
  }

  /**
   * Batch embedding.
   */
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    return Promise.all(texts.map(t => this.embed(t)))
  }
}

// ============================================================================
// API-Based Provider
// ============================================================================

/**
 * API-based embedding provider.
 * Uses OpenAI-compatible embedding API.
 */
export class APIEmbeddingProvider extends BaseEmbeddingProvider {
  readonly provider: EmbeddingProvider = 'api'
  readonly dimension: number

  private endpoint: string
  private apiKey: string
  private model: string

  constructor(config: EmbeddingConfig) {
    super()
    this.endpoint = config.endpoint || 'http://localhost:11434/v1/embeddings'
    this.apiKey = config.apiKey || ''
    this.model = config.model || 'text-embedding-3-small'
    this.dimension = config.dimension || 1536
  }

  /**
   * Generate embedding via API.
   */
  async embed(text: string): Promise<EmbeddingResult> {
    const results = await this.embedBatch([text])
    return results[0]
  }

  /**
   * Batch embedding via API.
   */
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const start = Date.now()

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        input: texts
      })
    })

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status}`)
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>
    }

    const processingTime = Date.now() - start

    return data.data.map(d => ({
      vector: d.embedding,
      tokens: Math.ceil(texts[d.index].length / 4),
      processingTime
    }))
  }
}

// ============================================================================
// Local ONNX Provider (Placeholder)
// ============================================================================

/**
 * Local ONNX-based embedding provider.
 * Uses all-MiniLM-L6-v2 or similar model.
 *
 * NOTE: This is a placeholder implementation.
 * Full implementation requires onnxruntime-node and model files.
 * Falls back to TF-IDF when ONNX is not available.
 */
export class LocalEmbeddingProvider extends BaseEmbeddingProvider {
  readonly provider: EmbeddingProvider = 'local'
  readonly dimension: number = 384

  private fallback: TFIDFEmbeddingProvider
  private initialized = false

  constructor() {
    super()
    // Use TF-IDF as fallback until ONNX is properly initialized
    this.fallback = new TFIDFEmbeddingProvider(384)
    console.log('[Embeddings] Local ONNX provider using TF-IDF fallback until onnxruntime-node is installed')
  }

  /**
   * Initialize the ONNX runtime.
   * This is a placeholder - actual implementation would load the model.
   */
  async initialize(): Promise<void> {
    // TODO: Initialize ONNX runtime with all-MiniLM-L6-v2 model
    // This requires:
    // 1. onnxruntime-node package
    // 2. Model file (all-MiniLM-L6-v2.onnx, ~30MB)
    // 3. Tokenizer vocab

    // For now, mark as initialized and use fallback
    this.initialized = true
  }

  /**
   * Add document to fallback index.
   */
  addDocument(text: string): void {
    this.fallback.addDocument(text)
  }

  async embed(text: string): Promise<EmbeddingResult> {
    if (!this.initialized) {
      await this.initialize()
    }

    // Use fallback TF-IDF for now
    return this.fallback.embed(text)
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    if (!this.initialized) {
      await this.initialize()
    }

    return this.fallback.embedBatch(texts)
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an embedding provider based on configuration.
 */
export function createEmbeddingProvider(
  config: EmbeddingConfig
): BaseEmbeddingProvider {
  switch (config.provider) {
    case 'api':
      return new APIEmbeddingProvider(config)
    case 'tfidf':
      return new TFIDFEmbeddingProvider(config.dimension)
    case 'local':
    default:
      return new LocalEmbeddingProvider()
  }
}
