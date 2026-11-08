# Phase 1: Official Pharos x402 Skill & Network Audit

**Date Audited:** November 8, 2026  
**Status:** COMPLETE & VERIFIED

---

## 1. Official Skill Reference

- **Skill Name:** `x402-pharos`
- **Official Repository:** `https://github.com/PharosNetwork/examples/tree/main/skills/x402-pharos`
- **Metadata Author:** antdigital
- **Version:** `1.0.0`
- **Underlying Standards:** Coinbase x402 open standard for HTTP-native payments adapted for Pharos EVM.

---

## 2. Pharos Atlantic Testnet Specification

From official Pharos Documentation ([Token Registry](https://docs.pharos.xyz/getting-started/token-registry), [Canonical Contracts](https://docs.pharos.xyz/getting-started/canonical-contracts), [x402 Atlantic Testnet Guide](https://docs.pharos.xyz/developer-guide/x402/x402-atlantic-testnet)):

| Parameter | Authoritative Value | Source |
|---|---|---|
| **Network Name** | Pharos Atlantic Testnet | Pharos Docs |
| **Chain ID** | `688689` | Pharos Docs |
| **CAIP-2 Identifier** | `eip155:688689` | x402 Specification |
| **RPC URL** | `https://atlantic.dplabs-internal.com` / `https://rpc.atlantic.pharos.xyz` | Official Docs |
| **Explorer URL** | `https://atlantic.pharosscan.com` | Official Docs |
| **USDC Contract Address** | `0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B` | Official Token Registry |
| **USDC Decimals** | `6` (1 USDC = 1,000,000 units) | Official Token Registry |
| **Permit2 Contract** | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Canonical Contracts |

---

## 3. Official Packages & Runtime Architecture

From npm registry check and official skill examples:
- `@x402/core` (`v2.30.0`): Core payment abstractions, client, facilitator, resource server.
- `@x402/express` (`v2.30.0`): Express middleware for 402 negotiation and header parsing.
- `@x402/evm` (`v2.30.0`): Exact EVM payment scheme implementations (client, server, facilitator).
- `@x402/fetch` (`v2.30.0`): Fetch client wrapper supporting automatic 402 challenge resolution.
- `viem` (`^2.x`): EVM interaction, account creation, wallet signing.
- `express` (`^4.18.2`): HTTP API & facilitator routing.

---

## 4. Facilitator Specification

The Facilitator acts as the settlement gateway:
- **`POST /verify`**:
  - Request: `{ paymentPayload, requirements }`
  - Validates scheme (`exact`), chain ID (`eip155:688689`), recipient address (`payTo`), asset address (`0xcfC8...`), amount, expiration, and cryptographic signature.
  - Returns verification result: `{ isValid: boolean, invalidReason?: string }`.
- **`POST /settle`**:
  - Request: `{ paymentPayload, requirements }`
  - Submits the on-chain settlement transaction using the facilitator EVM signer.
  - Awaits receipt confirmation.
  - Returns `{ success: boolean, txHash: string, network: "eip155:688689" }`.
- **`GET /supported`**:
  - Returns array of supported schemes and networks:
    ```json
    {
      "schemes": ["exact"],
      "networks": ["eip155:688689"]
    }
    ```

---

## 5. Implementation Recommendation

1. **Leverage Official `@x402/*` packages**: Use the tested `@x402/core`, `@x402/express`, `@x402/evm`, `@x402/fetch` ecosystem rather than re-inventing HTTP payment header parsing.
2. **Unified or Serverless Architecture**:
   - The paid API server and facilitator can be cleanly implemented as an Express application that serves both the paywalled routes (`/health`, `/api/basic`, `/api/premium`) and facilitator endpoints (`/verify`, `/settle`, `/supported`).
   - For Vercel deployment, export the Express app via serverless handler or Next.js/Vercel serverless function format so both the API and facilitator run seamlessly without external servers.
3. **Dual Client Implementations**:
   - Provide an automated CLI client (`client.ts`) for developer scripting and integration testing.
   - Provide an interactive web UI (`public/index.html`) demonstrating:
     1. Free `/health` check.
     2. Protected endpoint returning 402 with full requirements breakdown.
     3. User approval button before signing.
     4. Real settlement with `PAYMENT-RESPONSE` and direct link to Pharos Atlantic Explorer.
     5. Negative test button demonstrating rejection of underpaid/invalid payments.
