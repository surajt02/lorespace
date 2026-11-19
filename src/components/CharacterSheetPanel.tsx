/**
 * Character sheet — the right column's stat block (`P1.10`, `P3.3`-`P3.5`).
 *
 * The panel is driven by a resolved row, not by a query: `/home` reads
 * `characters` and hands down the signed-in viewer's record, so the sheet never
 * decides whose character it is. `mode` picks the register — `preview` renders
 * the fixture read-only (no Forge), `live` renders what the collection actually
 * holds, including a skeleton and a read-failure notice.
 *
 * The sheet is read-only: the browser never writes `characters` (ADR 0015) and
 * there is no player HP path at all (ADR 0020). HP moves only through the GM
 * action (ADR 0017) and bounded consumable use (ADR 0016); a player reads their
 * `hp` the same way they read their `ac`. The one write here is `forgeCharacter`,
 * a server action called with the bearer session, which creates the row with a
 * server-computed `ac` and `hp = maxHp`. The record it renders still arrives
 * over the room subscription.
 *
 * All rules come from `src/lib/d20.ts`; there is no local modifier arithmetic
 * and stat cards are deliberately not clickable — a browser-computed roll would
 * be the dice authority ADR 0005 rejects, so the click path is `P4.8`.
 */

import { useState } from 'react'
import type { RecordData } from 'deepspace'
import { Shield } from 'lucide-react'
import { Badge, Button, EmptyState, Input, Label, useToast } from '@/components/ui'
import { callAction } from '@/lib/actions'
import {
  ABILITY_SCORES,
  ARCHETYPE_ORDER,
  ARCHETYPE_PRESETS,
  calculateArmorClass,
  formatModifier,
  getModifier,
  type ArchetypeName,
} from '@/lib/d20'
import type { CharacterRow, InventoryRow } from '@/lib/preview-data'

export type SheetMode = 'preview' | 'live'
export type QueryStatus = 'loading' | 'ready' | 'error'

/** `forgeCharacter`'s success data, spelled out locally: importing the action
 *  module for its type would put worker-only modules (zod, `deepspace/worker`)
 *  in this panel's import graph — the same reason `home.tsx` spells out
 *  `SeedResult`. */
interface ForgeResult {
  characterId: string
  name: string
  archetype: string
  itemsMissing: string[]
}

/** Display-only: keeps the bar in range while a stale row is still on screen.
 *  Nothing here writes `hp` (ADR 0020). */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function hpFill(ratio: number): string {
  if (ratio > 0.5) return 'bg-success'
  if (ratio > 0) return 'bg-warning'
  return 'bg-destructive'
}

/** Record mutations reject with a plain `Error`, and `callAction` with an
 *  `ActionCallError` (also an `Error`), so one branch covers both. */
function failureMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The request was refused.'
}

export function CharacterSheetPanel({
  mode,
  status,
  character,
  items,
}: {
  mode: SheetMode
  status: QueryStatus
  character: RecordData<CharacterRow> | null
  items: RecordData<InventoryRow>[]
}) {
  // Hooks run in every branch, so they live above the dispatch. `preview` simply
  // never renders the surfaces that use them. No mutation hook: this panel reads
  // `characters` and writes only through actions (ADR 0015).
  const { success, error } = useToast()

  const [name, setName] = useState('')
  const [forging, setForging] = useState<ArchetypeName | null>(null)

  const live = mode === 'live'

  /**
   * Forge: `forgeCharacter` writes the `characters` row (server-computed `ac`,
   * `hp = maxHp`, `userId` from the bearer session) and the preset's two starter
   * `inventory` rows. There is no transaction, so a failed item comes back in
   * `itemsMissing` and is named in the toast — the character row exists either
   * way, and the sheet cannot show the gap once it lands.
   */
  async function forge(presetName: ArchetypeName): Promise<void> {
    if (forging !== null) return
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      error('Name required', 'Give the adventurer a name before picking an archetype.')
      return
    }

    setForging(presetName)
    try {
      const result = await callAction<ForgeResult>('forgeCharacter', {
        name: trimmed,
        archetype: presetName,
      })
      if (result.itemsMissing.length === 0) {
        success(
          'Adventurer Forged',
          `${result.name} the ${result.archetype} takes a place at the table.`,
        )
      } else {
        error(
          'Items missing',
          `${result.name} exists, but ${result.itemsMissing.join(' and ')} did not save.`,
        )
      }
    } catch (cause) {
      error('Forge failed', failureMessage(cause))
    } finally {
      setForging(null)
    }
  }

  if (live && status === 'loading') return <SheetSkeleton />

  if (live && status === 'error') return <SheetReadError />

  if (live && status === 'ready' && character === null) {
    return (
      <ForgeForm
        name={name}
        onNameChange={setName}
        forging={forging}
        onForge={(presetName) => {
          void forge(presetName)
        }}
      />
    )
  }

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

  return <SheetBody character={character.data} carried={items.length} />
}

