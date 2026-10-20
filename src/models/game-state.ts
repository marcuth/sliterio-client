/**
 * @file game-state.ts
 * @description Centralized game world state tracking snakes, food, preys, leaderboard, and packet reconciliation.
 */

import { NearestFoodOptions, Obstacle, SpatialHashGrid, WorldQueries } from "../math/spatial-grid.js"
import { calcFoodId, DeathReason, InboundPacket, SnakeRemoveReason } from "../protocol/types.js"
import { Point, WorldInfo } from "./entity.js"
import { Food } from "./food.js"
import { LeaderboardEntry } from "./leaderboard.js"
import { Prey } from "./prey.js"
import { Snake } from "./snake.js"

export type GameEvent =
    | { type: "game_start"; world: WorldInfo }
    | { type: "spawn"; snake: Snake }
    | { type: "snake_add"; snake: Snake }
    | {
          type: "snake_update"
          snake: Snake
          updateType: "move" | "rotate" | "grow" | "shrink" | "fullness"
      }
    | { type: "snake_died"; snakeId: number; isSelf: boolean; reason?: SnakeRemoveReason }
    | { type: "food_spawn"; foods: Food[] }
    | { type: "food_eaten"; foodId: number; x: number; y: number; eaterSnakeId?: number }
    | { type: "prey_spawn"; prey: Prey }
    | { type: "prey_update"; prey: Prey }
    | { type: "prey_eaten"; preyId: number; eaterSnakeId?: number }
    | { type: "leaderboard_update"; entries: LeaderboardEntry[] }
    | { type: "death"; reason: DeathReason; snakeId: number | null }
    | { type: "sector_add"; sectorX: number; sectorY: number }
    | { type: "sector_remove"; sectorX: number; sectorY: number }

export class GameState {
    public world: WorldInfo = {
        gameRadius: 21600,
        center: { x: 21600, y: 21600 },
        sectorSize: 480,
        sectorCount: 100,
        mscps: 411,
    }

    public mySnakeId: number | null = null
    public readonly snakes = new Map<number, Snake>()
    public readonly foods = new Map<number, Food>()
    public readonly preys = new Map<number, Prey>()
    public leaderboard: LeaderboardEntry[] = []
    public readonly activeSectors = new Set<string>()
    public readonly spatialGrid = new SpatialHashGrid<Food>(250)

    private readonly _queries: WorldQueries

    constructor() {
        this._queries = new WorldQueries(
            this.spatialGrid,
            () => this.world,
            () => this.snakes.values(),
        )
    }

    /**
     * Active player's own snake, or undefined if unspawned or dead.
     */
    public get mySnake(): Snake | undefined {
        if (this.mySnakeId === null) {
            return undefined
        }
        return this.snakes.get(this.mySnakeId)
    }

    /**
     * Convenience alias for mySnake.
     */
    public get self(): Snake | undefined {
        return this.mySnake
    }

    /**
     * True if the player is currently alive in the arena.
     */
    public get isAlive(): boolean {
        return this.mySnake !== undefined && !this.mySnake.isDead
    }

    /**
     * High-level spatial queries helper bound to this game state.
     */
    public get queries(): WorldQueries {
        return this._queries
    }

    /**
     * Direct query helper to find nearest food.
     */
    public findNearestFood(from: Point, options?: NearestFoodOptions): Food | null {
        return this._queries.findNearestFood(from, options)
    }

    /**
     * Direct query helper to find high-density food clusters.
     */
    public findFoodClusters(from: Point, searchRadius?: number, clusterRadius?: number): Point[] {
        return this._queries.findFoodClusters(from, searchRadius, clusterRadius)
    }

    /**
     * Direct query helper to scan for obstacles.
     */
    public findNearbyObstacles(from: Point, scanRadius?: number): Obstacle[] {
        return this._queries.findNearbyObstacles(from, scanRadius, {
            selfSnakeId: this.mySnakeId,
            snakes: this.snakes.values(),
            worldCenter: this.world.center,
            worldRadius: this.world.gameRadius,
        })
    }

    /**
     * Direct query helper for safe obstacle-avoiding steering.
     */
    public getSafeSteeringAngle(from: Point, target: Point, lookaheadRadius?: number): number {
        return this._queries.getSafeSteeringAngle(from, target, lookaheadRadius, {
            selfSnakeId: this.mySnakeId,
            snakes: this.snakes.values(),
            worldCenter: this.world.center,
            worldRadius: this.world.gameRadius,
        })
    }

