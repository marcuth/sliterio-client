/**
 * @file demo-bot.ts
 * @description Cliente de bot autônomo para Slither.io em produção usando a biblioteca @marcuth/slitherio.
 *
 * Como rodar em PRODUÇÃO (busca servidores oficiais ao vivo automaticamente):
 *   npm run example
 *   ou: npx tsx examples/demo-bot.ts
 *
 * Conectar em um IP / URL específico de produção:
 *   npx tsx examples/demo-bot.ts ws://94.72.180.82:444/slither
 *   ou: npx tsx examples/demo-bot.ts 94.72.180.82:444
 *
 * Rodar com o Mock Server local:
 *   npx tsx examples/demo-bot.ts --mock
 */

import WebSocket from "ws"
import { MockSlitherServer, SlitherClient } from "../src/index.js"

export interface ProductionServerInfo {
    ip: string
    port: number
    activePlayers: number
    serverId: number
    isActive: boolean
    clusterId: number
    url: string
}

/**
 * Consulta a lista oficial de clusters e servidores do Slither.io (i*.txt)
 * e decodifica os endereços IP e portas ativos em tempo real.
 */
async function fetchProductionServers(): Promise<ProductionServerInfo[]> {
    const listEndpoints = [
        "https://slither.io/i80124.txt",
        "https://slither.com/i80124.txt",
        "http://slither.io/i80124.txt",
    ]

    let rawText = ""
    for (const url of listEndpoints) {
        try {
            const res = await fetch(url, {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
                },
            })
            if (res.ok) {
                rawText = await res.text()
                if (rawText.length > 50) break
            }
        } catch {
            // Continua tentando os mirrors
        }
    }

    if (!rawText) {
        throw new Error("Não foi possível baixar a lista de servidores oficiais do Slither.io")
    }

    // Decodifica a representação compacta de servidores (algoritmo oficial do jogo)
    const servers: ProductionServerInfo[] = []
    let j = 1,
        cv = 0,
        cav = 0,
        m = 0,
        n = 0
    let ia: number[] = [],
        i6a: number[] = [],
        pa: number[] = [],
        aa: number[] = [],
        clu: number[] = [],
        sida: number[] = []
    let active = false

    while (j < rawText.length) {
        let v = (rawText.charCodeAt(j++) - 97 - cav) % 26
        if (v < 0) v += 26
        cv *= 16
        cv += v
        cav += 7
        if (n === 1) {
            if (m === 0) {
                active = cv <= 26
                m++
            } else if (m === 1) {
                ia.push(cv)
                if (ia.length === 4) m++
            } else if (m === 2) {
                i6a.push(cv)
                if (i6a.length === 16) m++
            } else if (m === 3) {
                pa.push(cv)
                if (pa.length === 2) m++
            } else if (m === 4) {
                aa.push(cv)
                if (aa.length === 2) m++
            } else if (m === 5) {
                clu.push(cv)
                if (clu.length === 1) m++
            } else if (m === 6) {
                sida.push(cv)
                if (sida.length === 2) {
                    let po = 0
                    for (let k = 0; k < pa.length; k++) po = po * 256 + pa[k]
                    let ac = 0
                    for (let k = 0; k < aa.length; k++) ac = ac * 256 + aa[k]
                    let sid = 0
                    for (let k = 0; k < sida.length; k++) sid = sid * 256 + sida[k]

                    if (ia.length === 4) {
                        const ip = ia.join(".")
                        servers.push({
                            ip,
                            port: po,
                            activePlayers: ac,
                            serverId: sid,
                            isActive: active,
                            clusterId: clu[0],
                            url: `ws://${ip}:${po}/slither`,
                        })
                    }
                    ia = []
                    i6a = []
                    pa = []
                    aa = []
                    clu = []
                    sida = []
                    m = 0
                }
            }
            cv = 0
            n = 0
        } else {
            n++
        }
    }

    return servers
}

