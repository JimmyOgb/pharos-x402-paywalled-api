import { createApp } from "./app.js";
import { CONFIG } from "./config.js";

const app = createApp();

app.listen(CONFIG.PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Pharos x402 Paywalled API Server running`);
  console.log(`📡 URL: http://localhost:${CONFIG.PORT}`);
  console.log(`⛓️  Network: ${CONFIG.NETWORK_ID} (Pharos Atlantic Testnet)`);
  console.log(`💵 USDC Token: ${CONFIG.USDC_ADDRESS}`);
  console.log(`🔍 Explorer: ${CONFIG.EXPLORER_URL}`);
  console.log(`====================================================`);
  console.log(`Available Endpoints:`);
  console.log(`  - Free:        GET  /health`);
  console.log(`  - Config:      GET  /api/config`);
  console.log(`  - Paid Basic:  GET  /api/basic   ($${CONFIG.PRICES.BASIC.usd} USDC)`);
  console.log(`  - Paid Premium:GET  /api/premium ($${CONFIG.PRICES.PREMIUM.usd} USDC)`);
  console.log(`  - Facilitator: GET  /supported`);
  console.log(`  - Facilitator: POST /verify`);
  console.log(`  - Facilitator: POST /settle`);
  console.log(`====================================================`);
});
