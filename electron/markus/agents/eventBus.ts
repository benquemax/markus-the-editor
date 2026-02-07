/**
 * Agent Event Bus
 *
 * Provides inter-agent communication through an event-driven architecture.
 * Each agent can subscribe to events and emit events to coordinate work.
 * This is the backbone of the multi-agent coordination system.
 */

import { AgentSystemEvents, AgentEventHandler } from './types'

/**
 * Type-safe event subscription.
 */
type EventSubscription<K extends keyof AgentSystemEvents> = {
  event: K
  handler: AgentEventHandler<K>
  id: string
}

/**
 * Event bus for inter-agent communication.
 * Implements a publish-subscribe pattern with type safety.
 */
export class AgentEventBus {
  private subscriptions = new Map<
    keyof AgentSystemEvents,
    EventSubscription<keyof AgentSystemEvents>[]
  >()
  private subscriptionIdCounter = 0

  /**
   * Subscribe to an event type.
   * Returns an unsubscribe function.
   */
  on<K extends keyof AgentSystemEvents>(
    event: K,
    handler: AgentEventHandler<K>
  ): () => void {
    const id = `sub_${++this.subscriptionIdCounter}`
    const subscription: EventSubscription<K> = { event, handler, id }

    const existing = this.subscriptions.get(event) || []
    existing.push(subscription as EventSubscription<keyof AgentSystemEvents>)
    this.subscriptions.set(event, existing)

    // Return unsubscribe function
    return () => {
      const subs = this.subscriptions.get(event)
      if (subs) {
        const index = subs.findIndex(s => s.id === id)
        if (index >= 0) {
          subs.splice(index, 1)
        }
      }
    }
  }

  /**
   * Subscribe to an event type for a single emission.
   * Automatically unsubscribes after the first event.
   */
  once<K extends keyof AgentSystemEvents>(
    event: K,
    handler: AgentEventHandler<K>
  ): () => void {
    const unsubscribe = this.on(event, (data) => {
      unsubscribe()
      handler(data)
    })
    return unsubscribe
  }

  /**
   * Emit an event to all subscribers.
   */
  emit<K extends keyof AgentSystemEvents>(
    event: K,
    data: AgentSystemEvents[K]
  ): void {
    const subs = this.subscriptions.get(event)
    if (subs) {
      for (const sub of subs) {
        try {
          (sub.handler as AgentEventHandler<K>)(data)
        } catch (error) {
          console.error(`[EventBus] Error in handler for ${String(event)}:`, error)
        }
      }
    }
  }

  /**
   * Remove all subscriptions for a specific event type.
   */
  removeAllListeners(event?: keyof AgentSystemEvents): void {
    if (event) {
      this.subscriptions.delete(event)
    } else {
      this.subscriptions.clear()
    }
  }

  /**
   * Get the number of subscribers for an event type.
   */
  listenerCount(event: keyof AgentSystemEvents): number {
    return this.subscriptions.get(event)?.length || 0
  }

  /**
   * Wait for an event with optional timeout.
   * Returns a promise that resolves with the event data.
   */
  waitFor<K extends keyof AgentSystemEvents>(
    event: K,
    timeout?: number
  ): Promise<AgentSystemEvents[K]> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | undefined

      const unsubscribe = this.once(event, (data) => {
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        resolve(data)
      })

      if (timeout) {
        timeoutId = setTimeout(() => {
          unsubscribe()
          reject(new Error(`Timeout waiting for event: ${String(event)}`))
        }, timeout)
      }
    })
  }

  /**
   * Wait for an event that matches a predicate.
   */
  waitForMatch<K extends keyof AgentSystemEvents>(
    event: K,
    predicate: (data: AgentSystemEvents[K]) => boolean,
    timeout?: number
  ): Promise<AgentSystemEvents[K]> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | undefined

      const unsubscribe = this.on(event, (data) => {
        if (predicate(data)) {
          unsubscribe()
          if (timeoutId) {
            clearTimeout(timeoutId)
          }
          resolve(data)
        }
      })

      if (timeout) {
        timeoutId = setTimeout(() => {
          unsubscribe()
          reject(new Error(`Timeout waiting for matching event: ${String(event)}`))
        }, timeout)
      }
    })
  }
}

/**
 * Global event bus instance for the agent system.
 * All agents share this bus for coordination.
 */
export const agentEventBus = new AgentEventBus()
