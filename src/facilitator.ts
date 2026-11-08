import { Request, Response } from "express";
import { createWalletClient, http, publicActions, getAddress, verifyTypedData, defineChain, Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey, PrivateKeyAccount } from "viem/accounts";
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactEvmScheme as FacilitatorScheme } from "@x402/evm/exact/facilitator";
import { toFacilitatorEvmSigner, authorizationTypes } from "@x402/evm";
import { CONFIG } from "./config.js";
import { pharosAtlanticTestnet } from "./chain.js";

// Initialize Viem public client for on-chain state inspection
export const viemPublicClient = createWalletClient({
  chain: pharosAtlanticTestnet,
  transport: http(CONFIG.RPC_URL),
}).extend(publicActions);

// Get or create facilitator settlement account
let facilitatorAccount: PrivateKeyAccount;
if (CONFIG.FACILITATOR_PRIVATE_KEY && CONFIG.FACILITATOR_PRIVATE_KEY.startsWith("0x")) {
  facilitatorAccount = privateKeyToAccount(CONFIG.FACILITATOR_PRIVATE_KEY);
} else {
  // Ephemeral test account for verification without exposed keys
  facilitatorAccount = privateKeyToAccount(generatePrivateKey());
}

export const facilitatorWalletClient = createWalletClient({
  account: facilitatorAccount,
  chain: pharosAtlanticTestnet,
  transport: http(CONFIG.RPC_URL),
}).extend(publicActions);

export const facilitatorSigner = toFacilitatorEvmSigner(facilitatorWalletClient as any);

// Core x402 facilitator instance
export const coreFacilitator = new x402Facilitator();
export const facilitatorExactEvmScheme = new FacilitatorScheme(facilitatorSigner);
coreFacilitator.register(CONFIG.NETWORK_ID as `${string}:${string}`, facilitatorExactEvmScheme);

// Facilitator implementation class
export class PharosFacilitator {
  /**
   * GET /supported
   * Advertises supported schemes and networks
   */
  static getSupported() {
    return {
      kinds: [
        {
          x402Version: 2,
          scheme: "exact",
          network: CONFIG.NETWORK_ID,
        },
      ],
      extensions: [],
      signers: {
        "eip155:*": [facilitatorAccount.address],
      },
    };
  }

  /**
   * Validates authorization payload cryptographically and against requirements
   */
  static async verifyPayment(paymentPayload: any, requirements: any) {
    if (!paymentPayload) {
      return { isValid: false, invalidReason: "missing_payment_payload" };
    }

    const payload = paymentPayload.payload || paymentPayload;
    const reqs = requirements || paymentPayload.accepted;

    if (!reqs) {
      return { isValid: false, invalidReason: "missing_payment_requirements" };
    }

    // 1. Verify Scheme
    if (reqs.scheme !== "exact") {
      return { isValid: false, invalidReason: "unsupported_scheme", expected: "exact", received: reqs.scheme };
    }

    // 2. Verify Network
    if (reqs.network !== CONFIG.NETWORK_ID) {
      return { isValid: false, invalidReason: "wrong_network", expected: CONFIG.NETWORK_ID, received: reqs.network };
    }

    // 3. Verify Payment Asset
    if (getAddress(reqs.asset) !== getAddress(CONFIG.USDC_ADDRESS)) {
      return { isValid: false, invalidReason: "wrong_asset", expected: CONFIG.USDC_ADDRESS, received: reqs.asset };
    }

    // 4. Verify Recipient
    if (getAddress(reqs.payTo) !== getAddress(CONFIG.PAY_TO_ADDRESS)) {
      return { isValid: false, invalidReason: "wrong_recipient", expected: CONFIG.PAY_TO_ADDRESS, received: reqs.payTo };
    }

    const authorization = payload.authorization;
    if (!authorization) {
      return { isValid: false, invalidReason: "missing_authorization_fields" };
    }

    // 5. Verify Amount (Must not be underpaid)
    const requiredAmount = BigInt(reqs.amount);
    const authorizedAmount = BigInt(authorization.value || "0");
    if (authorizedAmount < requiredAmount) {
      return {
        isValid: false,
        invalidReason: "underpaid_payment",
        required: requiredAmount.toString(),
        authorized: authorizedAmount.toString(),
      };
    }

    // 6. Verify Expiration Window
    const now = BigInt(Math.floor(Date.now() / 1000));
    const validBefore = BigInt(authorization.validBefore || "0");
    const validAfter = BigInt(authorization.validAfter || "0");

    if (now > validBefore) {
      return { isValid: false, invalidReason: "authorization_expired", validBefore: validBefore.toString(), now: now.toString() };
    }
    if (now < validAfter) {
      return { isValid: false, invalidReason: "authorization_not_yet_valid", validAfter: validAfter.toString(), now: now.toString() };
    }

    // 7. Verify Cryptographic EIP-712 Signature
    try {
      const payer = getAddress(authorization.from);
      const recipient = getAddress(authorization.to);

      if (recipient !== getAddress(CONFIG.PAY_TO_ADDRESS)) {
        return { isValid: false, invalidReason: "wrong_recipient_in_auth" };
      }

      const domain = {
        name: reqs.extra?.name || CONFIG.USDC_NAME,
        version: reqs.extra?.version || "2",
        chainId: CONFIG.CHAIN_ID,
        verifyingContract: getAddress(CONFIG.USDC_ADDRESS),
      };

      const message = {
        from: payer,
        to: recipient,
        value: authorizedAmount,
        validAfter: validAfter,
        validBefore: validBefore,
        nonce: authorization.nonce as `0x${string}`,
      };

      const isValidSig = await verifyTypedData({
        address: payer,
        domain,
        types: authorizationTypes,
        primaryType: "TransferWithAuthorization",
        message,
        signature: payload.signature as Hex,
      });

      if (!isValidSig) {
        return { isValid: false, invalidReason: "invalid_cryptographic_signature", payer };
      }

      return {
        isValid: true,
        payer,
        authorizedAmount: authorizedAmount.toString(),
        network: CONFIG.NETWORK_ID,
      };
    } catch (err: any) {
      return {
        isValid: false,
        invalidReason: "signature_verification_error",
        error: err.message,
      };
    }
  }

