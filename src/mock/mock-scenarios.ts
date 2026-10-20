/**
 * @file mock-scenarios.ts
 * @description Programmatic scenario helpers for testing Slither.io client navigation, combat, and feeding.
 */

import { MockSlitherServer } from "./mock-server.js"

export interface BasicScenarioOptions {
    center?: { x: number; y: number }
    botCount?: number
    foodClusterCount?: number
    foodPerCluster?: number
    clusterRadius?: number
}

export interface BasicScenarioResult {
    botIds: number[]
    foodCount: number
    foodIds: number[]
}

export interface CombatScenarioOptions {
    victim?: "player" | "bot"
    targetSnakeId?: number
    botName?: string
    distanceAhead?: number
    bodyLength?: number
    dropFoodOnDeath?: boolean
}

export interface CombatScenarioResult {
    botId: number
    victimId: number
    deadSnakeId: number
    deathFoodCount: number
    triggerDeath: () => void
}

export interface FeedingFrenzyOptions {
    center?: { x: number; y: number }
    preyCount?: number
    foodCount?: number
    radius?: number
    updateIntervalMs?: number
}

export interface FeedingFrenzyResult {
    preyIds: number[]
    foodIds: number[]
    stopFrenzy: () => void
}

/**
 * Populates the simulated game world with opponent bot snakes and dense food clusters.
 */
export function createBasicGameScenario(
    server: MockSlitherServer,
    options: BasicScenarioOptions = {},
): BasicScenarioResult {
    const center = options.center ?? {
        x: server.options.gameRadius / 2,
        y: server.options.gameRadius / 2,
    }
    const botCount = options.botCount ?? 3
    const clusterCount = options.foodClusterCount ?? 3
    const foodPerCluster = options.foodPerCluster ?? 15
    const clusterRadius = options.clusterRadius ?? 150

    const botIds: number[] = []
    const foodIds: number[] = []

    // 1. Spawn Bot Opponents
    const botNames = ["AlphaBot", "BetaBot", "GammaBot", "DeltaBot", "OmegaBot"]
    for (let i = 0; i < botCount; i++) {
        const angle = (i * 2 * Math.PI) / botCount
        const dist = 500 + i * 100
        const bx = center.x + Math.cos(angle) * dist
        const by = center.y + Math.sin(angle) * dist
        const botName = botNames[i % botNames.length]

        const bot = server.spawnBot({
            name: botName,
            skin: (i * 4 + 1) % 39,
            x: bx,
            y: by,
            angle: angle + Math.PI / 2,
            length: 10 + i * 2,
        })
        botIds.push(bot.id)
    }

    // 2. Spawn Food Clusters
    for (let c = 0; c < clusterCount; c++) {
        const clusterAngle = (c * 2 * Math.PI) / clusterCount
        const clusterDist = 300 + c * 50
        const cx = center.x + Math.cos(clusterAngle) * clusterDist
        const cy = center.y + Math.sin(clusterAngle) * clusterDist

        const clusterFoods: Array<{ x: number; y: number; size: number; color: number }> = []
        for (let f = 0; f < foodPerCluster; f++) {
            const rad = ((f + 1) / foodPerCluster) * clusterRadius
            const ang = f * 2.399963229728653 // Golden angle
            const fx = Math.round(cx + Math.cos(ang) * rad)
            const fy = Math.round(cy + Math.sin(ang) * rad)
            const size = 1 + (f % 4)
            const color = (c * 7 + f) % 30

            clusterFoods.push({ x: fx, y: fy, size, color })
        }

        const ids = server.spawnFoodBatch(clusterFoods)
        foodIds.push(...ids)
    }

    return {
        botIds,
        foodCount: foodIds.length,
        foodIds,
    }
}

/**
 * Establishes an obstacle and combat scenario between a bot and target snake, with triggerable death.
 */
