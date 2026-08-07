import { useState } from "react";
import { useAccount, useConnect, useSignTypedData, useSwitchChain } from "wagmi";
import { WalletCards } from "lucide-react";
import type { Address, Hex } from "viem";
import { COSTON2 } from "@quietline/protocol";
import {
  getChallenge,
  relayerClientConfigured,
  RelayerConfigurationError,
  verifyChallenge,
} from "../lib/api";
import {
  usePrivateActions,
  type PrivateSessionStage,
} from "../hooks/usePrivateActions";
import { useQuietline } from "../store/useQuietline";
import { Button, useToast } from "./ui";

export function ConnectQuietline({ compact = false }: { compact?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<string>();
  const account = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const connectLive = useQuietline((state) => state.connectLive);
  const serviceHealth = useQuietline((state) => state.serviceHealth);
  const { openOrRefresh } = usePrivateActions();
  const { push } = useToast();
  const relayerUnavailable =
    !relayerClientConfigured ||
    serviceHealth?.services.api === "unavailable";

  const connect = async () => {
    if (relayerUnavailable) {
      push({
        tone: "warning",
        title: "Live service unavailable",
        body: !relayerClientConfigured
          ? "This deployment is missing its public relayer URL."
          : "The Quietline relayer is offline. Wallet access was not requested.",
      });
      return;
    }
    const connector = connectors[0];
    const provider = !account.isConnected && connector
      ? await connector.getProvider().catch(() => undefined)
      : undefined;
    if (!account.isConnected && (!connector || !provider)) {
      push({
        tone: "error",
        title: "No browser wallet found",
        body: "Install or unlock MetaMask or Rabby, then refresh this page.",
      });
      return;
    }
    setLoading(true);
    try {
      setStep(account.isConnected ? "Using connected wallet" : "Requesting wallet access");
      const connection = account.isConnected && account.address
        ? { accounts: [account.address], chainId: account.chainId }
        : await connectAsync({ connector: connector! });
      if (connection.chainId !== COSTON2.id) {
        setStep("Switching wallet to Coston2");
        await switchChainAsync({ chainId: COSTON2.id });
      }
      const address = connection.accounts[0] as Address;
      setStep("Sign the 30-minute session challenge");
      const challenge = await getChallenge(address);
      const signature = await signTypedDataAsync({
        domain: challenge.typedData.domain as never,
        types: challenge.typedData.types as never,
        primaryType: challenge.typedData.primaryType,
        message: {
          ...challenge.typedData.message,
          issuedAt: BigInt(challenge.issuedAt),
          expiresAt: BigInt(challenge.expiresAt),
        },
      } as never);
      const session = await verifyChallenge({
        address,
        nonce: challenge.nonce,
        issuedAt: challenge.issuedAt,
        expiresAt: challenge.expiresAt,
        signature: signature as Hex,
      });
      connectLive(address, session.token, Date.now() + session.expiresIn * 1000);
      await openOrRefresh(address, session.token, (stage) =>
        setStep(privateSessionStep(stage)),
      );
      push({
        tone: "success",
        title: "Private session opened",
        body: "Financial requests are now encrypted to the active FCC environment.",
      });
    } catch (error) {
      push({
        tone: "error",
        title: "Could not open a live session",
        body: connectionErrorMessage(error),
      });
    } finally {
      setLoading(false);
      setStep(undefined);
    }
  };

  return (
    <div className={compact ? "connect-actions connect-actions--compact" : "connect-actions"}>
      <Button
        icon={WalletCards}
        loading={loading}
        disabled={relayerUnavailable}
        onClick={() => void connect()}
      >
        {relayerUnavailable
          ? "Live service unavailable"
          : loading
            ? step ?? "Opening private session"
            : "Connect Coston2 wallet"}
      </Button>
      {loading && step ? (
        <small className="connect-actions__notice" aria-live="polite">
          {step}. MetaMask signatures authorize Quietline actions; they do not move tokens.
        </small>
      ) : null}
      {relayerUnavailable && !compact ? (
        <small className="connect-actions__notice">
          Wallet connection opens when the relayer and FCC path are online.
        </small>
      ) : null}
    </div>
  );
}

function privateSessionStep(stage: PrivateSessionStage) {
  if (stage === "checking-account") return "Sign to decrypt your private account";
  if (stage === "creating-account") return "Sign to create your private account";
  return "Sign once more to decrypt the new account";
}

function connectionErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "Check your wallet and relayer connection.";
  }
  if (/user rejected|user denied|rejected the request/iu.test(error.message)) {
    return "The wallet request was rejected. Try again when you are ready to sign in.";
  }
  if (/provider not found/iu.test(error.message)) {
    return "Install or unlock MetaMask or Rabby, then refresh this page.";
  }
  if (error instanceof RelayerConfigurationError) {
    return error.message;
  }
  return error.message.replace(/\s+Version:.*$/isu, "").trim();
}
