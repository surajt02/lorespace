import {
  memo,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy, Loader2, X } from 'lucide-react'
import 'highlight.js/styles/atom-one-dark.css'
import type {
  MessagePart,
  ToolInvocation,
} from './ChatPanel.stream'

type MessageTurnProps = {
  role: 'user' | 'assistant' | 'system'
  /** Silkscreen role label above the turn ("Game Master", "You"). */
  label: string
  content: string
  parts?: unknown[]
  isStreaming: boolean
}

/** Finished turns remain memoized while the active turn streams token-by-token. */
export const MessageTurn = memo(function MessageTurn({
  role,
  label,
  content,
  parts,
  isStreaming,
}: MessageTurnProps) {
  const orderedParts = useMemo(
    () => normalizeMessageParts(parts, content),
    [parts, content],
  )

  if (role === 'user') {
    return (
      <div className="flex flex-col items-end">
        <RoleLabel>{label}</RoleLabel>
        <div className="max-w-[85%] border border-border bg-shell-panel px-3 py-2 leading-relaxed text-foreground whitespace-pre-wrap break-words">
          {content}
        </div>
      </div>
    )
  }

  if (role === 'system') {
    const summary = content.replace(/^Earlier conversation summary:\n?/, '')
    return (
      <div className="border border-dashed border-border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
        <div className="mb-1 font-pixel text-[10px] uppercase text-muted-foreground">
          Earlier conversation summary
        </div>
        <div className="whitespace-pre-wrap leading-relaxed">{summary}</div>
      </div>
    )
  }

  return (
    <div className="border-l-2 border-primary pl-3">
      <RoleLabel>{label}</RoleLabel>
      <div className="flex flex-col gap-2">
        {orderedParts.map((part, index) => {
          if (part.type === 'text') {
            if (!part.text) return null
            return <MarkdownText key={index}>{part.text}</MarkdownText>
          }
          return <ToolRow key={index} invocation={part.toolInvocation} />
        })}
        {isStreaming && <LiveIndicator />}
      </div>
    </div>
  )
})

/** One register for both roles: Silkscreen, 10px, uppercase, muted (ADR 0013). */
function RoleLabel({ children }: { children: string }) {
  return (
    <p className="mb-1 font-pixel text-[10px] uppercase text-muted-foreground">{children}</p>
  )
}

export function EmptyState({
  prompts,
  onPick,
}: {
  prompts: string[]
  onPick: (prompt: string) => void
}) {
  return (
    <div className="mx-auto flex h-full max-w-[28rem] flex-col items-start justify-center gap-4 px-2">
      <div className="space-y-1">
        <h2 className="text-[17px] font-medium tracking-tight text-foreground">
          How can I help?
        </h2>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          I can inspect collections and help update records using your permissions.
        </p>
      </div>
      <div className="flex flex-col gap-0.5 pt-2">
        <div className="pb-1 font-pixel text-[10px] uppercase text-muted-foreground">Try</div>
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPick(prompt)}
            className="group flex items-center gap-2 py-1 text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="h-px w-3 shrink-0 bg-border transition-colors group-hover:bg-muted-foreground" />
            <span className="truncate">{prompt}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2">
      <EllipsisDots />
      <span className="font-pixel text-[10px] uppercase text-muted-foreground">Thinking</span>
    </div>
  )
}

function normalizeMessageParts(parts: unknown[] | undefined, content: string): MessagePart[] {
  const validParts = Array.isArray(parts) ? parts.filter(isMessagePart) : []
  if (validParts.length === 0) {
    return content ? [{ type: 'text', text: content }] : []
  }
  if (validParts.some((part) => part.type === 'text') || !content) return validParts
  return [...validParts, { type: 'text', text: content }]
}

function isMessagePart(value: unknown): value is MessagePart {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (candidate.type === 'text') return typeof candidate.text === 'string'
  if (candidate.type !== 'tool-invocation') return false
  return (
    typeof candidate.toolCallId === 'string' &&
    isToolInvocation(candidate.toolInvocation)
  )
}

function isToolInvocation(value: unknown): value is ToolInvocation {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.toolName === 'string' &&
    (candidate.state === 'call' || candidate.state === 'result')
  )
}

