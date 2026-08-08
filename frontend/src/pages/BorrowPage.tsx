import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CircleDollarSign,
  LockKeyhole,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConnectQuietline } from "../components/ConnectQuietline";
import {
  AssetBadge,
  Button,
  EmptyState,
  HealthScale,
  PrivacyLabel,
  ProgressSteps,
  Status,
  useToast,
} from "../components/ui";
import { usePrivateActions, useVaultActions } from "../hooks/usePrivateActions";
import type { PrivateQuote } from "../lib/privateTypes";
import { useQuietline } from "../store/useQuietline";
import { assetSymbol } from "@quietline/protocol";

const steps = ["Collateral", "Request", "Private quote", "Settlement"];
const fxrpSymbol = assetSymbol("FXRP");
const usdt0Symbol = assetSymbol("USDT0");

export function BorrowPage() {
  const mode = useQuietline((state) => state.mode);
  const position = useQuietline((state) => state.position);
  if (mode === "disconnected") {
    return (
      <div className="page">
        <div className="page-heading"><div><span className="page-kicker">Confidential borrowing</span><h1>Borrow</h1></div></div>
        <EmptyState
          icon={LockKeyhole}
          title="Open a private session to request credit"
          body="Your amount, maximum APR, collateral allocation, quote, and matching result are encrypted."
          action={<ConnectQuietline compact />}
        />
      </div>
    );
  }
  if (position) {
    return <ExistingPosition />;
  }
  return <BorrowWorkflow />;
}

function ExistingPosition() {
  const position = useQuietline((state) => state.position)!;
  const navigate = useNavigate();
  const status = positionStatus(position.status);
  return (
    <div className="page">
      <div className="page-heading">
        <div><span className="page-kicker">Confidential borrowing</span><h1>Borrow</h1><p>One active credit line is supported in the hackathon release.</p></div>
      </div>
      <section className="panel existing-position">
        <Status tone={status.tone}>{status.label} credit line</Status>
        <h2>Your {fxrpSymbol} / {usdt0Symbol} position is already open.</h2>
        <p>Inspect private risk, add collateral, or repay before requesting another line.</p>
        <Button onClick={() => navigate("/app/position")}>View position <ArrowRight size={17} /></Button>
      </section>
    </div>
  );
}

