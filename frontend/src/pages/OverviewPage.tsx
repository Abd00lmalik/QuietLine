import {
  ArrowRight,
  Bell,
  Coins,
  HandCoins,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldAlert,
  WalletCards,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatUnits, type Address } from "viem";
import { useReadContract } from "wagmi";
import { ASSETS, COSTON2, POLICY, assetSymbol } from "@quietline/protocol";
import { ConnectQuietline } from "../components/ConnectQuietline";
import {
  AssetBadge,
  Button,
  EmptyState,
  HealthScale,
  IconButton,
  Metric,
  Modal,
  PrivacyLabel,
  Status,
  useToast,
} from "../components/ui";
import { usePrivateActions, useVaultActions } from "../hooks/usePrivateActions";
import { useQuietline, type Position } from "../store/useQuietline";
import { erc20Abi } from "../web3/abis";

const fxrpSymbol = assetSymbol("FXRP");
const usdt0Symbol = assetSymbol("USDT0");

export function OverviewPage() {
  const mode = useQuietline((state) => state.mode);
  if (mode === "disconnected") return <DisconnectedOverview />;
  return <ConnectedOverview />;
}

function DisconnectedOverview() {
  const marketPriceE6 = useQuietline((state) => state.marketPriceE6);
  const marketUpdatedAt = useQuietline((state) => state.marketUpdatedAt);
  const vaultUsdt0Balance = useQuietline((state) => state.vaultUsdt0Balance);
  const marketStatus = useQuietline((state) => state.marketStatus);
  const price = marketPriceE6
    ? `$${(marketPriceE6 / 1_000_000).toFixed(4)}`
    : marketStatus === "unavailable"
      ? "Unavailable"
      : "Loading";
  const age = marketUpdatedAt
    ? `${Math.max(0, Math.floor(Date.now() / 1000 - marketUpdatedAt))}s old`
    : marketStatus === "unavailable"
      ? "Relayer unavailable"
      : "Waiting for oracle";
  const vaultHoldings = vaultUsdt0Balance === undefined
    ? marketStatus === "unavailable" ? "Unavailable" : "Loading"
    : `${vaultUsdt0Balance.toFixed(4)} ${usdt0Symbol}`;
  return (
    <div className="page page--overview">
      <section className="disconnected-hero">
        <div>
          <PrivacyLabel scope="compute" />
          <h1>Private {fxrpSymbol} credit on Flare.</h1>
          <p>
            Deposit {fxrpSymbol} and borrow {usdt0Symbol} through lender terms that are evaluated
            inside Flare Confidential Compute.
          </p>
          <ConnectQuietline />
        </div>
        <div className="market-snapshot">
          <div className="snapshot-scope"><PrivacyLabel scope="public" compact /></div>
          <Metric label="Vault holdings" value={vaultHoldings} detail="Public QuietVault token balance" />
          <Metric label="XRP/USD" value={price} detail={`FTSOv2 / ${age}`} />
          <Metric label="Initial LTV" value={`${POLICY.initialLtvBps / 100}%`} detail={`Liquidation begins at ${POLICY.liquidationLtvBps / 100}%`} />
          <Metric label="Terms" value={POLICY.termsDays.join(" / ")} detail="Fixed-day credit lines" />
        </div>
      </section>
      <section className="locked-grid">
        {["Private collateral", "Private debt", "Health", "Accrued interest"].map((label) => (
          <div className="locked-panel" key={label}>
            <LockKeyhole size={18} />
            <span>{label}</span>
            <strong>Connect to decrypt</strong>
          </div>
        ))}
      </section>
    </div>
  );
}

