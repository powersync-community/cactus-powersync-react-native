// Available Cactus models sourced from https://huggingface.co/Cactus-Compute
// Slugs match HuggingFace repo names exactly (used as model identifiers by the Cactus SDK).

export const LLM_MODELS = [
  {
    id: 'gemma-3-270m-it',
    slug: 'gemma-3-270m-it',
    name: 'Gemma 3 270M',
    description: 'Google Gemma 3 instruction-tuned. Smallest and fastest — good for quick responses.',
    sizeMb: 270
  },
  {
    id: 'LFM2-350M',
    slug: 'LFM2-350M',
    name: 'LFM2 350M',
    description: 'LiquidAI LFM2 ultra-small. Very fast on-device inference.',
    sizeMb: 350
  },
  {
    id: 'Qwen3-0.6B',
    slug: 'Qwen3-0.6B',
    name: 'Qwen3 0.6B',
    description: 'Qwen 3 ultra-lightweight. Excellent balance of speed and quality, supports embeddings.',
    sizeMb: 600,
    isRecommended: true
  },
  {
    id: 'LFM2-700M',
    slug: 'LFM2-700M',
    name: 'LFM2 700M',
    description: 'LiquidAI LFM2 small. Good quality with modest size.',
    sizeMb: 700
  },
  {
    id: 'functiongemma-270m-it',
    slug: 'functiongemma-270m-it',
    name: 'FunctionGemma 270M',
    description: 'Google FunctionGemma — optimized for function and tool calling.',
    sizeMb: 270,
    badge: 'Tools'
  },
  {
    id: 'gemma-3-1b-it',
    slug: 'gemma-3-1b-it',
    name: 'Gemma 3 1B',
    description: 'Google Gemma 3 1B instruction-tuned. Good quality in a compact package.',
    sizeMb: 1000
  },
  {
    id: 'LFM2-1.2B-RAG',
    slug: 'LFM2-1.2B-RAG',
    name: 'LFM2 1.2B RAG',
    description: 'LiquidAI LFM2 fine-tuned for retrieval-augmented generation. Ideal for the RAG screen.',
    sizeMb: 1200,
    badge: 'RAG'
  },
  {
    id: 'LFM2-1.2B-Tool',
    slug: 'LFM2-1.2B-Tool',
    name: 'LFM2 1.2B Tool',
    description: 'LiquidAI LFM2 fine-tuned for tool and function calling.',
    sizeMb: 1200,
    badge: 'Tools'
  },
  {
    id: 'LFM2.5-1.2B-Instruct',
    slug: 'LFM2.5-1.2B-Instruct',
    name: 'LFM2.5 1.2B Instruct',
    description: 'LiquidAI LFM2.5 instruction-tuned. Strong general-purpose on-device model.',
    sizeMb: 1200
  },
  {
    id: 'LFM2.5-1.2B-Thinking',
    slug: 'LFM2.5-1.2B-Thinking',
    name: 'LFM2.5 1.2B Thinking',
    description: 'LiquidAI LFM2.5 with extended chain-of-thought reasoning.',
    sizeMb: 1200,
    badge: 'Thinking'
  },
  {
    id: 'Qwen3-1.7B',
    slug: 'Qwen3-1.7B',
    name: 'Qwen3 1.7B',
    description: 'Qwen 3 light. Noticeably stronger reasoning than 0.6B, supports embeddings.',
    sizeMb: 1700
  },
  {
    id: 'LFM2-2.6B',
    slug: 'LFM2-2.6B',
    name: 'LFM2 2.6B',
    description: 'LiquidAI LFM2 medium. High quality, requires more RAM.',
    sizeMb: 2600
  }
];

// Dedicated embedding-only models (use for RAG corpus indexing, no chat)
export const EMBEDDING_MODELS = [
  {
    id: 'Qwen3-Embedding-0.6B',
    slug: 'Qwen3-Embedding-0.6B',
    name: 'Qwen3 Embedding 0.6B',
    description: 'Qwen 3 text embeddings. High-quality dense vectors for semantic search.',
    sizeMb: 600,
    isRecommended: true
  },
  {
    id: 'nomic-embed-text-v2-moe',
    slug: 'nomic-embed-text-v2-moe',
    name: 'Nomic Embed v2 MoE',
    description: 'Nomic AI mixture-of-experts embedding model. Strong multilingual support.',
    sizeMb: null
  }
];

// Speech-to-text models for the transcription feature
export const STT_MODELS = [
  {
    id: 'whisper-tiny',
    slug: 'whisper-tiny',
    name: 'Whisper Tiny',
    description: 'Smallest Whisper model. Very fast, lower accuracy.',
    sizeMb: 75
  },
  {
    id: 'whisper-base',
    slug: 'whisper-base',
    name: 'Whisper Base',
    description: 'Good speed/accuracy tradeoff for most transcription tasks.',
    sizeMb: 150
  },
  {
    id: 'whisper-small',
    slug: 'whisper-small',
    name: 'Whisper Small',
    description: 'OpenAI Whisper small. Strong accuracy, reasonable size.',
    sizeMb: 244,
    isRecommended: true
  },
  {
    id: 'whisper-medium',
    slug: 'whisper-medium',
    name: 'Whisper Medium',
    description: 'High accuracy transcription. Larger download required.',
    sizeMb: 500
  },
  {
    id: 'moonshine-base',
    slug: 'moonshine-base',
    name: 'Moonshine Base',
    description: 'UsefulSensors Moonshine — fast, Apple-optimized speech recognition.',
    sizeMb: 100
  },
  {
    id: 'parakeet-ctc-0.6b',
    slug: 'parakeet-ctc-0.6b',
    name: 'Parakeet CTC 0.6B',
    description: 'NVIDIA Parakeet CTC — high accuracy English transcription, Apple-optimized.',
    sizeMb: 600
  },
  {
    id: 'parakeet-ctc-1.1b',
    slug: 'parakeet-ctc-1.1b',
    name: 'Parakeet CTC 1.1B',
    description: 'NVIDIA Parakeet CTC large — best-in-class English accuracy.',
    sizeMb: 1100
  }
];

export const DEFAULT_LLM_MODEL = 'Qwen3-0.6B';
export const DEFAULT_STT_MODEL = 'whisper-small';
