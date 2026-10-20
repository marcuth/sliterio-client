/**
 * @file spatial-grid.ts
 * @description High-performance O(1) Spatial Hash Grid and fast proximity queries for bot navigation.
 */

import { Point, WorldInfo } from "../models/entity.js"
import { Food } from "../models/food.js"
import { Snake } from "../models/snake.js"
import { distance, distanceSquared, distanceToBoundary, distanceToSegment, normalizeAngle } from "./vector.js"

export interface SpatialItem {
    id: number
    x: number
    y: number
}

export interface NearestFoodOptions {
    minSize?: number
    maxDistance?: number
    preferEjected?: boolean
}

export interface FoodCluster {
    x: number
    y: number
    count: number
    value: number
}

export interface Obstacle {
    type: "snake_body" | "snake_head" | "boundary"
    snakeId?: number
    point: Point
    distance: number
    radius: number
}

export interface SafeHeadingOptions extends ObstacleScanOptions {
    /** How far ahead each candidate heading is checked (default 450). */
    lookahead?: number
    /** Number of candidate headings tested around the circle (default 48). */
    candidates?: number
    /** Extra clearance kept from other snakes' bodies, added to their width (default 35). */
    bodyMargin?: number
    /** Extra clearance kept from the arena edge (default 250). */
    boundaryMargin?: number
    /** How far ahead enemy heads are projected to anticipate where they will be (default 120, checked at 1x and 2x). */
    headLead?: number
    /** Current heading of the controlled snake. With `turnRate` the path takes the time needed to turn into account. */
    currentAngle?: number
    /** Radians the snake can turn while travelling 40 units (default 0.23, typical for a small snake). */
    turnRate?: number
    /** Heading returned by the previous call; staying near it avoids jittering between two detours. */
    previousAngle?: number
}

export interface SafeHeading {
    /** Heading in radians to steer to. */
    angle: number
    /** True when the desired heading was blocked and the result is a detour. */
    avoiding: boolean
    /** True when every heading is blocked, so the result is the least bad one. */
    trapped: boolean
    /** Smallest distance to a hazard along the chosen heading (Infinity when clear). */
    clearance: number
}

export interface ObstacleScanOptions {
    snakes?: Iterable<Snake>
    selfSnakeId?: number | null
    worldCenter?: Point
    worldRadius?: number
    selfTailTolerance?: number
}

/**
 * 2D Spatial Hash Grid providing O(1) insertion, removal, and constant-bounded neighborhood queries.
 */
export class SpatialHashGrid<T extends SpatialItem = SpatialItem> {
    public readonly cellSize: number
    private readonly grid = new Map<string, Map<number, T>>()
    private readonly itemPositions = new Map<number, { x: number; y: number }>()

    constructor(cellSize: number = 250) {
        this.cellSize = cellSize > 0 ? cellSize : 250
    }

    private getKey(x: number, y: number): string {
        const cx = Math.floor(x / this.cellSize)
        const cy = Math.floor(y / this.cellSize)
        return `${cx}:${cy}`
    }

    public get size(): number {
        return this.itemPositions.size
    }

    /**
     * Inserts an item into the spatial grid.
     */
    public insert(item: T): void
    public insert(id: number, x: number, y: number, item: T): void
    public insert(arg1: number | T, arg2?: number, arg3?: number, arg4?: T): void {
        let item: T
        let id: number
        let x: number
        let y: number

        if (typeof arg1 === "object") {
            item = arg1
            id = item.id
            x = item.x
            y = item.y
        } else {
            id = arg1
            x = arg2!
            y = arg3!
            item = arg4!
        }

        // If item already exists at a previous coordinate, remove from old cell
        const existing = this.itemPositions.get(id)
        if (existing) {
            const oldKey = this.getKey(existing.x, existing.y)
            const oldCell = this.grid.get(oldKey)
            if (oldCell) {
                oldCell.delete(id)
                if (oldCell.size === 0) {
                    this.grid.delete(oldKey)
                }
            }
        }

        const key = this.getKey(x, y)
        let cell = this.grid.get(key)
        if (!cell) {
            cell = new Map<number, T>()
            this.grid.set(key, cell)
        }

        cell.set(id, item)
        this.itemPositions.set(id, { x, y })
    }

