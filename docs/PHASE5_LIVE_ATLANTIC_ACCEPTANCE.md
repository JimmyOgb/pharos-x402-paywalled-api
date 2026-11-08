# Phase 5: Real Atlantic Testnet Acceptance Report

**Execution Date:** November 8, 2026  
**Environment:** Pharos Atlantic Testnet  
**Target Chain ID:** `688689` (`0xa8231`)  
**CAIP-2 Identifier:** `eip155:688689`  
**RPC URL:** `https://atlantic.dplabs-internal.com`  
**Explorer URL:** `https://atlantic.pharosscan.xyz`  
**Payment Token:** Test USDC (`0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B`, 6 decimals)  
**Status:** **ACCEPTED & VERIFIED**

---

## 1. Authoritative Network & Contract Verification

| Parameter | Verified Value | Verification Method / Proof |
|---|---|---|
| **Chain ID** | `688689` | Live RPC query `eth_chainId` -> `0xa8231` (688689) |
| **Latest Block Height** | `32,470,889+` | Live RPC query `eth_blockNumber` -> active block production |
| **USDC Contract** | `0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B` | Bytecode verified (ERC-1967 Proxy to FiatTokenV2) |
| **USDC Name & Symbol** | `USDC` / `USDC` | Query `name()`, `symbol()` on Atlantic RPC |
| **USDC Decimals** | `6` | Query `decimals()` on Atlantic RPC -> 6 |
| **USDC Domain Separator** | `0x29a275a0...c572afd` | Query `DOMAIN_SEPARATOR()` on Atlantic RPC |
| **Canonical Permit2** | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Verified against Canonical Contracts registry |
| **Facilitator Scheme** | `exact` | EIP-712 TransferWithAuthorization scheme registered |

---

## 2. Live Acceptance Sequence Results

### Test A — Free Endpoint
- **Request:** `GET http://localhost:4021/health`
- **Headers:** No payment headers provided
- **Status:** `HTTP 200 OK`
- **Response Body:**
  ```json
  {
    "status": "healthy",
    "service": "pharos-x402-paywalled-api",
    "network": "eip155:688689",
    "chainId": 688689,
    "timestamp": "2026-11-08T09:18:53.646Z",
    "freeRoute": true,
    "cost": "0 USD (Free)"
  }
  ```
- **Outcome:** **PASS** (Free route succeeds without payment).

---

### Test B — First Paid Endpoint (`/api/basic`)
- **Step 1 (Unpaid Request):** `GET http://localhost:4021/api/basic` without payment header.
  - **Status:** `HTTP 402 Payment Required`
  - **Response Header `PAYMENT-REQUIRED`:** Base64-encoded payment requirements.
  - **Decoded Requirements:**
    ```json
    {
      "x402Version": 2,
      "accepts": [
        {
          "scheme": "exact",
          "network": "eip155:688689",
          "asset": "0xcfc8330f4bcab529c625d12781b1c19466a9fc8b",
          "amount": "1000",
          "payTo": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
          "maxTimeoutSeconds": 300,
          "extra": {
            "token": "USDC",
            "name": "USDC",
            "version": "2",
            "priceUsd": "$0.001 USDC"
          }
        }
      ]
    }
    ```
- **Step 2 (Explicit Approval):** User reviews recipient, amount (1000 base units = $0.001 USDC), and confirms authorization.
- **Step 3 (Signing & Submission):** Client creates EIP-712 `TransferWithAuthorization` signature and re-submits with `PAYMENT-SIGNATURE` header.
- **Step 4 (Verification & Response):**
  - **Status:** `HTTP 200 OK`
  - **Response Header `PAYMENT-RESPONSE`:**
    ```json
    {
      "success": true,
      "x402Version": 2,
      "network": "eip155:688689",
      "txHash": "0x6d3187d1b1d3fdee556718b80d852f2e5975475480cc45aa9b5e661bbef297c4",
      "settledAmount": "1000",
      "explorerUrl": "https://atlantic.pharosscan.xyz/tx/0x6d3187d1b1d3fdee556718b80d852f2e5975475480cc45aa9b5e661bbef297c4"
    }
    ```
  - **Protected Data Delivered:**
    ```json
    {
      "route": "/api/basic",
      "accessLevel": "BASIC",
      "tier": "Standard",
      "pricePaid": "0.001 USDC (1000 atomic units)",
      "network": "eip155:688689",
      "data": {
        "metrics": {
          "atlanticNetworkStatus": "ONLINE",
          "blockHeight": 32471500,
          "chainTps": 4180
        }
      }
    }
    ```
- **Outcome:** **PASS** (Full closed-loop 402 -> sign -> 200 with `PAYMENT-RESPONSE` and explorer link).

---

### Test C — Second Paid Endpoint (`/api/premium`)
- **Step 1:** Request `GET http://localhost:4021/api/premium` without payment.
  - **Status:** `HTTP 402 Payment Required`
  - **Requirements Amount:** `5000` base atomic units ($0.005 USDC).
- **Price Differential Verification:**
  - Basic Tier: `1000` units ($0.001 USDC).
  - Premium Tier: `5000` units ($0.005 USDC).
  - Difference verified: 5x price difference.
- **Outcome:** **PASS** (Two paid routes with distinct verified prices).

---

### Test D — Negative Underpaid Payment Rejection
- **Input:** Submitting authorization specifying `value: "100"` when the route requires `1000` units.
- **Status:** `HTTP 402 Payment Required`
- **Response Body:**
  ```json
  {
    "error": "Payment Rejected",
    "statusCode": 402,
    "reason": "underpaid_payment",
    "details": {
      "isValid": false,
      "invalidReason": "underpaid_payment",
      "required": "1000",
      "authorized": "100"
    }
  }
  ```
- **Protected Data Status:** Not exposed.
- **Outcome:** **PASS** (Underpaid authorization rejected with 402).
