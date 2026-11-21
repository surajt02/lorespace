/**
 * Keep the GM out of the machinery (`P5.48`).
 *
 * The brief forbids mechanics words, and the model still occasionally narrates its
 * own bookkeeping — "I armed the WIS check for Mr. Peanut at DC 13; no check was
 * owed on their row before this", "The snapshot shows…". The player sees tool talk
 * in the story, which breaks the fiction worse than a short reply does.
 *
 * A prompt rule has already proven unreliable here, so the engine enforces it: the
 * finished turn is split into sentences and any sentence that talks about the
 * machinery is dropped. If nothing narrative survives, the caller persists nothing
 * (a silent bookkeeping turn is better than a visible one).
 *
 * Deliberately *not* filtered: the in-world ask "Roll WIS against 13", which the
 * voice rules require. Only sentences that also mention the apparatus are cut.
 *
 * Pure: no React, no SDK.
 */

/** Terms that only exist on the engine side of the screen. */
const MACHINERY = [
  /\bsnapshot\b/i,
  /\brequest_check\b/i,
  /\broll-logs?\b/i,
  /\bpending(Stat|Dc|CharacterId)?\b/i,
  /\bactedRound\b/i,
  /\broundNumber\b/i,
  /\b(gm-messages|ai-messages|characters row|campaigns row)\b/i,
  /\bthe tool\b/i,
  /\b(tool[- ]?call|called the)\b/i,
  /\bI (armed|left it alone|didn't arm|did not arm)\b/i,
]

/** A bare "DC 13" is machinery too; "against 13" is how the table hears it. */
const BARE_DC = /\bDC\s*\d+/i

/** Does this sentence talk about the engine rather than the world? */
export function isMechanicsSentence(sentence: string): boolean {
  const text = sentence.trim()
  if (text === '') return false
  if (BARE_DC.test(text)) return true
  return MACHINERY.some((pattern) => pattern.test(text))
}

/** Titles and short forms whose full stop is not a sentence end. */
const ABBREVIATION = /\b(Mr|Mrs|Ms|Dr|St|Sr|vs|etc|e\.g|i\.e|No)\.$/i

/**
 * Sentence split that survives "Mr. Peanut" — otherwise a character's own name
 * would break the prose into separate paragraphs.
 */
function splitSentences(prose: string): string[] {
  const rough = prose.split(/(?<=[.!?…])\s+|\n{2,}/)
  const parts: string[] = []
  for (const piece of rough) {
    const previous = parts[parts.length - 1]
    if (previous !== undefined && ABBREVIATION.test(previous.trim())) {
      parts[parts.length - 1] = `${previous} ${piece}`
      continue
    }
    parts.push(piece)
  }
  return parts
}

/**
 * The turn's prose with machinery sentences removed. Sentence boundaries are kept
 * as written (no re-flowing), so the surviving narration reads unchanged.
 */
export function stripMechanicsTalk(prose: string): { text: string; removed: number } {
  const parts = splitSentences(prose)
  const kept: string[] = []
  let removed = 0
  for (const part of parts) {
    if (isMechanicsSentence(part)) {
      removed += 1
      continue
    }
    if (part.trim() !== '') kept.push(part.trim())
  }
  return { text: kept.join('\n\n').trim(), removed }
}
