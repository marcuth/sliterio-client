/**
 * @file feeder-bot.ts
 * @description Bot sacrificador (Feeder Bot) para Slither.io usando @marcuth/slitherio.
 * Conecta ao mesmo servidor onde você está jogando, localiza você e se choca contra seu corpo para doar toda a massa.
 *
 * Como rodar:
 *   npm run feeder -- [ws://url:porta/slither] [Nickname_Do_Jogador]
 *   ou com coordenadas:
 *   npm run feeder -- [ws://url:porta/slither] [PosicaoX] [PosicaoY]
 *
 * Exemplo em Produção:
 *   npm run feeder -- ws://45.158.39.98:475/slither "calma ai zona franca"
 */

import WebSocket from "ws"
import { ClientState, SlitherClient } from "../src/index.js"

// Argumentos passados via CLI
const rawServerArg = process.argv[2]
const targetArg1 = process.argv[3]
const targetArg2 = process.argv[4]

if (!rawServerArg) {
    console.log("==========================================================")
    console.log("       ⚡ Slither.io - Feeder Bot Sacrifical ⚡           ")
    console.log("==========================================================")
    console.log("❌ Você precisa informar o servidor ao qual está conectado!\n")
    console.log("💡 DICA RÁPIDA:")
    console.log("1. No jogo (http://slither.com/io), abra o painel '⚡ FEEDER RADAR'.")
    console.log("2. Clique no botão verde: '📋 Copiar Comando Feeder'.")
    console.log("3. Cole o comando copiado diretamente no seu terminal PowerShell!\n")
    console.log("Formato do comando:")
    console.log('   npm run feeder -- ws://<ip>:<porta>/slither "<SeuNick>"\n')
    console.log("Exemplo real:")
    console.log('   npm run feeder -- ws://45.158.39.98:475/slither "calma ai zona franca"\n')
    process.exit(1)
}

// Formata URL do WebSocket caso venha sem o prefixo ws:// ou sem /slither
let serverUrl = rawServerArg
if (!serverUrl.startsWith("ws://") && !serverUrl.startsWith("wss://")) {
    serverUrl = `ws://${serverUrl}`
}
if (!serverUrl.endsWith("/slither") && !serverUrl.includes(":8080")) {
    serverUrl = `${serverUrl}/slither`
}

if (serverUrl.includes("ntl")) {
    console.warn("⚠️ AVISO: A URL informada parece ser de um mod/telemetria (NTL) e não a arena do jogo.")
    console.warn("   A arena oficial do Slither.io usa o IP real do servidor (ex: ws://45.158.39.98:475/slither).")
    console.warn("   Copie novamente o comando no painel FEEDER RADAR atualizado no navegador.\n")
}

const isLocalMock = serverUrl.includes("127.0.0.1") || serverUrl.includes("localhost")
const isCoordinateTarget = !isNaN(Number(targetArg1)) && targetArg2 !== undefined && !isNaN(Number(targetArg2))
const targetCoords = isCoordinateTarget ? { x: Number(targetArg1), y: Number(targetArg2) } : null
const targetNickname = !isCoordinateTarget && targetArg1 ? targetArg1.trim() : null