  /**
   * Settles payment on-chain on Pharos Atlantic Testnet
   */
  static async settlePayment(paymentPayload: any, requirements: any) {
    const verifyResult = await this.verifyPayment(paymentPayload, requirements);
    if (!verifyResult.isValid) {
      return {
        success: false,
        error: `Settlement rejected: ${verifyResult.invalidReason}`,
        details: verifyResult,
      };
    }

    const payload = paymentPayload.payload || paymentPayload;
    const auth = payload.authorization;
    const sig = payload.signature;

    // Split signature into r, s, v
    let r: `0x${string}`;
    let s: `0x${string}`;
    let v: number;

    if (typeof sig === "string" && sig.length === 132) {
      r = ("0x" + sig.slice(2, 66)) as `0x${string}`;
      s = ("0x" + sig.slice(66, 130)) as `0x${string}`;
      v = parseInt(sig.slice(130, 132), 16);
    } else {
      return {
        success: false,
        error: "Malformed signature format for settlement",
      };
    }

    try {
      // Execute transferWithAuthorization on Atlantic Testnet USDC contract
      const hash = await facilitatorWalletClient.writeContract({
        address: CONFIG.USDC_ADDRESS,
        abi: [
          {
            name: "transferWithAuthorization",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "from", type: "address" },
              { name: "to", type: "address" },
              { name: "value", type: "uint256" },
              { name: "validAfter", type: "uint256" },
              { name: "validBefore", type: "uint256" },
              { name: "nonce", type: "bytes32" },
              { name: "v", type: "uint8" },
              { name: "r", type: "bytes32" },
              { name: "s", type: "bytes32" },
            ],
            outputs: [],
          },
        ],
        functionName: "transferWithAuthorization",
        args: [
          getAddress(auth.from),
          getAddress(auth.to),
          BigInt(auth.value),
          BigInt(auth.validAfter),
          BigInt(auth.validBefore),
          auth.nonce as `0x${string}`,
          v,
          r,
          s,
        ],
      });

      const receipt = await viemPublicClient.waitForTransactionReceipt({
        hash,
        timeout: 30000,
      });

      if (receipt.status !== "success") {
        return {
          success: false,
          state: "SETTLEMENT_FAILED",
          error: "On-chain transaction reverted during execution on Atlantic Testnet",
          txHash: hash,
          blockNumber: receipt.blockNumber.toString(),
        };
      }

