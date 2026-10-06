import { useEffect, useState } from 'react'
import {
  Button,
  Codicon,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@hermes/plugin-sdk'

/** The i18n hook's return, without importing the hook itself. */
type GanttI18n = ReturnType<typeof import('../i18n').useGanttI18n>

export type BoardOption = {
  slug: string
  label: string
}

/** What the move dialog needs to know about the task (drawer detail). */
export type MoveTaskInfo = {
  id: string
  title: string
  /** ids — the children MUST travel too (backend enforces it). */
  children: string[]
  /** ids — parents stay behind: the task arrives parentless. */
  parents: string[]
}

type Props = {
  open: boolean
  task: MoveTaskInfo | null
  /** All known boards (slug + label); the current one is excluded here. */
  boards: BoardOption[]
  /** Current board slug — never offered as a target. */
  currentBoard: string
  /** i18n bundle, passed down like NewTaskDialog does. */
  i18n: GanttI18n
  onClose: () => void
  /** Runs the move; rejects → error shown, resolves → success toast upstream. */
  onMove: (toBoard: string) => Promise<unknown>
}

/**
 * Board picker for "Move to another board" — copied from the official kanban
 * dialog grammar (Dialog + Select + confirm() gates, like the drawer's own
 * delete item). Every confirmation the flow needs happens here, BEFORE any
 * write:
 *   1. plain move confirmation,
 *   2. children: they must travel — declining blocks the move (reassign them
 *      first, that's the message),
 *   3. parents: the moved task arrives parentless — explicit confirmation.
 * The confirm button shows a spinner while the move is in flight.
 */
export function MoveTaskDialog({ open, task, boards, currentBoard, i18n, onClose, onMove }: Props) {
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Reset per open — the dialog is externally controlled.
  useEffect(() => {
    if (open) {
      setTarget('')
      setError(null)
      setBusy(false)
    }
  }, [open])

  const otherBoards = boards.filter(b => b.slug !== currentBoard)
  const targetLabel = otherBoards.find(b => b.slug === target)?.label || target

  const submit = async () => {
    if (!task || !target || busy) return
    // 1. plain confirmation
    if (!window.confirm(i18n.confirmMove(task.title, targetLabel))) return
    // 2. children must travel — declining blocks the move
    if (task.children.length > 0) {
      if (!window.confirm(i18n.confirmMoveChildren(task.children.length))) {
        setError(i18n.moveChildrenBlock)
        return
      }
    }
    // 3. parents stay behind — explicit confirmation
    if (task.parents.length > 0) {
      if (!window.confirm(i18n.confirmMoveParentLoss(task.parents.length))) return
    }

    setBusy(true)
    setError(null)
    try {
      await onMove(target)
      onClose()
    } catch (err) {
      setError(String((err as Error)?.message || err))
      setBusy(false)
    }
  }

  return (
    <Dialog onOpenChange={o => !o && !busy && onClose()} open={open}>
      <DialogContent className="w-[min(30rem,94vw)] max-w-none">
        <div className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>{i18n.moveToBoard}</DialogTitle>
          </DialogHeader>

          {task ? (
            <div className="flex flex-col gap-1 text-[0.75rem] text-(--ui-text-secondary)">
              <span className="truncate font-medium">{task.title}</span>
              <span className="text-[0.6875rem] text-(--ui-text-quaternary)">
                {task.children.length > 0
                  ? i18n.moveWithChildren(task.children.length)
                  : i18n.moveNoChildren}
              </span>
            </div>
          ) : null}

          <Select onValueChange={setTarget} value={target}>
            <SelectTrigger aria-label={i18n.moveToBoard}>
              <SelectValue placeholder={i18n.movePickBoard} />
            </SelectTrigger>
            <SelectContent>
              {otherBoards.map(b => (
                <SelectItem key={b.slug} value={b.slug}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {error ? <span className="text-[0.75rem] text-destructive">{error}</span> : null}

          <DialogFooter>
            <Button disabled={busy} onClick={onClose} size="sm" variant="ghost">
              {i18n.cancel}
            </Button>
            <Button disabled={!target || busy} onClick={() => void submit()} size="sm">
              {busy ? (
                <>
                  <Codicon name="loading" size="0.75rem" spinning />
                  {i18n.moving}
                </>
              ) : (
                i18n.moveConfirm
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}