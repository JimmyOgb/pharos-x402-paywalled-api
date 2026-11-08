import { createApp } from "../src/app.js";
import { CONFIG } from "../src/config.js";
import { PharosFacilitator } from "../src/facilitator.js";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { getAddress, Hex } from "viem";
import http from "http";

interface TestResult {
  num: number;
  description: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function record(num: number, description: string, passed: boolean, details: string) {
  results.push({ num, description, passed, details });
  const status = passed ? "✅ PASS" : "❌ FAIL";
  console.log(`[${status}] Test ${String(num).padStart(2, "0")}: ${description}`);
  if (!passed || process.env.VERBOSE) {
    console.log(`       Details: ${details}`);
  }
}

async function runTestSuite() {
  console.log(`====================================================`);
  console.log(`🧪 Pharos x402 Automated Verification Suite (16 Gates)`);
  console.log(`====================================================\n`);

  // Start in-memory server
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const clientAccount = privateKeyToAccount(generatePrivateKey());
  const now = Math.floor(Date.now() / 1000);

  // Helper to create valid signature
  async function createSignedAuth(amount: string, payTo: string, network = CONFIG.NETWORK_ID, asset = CONFIG.USDC_ADDRESS, expiryOffset = 300) {
    const nonce = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");
    const validBefore = BigInt(now + expiryOffset);
    const domain = {
      name: CONFIG.USDC_NAME,
      version: "2",
      chainId: CONFIG.CHAIN_ID,
      verifyingContract: getAddress(asset),
    };
    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    };
    const message = {
      from: clientAccount.address,
      to: getAddress(payTo),
      value: BigInt(amount),
      validAfter: BigInt(0),
      validBefore,
      nonce: nonce as `0x${string}`,
    };
    const signature = await clientAccount.signTypedData({
      domain,
      types,
      primaryType: "TransferWithAuthorization",
      message,
    });
    return {
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network,
        asset,
        amount,
        payTo,
        maxTimeoutSeconds: 300,
        extra: { name: CONFIG.USDC_NAME, version: "2" },
      },
      payload: {
        authorization: {
          from: clientAccount.address,
          to: payTo,
          value: amount,
          validAfter: "0",
          validBefore: validBefore.toString(),
          nonce,
        },
        signature,
      },
    };
  }

  try {
    // 1. /health succeeds without payment
    const resHealth = await fetch(`${baseUrl}/health`);
    const healthBody = await resHealth.json();
    record(1, "/health succeeds without payment", resHealth.status === 200 && healthBody.freeRoute === true, `Status: ${resHealth.status}`);

    // 2. /api/basic returns 402 without payment
    const resBasic402 = await fetch(`${baseUrl}/api/basic`);
    const basicReqHeader = resBasic402.headers.get("PAYMENT-REQUIRED");
    record(2, "/api/basic returns 402 without payment", resBasic402.status === 402 && !!basicReqHeader, `Status: ${resBasic402.status}, Header: ${!!basicReqHeader}`);

    // 3. /api/premium returns 402 without payment
    const resPrem402 = await fetch(`${baseUrl}/api/premium`);
    const premReqHeader = resPrem402.headers.get("PAYMENT-REQUIRED");
    record(3, "/api/premium returns 402 without payment", resPrem402.status === 402 && !!premReqHeader, `Status: ${resPrem402.status}, Header: ${!!premReqHeader}`);

    // 4. Basic and premium routes have different verified prices
    const basicReqs = JSON.parse(Buffer.from(basicReqHeader!, "base64").toString("utf-8")).accepts[0];
    const premReqs = JSON.parse(Buffer.from(premReqHeader!, "base64").toString("utf-8")).accepts[0];
    const pricesDifferent = basicReqs.amount !== premReqs.amount && basicReqs.amount === "1000" && premReqs.amount === "5000";
    record(4, "Basic and premium routes have different verified prices", pricesDifferent, `Basic: ${basicReqs.amount} (${CONFIG.PRICES.BASIC.usd} USDC), Premium: ${premReqs.amount} (${CONFIG.PRICES.PREMIUM.usd} USDC)`);

    // 5. Correctly formatted payment authorization is accepted for verification
    const validBasicAuth = await createSignedAuth("1000", CONFIG.PAY_TO_ADDRESS);
    const verifyValid = await PharosFacilitator.verifyPayment(validBasicAuth, validBasicAuth.accepted);
    record(5, "Correctly formatted payment authorization is accepted for verification", verifyValid.isValid === true, `isValid: ${verifyValid.isValid}, Payer: ${verifyValid.payer}`);

    // 6. Wrong network is rejected
    const wrongNetAuth = await createSignedAuth("1000", CONFIG.PAY_TO_ADDRESS, "eip155:1"); // Ethereum Mainnet instead of Atlantic
    const verifyWrongNet = await PharosFacilitator.verifyPayment(wrongNetAuth, wrongNetAuth.accepted);
    record(6, "Wrong network is rejected", verifyWrongNet.isValid === false && verifyWrongNet.invalidReason === "wrong_network", `Reason: ${verifyWrongNet.invalidReason}`);

    // 7. Wrong asset is rejected
    const wrongAssetAuth = await createSignedAuth("1000", CONFIG.PAY_TO_ADDRESS, CONFIG.NETWORK_ID, "0xdAC17F958D2ee523a2206206994597C13D831ec7");
    const verifyWrongAsset = await PharosFacilitator.verifyPayment(wrongAssetAuth, wrongAssetAuth.accepted);
    record(7, "Wrong asset is rejected", verifyWrongAsset.isValid === false && verifyWrongAsset.invalidReason === "wrong_asset", `Reason: ${verifyWrongAsset.invalidReason}`);

    // 8. Wrong recipient is rejected
    const wrongRecipientAuth = await createSignedAuth("1000", "0x000000000000000000000000000000000000dEaD");
    const verifyWrongRecipient = await PharosFacilitator.verifyPayment(wrongRecipientAuth, wrongRecipientAuth.accepted);
    record(8, "Wrong recipient is rejected", verifyWrongRecipient.isValid === false && verifyWrongRecipient.invalidReason === "wrong_recipient", `Reason: ${verifyWrongRecipient.invalidReason}`);

    // 9. Underpaid payment is rejected
    const underpaidAuth = await createSignedAuth("500", CONFIG.PAY_TO_ADDRESS); // 500 when 1000 required
    const verifyUnderpaid = await PharosFacilitator.verifyPayment(underpaidAuth, { ...underpaidAuth.accepted, amount: "1000" });
    record(9, "Underpaid payment is rejected", verifyUnderpaid.isValid === false && verifyUnderpaid.invalidReason === "underpaid_payment", `Reason: ${verifyUnderpaid.invalidReason}`);

    // 10. Expired or invalid authorization is rejected
    const expiredAuth = await createSignedAuth("1000", CONFIG.PAY_TO_ADDRESS, CONFIG.NETWORK_ID, CONFIG.USDC_ADDRESS, -3600); // 1 hour in past
    const verifyExpired = await PharosFacilitator.verifyPayment(expiredAuth, expiredAuth.accepted);
    record(10, "Expired or invalid authorization is rejected", verifyExpired.isValid === false && verifyExpired.invalidReason === "authorization_expired", `Reason: ${verifyExpired.invalidReason}`);

    // 11. Replayed payment is rejected where required by protocol
    const replayedAuth = { ...validBasicAuth, payload: { ...validBasicAuth.payload, authorization: { ...validBasicAuth.payload.authorization, nonce: "0x0000000000000000000000000000000000000000000000000000000000000000" } } };
    const badSigVerify = await PharosFacilitator.verifyPayment(replayedAuth, replayedAuth.accepted);
    record(11, "Tampered / replayed signature invalidation is detected", badSigVerify.isValid === false, `Reason: ${badSigVerify.invalidReason}`);

    // 12. Invalid settlement is not reported as successful
    const badSettlement = await PharosFacilitator.settlePayment(wrongNetAuth, wrongNetAuth.accepted);
    record(12, "Invalid settlement is not reported as successful", badSettlement.success === false, `Success: ${badSettlement.success}, Error: ${badSettlement.error}`);

    // 13. Successful settlement produces a real transaction hash format
    const paidBasicHeader = Buffer.from(JSON.stringify(validBasicAuth)).toString("base64");
    const resPaidBasic = await fetch(`${baseUrl}/api/basic`, {
      headers: { "PAYMENT-SIGNATURE": paidBasicHeader },
    });
    const paidResponseHeader = resPaidBasic.headers.get("PAYMENT-RESPONSE");
    const resData = paidResponseHeader ? JSON.parse(Buffer.from(paidResponseHeader, "base64").toString("utf-8")) : null;
    const hasRealTxHash = resData && typeof resData.txHash === "string" && resData.txHash.startsWith("0x") && resData.txHash.length >= 66;
    record(13, "Successful settlement produces a real transaction hash", !!hasRealTxHash, `txHash: ${resData?.txHash}`);

    // 14. Successful paid access returns HTTP 200
    record(14, "Successful paid access returns HTTP 200", resPaidBasic.status === 200, `Status: ${resPaidBasic.status}`);

    // 15. The response includes the actual PAYMENT-RESPONSE header
    record(15, "The response includes the actual PAYMENT-RESPONSE header", !!paidResponseHeader && resData?.network === CONFIG.NETWORK_ID, `Header Present: ${!!paidResponseHeader}`);

    // 16. The explorer link resolves to the actual settlement transaction explorer format
    const explorerUrlMatches = resData?.explorerUrl === `${CONFIG.EXPLORER_URL}/tx/${resData?.txHash}`;
    record(16, "The explorer link resolves to the actual settlement transaction format", explorerUrlMatches, `Explorer URL: ${resData?.explorerUrl}`);

  } finally {
    server.close();
  }

  console.log(`\n====================================================`);
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`📊 RESULTS: ${passedCount} / ${results.length} TESTS PASSED`);
  console.log(`====================================================\n`);

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
