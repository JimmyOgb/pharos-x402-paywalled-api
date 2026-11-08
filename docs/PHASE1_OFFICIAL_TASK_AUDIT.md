# Phase 1: Official Task Audit — x402 Paywalled API

**Task Source:** [Pharos Agent Arena — x402 Paywalled API](https://pharos-agent-arena.vercel.app/tasks/x402-paywalled-api)  
**Date Audited:** November 8, 2026  
**Status:** COMPLETE & VERIFIED

---

## 1. Official Task Overview

- **Task Title:** x402 Paywalled API
- **Difficulty:** Medium
- **Category:** Payments
- **Base Points:** 100
- **Video Bonus Points:** +50 (Total Available: 150 points)
- **Primary Platform:** [ai.pharos.xyz](https://ai.pharos.xyz/)
- **Summary:** Build an API that charges per request with x402 on Pharos Atlantic Testnet. It includes a paid endpoint that answers 402 Payment Required, a facilitator that verifies and settles payments, and a client that pays and gets the data.

---

## 2. Exact Requirements & Scoring Criteria

| # | Requirement | Specific Verification Criteria |
|---|-------------|--------------------------------|
| **01** | **Runs on Atlantic Testnet (`eip155:688689`), priced in test USDC.** | Chain ID `688689`, CAIP-2 `eip155:688689`. Payment asset must be verified Atlantic Testnet USDC (`0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B`, 6 decimals). |
| **02** | **Has at least 2 paid routes at different prices and 1 free route, such as `/health`.** | - Free route: `/health` (HTTP 200 without payment).<br>- Paid Route A: `/api/basic` (e.g. 0.001 USDC / 1000 base units).<br>- Paid Route B: `/api/premium` (e.g. 0.005 USDC / 5000 base units).<br>Both prices must differ and be documented in exact decimal units. |
| **03** | **Runs its own facilitator with `/verify`, `/settle` and `/supported`.** | Must host and execute an independent facilitator implementing all 3 endpoints. Verification must validate requirements, and `/settle` must execute on-chain settlement, returning a real transaction hash. Mock or hardcoded successful responses are prohibited. |
| **04** | **Shows the full flow in the demo: a 402, then a signed payment, then a 200 with a `PAYMENT-RESPONSE` header and its tx hash, linked on the explorer.** | Complete closed-loop workflow: initial request returns 402 Payment Required -> client signs payment authorization with explicit approval -> request re-sent with payment header -> facilitator verifies & settles on-chain -> server returns HTTP 200 with `PAYMENT-RESPONSE` header and verified explorer link. |
| **05** | **Rejects a bad or underpaid payment with another 402.** | Negative tests must verify that invalid signatures, wrong network, wrong token, wrong recipient, or insufficient/underpaid amounts are rejected with HTTP 402 and protected content is not leaked. |
| **06** | **Keeps private keys in env vars or a file, never in code or prompts.** | Strict zero-exposure policy: `.env` and secret files excluded via `.gitignore`, clean `.env.example`, no hardcoded secrets in source files, git commits, or logs. |

---

## 3. Required Deliverables & Accepted Proof Links

1. **Proof Link:**
   - Reviewers must be able to open a deployed demo (e.g. Vercel deployment URL) or an explorer transaction hash.
2. **Repository Link:**
   - Public GitHub repository: `JimmyOgb/pharos-x402-paywalled-api`.
3. **Walkthrough Video:**
   - Optional +50 bonus points for video demonstrating the live build and full payment lifecycle.

---

## 4. Existing Workspace Protection Check

- **Current Workspaces Audited:**
  - `skills/pharos-invoice-to-payment-agent` (UNTOUCHED)
  - `skills/pharos-natural-language-payment-agent` (UNTOUCHED)
  - `skills/pharos-recurring-payment-agent` (UNTOUCHED)
  - `skills/pharos-liquidation-watchdog` (UNTOUCHED)
  - All other existing skill directories remain isolated and unmodified.
- **New Project Workspace:** `C:\Users\NO GO NO\pharosbuild\skills\pharos-x402-paywalled-api` is dedicated solely to this task.
