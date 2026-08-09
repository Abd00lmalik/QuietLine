import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CloudCog,
  Eye,
  HandCoins,
  LockKeyhole,
  Menu,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { POLICY, assetSymbol } from "@quietline/protocol";
import { AssetBadge, Button, HealthScale, Status, ToastProvider, useToast } from "../components/ui";
import { getMarket } from "../lib/api";
import "./LandingPage.css";

const fxrp = "FXRP";
const usdt0 = "USDT0";
const fxrpSymbol = assetSymbol(fxrp);
const usdt0Symbol = assetSymbol(usdt0);

/* ------------------------------------------------------------------ utils */

/** Fire an event once the element scrolls into view (IntersectionObserver). */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.14, rootMargin: "0px 0px -32px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return ref;
}

/** Respect reduced-motion everywhere (design-system gate). */
function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ---------------------------------------------------------------- preloader */

function Preloader() {
  // Under reduced motion (or SSR-less first paint), never mount the overlay.
  const [done, setDone] = useState(() => prefersReducedMotion());
  // Once `done`, keep the node one transition-length longer so the fade can
  // play, then unmount entirely. Unmounting (not just a class/opacity toggle)
  // guarantees the fixed full-screen layer can never be left covering the page.
  const [removed, setRemoved] = useState(() => prefersReducedMotion());

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const finish = window.setTimeout(() => setDone(true), 900);
    return () => window.clearTimeout(finish);
  }, []);

  useEffect(() => {
    if (!done) return;
    const cleanup = window.setTimeout(() => setRemoved(true), 620);
    return () => window.clearTimeout(cleanup);
  }, [done]);

  if (removed) return null;

  return (
    <div
      className={`ql-preloader${done ? " ql-preloader--done" : ""}`}
      aria-hidden="true"
    >
      <div className="ql-preloader__mark">
        <span className="ql-preloader__glyph">Q</span>
        <span className="ql-preloader__word">Quietline</span>
      </div>
      <span className="ql-preloader__bar" />
    </div>
  );
}

/* ---------------------------------------------------------- live market data */

type MarketSnapshot = {
  xrpUsdE6: number;
  updatedAt: number;
  vaultUsdt0Balance: string;
};

type MarketState =
  | { status: "loading" }
  | { status: "ready"; data: MarketSnapshot; stale: boolean }
  | { status: "unavailable" };

/**
 * Read-only live market data for the landing page. Reuses the existing
 * relayer `getMarket()` endpoint (the same source the app relies on) and
 * polls on an interval. On a transient failure we keep showing the last
 * real values marked stale; if we never loaded any, we show an honest
 * "unavailable" state instead of inventing numbers.
 */
function useMarket(pollMs = 20_000): MarketState {
  const [state, setState] = useState<MarketState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const data = await getMarket();
        if (!active) return;
        setState({ status: "ready", data, stale: false });
      } catch {
        if (!active) return;
        // Keep the last good values (flagged stale); only fall back to
        // "unavailable" if we have nothing real to show yet.
        setState((prev) =>
          prev.status === "ready"
            ? { status: "ready", data: prev.data, stale: true }
            : { status: "unavailable" },
        );
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), pollMs);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [pollMs]);

  return state;
}

/** A ticking "seconds ago" value, refreshed once per second. */
function useSecondsSince(timestampSeconds: number | null): number | null {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (timestampSeconds === null) return null;
  return Math.max(0, now - timestampSeconds);
}

/* --------------------------------------------------------------- hero stage */