async function startFeederBot() {
    console.log("==========================================================")
    console.log("       ⚡ Slither.io - Feeder Bot Sacrifical ⚡           ")
    console.log("==========================================================")
    console.log(`📡 Servidor de Destino: ${serverUrl}`)
    console.log(`🌐 Ambiente: ${isLocalMock ? "Mock Local" : "PRODUÇÃO OFICIAL"}`)
    if (targetNickname) {
        console.log(`🎯 Alvo do Sacrifício: Jogador "${targetNickname}"`)
    } else if (targetCoords) {
        console.log(`🎯 Alvo do Sacrifício: Coordenadas (${targetCoords.x}, ${targetCoords.y})`)
    } else {
        console.log(`🎯 Alvo do Sacrifício: Centro da Arena`)
    }
    console.log("----------------------------------------------------------\n")

    let feedCount = 0
    let isTerminating = false

    process.on("SIGINT", () => {
        isTerminating = true
        console.log("\n🛑 Encerrando Feeder Bot...")
        process.exit(0)
    })

    async function runBotCycle() {
        if (isTerminating) return

        const client = new SlitherClient({
            serverUrl,
            defaultNickname: "Feeder_FreeFood",
            defaultSkin: 6, // Rainbow skin (fácil de ver na tela)
            isProduction: !isLocalMock,
            webSocketFactory: (url) => {
                return new WebSocket(url, {
                    headers: {
                        Origin: "http://slither.io",
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
                        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
                    },
                }) as any
            },
        })

        client.on("connect", () => {
            console.log("🔌 Feeder conectado ao WebSocket! Realizando handshake de produção...")
        })

        client.on("snake_died", (e) => {
            if (e.isSelf) {
                feedCount++
                console.log(`💥 Feeder sacrificado com sucesso! (+Pontos doados! Total: ${feedCount})`)
                console.log("⏳ Respawnando próximo Feeder em 1.5s para continuar doando...\n")
                client.disconnect()
                setTimeout(runBotCycle, 1500)
            }
        })

        client.on("error", (err) => {
            console.error("⚠️ Erro de conexão do Feeder:", err.message)
        })

        try {
            await client.connect()

            // Aguarda spawn da cobra do bot na arena
            const spawnTimeout = Date.now() + 8000
            while (
                (client.state !== ClientState.PLAYING || !client.gameState.self) &&
                !isTerminating &&
                Date.now() < spawnTimeout
            ) {
                await new Promise((r) => setTimeout(r, 60))
            }

            const selfSnake = client.gameState.self
            if (!selfSnake) {
                console.warn("⚠️ Timeout aguardando spawn do Feeder. Tentando novamente...")
                client.disconnect()
                setTimeout(runBotCycle, 1500)
                return
            }

            console.log(
                `✨ Feeder spawnado na arena em (${selfSnake.head.x.toFixed(0)}, ${selfSnake.head.y.toFixed(0)})! Correndo em direção ao alvo...`,
            )

            // Loop de navegação e dead-reckoning em tempo real
            let lastStatusLog = 0
            let lastTickTime = Date.now()

            const navInterval = setInterval(() => {
                if (isTerminating) {
                    clearInterval(navInterval)
                    return
                }

                const self = client.gameState.self
                if (!self) return
                if (self.isDead) {
                    clearInterval(navInterval)
                    return
                }

                const now = Date.now()
                const deltaSec = Math.min(0.2, (now - lastTickTime) / 1000)
                lastTickTime = now

                // Simulação de movimento contínuo da cobra (dead-reckoning)
                const speedPerSec = client.isBoosting ? 820 : 340
                const moveDist = speedPerSec * deltaSec
                self.updateHead(
                    self.head.x + Math.cos(self.angle) * moveDist,
                    self.head.y + Math.sin(self.angle) * moveDist,
                )

                let currentTarget: { x: number; y: number } | null = null
                let foundPlayerInRadar = false

                // 1. Procurar jogador por nickname no radar do servidor
                if (targetNickname) {
                    for (const other of client.gameState.snakes.values()) {
                        if (
                            other.id !== self.id &&
                            other.name &&
                            other.name.toLowerCase().includes(targetNickname.toLowerCase())
                        ) {
                            foundPlayerInRadar = true
                            // Mira no meio do corpo da sua cobra (para garantir que a cabeça do bot colida no seu corpo e você pegue a massa)
                            if (other.body.length > 3) {
                                const targetSegment = other.body[Math.min(4, other.body.length - 1)]
                                currentTarget = targetSegment
                            } else {
                                currentTarget = other.head
                            }
                            break
                        }
                    }
                }

                // 2. Se o jogador ainda não apareceu no radar local, navega até as coordenadas
                if (!currentTarget && targetCoords) {
                    currentTarget = targetCoords
                }

                // 3. Fallback: centro do mapa
                if (!currentTarget) {
                    const radius = client.gameState.world.gameRadius || 21600
                    currentTarget = { x: radius, y: radius }
                }

                // Direciona o Feeder até o alvo
                const nav = client.moveTo(currentTarget)

                // Se localizou o jogador ou está a menos de 500u, ativa turbo para acelerar o impacto
                if ((foundPlayerInRadar || nav.distance < 500) && !client.isBoosting) {
                    client.boost()
                } else if (!foundPlayerInRadar && nav.distance >= 500 && client.isBoosting) {
                    client.stopBoost()
                }

                // Relatório de status a cada ~2 segundos
                if (now - lastStatusLog > 2000) {
                    lastStatusLog = now
                    const targetDesc = foundPlayerInRadar
                        ? `🚨 JOGADOR NO RADAR! Distância: ${nav.distance.toFixed(0)}u (CORRENDO PARA O IMPACTO)`
                        : `Rumo a (${currentTarget.x.toFixed(0)}, ${currentTarget.y.toFixed(0)}) | Dist: ${nav.distance.toFixed(0)}u`
                    console.log(`🧭 [Feeder] Pos: (${self.head.x.toFixed(0)}, ${self.head.y.toFixed(0)}) | ${targetDesc}`)
                }
            }, 60)
        } catch (err: any) {
            console.error("❌ Falha na partida do Feeder:", err.message)
            setTimeout(runBotCycle, 2500)
        }
    }

    runBotCycle()
}

startFeederBot().catch((err) => {
    console.error("Erro fatal:", err)
    process.exit(1)
})