function ConnectedOverview() {
  const [depositOpen, setDepositOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const position = useQuietline((state) => state.position);
  const privateFxrp = useQuietline((state) => state.privateFxrp);
  const privateUsdt0 = useQuietline((state) => state.privateUsdt0);
  const activities = useQuietline((state) => state.activities);
  const marketPriceE6 = useQuietline((state) => state.marketPriceE6);
  const marketUpdatedAt = useQuietline((state) => state.marketUpdatedAt);
  const vaultUsdt0Balance = useQuietline((state) => state.vaultUsdt0Balance);
  const marketPrice = (marketPriceE6 ?? 0) / 1_000_000;
  const positionTone = position ? statusTone(position.status) : "neutral";
  const positionLabel = position ? statusLabel(position.status) : "";
  const navigate = useNavigate();
  const mode = useQuietline((state) => state.mode);
  const { refreshAccount } = usePrivateActions();
  const { push } = useToast();
  const refresh = async () => {
    if (mode !== "live") {
      push({ tone: "info", title: "Connect a Coston2 wallet to refresh" });
      return;
    }
    setRefreshing(true);
    try {
      await refreshAccount();
      push({ tone: "success", title: "Private account refreshed" });
    } catch (error) {
      push({
        tone: "error",
        title: "Private refresh failed",
        body: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="page-kicker">Private portfolio</span>
          <h1>Overview</h1>
          <p>Your decrypted account view exists only in this browser session.</p>
        </div>
        <div className="page-heading__actions">
          <IconButton
            icon={RefreshCw}
            label="Refresh private account"
            disabled={refreshing}
            onClick={() => void refresh()}
          />
          <Button icon={Plus} onClick={() => setDepositOpen(true)}>Deposit</Button>
        </div>
      </div>

      <section className="portfolio-strip">
        <article>
          <div className="card-label"><Coins size={16} /> Collateral <PrivacyLabel scope="private" compact /></div>
          <strong>{position ? `${position.collateral.toFixed(2)} ${fxrpSymbol}` : `0.00 ${fxrpSymbol}`}</strong>
          <span>{position && marketPriceE6 ? `$${(position.collateral * marketPrice).toFixed(2)} allocated` : "No allocated collateral"}</span>
          <button onClick={() => setDepositOpen(true)}>Add collateral <ArrowRight size={15} /></button>
        </article>
        <article>
          <div className="card-label"><HandCoins size={16} /> Debt <PrivacyLabel scope="private" compact /></div>
          <strong>
            {position
              ? `${(position.principal + position.accruedInterest).toFixed(4)} ${usdt0Symbol}`
              : `0.00 ${usdt0Symbol}`}
          </strong>
          <span>{position ? `${position.apr.toFixed(2)}% APR · ${position.maturity}` : "No active credit line"}</span>
          <button onClick={() => navigate(position ? "/app/position" : "/app/borrow")}>
            {position ? "Repay or inspect" : "Request a private quote"} <ArrowRight size={15} />
          </button>
        </article>
        <article>
          <div className="card-label"><ShieldAlert size={16} /> Health <PrivacyLabel scope="compute" compact /></div>
          <strong>{position ? position.healthFactor.toFixed(2) : "--"}</strong>
          <span>{position ? `${position.ltv.toFixed(1)}% LTV` : "No position to monitor"}</span>
          <button onClick={() => navigate(position ? "/app/position" : "/app/borrow")}>
            View risk <ArrowRight size={15} />
          </button>
        </article>
        <article>
          <div className="card-label"><WalletCards size={16} /> Balance <PrivacyLabel scope="private" compact /></div>
          <strong>{privateUsdt0.toFixed(2)} {usdt0Symbol}</strong>
          <span>{privateFxrp.toFixed(2)} {fxrpSymbol} available</span>
          <button onClick={() => setDepositOpen(true)}>Deposit or withdraw <ArrowRight size={15} /></button>
        </article>
      </section>

      <div className="overview-grid">
        <section className="panel position-panel">
          <header className="panel__header">
            <div><span>Credit positions</span><h2>Private position</h2></div>
            <PrivacyLabel scope="private" />
            {position ? <Status tone={positionTone}>{positionLabel}</Status> : null}
          </header>
          {position ? (
            <>
              <button className="position-row" onClick={() => navigate("/app/position")}>
                <div><strong>{fxrpSymbol} / {usdt0Symbol}</strong><span>Fixed term credit line</span></div>
                <span>{position.collateral.toFixed(2)} {fxrpSymbol}</span>
                <span>{position.principal.toFixed(4)} {usdt0Symbol}</span>
                <span>{position.apr.toFixed(2)}%</span>
                <Status tone={positionTone}>{positionLabel}</Status>
                <ArrowRight size={17} />
              </button>
              <div className="position-row-risk">
                <HealthScale value={position.ltv} />
              </div>
            </>
          ) : (
            <EmptyState
              icon={HandCoins}
              title="No active credit line"
              body={`Request a confidential quote against your available ${fxrpSymbol}.`}
              action={<Button onClick={() => navigate("/app/borrow")}>Request a private quote</Button>}
            />
          )}
        </section>

        <section className="panel market-panel">
          <header className="panel__header"><div><span>Market context</span><h2>Public signals</h2></div><PrivacyLabel scope="public" /></header>
          <div className="market-list">
            <div><span>Vault {usdt0Symbol} holdings</span><strong>{vaultUsdt0Balance === undefined ? "Loading" : `${vaultUsdt0Balance.toFixed(4)} ${usdt0Symbol}`}</strong></div>
            <div><span>Initial / liquidation LTV</span><strong>{POLICY.initialLtvBps / 100}% / {POLICY.liquidationLtvBps / 100}%</strong></div>
            <div><span>XRP/USD</span><strong>{marketPriceE6 ? `$${(marketPriceE6 / 1_000_000).toFixed(4)}` : "Loading"}</strong></div>
            <div><span>Oracle age</span><strong>{marketUpdatedAt ? `${Math.max(0, Math.floor(Date.now() / 1000 - marketUpdatedAt))} sec` : "Loading"}</strong></div>
            <div><span>Risk monitoring</span><strong>Automated keeper</strong></div>
          </div>
        </section>

        <section className="panel notifications-panel">
          <header className="panel__header"><div><span>Account timeline</span><h2>Recent events</h2></div><PrivacyLabel scope="private" /></header>
          <div className="notification-list">
            {activities.length ? activities.slice(0, 5).map((item) => (
              <div key={item.id}>
                <span className={`notification-mark notification-mark--${item.status}`} />
                <div><strong>{item.label}</strong><span>{item.detail}</span></div>
                <time>{item.timestamp}</time>
              </div>
            )) : <div className="notification-empty"><Bell size={18} /><span>No account events yet.</span></div>}
          </div>
        </section>
      </div>
      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
    </div>
  );
}

export function DepositModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [operation, setOperation] = useState<"deposit" | "withdraw">("deposit");
  const [asset, setAsset] = useState<"FXRP" | "USDT0">("FXRP");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<"idle" | "approving" | "depositing" | "submitting" | "confirming">("idle");
  const address = useQuietline((state) => state.address);
  const privateFxrp = useQuietline((state) => state.privateFxrp);
  const privateUsdt0 = useQuietline((state) => state.privateUsdt0);
  const notifications = useQuietline((state) => state.notifications);
  const { deposit: depositLive, withdraw: withdrawLive } = useVaultActions();
  const { push } = useToast();
  const available = asset === "FXRP" ? privateFxrp : privateUsdt0;
  const walletBalanceQuery = useReadContract({
    address: ASSETS[asset].address as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: COSTON2.id,
    query: { enabled: Boolean(address) },
  });
  const walletBalance = walletBalanceQuery.data === undefined
    ? undefined
    : Number(formatUnits(walletBalanceQuery.data, ASSETS[asset].decimals));
  const symbol = assetSymbol(asset);
  const submit = async () => {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      push({ tone: "error", title: "Enter a positive amount" });
      return;
    }
    try {
      if (operation === "withdraw") {
        if (!address) {
          push({ tone: "error", title: "Reconnect your wallet before withdrawing" });
          return;
        }
        if (numeric > available) {
          push({ tone: "error", title: "Amount exceeds private balance" });
          return;
        }
        await withdrawLive(asset, numeric, address, (next) => setStage(next));
      } else {
        if (walletBalance === undefined) {
          push({ tone: "error", title: "Wallet balance is still loading" });
          return;
        }
        if (numeric > walletBalance) {
          push({ tone: "error", title: "Amount exceeds wallet balance" });
          return;
        }
        await depositLive(asset, numeric, setStage);
      }
      await walletBalanceQuery.refetch();
      if (
        (operation === "deposit" && notifications.deposit) ||
        (operation === "withdraw" && notifications.payout)
      ) {
        push({
          tone: "success",
          title: `${symbol} ${operation === "deposit" ? "deposit credited" : "withdrawal complete"}`,
          body:
            operation === "deposit"
              ? "The vault transfer and confidential credit are confirmed."
              : "The private balance was authorized and the public payout is confirmed.",
        });
      }
      onClose();
    } catch (error) {
      push({
        tone: "error",
        title: `${symbol} ${operation} failed`,
        body: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setStage("idle");
    }
  };
  return (
    <Modal
      open={open}
      onClose={stage === "idle" ? onClose : () => undefined}
      title={operation === "deposit" ? "Move funds into QuietVault" : "Withdraw from QuietVault"}
      description={operation === "deposit" ? "The token transfer is public. Internal use of the funds remains confidential." : "The destination and payout amount are public. Private authorization happens inside FCC."}
    >
      <div className="segmented" role="group" aria-label="Funds operation">
        <button className={operation === "deposit" ? "active" : ""} onClick={() => setOperation("deposit")}>Deposit</button>
        <button className={operation === "withdraw" ? "active" : ""} onClick={() => setOperation("withdraw")}>Withdraw</button>
      </div>
      <div className="segmented" role="group" aria-label="Deposit asset">
        {(["FXRP", "USDT0"] as const).map((value) => (
          <button className={asset === value ? "active" : ""} onClick={() => setAsset(value)} key={value}>
            <AssetBadge asset={value} />
          </button>
        ))}
      </div>
      <label className="field">
        <span>Amount</span>
        <div className="amount-input"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /><strong>{symbol}</strong></div>
        <small>{operation === "deposit" ? `Wallet balance: ${walletBalance === undefined ? "Loading" : `${walletBalance.toFixed(4)} ${symbol}`}` : `Private balance: ${available.toFixed(4)} ${symbol}`}</small>
      </label>
      <div className="quick-values">
        {["25%", "50%", "Max"].map((value) => {
          const source = operation === "withdraw" ? available : walletBalance;
          const ratio = value === "25%" ? 0.25 : value === "50%" ? 0.5 : 1;
          return <button key={value} disabled={source === undefined} onClick={() => setAmount(((source ?? 0) * ratio).toFixed(4))}>{value}</button>;
        })}
      </div>
      <div className="privacy-notice"><PrivacyLabel scope="public" /><p><strong>{operation === "deposit" ? "Public deposit." : "Public payout."}</strong> Your address, asset, amount, and timing are visible on Coston2.</p></div>
      <div className="modal__footer">
        <Button variant="quiet" onClick={onClose} disabled={stage !== "idle"}>Cancel</Button>
        <Button loading={stage !== "idle"} onClick={() => void submit()}>
          {stage === "approving"
            ? "Waiting for approval"
            : stage === "depositing"
              ? "Submitting vault deposit"
              : stage === "confirming"
                ? operation === "deposit"
                  ? "Vault confirmed; waiting for FCC"
                  : "Confirming settlement"
                : stage === "submitting"
                  ? "Submitting withdrawal request"
                  : operation === "deposit"
                    ? `Approve and deposit ${symbol}`
                    : `Withdraw ${symbol}`}
        </Button>
      </div>
      {stage === "confirming" && operation === "deposit" ? (
        <p className="modal-progress-note" role="status">
          Your token transfer is confirmed on Coston2. Keep this window open while
          Quietline verifies the confidential ledger credit. Do not submit a second
          deposit.
        </p>
      ) : null}
    </Modal>
  );
}

function statusTone(status: Position["status"]): "healthy" | "warning" | "danger" | "neutral" {
  if (status === "healthy") return "healthy";
  if (status === "liquidatable" || status === "liquidated") return "danger";
  if (status === "restricted" || status === "warning") return "warning";
  return "neutral";
}

function statusLabel(status: Position["status"]) {
  if (status === "restricted") return "Restricted";
  if (status === "liquidatable") return "Liquidatable";
  if (status === "liquidated") return "Liquidated";
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}