/**
 * The live read failed. Never the fixture: a sheet that quietly shows someone
 * else's numbers is the fallback this phase exists to remove (ADR 0014).
 */
function SheetReadError() {
  return (
    <section data-testid="sheet-read-error" className="pixel-frame bg-card p-3">
      <span className="font-pixel text-[10px] uppercase text-destructive">Unavailable</span>
      <p className="mt-1 text-xs text-muted-foreground">
        The sheet could not be read. Reload to try again.
      </p>
    </section>
  )
}

/** Same blocks as the loaded sheet, in the same order, so arriving is not a jump. */
function SheetSkeleton() {
  return (
    <section
      data-testid="character-sheet-skeleton"
      aria-busy="true"
      aria-label="Loading the character sheet"
      className="pixel-frame bg-card p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="h-4 w-2/3 animate-pulse rounded-sm bg-muted" />
          <div className="mt-2 h-3 w-16 animate-pulse rounded-sm bg-muted" />
        </div>
        <div className="shrink-0">
          <div className="ml-auto h-2.5 w-6 animate-pulse rounded-sm bg-muted" />
          <div className="mt-1 h-5 w-10 animate-pulse rounded-sm bg-muted" />
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between">
          <div className="h-2.5 w-6 animate-pulse rounded-sm bg-muted" />
          <div className="h-2.5 w-12 animate-pulse rounded-sm bg-muted" />
        </div>
        <div className="mt-1.5 h-2 w-full animate-pulse rounded-sm bg-muted" />
      </div>

      <div className="pixel-rule my-3" />

      <div className="grid grid-cols-3 gap-2">
        {ABILITY_SCORES.map((score) => (
          <div
            key={score.key}
            className="h-14 animate-pulse rounded-sm border border-border bg-muted"
          />
        ))}
      </div>

      <div className="mt-3 h-2.5 w-16 animate-pulse rounded-sm bg-muted" />
    </section>
  )
}

/** The sheet itself. Presentational: `preview` and `live` render the same body. */
function SheetBody({ character, carried }: { character: CharacterRow; carried: number }) {
  const maxHp = character.maxHp
  const hp = clamp(character.hp, 0, maxHp)
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

      {/* Display-only: no onClick and no pointer affordance. Rolling is the
          server's (`P4.4`/`P4.8`), per ADR 0005. The score and its modifier share
          `pixel-numeral` with every other number in the shell (ADR 0013). */}
      <ul className="grid grid-cols-3 gap-2">
        {ABILITY_SCORES.map(({ key, label }) => (
          <li key={key} className="border border-border bg-secondary px-2 py-1.5 text-center">
            <span className="block font-pixel text-[10px] uppercase text-muted-foreground">{label}</span>
            <span className="pixel-numeral block text-sm text-foreground">
              {character[key]}
            </span>
            <span className="pixel-numeral block text-[10px] text-primary">
              {formatModifier(getModifier(character[key]))}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 font-pixel text-[10px] uppercase text-muted-foreground">
        {carried} carried
      </p>
    </section>
  )
}

/** No character row yet: the only way to get one (`P3.4`, ADR 0008 — no modal).
 *  `forgeCharacter` authenticates with the bearer session, not the room, so the
 *  form is enabled as soon as it renders. */
function ForgeForm({
  name,
  onNameChange,
  forging,
  onForge,
}: {
  name: string
  onNameChange: (name: string) => void
  forging: ArchetypeName | null
  onForge: (presetName: ArchetypeName) => void
}) {
  return (
    <section data-testid="character-forge" className="pixel-frame bg-card p-3">
      <h2 className="text-base font-semibold text-foreground">Forge an adventurer</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        One character per player at this table. Pick a name, then an archetype —
        stats, HP and kit come with it.
      </p>

      <div className="mt-3">
        <Label htmlFor="forge-name" className="font-pixel text-[10px] uppercase text-muted-foreground">
          Name
        </Label>
        <Input
          id="forge-name"
          className="mt-1"
          value={name}
          placeholder="Kaelen"
          autoComplete="off"
          disabled={forging !== null}
          onChange={(event) => {
            onNameChange(event.target.value)
          }}
        />
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {ARCHETYPE_ORDER.map((presetName) => {
          const preset = ARCHETYPE_PRESETS[presetName]
          const ac = calculateArmorClass(preset.scores.dex, preset.armorBonus)
          return (
            <li key={presetName}>
              <Button
                variant="outline"
                data-testid={`forge-preset-${presetName.toLowerCase()}`}
                className="h-auto w-full flex-col items-stretch gap-1 whitespace-normal px-2 py-2 text-left"
                disabled={forging !== null && forging !== presetName}
                loading={forging === presetName}
                onClick={() => {
                  onForge(presetName)
                }}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-pixel text-[10px] uppercase text-foreground">
                    {preset.name}
                  </span>
                  <span className="pixel-numeral text-[10px] text-muted-foreground">
                    AC {ac} · HP {preset.maxHp}
                  </span>
                </span>
                <span className="text-xs font-normal text-muted-foreground">{preset.blurb}</span>
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