function BorrowWorkflow() {
  const [step, setStep] = useState(0);
  const [collateral, setCollateral] = useState("10");
  const [amount, setAmount] = useState("3");
  const [term, setTerm] = useState(14);
  const [maxApr, setMaxApr] = useState("12");
  const [computing, setComputing] = useState(false);
  const [settlementStage, setSettlementStage] = useState(0);
  const [settlementSynchronized, setSettlementSynchronized] = useState(true);
  const [quote, setQuote] = useState<PrivateQuote>();
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const privateFxrp = useQuietline((state) => state.privateFxrp);
  const marketPriceE6 = useQuietline((state) => state.marketPriceE6);
  const vaultUsdt0Balance = useQuietline((state) => state.vaultUsdt0Balance);
  const notifications = useQuietline((state) => state.notifications);
  const { requestQuote: requestLiveQuote } = usePrivateActions();
  const { acceptBorrow } = useVaultActions();
  const navigate = useNavigate();
  const { push } = useToast();
  useEffect(() => {
    if (!quote) return;
    const timer = window.setInterval(
      () => setNowSeconds(Math.floor(Date.now() / 1000)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [quote]);

  const startingLtv = useMemo(() => {
    const collateralValue = Number(collateral) * ((marketPriceE6 ?? 0) / 1_000_000);
    return collateralValue > 0 ? (Number(amount) / collateralValue) * 100 : 0;
  }, [amount, collateral, marketPriceE6]);

  const requestQuote = async () => {
    if (Number(collateral) <= 0 || Number(collateral) > privateFxrp) {
      push({ tone: "error", title: `Collateral exceeds your private ${fxrpSymbol} balance` });
      return;
    }
    if (!marketPriceE6) {
      push({ tone: "error", title: "FTSOv2 price is not available yet" });
      return;
    }
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      push({ tone: "error", title: `Enter a positive ${usdt0Symbol} amount` });
      return;
    }
    if (startingLtv > 50) {
      push({ tone: "error", title: "Starting LTV exceeds the 50% policy limit" });
      return;
    }
    setComputing(true);
    try {
      const result = await requestLiveQuote({
        amount: Number(amount),
        collateral: Number(collateral),
        termDays: term,
        maxApr: Number(maxApr),
      });
      setQuote(result);
      setStep(2);
    } catch (error) {
      push({
        tone: "error",
        title: "Private quote failed",
        body: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setComputing(false);
    }
  };

  const accept = async () => {
    if (!quote) return;
    if (quote.expiresAt <= Math.floor(Date.now() / 1000)) {
      push({ tone: "warning", title: "This private quote has expired" });
      setStep(1);
      setQuote(undefined);
      return;
    }
    setStep(3);
    try {
      const outcome = await acceptBorrow(quote, (stage) => {
        setSettlementStage(
          stage === "signing"
            ? 1
            : stage === "submitting"
              ? 2
              : stage === "computing"
                ? 3
                : 5,
        );
      });
      setSettlementSynchronized(outcome.synchronized);
      setSettlementStage(6);
      if (!outcome.synchronized) {
        push({
          tone: "warning",
          title: "Credit settled; private view needs refresh",
          body: `${quoteAmount.toFixed(2)} ${usdt0Symbol} was delivered. Use Refresh private position to decrypt the updated account; do not accept the quote again.`,
        });
      } else if (notifications.payout) {
        push({
          tone: "success",
          title: "Private credit line active",
          body: `${(quote.amount / 1_000_000).toFixed(2)} ${usdt0Symbol} has been delivered to your wallet.`,
        });
      }
    } catch (error) {
      setStep(2);
      setSettlementStage(0);
      push({
        tone: "error",
        title: "Borrow settlement failed",
        body: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const quoteAmount = (quote?.amount ?? 0) / 1_000_000;
  const requestedQuoteAmount =
    (quote?.requestedAmount ?? quote?.amount ?? 0) / 1_000_000;
  const quoteCollateral = (quote?.collateralFxrp ?? 0) / 1_000_000;
  const quoteApr = (quote?.borrowerAprBps ?? 0) / 100;
  const quotePrice = (quote?.priceE6 ?? 0) / 1_000_000;
  const quoteLtv = quote
    ? (quoteAmount / (quoteCollateral * quotePrice)) * 100
    : 0;
  const quoteInterest =
    quoteAmount * (quoteApr / 100) * ((quote?.termDays ?? 14) / 365);
  const quoteSecondsLeft = quote ? Math.max(0, quote.expiresAt - nowSeconds) : 0;
  const quoteLiquidationPrice =
    quoteCollateral > 0 ? quoteAmount / (quoteCollateral * 0.65) : 0;

  return (
    <div className="page borrow-page">
      <div className="page-heading">
        <div><span className="page-kicker">Confidential borrowing</span><h1>Borrow {usdt0Symbol}</h1><p>Your request is matched against lender mandates inside FCC.</p></div>
        <PrivacyLabel scope="compute" />
      </div>
      <div className="workflow-tabs" aria-label="Borrow progress">
        {steps.map((label, index) => (
          <div className={index === step ? "active" : index < step ? "complete" : ""} key={label}>
            <span>{index < step ? <BadgeCheck size={16} /> : index + 1}</span>{label}
          </div>
        ))}
      </div>
      <section className="borrow-context">
        <div><AssetBadge asset="FXRP" /><span>Private available</span><strong>{privateFxrp.toFixed(4)}</strong></div>
        <div><AssetBadge asset="USDT0" /><span>Public vault</span><strong>{vaultUsdt0Balance === undefined ? "--" : vaultUsdt0Balance.toFixed(4)}</strong></div>
        <div><span>XRP/USD</span><PrivacyLabel scope="public" compact /><strong>{marketPriceE6 ? `$${(marketPriceE6 / 1_000_000).toFixed(4)}` : "--"}</strong></div>
      </section>

      {step === 0 ? (
        <section className="workflow-panel">
          <div className="workflow-panel__main">
            <span className="section-kicker">Step 1</span>
            <h2>Allocate private collateral</h2>
            <p>This selection stays in your browser until the encrypted quote request is signed.</p>
            <label className="field">
              <span>{fxrpSymbol} to allocate</span>
              <div className="amount-input"><input inputMode="decimal" value={collateral} onChange={(event) => setCollateral(event.target.value)} /><strong>{fxrpSymbol}</strong></div>
              <small>{privateFxrp.toFixed(2)} {fxrpSymbol} available privately</small>
            </label>
            <div className="inline-actions">
              <Button variant="secondary" onClick={() => setCollateral(privateFxrp.toString())}>Use all private {fxrpSymbol}</Button>
              <Button onClick={() => setStep(1)}>Continue <ArrowRight size={17} /></Button>
            </div>
          </div>
          <aside className="workflow-aside">
            <div><span>Current XRP/USD</span><strong>{marketPriceE6 ? `$${(marketPriceE6 / 1_000_000).toFixed(4)}` : "Loading"}</strong></div>
            <div><span>Collateral value</span><strong>{marketPriceE6 ? `$${(Number(collateral || 0) * marketPriceE6 / 1_000_000).toFixed(2)}` : "Loading"}</strong></div>
            <div><span>Maximum at 50% LTV</span><strong>{marketPriceE6 ? `${(Number(collateral || 0) * marketPriceE6 / 2_000_000).toFixed(2)} ${usdt0Symbol}` : "Loading"}</strong></div>
            <PrivacyLabel scope="private" />
          </aside>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="workflow-panel">
          <div className="workflow-panel__main">
            <span className="section-kicker">Step 2</span>
            <h2>Set your private request</h2>
            <div className="form-grid">
              <label className="field">
                <span>Borrow amount</span>
                <div className="amount-input"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /><strong>{usdt0Symbol}</strong></div>
              </label>
              <label className="field">
                <span>Maximum borrower APR</span>
                <div className="amount-input"><input inputMode="decimal" value={maxApr} onChange={(event) => setMaxApr(event.target.value)} /><strong>%</strong></div>
              </label>
            </div>
            <fieldset className="field">
              <legend>Fixed term</legend>
              <div className="segmented">
                {[7, 14, 30].map((value) => <button className={term === value ? "active" : ""} onClick={() => setTerm(value)} key={value}>{value} days</button>)}
              </div>
            </fieldset>
            <div className="inline-actions">
              <Button variant="quiet" icon={ArrowLeft} onClick={() => setStep(0)}>Back</Button>
              <Button loading={computing} icon={Sparkles} onClick={() => void requestQuote()}>
                {computing ? "Matching confidential offers" : "Get private quote"}
              </Button>
            </div>
          </div>
          <aside className="workflow-aside">
            <HealthScale value={startingLtv} warning={50} liquidation={65} label="Starting LTV" />
            <div><span>Policy maximum</span><strong>50.0%</strong></div>
            <div><span>Public vault holdings</span><Status tone="info">{vaultUsdt0Balance === undefined ? "Loading" : `${vaultUsdt0Balance.toFixed(4)} ${usdt0Symbol}`}</Status></div>
            <div><span>Lendable balance</span><strong>Evaluated privately</strong></div>
            <div><span>Request privacy</span><strong>Encrypted</strong></div>
            <PrivacyLabel scope="compute" />
          </aside>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="quote-panel">
          <header>
            <div><span className="section-kicker">Private quote</span><h2>{quote?.tranches.length ?? 0} lender mandate{quote?.tranches.length === 1 ? "" : "s"} matched your request.</h2></div>
            <Status tone={quoteSecondsLeft === 0 ? "danger" : quoteSecondsLeft <= 60 ? "warning" : "healthy"}>
              {quoteSecondsLeft === 0 ? "Expired" : `Expires in ${formatCountdown(quoteSecondsLeft)}`}
            </Status>
          </header>
          <div className="quote-primary">
            <span>{quote?.partial ? "Privately matched" : "You receive"}</span>
            <strong>{quoteAmount.toFixed(2)} {usdt0Symbol}</strong>
            <small>
              {quote?.partial
                ? `You requested ${requestedQuoteAmount.toFixed(2)} ${usdt0Symbol}. Accepting settles the matched amount.`
                : "Delivered publicly after settlement"}
            </small>
          </div>
          <HealthScale value={quoteLtv} warning={55} liquidation={65} label="Quoted LTV" />
          <div className="quote-grid">
            <div><span>Collateral allocated</span><strong>{quoteCollateral.toFixed(2)} {fxrpSymbol}</strong></div>
            <div><span>Borrower APR</span><strong>{quoteApr.toFixed(2)}%</strong></div>
            <div><span>Term</span><strong>{quote?.termDays ?? 0} days</strong></div>
            <div><span>Interest at maturity</span><strong>{quoteInterest.toFixed(4)} {usdt0Symbol}</strong></div>
            <div><span>Starting LTV</span><strong>{quoteLtv.toFixed(1)}%</strong></div>
            <div><span>Initial liquidation XRP price</span><strong>${quoteLiquidationPrice.toFixed(4)}</strong></div>
            <div><span>Lender count</span><strong>{quote?.tranches.length ?? 0}</strong></div>
            {quote?.partial ? <div><span>Requested amount</span><strong>{requestedQuoteAmount.toFixed(2)} {usdt0Symbol}</strong></div> : null}
            <div><span>Individual lender rates</span><strong className="private-redacted"><LockKeyhole size={14} /> Not published</strong></div>
          </div>
          <div className="quote-disclosure">
            <PrivacyLabel scope="compute" />
            <p>The quote and lender allocation are encrypted in transit and absent from chain state. Your decrypted quote payload contains the selected tranches. Accepting creates a public request transaction and a public {quoteAmount.toFixed(4)} {usdt0Symbol} payout{quote?.partial ? ` from your ${requestedQuoteAmount.toFixed(4)} ${usdt0Symbol} request` : ""}.</p>
          </div>
          <div className="inline-actions inline-actions--end">
            <Button variant="quiet" onClick={() => setStep(1)}>Edit request</Button>
            <Button icon={CircleDollarSign} disabled={quoteSecondsLeft === 0} onClick={() => void accept()}>Accept and borrow</Button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="settlement-panel">
          <div className="settlement-panel__icon"><WalletCards size={28} /></div>
          <span className="section-kicker">Settlement</span>
          <h2>{settlementStage >= 6 ? "Your private credit line is active." : "Quietline is settling your request."}</h2>
          <p>{settlementStage >= 6
            ? settlementSynchronized
              ? `${quoteAmount.toFixed(2)} ${usdt0Symbol} has arrived in your wallet.`
              : `${quoteAmount.toFixed(2)} ${usdt0Symbol} has arrived. One read-only signature is required to reveal the updated private position.`
            : "You can leave this screen. The relayer will continue from the durable job state."}</p>
          <ProgressSteps
            active={settlementStage}
            steps={[
              "Request on Coston2",
              "Provider authorization",
              "Private matching",
              "Private loan created",
              `${usdt0Symbol} payout signed`,
              `${usdt0Symbol} delivered`,
            ]}
          />
          {settlementStage >= 6 ? (
            <Button onClick={() => navigate(settlementSynchronized ? "/app/position" : "/app")}>
              {settlementSynchronized ? "View position" : "Refresh private position"} <ArrowRight size={17} />
            </Button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function positionStatus(status: NonNullable<ReturnType<typeof useQuietline.getState>["position"]>["status"]): {
  label: string;
  tone: "healthy" | "warning" | "danger" | "neutral";
} {
  if (status === "healthy") return { label: "Healthy", tone: "healthy" };
  if (status === "restricted") return { label: "Restricted", tone: "warning" };
  if (status === "warning") return { label: "Warning", tone: "warning" };
  if (status === "liquidatable") return { label: "Liquidatable", tone: "danger" };
  if (status === "liquidated") return { label: "Liquidated", tone: "danger" };
  return { label: "Closed", tone: "neutral" };
}