function MarkdownText({ children }: { children: string }) {
  return (
    <div
      className="text-foreground leading-relaxed
                 [&_p]:my-2 [&_p]:[overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0
                 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:my-3
                 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:my-3
                 [&_h3]:font-semibold [&_h3]:my-2
                 [&_strong]:font-semibold [&_em]:italic
                 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2
                 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6
                 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6
                 [&_li]:my-0.5
                 [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground
                 [&_hr]:my-3 [&_hr]:border-border
                 [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded-none [&_code]:text-[0.9em]
                 [&_pre]:bg-zinc-900 [&_pre]:text-zinc-100 [&_pre]:rounded-none [&_pre]:p-3 [&_pre]:my-2 [&_pre]:overflow-x-auto
                 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none [&_pre_code]:text-inherit
                 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse
                 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:font-semibold [&_th]:text-left
                 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1"
    >
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

function LiveIndicator() {
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inset-0 animate-ping bg-primary/50" />
        <span className="relative h-1.5 w-1.5 bg-primary" />
      </span>
      <span className="font-pixel text-[10px] uppercase text-muted-foreground">Working</span>
    </div>
  )
}

/**
 * One compact line per tool call: the state as a Silkscreen micro-label, a lucide
 * icon, then the tool's human label and its path. Reads say READING, writes say
 * WRITING when they land, so a loot grant is never described as a read.
 */
function ToolRow({ invocation }: { invocation: ToolInvocation }) {
  const done = invocation.state === 'result'
  const failed = done && isFailedResult(invocation.result)
  const { label, path, kind } = describeTool(invocation.toolName, invocation.args)
  const state = !done ? 'Running' : failed ? 'Failed' : kind === 'write' ? 'Writing' : 'Reading'

  return (
    <div className="flex items-center gap-2 border-l border-border pl-2 text-[12px] leading-tight">
      <span
        className={`shrink-0 font-pixel text-[10px] uppercase ${failed ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {state}
      </span>
      <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
        {!done ? (
          <Loader2 className="size-3 animate-spin text-primary" aria-hidden="true" />
        ) : failed ? (
          <X className="size-3 text-destructive" aria-hidden="true" />
        ) : (
          <Check className="size-3 text-foreground/60" aria-hidden="true" />
        )}
      </span>
      <span className={done && !failed ? 'text-muted-foreground' : 'text-foreground'}>
        {label}
      </span>
      {path && (
        <code className="truncate font-mono text-[11.5px] text-foreground/70">{path}</code>
      )}
    </div>
  )
}

function isFailedResult(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result !== null &&
    'success' in result &&
    result.success === false
  )
}

function describeTool(
  name: string,
  args: unknown,
): { label: string; path?: string; kind: 'read' | 'write' } {
  const values = args && typeof args === 'object'
    ? args as Record<string, unknown>
    : undefined
  const collection = typeof values?.collection === 'string'
    ? values.collection
    : undefined
  const recordId = typeof values?.recordId === 'string'
    ? values.recordId
    : undefined
  const recordPath = collection && recordId
    ? `${collection}/${recordId}`
    : collection

  switch (name) {
    case 'schema_list':
      return { label: 'Listing collections', kind: 'read' }
    case 'schema_describe':
      return { label: 'Describing', path: collection, kind: 'read' }
    case 'records_query':
      return { label: 'Reading', path: collection, kind: 'read' }
    case 'records_get':
      return { label: 'Fetching', path: recordPath, kind: 'read' }
    case 'records_create':
      return { label: 'Creating record in', path: collection, kind: 'write' }
    case 'records_update':
      return { label: 'Updating', path: recordPath, kind: 'write' }
    case 'records_delete':
      return { label: 'Deleting', path: recordPath, kind: 'write' }
    case 'user_current':
      return { label: 'Checking current user', kind: 'read' }
    default:
      // Unknown tools (the GM's own) are named by their id alone: the state
      // micro-label already says what is happening, so a second verb ("Running")
      // would only repeat it.
      return { label: name, kind: 'read' }
  }
}

function EllipsisDots() {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
      <span className="h-1 w-1 bg-muted-foreground animate-[pulse_1.4s_ease-in-out_0ms_infinite]" />
      <span className="h-1 w-1 bg-muted-foreground animate-[pulse_1.4s_ease-in-out_180ms_infinite]" />
      <span className="h-1 w-1 bg-muted-foreground animate-[pulse_1.4s_ease-in-out_360ms_infinite]" />
    </span>
  )
}

type MarkdownElementProps<Tag extends 'a' | 'pre'> =
  ComponentPropsWithoutRef<Tag> & { node?: unknown }

const CodeBlock = ({ children, node: _node, ...props }: MarkdownElementProps<'pre'>) => {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  function copy() {
    const text = ref.current?.textContent
    if (!text) return
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1_500)
    }).catch(() => {
      // Clipboard access can be denied outside a secure context.
    })
  }

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        className="absolute right-2 top-2 inline-flex h-6 items-center gap-1 border border-zinc-700 bg-zinc-800 px-2 text-[11px] font-medium text-zinc-200 opacity-0 transition-opacity hover:bg-zinc-700 focus-visible:opacity-100 group-hover:opacity-100"
      >
        {copied
          ? <Check className="h-3 w-3" aria-hidden="true" />
          : <Copy className="h-3 w-3" aria-hidden="true" />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      <pre ref={ref} {...props}>{children}</pre>
    </div>
  )
}

const ExternalLink = ({
  children,
  href,
  node: _node,
  ...props
}: MarkdownElementProps<'a'>) => (
  <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
    {children}
  </a>
)

const REMARK_PLUGINS = [remarkGfm, remarkBreaks]
const REHYPE_PLUGINS = [rehypeHighlight]
const MARKDOWN_COMPONENTS = { pre: CodeBlock, a: ExternalLink } satisfies Components
