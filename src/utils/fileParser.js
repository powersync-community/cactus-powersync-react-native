import { File } from 'expo-file-system/next';
import pako from 'pako';

// Latin1 byte-to-string helper (Hermes doesn't support TextDecoder('latin1'))
const latin1Decode = (uint8) => {
  const chunks = [];
  // Process in 8 KB slices to avoid call-stack limits on String.fromCharCode
  for (let i = 0; i < uint8.length; i += 8192) {
    chunks.push(String.fromCharCode.apply(null, uint8.subarray(i, i + 8192)));
  }
  return chunks.join('');
};

// ---------------------------------------------------------------------------
// TXT parsing
// ---------------------------------------------------------------------------

const parseTxtFile = async (uri) => {
  const file = new File(uri);
  const text = await file.text();
  return text;
};

// ---------------------------------------------------------------------------
// PDF text extraction (lightweight, pure-JS)
//
// Handles the most common case: FlateDecode-compressed text streams with
// Tj / TJ operators.  Won't cover every PDF (e.g. Type-3 fonts, CIDFont
// ToUnicode mappings, image-only pages) but works well for text-heavy docs.
// ---------------------------------------------------------------------------

const decodePdfStream = (streamBytes, filterName) => {
  if (filterName === 'FlateDecode' || filterName === '/FlateDecode') {
    try {
      return pako.inflate(streamBytes);
    } catch {
      return null;
    }
  }
  // Uncompressed or unsupported filter – return as-is
  return streamBytes;
};

const extractTextFromPdfOps = (text) => {
  const parts = [];

  // Match text inside parentheses after Tj: (Hello) Tj
  const tjRegex = /\(([^)]*)\)\s*Tj/g;
  let m;
  while ((m = tjRegex.exec(text)) !== null) {
    parts.push(m[1]);
  }

  // Match TJ arrays: [(Hello ) -10 (World)] TJ
  const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
  while ((m = tjArrayRegex.exec(text)) !== null) {
    const inner = m[1];
    const strRegex = /\(([^)]*)\)/g;
    let s;
    while ((s = strRegex.exec(inner)) !== null) {
      parts.push(s[1]);
    }
  }

  return parts.join('');
};

const parsePdfFile = async (uri) => {
  const file = new File(uri);
  const bytes = await file.bytes();

  const raw = latin1Decode(bytes);
  const textParts = [];

  // Find all stream … endstream blocks
  const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
  let match;
  let streamIndex = 0;

  while ((match = streamRegex.exec(raw)) !== null) {
    streamIndex++;
    const streamStart = match.index;
    // Walk backwards to find the dictionary for this stream to detect filter
    const dictSlice = raw.slice(Math.max(0, streamStart - 512), streamStart);
    const filterMatch = dictSlice.match(/\/Filter\s*(\/\w+)/);
    const filterName = filterMatch ? filterMatch[1] : '';

    const streamContent = match[1];
    const streamBytes = new Uint8Array(streamContent.length);
    for (let i = 0; i < streamContent.length; i++) {
      streamBytes[i] = streamContent.charCodeAt(i);
    }

    const decoded = decodePdfStream(streamBytes, filterName);
    if (!decoded) continue;

    let decodedText;
    try {
      decodedText = latin1Decode(decoded instanceof Uint8Array ? decoded : new Uint8Array(decoded));
    } catch {
      continue;
    }

    // Only process streams that look like text content (contain BT … ET)
    if (decodedText.includes('BT') && decodedText.includes('ET')) {
      const btBlocks = decodedText.match(/BT[\s\S]*?ET/g) || [];
      for (const block of btBlocks) {
        const extracted = extractTextFromPdfOps(block);
        if (extracted.trim()) {
          textParts.push(extracted.trim());
        }
      }
    }
  }

  const result = textParts.join('\n').trim();

  if (!result) {
    throw new Error(
      'Could not extract text from this PDF. It may be image-based or use an unsupported encoding.'
    );
  }

  return result;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the text content of a picked file.
 * @param {{ uri: string, mimeType?: string, name?: string }} file
 * @returns {Promise<string>} extracted text
 */
export const readFileContent = async (file) => {
  const ext = (file.name ?? '').split('.').pop()?.toLowerCase();
  const mime = (file.mimeType ?? '').toLowerCase();

  if (ext === 'txt' || mime === 'text/plain') {
    return parseTxtFile(file.uri);
  }

  if (ext === 'pdf' || mime === 'application/pdf') {
    return parsePdfFile(file.uri);
  }

  throw new Error(`Unsupported file type: ${ext || mime || 'unknown'}`);
};

/**
 * Split a long text into overlapping chunks suitable for embedding.
 * @param {string} text
 * @param {{ maxChars?: number, overlap?: number }} opts
 * @returns {string[]}
 */
export const chunkText = (text, { maxChars = 1200, overlap = 200 } = {}) => {
  if (!text || text.length <= maxChars) {
    return [text];
  }

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChars;

    // Try to break at a sentence or newline boundary within the last 20 % of the chunk
    if (end < text.length) {
      const searchStart = Math.max(start, end - Math.floor(maxChars * 0.2));
      const slice = text.slice(searchStart, end);
      const breakMatch = slice.match(/[\n.!?]\s/);
      if (breakMatch) {
        end = searchStart + breakMatch.index + 1;
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
    if (start >= text.length) break;
  }

  return chunks.filter(Boolean);
};
