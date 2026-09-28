import { eventsDb } from '../db/client.ts'
import { events, type EventEntity, type EventOp } from '../db/events-schema.ts'

export function logEvent(entity: EventEntity, nodeId: string, op: EventOp, payload: Record<string, unknown> = {}) {
  eventsDb.insert(events).values({ ts: Date.now(), entity, nodeId, op, payload }).run()
}
