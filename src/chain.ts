import { defineChain } from "viem";
import { CONFIG } from "./config.js";

export const pharosAtlanticTestnet = defineChain({
  id: CONFIG.CHAIN_ID,
  name: "Pharos Atlantic Testnet",
  nativeCurrency: {
    name: "Pharos Native Token",
    symbol: "PROS",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [CONFIG.RPC_URL],
    },
    public: {
      http: [CONFIG.RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: "Pharos Atlantic Explorer",
      url: CONFIG.EXPLORER_URL,
    },
  },
  testnet: true,
});
