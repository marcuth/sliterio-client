/**
 * @file entity.ts
 * @description Core entity interfaces, coordinate primitives, and world arena properties.
 */

/**
 * 2D coordinate point in Slither world space.
 */
export interface Point {
    x: number
    y: number
}

/**
 * 2D directional or displacement vector.
 */
export interface Vector {
    x: number
    y: number
}

/**
 * Color index or RGB value for snakes, food, and preys.
 */
export type Color = number

/**
 * Base game entity residing in the world arena with an identifier and position.
 */
export interface Entity {
    id: number
    x: number
    y: number
}

/**
 * Arena world metadata received during initial protocol handshake (packet 'a').
 */
export interface WorldInfo {
    gameRadius: number
    center: Point
    sectorSize: number
    sectorCount?: number
    mscps: number
}