function HeroStage() {
  const wrap = useRef<HTMLDivElement | null>(null);
  const card = useRef<HTMLDivElement | null>(null);
  const { push } = useToast();
  const [phase, setPhase] = useState(0);
  const [muted, setMuted] = useState(false);

  /* 3D tilt on pointer move (disabled under reduced motion). */
  useEffect(() => {
    const parent = wrap.current;
    const target = card.current;
    if (!parent || !target) return;
    const onMove = (event: PointerEvent) => {
      const rect = parent.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      target.style.setProperty("--rx", `${(py - 0.5) * -7}deg`);
      target.style.setProperty("--ry", `${(px - 0.5) * 9}deg`);
    };
    const onLeave = () => {
      target.style.setProperty("--rx", "0deg");
      target.style.setProperty("--ry", "0deg");
    };
    const onEnter = () => target.classList.add("is-tilting");
    if (prefersReducedMotion()) return;
    parent.addEventListener("pointermove", onMove);
    parent.addEventListener("pointerenter", onEnter);
    parent.addEventListener("pointerleave", onLeave);
    return () => {
      parent.removeEventListener("pointermove", onMove);
      parent.removeEventListener("pointerenter", onEnter);
      parent.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  /* Cycle the encrypt -> compute -> settle pipeline every 2.2s. */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const timer = window.setInterval(() => setPhase((p) => (p + 1) % 3), 2200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const onScroll = () => setMuted(window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const nodes = [
    { key: "encrypt", label: "Encrypt", detail: "request locked on your device", icon: LockKeyhole },
    { key: "compute", label: "Compute", detail: "terms checked in a secure enclave", icon: CloudCog },
    { key: "settle", label: "Settle", detail: "payout settles on Flare", icon: Check },
  ] as const;
  const [encryptDone, computeDone, settleDone] = [phase > 0, phase > 1, phase > 2];

  const handleRefresh = () => {
    if (prefersReducedMotion()) {
      push({ tone: "info", title: "Live preview needs motion", body: "Enable motion to see the steps run." });
      return;
    }
    setPhase(0);
    push({ tone: "info", title: "Private account refreshed", body: "The preview shows the current demo state." });
  };

  return (
    <div ref={wrap} className="ql-stage">
      <div ref={card} className="ql-card3d">
        <span className="ql-annot ql-annot--tl" aria-hidden="true"><span className="ql-tick" /> visible only to you</span>
        <article className="ql-ledger" aria-label="Preview of your private Quietline account">
          <header className="ql-ledger__head">
            <div>
              <span className="ql-kicker"><LockKeyhole size={13} /> private account</span>
              <div className="ql-ledger__pair">
                <AssetBadge asset={fxrp} />
                <span>/</span>
                <AssetBadge asset={usdt0} />
              </div>
            </div>
            <Status tone="healthy">Healthy</Status>
          </header>

          <div className="ql-ledger__lines">
            <div className="ql-ledger__line">
              <span>Collateral</span>
              <strong className="ql-cipher">12,500.000000</strong>
              <LockKeyhole size={15} />
            </div>
            <div className="ql-ledger__line">
              <span>Borrowed</span>
              <strong className="ql-cipher">4,800.000000</strong>
              <LockKeyhole size={15} />
            </div>
            <div className="ql-ledger__line">
              <span>Accrued interest</span>
              <strong className="ql-cipher">14.207214</strong>
              <LockKeyhole size={15} />
            </div>
          </div>

          <div className="ql-ledger__risk">
            <div className="ql-ledger__risk-head">
              <span>Loan-to-value</span>
              <strong>41.8%</strong>
            </div>
            <div className="ql-track" aria-hidden="true">
              <span style={{ width: "41.8%" }} />
              <i style={{ left: "65%" }} />
            </div>
            <div className="ql-track-labels">
              <span>Healthy</span>
              <span>Warning 55%</span>
              <span>Liquidation 65%</span>
            </div>
          </div>

          <div className="ql-pipe">
            {nodes.map((node) => {
              const state =
                (node.key === "encrypt" && encryptDone) ||
                (node.key === "compute" && computeDone) ||
                (node.key === "settle" && settleDone)
                  ? "done"
                  : node.key === "encrypt"
                    ? "active"
                    : node.key === "compute" && phase === 1
                      ? "active"
                      : node.key === "settle" && phase === 2
                        ? "active"
                        : "idle";
              const Icon = node.icon;
              return (
                <div className="ql-pipe__node" data-state={state} key={node.key}>
                  <Icon size={17} />
                  <span>{node.label}</span>
                  <small>{node.detail}</small>
                </div>
              );
            })}
          </div>
        </article>
        <span className="ql-annot ql-annot--br" aria-hidden="true">settles on Flare <span className="ql-tick" /></span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- interactive quote */

function QuotePreview() {
  const { push } = useToast();
  const [collateral, setCollateral] = useState("10,000");
  const [term, setTerm] = useState(14);
  const [quote, setQuote] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const collateralNumber = useMemo(() => Number(collateral.replace(/[^\d.]/g, "")) || 0, [collateral]);
  const cap = collateralNumber * 0.5;
  const borrow = Math.min(cap, 999_999);
  const interest = borrow * 0.018 * (term / 14);
  const total = borrow + interest;

  const cycle = async () => {
    if (prefersReducedMotion()) {
      push({ tone: "info", title: "Preview runs on motion", body: "Enable motion to watch the quote compute." });
      return;
    }
    if (working) return;
    setWorking(true);
    setQuote(null);
    await new Promise((resolve) => window.setTimeout(resolve, 1400));
    setQuote(`${total.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${usdt0Symbol}`);
    setWorking(false);
  };

  return (
    <div className="ql-quote">
      <div className="ql-quote__panel">
        <header className="ql-quote__head">
          <span><LockKeyhole size={14} /> Private quote</span>
          <span><Sparkles size={14} /> Computed privately</span>
        </header>
        <div className="ql-quote__body">
          <div className="ql-field">
            <span className="ql-field__label">
              <span>FXRP collateral</span>
              <span className="ql-avail">wallet 50,000</span>
            </span>
            <div className="ql-input">
              <input
                inputMode="decimal"
                aria-label="FXRP collateral"
                value={collateral}
                onChange={(event) => setCollateral(event.target.value)}
              />
              <strong style={{ fontFamily: "Fira Code, monospace" }}>{fxrpSymbol}</strong>
            </div>
          </div>

          <div className="ql-field">
            <span className="ql-field__label">
              <span>Term</span>
              <span className="ql-avail">quote valid {POLICY.quoteValiditySeconds}s</span>
            </span>
            <div className="ql-terms">
              {POLICY.termsDays.map((days) => (
                <button
                  key={days}
                  type="button"
                  className={`ql-term${term === days ? " ql-term--active" : ""}`}
                  onClick={() => setTerm(days)}
                >
                  {days} days
                </button>
              ))}
            </div>
          </div>

          <div className="ql-quote__out">
            <div className="ql-quote__row">
              <span>Borrowable</span>
              <strong>{borrow.toLocaleString("en-US", { maximumFractionDigits: 2 })} {usdt0Symbol}</strong>
            </div>
            <div className="ql-quote__row">
              <span>Interest {term}d</span>
              <strong>{interest.toLocaleString("en-US", { maximumFractionDigits: 2 })} {usdt0Symbol}</strong>
            </div>
            <div className="ql-quote__row ql-quote__row--total">
              <span>Total to repay</span>
              <strong>{quote ?? (working ? "computing…" : `${total.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${usdt0Symbol}`)}</strong>
            </div>
            <Button icon={Sparkles} loading={working} onClick={() => void cycle()}>
              {working ? "Computing your quote" : "Get a private quote"}
            </Button>
            <p className="ql-quote__note">
              <Eye size={14} aria-hidden="true" />
              <span>Your quote is worked out inside a secure enclave. Your numbers are never shown in plain text.</span>
            </p>
          </div>
        </div>
      </div>

      <div className="ql-quote__aside">
        <span className="ql-eyebrow"><span className="ql-pulse" /> try it yourself</span>
        <h2>See a private quote</h2>
        <p>
          Change the collateral amount and watch the numbers update. The limits are the protocol's
          real ones: you can borrow up to {POLICY.initialLtvBps / 100}% of your collateral, with
          liquidation at {POLICY.liquidationLtvBps / 100}%.
        </p>
        <div style={{ display: "grid", gap: "10px", marginTop: "22px" }}>
          <span className="ql-track-labels"><span>Healthy</span><span>Warning 55%</span><span>Liquidation 65%</span></span>
          <HealthScale value={41.8} warning={55} liquidation={65} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- FAQ */

const FAQ_ITEMS = [
  {
    q: "What stays private, and what becomes public?",
    a: "Your collateral, debt, loan health, and the terms you accept stay private and are only shown to you. The payout amount, where it goes, and the settlement receipt are public on Flare. That line between private and public is the whole idea behind Quietline.",
  },
  {
    q: "Where does the credit decision happen?",
    a: "Inside a secure enclave on Flare. It receives your private account details, applies the same fixed rules to everyone, and signs off on the result. No person or operator ever sees your numbers.",
  },
  {
    q: "Where does the XRP price come from?",
    a: "From Flare's built-in price feed, FTSOv2. The XRP/USD price is public and is only used to size your credit line and check its health. It never reveals your private balances.",
  },
  {
    q: "Is this live with real money yet?",
    a: "Not yet. Quietline runs on Coston2, Flare's test network, while the protocol and its private compute are being audited.",
  },
];

/* ----------------------------------------------------- privacy flip deck */

/**
 * A stacked "card deck" that flips on its vertical axis between the private
 * face (lock) and the public face (eye). It is a real button, so it flips on
 * click and on keyboard (Enter/Space). Under reduced motion the CSS renders
 * both faces stacked and static, so all information stays visible without
 * interacting. The content is the same private/public split as before, kept
 * to a single representation per side.
 */
function PrivacyDeck() {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className="ql-deck">
      <span className="ql-deck__peek" aria-hidden="true" />
      <button
        type="button"
        className={`ql-flip${flipped ? " ql-flip--flipped" : ""}`}
        aria-pressed={flipped}
        aria-label={
          flipped
            ? "Showing what is public. Activate to see what stays private."
            : "Showing what stays private. Activate to see what is public."
        }
        onClick={() => setFlipped((value) => !value)}
      >
        <span className="ql-flip__inner">
          <span className="ql-flip__face ql-flip__face--private" aria-hidden={flipped}>
            <span className="ql-flip__corner ql-flip__corner--tr"><LockKeyhole size={15} /></span>
            <span className="ql-flip__corner ql-flip__corner--bl"><LockKeyhole size={15} /></span>
            <span className="ql-flip__scope"><LockKeyhole size={20} /> Private</span>
            <ul>
              <li><LockKeyhole size={14} /> Your collateral and debt</li>
              <li><LockKeyhole size={14} /> Your loan health and interest</li>
              <li><LockKeyhole size={14} /> The terms you accept</li>
            </ul>
            <span className="ql-flip__hint">Tap to see what is public</span>
          </span>
          <span className="ql-flip__face ql-flip__face--public" aria-hidden={!flipped}>
            <span className="ql-flip__corner ql-flip__corner--tr"><Eye size={15} /></span>
            <span className="ql-flip__corner ql-flip__corner--bl"><Eye size={15} /></span>
            <span className="ql-flip__scope"><Eye size={20} /> Public</span>
            <ul>
              <li><Eye size={14} /> Vault token balances</li>
              <li><Eye size={14} /> Payouts and settlement receipts</li>
              <li><Eye size={14} /> The XRP price feed (FTSOv2)</li>
            </ul>
            <span className="ql-flip__hint">Tap to see what stays private</span>
          </span>
        </span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------- live market grid */

/** Compact, honest formatting for the vault balance (6-decimal USD₮0 base). */
function formatVaultBalance(raw: string): string {
  const value = Number(raw) / 1_000_000;
  if (!Number.isFinite(value)) return "Unavailable";
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  if (value >= 1_000) return `${(value / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K`;
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function LiveMarketGrid() {
  const market = useMarket();
  const data = market.status === "ready" ? market.data : null;
  const stale = market.status === "ready" && market.stale;
  const loading = market.status === "loading";
  const live = data !== null && !stale;

  const age = useSecondsSince(data ? data.updatedAt : null);

  const priceText = data
    ? `$${(data.xrpUsdE6 / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`
    : loading
      ? "Loading"
      : "Unavailable";

  const vaultText = data ? formatVaultBalance(data.vaultUsdt0Balance) : loading ? "Loading" : "Unavailable";

  const limits = `${POLICY.initialLtvBps / 100} / ${POLICY.warningLtvBps / 100} / ${POLICY.liquidationLtvBps / 100}`;

  let ageValue = loading ? "Loading" : "Unavailable";
  let ageUnit = "";
  if (age !== null) {
    if (age < 90) {
      ageValue = String(age);
      ageUnit = age === 1 ? "second ago" : "seconds ago";
    } else {
      const minutes = Math.floor(age / 60);
      ageValue = String(minutes);
      ageUnit = minutes === 1 ? "minute ago" : "minutes ago";
    }
  }

  return (
    <div className="ql-data">
      <div className="ql-data__cell">
        <span className="ql-data__label"><ShieldCheck size={14} /> XRP / USD · FTSOv2</span>
        <div className={`ql-data__value${live ? " ql-data__value--live" : ""}`}>
          {live ? <span className="ql-live" aria-hidden="true" /> : null}
          {priceText}
        </div>
        <span className="ql-data__foot">
          {market.status === "unavailable"
            ? "Price feed is unavailable right now"
            : stale
              ? "Showing the last known price"
              : "Live from Flare's FTSOv2 price feed"}
        </span>
      </div>

      <div className="ql-data__cell">
        <span className="ql-data__label"><LockKeyhole size={14} /> Borrowing limits</span>
        <div className="ql-data__value">{limits} <small>%</small></div>
        <span className="ql-data__foot">Start / warning / liquidation</span>
      </div>

      <div className="ql-data__cell">
        <span className="ql-data__label"><HandCoins size={14} /> Vault liquidity</span>
        <div className="ql-data__value">
          {vaultText} {data ? <small>{usdt0Symbol}</small> : null}
        </div>
        <span className="ql-data__foot">
          {market.status === "unavailable"
            ? "Vault balance is unavailable right now"
            : "Available in the vault to borrow"}
        </span>
      </div>

      <div className="ql-data__cell">
        <span className="ql-data__label"><CloudCog size={14} /> Price updated</span>
        <div className="ql-data__value">
          {ageValue} {ageUnit ? <small>{ageUnit}</small> : null}
        </div>
        <span className="ql-data__foot">
          {data ? "Refreshes on its own" : "Waiting for the price feed"}
        </span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- landing */

function LandingPageContent() {
  const navRef = useReveal<HTMLElement>();
  const heroRef = useReveal<HTMLElement>();
  const proofRef = useReveal<HTMLDivElement>();
  const featuresRef = useReveal<HTMLElement>();
  const privacyRef = useReveal<HTMLElement>();
  const flowRef = useReveal<HTMLElement>();
  const quoteRef = useReveal<HTMLElement>();
  const dataRef = useReveal<HTMLElement>();
  const faqRef = useReveal<HTMLElement>();
  const ctaRef = useReveal<HTMLElement>();
  const footerRef = useReveal<HTMLElement>();
  const [pinned, setPinned] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { push } = useToast();

  useEffect(() => {
    const onScroll = () => setPinned(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const onDemo = () => push({ tone: "info", title: "Demo mode", body: "This page previews the product. Connect a Coston2 wallet inside the app to run it for real." });

  return (
    <>
      <Preloader />
      <div className="ql">
        <header ref={navRef} className={`ql-nav${pinned ? " ql-nav--pinned" : ""}`}>
          <a className="ql-brand" href="#main-content" aria-label="Quietline home">
            <span className="ql-brand__mark">Q</span>
            <span>Quietline</span>
          </a>
          <nav className={`ql-nav__links${menuOpen ? " ql-nav__links--open" : ""}`} aria-label="Sections">
            <a href="#product" onClick={() => setMenuOpen(false)}>Product</a>
            <a href="#privacy" onClick={() => setMenuOpen(false)}>Privacy</a>
            <a href="#how" onClick={() => setMenuOpen(false)}>How it works</a>
            <a href="#faq" onClick={() => setMenuOpen(false)}>FAQ</a>
          </nav>
          <div className="ql-nav__actions">
            <Link to="/app" className="button button--primary ql-nav__cta">Open app</Link>
            <button
              type="button"
              className="ql-menu icon-button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </header>

        <main id="main-content">
          <section ref={heroRef} className="ql-hero">
            <div className="ql-hero__grid" aria-hidden="true" />
            <div className="ql-hero__copy">
              <span className="ql-eyebrow"><span className="ql-pulse" /> Private credit on Flare</span>
              <h1>Quietline<span className="ql-thin">.</span></h1>
              <p className="ql-hero__tagline">Private credit, settled on Flare.</p>
              <p className="ql-hero__body">
                Borrow {usdt0Symbol} against your {fxrpSymbol}. Your balances and the terms you take
                stay private, so your numbers never become public.
              </p>
              <div className="ql-hero__actions">
                <Link to="/app" className="button button--primary button--large">
                  Enter Quietline <ArrowRight size={18} />
                </Link>
                <a href="#privacy" className="button button--secondary button--large">
                  See what stays private
                </a>
              </div>
              <div className="ql-hero__facts">
                <span><strong>FCC</strong>Confidential compute</span>
                <span><strong>{fxrpSymbol} → {usdt0Symbol}</strong>Collateral &amp; borrow</span>
                <span><strong>FTSOv2</strong>XRP/USD price</span>
                <span><strong>Private</strong>By design</span>
              </div>
            </div>
            <HeroStage />
          </section>

          <div ref={proofRef} className="ql-proof" aria-hidden="true">
            <div className="ql-proof__row">
              {[0, 1].map((copy) => (
                <div className="ql-proof__set" key={copy}>
                  <span><ShieldCheck size={18} /> <strong>Encrypted</strong> collateral &amp; debt</span>
                  <span><CloudCog size={18} /> <strong>FCC</strong> computes terms</span>
                  <span><Eye size={18} /> <strong>Public</strong> settlement on Coston2</span>
                  <span><LockKeyhole size={18} /> <strong>Private</strong> by design</span>
                </div>
              ))}
            </div>
          </div>

          <section ref={featuresRef} id="product" className="ql-section">
            <div className="ql-section__head">
              <span className="ql-eyebrow">Product</span>
              <h2>Private credit</h2>
              <p>
                Quietline is a private credit line on Flare. Deposit {fxrpSymbol}, borrow {usdt0Symbol},
                and keep your balances private while settlement happens in public.
              </p>
            </div>
            <div className="ql-features">
              <article className="ql-feature">
                <span className="ql-feature__icon"><LockKeyhole size={20} /></span>
                <h3>Borrow privately</h3>
                <p>Your collateral, debt, and the terms you take stay private and are only ever shown to you.</p>
                <Link to="/app/borrow">Get a private quote <ArrowRight size={15} /></Link>
              </article>
              <article className="ql-feature">
                <span className="ql-feature__icon"><HandCoins size={20} /></span>
                <h3>Lend on your terms</h3>
                <p>Credit lines run for a fixed number of days and are priced by the market, not by anyone's public profile.</p>
                <Link to="/app/earn">See the terms <ArrowRight size={15} /></Link>
              </article>
              <article className="ql-feature">
                <span className="ql-feature__icon"><ShieldCheck size={20} /></span>
                <h3>Stay in control</h3>
                <p>The limits that keep loans safe are public and easy to check. Your balances stay private.</p>
                <Link to="/app/position">See how limits work <ArrowRight size={15} /></Link>
              </article>
            </div>
          </section>

          <section ref={privacyRef} id="privacy" className="ql-section ql-section--ink ql-privacy">
            <div className="ql-privacy__intro">
              <span className="ql-eyebrow"><LockKeyhole size={12} /> Privacy</span>
              <h2>What stays private</h2>
              <p>
                Some details are yours to keep private. Others need to be public so the network can
                settle your loan. Here is exactly what sits on each side.
              </p>
              <p className="ql-privacy__rule">
                <strong>An honest promise:</strong> we never claim your deposits, payouts, wallet
                address, amounts, or timing are hidden. Those are always public.
              </p>
            </div>
            <PrivacyDeck />
          </section>

          <section ref={flowRef} id="how" className="ql-section">
            <div className="ql-section__head">
              <span className="ql-eyebrow">Process</span>
              <h2>How it works</h2>
              <p>Four steps, start to finish. Your private details are only ever readable inside a secure enclave.</p>
            </div>
            <ol className="ql-flow">
              <li>
                <span className="ql-flow__icon"><LockKeyhole size={20} /></span>
                <h3>Encrypt</h3>
                <p>Your details are locked on your device before anything is sent.</p>
              </li>
              <li>
                <span className="ql-flow__icon"><CloudCog size={20} /></span>
                <h3>Compute</h3>
                <p>A secure enclave on Flare checks the terms without ever exposing your numbers.</p>
              </li>
              <li>
                <span className="ql-flow__icon"><ShieldCheck size={20} /></span>
                <h3>Anchor</h3>
                <p>The signed result is recorded in the Quietline vault on Flare.</p>
              </li>
              <li>
                <span className="ql-flow__icon"><Check size={20} /></span>
                <h3>Settle</h3>
                <p>Payouts happen in public. Your private balances update just for you.</p>
              </li>
            </ol>
          </section>

          <section ref={quoteRef} id="quote" className="ql-section ql-section--tight">
            <QuotePreview />
          </section>

          <section ref={dataRef} className="ql-section">
            <div className="ql-section__head">
              <span className="ql-eyebrow">Live data</span>
              <h2>Live market data</h2>
              <p>The public numbers behind Quietline, read straight from Flare. They refresh on their own.</p>
            </div>
            <LiveMarketGrid />
          </section>

          <section ref={faqRef} id="faq" className="ql-section ql-faq">
            <div className="ql-section__head">
              <span className="ql-eyebrow">FAQ</span>
              <h2>Common questions</h2>
            </div>
            <div className="ql-faq__list">
              {FAQ_ITEMS.map((item) => (
                <details key={item.q}>
                  <summary>{item.q}<ChevronDown size={18} /></summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </section>

          <section ref={ctaRef} className="ql-cta">
            <div>
              <span className="ql-cta__kicker">Quietline</span>
              <h2>Start a private credit line</h2>
              <p>Connect a Coston2 wallet and get a private quote in minutes.</p>
            </div>
            <div className="ql-hero__actions">
              <Link to="/app" className="button button--primary button--large" onClick={onDemo}>
                Enter Quietline <ArrowRight size={18} />
              </Link>
            </div>
          </section>
        </main>

        <footer ref={footerRef} className="ql-footer">
          <div className="ql-footer__col">
            <span className="ql-brand"><span className="ql-brand__mark">Q</span>Quietline</span>
            <p>Private credit, settled on Flare.</p>
          </div>
          <div className="ql-footer__col">
            <span>Product</span>
            <a href="#product">Product</a>
            <a href="#privacy">Privacy</a>
            <a href="#how">How it works</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="ql-footer__col">
            <span>Protocol</span>
            <a href="https://coston2-explorer.flare.network" target="_blank" rel="noreferrer">Coston2 explorer</a>
            <Link to="/app">Open the app</Link>
          </div>
        </footer>
      </div>
    </>
  );
}

export function LandingPage() {
  return (
    <ToastProvider>
      <LandingPageContent />
    </ToastProvider>
  );
}