      // Verify USDC Transfer event in logs
      const usdcTransfer = receipt.logs.find((log) => {
        return (
          log.address.toLowerCase() === CONFIG.USDC_ADDRESS.toLowerCase() &&
          log.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
        );
      });

      if (!usdcTransfer) {
        return {
          success: false,
          state: "SETTLEMENT_UNVERIFIED",
          error: "Transaction mined but no USDC Transfer event was detected in logs",
          txHash: hash,
          blockNumber: receipt.blockNumber.toString(),
        };
      }

      return {
        success: true,
        state: "SETTLED",
        txHash: hash,
        blockNumber: receipt.blockNumber.toString(),
        network: CONFIG.NETWORK_ID,
        explorerUrl: `${CONFIG.EXPLORER_URL}/tx/${hash}`,
      };
    } catch (err: any) {
      return {
        success: false,
        state: "SETTLEMENT_FAILED",
        error: "On-chain settlement reverted or failed to broadcast",
        invalidReason: err.message || "settlement_execution_failed",
      };
    }
  }

  /**
   * Independent read-only verification of an existing on-chain transaction hash on Atlantic Testnet
   */
  static async verifyOnChainReceipt(txHash: string, expectedTo?: string, expectedAmount?: bigint) {
    if (!txHash || typeof txHash !== "string" || !txHash.startsWith("0x") || txHash.length !== 66) {
      return { verified: false, state: "INVALID_HASH_FORMAT", reason: "Hash must be 32 bytes (0x + 64 hex characters)" };
    }
    try {
      const receipt = await viemPublicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
      if (!receipt) {
        return { verified: false, state: "NOT_FOUND", reason: "Transaction receipt not found on chain ID 688689" };
      }
      if (receipt.status !== "success") {
        return { verified: false, state: "TRANSACTION_FAILED", reason: "Transaction execution reverted on-chain" };
      }

      const usdcTransfer = receipt.logs.find((log) => {
        return (
          log.address.toLowerCase() === CONFIG.USDC_ADDRESS.toLowerCase() &&
          log.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
        );
      });

      if (!usdcTransfer) {
        return { verified: false, state: "NO_TRANSFER_EVENT", reason: "No USDC Transfer event found in transaction logs" };
      }

      const toTopic = usdcTransfer.topics[2];
      const actualTo = toTopic ? `0x${toTopic.slice(26)}`.toLowerCase() : "";
      const actualAmount = usdcTransfer.data ? BigInt(usdcTransfer.data) : 0n;

      if (expectedTo && actualTo !== expectedTo.toLowerCase()) {
        return { verified: false, state: "WRONG_RECIPIENT", reason: `Expected recipient ${expectedTo}, got ${actualTo}` };
      }
      if (expectedAmount && actualAmount < expectedAmount) {
        return { verified: false, state: "UNDERPAID", reason: `Expected at least ${expectedAmount}, got ${actualAmount}` };
      }

      return {
        verified: true,
        state: "CONFIRMED_ONCHAIN_SETTLEMENT",
        blockNumber: receipt.blockNumber.toString(),
        txHash,
        actualTo,
        actualAmount: actualAmount.toString(),
      };
    } catch (err: any) {
      if (
        err.name === "TransactionReceiptNotFoundError" ||
        err.message?.includes("could not be found") ||
        err.message?.includes("not found")
      ) {
        return { verified: false, state: "NOT_FOUND", reason: "Transaction receipt not found on chain ID 688689" };
      }
      return { verified: false, state: "LOOKUP_FAILED", reason: err.message };
    }
  }

  // HTTP Handlers
  static handleGetSupported(req: Request, res: Response) {
    res.json(PharosFacilitator.getSupported());
  }

  static async handleVerify(req: Request, res: Response) {
    const { paymentPayload, requirements } = req.body || {};
    const result = await PharosFacilitator.verifyPayment(paymentPayload, requirements);
    res.json(result);
  }

  static async handleSettle(req: Request, res: Response) {
    const { paymentPayload, requirements } = req.body || {};
    const result = await PharosFacilitator.settlePayment(paymentPayload, requirements);
    if (!result.success) {
      res.status(400).json(result);
    } else {
      res.json(result);
    }
  }

  static async handleVerifyReceipt(req: Request, res: Response) {
    const txHash = (req.query.txHash || req.body?.txHash || "") as string;
    const result = await PharosFacilitator.verifyOnChainReceipt(txHash);
    res.json(result);
  }
}