async function main() {
    console.log("==================================================")
    console.log("       🐍 Slither.io Autonomous Bot Client 🐍      ")
    console.log("==================================================\n")

    const arg = process.argv[2]
    const isMock = arg === "--mock"
    let mockServer: MockSlitherServer | null = null
    let candidateUrls: { url: string; label: string }[] = []

    if (isMock) {
        console.log("🛠️ Modo Mock ativado (--mock). Subindo Mock Server local...")
        mockServer = new MockSlitherServer({
            tickIntervalMs: 50,
            autoTick: true,
            gameRadius: 10000,
            baseSpeed: 120,
        })
        const port = await mockServer.start(0)
        const mockUrl = `ws://127.0.0.1:${port}`
        console.log(`✅ Mock Server ativo em ${mockUrl}`)

        // Popula arena simulada
        console.log("🍎 Gerando comidas e bots rivais na arena...")
        const foods = []
        for (let i = 0; i < 300; i++) {
            foods.push({
                x: 4000 + Math.random() * 2000,
                y: 4000 + Math.random() * 2000,
                size: 1 + Math.floor(Math.random() * 3),
                color: Math.floor(Math.random() * 25),
            })
        }
        mockServer.spawnFoodBatch(foods)
        mockServer.spawnBot({ name: "Python_Rival", x: 5200, y: 5000, length: 12 })
        mockServer.spawnBot({ name: "Cobra_Viper", x: 4800, y: 5200, length: 15 })

        candidateUrls = [{ url: mockUrl, label: "Mock Local Server" }]
    } else if (arg && arg.startsWith("ws")) {
        candidateUrls = [{ url: arg, label: arg }]
    } else if (arg && arg.includes(":")) {
        candidateUrls = [{ url: `ws://${arg}/slither`, label: arg }]
    } else {
        console.log("🔍 Modo PRODUÇÃO: Descobrindo servidores oficiais do Slither.io...")
        try {
            const servers = await fetchProductionServers()
            console.log(`🌐 Total de servidores descobertos: ${servers.length}`)

            // Filtra servidores ativos com jogadores conectados
            const activeServers = servers.filter((s) => s.isActive && s.activePlayers > 10 && s.port > 0)
            const pool = activeServers.length > 0 ? activeServers : servers

            // Ordena pelo maior número de jogadores ativos
            pool.sort((a, b) => b.activePlayers - a.activePlayers)

            candidateUrls = pool.slice(0, 8).map((s) => ({
                url: s.url,
                label: `${s.ip}:${s.port} (ID: ${s.serverId}, Jogadores: ${s.activePlayers})`,
            }))
        } catch (err: any) {
            console.warn(`⚠️ Não foi possível obter servidores ao vivo: ${err.message}`)
            console.log("🔄 Usando servidores padrão de produção...")
            candidateUrls = [
                { url: "ws://94.72.180.82:444/slither", label: "94.72.180.82:444" },
                { url: "ws://57.128.202.110:444/slither", label: "57.128.202.110:444" },
            ]
        }
    }

    let connectedClient: SlitherClient | null = null
    let aiInterval: NodeJS.Timeout | null = null

    function cleanupAndExit(code = 0) {
        if (aiInterval) clearInterval(aiInterval)
        if (connectedClient) connectedClient.disconnect()
        if (mockServer) mockServer.stop()
        process.exit(code)
    }

    process.on("SIGINT", () => {
        console.log("\nEncerrando bot com segurança...")
        cleanupAndExit(0)
    })

    // Tenta conectar nos servidores candidatos até obter sucesso
    for (const candidate of candidateUrls) {
        console.log(`\n🎯 Tentando conectar ao servidor: ${candidate.label}`)
        console.log(`📡 Endpoint: ${candidate.url}`)

        const client = new SlitherClient({
            serverUrl: candidate.url,
            defaultNickname: "AlphaSlither",
            defaultSkin: 9,
            isProduction: !isMock,
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

        let connectionClosed = false
        client.on("connect", () => {
            console.log("🔌 Conectado ao WebSocket! Aguardando handshake...")
        })

        client.on("game_start", (world) => {
            console.log(`🌍 Arena carregada! Raio do mapa: ${world.gameRadius} unidades`)
        })

        client.on("spawn", (snake) => {
            console.log(`✨ Cobra spawnada com sucesso na arena!`)
            console.log(`   - ID: ${snake.id}`)
            console.log(`   - Nickname: ${snake.name}`)
            console.log(`   - Posição inicial: (${snake.head.x.toFixed(1)}, ${snake.head.y.toFixed(1)})`)
            console.log(`   - Comprimento inicial: ${snake.body.length} segmentos\n`)
            console.log("🤖 Iniciando loop de navegação autônoma...\n")
        })

        let foodsEaten = 0
        client.on("food_eaten", (event) => {
            if (client.gameState.self && event.eaterSnakeId === client.gameState.self.id) {
                foodsEaten++
                const currentScore = client.gameState.self.score
                console.log(`😋 Comida coletada! Total: ${foodsEaten} | Score: ${currentScore}`)
            }
        })

        client.on("snake_died", (event) => {
            if (event.isSelf) {
                console.log(`💀 A cobra morreu! Motivo: ${event.reason}`)
                cleanupAndExit(0)
            }
        })

        client.on("disconnect", (info) => {
            connectionClosed = true
            console.log(`🛑 Desconectado do servidor (código: ${info?.code}, limpo: ${info?.wasClean})`)
        })

        client.on("error", (err) => {
            console.error("❌ Erro do cliente:", err.message)
        })

        try {
            await client.connect()
        } catch (err: any) {
            console.warn(`⚠️ Falha ao abrir conexão: ${err.message}`)
            client.disconnect()
            continue
        }

        // Aguarda handshake e entrada no jogo
        const timeout = Date.now() + 6000
        while (client.state !== "READY" && client.state !== "PLAYING" && !connectionClosed && Date.now() < timeout) {
            await new Promise((r) => setTimeout(r, 50))
        }

        if (client.state === "READY") {
            console.log(`🤝 Handshake resolvido com sucesso! Estado: ${client.state}`)
            try {
                await client.spawn("@marcuth/slitherio", 9)
            } catch (err: any) {
                console.warn(`Aviso no spawn: ${err.message}`)
            }
        }

        if (client.state === "PLAYING" || (client.state === "READY" && client.gameState.self)) {
            connectedClient = client

            // Loop Autônomo de IA da biblioteca a cada 100ms
            let tickCount = 0
            let lastAvoidLog = 0
            let lastHeading: number | undefined
            aiInterval = setInterval(() => {
                const self = client.gameState.self
                if (!self || self.isDead) return

                tickCount++

                // Procura a comida mais próxima em um raio de até 2000 unidades usando queries espaciais do SDK
                const nearestFood = client.queries.findNearestFood(self.head, {
                    maxDistance: 2000,
                    preferEjected: true,
                })

                // Rumo desejado: em direção à comida, ou seguindo reto quando não há comida por perto
                const desiredAngle = nearestFood
                    ? Math.atan2(nearestFood.y - self.head.y, nearestFood.x - self.head.x)
                    : self.angle

                // Desvia de corpos e cabeças de outras cobras e da borda da arena
                const heading = client.queries.findSafeHeading(self.head, desiredAngle, {
                    selfSnakeId: self.id,
                    currentAngle: self.angle,
                    lookahead: 520,
                    previousAngle: lastHeading,
                })
                lastHeading = heading.avoiding ? heading.angle : undefined
                client.turnTo(heading.angle)

                if (heading.avoiding && Date.now() - lastAvoidLog > 2000) {
                    lastAvoidLog = Date.now()
                    console.log(
                        heading.trapped ? "⚠️  Cercado! Escolhendo a rota menos ruim" : "↪️  Desviando de um obstáculo",
                    )
                }

                // Relatório de status a cada ~2 segundos (20 ticks)
                if (tickCount % 20 === 0) {
                    console.log(
                        `📊 [Status] Pos: (${self.head.x.toFixed(0)}, ${self.head.y.toFixed(0)}) | ` +
                            `Ângulo: ${(self.angle * (180 / Math.PI)).toFixed(1)}° | ` +
                            `Score: ${self.score} | ` +
                            `Comidas no radar: ${client.gameState.foods.size}`,
                    )
                }
            }, 100)

            return // Permanece jogando
        }

        // Se falhou nesse servidor, desconecta e tenta o próximo candidato
        client.disconnect()
    }

    console.error("❌ Não foi possível iniciar a partida em nenhum dos servidores candidatos.")
    cleanupAndExit(1)
}

main().catch((err) => {
    console.error("Erro fatal:", err)
    process.exit(1)
})
