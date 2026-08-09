import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
import { AssetBadge, Button, HealthScale, PrivacyLabel, Status, ToastProvider, useToast } from "../components/ui";
import fxrpLogo from "../assets/fxrp.svg";
import usdtLogo from "../assets/usdt.svg";
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

/* ------------------------------------------------------------ floating coin */

const COIN_CONFIG = [
  { asset: fxrp, className: "ql-coin--fxrp", dur: "6.2s", delay: "0s", tilt: "-8deg" },
  { asset: usdt0, className: "ql-coin--usdt", dur: "7s", delay: "0.7s", tilt: "10deg" },
  { asset: fxrp, className: "ql-coin--xrp2", dur: "5.4s", delay: "1.3s", tilt: "4deg" },
] as const;

function FloatingCoin({ config }: { config: (typeof COIN_CONFIG)[number] }) {
  const node = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const el = node.current;
    if (!el) return;
    const parent = el.parentElement as HTMLElement | null;
    if (!parent) return;
    const speed = config.asset === fxrp ? 0.05 : 0.035;
    let raf = 0;
    const onScroll = () => {
      const rect = parent.getBoundingClientRect();
      const travel = (window.innerHeight - rect.top - rect.height) * speed;
      el.style.transform = `translate3d(0, ${Math.max(0, travel)}px, 0)`;
    };
    raf = window.requestAnimationFrame(onScroll);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, [config.asset]);
  return (
    <span
      ref={node}
      className={`ql-coin ${config.className}`}
      style={{ "--dur": config.dur, "--delay": config.delay, "--tilt": config.tilt } as CSSProperties}
      aria-hidden="true"
    >
      <span className="ql-coin__float">
        <img src={config.asset === fxrp ? fxrpLogo : usdtLogo} alt="" />
      </span>
    </span>
  );
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
    { key: "encrypt", label: "Encrypt", detail: "private request sealed for FCC", icon: LockKeyhole },
    { key: "compute", label: "Compute", detail: "terms evaluated inside TEE", icon: CloudCog },
    { key: "settle", label: "Settle", detail: "payout anchors on Coston2", icon: Check },
  ] as const;
  const [encryptDone, computeDone, settleDone] = [phase > 0, phase > 1, phase > 2];

  const handleRefresh = () => {
    if (prefersReducedMotion()) {
      push({ tone: "info", title: "Live preview needs motion", body: "Enable motion to see the pipeline run." });
      return;
    }
    setPhase(0);
    push({ tone: "info", title: "Private account refreshed", body: "The preview shows the current demo state." });
  };

  return (
    <div ref={wrap} className="ql-stage">
      <FloatingCoin config={COIN_CONFIG[0]} />
      <FloatingCoin config={COIN_CONFIG[1]} />
      <FloatingCoin config={COIN_CONFIG[2]} />
      <div ref={card} className="ql-card3d">
        <span className="ql-annot ql-annot--tl" aria-hidden="true"><span className="ql-tick" /> decrypts only in this session</span>
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
        <span className="ql-annot ql-annot--br" aria-hidden="true">vault settles on Coston2 <span className="ql-tick" /></span>
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
          <span><LockKeyhole size={14} /> Confidential quote</span>
          <span><Sparkles size={14} /> FCC computes</span>
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
              {working ? "Encrypting & computing" : "Compute private quote"}
            </Button>
            <p className="ql-quote__note">
              <Eye size={14} aria-hidden="true" />
              <span>The quote is computed inside Flare Confidential Compute and never leaves the enclave in plaintext.</span>
            </p>
          </div>
        </div>
      </div>

      <div className="ql-quote__aside">
        <span className="ql-eyebrow"><span className="ql-pulse" /> try the mechanism</span>
        <h2>See what a private quote feels like.</h2>
        <p>
          Move the collateral and watch the numbers stay private. Borrowable amounts follow the
          live protocol policy: {POLICY.initialLtvBps / 100}% initial LTV, {POLICY.liquidationLtvBps / 100}% liquidation.
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
    a: "Your collateral, debt, health, and the terms you accept are encrypted and only decrypted for your session. The payout amount, destination, and settlement receipt are public on Coston2 — that is the boundary Quietline is built on.",
  },
  {
    q: "Where does the credit decision happen?",
    a: "Inside Flare Confidential Compute. The FCC receives the encrypted account state, evaluates the fixed policy, and issues a signed settlement — no human or operator ever sees your numbers in plaintext.",
  },
  {
    q: "How is the XRP price sourced?",
    a: "Quietline uses FTSOv2 on Flare. The XRP/USD feed is a public oracle signal; it is only used to size your credit line and monitor health, never to expose your private balances.",
  },
  {
    q: "Is this on mainnet?",
    a: "Not yet. Quietline is live on Coston2, Flare's testnet, while the protocol and its confidential-compute workload are audited.",
  },
];

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
              <span className="ql-eyebrow"><span className="ql-pulse" /> Built for Flare Confidential Compute</span>
              <h1>Quietline<span className="ql-thin">.</span></h1>
              <p className="ql-hero__tagline">Private credit, settled on Flare.</p>
              <p className="ql-hero__body">
                Borrow {usdt0Symbol} against {fxrpSymbol} — lender terms are evaluated inside a
                confidential environment, so your numbers never leave your session in plaintext.
              </p>
              <div className="ql-hero__actions">
                <Link to="/app" className="button button--primary button--large">
                  Enter Quietline <ArrowRight size={18} />
                </Link>
                <a href="#privacy" className="button button--secondary button--large">
                  Read the privacy boundary
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
              <h2>Credit that respects the boundary.</h2>
              <p>
                Quietline is a confidential credit line for Flare. Deposit {fxrpSymbol}, borrow
                {usdt0Symbol}, and let the protocol — not you — decide what is visible.
              </p>
            </div>
            <div className="ql-features">
              <article className="ql-feature">
                <span className="ql-feature__icon"><LockKeyhole size={20} /></span>
                <h3>Borrow privately</h3>
                <p>Your collateral, debt, and accepted terms are encrypted and only decrypted for your session.</p>
                <Link to="/app/borrow">Request a private quote <ArrowRight size={15} /></Link>
              </article>
              <article className="ql-feature">
                <span className="ql-feature__icon"><HandCoins size={20} /></span>
                <h3>Lend on your terms</h3>
                <p>Fixed-day credit lines evaluated inside Flare Confidential Compute — the market decides, not a borrower's public profile.</p>
                <Link to="/app/earn">See the terms <ArrowRight size={15} /></Link>
              </article>
              <article className="ql-feature">
                <span className="ql-feature__icon"><ShieldCheck size={20} /></span>
                <h3>Manage risk clearly</h3>
                <p>Health, LTV, and liquidation thresholds are public signals. Your balances stay private.</p>
                <Link to="/app/position">Inspect the risk model <ArrowRight size={15} /></Link>
              </article>
            </div>
          </section>

          <section ref={privacyRef} id="privacy" className="ql-section ql-section--ink ql-privacy">
            <div className="ql-privacy__intro">
              <span className="ql-eyebrow"><LockKeyhole size={12} /> The boundary</span>
              <h2>Some facts stay private. Some cannot.</h2>
              <p>
                Quietline encrypts what is yours and anchors what the network needs. Every screen in the
                product labels which side of the boundary it lives on.
              </p>
              <p className="ql-privacy__rule">
                <strong>Privacy rule:</strong> never claim deposits, payouts, wallet addresses, amounts,
                or timing are hidden.
              </p>
            </div>
            <div className="ql-columns">
              <div className="ql-column ql-column--private">
                <header>
                  <LockKeyhole size={20} />
                  <div><PrivacyLabel scope="private" /><h3>Private</h3></div>
                </header>
                <ul>
                  <li><LockKeyhole size={14} /> Collateral and debt balances</li>
                  <li><LockKeyhole size={14} /> Health and accrued interest</li>
                  <li><LockKeyhole size={14} /> Accepted lending terms</li>
                </ul>
              </div>
              <div className="ql-column ql-column--public">
                <header>
                  <Eye size={20} />
                  <div><PrivacyLabel scope="public" /><h3>Public</h3></div>
                </header>
                <ul>
                  <li><Eye size={14} /> Vault token balances</li>
                  <li><Eye size={14} /> Settlement receipts and payouts</li>
                  <li><Eye size={14} /> FTSOv2 price signals</li>
                </ul>
              </div>
            </div>
          </section>

          <section ref={flowRef} id="how" className="ql-section">
            <div className="ql-section__head">
              <span className="ql-eyebrow">How it works</span>
              <h2>Encrypt. Compute. Anchor. Settle.</h2>
              <p>Four steps, one continuous pipeline. Plaintext exists only inside the enclave.</p>
            </div>
            <ol className="ql-flow">
              <li>
                <span className="ql-flow__icon"><LockKeyhole size={20} /></span>
                <h3>Encrypt</h3>
                <p>Your account state and request are sealed before they leave the browser.</p>
              </li>
              <li>
                <span className="ql-flow__icon"><CloudCog size={20} /></span>
                <h3>Compute</h3>
                <p>Flare Confidential Compute evaluates the fixed policy inside a TEE.</p>
              </li>
              <li>
                <span className="ql-flow__icon"><ShieldCheck size={20} /></span>
                <h3>Anchor</h3>
                <p>A signed settlement is committed to the QuietVault on Coston2.</p>
              </li>
              <li>
                <span className="ql-flow__icon"><Check size={20} /></span>
                <h3>Settle</h3>
                <p>Payouts are public; your private ledger updates only for you.</p>
              </li>
            </ol>
          </section>

          <section ref={quoteRef} id="quote" className="ql-section ql-section--tight">
            <QuotePreview />
          </section>

          <section ref={dataRef} className="ql-section">
            <div className="ql-section__head">
              <span className="ql-eyebrow">Public signals</span>
              <h2>Market context, live.</h2>
              <p>Everything the network sees — prices, vault holdings, LTV thresholds — in one panel.</p>
            </div>
            <div className="ql-data">
              <div className="ql-data__cell">
                <span className="ql-data__label"><ShieldCheck size={14} /> XRP/USD · FTSOv2</span>
                <div className="ql-data__value">$2.38 <small>· 30d</small></div>
                <svg className="ql-spark" viewBox="0 0 200 52" preserveAspectRatio="none" aria-hidden="true">
                  <path className="ql-spark__area" d="M0,42 L18,38 L36,40 L54,32 L72,34 L90,24 L108,27 L126,18 L144,20 L162,10 L180,14 L200,6 L200,52 L0,52 Z" />
                  <path d="M0,42 L18,38 L36,40 L54,32 L72,34 L90,24 L108,27 L126,18 L144,20 L162,10 L180,14 L200,6" />
                </svg>
              </div>
              <div className="ql-data__cell">
                <span className="ql-data__label"><LockKeyhole size={14} /> LTV thresholds</span>
                <div className="ql-data__value">50 / 55 / 65 <small>%</small></div>
                <svg className="ql-spark ql-spark--flare" viewBox="0 0 200 52" preserveAspectRatio="none" aria-hidden="true">
                  <path className="ql-spark__area" d="M0,50 L30,50 L60,48 L90,50 L120,44 L150,40 L180,30 L200,24 L200,52 L0,52 Z" />
                  <path d="M0,50 L30,50 L60,48 L90,50 L120,44 L150,40 L180,30 L200,24" />
                </svg>
              </div>
              <div className="ql-data__cell">
                <span className="ql-data__label"><HandCoins size={14} /> Vault holdings</span>
                <div className="ql-data__value">2.4M <small>{usdt0Symbol}</small></div>
              </div>
              <div className="ql-data__cell">
                <span className="ql-data__label"><CloudCog size={14} /> Oracle age</span>
                <div className="ql-data__value">2 <small>sec</small></div>
              </div>
            </div>
          </section>

          <section ref={faqRef} id="faq" className="ql-section ql-faq">
            <div className="ql-section__head">
              <span className="ql-eyebrow">FAQ</span>
              <h2>Questions, answered plainly.</h2>
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
              <h2>Your credit line, on your terms.</h2>
              <p>Connect a Coston2 wallet and request a confidential quote in minutes.</p>
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
