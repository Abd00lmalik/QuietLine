import { useQuietline } from "../store/useQuietline";

export function downloadPrivateStatement() {
  const state = useQuietline.getState();
  if (state.mode !== "live" || !state.address) {
    throw new Error("Connect a Coston2 wallet before exporting a statement");
  }
  const statement = {
    protocol: "Quietline",
    network: "Coston2",
    generatedAt: new Date().toISOString(),
    account: state.address,
    privateBalances: {
      FXRP: state.privateFxrp,
      USDT0: state.privateUsdt0,
    },
    lender: {
      allocatedUSDT0: state.lenderAllocated,
      earnedUSDT0: state.lenderEarned,
      mandates: state.mandates,
    },
    position: state.position,
    activity: state.activities.filter((item) => item.scope === "private"),
    privacyNotice:
      "This file contains values decrypted from Flare Confidential Compute. Store it securely.",
  };
  const blob = new Blob([JSON.stringify(statement, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `quietline-${state.address.slice(0, 8)}-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
