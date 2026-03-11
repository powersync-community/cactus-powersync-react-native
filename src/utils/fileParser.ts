import { File } from 'expo-file-system/next';
import pako from 'pako';

// Latin1 byte-to-string helper (Hermes doesn't support TextDecoder('latin1'))
const latin1Decode = (uint8: Uint8Array): string => {
  const chunks: string[] = [];
  // Process in 8 KB slices to avoid call-stack limits on String.fromCharCode
  for (let i = 0; i < uint8.length; i += 8192) {
    chunks.push(String.fromCharCode.apply(null, Array.from(uint8.subarray(i, i + 8192))));
  }
  return chunks.join('');
};

// ---------------------------------------------------------------------------
// TXT parsing
// ---------------------------------------------------------------------------

const parseTxtFile = async (uri: string): Promise<string> => {
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

const decodePdfStream = (streamBytes: Uint8Array, filterName: string): Uint8Array | null => {
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

const extractTextFromPdfOps = (text: string): string => {
  const parts: string[] = [];

  // Match text inside parentheses after Tj: (Hello) Tj
  const tjRegex = /\(([^)]*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = tjRegex.exec(text)) !== null) {
    parts.push(m[1]);
  }

  // Match TJ arrays: [(Hello ) -10 (World)] TJ
  const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
  while ((m = tjArrayRegex.exec(text)) !== null) {
    const inner = m[1];
    const strRegex = /\(([^)]*)\)/g;
    let s: RegExpExecArray | null;
    while ((s = strRegex.exec(inner)) !== null) {
      parts.push(s[1]);
    }
  }

  return parts.join('');
};

const parsePdfFile = async (uri: string): Promise<string> => {
  const file = new File(uri);
  const bytes = await file.bytes();

  const raw = latin1Decode(bytes);
  const textParts: string[] = [];

  // Find all stream … endstream blocks
  const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(raw)) !== null) {
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

    let decodedText: string;
    try {
      decodedText = latin1Decode(decoded instanceof Uint8Array ? decoded : new Uint8Array(decoded));
    } catch {
      continue;
    }

    // Only process streams that look like text content (contain BT … ET)
    if (decodedText.includes('BT') && decodedText.includes('ET')) {
      const btBlocks = decodedText.match(/BT[\s\S]*?ET/g) ?? [];
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
 */
export const readFileContent = async (file: {
  uri: string;
  mimeType?: string;
  name?: string;
}): Promise<string> => {
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

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/** Core chunking loop — operates on a single contiguous text section. */
function chunkTextInner(text: string, chunkSize: number, chunkOverlap: number): string[] {
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(text.length, start + chunkSize);

    if (end < text.length) {
      const remainingText = text.slice(start, end + 200); // look ahead a bit

      // Priority order for breaking points (best to worst)
      const breakPoints = [
        /\n\n/g,                    // 1. Paragraph boundaries
        /\n(?=[A-Z0-9])/g,          // 2. Newline + capital/number
        /[.!?]\s+(?=[A-Z])/g,       // 3. Sentence endings + capital
        /[;:]\s+/g,                 // 4. Other punctuation
        /,\s+/g,                    // 5. Comma (last resort)
        /\s+/g,                     // 6. Any whitespace (fallback)
      ];

      let bestBreakPoint = end;

      for (const breakPattern of breakPoints) {
        const matches = Array.from(remainingText.matchAll(breakPattern));

        for (const match of matches) {
          const breakIndex = start + (match.index ?? 0) + match[0].length;
          if (breakIndex >= start + chunkSize * 0.7 && breakIndex <= start + chunkSize) {
            bestBreakPoint = breakIndex;
            break;
          }
        }

        if (bestBreakPoint < end) break;
      }

      end = bestBreakPoint;
    }

    let chunk = text.slice(start, end).trim();

    if (chunk.length > 0) {
      // Add context preservation for overlapping chunks
      if (chunks.length > 0 && chunkOverlap > 0) {
        const overlapStart = Math.max(0, end - chunkOverlap);
        const overlapText = text.slice(overlapStart, start).trim();

        const sentenceMatch = overlapText.match(/[.!?]\s+[^.!?]*$/);
        if (sentenceMatch && sentenceMatch.index !== undefined) {
          const punctuationMatch = sentenceMatch[0].match(/[.!?]\s+/);
          const contextStart =
            overlapStart + sentenceMatch.index + (punctuationMatch?.[0].length ?? 0);
          const contextText = text.slice(contextStart, start).trim();
          if (contextText.length > 0 && contextText.length < chunkOverlap) {
            chunk = `[Previous context: ${contextText}]\n\n${chunk}`;
          }
        }
      }

      chunks.push(chunk);
    }

    if (end >= text.length) break;

    start = Math.max(start + 1, end - chunkOverlap);
    if (start >= end) start = end;
  }

  return chunks;
}

/** Filter tiny chunks and add metadata comments. */
function postProcessChunks(chunks: string[]): string[] {
  const processed = chunks
    .filter((chunk) => chunk.trim().length > 10)
    .map((chunk, index, arr) => {
      const metadata = `<!-- Chunk ${index + 1}/${arr.length}, Length: ${chunk.length} chars -->`;
      return `${metadata}\n${chunk}`;
    });

  console.log(
    `[Chunk] Created ${processed.length} chunks, avg ${Math.round(
      processed.reduce((s, c) => s + c.length, 0) / (processed.length || 1)
    )} chars`
  );

  return processed;
}

/**
 * Split a long text into overlapping chunks suitable for embedding.
 * Pre-splits on [Page N] / [Section N] markers so chunks never span boundaries.
 */
export const chunkText = (
  text: string,
  { maxChars = 1200, overlap = 120 }: { maxChars?: number; overlap?: number } = {}
): string[] => {
  if (!text || text.length <= maxChars) {
    return text ? [text] : [];
  }

  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Pre-split on section/page markers so chunks never cross boundaries
  const pagePattern = /\n?\n?\[(?:Page|Section) \d+\]\n?/g;
  const pageSections = normalizedText.split(pagePattern).filter((s) => s.trim());
  const pageMarkers = normalizedText.match(pagePattern) ?? [];

  if (pageSections.length > 1) {
    const allChunks: string[] = [];
    for (let i = 0; i < pageSections.length; i++) {
      const section = pageSections[i].trim();
      if (!section) continue;
      const marker = i < pageMarkers.length ? pageMarkers[i].trim() + '\n' : '';
      if (section.length <= maxChars) {
        allChunks.push(marker + section);
      } else {
        const subChunks = chunkTextInner(section, maxChars, overlap);
        subChunks.forEach((chunk, j) => {
          allChunks.push(j === 0 ? marker + chunk : chunk);
        });
      }
    }
    return postProcessChunks(allChunks);
  }

  return postProcessChunks(chunkTextInner(normalizedText, maxChars, overlap));
};