    /**
     * Adds or updates a food item.
     */
    public addFood(food: Food): void {
        this.foods.set(food.id, food)
        this.spatialGrid.insert(food)
    }

    /**
     * Removes a food item.
     */
    public removeFood(foodId: number, x?: number, y?: number): boolean {
        this.foods.delete(foodId)
        return this.spatialGrid.remove(foodId, x, y)
    }

    /**
     * Clears all entities and resets game state.
     */
    /**
     * Drops every food pellet inside a sector the server stopped streaming.
     */
    private removeFoodInSector(sectorX: number, sectorY: number): void {
        const size = this.world.sectorSize
        for (const food of [...this.foods.values()]) {
            if (Math.floor(food.x / size) === sectorX && Math.floor(food.y / size) === sectorY) {
                this.removeFood(food.id, food.x, food.y)
            }
        }
    }

    public clear(): void {
        this.mySnakeId = null
        this.snakes.clear()
        this.foods.clear()
        this.preys.clear()
        this.leaderboard = []
        this.activeSectors.clear()
        this.spatialGrid.clear()
    }

    /**
     * Ingests a decoded InboundPacket, updates world state accordingly, and returns emitted GameEvents.
     *
     * @param packet Decoded packet from inbound network stream
     * @returns Array of resulting game state events
     */
    public updateFromPacket(packet: InboundPacket): GameEvent[] {
        const events: GameEvent[] = []

        switch (packet.type) {
            case "initial_setup": {
                this.world = {
                    gameRadius: packet.gameRadius,
                    center: { x: packet.gameRadius, y: packet.gameRadius },
                    sectorSize: packet.sectorSize,
                    sectorCount: packet.sectorCount,
                    mscps: packet.mscps,
                }
                events.push({ type: "game_start", world: this.world })
                break
            }

            case "snake_add": {
                let body: Point[] = []
                if ((packet as any).body && (packet as any).body.length > 0) {
                    body = (packet as any).body
                } else if (packet.bodyParts && packet.bodyParts.length > 0) {
                    const first = packet.bodyParts[0]
                    if (Math.hypot(first.x - packet.x, first.y - packet.y) < 1) {
                        body = packet.bodyParts
                    } else {
                        body = [{ x: packet.x, y: packet.y }, ...packet.bodyParts]
                    }
                } else {
                    body = [{ x: packet.x, y: packet.y }]
                }

                const snake = new Snake({
                    id: packet.snakeId,
                    name: packet.nickname || packet.name || "",
                    skin: packet.skinId ?? packet.skin ?? 0,
                    head: { x: packet.x, y: packet.y },
                    body,
                    angle: packet.angle,
                    targetAngle: packet.wantedAngle,
                    speed: packet.speed,
                    fullness: packet.fam,
                })

                if (packet.score !== undefined) snake.scoreOverride = packet.score
                this.snakes.set(packet.snakeId, snake)

                if (this.mySnakeId === packet.snakeId) {
                    events.push({ type: "spawn", snake })
                } else {
                    events.push({ type: "snake_add", snake })
                }
                break
            }

            case "snake_remove": {
                const isSelf = this.mySnakeId !== null && packet.snakeId === this.mySnakeId
                const snake = this.snakes.get(packet.snakeId)
                if (snake) {
                    snake.setDead(true)
                }
                this.snakes.delete(packet.snakeId)

                if (isSelf) {
                    this.mySnakeId = null
                }

                events.push({
                    type: "snake_died",
                    snakeId: packet.snakeId,
                    isSelf,
                    reason: packet.reason,
                })
                break
            }

            case "snake_move":
            case "snake_move_ext": {
                const snake = this.snakes.get(packet.snakeId)
                if (snake) {
                    if ((packet as any).advance) {
                        snake.advance(packet.x, packet.y)
                    } else {
                        snake.updateHead(packet.x, packet.y)
                    }
                    events.push({ type: "snake_update", snake, updateType: "move" })
                }
                break
            }

            case "snake_rotate": {
                const snake = this.snakes.get(packet.snakeId)
                if (snake) {
                    snake.updateRotation(packet.angle ?? snake.angle, packet.wantedAngle, packet.speed)
                    events.push({ type: "snake_update", snake, updateType: "rotate" })
                }
                break
            }

            case "snake_grow":
            case "snake_grow_ext": {
                const snake = this.snakes.get(packet.snakeId)
                if (snake) {
                    if ((packet as any).fromHead) {
                        snake.advance(packet.x, packet.y, true)
                    } else {
                        snake.addBodyPart(packet.x, packet.y)
                    }
                    events.push({ type: "snake_update", snake, updateType: "grow" })
                }
                break
            }

            case "snake_fullness": {
                const snake = this.snakes.get(packet.snakeId)
                if (snake) {
                    snake.setFullness(packet.fam)
                    if (packet.score !== undefined) snake.scoreOverride = packet.score
                    if (packet.removeTail && snake.body.length > 1) snake.removeTail()
                    events.push({ type: "snake_update", snake, updateType: "fullness" })
                }
                break
            }

            case "food_spawn": {
                const fObj = (packet as any).food
                const id = fObj ? fObj.id : packet.id
                const x = fObj ? fObj.x : packet.x
                const y = fObj ? fObj.y : packet.y
                const size = fObj ? fObj.size : packet.size
                const color = fObj ? fObj.color : packet.color
                const isTurbo = fObj ? (fObj.isTurbo ?? false) : (packet.isTurbo ?? false)
                const food = new Food(id, x, y, size, color, isTurbo)
                this.addFood(food)
                events.push({ type: "food_spawn", foods: [food] })
                break
            }

            case "food_batch": {
                const spawned: Food[] = []
                for (const item of packet.foods) {
                    const food = new Food(item.id, item.x, item.y, item.size, item.color)
                    this.addFood(food)
                    spawned.push(food)
                }
                events.push({ type: "food_spawn", foods: spawned })
                break
            }

            case "food_eaten": {
                const foodId = packet.id ?? (packet as any).foodId ?? calcFoodId(packet.x, packet.y)
                this.removeFood(foodId, packet.x, packet.y)
                events.push({
                    type: "food_eaten",
                    foodId,
                    x: packet.x,
                    y: packet.y,
                    eaterSnakeId: packet.eaterSnakeId,
                })
                break
            }

            case "prey_add": {
                const prey = new Prey(packet.preyId, packet.x, packet.y, packet.size, packet.color)
                this.preys.set(prey.id, prey)
                events.push({ type: "prey_spawn", prey })
                break
            }

            case "prey_remove": {
                this.preys.delete(packet.preyId)
                events.push({ type: "prey_eaten", preyId: packet.preyId })
                break
            }

            case "prey_update": {
                const prey = this.preys.get(packet.preyId)
                if (prey) {
                    prey.update(packet.x, packet.y, packet.angle, packet.speed)
                    events.push({ type: "prey_update", prey })
                }
                break
            }

            case "leaderboard": {
                this.leaderboard = packet.entries.map((entry, index) => {
                    const entrySnakeId = (entry as any).snakeId ?? 0
                    const nick = entry.nickname ?? (entry as any).name ?? ""
                    return {
                        rank: entry.rank ?? index + 1,
                        snakeId: entrySnakeId,
                        name: nick,
                        nickname: nick,
                        score: entry.score,
                        isSelf: this.mySnakeId !== null && entrySnakeId === this.mySnakeId,
                    }
                })
                events.push({ type: "leaderboard_update", entries: this.leaderboard })
                break
            }

            case "death": {
                const diedSnakeId = this.mySnakeId
                if (this.mySnakeId !== null) {
                    const selfSnake = this.snakes.get(this.mySnakeId)
                    if (selfSnake) {
                        selfSnake.setDead(true)
                    }
                    this.mySnakeId = null
                }
                events.push({
                    type: "death",
                    reason: packet.reason,
                    snakeId: diedSnakeId,
                })
                break
            }

            case "sector_add": {
                this.activeSectors.add(`${packet.sectorX}:${packet.sectorY}`)
                events.push({ type: "sector_add", sectorX: packet.sectorX, sectorY: packet.sectorY })
                break
            }

            case "sector_remove": {
                this.activeSectors.delete(`${packet.sectorX}:${packet.sectorY}`)
                this.removeFoodInSector(packet.sectorX, packet.sectorY)
                events.push({ type: "sector_remove", sectorX: packet.sectorX, sectorY: packet.sectorY })
                break
            }

            default:
                break
        }

        return events
    }
}