export function simulateCombatScenario(
    server: MockSlitherServer,
    options: CombatScenarioOptions = {},
): CombatScenarioResult {
    const victim = options.victim ?? "player"
    const botName = options.botName ?? "AggressorBot"
    const distanceAhead = options.distanceAhead ?? 200
    const bodyLength = options.bodyLength ?? 12

    // Locate target snake or assume arena center
    let targetSnake = options.targetSnakeId ? server.getSnake(options.targetSnakeId) : undefined
    if (!targetSnake) {
        targetSnake = server.getPlayerSnake()
    }
    if (!targetSnake) {
        const all = server.getAllSnakes()
        if (all.length > 0) {
            targetSnake = all[0]
        }
    }

    const tx = targetSnake?.x ?? server.options.gameRadius / 2
    const ty = targetSnake?.y ?? server.options.gameRadius / 2
    const tang = targetSnake?.angle ?? 0
    const targetId = targetSnake?.id ?? 1

    // Position opponent bot perpendicular to target head path
    const bx = tx + Math.cos(tang) * distanceAhead
    const by = ty + Math.sin(tang) * distanceAhead
    const botHeading = tang + Math.PI / 2

    const bot = server.spawnBot({
        name: botName,
        skin: 5,
        x: bx,
        y: by,
        angle: botHeading,
        length: bodyLength,
    })

    const victimId = victim === "player" ? targetId : bot.id
    const deadSnakeId = victimId
    const deathFoodCount = bodyLength

    const triggerDeath = () => {
        server.simulateSnakeDeath(deadSnakeId, 0)
    }

    return {
        botId: bot.id,
        victimId,
        deadSnakeId,
        deathFoodCount,
        triggerDeath,
    }
}

/**
 * Spawns fleeing prey particles and dense food pellets, testing high-rate food gathering and tracking.
 */
export function simulateFeedingFrenzy(
    server: MockSlitherServer,
    options: FeedingFrenzyOptions = {},
): FeedingFrenzyResult {
    const center = options.center ?? {
        x: server.options.gameRadius / 2,
        y: server.options.gameRadius / 2,
    }
    const preyCount = options.preyCount ?? 4
    const foodCount = options.foodCount ?? 60
    const radius = options.radius ?? 400
    const updateIntervalMs = options.updateIntervalMs ?? 50

    const preyIds: number[] = []

    // 1. Spawn Preys
    for (let p = 0; p < preyCount; p++) {
        const angle = (p * 2 * Math.PI) / preyCount
        const dist = 100 + p * 40
        const px = Math.round(center.x + Math.cos(angle) * dist)
        const py = Math.round(center.y + Math.sin(angle) * dist)

        const id = server.spawnPrey({
            x: px,
            y: py,
            color: p % 20,
            size: 3,
            speed: 140,
            angle,
        })
        preyIds.push(id)
    }

    // 2. Spawn Dense Food Pellets
    const batchFoods: Array<{ x: number; y: number; size: number; color: number }> = []
    for (let f = 0; f < foodCount; f++) {
        const rad = Math.random() * radius
        const ang = Math.random() * 2 * Math.PI
        const fx = Math.round(center.x + Math.cos(ang) * rad)
        const fy = Math.round(center.y + Math.sin(ang) * rad)
        batchFoods.push({
            x: fx,
            y: fy,
            size: 1 + (f % 3),
            color: f % 25,
        })
    }

    const foodIds = server.spawnFoodBatch(batchFoods)

    // 3. Prey Animation Interval
    let frenzyTimer: NodeJS.Timeout | null = null
    if (updateIntervalMs > 0) {
        let elapsed = 0
        frenzyTimer = setInterval(() => {
            elapsed += updateIntervalMs / 1000
            for (let i = 0; i < preyIds.length; i++) {
                const id = preyIds[i]
                const angle = elapsed * 1.5 + (i * 2 * Math.PI) / preyIds.length
                const dist = 150 + Math.sin(elapsed * 2 + i) * 60
                const px = Math.round(center.x + Math.cos(angle) * dist)
                const py = Math.round(center.y + Math.sin(angle) * dist)
                server.updatePrey(id, px, py, angle + Math.PI / 2, 140)
            }
        }, updateIntervalMs)
        if (typeof frenzyTimer.unref === "function") {
            frenzyTimer.unref()
        }
    }

    const stopFrenzy = () => {
        if (frenzyTimer) {
            clearInterval(frenzyTimer)
            frenzyTimer = null
        }
        for (const id of preyIds) {
            server.removePrey(id)
        }
    }

    return {
        preyIds,
        foodIds,
        stopFrenzy,
    }
}