    /**
     * Removes an item by ID.
     */
    public remove(id: number, x?: number, y?: number): boolean {
        const stored = this.itemPositions.get(id)
        let posX = stored ? stored.x : x
        let posY = stored ? stored.y : y

        if (posX === undefined || posY === undefined) {
            return false
        }

        const key = this.getKey(posX, posY)
        const cell = this.grid.get(key)
        let removed = false

        if (cell) {
            removed = cell.delete(id)
            if (cell.size === 0) {
                this.grid.delete(key)
            }
        }

        if (removed) {
            this.itemPositions.delete(id)
        }
        return removed
    }

    /**
     * Updates an existing item's position.
     */
    public update(item: T): void {
        this.insert(item)
    }

    /**
     * Returns true if item exists in grid.
     */
    public has(id: number): boolean {
        return this.itemPositions.has(id)
    }

    /**
     * Retrieves an item by ID from its current grid cell.
     */
    public get(id: number): T | undefined {
        const pos = this.itemPositions.get(id)
        if (!pos) {
            return undefined
        }
        const cell = this.grid.get(this.getKey(pos.x, pos.y))
        return cell ? cell.get(id) : undefined
    }

    /**
     * Queries all items within a circular radius.
     */
    public queryRadius(centerX: number, centerY: number, radius: number): T[] {
        const results: T[] = []
        if (radius <= 0) {
            return results
        }

        const minCx = Math.floor((centerX - radius) / this.cellSize)
        const maxCx = Math.floor((centerX + radius) / this.cellSize)
        const minCy = Math.floor((centerY - radius) / this.cellSize)
        const maxCy = Math.floor((centerY + radius) / this.cellSize)
        const radiusSq = radius * radius

        for (let cx = minCx; cx <= maxCx; cx++) {
            for (let cy = minCy; cy <= maxCy; cy++) {
                const cell = this.grid.get(`${cx}:${cy}`)
                if (!cell) {
                    continue
                }

                for (const item of cell.values()) {
                    const dx = item.x - centerX
                    const dy = item.y - centerY
                    if (dx * dx + dy * dy <= radiusSq) {
                        results.push(item)
                    }
                }
            }
        }

        return results
    }

    /**
     * Queries all items within an axis-aligned bounding box.
     */
    public queryBounds(minX: number, minY: number, maxX: number, maxY: number): T[] {
        const results: T[] = []
        const minCx = Math.floor(minX / this.cellSize)
        const maxCx = Math.floor(maxX / this.cellSize)
        const minCy = Math.floor(minY / this.cellSize)
        const maxCy = Math.floor(maxY / this.cellSize)

        for (let cx = minCx; cx <= maxCx; cx++) {
            for (let cy = minCy; cy <= maxCy; cy++) {
                const cell = this.grid.get(`${cx}:${cy}`)
                if (!cell) {
                    continue
                }

                for (const item of cell.values()) {
                    if (item.x >= minX && item.x <= maxX && item.y >= minY && item.y <= maxY) {
                        results.push(item)
                    }
                }
            }
        }

        return results
    }

    /**
     * Queries the nearest item to the given position within an optional max distance.
     */
    public queryNearest(
        centerX: number,
        centerY: number,
        maxDistance: number = Infinity,
        filter?: (item: T) => boolean,
    ): { item: T; distance: number } | null {
        // Search cell by cell outwards or use queryRadius if maxDistance is bounded
        const searchRadius = Number.isFinite(maxDistance) ? maxDistance : this.cellSize * 4
        const candidates = this.queryRadius(centerX, centerY, searchRadius)

        let bestItem: T | null = null
        let bestDistSq = Number.isFinite(maxDistance) ? maxDistance * maxDistance : Infinity

        for (const item of candidates) {
            if (filter && !filter(item)) {
                continue
            }
            const dx = item.x - centerX
            const dy = item.y - centerY
            const dSq = dx * dx + dy * dy
            if (dSq < bestDistSq) {
                bestDistSq = dSq
                bestItem = item
            }
        }

        // If no matching candidate was found in the initial radius and search is unbounded,
        // fall back to scanning all items across the entire grid
        if (bestItem === null && !Number.isFinite(maxDistance)) {
            for (const id of this.itemPositions.keys()) {
                const item = this.get(id)
                if (!item) {
                    continue
                }
                if (filter && !filter(item)) {
                    continue
                }
                const dx = item.x - centerX
                const dy = item.y - centerY
                const dSq = dx * dx + dy * dy
                if (dSq < bestDistSq) {
                    bestDistSq = dSq
                    bestItem = item
                }
            }
        }

        return bestItem ? { item: bestItem, distance: Math.sqrt(bestDistSq) } : null
    }

