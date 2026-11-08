import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { getAddress, Hex } from "viem";
import { CONFIG } from "./config.js";

// Client Runner
async function main() {
  const baseUrl = process.argv[2] || `http://localhost:${CONFIG.PORT}`;

  console.log(`====================================================`);
  console.log(`🚀 Pharos x402 Automated Client Runner`);
  console.log(`📡 Connecting to: ${baseUrl}`);
  console.log(`⛓️  Target Network: ${CONFIG.NETWORK_ID} (Pharos Atlantic)`);
  console.log(`💵 Token Asset: ${CONFIG.USDC_ADDRESS} (Test USDC)`);
  console.log(`====================================================\n`);

  // Ephemeral test account for demonstration (Requirement 06: Zero hardcoded secrets)
  let clientAccount;
  if (CONFIG.CLIENT_PRIVATE_KEY && CONFIG.CLIENT_PRIVATE_KEY.startsWith("0x")) {
    clientAccount = privateKeyToAccount(CONFIG.CLIENT_PRIVATE_KEY);
    console.log(`🔑 Using configured client account: ${clientAccount.address}`);
  } else {
    clientAccount = privateKeyToAccount(generatePrivateKey());
    console.log(`🔑 Using generated test client account: ${clientAccount.address}`);
  }

  // ----------------------------------------------------
  // TEST A: FREE ENDPOINT (/health)
  // ----------------------------------------------------
  console.log(`\n--- Test A: Free Route (/health) ---`);
  const healthRes = await fetch(`${baseUrl}/health`);
  const healthBody = await healthRes.json();
  console.log(`Status: HTTP ${healthRes.status} (Expected: 200)`);
  console.log(`Body:`, JSON.stringify(healthBody));
  if (healthRes.status !== 200) throw new Error("Health check failed!");
  console.log(`✅ Test A PASSED: Free endpoint accessible without payment.`);

  // ----------------------------------------------------
  // TEST B: FIRST PAID ROUTE (/api/basic)
  // ----------------------------------------------------
  console.log(`\n--- Test B: First Paid Route (/api/basic) ---`);
  console.log(`Step 1: Requesting /api/basic without payment header...`);
  const unpaidRes = await fetch(`${baseUrl}/api/basic`);
  console.log(`Status: HTTP ${unpaidRes.status} (Expected: 402)`);
  const reqHeader = unpaidRes.headers.get("PAYMENT-REQUIRED");
  if (!reqHeader) throw new Error("Missing PAYMENT-REQUIRED header on 402!");

  const reqsObj = JSON.parse(Buffer.from(reqHeader, "base64").toString("utf-8"));
  const reqs = reqsObj.accepts[0];
  console.log(`Captured Payment Requirements:`);
  console.log(`  - Scheme:  ${reqs.scheme}`);
  console.log(`  - Network: ${reqs.network}`);
  console.log(`  - Asset:   ${reqs.asset}`);
  console.log(`  - Amount:  ${reqs.amount} (${reqs.extra?.priceUsd || "0.001 USDC"})`);
  console.log(`  - PayTo:   ${reqs.payTo}`);

  console.log(`\nStep 2: Explicit human approval simulated for test payment...`);
  console.log(`Authorizing payment of ${reqs.amount} atomic units to ${reqs.payTo}...`);

  console.log(`\nStep 3: Signing EIP-712 payment authorization...`);
  const nonce = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");
  const now = Math.floor(Date.now() / 1000);

  const domain = {
    name: reqs.extra?.name || CONFIG.USDC_NAME,
    version: reqs.extra?.version || "2",
    chainId: CONFIG.CHAIN_ID,
    verifyingContract: getAddress(reqs.asset),
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
    to: getAddress(reqs.payTo),
    value: BigInt(reqs.amount),
    validAfter: BigInt(0),
    validBefore: BigInt(now + 300),
    nonce: nonce as `0x${string}`,
  };

  const signature = await clientAccount.signTypedData({
    domain,
    types,
    primaryType: "TransferWithAuthorization",
    message,
  });

  const paymentPayload = {
    x402Version: 2,
    accepted: reqs,
    payload: {
      authorization: {
        from: clientAccount.address,
        to: reqs.payTo,
        value: reqs.amount,
        validAfter: "0",
        validBefore: (now + 300).toString(),
        nonce,
      },
      signature,
    },
  };

  console.log(`Step 4: Submitting paid request with PAYMENT-SIGNATURE header...`);
  const paidRes = await fetch(`${baseUrl}/api/basic`, {
    headers: {
      "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(paymentPayload)).toString("base64"),
    },
  });

  console.log(`Status: HTTP ${paidRes.status} (Expected: 200)`);
  const paymentResponseHeader = paidRes.headers.get("PAYMENT-RESPONSE");
  if (!paymentResponseHeader) throw new Error("Missing PAYMENT-RESPONSE header on 200!");

  const responseObj = JSON.parse(Buffer.from(paymentResponseHeader, "base64").toString("utf-8"));
  console.log(`Decoded PAYMENT-RESPONSE Header:`);
  console.log(`  - Success:     ${responseObj.success}`);
  console.log(`  - Network:     ${responseObj.network}`);
  console.log(`  - TxHash:      ${responseObj.txHash}`);
  console.log(`  - Explorer:    ${responseObj.explorerUrl}`);

  const paidBody = await paidRes.json();
  console.log(`Protected Resource Body:`, JSON.stringify(paidBody.data));
  console.log(`✅ Test B PASSED: Basic paid route verified and settled.`);

  // ----------------------------------------------------
  // TEST C: SECOND PAID ROUTE (/api/premium)
  // ----------------------------------------------------
  console.log(`\n--- Test C: Second Paid Route (/api/premium) ---`);
  const premiumUnpaidRes = await fetch(`${baseUrl}/api/premium`);
  const premiumReqHeader = premiumUnpaidRes.headers.get("PAYMENT-REQUIRED");
  const premiumReqs = JSON.parse(Buffer.from(premiumReqHeader!, "base64").toString("utf-8")).accepts[0];
  console.log(`Basic Price:   ${reqs.amount} units ($${CONFIG.PRICES.BASIC.usd})`);
  console.log(`Premium Price: ${premiumReqs.amount} units ($${CONFIG.PRICES.PREMIUM.usd})`);
  if (reqs.amount === premiumReqs.amount) throw new Error("Paid routes must have different prices!");
  console.log(`✅ Test C PASSED: Two paid routes verified with distinct pricing.`);

  // ----------------------------------------------------
  // TEST D: NEGATIVE REJECTION TEST (Requirement 05)
  // ----------------------------------------------------
  console.log(`\n--- Test D: Underpaid Payment Rejection (Requirement 05) ---`);
  const underpaidPayload = {
    ...paymentPayload,
    payload: {
      ...paymentPayload.payload,
      authorization: {
        ...paymentPayload.payload.authorization,
        value: "100", // Required is 1000!
      },
    },
  };

  const badRes = await fetch(`${baseUrl}/api/basic`, {
    headers: {
      "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(underpaidPayload)).toString("base64"),
    },
  });
  console.log(`Status: HTTP ${badRes.status} (Expected: 402)`);
  const badBody = await badRes.json();
  console.log(`Rejection Reason: ${badBody.reason || badBody.error}`);
  if (badRes.status !== 402) throw new Error("Expected 402 rejection for underpaid payment!");
  console.log(`✅ Test D PASSED: Underpaid payment rejected with HTTP 402.`);

  console.log(`\n====================================================`);
  console.log(`🎉 ALL CLIENT CHECKS COMPLETED SUCCESSFULLY!`);
  console.log(`====================================================`);
}

main().catch((err) => {
  console.error("Client runner error:", err);
  process.exit(1);
});
