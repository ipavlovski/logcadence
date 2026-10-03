import { and, eq, gt, lt } from 'drizzle-orm'
import os from 'node:os'
import { union, type ActivitySpansDTO, type Span } from '../../shared/activity.ts'
import { activitySpans } from '../db/content-schema.ts'
import type { ContentDb } from '../db/open.ts'

// Records keyboard/mouse activity by polling the OS's "seconds since the last input" (the desktop app passes
// Electron's powerMonitor.getSystemIdleTime). That counter can't tell the mouse from the keyboard, but needs
// no native hooks and sees input in every app. Open spans live in memory and are written once a minute.

export const POLL_MS = 5_000
/** Input this close to the previous input continues its span. */
export const IDLE_GAP_MS = 60_000
/** A tick this late means the machine slept (or the process stalled): spans end at the previous tick. */
const TRACK_GAP_MS = 3 * POLL_MS
const FLUSH_MS = 60_000

type Kind = (typeof activitySpans.$inferSelect)['kind']

interface OpenSpan extends Span {
  id?: number
}

export class ActivityRecorder {
  private input?: OpenSpan
  private tracked?: OpenSpan
  private locked = false
  private lastFlush = 0
  private timer?: NodeJS.Timeout

  constructor(
    private db: ContentDb,
    /** Seconds since the last keyboard/mouse input. */
    private idleSeconds: () => number,
    private device = os.hostname(),
    private now = Date.now,
  ) {}

  start() {
    this.timer ??= setInterval(() => this.tick(), POLL_MS)
    this.timer.unref()
    this.tick()
  }

  /** Writes the open spans and stops polling. */
  stop() {
    clearInterval(this.timer)
    this.timer = undefined
    this.close()
  }

  get running() {
    return !!this.timer
  }

  tick() {
    const t = this.now()
    if (this.tracked && t - this.tracked.endAt > TRACK_GAP_MS) this.close()
    this.tracked ??= { startAt: t, endAt: t }
    this.tracked.endAt = t

    if (!this.locked) {
      const lastInput = t - this.idleSeconds() * 1000
      // Only input seen while tracking, and only new input.
      if (lastInput >= this.tracked.startAt && (!this.input || lastInput > this.input.endAt)) {
        if (this.input && lastInput - this.input.endAt <= IDLE_GAP_MS) this.input.endAt = lastInput
        else {
          if (this.input) this.save('input', this.input)
          this.input = { startAt: lastInput, endAt: lastInput }
        }
      }
    }
    if (t - this.lastFlush >= FLUSH_MS) this.flush()
  }

  /** Screen locked: input (typing the password included) doesn't count until it is unlocked. */
  setLocked(locked: boolean) {
    if (locked && this.input) {
      this.save('input', this.input)
      this.input = undefined
    }
    this.locked = locked
  }

  /** Ends the open spans (before the machine sleeps, or on stop). */
  close() {
    if (this.input) this.save('input', this.input)
    if (this.tracked) this.save('tracked', this.tracked)
    this.input = this.tracked = undefined
  }

  private flush() {
    this.lastFlush = this.now()
    if (this.input) this.save('input', this.input)
    if (this.tracked) this.save('tracked', this.tracked)
  }

  private save(kind: Kind, s: OpenSpan) {
    if (s.id != null) this.db.update(activitySpans).set({ endAt: s.endAt }).where(eq(activitySpans.id, s.id)).run()
    else s.id = this.db.insert(activitySpans).values({ device: this.device, kind, startAt: s.startAt, endAt: s.endAt }).returning({ id: activitySpans.id }).get().id
  }
}

let recorder: ActivityRecorder | undefined

export function startRecorder(db: ContentDb, idleSeconds: () => number): ActivityRecorder {
  recorder?.stop()
  recorder = new ActivityRecorder(db, idleSeconds)
  recorder.start()
  return recorder
}

export function stopRecorder() {
  recorder?.stop()
  recorder = undefined
}

/** Spans overlapping [from, to), clipped to it and merged across devices. */
export function spansBetween(db: ContentDb, from: number, to: number): ActivitySpansDTO {
  const rows = db
    .select({ kind: activitySpans.kind, startAt: activitySpans.startAt, endAt: activitySpans.endAt })
    .from(activitySpans)
    .where(and(gt(activitySpans.endAt, from), lt(activitySpans.startAt, to)))
    .all()
  return {
    input: union(rows.filter((r) => r.kind === 'input'), from, to),
    tracked: union(rows.filter((r) => r.kind === 'tracked'), from, to),
    recording: !!recorder?.running,
  }
}