    /**
     * Clears all items and cells from the grid.
     */
    public clear(): void {
        this.grid.clear()
        this.itemPositions.clear()
    }
}

/**
 * High-level proximity queries for bot steering and world evaluation.
 */
export class WorldQueries {
    constructor(
        private readonly foodGrid: SpatialHashGrid<Food>,
        private readonly getWorldInfo?: () => WorldInfo | undefined,
        private readonly getSnakes?: () => Iterable<Snake>,
    ) {}

    /**
     * Finds the most attractive nearest food pellet to the specified point.
     */
    public findNearestFood(from: Point, options?: NearestFoodOptions): Food | null {
        const maxDist = options?.maxDistance ?? 2000
        const candidates = this.foodGrid.queryRadius(from.x, from.y, maxDist)

        let nearest: Food | null = null
        let bestScore = Infinity

        for (const food of candidates) {
            if (options?.minSize !== undefined && food.size < options.minSize) {
                continue
            }

            const dist = distance(from, food)
            const score = options?.preferEjected ? (dist / Math.max(1, food.size)) * (food.isEjected ? 0.5 : 1.0) : dist

            if (score < bestScore) {
                bestScore = score
                nearest = food
            }
        }

        return nearest
    }

    /**
     * Finds high-density food clusters (e.g. death drops from killed snakes).
     */
    public findFoodClusters(from: Point, searchRadius: number = 2500, clusterRadius: number = 300): Point[] {
        const foods = this.foodGrid.queryRadius(from.x, from.y, searchRadius)
        if (foods.length < 4) {
            return []
        }

        const clusters: FoodCluster[] = []

        for (const food of foods) {
            let matched = false
            for (const cl of clusters) {
                if (Math.hypot(food.x - cl.x, food.y - cl.y) <= clusterRadius) {
                    cl.x = (cl.x * cl.count + food.x) / (cl.count + 1)
                    cl.y = (cl.y * cl.count + food.y) / (cl.count + 1)
                    cl.count += 1
                    cl.value += food.value
                    matched = true
                    break
                }
            }

            if (!matched) {
                clusters.push({
                    x: food.x,
                    y: food.y,
                    count: 1,
                    value: food.value,
                })
            }
        }

        return clusters
            .filter((c) => c.count >= 4)
            .sort((a, b) => b.value - a.value)
            .map((c) => ({ x: c.x, y: c.y }))
    }

