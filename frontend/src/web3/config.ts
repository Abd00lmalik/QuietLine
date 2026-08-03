import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { COSTON2 } from "@quietline/protocol";

export const coston2 = {
  id: COSTON2.id,
  name: COSTON2.name,
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: {
    default: { http: [COSTON2.rpcUrl] },
  },
  blockExplorers: {
    default: { name: "Coston2 Explorer", url: COSTON2.explorerUrl },
  },
  testnet: true,
} as const;

export const wagmiConfig = createConfig({
  chains: [coston2],
  connectors: [injected({ shimDisconnect: true })],
  transports: { [coston2.id]: http(COSTON2.rpcUrl) },
});
