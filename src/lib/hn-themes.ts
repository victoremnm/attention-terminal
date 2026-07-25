export interface HnTheme {
  label: string;
  count: number;
  coverage: number;
  representativeCommentIds: number[];
  confidence: number;
}

export const HN_THEME_EXTRACTION_LIMITS = {
  maxComments: 100,
  maxInputBytes: 120_000,
  maxPhrases: 20_000,
  maxThemes: 5,
  maxPhraseWords: 3,
  maxPhraseCharacters: 80,
} as const;

const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
  "can", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't",
  "down", "during", "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't", "have",
  "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself", "him",
  "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't",
  "it", "it's", "its", "itself", "just", "like", "me", "more", "most", "mustn't", "my", "myself", "no",
  "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves",
  "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so",
  "some", "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then",
  "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've", "this", "those",
  "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we", "we'd", "we'll", "we're",
  "we've", "were", "weren't", "what", "what's", "when", "when's", "where", "where's", "which", "while",
  "who", "who's", "whom", "why", "why's", "with", "won't", "would", "wouldn't", "you", "you'd", "you'll",
  "you're", "you've", "your", "yours", "yourself", "yourselves", "also", "just", "really", "even", "much",
  "well", "get", "got", "way", "think", "make", "know", "see", "good", "use", "uses", "using", "used", "need",
]);

const URL_NOISE = new Set(["com", "github", "gitlab", "http", "https", "net", "org", "www", "x2f", "x3a"]);

export function stripHtml(raw: string): string {
  if (!raw) return "";
  const decoded = raw
    .replace(/<pre>[\s\S]*?<\/pre>/gi, " ")
    .replace(/<code>[\s\S]*?<\/code>/gi, " ")
    .replace(/<blockquote>[\s\S]*?<\/blockquote>/gi, " ")
    .replace(/<\/(p|div|li|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)));

  return decoded
    .replace(/(^|\n)\s*>.*$/gm, " ")
    .replace(/(?:https?:)?\/\/\S+|www\.\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter((w) => w.length > 2 && !URL_NOISE.has(w));
}

function phrasesOverlap(first: string, second: string): boolean {
  const firstWords = new Set(first.split(" "));
  const secondWords = new Set(second.split(" "));
  const sharedWords = [...firstWords].filter((word) => secondWords.has(word)).length;
  return sharedWords >= Math.min(firstWords.size, secondWords.size);
}

export function extractDiscussionThemes(
  comments: Array<{ id: number; text: string }>,
  storyTitle?: string,
  maxThemes: number = HN_THEME_EXTRACTION_LIMITS.maxThemes,
  configuredSuppressedTokens: readonly string[] = [],
): HnTheme[] {
  const validComments: Array<{ id: number; cleanText: string }> = [];
  const seenCommentIds = new Set<number>();
  const encoder = new TextEncoder();
  let inputBytes = 0;
  let totalValidCommentCount = 0;

  for (const comment of comments) {
    if (seenCommentIds.has(comment.id)) continue;
    seenCommentIds.add(comment.id);

    const cleanText = stripHtml(comment.text);
    if (cleanText.length < 10) continue;
    totalValidCommentCount += 1;

    const commentBytes = encoder.encode(cleanText).byteLength;
    if (validComments.length >= HN_THEME_EXTRACTION_LIMITS.maxComments) continue;
    if (inputBytes + commentBytes > HN_THEME_EXTRACTION_LIMITS.maxInputBytes) continue;

    validComments.push({ id: comment.id, cleanText });
    inputBytes += commentBytes;
    if (validComments.length >= HN_THEME_EXTRACTION_LIMITS.maxComments) break;
  }

  if (validComments.length < 3) {
    return [];
  }

  const suppressedTokens = new Set<string>(
    configuredSuppressedTokens.flatMap((token) => tokenizeWords(token)),
  );
  if (storyTitle) {
    tokenizeWords(storyTitle).forEach((token) => suppressedTokens.add(token));
  }

  const phraseMatches = new Map<string, Set<number>>();
  const phraseSampleText = new Map<string, string>();

  for (const comment of validComments) {
    const words = tokenizeWords(comment.cleanText);
    const n = words.length;

    for (let len = 1; len <= HN_THEME_EXTRACTION_LIMITS.maxPhraseWords; len++) {
      for (let i = 0; i <= n - len; i++) {
        const phraseWords = words.slice(i, i + len);

        if (phraseWords.some((w) => STOP_WORDS.has(w))) continue;

        if (len === 1 && suppressedTokens.has(phraseWords[0])) continue;

        const normalized = phraseWords.join(" ");
        if (
          normalized.length < 4 ||
          normalized.length > HN_THEME_EXTRACTION_LIMITS.maxPhraseCharacters
        ) continue;

        if (
          !phraseMatches.has(normalized) &&
          phraseMatches.size >= HN_THEME_EXTRACTION_LIMITS.maxPhrases
        ) continue;

        const matchedSet = phraseMatches.get(normalized) ?? new Set<number>();
        matchedSet.add(comment.id);
        phraseMatches.set(normalized, matchedSet);

        if (!phraseSampleText.has(normalized)) {
          phraseSampleText.set(normalized, normalized);
        }
      }
    }
  }

  const candidateThemes: Array<{ theme: HnTheme; score: number }> = [];
  const totalCount = totalValidCommentCount;

  for (const [phrase, ids] of phraseMatches.entries()) {
    const count = ids.size;
    const wordCount = phrase.split(" ").length;
    // A single word needs stronger recurrence than a phrase to be useful as a
    // discussion theme; otherwise generic words that happen to repeat twice
    // crowd out the more explainable multi-word evidence.
    if (count < (wordCount === 1 ? 3 : 2)) continue;

    const coverage = Number((count / totalCount).toFixed(2));
    const confidence = Math.min(1.0, Number((0.5 + coverage * 0.5).toFixed(2)));

    // Prefer multi-word technical phrases by boosting score
    const score = count * (wordCount > 1 ? 2.5 : 1.0);

    candidateThemes.push({
      theme: {
        label: phrase,
        count,
        coverage,
        representativeCommentIds: Array.from(ids).slice(0, 3),
        confidence,
      },
      score,
    });
  }

  // Deduplicate overlapping phrases after score-based ordering.
  candidateThemes.sort(
    (a, b) =>
      b.score - a.score ||
      b.theme.count - a.theme.count ||
      b.theme.label.length - a.theme.label.length
  );

  const deduplicated: HnTheme[] = [];
  for (const { theme: candidate } of candidateThemes) {
    const isSubset = deduplicated.some((existing) => phrasesOverlap(existing.label, candidate.label));
    if (!isSubset) {
      deduplicated.push(candidate);
    }
    if (deduplicated.length >= Math.min(maxThemes, HN_THEME_EXTRACTION_LIMITS.maxThemes)) break;
  }

  return deduplicated;
}
