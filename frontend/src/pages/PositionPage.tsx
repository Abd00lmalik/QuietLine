import {
  AlertTriangle,
  ArrowLeft,
  Download,
  LockKeyhole,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
import { usePrivateActions } from "../hooks/usePrivateActions";
import { downloadPrivateStatement } from "../lib/statement";
import { useQuietline, type Position } from "../store/useQuietline";
import { DepositModal } from "./OverviewPage";

export function PositionPage() {
  const position = useQuietline((state) => state.position);
  const mode = useQuietline((state) => state.mode);
  const navigate = useNavigate();
  if (mode === "disconnected" || !position) {
    return (
      <div className="page">
        <div className="page-heading"><div><span className="page-kicker">Private position</span><h1>Position</h1></div></div>
        <EmptyState title="No active position" body="Open a private FXRP credit line to inspect risk and interest here." action={<Button onClick={() => navigate("/app/borrow")}>Go to Borrow</Button>} />
      </div>
    );
  }
  return <ActivePosition />;
}

function ActivePosition() {
  const position = useQuietline((state) => state.position)!;
  const [repayOpen, setRepayOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [stress, setStress] = useState(20);
  const [stressResult, setStressResult] = useState<{ ltv: number; status: string }>();
  const [stressLoading, setStressLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const marketPriceE6 = useQuietline((state) => state.marketPriceE6);
  const marketUpdatedAt = useQuietline((state) => state.marketUpdatedAt);
  const privateUpdatedAt = useQuietline((state) => state.privateUpdatedAt);
  const { refreshAccount, stress: runPrivateStress } = usePrivateActions();
  const { push } = useToast();
  const debt = position.principal + position.accruedInterest;
  const navigate = useNavigate();
  const currentStatus = statusPresentation(position.status);

  const interestPerDay = (position.principal * position.apr) / 100 / 365;
  const projected = position.principal + interestPerDay * position.termDays;
  const lenderWeightedApr = position.principal > 0
    ? position.tranches.reduce(
        (total, tranche) => total + (tranche.principal / 1_000_000) * tranche.aprBps,
        0,
      ) / position.principal / 100
    : 0;
  const lenderAccrued = position.apr > 0
    ? position.accruedInterest * lenderWeightedApr / position.apr
    : 0;
  const protocolAccrued = Math.max(0, position.accruedInterest - lenderAccrued);
  const marketPrice = (marketPriceE6 ?? 0) / 1_000_000;
  const stressPrice = marketPrice * (1 - stress / 100);
  const priceData = marketPriceE6 && marketUpdatedAt
    ? [{
        time: new Date(marketUpdatedAt * 1000).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        price: marketPrice,
      }]
    : [];
  const chartPrices = [marketPrice, position.warningPrice, position.liquidationPrice]
    .filter((value) => value > 0);
  const chartDomain: [number, number] = chartPrices.length
    ? [
        Math.min(...chartPrices) * 0.9,
        Math.max(...chartPrices) * 1.1,
      ]
    : [0, 1];
  const runStress = async () => {
    setStressLoading(true);
    try {
      if (!marketPriceE6) throw new Error("FTSOv2 price is not available yet");
      const result = await runPrivateStress(stressPrice);
      setStressResult({
        ltv: result.ltvBps / 100,
        status: titleCase(result.status),
      });
    } catch (error) {
      push({
        tone: "error",
        title: "Stress check failed",
        body: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setStressLoading(false);
    }
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshAccount();
      push({ tone: "success", title: "Private position refreshed" });
    } catch (error) {
      push({
        tone: "error",
        title: "Position refresh failed",
        body: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <div className="page">
      <div className="position-heading">
        <div>
          <Link to="/app"><ArrowLeft size={16} /> Overview</Link>
          <div className="position-heading__title"><AssetBadge asset="FXRP" /><span>/</span><AssetBadge asset="USDT0" /><Status tone={currentStatus.tone}>{currentStatus.label}</Status></div>
          <span>{privateUpdatedAt ? `Private state decrypted at ${new Date(privateUpdatedAt).toLocaleTimeString()}` : "Private state timestamp unavailable"}</span>
        </div>
        <div>
          <IconButton
            icon={RefreshCw}
            label="Refresh private position"
            disabled={refreshing}
            onClick={() => void refresh()}
          />
          <Button variant="secondary" icon={Plus} onClick={() => setDepositOpen(true)}>Add collateral</Button>
          <Button onClick={() => setRepayOpen(true)}>Repay</Button>
        </div>
      </div>

      <section className="position-summary">
        <Metric label="Total debt" value={`${debt.toFixed(4)} USDT0`} privateValue />
        <Metric label="Borrower APR" value={`${position.apr.toFixed(2)}%`} detail={`${position.tranches.length} private lender ${position.tranches.length === 1 ? "tranche" : "tranches"}`} privateValue />
        <Metric label="Maturity" value={timeUntil(position.maturesAt)} detail={position.maturity} privateValue />
        <Metric label="Collateral value" value={marketPriceE6 ? `$${(position.collateral * marketPrice).toFixed(2)}` : "Loading"} detail={`${position.collateral.toFixed(2)} FXRP`} privateValue />
        <Metric label="LTV" value={`${position.ltv.toFixed(1)}%`} detail="Warning at 55%" privateValue />
        <Metric label="Health factor" value={position.healthFactor.toFixed(2)} detail="Liquidation at 1.00" privateValue />
      </section>
      <section className="position-health">
        <div>
          <span className="section-kicker">Confidential risk state</span>
          <h2>Distance to liquidation</h2>
        </div>
        <PrivacyLabel scope="compute" />
        <HealthScale value={position.ltv} />
      </section>

      <div className="position-layout">
        <section className="panel risk-chart-panel">
          <header className="panel__header"><div><span>Public price, private thresholds</span><h2>XRP risk range</h2></div><PrivacyLabel scope="compute" /><Status tone={currentStatus.tone}>{currentStatus.label}</Status></header>
          <div className="chart-wrap" role="img" aria-label="Current FTSOv2 XRP price with private warning and liquidation thresholds">
            <ResponsiveContainer width="100%" height={310}>
              <LineChart data={priceData} margin={{ top: 14, right: 18, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="#e4e7e5" vertical={false} />
                <XAxis dataKey="time" tickLine={false} axisLine={false} />
                <YAxis domain={chartDomain} tickFormatter={(value) => `$${Number(value).toFixed(2)}`} tickLine={false} axisLine={false} width={52} />
                <Tooltip formatter={(value) => [`$${Number(value).toFixed(4)}`, "XRP/USD"]} />
                <ReferenceLine y={position.warningPrice} stroke="#a76700" strokeDasharray="6 5" label={{ value: "Private warning", fill: "#7a4d00", position: "insideTopRight" }} />
                <ReferenceLine y={position.liquidationPrice} stroke="#bd1f2d" strokeDasharray="3 4" label={{ value: "Private liquidation", fill: "#9e1824", position: "insideBottomRight" }} />
                <Line type="monotone" dataKey="price" stroke="#176e73" strokeWidth={2.5} dot={{ r: 3, fill: "#176e73" }} activeDot={{ r: 6 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <details className="chart-table">
            <summary>View accessible price table</summary>
            <table><thead><tr><th>Time</th><th>XRP/USD</th></tr></thead><tbody>{priceData.map((item) => <tr key={item.time}><td>{item.time}</td><td>${item.price.toFixed(4)}</td></tr>)}</tbody></table>
          </details>
        </section>

        <section className="panel interest-panel">
          <header className="panel__header"><div><span>Private accrual</span><h2>Interest</h2></div><PrivacyLabel scope="private" /></header>
          <div className="interest-total"><span>Repayment now</span><strong>{debt.toFixed(6)} USDT0</strong></div>
          <div className="market-list">
            <div><span>Principal</span><strong>{position.principal.toFixed(4)}</strong></div>
            <div><span>Accrued lender interest</span><strong>{lenderAccrued.toFixed(6)}</strong></div>
            <div><span>Protocol interest</span><strong>{protocolAccrued.toFixed(6)}</strong></div>
            <div><span>Interest per day</span><strong>{interestPerDay.toFixed(6)}</strong></div>
            <div><span>Projected at maturity</span><strong>{projected.toFixed(4)}</strong></div>
          </div>
          <p className="panel-note">The counter is an estimate from the last decrypted state. FCC remains authoritative.</p>
        </section>

        <section className="panel stress-panel">
          <header className="panel__header"><div><span>Private scenario</span><h2>Stress preview</h2></div><PrivacyLabel scope="compute" /></header>
          <div className="stress-value"><span>Hypothetical XRP/USD</span><strong>${stressPrice.toFixed(4)}</strong></div>
          <label className="range-field"><span>Price decline: {stress}%</span><input type="range" min="5" max="40" step="5" value={stress} onChange={(event) => setStress(Number(event.target.value))} /></label>
          <div className="stress-ticks"><span>-5%</span><span>-20%</span><span>-40%</span></div>
          <Button loading={stressLoading} onClick={() => void runStress()}>Run private stress check</Button>
          {stressResult ? (
            <div className={`stress-result ${stressResult.status === "Liquidatable" ? "stress-result--danger" : stressResult.status === "Warning" ? "stress-result--warning" : ""}`}>
              <div><span>Projected LTV</span><strong>{stressResult.ltv.toFixed(1)}%</strong></div>
              <div><span>Projected status</span><strong>{stressResult.status}</strong></div>
              <p>The hypothetical input and result were processed without changing the FTSO price or on-chain state.</p>
            </div>
          ) : null}
        </section>
      </div>

      <section className="position-actions">
        <div><h2>Position actions</h2><p>Repay privately, release collateral, or export a decrypted statement.</p></div>
        <div>
          <Button
            variant="secondary"
            icon={Download}
            onClick={() => {
              downloadPrivateStatement();
              push({ tone: "success", title: "Private statement exported" });
            }}
          >
            Export statement
          </Button>
          <Button variant="danger" icon={X} onClick={() => setCloseOpen(true)}>Close position</Button>
        </div>
      </section>
      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
      <RepayModal open={repayOpen} onClose={() => setRepayOpen(false)} />
      <CloseModal open={closeOpen} onClose={() => setCloseOpen(false)} onClosed={() => navigate("/app")} />
    </div>
  );
}

function RepayModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const position = useQuietline((state) => state.position);
  const available = useQuietline((state) => state.privateUsdt0);
  const { repay } = usePrivateActions();
  const [loading, setLoading] = useState(false);
  const { push } = useToast();
  if (!position) return null;
  const debt = position.principal + position.accruedInterest;
  const submit = async () => {
    if (available < debt) {
      push({ tone: "error", title: "Deposit enough private USDT0 to close the position" });
      return;
    }
    setLoading(true);
    try {
      await repay(available);
      push({
        tone: "success",
        title: "Private position closed",
        body: "Debt was allocated privately and the updated root is anchored.",
      });
      onClose();
    } catch (error) {
      push({
        tone: "error",
        title: "Private repayment failed",
        body: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal open={open} onClose={loading ? () => undefined : onClose} title="Repay private position" description="Repayment allocation stays confidential and moves no tokens when USDT0 is already in QuietVault.">
      <div className="modal-metrics"><Metric label="Total debt" value={`${debt.toFixed(4)} USDT0`} privateValue /><Metric label="Private available" value={`${available.toFixed(2)} USDT0`} privateValue /></div>
      <div className="privacy-notice">
        <LockKeyhole size={17} />
        <p><strong>Full close only.</strong> The hackathon release repays the full debt and releases all collateral in one confidential state transition.</p>
      </div>
      <div className="modal__footer"><Button variant="quiet" onClick={onClose} disabled={loading}>Cancel</Button><Button loading={loading} onClick={() => void submit()}>Apply repayment</Button></div>
    </Modal>
  );
}

function CloseModal({ open, onClose, onClosed }: { open: boolean; onClose: () => void; onClosed: () => void }) {
  const position = useQuietline((state) => state.position);
  const available = useQuietline((state) => state.privateUsdt0);
  const { repay } = usePrivateActions();
  const [loading, setLoading] = useState(false);
  const { push } = useToast();
  if (!position) return null;
  const debt = position.principal + position.accruedInterest;
  const shortage = Math.max(0, debt - available);
  const submit = async () => {
    if (shortage > 0) {
      push({ tone: "warning", title: `Deposit ${shortage.toFixed(4)} more USDT0 first` });
      return;
    }
    setLoading(true);
    try {
      await repay(available);
      push({ tone: "success", title: "Position closed", body: "All FXRP collateral is available privately." });
      onClosed();
    } catch (error) {
      push({
        tone: "error",
        title: "Could not close the position",
        body: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal open={open} onClose={loading ? () => undefined : onClose} title="Close private position" description="Quietline will repay the full debt and release all remaining FXRP collateral.">
      {shortage > 0 ? <div className="warning-banner"><AlertTriangle size={18} /><div><strong>Additional USDT0 required</strong><p>Deposit {shortage.toFixed(4)} USDT0 before closing.</p></div></div> : null}
      <div className="modal-metrics"><Metric label="Repayment required" value={`${debt.toFixed(4)} USDT0`} privateValue /><Metric label="FXRP released" value={`${position.collateral.toFixed(2)} FXRP`} privateValue /></div>
      <div className="modal__footer"><Button variant="quiet" onClick={onClose} disabled={loading}>Keep position</Button><Button variant="danger" loading={loading} onClick={() => void submit()}>Close private position</Button></div>
    </Modal>
  );
}

function titleCase(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function statusPresentation(status: Position["status"]): {
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

function timeUntil(maturesAt: number) {
  const remaining = maturesAt * 1000 - Date.now();
  if (remaining <= 0) return "Matured";
  const hours = Math.floor(remaining / 3_600_000);
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
