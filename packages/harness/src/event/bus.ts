// The runtime event bus: two channels with one shape.
//
// `state` carries StateEvents and is fed exclusively by the Sessions aggregate —
// engine code never emits state by hand. `loop` carries LoopEvents, the engine's
// telemetry about the turn loop itself. Consumers subscribe per channel, so an
// observer of loop health never has to filter content traffic and vice versa.
//
// Listeners are isolated: a throwing subscriber is reported and skipped, never
// allowed to break the engine turn that emitted the event.
import type { LoopEvent, StateEvent } from "@contracts"

/** One typed pub/sub channel of the runtime bus. */
export type EventChannel<E> = {
  emit(event: E): void
  subscribe(listener: (event: E) => void): () => void
}

/** The runtime bus: the state channel (session content) and the loop channel (telemetry). */
export type RuntimeEventBus = {
  state: EventChannel<StateEvent>
  loop: EventChannel<LoopEvent>
}

export function createRuntimeEvents(): RuntimeEventBus {
  return {
    state: createChannel<StateEvent>("state"),
    loop: createChannel<LoopEvent>("loop"),
  }
}

function createChannel<E>(name: string): EventChannel<E> {
  const listeners = new Set<(event: E) => void>()

  return {
    emit(event) {
      for (const listener of listeners) {
        try {
          listener(event)
        } catch (error) {
          // A subscriber must never be able to crash the engine mid-turn.
          console.error(`[events] ${name} listener failed:`, error)
        }
      }
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export type { LoopEvent, StateEvent }
