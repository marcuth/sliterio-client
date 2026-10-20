/**
 * @file simulation-scenarios-stress.test.ts
 * @description Empirical stress-testing and adversarial verification of simulation kinematics,
 * discrete stepping, boost toggle, mass/food shedding, food collision, snake growth,
 * combat scenarios, and feeding frenzy.
 * Authored by Challenger M3-2.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ClientState, SlitherClient } from "../../src/client/slither-client.js"
import {
    createBasicGameScenario,
    simulateCombatScenario,
    simulateFeedingFrenzy,
} from "../../src/mock/mock-scenarios.js"
import { createInMemoryClient, MockSlitherServer } from "../../src/mock/mock-server.js"

describe("Simulation Engine & Scenarios Empirical Stress Suite (Challenger M3-2)", () => {
    let server: MockSlitherServer

    beforeEach(() => {
        server = new MockSlitherServer({ autoTick: false })
    })

    afterEach(async () => {
        await server.stop()
    })

    // =========================================================================
    // 1. KINEMATICS & DISCRETE STEPPING STRESS
    // =========================================================================
    describe("1. Kinematics & Discrete Stepping Stress", () => {
        it("advances snake smoothly through rapid succession of 100 step(50ms) calls with continuous steering changes", async () => {
            const socket = createInMemoryClient(server)
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            const snake = await client.spawn("KinematicsBot", 1)
            const serverSnake = server.getPlayerSnake()!
            expect(serverSnake).toBeDefined()

            const startX = serverSnake.x
            const startY = serverSnake.y

            // Execute 100 rapid discrete steps (5 seconds of simulated physics)
            // with sweeping wanted angle (full circular orbit 0 -> 2pi)
            for (let step = 0; step < 100; step++) {
                const targetAngle = ((step / 100) * Math.PI * 2) % (Math.PI * 2)
                client.turnTo(targetAngle)

                server.step(50)

                // Verify numerical sanity on every step
                expect(Number.isFinite(serverSnake.x)).toBe(true)
                expect(Number.isFinite(serverSnake.y)).toBe(true)
                expect(Number.isFinite(serverSnake.angle)).toBe(true)
                expect(serverSnake.angle).toBeGreaterThanOrEqual(0)
                expect(serverSnake.angle).toBeLessThanOrEqual(Math.PI * 2 + 1e-4)

                // Verify IK constraint spacing across all body segments (spacing ~15)
                for (let i = 1; i < serverSnake.body.length; i++) {
                    const dist = Math.hypot(
                        serverSnake.body[i - 1].x - serverSnake.body[i].x,
                        serverSnake.body[i - 1].y - serverSnake.body[i].y
                    )
                    expect(dist).toBeLessThanOrEqual(16.0)
                }
            }

            // After 100 steps, snake must have traveled significantly from spawn point
            const totalDisplacement = Math.hypot(serverSnake.x - startX, serverSnake.y - startY)
            expect(totalDisplacement).toBeGreaterThan(100)

            client.disconnect()
        })

        it("handles acute 180-degree hairpin turns without numerical instability or teleportation", async () => {
            const socket = createInMemoryClient(server)
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("HairpinBot", 2)
            const serverSnake = server.getPlayerSnake()!

            // Initial heading is 0 (moving along +X)
            expect(serverSnake.angle).toBe(0)

            // Step 10 times forward along +X
            for (let i = 0; i < 10; i++) {
                server.step(50)
            }
            const peakX = serverSnake.x

            // Turn 180 degrees (target angle = PI)
            client.turnTo(Math.PI)

            // Step 40 times to complete the turn and move along -X
            for (let i = 0; i < 40; i++) {
                const prevX = serverSnake.x
                const prevY = serverSnake.y

                server.step(50)

                // Speed is ~115.6 units/s, in 50ms max movement is ~5.8 units
                const stepDist = Math.hypot(serverSnake.x - prevX, serverSnake.y - prevY)
                expect(stepDist).toBeLessThanOrEqual(10.0) // No teleportation
            }

            // Head should have reversed direction and be moving back (X decreasing)
            expect(serverSnake.angle).toBeCloseTo(Math.PI, 1)

            client.disconnect()
        })

        it("maintains IK distance constraints under extreme dt values (dt=10ms, dt=200ms, dt=500ms)", async () => {
            const bot = server.spawnBot({ x: 5000, y: 5000, length: 15, angle: 0.5 })

            const dts = [10, 50, 100, 200, 500]
            for (const dt of dts) {
                bot.wantedAngle = (bot.wantedAngle + 1.2) % (Math.PI * 2)
                server.step(dt)

                // Every segment constraint must remain bounded
                for (let i = 1; i < bot.body.length; i++) {
                    const dist = Math.hypot(
                        bot.body[i - 1].x - bot.body[i].x,
                        bot.body[i - 1].y - bot.body[i].y
                    )
                    expect(dist).toBeLessThanOrEqual(16.0)
                }
            }
        })
    })

    // =========================================================================
    // 2. BOOST TOGGLE & FOOD SHEDDING STRESS
    // =========================================================================
    describe("2. Boost Toggle & Food Shedding Stress", () => {
        it("drops turbo food pellets at tail every 200ms during sustained boost", async () => {
            const socket = createInMemoryClient(server)
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("BoosterBot", 3)
            const serverSnake = server.getPlayerSnake()!
            const initialFoodsCount = server.getAllFoods().length

            // Activate boost
            client.setBoost(true)
            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(serverSnake.isBoosting).toBe(true)
            expect(serverSnake.speed).toBe(server.options.boostSpeed)

            // Step 4 times at 50ms = 200ms -> should drop exactly 1 food pellet
            server.step(50)
            server.step(50)
            server.step(50)
            server.step(50)

            expect(server.getAllFoods().length).toBe(initialFoodsCount + 1)
            const latestFood = server.getAllFoods()[server.getAllFoods().length - 1]
            expect(latestFood.isTurbo).toBe(true)

            // Verify dropped food location is close to current tail position
            const tail = serverSnake.body[serverSnake.body.length - 1]
            const distToTail = Math.hypot(latestFood.x - tail.x, latestFood.y - tail.y)
            expect(distToTail).toBeLessThanOrEqual(30) // Close to tail

            // Step another 800ms (16 steps of 50ms) -> 4 more pellets dropped
            for (let i = 0; i < 16; i++) {
                server.step(50)
            }
            expect(server.getAllFoods().length).toBe(initialFoodsCount + 5)

            // Stop boost and verify shedding stops
            client.setBoost(false)
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(serverSnake.isBoosting).toBe(false)
            expect(serverSnake.speed).toBe(server.options.baseSpeed)

            // Step another 400ms without boost -> zero additional foods
            for (let i = 0; i < 8; i++) {
                server.step(50)
            }
            expect(server.getAllFoods().length).toBe(initialFoodsCount + 5)

            client.disconnect()
        })

        it("reduces fullness and sheds tail segments when boosting continuously", async () => {
            const socket = createInMemoryClient(server)
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("ShrinkingBot", 1)
            const serverSnake = server.getPlayerSnake()!
            const initialLength = serverSnake.body.length
            expect(initialLength).toBe(10)

            client.setBoost(true)
            await new Promise((resolve) => setTimeout(resolve, 50))

            // Each food drop costs 25 fullness. At 0 fullness, 4 drops (-100) pop 1 segment
            // 4 drops = 800ms = 16 steps of 50ms
            for (let i = 0; i < 16; i++) {
                server.step(50)
            }

            expect(serverSnake.body.length).toBe(initialLength - 1)

            client.disconnect()
        })

        it("automatically cancels boost when snake shrinks to minimum length (<= 2 segments)", async () => {
            // Spawn a bot with only 3 segments
            const smallBot = server.spawnBot({ length: 3, angle: 0 })
            smallBot.isBoosting = true
            smallBot.speed = server.options.boostSpeed

            // Step until fullness drops below 0 and pops segment to reach length 2
            for (let i = 0; i < 20; i++) {
                server.step(50)
                if (!smallBot.isBoosting) break
            }

            // Once at length 2, boost must be automatically disengaged
            expect(smallBot.body.length).toBeLessThanOrEqual(2)
            expect(smallBot.isBoosting).toBe(false)
            expect(smallBot.speed).toBe(server.options.baseSpeed)
        })
    })

    // =========================================================================
    // 3. FOOD CONSUMPTION & GROWTH BROADCASTING STRESS
    // =========================================================================
    describe("3. Food Consumption & Snake Growth Broadcasting Stress", () => {
        it("detects food collision within head radius, consumes food, and broadcasts food_eaten", async () => {
            const socket = createInMemoryClient(server)
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("FeederBot", 0)
            const serverSnake = server.getPlayerSnake()!

            // Place food directly ahead of snake (heading 0 along +X)
            const targetFoodX = serverSnake.x + 20
            const targetFoodY = serverSnake.y
            const foodId = server.spawnFood(targetFoodX, targetFoodY, 1, 3)

            let eatenEvent: any = null
            client.on("food_eaten", (ev) => {
                eatenEvent = ev
            })

            // Step snake into food
            server.step(50)
            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(server.getFood(foodId)).toBeUndefined()
            expect(eatenEvent).toBeDefined()
            expect(eatenEvent.foodId).toBe(foodId)
            expect(eatenEvent.eaterSnakeId).toBe(serverSnake.id)

            client.disconnect()
        })

        it("accumulates mass from multiple foods, increases body length, and broadcasts growth", async () => {
            const socket = createInMemoryClient(server)
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("GluttonBot", 0)
            const serverSnake = server.getPlayerSnake()!
            const initialLength = serverSnake.body.length

            let growEventReceived = false
            client.on("snake_update", (ev) => {
                if (ev.type === "grow") {
                    growEventReceived = true
                }
            })

            // Spawn 4 food pellets of size 1 (each gives 25 fullness -> total 100 fullness)
            // placed right at snake head to be consumed immediately
            for (let i = 0; i < 4; i++) {
                server.spawnFood(serverSnake.x + i * 2, serverSnake.y, 1, i)
            }

            // Step to eat all 4 pellets
            server.step(50)
            await new Promise((resolve) => setTimeout(resolve, 50))

            // Body should have grown by at least 1 segment
            expect(serverSnake.body.length).toBe(initialLength + 1)
            expect(growEventReceived).toBe(true)

            // Client game state should reflect grown body length
            expect(client.gameState.self?.body.length).toBe(initialLength + 1)

            client.disconnect()
        })

        it("handles continuous feeding line of 20 pellets under discrete stepping", async () => {
            const socket = createInMemoryClient(server)
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("LineEaterBot", 0)
            const serverSnake = server.getPlayerSnake()!
            const initialLength = serverSnake.body.length

            // Place a line of 20 foods spaced 10 units apart along the +X direction
            for (let i = 1; i <= 20; i++) {
                server.spawnFood(serverSnake.x + i * 10, serverSnake.y, 2, i % 10)
            }

            let eatenCount = 0
            client.on("food_eaten", () => {
                eatenCount++
            })

            // Step 40 times (2 seconds), traveling ~230 units along X
            for (let i = 0; i < 40; i++) {
                server.step(50)
            }
            await new Promise((resolve) => setTimeout(resolve, 60))

            // Snake should have eaten all 20 pellets
            expect(eatenCount).toBe(20)
            expect(serverSnake.body.length).toBeGreaterThan(initialLength)

            client.disconnect()
        })
    })

    // =========================================================================
    // 4. SCENARIOS UNDER STRESS (COMBAT & FEEDING FRENZY)
    // =========================================================================
    describe("4. Scenarios Under Stress (Combat & Feeding Frenzy)", () => {
        it("scales createBasicGameScenario to 10 bots and 200 food pellets without degradation", async () => {
            const socket = createInMemoryClient(server)
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("ScenarioTester", 0)

            const scenario = createBasicGameScenario(server, {
                botCount: 10,
                foodClusterCount: 10,
                foodPerCluster: 20,
                clusterRadius: 200,
            })

            expect(scenario.botIds.length).toBe(10)
            expect(scenario.foodCount).toBe(200)
            expect(server.getAllSnakes().length).toBe(11) // 1 player + 10 bots
            expect(server.getAllFoods().length).toBeGreaterThanOrEqual(200)

            // Step simulation 20 times with all 11 snakes moving
            for (let i = 0; i < 20; i++) {
                server.step(50)
            }

            // All bots must still be alive and active
            for (const botId of scenario.botIds) {
                const bot = server.getSnake(botId)
                expect(bot).toBeDefined()
                expect(bot!.isDead).toBe(false)
            }

            client.disconnect()
        })

        it("executes simulateCombatScenario with victim 'player', dropping death food and transitioning state", async () => {
            const socket = createInMemoryClient(server)
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            const hero = await client.spawn("CombatVictim", 1)
            const initialFoodCount = server.getAllFoods().length

            const combat = simulateCombatScenario(server, {
                victim: "player",
                distanceAhead: 100,
                bodyLength: 10,
            })

            expect(combat.victimId).toBe(hero.id)

            let clientDied = false
            client.on("snake_died", (ev) => {
                if (ev.isSelf) {
                    clientDied = true
                }
            })

            combat.triggerDeath()
            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(clientDied).toBe(true)
            expect(client.state).toBe(ClientState.DEAD)
            expect(server.getSnake(hero.id)).toBeUndefined()

            // Snake body segments dropped as food
            expect(server.getAllFoods().length).toBeGreaterThan(initialFoodCount)

            client.disconnect()
        })

        it("executes simulateCombatScenario with victim 'bot', leaving player alive and removing bot", async () => {
            const socket = createInMemoryClient(server)
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("VictoriousPlayer", 2)

            const combat = simulateCombatScenario(server, {
                victim: "bot",
                distanceAhead: 120,
                bodyLength: 12,
            })

            let enemyDied = false
            client.on("snake_died", (ev) => {
                if (!ev.isSelf && ev.snakeId === combat.botId) {
                    enemyDied = true
                }
            })

            combat.triggerDeath()
            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(enemyDied).toBe(true)
            expect(client.state).toBe(ClientState.PLAYING)
            expect(server.getSnake(combat.botId)).toBeUndefined()

            client.disconnect()
        })

        it("executes simulateFeedingFrenzy with dynamic prey tracking and clean teardown", async () => {
            const socket = createInMemoryClient(server)
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("FrenzyHunter", 0)

            const frenzy = simulateFeedingFrenzy(server, {
                preyCount: 5,
                foodCount: 50,
                radius: 350,
                updateIntervalMs: 25,
            })

            expect(frenzy.preyIds.length).toBe(5)
            expect(frenzy.foodIds.length).toBe(50)

            // Step simulation 20 times while prey updates run
            for (let i = 0; i < 20; i++) {
                server.step(50)
            }
            await new Promise((resolve) => setTimeout(resolve, 100))

            // Teardown frenzy
            frenzy.stopFrenzy()
            await new Promise((resolve) => setTimeout(resolve, 50))

            // All preys should be removed from client and server
            for (const preyId of frenzy.preyIds) {
                expect(client.gameState.preys.has(preyId)).toBe(false)
                expect((server as any).preys?.get(preyId)).toBeUndefined()
            }

            client.disconnect()
        })

        it("stress-tests high-concurrency multi-client simulation (3 clients + 5 bots + 100 foods)", async () => {
            const clients: SlitherClient[] = []

            for (let i = 1; i <= 3; i++) {
                const ws = createInMemoryClient(server)
                const c = new SlitherClient({ socket: ws })
                await c.connect()
                await new Promise((resolve) => setTimeout(resolve, 30))
                await c.spawn(`MultiClient_${i}`, i)
                clients.push(c)
            }

            // Spawn 5 bots and 100 foods
            for (let i = 0; i < 5; i++) {
                server.spawnBot({
                    name: `ConcurrentBot_${i}`,
                    x: 10000 + i * 200,
                    y: 10000 + i * 200,
                    length: 8,
                })
            }
            const batchFoods: Array<{ x: number; y: number; size: number; color: number }> = []
            for (let f = 0; f < 100; f++) {
                batchFoods.push({
                    x: 10000 + (f % 10) * 50,
                    y: 10000 + Math.floor(f / 10) * 50,
                    size: 1 + (f % 3),
                    color: f % 20,
                })
            }
            server.spawnFoodBatch(batchFoods)

            // Concurrently step 30 ticks
            for (let step = 0; step < 30; step++) {
                // Client 0 turns left, client 1 boosts, client 2 turns right
                clients[0].turnTo(step * 0.1)
                clients[1].setBoost(step % 4 === 0)
                clients[2].turnTo(Math.PI - step * 0.1)

                server.step(50)
            }

            // Verify all clients are still in PLAYING state and healthy
            for (const c of clients) {
                expect(c.state).toBe(ClientState.PLAYING)
                expect(c.gameState.snakes.size).toBeGreaterThanOrEqual(3)
                c.disconnect()
            }
        })
    })
})
