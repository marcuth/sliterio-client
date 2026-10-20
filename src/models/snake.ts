/**
 * @file snake.ts
 * @description Snake entity model tracking head position, body segments, angle, speed, score, and boost state.
 */

import { directionTo, distance, normalizeAngle } from "../math/vector.js"
import { Point } from "./entity.js"

export interface SnakeData {
    id: number
    name?: string
    skin?: number
    head?: Point
    body?: Point[]
    angle?: number
    targetAngle?: number
    speed?: number
    fullness?: number
    isBoosting?: boolean
}

export class Snake {
    public readonly id: number
    public name: string
    public skin: number
    public head: Point
    public body: Point[]
    public angle: number
    public targetAngle: number
    public speed: number
    public fullness: number
    public isBoosting: boolean
    public isDead: boolean
    /** Exact score reported by the server protocol, when available. */
    public scoreOverride?: number

    constructor(data: SnakeData) {
        this.id = data.id
        this.name = data.name ?? ""
        this.skin = data.skin ?? 0
        this.head = data.head ? { ...data.head } : { x: 0, y: 0 }
        this.body = data.body ? data.body.map((p) => ({ ...p })) : [{ ...this.head }]
        this.angle = data.angle ?? 0
        this.targetAngle = data.targetAngle ?? this.angle
        this.speed = data.speed ?? 0
        this.fullness = data.fullness ?? 0
        this.isBoosting = data.isBoosting ?? false
        this.isDead = false
    }

    public get x(): number {
        return this.head.x
    }

    public set x(val: number) {
        this.head.x = val
    }

    public get y(): number {
        return this.head.y
    }

    public set y(val: number) {
        this.head.y = val
    }

    /**
     * Normalized fullness ratio guaranteed to be within [0, 1].
     * Handles raw 24-bit ints (0..16777215), raw 16-bit ints (0..65535), and percentages (0..100).
     */
    public get normalizedFullness(): number {
        if (this.fullness <= 1) return Math.max(0, this.fullness)
        if (this.fullness <= 100) return this.fullness / 100
        if (this.fullness <= 65535) return this.fullness / 65535
        return this.fullness / 16777215
    }

    /**
     * Estimated snake length based on body parts count and fullness ratio.
     */
    public get length(): number {
        return this.body.length + this.normalizedFullness
    }

    /**
     * Approximate in-game score calculated from length and mass.
     */
    public get score(): number {
        if (this.scoreOverride !== undefined) return this.scoreOverride
        return Math.floor(15 + this.body.length * 10 + this.normalizedFullness * 10)
    }

    /**
     * Dynamic head collision radius scaling with length.
     */
    public get headRadius(): number {
        return Math.min(30, 14 + Math.sqrt(this.length) * 0.5)
    }

    /**
     * Tail position (last body segment).
     */
    public get tail(): Point {
        return this.body[this.body.length - 1] ?? this.head
    }

    /**
     * Computes Euclidean distance from snake head to target point.
     */
    public getDistanceTo(point: Point): number {
        return distance(this.head, point)
    }

    /**
     * Computes heading angle in radians from snake head to target point.
     */
    public getAngleTo(point: Point): number {
        return directionTo(this.head, point)
    }

    /**
     * Updates head position (from 'g' or 'G' packets).
     */
    public updateHead(x: number, y: number): void {
        this.head.x = x
        this.head.y = y
        if (this.body.length === 0) {
            this.body.push({ x, y })
            return
        }

        this.body[0] = { x, y }
        const spacing = 14
        for (let i = 1; i < this.body.length; i++) {
            const prev = this.body[i - 1]
            const curr = this.body[i]
            const dx = prev.x - curr.x
            const dy = prev.y - curr.y
            const dist = Math.hypot(dx, dy)
            if (dist > spacing) {
                const ratio = spacing / dist
                curr.x = prev.x - dx * ratio
                curr.y = prev.y - dy * ratio
            }
        }
    }

    /**
     * Updates rotation and speed (from 'e' or 'E' packets).
     */
    /**
     * Moves the head to a new position, shifting the body so every segment keeps its real position.
     *
     * @param grow When true the tail is kept, so the snake gets one segment longer
     */
    public advance(x: number, y: number, grow: boolean = false): void {
        this.head.x = x
        this.head.y = y
        this.body.unshift({ x, y })
        if (!grow && this.body.length > 1) {
            this.body.pop()
        }
    }

    public updateRotation(angle: number, targetAngle?: number, speed?: number): void {
        this.angle = normalizeAngle(angle)
        if (targetAngle !== undefined) {
            this.targetAngle = normalizeAngle(targetAngle)
        }
        if (speed !== undefined) {
            this.speed = speed
            // Official game convention: speed > 10 typically indicates boost
            this.isBoosting = speed > 10
        }
    }

    /**
     * Appends a body part to the snake (from 'n' or 'N' packets).
     */
    public addBodyPart(x: number, y: number): void {
        this.body.push({ x, y })
    }

    /**
     * Removes the last tail segment.
     */
    public removeTail(): Point | undefined {
        return this.body.pop()
    }

    /**
     * Updates fullness / mass ratio (from 'h' packet).
     */
    public setFullness(fam: number): void {
        this.fullness = fam
    }

    /**
     * Sets boost state.
     */
    public setBoosting(boosting: boolean): void {
        this.isBoosting = boosting
    }

    /**
     * Marks the snake as dead.
     */
    public setDead(dead: boolean = true): void {
        this.isDead = dead
    }
}
