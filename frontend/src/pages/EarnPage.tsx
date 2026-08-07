import { BadgeDollarSign, LockKeyhole, Plus, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { ConnectQuietline } from "../components/ConnectQuietline";
import {
  AssetBadge,
  Button,
  EmptyState,
  Metric,
  Modal,
  PrivacyLabel,
  Status,
  useToast,
} from "../components/ui";
import { usePrivateActions } from "../hooks/usePrivateActions";
import { useQuietline } from "../store/useQuietline";
import { assetSymbol } from "@quietline/protocol";

const usdt0Symbol = assetSymbol("USDT0");

export function EarnPage() {
  const mode = useQuietline((state) => state.mode);
  const [editorOpen, setEditorOpen] = useState(false);
  const available = useQuietline((state) => state.privateUsdt0);
  const allocated = useQuietline((state) => state.lenderAllocated);
  const earned = useQuietline((state) => state.lenderEarned);
  const mandates = useQuietline((state) => state.mandates);
  const activeMandates = mandates.filter((mandate) => mandate.active);
  const weightedAmount = activeMandates.reduce(
    (total, mandate) => total + mandate.available + mandate.allocatedPrincipal,
    0,
  );
  const weightedApr = activeMandates.reduce(
    (total, mandate) =>
      total +
      mandate.minAprBps * (mandate.available + mandate.allocatedPrincipal),
    0,
  );
  if (mode === "disconnected") {
    return (
      <div className="page">
        <div className="page-heading"><div><span className="page-kicker">Confidential liquidity</span><h1>Earn</h1></div></div>
        <EmptyState icon={LockKeyhole} title="Open a private session to provide liquidity" body="Your minimum APR, eligible terms, and per-borrower cap are hidden inside FCC." action={<ConnectQuietline compact />} />
      </div>
    );
  }
  return (
    <div className="page">
      <div className="page-heading">
        <div><span className="page-kicker">Confidential liquidity</span><h1>Earn</h1><p>Offer {usdt0Symbol} without publishing your rate or allocation preferences.</p></div>
        <Button icon={Plus} onClick={() => setEditorOpen(true)}>Provide liquidity</Button>
      </div>
      <section className="metric-band">
        <Metric label={`Private ${usdt0Symbol} available`} value={`${available.toFixed(2)} ${usdt0Symbol}`} privateValue />
        <Metric label="Allocated to mandates" value={`${allocated.toFixed(2)} ${usdt0Symbol}`} privateValue />
        <Metric label="Interest earned" value={`${earned.toFixed(4)} ${usdt0Symbol}`} privateValue />
        <Metric label="Weighted lender APR" value={weightedAmount ? `${(weightedApr / weightedAmount / 100).toFixed(2)}%` : "--"} privateValue />
      </section>
      <section className="panel mandate-panel">
        <header className="panel__header"><div><span>Private terms</span><h2>Lending mandates</h2></div><PrivacyLabel scope="private" /><Status tone={activeMandates.length ? "healthy" : "neutral"}>{activeMandates.length ? `${activeMandates.length} active` : "No mandates"}</Status></header>
        {activeMandates.length ? activeMandates.map((mandate) => (
          <div className="mandate-row" key={mandate.id}>
            <div><AssetBadge asset="USDT0" /><strong>{((mandate.available + mandate.allocatedPrincipal) / 1_000_000).toFixed(2)}</strong><span>Private amount</span></div>
            <div><strong>{(mandate.allocatedPrincipal / 1_000_000).toFixed(2)} {usdt0Symbol}</strong><span>Currently lent</span></div>
            <div><strong><LockKeyhole size={14} /> {(mandate.minAprBps / 100).toFixed(2)}%</strong><span>Minimum APR</span></div>
            <div><strong>{termsFromMask(mandate.termMask)}</strong><span>Eligible terms</span></div>
            <div><Status tone="healthy">Active</Status><span>Mandate status</span></div>
          </div>
        )) : (
          <EmptyState icon={BadgeDollarSign} title="No active lending mandate" body={`Reserve private ${usdt0Symbol} for deterministic matching against eligible borrowers.`} action={<Button onClick={() => setEditorOpen(true)}>Activate a mandate</Button>} />
        )}
      </section>
      <section className="earn-explainer">
        <ShieldCheck size={21} />
        <div><h2>Liquidity remains in QuietVault.</h2><p>Activating a mandate moves no tokens. FCC reserves your private balance and anchors the new state root on Coston2.</p></div>
      </section>
      <MandateModal open={editorOpen} onClose={() => setEditorOpen(false)} />
    </div>
  );
}

function termsFromMask(mask: number) {
  const terms = [
    mask & 1 ? "7" : "",
    mask & 2 ? "14" : "",
    mask & 4 ? "30" : "",
  ].filter(Boolean);
  return `${terms.join(" / ")} days`;
}

function MandateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [amount, setAmount] = useState("4");
  const [apr, setApr] = useState("7.5");
  const [cap, setCap] = useState("4");
  const [capCustomized, setCapCustomized] = useState(false);
  const [terms, setTerms] = useState([7, 14]);
  const [loading, setLoading] = useState(false);
  const { setMandate } = usePrivateActions();
  const available = useQuietline((state) => state.privateUsdt0);
  const { push } = useToast();
  useEffect(() => {
    if (!open) return;
    const fullBalance = available > 0 ? String(available) : "";
    setAmount(fullBalance);
    setCap(fullBalance);
    setCapCustomized(false);
  }, [available, open]);
  const submit = async () => {
    const numericAmount = Number(amount);
    const numericApr = Number(apr);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > available) {
      push({ tone: "error", title: `Mandate amount must fit your private ${usdt0Symbol} balance` });
      return;
    }
    if (numericApr < 6 || numericApr > 20) {
      push({ tone: "error", title: "Minimum APR must be between 6% and 20%" });
      return;
    }
    if (!Number.isFinite(Number(cap)) || Number(cap) <= 0 || terms.length === 0 || Number(cap) > numericAmount) {
      push({ tone: "error", title: "Choose a term and keep the borrower cap within the mandate" });
      return;
    }
    setLoading(true);
    try {
      await setMandate({
        amount: numericAmount,
        minApr: numericApr,
        terms,
        perBorrowerCap: Number(cap),
      });
      push({
        tone: "success",
        title: "Private mandate active",
        body: "The new confidential state root is anchored.",
      });
      onClose();
    } catch (error) {
      push({
        tone: "error",
        title: "Mandate activation failed",
        body: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal open={open} onClose={loading ? () => undefined : onClose} title="Activate private mandate" description="Only broad market availability is public. These terms stay confidential.">
      <div className="form-grid">
        <label className="field"><span>Amount</span><div className="amount-input"><input value={amount} onChange={(event) => { const next = event.target.value; setAmount(next); if (!capCustomized) setCap(next); }} inputMode="decimal" /><strong>{usdt0Symbol}</strong></div><small>{available.toFixed(2)} available privately</small></label>
        <label className="field"><span>Minimum lender APR</span><div className="amount-input"><input value={apr} onChange={(event) => setApr(event.target.value)} inputMode="decimal" /><strong>%</strong></div></label>
      </div>
      <fieldset className="field"><legend>Eligible terms</legend><div className="check-grid">{[7, 14, 30].map((term) => <label key={term}><input type="checkbox" checked={terms.includes(term)} onChange={() => setTerms((current) => current.includes(term) ? current.filter((value) => value !== term) : [...current, term])} /><span>{term} days</span></label>)}</div></fieldset>
      <label className="field"><span>Maximum per borrower</span><div className="amount-input"><input value={cap} onChange={(event) => { setCap(event.target.value); setCapCustomized(true); }} inputMode="decimal" /><strong>{usdt0Symbol}</strong></div><small>Defaults to the full mandate. Lower it to spread liquidity across borrowers.</small></label>
      <div className="privacy-notice"><PrivacyLabel scope="compute" /><p>The confidential engine sees these values in plaintext while evaluating matches. The relayer receives ciphertext.</p></div>
      <div className="modal__footer"><Button variant="quiet" onClick={onClose} disabled={loading}>Cancel</Button><Button loading={loading} onClick={() => void submit()}>Activate private mandate</Button></div>
    </Modal>
  );
}
