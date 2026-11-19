/**
 * Character sheet — the right column's stat block (`P1.10`, `P3.3`-`P3.5`).
 *
 * The panel is driven by a resolved row, not by a query: `/home` reads
 * `characters` and hands down the signed-in viewer's record, so the sheet never
 * decides whose character it is. `mode` picks the register — `preview` renders
 * the fixture read-only (no Forge, no HP controls), `live` renders what the
 * collection actually holds, including a skeleton and a read-failure notice.
 *
 * All rules come from `src/lib/d20.ts`; there is no local modifier arithmetic
 * and stat cards are deliberately not clickable — a browser-computed roll would
 * be the dice authority ADR 0005 rejects, so the click path is `P4.8`.
 */

import { useState, type ReactNode } from 'react'
import { useAuth, useMutations, type RecordData } from 'deepspace'
import { Shield } from 'lucide-react'
import { Badge, Button, EmptyState, Input, Label, useToast } from '@/components/ui'
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

/** HP buttons, in render order; `rest` is the whole bar, not a step. */
const HP_STEPS = [
  { key: 'minus-5', label: '-5', delta: -5 },
  { key: 'minus-1', label: '-1', delta: -1 },
  { key: 'plus-1', label: '+1', delta: 1 },
  { key: 'plus-5', label: '+5', delta: 5 },
] as const

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function hpFill(ratio: number): string {
  if (ratio > 0.5) return 'bg-success'
  if (ratio > 0) return 'bg-warning'
  return 'bg-destructive'
}

/** `createConfirmed`/`putConfirmed` reject with a plain `Error`; keep one wording. */
function failureMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The write was refused.'
}

export function CharacterSheetPanel({
  campaignId,
  mode,
  status,
  character,
  items,
}: {
  campaignId: string
  mode: SheetMode
  status: QueryStatus
  character: RecordData<CharacterRow> | null
  items: RecordData<InventoryRow>[]
}) {
  // Hooks run in every branch, so they live above the dispatch. `preview` simply
  // never renders the surfaces that use them.
  const characters = useMutations<CharacterRow>('characters')
  const inventory = useMutations<InventoryRow>('inventory')
  const { userId } = useAuth()
  const { success, error } = useToast()

  const [name, setName] = useState('')
  const [forging, setForging] = useState<ArchetypeName | null>(null)
  const [hpPending, setHpPending] = useState<string | null>(null)

  const live = mode === 'live'

  /**
   * Forge: one `characters` row (all 13 columns, `hp = maxHp`) then the preset's
   * two starter `inventory` rows. Two collections, no transaction — a failed item
   * write is named in the toast, because the sheet itself cannot show the gap
   * once the character row lands.
   */
  async function forge(presetName: ArchetypeName): Promise<void> {
    if (forging !== null) return
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      error('Name required', 'Give the adventurer a name before picking an archetype.')
      return
    }

    const preset = ARCHETYPE_PRESETS[presetName]
    setForging(presetName)

    let characterId: string
    try {
      characterId = await characters.createConfirmed({
        userId: userId ?? '',
        campaignId,
        name: trimmed,
        archetype: preset.name,
        hp: preset.maxHp,
        maxHp: preset.maxHp,
        ac: calculateArmorClass(preset.scores.dex, preset.armorBonus),
        ...preset.scores,
      })
    } catch (cause) {
      setForging(null)
      error('Forge failed', failureMessage(cause))
      return
    }

    const missing: string[] = []
    let itemReason = ''
    for (const item of preset.starterItems) {
      try {
        await inventory.createConfirmed({
          characterId,
          campaignId,
          itemName: item.itemName,
          category: item.category,
          description: item.description,
          quantity: item.quantity,
        })
      } catch (cause) {
        missing.push(item.itemName)
        itemReason = failureMessage(cause)
      }
    }

    setForging(null)
    if (missing.length === 0) {
      success('Adventurer Forged', `${trimmed} the ${preset.name} takes a place at the table.`)
    } else {
      error(
        'Items missing',
        `${trimmed} exists, but ${missing.join(' and ')} did not save. ${itemReason}`,
      )
    }
  }

  /** HP is the only column the browser updates, and only on the viewer's row. */
  async function writeHp(
    record: RecordData<CharacterRow>,
    key: string,
    next: number,
  ): Promise<void> {
    if (hpPending !== null) return
    const maxHp = record.data.maxHp
    const value = clamp(next, 0, maxHp)
    setHpPending(key)
    try {
      await characters.putConfirmed(record.recordId, { hp: value })
      success('HP updated', `${record.data.name} is at ${value}/${maxHp}.`)
    } catch (cause) {
      error('HP not updated', failureMessage(cause))
    } finally {
      setHpPending(null)
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
        // `userBound` pins `userId` server-side; a null id would send `''` and be
        // refused, so the Forge waits for the session to resolve.
        ready={characters.ready && inventory.ready && userId != null}
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

  const controls = live ? (
    <HpControls
      ready={characters.ready && character.data.maxHp > 0}
      pending={hpPending}
      onStep={(key, delta) => {
        void writeHp(character, key, character.data.hp + delta)
      }}
      onRest={() => {
        void writeHp(character, 'rest', character.data.maxHp)
      }}
    />
  ) : undefined

  return <SheetBody character={character.data} carried={items.length} controls={controls} />
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

/** The sheet itself. Presentational: `preview` and `live` differ only in `controls`. */
function SheetBody({
  character,
  carried,
  controls,
}: {
  character: CharacterRow
  carried: number
  controls?: ReactNode
}) {
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

      {controls}
    </section>
  )
}

function HpControls({
  ready,
  pending,
  onStep,
  onRest,
}: {
  ready: boolean
  pending: string | null
  onStep: (key: string, delta: number) => void
  onRest: () => void
}) {
  return (
    <div data-testid="hp-controls" className="mt-3">
      <div className="pixel-rule mb-2" />
      <span className="font-pixel text-[10px] uppercase text-muted-foreground">Adjust HP</span>
      <div className="mt-1 flex flex-wrap gap-1">
        {HP_STEPS.map((step) => (
          <Button
            key={step.key}
            size="sm"
            variant="outline"
            className="pixel-numeral px-2"
            disabled={!ready || pending !== null}
            loading={pending === step.key}
            onClick={() => {
              onStep(step.key, step.delta)
            }}
          >
            {step.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="secondary"
          disabled={!ready || pending !== null}
          loading={pending === 'rest'}
          onClick={onRest}
        >
          Short Rest
        </Button>
      </div>
    </div>
  )
}

/** No character row yet: the only way to get one (`P3.4`, ADR 0008 — no modal). */
function ForgeForm({
  name,
  onNameChange,
  forging,
  ready,
  onForge,
}: {
  name: string
  onNameChange: (name: string) => void
  forging: ArchetypeName | null
  ready: boolean
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
                disabled={!ready || (forging !== null && forging !== presetName)}
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

      {!ready && (
        <p className="mt-2 text-xs text-muted-foreground">
          The forge opens once the table finishes connecting.
        </p>
      )}
    </section>
  )
}
