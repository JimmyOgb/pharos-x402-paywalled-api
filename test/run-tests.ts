import { createApp } from "../src/app.js";
import { CONFIG } from "../src/config.js";
import { PharosFacilitator } from "../src/facilitator.js";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { getAddress } from "viem";
import http from "http";

interface TestResult {
  num: number;
  description: string;
  classification: "Unit" | "Mock integration" | "Read-only live RPC verification";
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function record(
  num: number,
  description: string,
  classification: "Unit" | "Mock integration" | "Read-only live RPC verification",
  passed: boolean,
  details: string
) {
  results.push({ num, description, classification, passed, details });
  const status = passed ? "✅ PASS" : "❌ FAIL";
  console.log(`[${status}] Test ${String(num).padStart(2, "0")} [${classification}]: ${description}`);
  if (!passed || process.env.VERBOSE) {
    console.log(`       Details: ${details}`);
  }
}

async function runTestSuite() {
  console.log(`========================================================================================`);
  console.log(`🧪 Pharos x402 Supplier — Honest Settlement & Provenance Verification Suite (16 Gates)`);
  console.log(`========================================================================================\n`);

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const clientAccount = privateKeyToAccount(generatePrivateKey());
  const now = Math.floor(Date.now() / 1000);

  async function createSignedAuth(
    amount: string,
    payTo: string,
    network = CONFIG.NETWORK_ID,
    asset = CONFIG.USDC_ADDRESS,
    expiryOffset = 300
  ) {
    const nonce = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
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
    record(
      1,
      "/health succeeds without payment",
      "Unit",
      resHealth.status === 200 && healthBody.freeRoute === true,
      `Status: ${resHealth.status}`
    );

    // 2. /api/basic returns 402 without payment
    const resBasic402 = await fetch(`${baseUrl}/api/basic`);
    const basicReqHeader = resBasic402.headers.get("PAYMENT-REQUIRED");
    record(
      2,
      "/api/basic returns 402 without payment",
      "Unit",
      resBasic402.status === 402 && !!basicReqHeader,
      `Status: ${resBasic402.status}`
    );

    // 3. /api/premium returns 402 without payment
    const resPrem402 = await fetch(`${baseUrl}/api/premium`);
    const premReqHeader = resPrem402.headers.get("PAYMENT-REQUIRED");
    record(
      3,
      "/api/premium returns 402 without payment",
      "Unit",
      resPrem402.status === 402 && !!premReqHeader,
      `Status: ${resPrem402.status}`
    );

    // 4. Basic and premium routes have different verified prices
    const basicReqs = JSON.parse(Buffer.from(basicReqHeader!, "base64").toString("utf-8")).accepts[0];
    const premReqs = JSON.parse(Buffer.from(premReqHeader!, "base64").toString("utf-8")).accepts[0];
    record(
      4,
      "Basic and premium routes have different verified prices ($0.001 vs $0.005)",
      "Unit",
      basicReqs.amount === "1000" && premReqs.amount === "5000",
      `Basic: ${basicReqs.amount}, Premium: ${premReqs.amount}`
    );

    // 5. Correctly formatted payment authorization is cryptographically accepted
    const validBasicAuth = await createSignedAuth("1000", CONFIG.PAY_TO_ADDRESS);
    const verifyValid = await PharosFacilitator.verifyPayment(validBasicAuth, validBasicAuth.accepted);
    record(
      5,
      "Cryptographic EIP-712 / EIP-3009 authorization signature validates successfully",
      "Unit",
      verifyValid.isValid === true,
      `isValid: ${verifyValid.isValid}, Payer: ${verifyValid.payer}`
    );

    // 6. Wrong network is rejected
    const wrongNetAuth = await createSignedAuth("1000", CONFIG.PAY_TO_ADDRESS, "eip155:1");
    const verifyWrongNet = await PharosFacilitator.verifyPayment(wrongNetAuth, wrongNetAuth.accepted);
    record(
      6,
      "Wrong network is rejected (only eip155:688689 accepted)",
      "Unit",
      verifyWrongNet.isValid === false && verifyWrongNet.invalidReason === "wrong_network",
      `Reason: ${verifyWrongNet.invalidReason}`
    );

    // 7. Wrong asset is rejected
    const wrongAssetAuth = await createSignedAuth("1000", CONFIG.PAY_TO_ADDRESS, CONFIG.NETWORK_ID, "0xdAC17F958D2ee523a2206206994597C13D831ec7");
    const verifyWrongAsset = await PharosFacilitator.verifyPayment(wrongAssetAuth, wrongAssetAuth.accepted);
    record(
      7,
      "Wrong payment asset is rejected (only Atlantic Testnet USDC accepted)",
      "Unit",
      verifyWrongAsset.isValid === false && verifyWrongAsset.invalidReason === "wrong_asset",
      `Reason: ${verifyWrongAsset.invalidReason}`
    );

    // 8. Wrong recipient is rejected
    const wrongRecipientAuth = await createSignedAuth("1000", "0x000000000000000000000000000000000000dEaD");
    const verifyWrongRecipient = await PharosFacilitator.verifyPayment(wrongRecipientAuth, wrongRecipientAuth.accepted);
    record(
      8,
      "Wrong recipient is rejected",
      "Unit",
      verifyWrongRecipient.isValid === false && verifyWrongRecipient.invalidReason === "wrong_recipient",
      `Reason: ${verifyWrongRecipient.invalidReason}`
    );

    // 9. Underpaid payment is rejected
    const underpaidAuth = await createSignedAuth("500", CONFIG.PAY_TO_ADDRESS);
    const verifyUnderpaid = await PharosFacilitator.verifyPayment(underpaidAuth, { ...underpaidAuth.accepted, amount: "1000" });
    record(
      9,
      "Underpaid payment is rejected",
      "Unit",
      verifyUnderpaid.isValid === false && verifyUnderpaid.invalidReason === "underpaid_payment",
      `Reason: ${verifyUnderpaid.invalidReason}`
    );

    // 10. Expired authorization is rejected
    const expiredAuth = await createSignedAuth("1000", CONFIG.PAY_TO_ADDRESS, CONFIG.NETWORK_ID, CONFIG.USDC_ADDRESS, -3600);
    const verifyExpired = await PharosFacilitator.verifyPayment(expiredAuth, expiredAuth.accepted);
    record(
      10,
      "Expired authorization window is rejected",
      "Unit",
      verifyExpired.isValid === false && verifyExpired.invalidReason === "authorization_expired",
      `Reason: ${verifyExpired.invalidReason}`
    );

    // 11. Tampered / malformed signature is rejected
    const tamperedAuth = { ...validBasicAuth, payload: { ...validBasicAuth.payload, signature: "0x" + "11".repeat(65) } };
    const badSigVerify = await PharosFacilitator.verifyPayment(tamperedAuth, tamperedAuth.accepted);
    record(
      11,
      "Tampered signature is rejected by cryptographic verification",
      "Unit",
      badSigVerify.isValid === false,
      `Reason: ${badSigVerify.invalidReason}`
    );

    // 12. Failed settlement never returns successful paid data (honest x402 enforcement)
    const paidBasicHeader = Buffer.from(JSON.stringify(validBasicAuth)).toString("base64");
    const resPaidBasic = await fetch(`${baseUrl}/api/basic`, {
      headers: { "PAYMENT-SIGNATURE": paidBasicHeader },
    });
    const paidBody = await resPaidBasic.json();
    const paidResponseHeader = resPaidBasic.headers.get("PAYMENT-RESPONSE");

    // Because test facilitator has no funded test gas, settlement fails on-chain.
    // The server MUST respond with HTTP 402 Settlement Unverified, NOT HTTP 200!
    // And MUST NOT set a PAYMENT-RESPONSE header!
    const honestRefusal =
      resPaidBasic.status === 402 &&
      paidBody.state === "SETTLEMENT_FAILED" &&
      !paidResponseHeader;

    record(
      12,
      "Failed on-chain settlement withholds paid resource and returns HTTP 402 (Honest Enforcement)",
      "Mock integration",
      honestRefusal,
      `Status: ${resPaidBasic.status}, state: ${paidBody.state}, header: ${paidResponseHeader}`
    );

    // 13. Signature reference is NEVER returned as a transaction hash
    const signatureNeverBecomesTxHash =
      !paidResponseHeader &&
      paidBody.signatureReference === undefined &&
      (paidBody.details?.txHash === undefined || paidBody.details?.txHash === "");

    record(
      13,
      "Signature reference is NEVER sliced into a fake transaction hash",
      "Unit",
      signatureNeverBecomesTxHash,
      `Payload state: ${paidBody.state}`
    );

    // 14. Read-only live RPC lookup verifies hash non-existence on Atlantic Testnet
    const fakeHash = "0xbbb90cce8625163360c4d57feec81dae449eafe0c08dfec48e6b96e1d47cc066";
    const receiptVerify = await PharosFacilitator.verifyOnChainReceipt(fakeHash);
    record(
      14,
      "On-chain receipt lookup on Atlantic Testnet rejects unmined signature references (NOT_FOUND)",
      "Read-only live RPC verification",
      receiptVerify.verified === false && receiptVerify.state === "NOT_FOUND",
      `State: ${receiptVerify.state}, reason: ${receiptVerify.reason}`
    );

    // 15. Invalid hash format is rejected immediately without RPC lookup
    const badFormatVerify = await PharosFacilitator.verifyOnChainReceipt("0xinvalid");
    record(
      15,
      "Invalid transaction hash format rejected before RPC query",
      "Unit",
      badFormatVerify.verified === false && badFormatVerify.state === "INVALID_HASH_FORMAT",
      `State: ${badFormatVerify.state}`
    );

    // 16. Supported endpoint advertises scheme and Atlantic Testnet networkId
    const resSupported = await fetch(`${baseUrl}/supported`);
    const supportedData = await resSupported.json();
    const hasNetwork = supportedData.kinds?.some((k: any) => k.network === CONFIG.NETWORK_ID && k.scheme === "exact");
    record(
      16,
      "/supported correctly advertises exact scheme on eip155:688689",
      "Unit",
      resSupported.status === 200 && hasNetwork,
      `Supported: ${JSON.stringify(supportedData.kinds)}`
    );
  } finally {
    server.close();
  }

  console.log(`\n========================================================================================`);
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`📊 RESULTS: ${passedCount} / ${results.length} TESTS PASSED`);
  console.log(`========================================================================================\n`);

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
