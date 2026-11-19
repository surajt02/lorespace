/**
 * Party roster — the left column of the table: who is standing, and how badly
 * they are hurt. Prop-driven (`P1.10`); `P4.3` feeds it presence × characters
 * through `PartyPresenceBar`.
 *
 * `online` is optional on purpose: `undefined` means "no liveness claim" — it
 * draws **no** dot at all, which is what the signed-out preview needs, when no
 * presence socket is open. `true`/`false` are the only values that draw one.
 *
 * `isSelf` marks the viewer's own row (`P4.3`); self comes from the viewer's
 * character row, not from presence, because the SDK's peer list excludes self
 * and is empty on every (re)connect.
 *
 * `isTyping` is a peer composing a GM message (`P5.9`): a flat pixel micro-label,
 * never for self — your own composer is the input below the stream. No emoji and
 * no animation; the table is a terminal, not a messenger.
 *
 * Deliberately carries **no** nav user-name test id — `smoke.spec.ts` asserts
 * that id is absent while signed out, and party members are not the nav user.
 */

import { Users } from 'lucide-react'
import { Avatar, AvatarFallback, Badge, EmptyState } from '@/components/ui'

export interface RosterMember {
  id: string
  name: string
  archetype: string
  hp: number
  maxHp: number
  online?: boolean
  isSelf?: boolean
  /** A peer is composing a GM message (`P5.9`). */
  isTyping?: boolean
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function PartyRoster({ members }: { members: RosterMember[] }) {
  return (
    <section data-testid="party-roster" className="flex flex-col gap-2">
      <header className="flex items-center justify-between px-3 pt-3">
        <h2 className="font-pixel text-[10px] uppercase text-muted-foreground">Party</h2>
        <span className="pixel-numeral text-[10px] text-muted-foreground">{members.length}</span>
      </header>

      {members.length === 0 ? (
        <EmptyState
          icon={<Users aria-hidden />}
          title="No one at the table"
          description="Adventurers appear here as they join the campaign."
        />
      ) : (
        <ul className="flex flex-col">
          {members.map((member) => {
            const hp = Math.min(Math.max(member.hp, 0), member.maxHp)
            return (
              <li
                key={member.id}
                data-testid="roster-member"
                className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
              >
                <Avatar className="size-8">
                  <AvatarFallback className="pixel-numeral text-[10px]">
                    {initials(member.name)}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm text-foreground">{member.name}</span>
                    {member.online !== undefined && (
                      <>
                        <span
                          aria-hidden="true"
                          className={
                            member.online
                              ? 'size-1.5 shrink-0 rounded-full bg-success'
                              : 'size-1.5 shrink-0 rounded-full bg-muted-foreground'
                          }
                        />
                        <span className="sr-only">{member.online ? 'online' : 'offline'}</span>
                      </>
                    )}
                    {member.isTyping === true && member.isSelf !== true && (
                      <span
                        data-testid="roster-typing"
                        className="font-pixel text-[10px] uppercase text-primary"
                      >
                        typing
                      </span>
                    )}
                    {member.isSelf && (
                      <span
                        data-testid="roster-self"
                        className="font-pixel text-[10px] uppercase text-muted-foreground"
                      >
                        you
                      </span>
                    )}
                  </div>
                  {member.archetype !== '' && (
                    <Badge variant="secondary" className="mt-1 font-pixel text-[10px] uppercase">
                      {member.archetype}
                    </Badge>
                  )}
                </div>

                {member.maxHp > 0 && (
                  <span className="pixel-numeral text-xs text-foreground">
                    {hp}
                    <span className="text-muted-foreground">/{member.maxHp}</span>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
