import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { SlitherClient } from "../../src/client/slither-client.js"
import {
    createBasicGameScenario,
    simulateCombatScenario,
    simulateFeedingFrenzy,
} from "../../src/mock/mock-scenarios.js"
import { MockSlitherServer } from "../../src/mock/mock-server.js"

describe("Mock Scenarios Suite", () => {
    let server: MockSlitherServer

    beforeEach(() => {
        server = new MockSlitherServer({ autoTick: false })
    })

    afterEach(async () => {
        await server.stop()
    })

    describe("createBasicGameScenario", () => {
        it("populates simulated game world with opponent bots and food clusters", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("ScenarioHero", 0)

            const scenario = createBasicGameScenario(server, {
                botCount: 3,
                foodClusterCount: 3,
                foodPerCluster: 10,
                clusterRadius: 100,
            })

            expect(scenario.botIds.length).toBe(3)
            expect(scenario.foodCount).toBe(30)
            expect(scenario.foodIds.length).toBe(30)

            // Server state checks
            for (const botId of scenario.botIds) {
                expect(server.getSnake(botId)).toBeDefined()
            }
            expect(server.getAllFoods().length).toBeGreaterThanOrEqual(30)

            // Allow client events to flush
            await new Promise((resolve) => setTimeout(resolve, 50))

            // Client should see other snakes and foods
            expect(client.gameState.snakes.size).toBeGreaterThanOrEqual(3)
            expect(client.gameState.foods.size).toBeGreaterThanOrEqual(30)

            client.disconnect()
        })
    })

    describe("simulateCombatScenario", () => {
        it("sets up obstacle bot in front of player and triggers player death", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            const hero = await client.spawn("CombatHero", 0)

            const combat = simulateCombatScenario(server, {
                victim: "player",
                distanceAhead: 150,
                bodyLength: 8,
            })

            expect(combat.botId).toBeGreaterThan(0)
            expect(combat.victimId).toBe(hero.id)
            expect(combat.deadSnakeId).toBe(hero.id)
            expect(combat.deathFoodCount).toBe(8)

            let playerDiedReceived = false
            client.on("snake_died", (ev) => {
                if (ev.isSelf) {
                    playerDiedReceived = true
                }
            })

            // Trigger the fatal collision
            combat.triggerDeath()
            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(playerDiedReceived).toBe(true)
            expect(server.getSnake(hero.id)).toBeUndefined()

            client.disconnect()
        })

        it("triggers death of opponent bot when bot is designated as victim", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("HunterBot", 0)

            const combat = simulateCombatScenario(server, {
                victim: "bot",
                distanceAhead: 200,
                bodyLength: 10,
            })

            expect(combat.victimId).toBe(combat.botId)
            expect(combat.deadSnakeId).toBe(combat.botId)

            let botDeathReceived = false
            client.on("snake_died", (ev) => {
                if (!ev.isSelf && ev.snakeId === combat.botId) {
                    botDeathReceived = true
                }
            })

            combat.triggerDeath()
            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(botDeathReceived).toBe(true)
            expect(server.getSnake(combat.botId)).toBeUndefined()

            client.disconnect()
        })
    })

    describe("simulateFeedingFrenzy", () => {
        it("spawns glowing preys and dense food pellets, supporting cleanup with stopFrenzy", async () => {
            const socket = server.createClientSocket()
            const client = new SlitherClient({ socket })
            await client.connect()
            await new Promise((resolve) => setTimeout(resolve, 50))

            await client.spawn("FrenzyHero", 0)

            let preySpawnedCount = 0
            client.on("prey_spawn", () => {
                preySpawnedCount++
            })

            const frenzy = simulateFeedingFrenzy(server, {
                preyCount: 3,
                foodCount: 25,
                radius: 300,
                updateIntervalMs: 20,
            })

            expect(frenzy.preyIds.length).toBe(3)
            expect(frenzy.foodIds.length).toBe(25)

            await new Promise((resolve) => setTimeout(resolve, 60))
            expect(preySpawnedCount).toBe(3)

            // Cleanup frenzy
            frenzy.stopFrenzy()
            await new Promise((resolve) => setTimeout(resolve, 50))

            client.disconnect()
        })
    })
})
