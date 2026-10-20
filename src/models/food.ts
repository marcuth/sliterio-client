/**
 * @file food.ts
 * @description Food pellet entity tracking coordinates, nutritional value, size, and origin.
 */

import { distance } from "../math/vector.js"
import { Entity, Point } from "./entity.js"

export interface FoodOptions {
    id: number
    x: number
    y: number
    size?: number
    color?: number
    isTurbo?: boolean
}

export class Food implements Entity {
    public readonly id: number
    public readonly x: number
    public readonly y: number
    public readonly size: number
    public readonly color: number
    public readonly isTurbo: boolean

    constructor(
        idOrOptions: number | FoodOptions,
        x?: number,
        y?: number,
        size: number = 1,
        color: number = 0,
        isTurbo: boolean = false,
    ) {
        if (typeof idOrOptions === "object") {
            this.id = idOrOptions.id
            this.x = idOrOptions.x
            this.y = idOrOptions.y
            this.size = idOrOptions.size ?? 1
            this.color = idOrOptions.color ?? 0
            this.isTurbo = idOrOptions.isTurbo ?? false
        } else {
            this.id = idOrOptions
            this.x = x ?? 0
            this.y = y ?? 0
            this.size = size
            this.color = color
            this.isTurbo = isTurbo
        }
    }

    /**
     * Estimated nutritional score of this pellet.
     */
    public get value(): number {
        return Math.max(1, Math.round(this.size))
    }

    /**
     * True if food was ejected from a boosting snake or dropped upon snake death.
     */
    public get isEjected(): boolean {
        return this.size > 2.5 || this.isTurbo
    }

    /**
     * Calculates distance to target point.
     */
    public distanceTo(point: Point): number {
        return distance(this, point)
    }

    public toPoint(): Point {
        return { x: this.x, y: this.y }
    }
}
