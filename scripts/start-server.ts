/**
 * @file start-server.ts
 * @description Inicia o servidor WebSocket local para o Slither.io com bots e comidas simuladas.
 *
 * Como rodar:
 *   npx tsx scripts/start-server.ts [porta]
 */

import { MockSlitherServer } from "../src/index.js"

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080

async function main() {
    console.log("==================================================")
    console.log("       🐍 Slither.io Standalone Mock Server 🐍     ")
    console.log("==================================================\n")

    const server = new MockSlitherServer({
        tickIntervalMs: 50,
        autoTick: true,
        gameRadius: 16000,
        baseSpeed: 125,
        boostSpeed: 240,
    })

    const boundPort = await server.start(port)
    console.log(`✅ Servidor WebSocket ativo em: ws://127.0.0.1:${boundPort}`)
    console.log(`📡 Pronto para conexões de navegadores e bots!\n`)

    // Popula a arena com 800 comidas
    console.log("🍎 Gerando 800 partículas de comida na arena...")
    const foods = []
    const arenaRadius = 16000
    for (let i = 0; i < 800; i++) {
        // Distribute in circle
        const angle = Math.random() * Math.PI * 2
        const dist = Math.random() * (arenaRadius * 0.45)
        foods.push({
            x: arenaRadius / 2 + Math.cos(angle) * dist,
            y: arenaRadius / 2 + Math.sin(angle) * dist,
            size: 1 + Math.floor(Math.random() * 4),
            color: Math.floor(Math.random() * 25),
        })
    }
    server.spawnFoodBatch(foods)

    // Spawna bots rivais com nomes e skins
    const botNames = [
        { name: "Python_Rival", skin: 0, length: 14, x: 7500, y: 7800 },
        { name: "Cobra_Viper", skin: 2, length: 18, x: 8500, y: 8200 },
        { name: "Anaconda_Rex", skin: 3, length: 22, x: 8000, y: 7500 },
        { name: "Speedy_Worm", skin: 6, length: 12, x: 8300, y: 8600 },
        { name: "Neon_Dragon", skin: 1, length: 16, x: 7700, y: 8400 },
        { name: "Cosmic_Beast", skin: 4, length: 20, x: 8800, y: 7800 },
        { name: "Shadow_Stalker", skin: 7, length: 15, x: 7300, y: 8100 },
    ]

    console.log(`🤖 Spawnando ${botNames.length} bots rivais com IA...`)
    const simulatedBots: Array<{ id: number; snake: any; changeHeadingTimer: number }> = []

    for (const b of botNames) {
        const snake = server.spawnBot({
            name: b.name,
            skin: b.skin,
            x: b.x,
            y: b.y,
            length: b.length,
        })
        simulatedBots.push({
            id: snake.id,
            snake,
            changeHeadingTimer: 0,
        })
    }

    // AI loop para os bots do servidor (mudam de direção suavemente e buscam o centro)
    setInterval(() => {
        for (const b of simulatedBots) {
            b.changeHeadingTimer++
            if (b.changeHeadingTimer > 20 + Math.random() * 30) {
                b.changeHeadingTimer = 0
                // Curva aleatória ou atração para o centro
                const centerAngle = Math.atan2(
                    arenaRadius / 2 - b.snake.y,
                    arenaRadius / 2 - b.snake.x
                )
                const randomOffset = (Math.random() - 0.5) * 1.5
                b.snake.wantedAngle = centerAngle + randomOffset
            }
        }
    }, 100)

    // Spawna comidas continuamente para manter a arena dinâmica
    setInterval(() => {
        if (server.foods.size < 600) {
            const batch = []
            for (let i = 0; i < 30; i++) {
                const angle = Math.random() * Math.PI * 2
                const dist = Math.random() * (arenaRadius * 0.45)
                batch.push({
                    x: arenaRadius / 2 + Math.cos(angle) * dist,
                    y: arenaRadius / 2 + Math.sin(angle) * dist,
                    size: 1 + Math.floor(Math.random() * 3),
                    color: Math.floor(Math.random() * 10),
                })
            }
            server.spawnFoodBatch(batch)
        }
    }, 3000)

    console.log("🎮 Servidor pronto! Conecte um cliente em ws://127.0.0.1:8080.")
}

main().catch((err) => {
    console.error("Erro fatal ao iniciar servidor:", err)
    process.exit(1)
})
