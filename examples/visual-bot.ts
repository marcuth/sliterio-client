/**
 * @file visual-bot.ts
 * @description Bot autônomo visual que entra no site oficial do Slither.io (slither.com/io)
 * via Puppeteer com navegador visível, exibindo a interface oficial do jogo e controlando
 * a cobra com inteligência artificial avançada da biblioteca @marcuth/slitherio.
 *
 * Como rodar:
 *   npm run visual
 *   ou: npx tsx examples/visual-bot.ts
 *
 * Definir apelido personalizado:
 *   npm run visual -- "MeuBot"
 */

import fs from "node:fs"
import path from "node:path"
import puppeteer, { Browser } from "puppeteer"

/**
 * Localiza o executável do navegador do sistema (Google Chrome ou Microsoft Edge)
 * para garantir máxima performance, aceleração gráfica por hardware e evitar bloqueios.
 */
function findSystemBrowser(): string | undefined {
    const candidates = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ]

    for (const p of candidates) {
        if (p && fs.existsSync(p)) {
            return p
        }
    }
    return undefined
}

async function main() {
    console.log("==================================================")
    console.log("    🐍 Slither.io Official Website Visual Bot 🐍   ")
    console.log("             Powered by @marcuth/slitherio        ")
    console.log("==================================================\n")

    const nickname = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : "AlphaSlither"

    const executablePath = findSystemBrowser()
    console.log(`🌐 Navegador detectado: ${executablePath ? executablePath : "Chromium nativo do Puppeteer"}`)
    console.log(`🏷️  Apelido do Bot: "${nickname}"`)
    console.log(`🚀 Abrindo o site oficial do Slither.io (http://slither.com/io)...\n`)

    const launchOptions: any = {
        headless: false,
        defaultViewport: null,
        args: [
            "--start-maximized",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
        ],
        ignoreDefaultArgs: ["--enable-automation"],
    }

    if (executablePath) {
        launchOptions.executablePath = executablePath
    }

    let browser: Browser
    try {
        browser = await puppeteer.launch(launchOptions)
    } catch (err: any) {
        console.warn(`⚠️ Não foi possível abrir com o executável personalizado (${err.message}). Tentando padrão...`)
        delete launchOptions.executablePath
        browser = await puppeteer.launch(launchOptions)
    }

    const pages = await browser.pages()
    const page = pages.length > 0 ? pages[0] : await browser.newPage()

    // Encerramento limpo ao fechar o navegador ou interromper o processo
    let isTerminating = false
    const cleanup = async () => {
        if (isTerminating) return
        isTerminating = true
        console.log("\n🛑 Encerrando sessão do visualizador...")
        try {
            await browser.close()
        } catch {}
        process.exit(0)
    }

    browser.on("disconnected", () => {
        if (!isTerminating) {
            console.log("\n👋 Janela do navegador fechada pelo usuário. Encerrando bot.")
            process.exit(0)
        }
    })

    process.on("SIGINT", cleanup)
    process.on("SIGTERM", cleanup)

    // Navega até a página oficial do Slither.io
    console.log("⏳ Carregando página oficial...")
    await page.goto("http://slither.com/io", { waitUntil: "domcontentloaded", timeout: 30000 })

    // Aguarda o campo de nickname estar pronto
    console.log("⌨️  Preenchendo nickname e entrando na partida...")
    await page.waitForSelector("#nick", { timeout: 15000 })
    await page.focus("#nick")
    await page.type("#nick", nickname, { delay: 40 })
    await new Promise((r) => setTimeout(r, 600))

    // Dispara o início da partida
    await page.evaluate(() => {
        const w = window as any
        if (w.play_btn?.elem?.onclick) {
            w.play_btn.elem.onclick()
        } else if (w.play_btn?.elem?.click) {
            w.play_btn.elem.click()
        }
    })

    console.log("🎮 Aguardando spawn da cobra na arena oficial...")
    await page.waitForFunction(() => (window as any).playing && (window as any).slither, { timeout: 20000 })
    console.log("✨ Cobra spawnada com sucesso no jogo oficial!")
    console.log("🤖 Injetando HUD interativo e controlador de navegação autônoma...\n")

    // Define polyfill do esbuild no navegador
    await page.evaluate("window.__name = (fn, name) => fn;")

    // Injeta HUD de vidro e Loop de Navegação Autônoma
    await page.evaluate(() => {
        const w = window as any

        // Remove HUD anterior se existir
        const prevHud = document.getElementById("slither-ai-hud")
        if (prevHud) prevHud.remove()

        // Cria o HUD de overlay translúcido
        const hud = document.createElement("div")
        hud.id = "slither-ai-hud"
        hud.innerHTML = `
            <div style="
                position: fixed; top: 18px; left: 18px; z-index: 9999999;
                background: rgba(11, 15, 25, 0.88); backdrop-filter: blur(14px);
                border: 1px solid rgba(52, 211, 153, 0.35); border-radius: 16px;
                padding: 16px 20px; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                box-shadow: 0 12px 36px rgba(0,0,0,0.65); min-width: 270px;
                user-select: none; pointer-events: none;
            ">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                    <div style="font-weight: 800; font-size: 15px; color: #34d399; display: flex; align-items: center; gap: 6px;">
                        🐍 @marcuth/slitherio
                    </div>
                    <span id="ai-badge" style="
                        font-size: 11px; font-weight: 800; padding: 3px 9px; border-radius: 20px;
                        background: rgba(52, 211, 153, 0.18); color: #34d399; border: 1px solid #34d399;
                        letter-spacing: 0.5px;
                    ">IA ATIVA</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 13px; color: #9ca3af; margin-top: 5px;">
                    <span>Pontuação:</span><b id="hud-score" style="color: #f3f4f6; font-family: monospace; font-size: 14px;">0</b>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 13px; color: #9ca3af; margin-top: 5px;">
                    <span>Comidas no Radar:</span><b id="hud-foods" style="color: #f3f4f6; font-family: monospace; font-size: 14px;">0</b>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 13px; color: #9ca3af; margin-top: 5px;">
                    <span>Radar de Ameaça:</span><b id="hud-threat" style="color: #34d399; font-family: monospace; font-size: 14px;">LIVRE</b>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 13px; color: #9ca3af; margin-top: 5px;">
                    <span>Turbo Inteligente:</span><b id="hud-boost" style="color: #9ca3af; font-family: monospace; font-size: 14px;">OFF</b>
                </div>
                <div style="margin-top: 12px; padding-top: 9px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 11px; color: #9ca3af; display: flex; justify-content: space-between; align-items: center;">
                    <span>Alternar Controle:</span>
                    <span style="color: #f3f4f6;"><kbd style="background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.2); padding: 1px 6px; border-radius: 4px; color: #34d399; font-weight: bold;">B</kbd> IA / Manual</span>
                </div>
            </div>
        `
        document.body.appendChild(hud)

        let isAiActive = true
        window.addEventListener("keydown", (e) => {
            if (e.code === "KeyB") {
                isAiActive = !isAiActive
                const badge = document.getElementById("ai-badge")
                if (badge) {
                    badge.textContent = isAiActive ? "IA ATIVA" : "MANUAL"
                    badge.style.color = isAiActive ? "#34d399" : "#f59e0b"
                    badge.style.borderColor = isAiActive ? "#34d399" : "#f59e0b"
                    badge.style.background = isAiActive ? "rgba(52, 211, 153, 0.18)" : "rgba(245, 158, 11, 0.18)"
                }
            }
        })

        // Loop de Navegação Autônoma em 60 FPS
        function botLoop() {
            requestAnimationFrame(botLoop)

            const self = w.slither
            if (!w.playing || !self || self.dead) {
                // Auto-respawn quando morrer
                if (!w.playing && w.play_btn?.elem && w.dead_mtm > 0 && Date.now() - w.dead_mtm > 1200) {
                    w.play_btn.elem.onclick()
                }
                return
            }

            // Atualiza elementos do HUD
            const scoreEl = document.getElementById("hud-score")
            const foodsEl = document.getElementById("hud-foods")
            const threatEl = document.getElementById("hud-threat")
            const boostEl = document.getElementById("hud-boost")

            const score = Math.floor(15 * (w.fpsls ? w.fpsls[self.sct] : self.sct) + self.fam * 10) || self.sct || 0
            if (scoreEl) scoreEl.textContent = String(score)
            if (foodsEl) foodsEl.textContent = String(w.foods ? w.foods.length : 0)

            // Se o modo manual estiver ativo, deixa o mouse do usuário controlar
            if (!isAiActive) return

            const hx = self.xx
            const hy = self.yy
            const arenaRadius = w.grd || 21600
            const centerDist = Math.hypot(hx - arenaRadius, hy - arenaRadius)

            // 1. Escaneamento de Obstáculos (cabeças inimigas, corpos e borda do mapa)
            const scanRadius = 450
            const obstacles: Array<{ x: number; y: number; dist: number; isHead: boolean }> = []

            // Evitar borda da arena
            const distToBorder = arenaRadius - centerDist
            if (distToBorder < 550) {
                const borderAngle = Math.atan2(hy - arenaRadius, hx - arenaRadius)
                obstacles.push({
                    x: hx + Math.cos(borderAngle) * distToBorder,
                    y: hy + Math.sin(borderAngle) * distToBorder,
                    dist: distToBorder,
                    isHead: false,
                })
            }

            // Evitar cobras inimigas
            if (w.slithers) {
                for (const other of w.slithers) {
                    if (!other || other.id === self.id || other.dead) continue

                    // Cabeça inimiga (perigo crítico)
                    const headDist = Math.hypot(other.xx - hx, other.yy - hy)
                    if (headDist < scanRadius) {
                        obstacles.push({ x: other.xx, y: other.yy, dist: headDist, isHead: true })
                    }

                    // Segmentos de corpo
                    if (other.pts) {
                        for (let p = 0; p < other.pts.length; p += 2) {
                            const pt = other.pts[p]
                            if (!pt) continue
                            const d = Math.hypot(pt.xx - hx, pt.yy - hy)
                            if (d < scanRadius) {
                                obstacles.push({ x: pt.xx, y: pt.yy, dist: d, isHead: false })
                            }
                        }
                    }
                }
            }

            // 2. Seleção de Comida e Clusters
            let targetX = arenaRadius
            let targetY = arenaRadius
            let bestFoodScore = -Infinity

            if (w.foods && w.foods.length > 0) {
                for (const f of w.foods) {
                    if (!f) continue
                    const d = Math.hypot(f.xx - hx, f.yy - hy)
                    if (d > 2400) continue

                    const foodVal = (f.sz || 1) * 3 + (f.rad || 1)
                    const foodScore = foodVal * 1200 - d
                    if (foodScore > bestFoodScore) {
                        bestFoodScore = foodScore
                        targetX = f.xx
                        targetY = f.yy
                    }
                }
            }

            // 3. Campo Potencial de Repulsão e Atração
            let desiredAngle = Math.atan2(targetY - hy, targetX - hx)

            if (obstacles.length > 0) {
                if (threatEl) {
                    threatEl.textContent = `PERIGO (${obstacles.length})`
                    threatEl.style.color = "#ef4444"
                }

                let fx = Math.cos(desiredAngle)
                let fy = Math.sin(desiredAngle)

                for (const obs of obstacles) {
                    const d = Math.max(1, obs.dist)
                    const repulsionWeight = obs.isHead ? 6.5 : 4.0
                    const factor = (scanRadius - d) / scanRadius
                    const repulsion = factor * factor * repulsionWeight + 40 / d
                    const obsAng = Math.atan2(obs.y - hy, obs.x - hx)
                    fx -= Math.cos(obsAng) * repulsion
                    fy -= Math.sin(obsAng) * repulsion
                }

                desiredAngle = Math.atan2(fy, fx)
            } else {
                if (threatEl) {
                    threatEl.textContent = "LIVRE"
                    threatEl.style.color = "#34d399"
                }
            }

            // Aplica direção aos controles da página oficial
            w.xm = Math.cos(desiredAngle) * 320
            w.ym = Math.sin(desiredAngle) * 320

            // 4. Turbo Inteligente (fuga de emergência ou captura rápida de alimento denso)
            const escapeHeadDanger = obstacles.some((o) => o.isHead && o.dist < 220)
            const rushBigFood = bestFoodScore > 2600 && Math.hypot(targetX - hx, targetY - hy) < 220 && self.sct > 25
            const shouldBoost = escapeHeadDanger || rushBigFood

            if (shouldBoost) {
                w.setAcceleration(1)
                if (boostEl) {
                    boostEl.textContent = "ON"
                    boostEl.style.color = "#34d399"
                }
            } else {
                w.setAcceleration(0)
                if (boostEl) {
                    boostEl.textContent = "OFF"
                    boostEl.style.color = "#9ca3af"
                }
            }
        }

        botLoop()
    })

    console.log("🟢 O bot está jogando ao vivo no site oficial do Slither.io!")
    console.log("💡 Dica: Você pode assistir no navegador ou pressionar 'B' no jogo para alternar entre IA e controle manual.")
    console.log("   (Pressione Ctrl+C neste terminal para encerrar quando desejar)\n")

    // Loop de monitoramento no terminal
    let tickCount = 0
    while (!isTerminating) {
        await new Promise((r) => setTimeout(r, 2000))
        tickCount++

        try {
            const status = await page.evaluate(() => {
                const w = window as any
                const self = w.slither
                if (!w.playing || !self) {
                    return { playing: false }
                }
                const score =
                    Math.floor(15 * (w.fpsls ? w.fpsls[self.sct] : self.sct) + self.fam * 10) || self.sct || 0
                return {
                    playing: true,
                    score,
                    x: Math.round(self.xx),
                    y: Math.round(self.yy),
                    foodsCount: w.foods ? w.foods.length : 0,
                    snakesCount: w.slithers ? w.slithers.length : 0,
                }
            })

            if (status.playing) {
                console.log(
                    `📊 [Status Oficial] Score: ${status.score} | Pos: (${status.x}, ${status.y}) | ` +
                        `Comidas: ${status.foodsCount} | Cobras próximas: ${status.snakesCount}`,
                )
            } else {
                console.log(`⏳ [Status] Renascendo ou aguardando conexão...`)
            }
        } catch {
            // Se o navegador for fechado, o loop encerra
            break
        }
    }
}

main().catch((err) => {
    console.error("Erro fatal:", err)
    process.exit(1)
})
