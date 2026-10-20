import { describe, expect, it } from "vitest"

import { GameState } from "../../src/models/game-state.js"
import { Snake } from "../../src/models/snake.js"
import {
    DeathReason,
    FoodBatchPacket,
    FoodEatenPacket,
    FoodSpawnPacket,
    InitialSetupPacket,
    LeaderboardPacket,
    PreyAddPacket,
    PreyRemovePacket,
    PreyUpdatePacket,
    SectorAddPacket,
    SectorRemovePacket,
    SnakeAddPacket,
    SnakeFullnessPacket,
    SnakeGrowPacket,
    SnakeMovePacket,
    SnakeRemovePacket,
    SnakeRemoveReason,
    SnakeRotatePacket,
} from "../../src/protocol/types.js"

describe("GameState Reconciliation & Model Layer", () => {
    describe("Initial Arena Setup (Packet 'a')", () => {
        it("configures world bounds and arena metadata from initial setup packet", () => {
            const state = new GameState()
            const setupPacket: InitialSetupPacket = {
                type: "initial_setup",
                opcode: "a",
                timestamp: 10,
                gameRadius: 21600,
                mscps: 411,
                sectorSize: 480,
                sectorCount: 100,
                spangdv: 10,
                nsp1: 1,
                nsp2: 2,
                nsp3: 3,
                mamu: 4,
                mamu2: 5,
                cst: 6,
                protocolVersion: 11,
            }

            const events = state.updateFromPacket(setupPacket)
            expect(events.length).toBe(1)
            expect(events[0].type).toBe("game_start")
            expect(state.world.gameRadius).toBe(21600)
            expect(state.world.center).toEqual({ x: 21600, y: 21600 })
            expect(state.world.sectorSize).toBe(480)
            expect(state.world.mscps).toBe(411)
        })
    })

    describe("Snake Lifecycle & Real-Time Tracking", () => {
        it("adds enemy snakes and triggers snake_add event", () => {
            const state = new GameState()
            const addPacket: SnakeAddPacket = {
                type: "snake_add",
                opcode: "s",
                timestamp: 50,
                snakeId: 42,
                skinId: 7,
                x: 1000,
                y: 1000,
                angle: 1.5,
                wantedAngle: 1.5,
                speed: 5.8,
                fam: 0.2,
                nickname: "ViperBot",
                bodyParts: [
                    { x: 1000, y: 1000 },
                    { x: 990, y: 1000 },
                    { x: 980, y: 1000 },
                ],
            }

            const events = state.updateFromPacket(addPacket)
            expect(events.length).toBe(1)
            expect(events[0].type).toBe("snake_add")

            const snake = state.snakes.get(42)
            expect(snake).toBeDefined()
            expect(snake!.name).toBe("ViperBot")
            expect(snake!.skin).toBe(7)
            expect(snake!.head).toEqual({ x: 1000, y: 1000 })
            expect(snake!.body.length).toBe(3)
            expect(snake!.length).toBeCloseTo(3.2, 5)
            expect(snake!.score).toBe(15 + 30 + 2)
            expect(state.mySnake).toBeUndefined()
            expect(state.isAlive).toBe(false)
        })

        it("tracks player's own snake and identifies spawn", () => {
            const state = new GameState()
            state.mySnakeId = 101

            const spawnPacket: SnakeAddPacket = {
                type: "snake_add",
                opcode: "s",
                timestamp: 60,
                snakeId: 101,
                skinId: 2,
                x: 500,
                y: 500,
                angle: 0,
                wantedAngle: 0,
                speed: 6.0,
                fam: 0,
                nickname: "HeroBot",
                bodyParts: [{ x: 500, y: 500 }],
            }

            const events = state.updateFromPacket(spawnPacket)
            expect(events.length).toBe(1)
            expect(events[0].type).toBe("spawn")
            expect(state.mySnake).toBeDefined()
            expect(state.self).toBe(state.mySnake)
            expect(state.isAlive).toBe(true)
            expect(state.mySnake!.name).toBe("HeroBot")
        })

        it("updates snake head position on movement packets ('g')", () => {
            const state = new GameState()
            state.snakes.set(
                1,
                new Snake({
                    id: 1,
                    head: { x: 100, y: 100 },
                    body: [{ x: 100, y: 100 }],
                })
            )

            const movePacket: SnakeMovePacket = {
                type: "snake_move",
                opcode: "g",
                timestamp: 70,
                snakeId: 1,
                x: 105,
                y: 102,
            }

            const events = state.updateFromPacket(movePacket)
            expect(events.length).toBe(1)
            expect(events[0].type).toBe("snake_update")
            if (events[0].type === "snake_update") {
                expect(events[0].updateType).toBe("move")
            }

            const snake = state.snakes.get(1)!
            expect(snake.head.x).toBe(105)
            expect(snake.head.y).toBe(102)
            expect(snake.body[0]).toEqual({ x: 105, y: 102 })
        })

        it("updates snake angle and detects boosting speed on rotation packets ('e')", () => {
            const state = new GameState()
            const snake = new Snake({
                id: 1,
                head: { x: 0, y: 0 },
                angle: 0,
                speed: 5.5,
            })
            state.snakes.set(1, snake)

            const rotatePacket: SnakeRotatePacket = {
                type: "snake_rotate",
                opcode: "e",
                timestamp: 80,
                snakeId: 1,
                angle: 2.1,
                wantedAngle: 2.3,
                speed: 14.5, // > 10 => boosting
            }

            const events = state.updateFromPacket(rotatePacket)
            expect(events.length).toBe(1)
            expect(events[0].type).toBe("snake_update")

            expect(snake.angle).toBeCloseTo(2.1, 5)
            expect(snake.targetAngle).toBeCloseTo(2.3, 5)
            expect(snake.speed).toBe(14.5)
            expect(snake.isBoosting).toBe(true)
        })

        it("handles snake growth ('n') and fullness updates ('h')", () => {
            const state = new GameState()
            const snake = new Snake({
                id: 1,
                head: { x: 100, y: 100 },
                body: [{ x: 100, y: 100 }],
            })
            state.snakes.set(1, snake)

            // Grow body segment
            const growPacket: SnakeGrowPacket = {
                type: "snake_grow",
                opcode: "n",
                timestamp: 90,
                snakeId: 1,
                x: 95,
                y: 95,
            }

            state.updateFromPacket(growPacket)
            expect(snake.body.length).toBe(2)
            expect(snake.body[1]).toEqual({ x: 95, y: 95 })

            // Update fullness
            const fullnessPacket: SnakeFullnessPacket = {
                type: "snake_fullness",
                opcode: "h",
                timestamp: 100,
                snakeId: 1,
                fam: 0.85,
            }

            state.updateFromPacket(fullnessPacket)
            expect(snake.fullness).toBe(0.85)
            expect(snake.length).toBeCloseTo(2.85, 5)
        })

        it("removes dead snakes and marks self dead upon snake_remove", () => {
            const state = new GameState()
            state.mySnakeId = 5
            state.snakes.set(5, new Snake({ id: 5, head: { x: 0, y: 0 } }))
            state.snakes.set(10, new Snake({ id: 10, head: { x: 100, y: 100 } }))

            // Enemy dead
            const enemyDead: SnakeRemovePacket = {
                type: "snake_remove",
                opcode: "s",
                timestamp: 110,
                snakeId: 10,
                reason: SnakeRemoveReason.DIED,
            }

            const ev1 = state.updateFromPacket(enemyDead)
            expect(ev1.length).toBe(1)
            expect(ev1[0].type).toBe("snake_died")
            if (ev1[0].type === "snake_died") {
                expect(ev1[0].snakeId).toBe(10)
                expect(ev1[0].isSelf).toBe(false)
            }
            expect(state.snakes.has(10)).toBe(false)
            expect(state.isAlive).toBe(true)

            // Self dead
            const selfDead: SnakeRemovePacket = {
                type: "snake_remove",
                opcode: "s",
                timestamp: 120,
                snakeId: 5,
                reason: SnakeRemoveReason.DIED,
            }

            const ev2 = state.updateFromPacket(selfDead)
            expect(ev2.length).toBe(1)
            if (ev2[0].type === "snake_died") {
                expect(ev2[0].snakeId).toBe(5)
                expect(ev2[0].isSelf).toBe(true)
            }
            expect(state.mySnakeId).toBeNull()
            expect(state.isAlive).toBe(false)
        })
    })

    describe("Food Lifecycle & Spatial Tracking", () => {
        it("handles food spawning, batch spawning, and consumption", () => {
            const state = new GameState()

            // Spawn individual food
            const singleSpawn: FoodSpawnPacket = {
                type: "food_spawn",
                opcode: "f",
                timestamp: 130,
                id: 1001,
                x: 200,
                y: 300,
                size: 3.5,
                color: 4,
                isTurbo: true,
            }

            const evSpawn = state.updateFromPacket(singleSpawn)
            expect(evSpawn.length).toBe(1)
            expect(state.foods.size).toBe(1)
            expect(state.spatialGrid.size).toBe(1)

            const food = state.foods.get(1001)!
            expect(food.x).toBe(200)
            expect(food.y).toBe(300)
            expect(food.isEjected).toBe(true)
            expect(food.value).toBe(4)

            // Batch spawn
            const batchSpawn: FoodBatchPacket = {
                type: "food_batch",
                opcode: "F",
                timestamp: 140,
                foods: [
                    { id: 2001, x: 210, y: 310, size: 2, color: 1 },
                    { id: 2002, x: 220, y: 320, size: 2, color: 1 },
                ],
            }

            const evBatch = state.updateFromPacket(batchSpawn)
            expect(evBatch.length).toBe(1)
            expect(state.foods.size).toBe(3)
            expect(state.spatialGrid.size).toBe(3)

            // Food eaten
            const foodEaten: FoodEatenPacket = {
                type: "food_eaten",
                opcode: "c",
                timestamp: 150,
                id: 1001,
                x: 200,
                y: 300,
                eaterSnakeId: 99,
            }

            const evEaten = state.updateFromPacket(foodEaten)
            expect(evEaten.length).toBe(1)
            expect(state.foods.size).toBe(2)
            expect(state.spatialGrid.size).toBe(2)
            expect(state.foods.has(1001)).toBe(false)
            expect(state.spatialGrid.has(1001)).toBe(false)
        })
    })

    describe("Prey Entities", () => {
        it("tracks moving preys from packet events", () => {
            const state = new GameState()

            const preyAdd: PreyAddPacket = {
                type: "prey_add",
                opcode: "y",
                timestamp: 160,
                preyId: 77,
                color: 5,
                x: 1000,
                y: 1000,
                size: 2.5,
            }

            state.updateFromPacket(preyAdd)
            expect(state.preys.size).toBe(1)
            const prey = state.preys.get(77)!
            expect(prey.x).toBe(1000)

            const preyUpdate: PreyUpdatePacket = {
                type: "prey_update",
                opcode: "j",
                timestamp: 170,
                preyId: 77,
                x: 1010,
                y: 1020,
                angle: 1.2,
                speed: 12,
            }

            state.updateFromPacket(preyUpdate)
            expect(prey.x).toBe(1010)
            expect(prey.speed).toBe(12)

            const preyRemove: PreyRemovePacket = {
                type: "prey_remove",
                opcode: "y",
                timestamp: 180,
                preyId: 77,
            }

            state.updateFromPacket(preyRemove)
            expect(state.preys.size).toBe(0)
        })
    })

    describe("Leaderboard & Player Death", () => {
        it("updates leaderboard and flags self rank", () => {
            const state = new GameState()
            state.mySnakeId = 20

            const lbPacket: LeaderboardPacket = {
                type: "leaderboard",
                opcode: "l",
                timestamp: 190,
                localPlayerInTop10: true,
                localRank: 2,
                totalSnakes: 50,
                entries: [
                    { rank: 1, score: 5000, fam: 0, nickname: "King", snakeId: 10 } as any,
                    { rank: 2, score: 3200, fam: 0, nickname: "SelfSnake", snakeId: 20 } as any,
                ],
            }

            const events = state.updateFromPacket(lbPacket)
            expect(events.length).toBe(1)
            expect(state.leaderboard.length).toBe(2)
            expect(state.leaderboard[0].isSelf).toBe(false)
            expect(state.leaderboard[1].isSelf).toBe(true)
        })

        it("processes server death packet ('v')", () => {
            const state = new GameState()
            state.mySnakeId = 88
            const self = new Snake({ id: 88, head: { x: 50, y: 50 } })
            state.snakes.set(88, self)

            const deathPacket = {
                type: "death",
                opcode: "v",
                timestamp: 200,
                reason: DeathReason.NORMAL,
            } as any

            const events = state.updateFromPacket(deathPacket)
            expect(events.length).toBe(1)
            expect(events[0].type).toBe("death")
            expect(self.isDead).toBe(true)
            expect(state.mySnakeId).toBeNull()
            expect(state.isAlive).toBe(false)
        })
    })

    describe("Sector Management & State Reset", () => {
        it("tracks active arena sectors", () => {
            const state = new GameState()

            const secAdd: SectorAddPacket = {
                type: "sector_add",
                opcode: "W",
                timestamp: 210,
                sectorX: 12,
                sectorY: 15,
            }

            state.updateFromPacket(secAdd)
            expect(state.activeSectors.has("12:15")).toBe(true)

            const secRemove: SectorRemovePacket = {
                type: "sector_remove",
                opcode: "w",
                timestamp: 220,
                sectorX: 12,
                sectorY: 15,
            }

            state.updateFromPacket(secRemove)
            expect(state.activeSectors.has("12:15")).toBe(false)
        })

        it("clears all state cleanly via clear()", () => {
            const state = new GameState()
            state.mySnakeId = 1
            state.snakes.set(1, new Snake({ id: 1 }))
            state.foods.set(1, { id: 1, x: 0, y: 0, size: 1, color: 0 } as any)
            state.activeSectors.add("1:1")

            state.clear()
            expect(state.mySnakeId).toBeNull()
            expect(state.snakes.size).toBe(0)
            expect(state.foods.size).toBe(0)
            expect(state.spatialGrid.size).toBe(0)
            expect(state.activeSectors.size).toBe(0)
        })
    })
})
