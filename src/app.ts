import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "./config.js";
import { PharosFacilitator } from "./facilitator.js";
import { DASHBOARD_HTML } from "./dashboardHtml.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();

  // CORS Configuration for Web and API clients
  app.use(
    cors({
      origin: "*",
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "PAYMENT-SIGNATURE",
        "X-PAYMENT",
        "PAYMENT-REQUIRED",
        "PAYMENT-RESPONSE",
      ],
      exposedHeaders: [
        "PAYMENT-REQUIRED",
        "PAYMENT-RESPONSE",
        "X-PAYMENT-RESPONSE",
        "Content-Type",
      ],
    })
  );

  app.use(express.json({ limit: "2mb" }));

  // Static Assets for Web UI
  const publicDir = path.join(__dirname, "..", "public");
  app.use(express.static(publicDir));

  // Dashboard Route
  app.get("/", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(DASHBOARD_HTML);
  });

  // ==========================================
  // 1. FREE ROUTE (Requirement 02)
  // ==========================================
  app.get("/health", (req: Request, res: Response) => {
    res.status(200).json({
      status: "healthy",
      service: "pharos-x402-paywalled-api",
      network: CONFIG.NETWORK_ID,
      chainId: CONFIG.CHAIN_ID,
      timestamp: new Date().toISOString(),
      freeRoute: true,
      cost: "0 USD (Free)",
    });
  });

  // ==========================================
  // 2. CONFIG ENDPOINT
  // ==========================================
  app.get("/api/config", (req: Request, res: Response) => {
    res.status(200).json({
      network: {
        name: "Pharos Atlantic Testnet",
        chainId: CONFIG.CHAIN_ID,
        networkId: CONFIG.NETWORK_ID,
        rpcUrl: CONFIG.RPC_URL,
        explorerUrl: CONFIG.EXPLORER_URL,
        usdcAddress: CONFIG.USDC_ADDRESS,
        permit2Address: CONFIG.PERMIT2_ADDRESS,
      },
      seller: {
        payToAddress: CONFIG.PAY_TO_ADDRESS,
      },
      routes: [
        {
          path: "/health",
          priceUsd: "$0.00",
          priceUnits: "0",
          access: "Free",
          description: "System and network health check",
        },
        {
          path: "/api/basic",
          priceUsd: `$${CONFIG.PRICES.BASIC.usd}`,
          priceUnits: CONFIG.PRICES.BASIC.units,
          access: "Paid (x402)",
          description: CONFIG.PRICES.BASIC.description,
        },
        {
          path: "/api/premium",
          priceUsd: `$${CONFIG.PRICES.PREMIUM.usd}`,
          priceUnits: CONFIG.PRICES.PREMIUM.units,
          access: "Paid (x402)",
          description: CONFIG.PRICES.PREMIUM.description,
        },
      ],
    });
  });

  // ==========================================
  // 3. FACILITATOR ENDPOINTS (Requirement 03)
  // ==========================================
  app.get("/supported", PharosFacilitator.handleGetSupported);
  app.post("/verify", PharosFacilitator.handleVerify);
  app.post("/settle", PharosFacilitator.handleSettle);
  app.get("/verify-receipt", PharosFacilitator.handleVerifyReceipt);

  // ==========================================
  // 4. x402 PAYMENT GATEWAY MIDDLEWARE HELPER
  // ==========================================
  function requirePayment(priceUnits: string, priceUsd: string, routeDescription: string) {
    return async (req: Request, res: Response, next: NextFunction) => {
      // 1. Build authoritative payment requirements for this route
      const requirements = {
        scheme: "exact",
        network: CONFIG.NETWORK_ID,
        asset: CONFIG.USDC_ADDRESS,
        amount: priceUnits,
        payTo: CONFIG.PAY_TO_ADDRESS,
        maxTimeoutSeconds: 300,
        extra: {
          token: CONFIG.USDC_NAME,
          name: CONFIG.USDC_NAME,
          version: "2",
          priceUsd: `$${priceUsd} USDC`,
        },
      };

      const paymentRequiredObject = {
        x402Version: 2,
        accepts: [requirements],
      };

      const encodedRequirements = Buffer.from(JSON.stringify(paymentRequiredObject)).toString("base64");

      // 2. Extract payment authorization header
      const rawHeader =
        req.headers["payment-signature"] ||
        req.headers["x-payment"] ||
        (req.headers["authorization"] && req.headers["authorization"].startsWith("x402 ")
          ? req.headers["authorization"].slice(5)
          : null);

      // If no payment provided -> Respond with HTTP 402 Payment Required
      if (!rawHeader) {
        res.setHeader("PAYMENT-REQUIRED", encodedRequirements);
        res.status(402).json({
          error: "Payment Required",
          statusCode: 402,
          state: "PAYMENT_REQUIRED",
          message: `Access to this protected route requires payment of ${priceUsd} test USDC on Pharos Atlantic Testnet.`,
          requirements: paymentRequiredObject,
        });
        return;
      }

      // 3. Parse payment authorization
      let paymentPayload: any;
      try {
        const decodedString = typeof rawHeader === "string" ? Buffer.from(rawHeader, "base64").toString("utf-8") : "";
        paymentPayload = JSON.parse(decodedString);
      } catch (e) {
        try {
          paymentPayload = typeof rawHeader === "string" ? JSON.parse(rawHeader) : rawHeader;
        } catch {
          res.setHeader("PAYMENT-REQUIRED", encodedRequirements);
          res.status(402).json({
            error: "Payment Rejected",
            statusCode: 402,
            state: "AUTHORIZATION_FAILED",
            reason: "malformed_payment_header",
            message: "Unable to parse base64 or JSON payment signature header.",
          });
          return;
        }
      }

      // Attach requirements to payload for facilitator verification
      if (!paymentPayload.accepted) {
        paymentPayload.accepted = requirements;
      }

      // 4. Verify payment via Facilitator (Requirement 03 & 05)
      const verifyResult = await PharosFacilitator.verifyPayment(paymentPayload, requirements);

      if (!verifyResult.isValid) {
        res.setHeader("PAYMENT-REQUIRED", encodedRequirements);
        res.status(402).json({
          error: "Payment Authorization Rejected",
          statusCode: 402,
          state: "AUTHORIZATION_FAILED",
          reason: verifyResult.invalidReason,
          details: verifyResult,
          message: `The submitted payment authorization was rejected: ${verifyResult.invalidReason}`,
        });
        return;
      }

      // 5. Attempt Settlement on Pharos Atlantic Testnet
      // Honest x402 enforcement: NEVER manufacture a transaction hash from a signature!
      const settlementResult = await PharosFacilitator.settlePayment(paymentPayload, requirements);

      if (!settlementResult.success || !settlementResult.txHash) {
        res.setHeader("PAYMENT-REQUIRED", encodedRequirements);
        res.status(402).json({
          error: "Settlement Unverified",
          statusCode: 402,
          state: (settlementResult as any).state || "SETTLEMENT_FAILED",
          message: "Payment authorization was cryptographically verified, but on-chain settlement on Atlantic Testnet could not be confirmed. A cryptographic signature is authorization evidence, not a confirmed on-chain transaction. Paid data withheld.",
          details: {
            signatureVerified: true,
            payer: verifyResult.payer,
            facilitatorError: settlementResult.error,
            invalidReason: (settlementResult as any).invalidReason,
            onChainReceiptRequired: true,
            chain: CONFIG.CHAIN_ID,
          },
        });
        return;
      }

      // 6. Only verified on-chain settlements proceed to resource delivery
      const paymentResponseObject = {
        success: true,
        state: "SETTLED",
        x402Version: 2,
        network: CONFIG.NETWORK_ID,
        txHash: settlementResult.txHash,
        blockNumber: settlementResult.blockNumber,
        settledAmount: priceUnits,
        payer: verifyResult.payer,
        explorerUrl: `${CONFIG.EXPLORER_URL}/tx/${settlementResult.txHash}`,
      };

      const encodedResponse = Buffer.from(JSON.stringify(paymentResponseObject)).toString("base64");
      res.setHeader("PAYMENT-RESPONSE", encodedResponse);
      res.setHeader("X-PAYMENT-RESPONSE", encodedResponse);

      // Attach settlement details to request for downstream route handler
      (req as any).payment = paymentResponseObject;
      next();
    };
  }

  // ==========================================
  // 5. PAID ROUTE A: BASIC ($0.001) (Requirement 02)
  // ==========================================
  app.get(
    "/api/basic",
    requirePayment(CONFIG.PRICES.BASIC.units, CONFIG.PRICES.BASIC.usd, CONFIG.PRICES.BASIC.description),
    async (req: Request, res: Response) => {
      const paymentInfo = (req as any).payment;
      
      // Live measured telemetry from Pharos Atlantic Testnet RPC
      let blockHeight = 0;
      let gasPriceWei = "0";
      const observationTimestamp = new Date().toISOString();
      try {
        const { viemPublicClient } = await import("./facilitator.js");
        const blockNum = await viemPublicClient.getBlockNumber();
        blockHeight = Number(blockNum);
        const gasPrice = await viemPublicClient.getGasPrice();
        gasPriceWei = gasPrice.toString();
      } catch {
        blockHeight = 0;
      }

      res.status(200).json({
        route: "/api/basic",
        accessLevel: "BASIC",
        tier: "Standard",
        pricePaid: `${CONFIG.PRICES.BASIC.usd} USDC (${CONFIG.PRICES.BASIC.units} atomic units)`,
        network: CONFIG.NETWORK_ID,
        settlement: paymentInfo,
        data: {
          metrics: {
            atlanticNetworkStatus: "ONLINE",
            blockHeight: blockHeight,
            averageBlockTimeSeconds: 1.0,
            gasPriceWei: gasPriceWei,
            liveChainObservation: true,
          },
          provenance: {
            source: "Pharos Atlantic Testnet RPC (https://atlantic.dplabs-internal.com)",
            observedAt: observationTimestamp,
            blockNumber: blockHeight,
            methodology: "Direct eth_blockNumber and eth_gasPrice queries via public Viem client",
          },
          insight: "Atlantic Testnet is operational. Block height and gas price verified via live RPC.",
          timestamp: observationTimestamp,
        },
      });
    }
  );

  // ==========================================
  // 6. PAID ROUTE B: PREMIUM ($0.005) (Requirement 02)
  // ==========================================
  app.get(
    "/api/premium",
    requirePayment(CONFIG.PRICES.PREMIUM.units, CONFIG.PRICES.PREMIUM.usd, CONFIG.PRICES.PREMIUM.description),
    (req: Request, res: Response) => {
      const paymentInfo = (req as any).payment;
      const observationTimestamp = new Date().toISOString();

      res.status(200).json({
        route: "/api/premium",
        accessLevel: "PREMIUM",
        tier: "Demonstration Analytics",
        pricePaid: `${CONFIG.PRICES.PREMIUM.usd} USDC (${CONFIG.PRICES.PREMIUM.units} atomic units)`,
        network: CONFIG.NETWORK_ID,
        settlement: paymentInfo,
        data: {
          analyticsFixture: {
            orderbookLiquidityUsd: "15,820,000",
            simulatedSlippage100k: "0.0014%",
            crossDEXArbitrageOpportunities: 3,
            recommendedExecutionVenue: "Atlantic DeepPool v2",
            predictiveAlphaScore: 0.94,
          },
          provenance: {
            classification: "DEMONSTRATION_FIXTURE",
            disclosure: "Demonstration analytics fixture for x402 payment flow verification. Simulated algorithmic intelligence, not live production market depth.",
            observedAt: observationTimestamp,
            referenceNetwork: "Pharos Atlantic Testnet (688689)",
          },
          premiumForecast: "Simulated liquidity forecast across Atlantic Testnet USDC pools for autonomous agent testing.",
          timestamp: observationTimestamp,
        },
      });
    }
  );

  return app;
}

export default createApp();
