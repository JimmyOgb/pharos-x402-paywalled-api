import asyncio
import os
import subprocess
from playwright.async_api import async_playwright
import edge_tts

CURSOR_JS = """
() => {
  if (document.getElementById('demo-cursor')) return;
  const cursor = document.createElement('div');
  cursor.id = 'demo-cursor';
  Object.assign(cursor.style, {
    position: 'fixed', top: '0px', left: '0px',
    width: '22px', height: '22px',
    background: 'rgba(239, 68, 68, 0.85)',
    border: '2px solid white', borderRadius: '50%',
    boxShadow: '0 0 12px rgba(0,0,0,0.5)',
    pointerEvents: 'none', zIndex: '999999',
    transition: 'transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
    transform: 'translate(-50%, -50%)'
  });
  document.body.appendChild(cursor);

  document.addEventListener('mousemove', e => {
    cursor.style.left = e.clientX + 'px';
    cursor.style.top = e.clientY + 'px';
  });
  document.addEventListener('mousedown', e => {
    cursor.style.transform = 'translate(-50%, -50%) scale(0.7)';
    const ripple = document.createElement('div');
    Object.assign(ripple.style, {
      position: 'fixed', left: e.clientX + 'px', top: e.clientY + 'px',
      width: '10px', height: '10px', borderRadius: '50%',
      border: '2px solid rgba(239, 68, 68, 0.9)',
      transform: 'translate(-50%, -50%) scale(1)',
      opacity: '1', pointerEvents: 'none', zIndex: '999998',
      transition: 'all 0.45s ease-out'
    });
    document.body.appendChild(ripple);
    requestAnimationFrame(() => {
      ripple.style.transform = 'translate(-50%, -50%) scale(4)';
      ripple.style.opacity = '0';
    });
    setTimeout(() => ripple.remove(), 450);
  });
  document.addEventListener('mouseup', () => {
    cursor.style.transform = 'translate(-50%, -50%) scale(1)';
  });
}
"""

async def smooth_click(page, selector: str, pause_after: float = 2.0):
    loc = page.locator(selector).first
    await loc.wait_for(state="visible", timeout=15000)
    await loc.scroll_into_view_if_needed()
    box = await loc.bounding_box()
    if box:
        target_x = box["x"] + box["width"] / 2
        target_y = box["y"] + box["height"] / 2
        await page.mouse.move(target_x, target_y, steps=25)
        await asyncio.sleep(0.3)
        await page.mouse.click(target_x, target_y)
    else:
        await loc.click()
    await asyncio.sleep(pause_after)

async def record_app_flow(url: str, video_dir: str):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1920, "height": 1080},
            record_video_dir=video_dir,
            record_video_size={"width": 1920, "height": 1080}
        )
        page = await context.new_page()
        print(f"Navigating to {url}...")
        await page.goto(url, wait_until="networkidle")
        await page.evaluate(CURSOR_JS)
        await asyncio.sleep(3.0)

        # 1. Free Route (/health)
        print("Action 1: Clicking GET /health...")
        await smooth_click(page, "button:has-text('GET /health')", pause_after=3.5)

        # 2. Call Paid Basic without payment -> 402
        print("Action 2: Calling /api/basic without payment...")
        await smooth_click(page, "button:has-text('1. Call (No Pay) → 402')", pause_after=4.0)

        # 3. Approve and Pay -> Modal -> Sign -> 200 with PAYMENT-RESPONSE
        print("Action 3: Initiating payment approval...")
        await smooth_click(page, "button:has-text('2. Approve & Pay → 200')", pause_after=2.5)

        print("Action 3b: Authorizing payment in explicit modal...")
        await smooth_click(page, "button:has-text('Authorize & Sign')", pause_after=5.0)

        # 4. Call Paid Premium route -> verify 402 & higher price
        print("Action 4: Calling /api/premium without payment...")
        await smooth_click(page, "button:has-text('Call (No Pay) → 402'):below(:text('Paid Premium'))", pause_after=4.0)

        # 5. Negative Security Test: Submit underpaid payment -> 402
        print("Action 5: Submitting underpaid payment...")
        await smooth_click(page, "button:has-text('Underpaid → 402')", pause_after=4.0)

        # 6. Query Facilitator Metadata
        print("Action 6: Querying Facilitator /supported...")
        await smooth_click(page, "button:has-text('GET /supported')", pause_after=3.0)

        await asyncio.sleep(3.0)
        video_path = await page.video.path()
        await context.close()
        await browser.close()
        return video_path

async def main():
    APP_URL = "https://pharos-x402-paywalled-api-ashy.vercel.app"
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
    PROJECT_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
    VIDEO_DIR = os.path.join(PROJECT_DIR, "raw_video")
    DEMO_DIR = os.path.join(PROJECT_DIR, "demo")
    os.makedirs(VIDEO_DIR, exist_ok=True)
    os.makedirs(DEMO_DIR, exist_ok=True)

    VOICEOVER_TEXT = (
        "Welcome to the official demonstration of the Pharos x402 Paywalled API and Facilitator for Pharos Atlantic Testnet. "
        "We begin by verifying the free endpoint. Requesting GET health returns HTTP 200 OK without requiring any payment. "
        "Next, we call the protected basic analytics route without payment. The server responds with HTTP 402 Payment Required, "
        "providing complete payment requirements priced in test USDC on Atlantic Testnet chain 688689. "
        "Now, we trigger the payment flow. The client presents an explicit approval confirmation gate, strictly upholding our non-custodial security model. "
        "Upon authorization, the client signs an EIP-712 transfer authorization. Our embedded facilitator verifies the cryptographic signature and settles the microtransaction on-chain. "
        "The server returns HTTP 200 OK, protected analytics data, and the official PAYMENT-RESPONSE header containing the transaction hash linked to the Atlantic block explorer. "
        "We also inspect the second paid tier, GET api premium, confirming differential pricing at five thousand atomic units. "
        "Finally, we execute a negative security test by submitting an underpaid authorization. The facilitator immediately detects the shortfall, rejects the request with HTTP 402, and protects private data from leakage. "
        "The application is live on Vercel and fully open-source on GitHub under JimmyOgb."
    )

    print("Generating voiceover audio via edge-tts...")
    audio_path = os.path.join(PROJECT_DIR, "voiceover.mp3")
    communicate = edge_tts.Communicate(VOICEOVER_TEXT, "en-US-ChristopherNeural")
    await communicate.save(audio_path)
    print(f"Voiceover saved: {audio_path}")

    print("Recording live browser stream via Playwright...")
    webm_file = await record_app_flow(APP_URL, VIDEO_DIR)
    print(f"Raw video recorded: {webm_file}")

    final_mp4 = os.path.join(DEMO_DIR, "pharos-x402-paywalled-api-demo.mp4")
    print(f"Merging audio and video with ffmpeg into {final_mp4}...")
    subprocess.run([
        "ffmpeg", "-y",
        "-i", webm_file,
        "-i", audio_path,
        "-c:v", "libx264", "-preset", "fast", "-crf", "22", "-r", "30",
        "-c:a", "aac", "-b:a", "192k",
        final_mp4
    ], check=True)

    print(f"✅ Demo video successfully generated at: {final_mp4}")

if __name__ == "__main__":
    asyncio.run(main())