    /**
     * Scans for nearby obstacles including enemy heads, snake bodies, and arena boundaries.
     */
    public findNearbyObstacles(from: Point, scanRadius: number = 400, options?: ObstacleScanOptions): Obstacle[] {
        const obstacles: Obstacle[] = []

        // 1. Arena Boundary
        const worldInfo = this.getWorldInfo ? this.getWorldInfo() : undefined
        const center = options?.worldCenter ?? worldInfo?.center ?? { x: 21600, y: 21600 }
        const radius = options?.worldRadius ?? worldInfo?.gameRadius ?? 21600

        const boundaryDist = distanceToBoundary(from, center, radius)
        if (boundaryDist < scanRadius) {
            const angleToCenter = Math.atan2(center.y - from.y, center.x - from.x)
            obstacles.push({
                type: "boundary",
                point: {
                    x: from.x - Math.cos(angleToCenter) * boundaryDist,
                    y: from.y - Math.sin(angleToCenter) * boundaryDist,
                },
                distance: boundaryDist,
                radius: 50,
            })
        }

        // 2. Snakes (Heads & Bodies)
        const snakes = options?.snakes ?? (this.getSnakes ? this.getSnakes() : [])
        const selfSnakeId = options?.selfSnakeId ?? null
        const selfTailTolerance = options?.selfTailTolerance ?? 4

        for (const snake of snakes) {
            if (snake.isDead) {
                continue
            }
            const isSelf = selfSnakeId !== null && snake.id === selfSnakeId

            // Enemy snake head
            if (!isSelf) {
                const headDist = distance(from, snake.head)
                if (headDist < scanRadius) {
                    obstacles.push({
                        type: "snake_head",
                        snakeId: snake.id,
                        point: { ...snake.head },
                        distance: headDist,
                        radius: snake.headRadius,
                    })
                }
            }

            // Body segments
            const startIdx = isSelf ? selfTailTolerance : 0
            for (let i = startIdx; i < snake.body.length - 1; i++) {
                const segA = snake.body[i]
                const segB = snake.body[i + 1]
                const segDist = distanceToSegment(from, segA, segB)

                if (segDist < scanRadius) {
                    obstacles.push({
                        type: "snake_body",
                        snakeId: snake.id,
                        point: { ...segA },
                        distance: segDist,
                        radius: 18,
                    })
                }
            }
        }

        return obstacles.sort((a, b) => a.distance - b.distance)
    }

    /**
     * Calculates a safe steering angle toward target while avoiding detected obstacles.
     */
    public getSafeSteeringAngle(
        from: Point,
        target: Point,
        lookaheadRadius: number = 350,
        options?: ObstacleScanOptions,
    ): number {
        const dx = target.x - from.x
        const dy = target.y - from.y
        const desiredAngle = normalizeAngle(Math.atan2(dy, dx))
        const obstacles = this.findNearbyObstacles(from, lookaheadRadius, options)

        if (obstacles.length === 0) {
            return desiredAngle
        }

        let forceX = Math.cos(desiredAngle)
        let forceY = Math.sin(desiredAngle)

        for (const obs of obstacles) {
            const dist = Math.max(1, obs.distance)
            const normDist = Math.max(0.01, dist / lookaheadRadius)
            const factor = Math.max(0, 1 - normDist)
            const repulsion = factor * factor * 5 + 50 / dist
            const obsAngle = Math.atan2(obs.point.y - from.y, obs.point.x - from.x)

            forceX -= Math.cos(obsAngle) * repulsion
            forceY -= Math.sin(obsAngle) * repulsion
        }

        if (Math.abs(forceX) < 1e-6 && Math.abs(forceY) < 1e-6) {
            return normalizeAngle(desiredAngle + Math.PI)
        }

        return normalizeAngle(Math.atan2(forceY, forceX))
    }

