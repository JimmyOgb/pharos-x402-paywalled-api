import { config } from "dotenv";
config();

export const CONFIG = {
  PORT: parseInt(process.env.PORT || "4021", 10),
  NODE_ENV: process.env.NODE_ENV || "development",
  
  // Pharos Atlantic Testnet
  NETWORK_ID: process.env.NETWORK_ID || "eip155:688689",
  CHAIN_ID: parseInt(process.env.CHAIN_ID || "688689", 10),
  RPC_URL: process.env.RPC_URL || "https://atlantic.dplabs-internal.com",
  EXPLORER_URL: process.env.EXPLORER_URL || "https://atlantic.pharosscan.xyz",
  
  // Verified Atlantic Testnet USDC
  USDC_ADDRESS: (process.env.USDC_ADDRESS || "0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B").toLowerCase() as `0x${string}`,
  USDC_NAME: process.env.USDC_NAME || "USDC",
  USDC_DECIMALS: 6,
  
  // Canonical Permit2
  PERMIT2_ADDRESS: (process.env.PERMIT2_ADDRESS || "0x000000000022D473030F116dDEE9F6B43aC78BA3").toLowerCase() as `0x${string}`,
  
  // Seller Receiving Address
  PAY_TO_ADDRESS: (process.env.PAY_TO_ADDRESS || "0x70997970C51812dc3A010C7d01b50e0d17dc79C8") as `0x${string}`,
  
  // Pricing: atomic integer units (1 USDC = 1,000,000 base units)
  PRICES: {
    BASIC: {
      usd: "0.001",
      units: "1000",
      description: "Pharos Atlantic Basic Route - Network & System Status"
    },
    PREMIUM: {
      usd: "0.005",
      units: "5000",
      description: "Pharos Atlantic Premium Route - Deep Liquidity & Predictive Intelligence"
    }
  },
  
  // Facilitator Service URL
  FACILITATOR_URL: process.env.FACILITATOR_URL || "http://localhost:4021",
  
  // Private keys - securely loaded from environment variables (Requirement 06)
  FACILITATOR_PRIVATE_KEY: process.env.FACILITATOR_PRIVATE_KEY as `0x${string}` | undefined,
  CLIENT_PRIVATE_KEY: process.env.CLIENT_PRIVATE_KEY as `0x${string}` | undefined,
};
