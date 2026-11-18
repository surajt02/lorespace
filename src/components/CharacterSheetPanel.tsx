/**
 * Character sheet — the right column's stat block. Presentational only
 * (`P1.10`): the row and the holder's inventory arrive as props, so `P3.3`
 * swaps the fixture for a live record without touching this markup.
 *
 * The modifier is derived locally on purpose. `src/lib/d20.ts` belongs to
 * Phase 3; importing a dice library here would put the rules in two places.
 */

import { Shield } from 'lucide-react'
import { Badge, EmptyState } from '@/components/ui'
import type { CharacterRow, InventoryRow } from '@/lib/preview-data'

const ATTRIBUTES = [
  ['str', 'STR'],
  ['dex', 'DEX'],
  ['con', 'CON'],
  ['int', 'INT'],
  ['wis', 'WIS'],
  ['cha', 'CHA'],
] as const satisfies ReadonlyArray<readonly [keyof CharacterRow, string]>

function modifier(score: number): string {
  const value = Math.floor((score - 10) / 2)
  return value >= 0 ? `+${value}` : String(value)
}

function hpFill(ratio: number): string {
  if (ratio > 0.5) return 'bg-success'
  if (ratio > 0) return 'bg-warning'
  return 'bg-destructive'
}

export function CharacterSheetPanel({
  character,
  inventory,
}: {
  character: CharacterRow | null
  inventory: InventoryRow[]
}) {
  if (character === null) {
    return (
      <section data-testid="character-sheet" className="pixel-frame bg-card">
        <EmptyState
          icon={<Shield aria-hidden />}
          title="No character at this table"
          description="Your sheet appears here once an adventurer is forged."
        />
      </section>
    )
  }

  const maxHp = character.maxHp
  const hp = Math.min(Math.max(character.hp, 0), maxHp)
  const ratio = maxHp > 0 ? hp / maxHp : 0

  return (
    <section data-testid="character-sheet" className="pixel-frame bg-card p-3">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground">{character.name}</h2>
          <Badge variant="secondary" className="mt-1 font-pixel text-[10px] uppercase">
            {character.archetype}
          </Badge>
        </div>
        <div className="text-right">
          <span className="block font-pixel text-[10px] uppercase text-muted-foreground">AC</span>
          <span className="pixel-numeral text-lg text-foreground">{character.ac}</span>
        </div>
      </header>

      {maxHp > 0 && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between">
            <span className="font-pixel text-[10px] uppercase text-muted-foreground">HP</span>
            <span className="pixel-numeral text-xs text-foreground">
              {hp}
              <span className="text-muted-foreground">/{maxHp}</span>
            </span>
          </div>
          <div className="mt-1 flex items-center gap-px" aria-hidden="true">
            {Array.from({ length: maxHp }, (_, index) => (
              <span
                key={index}
                className={
                  index < hp ? `hp-segment h-2 flex-1 ${hpFill(ratio)}` : 'hp-segment h-2 flex-1 bg-muted'
                }
              />
            ))}
          </div>
        </div>
      )}

      <div className="pixel-rule my-3" />

      <ul className="grid grid-cols-3 gap-2">
        {ATTRIBUTES.map(([key, label]) => (
          <li key={key} className="border border-border bg-secondary px-2 py-1.5 text-center">
            <span className="block font-pixel text-[10px] uppercase text-muted-foreground">{label}</span>
            <span className="pixel-numeral block text-sm text-foreground">{character[key]}</span>
            <span className="pixel-numeral block text-[10px] text-primary">{modifier(character[key])}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 font-pixel text-[10px] uppercase text-muted-foreground">
        {inventory.length} carried
      </p>
    </section>
  )
}
