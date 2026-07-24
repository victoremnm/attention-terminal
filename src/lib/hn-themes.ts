export interface HnTheme {
  label: string;
  count: number;
  coverage: number;
  representativeCommentIds: number[];
  confidence: number;
}

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
  "well", "get", "got", "way", "think", "make", "know", "see", "good", "use", "using", "used", "need",
]);

export function stripHtml(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/<pre>[\s\S]*?<\/pre>/gi, " ")
    .replace(/<code>[\s\S]*?<\/code>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter((w) => w.length > 2);
}

export function extractDiscussionThemes(
  comments: Array<{ id: number; text: string }>,
  storyTitle?: string,
  maxThemes = 5
): HnTheme[] {
  const validComments = comments
    .map((c) => ({ id: c.id, cleanText: stripHtml(c.text) }))
    .filter((c) => c.cleanText.length >= 10);

  if (validComments.length < 3) {
    return [];
  }

  const suppressedTokens = new Set<string>();
  if (storyTitle) {
    tokenizeWords(storyTitle).forEach((token) => suppressedTokens.add(token));
  }

  const phraseMatches = new Map<string, Set<number>>();
  const phraseSampleText = new Map<string, string>();

  for (const comment of validComments) {
    const words = tokenizeWords(comment.cleanText);
    const n = words.length;

    for (let len = 1; len <= 3; len++) {
      for (let i = 0; i <= n - len; i++) {
        const phraseWords = words.slice(i, i + len);

        if (phraseWords.some((w) => STOP_WORDS.has(w) && len === 1)) continue;
        if (phraseWords[0] && STOP_WORDS.has(phraseWords[0])) continue;
        if (phraseWords[len - 1] && STOP_WORDS.has(phraseWords[len - 1])) continue;

        if (len === 1 && suppressedTokens.has(phraseWords[0])) continue;

        const normalized = phraseWords.join(" ");
        if (normalized.length < 4) continue;

        const matchedSet = phraseMatches.get(normalized) ?? new Set<number>();
        matchedSet.add(comment.id);
        phraseMatches.set(normalized, matchedSet);

        if (!phraseSampleText.has(normalized)) {
          phraseSampleText.set(normalized, normalized);
        }
      }
    }
  }

  const candidateThemes: HnTheme[] = [];
  const totalCount = validComments.length;

  for (const [phrase, ids] of phraseMatches.entries()) {
    const count = ids.size;
    if (count < 2) continue; // Must be present in at least 2 distinct comments

    const wordCount = phrase.split(" ").length;
    const coverage = Number((count / totalCount).toFixed(2));
    const confidence = Math.min(1.0, Number((0.5 + coverage * 0.5).toFixed(2)));

    // Prefer multi-word technical phrases by boosting score
    const score = count * (wordCount > 1 ? 2.5 : 1.0);

    candidateThemes.push({
      label: phrase,
      count,
      coverage,
      representativeCommentIds: Array.from(ids).slice(0, 3),
      confidence,
    });
  }

  // Deduplicate overlapping phrases (prefer longer or higher coverage phrases)
  candidateThemes.sort((a, b) => b.count - a.count || b.label.length - a.label.length);

  const deduplicated: HnTheme[] = [];
  for (const candidate of candidateThemes) {
    const isSubset = deduplicated.some(
      (existing) =>
        existing.label.includes(candidate.label) || candidate.label.includes(existing.label)
    );
    if (!isSubset) {
      deduplicated.push(candidate);
    }
    if (deduplicated.length >= maxThemes) break;
  }

  return deduplicated;
}
