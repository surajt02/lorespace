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
 * All rules come from `src/lib/d20.ts`; there is no local modifier arithmetic.
 * The stat cards are clickable only on the viewer's live sheet (`P4.8`), and a
 * click does not roll anything here: it calls the `rollSkillCheck` action, which
 * is the only roll authority (ADR 0005), and renders what the server returned.
 * A failed action rolls nothing at all — there is no client-side fallback die.
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
  formatModifierSpaced,
  getModifier,
  type ArchetypeName,
  type RollOutcome,
} from '@/lib/d20'
import { pendingLabel, statCardState, type PendingCheck } from '@/lib/pending-check'
import type { AbilityScoreKey } from '@/lib/party-presence'
import type { CharacterRow, InventoryRow } from '@/lib/preview-data'
import { cn } from '@/lib/utils'

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

/** `rollSkillCheck`'s success data, spelled out for the same reason: the action
 *  module is worker-only. These are the server's numbers — the panel formats
 *  them and never recomputes one. */
export interface ResolvedRoll {
  rawRoll: number
  modifier: number
  total: number
  targetDc: number
  outcome: RollOutcome
  rollLogId: string
}

const OUTCOME_LABELS: Record<RollOutcome, string> = {
  critical_success: 'Critical success',
  success: 'Success',
  failure: 'Failure',
  critical_failure: 'Critical failure',
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
  pending = null,
  fallbackStat = null,
}: {
  mode: SheetMode
  status: QueryStatus
  character: RecordData<CharacterRow> | null
  items: RecordData<InventoryRow>[]
  /**
   * The check this character owes, when one is pending (`P5.19`, ADR 0030). The
   * server refuses any other stat (`roll_not_requested`), so the sheet only makes
   * the requested card clickable. It is read from the viewer's own row, so
   * another player's ask never dims these cards.
   */
  pending?: PendingCheck | null
  /**
   * The ability the GM named in prose without registering a check. That card
   * stays rollable so a forgotten `request_check` cannot strand the table; it is
   * ignored while a real check is pending.
   */
  fallbackStat?: AbilityScoreKey | null
}) {
  // Hooks run in every branch, so they live above the dispatch. `preview` simply
  // never renders the surfaces that use them. No mutation hook: this panel reads
  // `characters` and writes only through actions (ADR 0015).
  const { success, error } = useToast()

  const [name, setName] = useState('')
  const [forging, setForging] = useState<ArchetypeName | null>(null)
  // Which card is waiting on the server, so exactly that card shows `loading`
  // and every other card is inert for the duration.
  const [rollingStat, setRollingStat] = useState<AbilityScoreKey | null>(null)

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

  /**
   * Roll: the click sends `{ characterId, statName }` and nothing else. The
   * server draws the d20, applies the modifier, reads the campaign's DC and
   * writes the `roll-logs` row; this only formats the returned payload. A
   * failure toasts and clears — it never fabricates a roll locally (ADR 0005).
   */
  async function rollStat(statName: AbilityScoreKey): Promise<void> {
    if (character === null || rollingStat !== null) return
    setRollingStat(statName)
    try {
      const roll = await callAction<ResolvedRoll>('rollSkillCheck', {
        characterId: character.recordId,
        statName,
      })
      const label =
        ABILITY_SCORES.find((score) => score.key === statName)?.label ?? statName.toUpperCase()
      // The toast is immediate feedback; the banner comes from the `roll-logs`
      // row itself (`RollBannerLayer`), so this panel passes nothing up.
      success(
        `${label} check`,
        `d20(${roll.rawRoll}) ${formatModifierSpaced(roll.modifier)} = ${roll.total} vs DC ${roll.targetDc} — ${OUTCOME_LABELS[roll.outcome]}`,
      )
    } catch (cause) {
      error('Roll failed', failureMessage(cause))
    } finally {
      setRollingStat(null)
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

  return (
    <SheetBody
      character={character.data}
      carried={items.length}
      pending={pending}
      fallbackStat={fallbackStat}
      // Preview mode is read-only: no bearer token, so no roll (ADR 0005).
      onRoll={
        live
          ? (statName) => {
              void rollStat(statName)
            }
          : undefined
      }
      rollingStat={rollingStat}
    />
  )
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

/** The sheet itself. Presentational: `preview` and `live` render the same body.
 *  `onRoll` present turns the six cards into the roll entry point; absent, they
 *  stay display-only (signed-out preview, or a sheet that is not the viewer's). */
function SheetBody({
  character,
  carried,
  pending,
  fallbackStat,
  onRoll,
  rollingStat,
}: {
  character: CharacterRow
  carried: number
  pending: PendingCheck | null
  fallbackStat: AbilityScoreKey | null
  onRoll?: (statName: AbilityScoreKey) => void
  rollingStat?: AbilityScoreKey | null
}) {
  const maxHp = character.maxHp
  const hp = clamp(character.hp, 0, maxHp)
  const ratio = maxHp > 0 ? hp / maxHp : 0

  // One line about the live check: the viewer's own card reads as an
  // instruction ("Roll DEX against 14"). This panel only holds the viewer's row,
  // and that row is the whole gate (ADR 0030), so there is no other sheet to
  // describe here.
  const label = pending ? pendingLabel(pending) : pendingLabel(null, fallbackStat)

  return (
    <section data-testid="character-sheet" className="pixel-frame bg-card p-3">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground">{character.name}</h2>
          <Badge variant="secondary" className="mt-1 font-pixel text-[10px] uppercase">
            {character.archetype}
          </Badge>
          {(pending !== null || fallbackStat !== null) && (
            <p
              data-testid="pending-header"
              className="mt-1 font-pixel text-[10px] uppercase text-primary"
            >
              {label}
            </p>
          )}
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

      {/* One card per ability. With `onRoll` each is a button that asks the
          server to roll (`P4.8`, ADR 0005); without it, an inert `<li>` so the
          preview cannot pretend it can roll. Scores and modifiers share
          `pixel-numeral` with every other number in the shell (ADR 0013). */}
      <ul className="grid grid-cols-3 gap-2">
        {ABILITY_SCORES.map(({ key, label: statLabel }) => {
          const card = (
            <>
              <span className="block font-pixel text-[10px] uppercase text-muted-foreground">
                {statLabel}
              </span>
              <span className="pixel-numeral block text-sm text-foreground">{character[key]}</span>
              <span className="pixel-numeral block text-[10px] text-primary">
                {formatModifier(getModifier(character[key]))}
              </span>
            </>
          )

          const state = statCardState({ pending, stat: key, fallbackStat })
          const rollable = state === 'rollable'

          if (!onRoll) {
            return (
              <li key={key} className="border border-border bg-secondary px-2 py-1.5 text-center">
                {card}
              </li>
            )
          }

          return (
            <li key={key}>
              <Button
                variant="outline"
                size="sm"
                data-testid={`stat-card-${key}`}
                // What the sheet can do is decided by `pending-check.ts`, the
                // same rule the server enforces from this row: only the
                // requested stat of this character is clickable (`P5.20`).
                data-pending={rollable ? 'true' : undefined}
                aria-label={
                  rollable ? `Roll a ${statLabel} check` : `${statLabel} check not requested`
                }
                aria-disabled={!rollable || undefined}
                // One roll in flight: a second click cannot start another.
                disabled={Boolean(rollingStat) || !rollable}
                loading={rollingStat === key}
                className={cn(
                  'h-auto w-full flex-col items-stretch gap-0 whitespace-normal px-2 py-1.5 text-center',
                  rollable
                    ? 'border-primary ring-2 ring-primary'
                    : 'pointer-events-none opacity-40',
                )}
                onClick={() => {
                  onRoll(key)
                }}
              >
                {card}
              </Button>
            </li>
          )
        })}
      </ul>

      {(pending !== null || fallbackStat !== null) && (
        <p
          data-testid="pending-label"
          className="mt-2 font-pixel text-[10px] uppercase text-primary"
        >
          {label}
        </p>
      )}

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
