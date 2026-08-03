import { ExternalLink, LockKeyhole, RefreshCw } from "lucide-react";
import { useState } from "react";
import { COSTON2 } from "@quietline/protocol";
import { ConnectQuietline } from "../components/ConnectQuietline";
import { EmptyState, IconButton, PrivacyLabel, Status, useToast } from "../components/ui";
import { usePrivateActions } from "../hooks/usePrivateActions";
import { listJobs } from "../lib/api";
import { useQuietline } from "../store/useQuietline";

export function ActivityPage() {
  const [tab, setTab] = useState<"public" | "private">("public");
  const mode = useQuietline((state) => state.mode);
  const activities = useQuietline((state) => state.activities);
  const token = useQuietline((state) => state.sessionToken);
  const hydrateRelayerJobs = useQuietline((state) => state.hydrateRelayerJobs);
  const [refreshing, setRefreshing] = useState(false);
  const { refreshAccount } = usePrivateActions();
  const { push } = useToast();
  if (mode === "disconnected") {
    return (
      <div className="page">
        <div className="page-heading"><div><span className="page-kicker">Account history</span><h1>Activity</h1></div></div>
        <EmptyState title="Connect to load account activity" body="Public transactions come from Coston2. Private rows are decrypted from FCC and disappear when the session locks." action={<ConnectQuietline compact />} />
      </div>
    );
  }
  const refresh = async () => {
    if (mode !== "live" || !token) return;
    setRefreshing(true);
    try {
      const [, jobs] = await Promise.all([refreshAccount(), listJobs(token)]);
      hydrateRelayerJobs(jobs);
      push({ tone: "success", title: "Activity refreshed" });
    } catch (error) {
      push({
        tone: "error",
        title: "Activity refresh failed",
        body: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRefreshing(false);
    }
  };
  const filtered = activities.filter((item) => item.scope === tab);
  return (
    <div className="page">
      <div className="page-heading">
        <div><span className="page-kicker">Account history</span><h1>Activity</h1><p>Public settlement and confidential accounting are shown separately.</p></div>
        <IconButton icon={RefreshCw} label="Refresh activity" disabled={refreshing || mode !== "live"} onClick={() => void refresh()} />
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "public"} className={tab === "public" ? "active" : ""} onClick={() => setTab("public")}>Public transactions</button>
        <button role="tab" aria-selected={tab === "private"} className={tab === "private" ? "active" : ""} onClick={() => setTab("private")}><LockKeyhole size={15} /> Private activity</button>
      </div>
      <section className="panel activity-panel">
        <div className="activity-scope">
          <PrivacyLabel scope={tab === "private" ? "private" : "public"} />
          <span>{tab === "private" ? "Decrypted from your FCC account view." : "Visible on Coston2 and the explorer."}</span>
        </div>
        <div className="activity-table activity-table--header"><span>Action</span><span>Details</span><span>Status</span><span>Time</span><span /></div>
        {filtered.length ? filtered.map((item) => (
          <div className="activity-table" key={item.id}>
            <div><span className={`activity-icon activity-icon--${item.scope}`}>{item.scope === "private" ? <LockKeyhole size={15} /> : <ExternalLink size={15} />}</span><strong>{item.label}</strong></div>
            <span>{item.detail}</span>
            <Status tone={item.status === "warning" ? "warning" : item.status === "pending" ? "info" : "healthy"}>{item.status === "complete" ? "Complete" : item.status}</Status>
            <time>{item.timestamp}</time>
            {item.scope === "public" ? <a href={item.txHash ? `${COSTON2.explorerUrl}/tx/${item.txHash}` : COSTON2.explorerUrl} target="_blank" rel="noreferrer" aria-label={`Open ${item.label} in explorer`}><ExternalLink size={16} /></a> : <LockKeyhole size={15} />}
          </div>
        )) : <EmptyState title={`No ${tab} activity yet`} body={tab === "private" ? "Confidential account events will appear after your first private action." : "Vault deposits and settlements will appear after your first transaction."} />}
      </section>
    </div>
  );
}
