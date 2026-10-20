import puppeteer from "puppeteer"

async function testOfficial() {
    console.log("🚀 Lançando Puppeteer no site oficial do Slither.io...")
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: [
            "--start-maximized",
            "--disable-web-security",
            "--disable-features=IsolateOrigins,site-per-process",
            "--no-sandbox",
        ],
    })

    const page = await browser.newPage()
    console.log("🌐 Navegando para http://slither.io ...")
    try {
        await page.goto("http://slither.io", { waitUntil: "domcontentloaded" })
        console.log("Page title:", await page.title())
    } catch (e: any) {
        console.log("slither.io error:", e.message)
        console.log("Trying https://slither.io ...")
        await page.goto("https://slither.io", { waitUntil: "domcontentloaded" })
        console.log("Page title:", await page.title())
    }

    await new Promise((r) => setTimeout(r, 4000))
    await browser.close()
}

testOfficial()
