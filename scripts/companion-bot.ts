/**
 * @file companion-bot.ts
 * @description Bot Acompanhante / Escolta inteligente para Slither.io usando @marcuth/slitherio.
 * Segue o jogador em tempo real pelo mapa, desviando ativamente de todas as cobras inimigas e das bordas da arena.
 *
 * Como rodar:
 *   npx tsx scripts/companion-bot.ts [ws://url:porta] [NomeDoJogadorOuX] [Y_se_for_coord]
 *
 * Exemplos:
 *   npx tsx scripts/companion-bot.ts ws://127.0.0.1:8080 SlitherHero
 *   npx tsx scripts/companion-bot.ts ws://127.0.0.1:8080 8000 8000
 */

import { distance, normalizeAngle, SlitherClient } from "../src/index.js"

const serverUrl = process.argv[2] || "ws://127.0.0.1:8080"
const targetArg1 = process.argv[3] || "SlitherHero"
const targetArg2 = process.argv[4]

const isCoordinateTarget = !isNaN(Number(targetArg1)) && targetArg2 !== undefined && !isNaN(Number(targetArg2))
let targetCoords = isCoordinateTarget ? { x: Number(targetArg1), y: Number(targetArg2) } : null
const targetNickname = isCoordinateTarget ? null : targetArg1

