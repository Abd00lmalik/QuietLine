import {
  Copy,
  Download,
  ExternalLink,
  LockKeyhole,
  LogOut,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDisconnect } from "wagmi";
import { COSTON2 } from "@quietline/protocol";
import { ConnectQuietline } from "../components/ConnectQuietline";
import {
  Button,
  EmptyState,
  IconButton,
  Modal,
  PrivacyLabel,
  Status,
  useToast,
} from "../components/ui";
import { getAttestation } from "../lib/api";
import { downloadPrivateStatement } from "../lib/statement";
import { useQuietline } from "../store/useQuietline";

export function SettingsPage() {
  const mode = useQuietline((state) => state.mode);
  if (mode === "disconnected") {
    return (
      <div className="page">
        <div className="page-heading">
          <div>
            <span className="page-kicker">Account controls</span>
            <h1>Settings</h1>
          </div>
        </div>
        <EmptyState
          title="No active private session"
          body="Connect a Coston2 wallet to inspect privacy, attestation, and notification controls."
          action={<ConnectQuietline compact />}
        />
      </div>
    );
  }
  return <ConnectedSettings />;
}

function ConnectedSettings() {
  const mode = useQuietline((state) => state.mode);
  const sessionExpiresAt = useQuietline((state) => state.sessionExpiresAt);
  const notifications = useQuietline((state) => state.notifications);
  const toggle = useQuietline((state) => state.toggleNotification);
  const lock = useQuietline((state) => state.lock);
  const disconnect = useQuietline((state) => state.disconnect);
  const serviceHealth = useQuietline((state) => state.serviceHealth);
  const navigate = useNavigate();
  const { disconnectAsync } = useDisconnect();
  const { push } = useToast();
  const [attestation, setAttestation] = useState<unknown>();
  const [attestationError, setAttestationError] = useState<string>();
  const [attestationOpen, setAttestationOpen] = useState(false);

  useEffect(() => {
    if (mode !== "live") return;
    let active = true;
    void getAttestation().then(
      (value) => {
        if (active) setAttestation(value);
      },
      (error) => {
        if (active) {
          setAttestationError(error instanceof Error ? error.message : String(error));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [mode]);

  const attestationView = useMemo(
    () => normalizeAttestation(attestation, mode, attestationError),
    [attestation, attestationError, mode],
  );
  const remaining = sessionExpiresAt
    ? Math.max(0, Math.floor((sessionExpiresAt - Date.now()) / 60_000))
    : 0;

  return (
    <div className="page settings-page">
      <div className="page-heading">
        <div>
          <span className="page-kicker">Account controls</span>
          <h1>Settings</h1>
          <p>Privacy, notifications, service status, and session controls.</p>
        </div>
      </div>

      <section className="settings-section">
        <header>
          <div>
            <LockKeyhole size={19} />
            <div>
              <h2>Privacy</h2>
              <p>Current browser session and FCC identity.</p>
            </div>
          </div>
        </header>
        <div className="settings-rows">
          <div>
            <div>
              <strong>Private session</strong>
              <span>Decrypted values stay in memory for this session.</span>
            </div>
            <div>
              <PrivacyLabel scope="private" compact />
              <Status tone={remaining ? "healthy" : "warning"}>
                {remaining ? `${remaining} min remaining` : "Locked"}
              </Status>
              <Button variant="secondary" onClick={lock}>
                Lock now
              </Button>
            </div>
          </div>
          <div>
            <div>
              <strong>FCC attestation</strong>
              <span>{attestationView.detail}</span>
            </div>
            <div>
              <PrivacyLabel scope="compute" compact />
              <Status tone={attestationView.tone}>
                <ShieldCheck size={14} /> {attestationView.status}
              </Status>
              <IconButton
                icon={ExternalLink}
                label="Inspect FCC attestation"
                disabled={!attestation}
                onClick={() => setAttestationOpen(true)}
              />
            </div>
          </div>
          <div>
            <div>
              <strong>Confidential code hash</strong>
              <span className="mono">{shortHash(attestationView.codeHash)}</span>
            </div>
            <div>
              <IconButton
                icon={Copy}
                label="Copy confidential code hash"
                disabled={!attestationView.codeHash}
                onClick={() => {
                  if (!attestationView.codeHash) return;
                  void navigator.clipboard.writeText(attestationView.codeHash);
                  push({ tone: "success", title: "Code hash copied" });
                }}
              />
            </div>
          </div>
          <div>
            <div>
              <strong>Privacy boundary</strong>
              <span>
                Transfers and timing are public. The TEE sees plaintext while
                computing.
              </span>
            </div>
            <div><PrivacyLabel scope="public" compact /><Button variant="quiet" onClick={() => window.open("/#privacy", "_blank")}>Read model</Button></div>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <header>
          <div>
            <ShieldCheck size={19} />
            <div>
              <h2>Notifications</h2>
              <p>Stored in this browser. No email or phone number is collected.</p>
            </div>
          </div>
        </header>
        <div className="settings-rows">
          {([
            ["health", "Health warning", "Alert after a private refresh reports the warning band."],
            ["maturity24h", "Maturity in 24 hours", "Show a local reminder one day before maturity."],
            ["maturity1h", "Maturity in 1 hour", "Show a local reminder one hour before maturity."],
            ["deposit", "Deposit credited", "Notify after FCC credits a confirmed vault deposit."],
            ["payout", "Payout complete", "Notify after QuietVault transfers borrowed USD₮0."],
          ] as const).map(([key, label, detail]) => (
            <div key={key}>
              <div>
                <strong>{label}</strong>
                <span>{detail}</span>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={notifications[key]}
                  onChange={() => toggle(key)}
                />
                <span />
              </label>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <header>
          <div>
            <ExternalLink size={19} />
            <div>
              <h2>Transactions</h2>
              <p>Public relaying and explorer settings.</p>
            </div>
          </div>
        </header>
        <div className="settings-rows">
          <div>
            <div>
              <strong>Automatic settlement relay</strong>
              <span>Always enabled for the hackathon release.</span>
            </div>
            <Status tone={serviceHealth?.status === "ok" ? "healthy" : "warning"}>
              {serviceHealth?.status === "ok" ? "Ready" : "Unavailable"}
            </Status>
          </div>
          <div>
            <div>
              <strong>Relayer</strong>
              <span>Durable job orchestration and anchor confirmation.</span>
            </div>
            <Status tone={serviceHealth?.services.api === "ok" && serviceHealth.services.database === "ok" ? "healthy" : "warning"}>
              {serviceHealth?.services.api === "ok" && serviceHealth.services.database === "ok" ? "Online" : "Unavailable"}
            </Status>
          </div>
          <div>
            <div>
              <strong>Coston2 explorer</strong>
              <span>{COSTON2.explorerUrl.replace("https://", "")}</span>
            </div>
            <IconButton
              icon={ExternalLink}
              label="Open Coston2 explorer"
              onClick={() => window.open(COSTON2.explorerUrl, "_blank")}
            />
          </div>
        </div>
      </section>

      <section className="settings-section settings-section--danger">
        <header>
          <div>
            <Trash2 size={19} />
            <div>
              <h2>Session actions</h2>
              <p>Export private data or disconnect this browser wallet.</p>
            </div>
          </div>
        </header>
        <div className="danger-actions">
          <Button
            variant="secondary"
            icon={Download}
            onClick={() => {
              downloadPrivateStatement();
              push({ tone: "success", title: "Private statement exported" });
            }}
          >
            Export private statement
          </Button>
          <Button
            variant="danger"
            icon={LogOut}
            onClick={() => void (async () => {
              await disconnectAsync();
              disconnect();
              navigate("/app");
            })()}
          >
            Disconnect wallet
          </Button>
        </div>
      </section>

      <Modal
        open={attestationOpen}
        onClose={() => setAttestationOpen(false)}
        title="FCC environment information"
        description="Signed information returned by the configured FCC proxy. On-chain registration is checked separately."
      >
        <pre className="attestation-json">{JSON.stringify(attestation, null, 2)}</pre>
      </Modal>
    </div>
  );
}

function normalizeAttestation(
  value: unknown,
  mode: "disconnected" | "live",
  error?: string,
) {
  if (error) {
    return {
      status: "Unavailable",
      detail: error,
      codeHash: "",
      tone: "warning" as const,
    };
  }
  if (!value || typeof value !== "object") {
    return {
      status: "Loading",
      detail: `Coston2 chain ${COSTON2.id}`,
      codeHash: "",
      tone: "info" as const,
    };
  }
  const root = value as Record<string, unknown>;
  const machine = objectValue(root.machineData ?? root.MachineData);
  const extensionId = stringValue(machine.extensionId ?? machine.ExtensionID);
  const codeHash = stringValue(machine.codeHash ?? machine.CodeHash);
  const attestation = stringValue(root.attestation ?? root.Attestation);
  const hasRealAttestation = Boolean(attestation && attestation !== "magic_pass");
  return {
    status: hasRealAttestation ? "Attested" : "Unverified",
    detail: hasRealAttestation
      ? `Extension ${extensionId || "unknown"} / Coston2 chain ${COSTON2.id}`
      : "The proxy response did not include a production attestation.",
    codeHash,
    tone: hasRealAttestation ? "healthy" as const : "warning" as const,
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

function shortHash(value: string) {
  return value ? `${value.slice(0, 10)}...${value.slice(-6)}` : "Not available";
}
