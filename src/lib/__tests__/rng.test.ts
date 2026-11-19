import { describe, expect, it } from 'vitest'
import { rollD20FromBytes } from '@/lib/rng'

/**
 * Unit tests for the bytes → d20 mapper (`P4.4`).
 *
 * The action supplies the entropy (ADR 0005), so this module is a pure function
 * and these are exact assertions: a given byte must produce a given face, the
 * biased tail must be skipped rather than folded in, and an exhausted buffer
 * must throw instead of returning a made-up number. No `crypto`, no
 * `Math.random`, no snapshots.
 */

describe('rollD20FromBytes', () => {
  it('maps the band boundaries to the faces they stand for', () => {
    // Accepted bytes are 0..239; `byte % 20` gives the 1..20 face directly.
    expect(rollD20FromBytes(new Uint8Array([0]))).toBe(1)
    expect(rollD20FromBytes(new Uint8Array([19]))).toBe(20)
    expect(rollD20FromBytes(new Uint8Array([239]))).toBe(20)
  })

  it('rejects 240..255 and falls through to the next accepted byte', () => {
    // 16 rejected bytes then a 0: the first *accepted* byte decides the face,
    // so a modulo over the full range (which would make 1..16 likelier) is not
    // what is being shipped.
    for (const rejected of [240, 248, 255]) {
      expect(rollD20FromBytes(new Uint8Array([rejected, 0]))).toBe(1)
      expect(rollD20FromBytes(new Uint8Array([rejected, 19]))).toBe(20)
    }
    const allRejected = new Uint8Array(14).fill(255)
    expect(rollD20FromBytes(new Uint8Array([...allRejected, 5]))).toBe(6)
  })

  it('throws RangeError when every byte is rejected', () => {
    expect(() => rollD20FromBytes(new Uint8Array(8).fill(240))).toThrow(RangeError)
    // An empty buffer has no accepted byte in it either.
    expect(() => rollD20FromBytes(new Uint8Array(0))).toThrow(RangeError)
  })

  it('is deterministic: the same bytes always give the same face', () => {
    const bytes = new Uint8Array([7, 200, 12, 239, 0])
    expect(rollD20FromBytes(bytes)).toBe(rollD20FromBytes(bytes))
    expect(rollD20FromBytes(bytes)).toBe(8)
  })

  it('spreads 0..199 evenly over 1..20', () => {
    // 0..199 is 200 bytes: ten full 20-wide bands, so every face appears ten
    // times. Asserted twice from the same buffer to pin that the mapping is a
    // function of the bytes, not of any hidden state.
    const bytes = new Uint8Array(200).map((_, index) => index)

    for (let pass = 0; pass < 2; pass += 1) {
      const counts = new Map<number, number>()
      for (const byte of bytes) {
        const face = rollD20FromBytes(new Uint8Array([byte]))
        expect(face).toBeGreaterThanOrEqual(1)
        expect(face).toBeLessThanOrEqual(20)
        counts.set(face, (counts.get(face) ?? 0) + 1)
      }

      expect(counts.size).toBe(20)
      for (let face = 1; face <= 20; face += 1) {
        expect(counts.get(face)).toBe(10)
      }
    }
  })
})