async function startCompanionBot() {
    console.log("==========================================================")
    console.log("   🛡️ Slither.io - Companion Bot (Seguidor & Escolta) 🛡️   ")
    console.log("==========================================================")
    console.log(`📡 Servidor de Conexão: ${serverUrl}`)
    if (targetNickname) {
        console.log(`🎯 Jogador a Seguir: "${targetNickname}"`)
    } else if (targetCoords) {
        console.log(`🎯 Ponto de Encontro: (${targetCoords.x}, ${targetCoords.y})`)
    }
    console.log("✨ Recursos ativos: Desvio de obstáculos com Campos de Potencial e Turbo inteligente.\n")

    let activeCycle = true

    async function runBot() {
        const client = new SlitherClient({
            serverUrl,
            defaultNickname: "Companion_Guard",
            defaultSkin: 1, // Cyber Neon skin
        })

        client.on("connect", () => {
            console.log("🔌 Companion conectado ao servidor! Realizando handshake...")
        })

        client.on("snake_died", (e) => {
            if (e.isSelf) {
                console.log(`💀 Companion morreu em combate! Respawnando em 2 segundos...`)
                client.disconnect()
                if (activeCycle) {
                    setTimeout(runBot, 2000)
                }
            }
        })

        client.on("error", (err) => {
            console.warn("Aviso do Companion:", err.message)
        })

        try {
            await client.connect()
            while (client.state !== "READY" && client.state !== "PLAYING") {
                await new Promise((r) => setTimeout(r, 50))
            }

            const botSnake = await client.spawn("Companion_Guard", 1)
            console.log(`✨ Companion spawnado em (${botSnake.head.x.toFixed(0)}, ${botSnake.head.y.toFixed(0)})!`)
            console.log("🤖 Iniciando navegação com desvio de obstáculos...\n")

            // Loop de navegação autônoma em tempo real (20 Hz = 50ms)
            let tickCount = 0
            const navInterval = setInterval(() => {
                const self = client.gameState.self
                if (!self || self.isDead) {
                    clearInterval(navInterval)
                    return
                }

                tickCount++

                // 1. Localiza a posição do jogador alvo em tempo real
                let playerTarget: { x: number; y: number } | null = null
                let playerSnakeId: number | null = null

                if (targetNickname) {
                    for (const other of client.gameState.snakes.values()) {
                        if (other.id !== self.id && other.name.toLowerCase() === targetNickname.toLowerCase()) {
                            playerSnakeId = other.id
                            // Segue logo atrás da cauda ou da cabeça a uma distância confortável
                            playerTarget = other.head
                            break
                        }
                    }
                }

                // Se o jogador não estiver no campo de visão local, segue para o último ponto conhecido
                if (!playerTarget && targetCoords) {
                    playerTarget = targetCoords
                }

                // Fallback para o centro da arena
                if (!playerTarget) {
                    const radius = client.gameState.world.gameRadius || 16000
                    playerTarget = { x: radius / 2, y: radius / 2 }
                }

                // 2. Calcula vetor de atração até o jogador
                const distToPlayer = distance(self.head, playerTarget)
                const angleToPlayer = Math.atan2(playerTarget.y - self.head.y, playerTarget.x - self.head.x)

                // Força de atração base
                let forceX = Math.cos(angleToPlayer) * 1.5
                let forceY = Math.sin(angleToPlayer) * 1.5

                // 3. Algoritmo de Desvio de Obstáculos (Campos de Potencial Repulsivo)
                const lookaheadRadius = 380
                let obstacleCount = 0
                let closestObstacleDist = 99999

                // A) Desviar das outras cobras inimigas
                for (const snake of client.gameState.snakes.values()) {
                    if (snake.isDead || snake.id === self.id || snake.id === playerSnakeId) continue

                    // A.1: Repulsão da cabeça inimiga (perigo iminente de colisão frontal)
                    const headDist = distance(self.head, snake.head)
                    if (headDist < lookaheadRadius) {
                        obstacleCount++
                        if (headDist < closestObstacleDist) closestObstacleDist = headDist

                        const repAngle = Math.atan2(self.head.y - snake.head.y, self.head.x - snake.head.x)
                        // Repulsão quadrática forte
                        const factor = Math.max(0, 1 - headDist / lookaheadRadius)
                        const repWeight = factor * factor * 5.0 + 35 / Math.max(10, headDist)
                        forceX += Math.cos(repAngle) * repWeight
                        forceY += Math.sin(repAngle) * repWeight
                    }

                    // A.2: Repulsão dos segmentos corporais da cobra inimiga
                    const bodyStep = Math.max(1, Math.floor(snake.body.length / 10))
                    for (let i = 0; i < snake.body.length; i += bodyStep) {
                        const seg = snake.body[i]
                        const segDist = distance(self.head, seg)
                        if (segDist < lookaheadRadius * 0.8) {
                            obstacleCount++
                            if (segDist < closestObstacleDist) closestObstacleDist = segDist

                            const repAngle = Math.atan2(self.head.y - seg.y, self.head.x - seg.x)
                            const factor = Math.max(0, 1 - segDist / (lookaheadRadius * 0.8))
                            const repWeight = factor * factor * 4.0 + 25 / Math.max(10, segDist)
                            forceX += Math.cos(repAngle) * repWeight
                            forceY += Math.sin(repAngle) * repWeight
                        }
                    }
                }

                // B) Desviar da borda circular da arena
                const arenaRadius = client.gameState.world.gameRadius || 16000
                const center = { x: arenaRadius / 2, y: arenaRadius / 2 }
                const distFromCenter = distance(self.head, center)
                const distToWall = (arenaRadius / 2) - distFromCenter
                if (distToWall < 400) {
                    obstacleCount++
                    const angleToCenter = Math.atan2(center.y - self.head.y, center.x - self.head.x)
                    const wallFactor = Math.max(0, 1 - distToWall / 400)
                    const wallRepulsion = wallFactor * wallFactor * 8.0
                    forceX += Math.cos(angleToCenter) * wallRepulsion
                    forceY += Math.sin(angleToCenter) * wallRepulsion
                }

                // 4. Calcula o ângulo resultante seguro
                const safeAngle = normalizeAngle(Math.atan2(forceY, forceX))
                client.turnTo(safeAngle)

                // 5. Controle Inteligente de Turbo Boost
                // - Se estiver longe do jogador (> 450 unidades) e não tiver obstáculo imediato colado: turbo para alcançar!
                // - Se estiver perto (150 a 450 unidades): velocidade normal de escolta.
                // - Se tiver obstáculo perigoso (< 120 unidades): velocidade normal para manter manobrabilidade máxima.
                if (distToPlayer > 450 && closestObstacleDist > 160 && !client.isBoosting) {
                    client.boost()
                } else if ((distToPlayer <= 450 || closestObstacleDist <= 160) && client.isBoosting) {
                    client.stopBoost()
                }

                // Log de telemetria a cada 2 segundos
                if (tickCount % 40 === 0) {
                    const statusText = playerSnakeId !== null ? `Seguindo "${targetNickname}"` : "Procurando jogador no radar..."
                    console.log(
                        `🛡️ [Companion] Distância: ${distToPlayer.toFixed(0)}u | ` +
                        `Obstáculos evitados: ${obstacleCount} | ` +
                        `Turbo: ${client.isBoosting ? "ON" : "OFF"} | ${statusText}`
                    )
                }
            }, 50)
        } catch (err: any) {
            console.error("Falha ao rodar companion:", err.message)
            if (activeCycle) {
                setTimeout(runBot, 3000)
            }
        }
    }

    runBot()

    process.on("SIGINT", () => {
        console.log("\nEncerrando Companion Bot...")
        activeCycle = false
        process.exit(0)
    })
}

startCompanionBot().catch((err) => {
    console.error("Erro fatal:", err)
    process.exit(1)
})
