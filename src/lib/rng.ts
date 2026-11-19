/**
 * The d20's raw bytes → a uniform 1..20 — pure and deterministic (`P4.4`).
 *
 * The rules module `src/lib/d20.ts` takes the d20 as given; this is the one
 * place that turns entropy into it. It imports nothing and calls no global:
 * **the caller supplies the bytes** (`crypto.getRandomValues` inside
 * `rollSkillCheck`), so nothing here can roll on its own and the browser still
 * never computes a roll (ADR 0005).
 *
 * Rejection sampling, not modulo: 256 is not a multiple of 20, so mapping the
 * whole byte range would make 1..16 slightly likelier than 17..20. Dropping
 * 240..255 leaves 240 = 12 × 20 values, evenly spread. `RangeError` is the
 * honest answer to a buffer with no accepted byte in it — the caller re-draws.
 */

/** `240` is the largest multiple of 20 that fits in a byte; the tail is biased. */
const ACCEPTED_BYTE_LIMIT = 240

/**
 * Uniform 1..20 from raw bytes; rejects the biased tail (>= 240).
 *
 * @throws RangeError when every byte in `bytes` was rejected.
 */
export function rollD20FromBytes(bytes: Uint8Array): number {
  for (const byte of bytes) {
    if (byte < ACCEPTED_BYTE_LIMIT) return (byte % 20) + 1
  }
  throw new RangeError('rollD20FromBytes: no accepted byte in the supplied buffer')
}
