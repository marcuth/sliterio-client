import puppeteer from "puppeteer"

async function test() {
    const browser = await puppeteer.launch({
        headless: false,
    })
    const page = await browser.newPage()

    page.on('requestfailed', req => {
        console.log('Request failed:', req.url(), req.failure()?.errorText)
    })

    try {
        await page.goto("http://slither.io", { timeout: 10000 })
    } catch (e: any) {
        console.log("Goto error:", e.message)
    }

    await browser.close()
}

test()
