/**
 * @file events.ts
 * @description Strongly-typed event emitter and event map for the SlitherClient SDK.
 */


import { WorldInfo } from "../models/entity.js"
import { Food } from "../models/food.js"
import { GameState } from "../models/game-state.js"
import { LeaderboardEntry } from "../models/leaderboard.js"
import { Prey } from "../models/prey.js"
import { Snake } from "../models/snake.js"
import { SnakeRemoveReason } from "../protocol/types.js"

export interface DisconnectInfo {
    code?: number
    reason?: string
    wasClean?: boolean
}

export interface SnakeUpdateEvent {
    snake: Snake
    type: "move" | "rotate" | "grow" | "shrink" | "fullness"
}

export interface SnakeDiedEvent {
    snakeId: number
    isSelf: boolean
    killerId?: number
    reason?: SnakeRemoveReason
}

export interface FoodEatenEvent {
    foodId: number
    x: number
    y: number
    eaterSnakeId?: number
}

export interface PreyEatenEvent {
    preyId: number
    eaterSnakeId?: number
}

export enum ClientState {
    DISCONNECTED = "DISCONNECTED",
    CONNECTING = "CONNECTING",
    HANDSHAKING = "HANDSHAKING",
    READY = "READY",
    PLAYING = "PLAYING",
    DEAD = "DEAD",
}

/**
 * Event map for SlitherClient subscriptions.
 */
export interface SlitherClientEvents {
    connect: () => void
    disconnect: (info?: DisconnectInfo) => void
    state_change: (state: ClientState) => void
    game_start: (world: WorldInfo) => void
    spawn: (snake: Snake) => void
    snake_add: (snake: Snake) => void
    snake_update: (event: SnakeUpdateEvent) => void
    snake_died: (event: SnakeDiedEvent) => void
    food_spawn: (foods: Food[]) => void
    food_eaten: (event: FoodEatenEvent) => void
    prey_spawn: (prey: Prey) => void
    prey_update: (prey: Prey) => void
    prey_eaten: (event: PreyEatenEvent) => void
    leaderboard_update: (entries: LeaderboardEntry[]) => void
    tick: (state: GameState) => void
    error: (error: Error) => void
}

/**
 * Type-safe EventEmitter wrapper enforcing parameter typings for declared event signatures.
 * 100% pure TypeScript / universal (runs in Node.js and Browser without polyfills).
 */
export class TypedEventEmitter<TEvents extends { [K in keyof TEvents]: (...args: any[]) => void }> {
    private readonly _listeners = new Map<string, Array<{ fn: (...args: any[]) => void; once: boolean }>>()

    public on<K extends keyof TEvents & string>(event: K, listener: TEvents[K]): this {
        let list = this._listeners.get(event)
        if (!list) {
            list = []
            this._listeners.set(event, list)
        }
        list.push({ fn: listener as (...args: any[]) => void, once: false })
        return this
    }

    public once<K extends keyof TEvents & string>(event: K, listener: TEvents[K]): this {
        let list = this._listeners.get(event)
        if (!list) {
            list = []
            this._listeners.set(event, list)
        }
        list.push({ fn: listener as (...args: any[]) => void, once: true })
        return this
    }

    public off<K extends keyof TEvents & string>(event: K, listener: TEvents[K]): this {
        const list = this._listeners.get(event)
        if (!list) return this
        const idx = list.findIndex((item) => item.fn === (listener as any))
        if (idx !== -1) {
            list.splice(idx, 1)
        }
        return this
    }

    public addListener<K extends keyof TEvents & string>(event: K, listener: TEvents[K]): this {
        return this.on(event, listener)
    }

    public removeListener<K extends keyof TEvents & string>(event: K, listener: TEvents[K]): this {
        return this.off(event, listener)
    }

    public emit<K extends keyof TEvents & string>(event: K, ...args: Parameters<TEvents[K]>): boolean {
        const list = this._listeners.get(event)
        if (!list || list.length === 0) return false
        const toCall = [...list]
        for (const item of toCall) {
            try {
                item.fn(...args)
            } catch (err) {
                if (event === "error") {
                    throw err
                } else {
                    console.error(`Error in event handler for "${event}":`, err)
                }
            }
            if (item.once) {
                this.off(event, item.fn as any)
            }
        }
        return true
    }

    public removeAllListeners(event?: keyof TEvents & string): this {
        if (event) {
            this._listeners.delete(event)
        } else {
            this._listeners.clear()
        }
        return this
    }

    public listenerCount(event: keyof TEvents & string): number {
        return this._listeners.get(event)?.length ?? 0
    }
}
