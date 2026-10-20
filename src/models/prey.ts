/**
 * @file prey.ts
 * @description Moving glowing prey entity fleeing from nearby snakes.
 */

import { distance } from "../math/vector.js"
import { Entity, Point } from "./entity.js"

export interface PreyOptions {
    id: number
    x: number
    y: number
    size?: number
    color?: number
    speed?: number
    angle?: number
}

export class Prey implements Entity {
    public readonly id: number
    public x: number
    public y: number
    public size: number
    public color: number
    public speed: number
    public angle: number

    constructor(
        idOrOptions: number | PreyOptions,
        x?: number,
        y?: number,
        size: number = 1,
        color: number = 0,
        speed: number = 0,
        angle: number = 0,
    ) {
        if (typeof idOrOptions === "object") {
            this.id = idOrOptions.id
            this.x = idOrOptions.x
            this.y = idOrOptions.y
            this.size = idOrOptions.size ?? 1
            this.color = idOrOptions.color ?? 0
            this.speed = idOrOptions.speed ?? 0
            this.angle = idOrOptions.angle ?? 0
        } else {
            this.id = idOrOptions
            this.x = x ?? 0
            this.y = y ?? 0
            this.size = size
            this.color = color
            this.speed = speed
            this.angle = angle
        }
    }

    public update(x: number, y: number, angle: number, speed: number): void {
        this.x = x
        this.y = y
        this.angle = angle
        this.speed = speed
    }

    public distanceTo(point: Point): number {
        return distance(this, point)
    }

    public toPoint(): Point {
        return { x: this.x, y: this.y }
    }
}