    /**
     * Picks the heading closest to `desiredAngle` whose path ahead stays clear of other snakes and the arena edge.
     *
     * Several headings are sampled around the circle; each is walked in steps and rejected if it comes too close to
     * an enemy body, a projected enemy head or the boundary. Among the safe ones, the one closest to the desired
     * heading wins, preferring more clearance. When nothing is safe the heading with the most clearance is returned.
     */
    public findSafeHeading(from: Point, desiredAngle: number, options?: SafeHeadingOptions): SafeHeading {
        const lookahead = options?.lookahead ?? 450
        const candidates = Math.max(8, options?.candidates ?? 48)
        const bodyMargin = options?.bodyMargin ?? 45
        const boundaryMargin = options?.boundaryMargin ?? 250
        const headLead = options?.headLead ?? 120

        const worldInfo = this.getWorldInfo ? this.getWorldInfo() : undefined
        const center = options?.worldCenter ?? worldInfo?.center
        const radius = options?.worldRadius ?? worldInfo?.gameRadius
        const selfSnakeId = options?.selfSnakeId ?? null
        const selfTailTolerance = options?.selfTailTolerance ?? 8
        const reach = lookahead + 300

        // Hazards: [x, y, safe distance] circles, plus body segments kept as segments.
        const circles: Array<{ x: number; y: number; w: number }> = []
        const segments: Array<{ a: Point; b: Point; w: number }> = []

        const snakes = options?.snakes ?? (this.getSnakes ? this.getSnakes() : [])
        for (const snake of snakes) {
            if (snake.isDead) continue
            const isSelf = selfSnakeId !== null && snake.id === selfSnakeId
            // Width grows with the segment count, as in the official client
            const width = 14.5 * Math.min(6, 1 + Math.max(0, snake.body.length - 2) / 106)

            if (!isSelf) {
                circles.push({ x: snake.head.x, y: snake.head.y, w: width + 25 })
                for (const lead of [headLead, headLead * 2]) {
                    circles.push({
                        x: snake.head.x + Math.cos(snake.angle) * lead,
                        y: snake.head.y + Math.sin(snake.angle) * lead,
                        w: width + 25,
                    })
                }
            }

            for (let i = isSelf ? selfTailTolerance : 0; i < snake.body.length - 1; i++) {
                const a = snake.body[i]
                const b = snake.body[i + 1]
                if (distanceToSegment(from, a, b) < reach) {
                    segments.push({ a, b, w: width })
                }
            }
        }

        const step = 40
        const steps = Math.max(1, Math.floor(lookahead / step))
        let best: { angle: number; score: number; clearance: number } | null = null
        let bestUnsafe: { angle: number; clearance: number } | null = null
        let desiredClear = false

        for (let c = 0; c < candidates; c++) {
            // Spread candidates symmetrically around the desired heading
            const offset = Math.ceil(c / 2) * ((2 * Math.PI) / candidates) * (c % 2 === 0 ? 1 : -1)
            const angle = normalizeAngle(desiredAngle + offset)
            const limitTurn = options?.currentAngle !== undefined && options?.turnRate !== undefined
            const turnRate = options?.turnRate ?? 0.23
            let heading = options?.currentAngle ?? angle
            let px = from.x
            let py = from.y

            let clearance = Infinity
            for (let k = 1; k <= steps; k++) {
                if (limitTurn) {
                    // Move toward the candidate heading no faster than the snake can actually turn
                    let diff = angle - heading
                    diff = Math.atan2(Math.sin(diff), Math.cos(diff))
                    heading += Math.max(-turnRate, Math.min(turnRate, diff))
                } else {
                    heading = angle
                }
                px += Math.cos(heading) * step
                py += Math.sin(heading) * step
                const p = { x: px, y: py }
                let free = Infinity

                if (center && radius !== undefined) {
                    free = Math.min(free, radius - boundaryMargin - Math.hypot(px - center.x, py - center.y))
                }
                // The first steps only need a thin margin so a snake already close to a hazard can still pull away;
                // the full margin applies further ahead.
                const margin = 12 + (bodyMargin - 12) * Math.min(1, (k - 1) / 3)
                for (const circle of circles) {
                    free = Math.min(free, Math.hypot(px - circle.x, py - circle.y) - circle.w - margin)
                }
                for (const seg of segments) {
                    free = Math.min(free, distanceToSegment(p, seg.a, seg.b) - seg.w - margin)
                }

                if (free < clearance) clearance = free
                if (clearance < 0) {
                    // Rank blocked headings by how far they get, then by how deep into the hazard they end up
                    clearance = -1e6 + (k - 1) * 1e3 + clearance
                    break
                }
            }

            const blocked = clearance < 0
            if (c === 0) desiredClear = !blocked

            if (blocked) {
                if (!bestUnsafe || clearance > bestUnsafe.clearance) bestUnsafe = { angle, clearance }
                continue
            }

            // Closer to the desired heading is better; clearance breaks ties
            let score = -Math.abs(offset) + Math.min(clearance, 200) / 400
            if (options?.previousAngle !== undefined) {
                let drift = angle - options.previousAngle
                drift = Math.atan2(Math.sin(drift), Math.cos(drift))
                score -= Math.abs(drift) * 0.5
            }
            if (!best || score > best.score) best = { angle, score, clearance }
        }

        if (best) {
            return { angle: best.angle, avoiding: !desiredClear, trapped: false, clearance: best.clearance }
        }
        const fallback = bestUnsafe ?? { angle: desiredAngle, clearance: 0 }
        return { angle: fallback.angle, avoiding: true, trapped: true, clearance: 0 }
    }
}
