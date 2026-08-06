import {
  ArrowRight,
  BadgeCheck,
  Blocks,
  ChevronRight,
  CircleDollarSign,
  Code2,
  Eye,
  EyeOff,
  FileCheck2,
  Gauge,
  LockKeyhole,
  Menu,
  Network,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Status, ToastProvider } from "../components/ui";

const faqs = [
  {
    question: "Are deposits invisible on Flare?",
    answer:
      "No. Token transfers, wallet addresses, payouts, withdrawals, and timing remain public. Quietline keeps the internal credit terms and accounting private.",
  },
  {
    question: "Who can see my loan details?",
    answer:
      "Your browser decrypts your private account response. The active confidential environment sees plaintext while computing. The relayer and public chain receive ciphertext or constrained settlement data.",
  },
  {
    question: "What assets does the hackathon release support?",
    answer:
      "The committed Coston2 market is FXRP collateral against USD₮0 liquidity, with 7, 14, and 30 day fixed terms.",
  },
  {
    question: "Is this ready for production funds?",
    answer:
      "No. Quietline is a testnet protocol built for technical evaluation. It has not completed a production audit or decentralized TEE rollout.",
  },
];

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    };
    document.addEventListener("keydown", closeOnEscape);
    window.requestAnimationFrame(() => menuRef.current?.querySelector("a")?.focus());
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);
  return (
    <ToastProvider>
      <div className="landing">
        <header className="landing-nav">
          <Link className="wordmark wordmark--landing" to="/">
            <span className="wordmark__mark" aria-hidden="true">
              Q
            </span>
            Quietline
          </Link>
          <nav
            id="landing-navigation"
            ref={menuRef}
            className={menuOpen ? "landing-nav__links landing-nav__links--open" : "landing-nav__links"}
          >
            <a href="#product" onClick={() => setMenuOpen(false)}>
              Product
            </a>
            <a href="#privacy" onClick={() => setMenuOpen(false)}>
              Privacy
            </a>
            <a href="#how-it-works" onClick={() => setMenuOpen(false)}>
              How it works
            </a>
            <a href="#faq" onClick={() => setMenuOpen(false)}>
              FAQ
            </a>
          </nav>
          <div className="landing-nav__actions">
            <Link className="button button--primary" to="/app">
              Open app <ArrowRight size={17} />
            </Link>
            <button
              ref={menuButtonRef}
              className="icon-button landing-menu"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-controls="landing-navigation"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
            >
              {menuOpen ? <X size={19} /> : <Menu size={19} />}
            </button>
          </div>
        </header>

        <main id="main-content">
          <section className="hero">
            <div className="hero__copy">
              <div className="eyebrow">
                <span className="status-dot" />
                Built for Flare Confidential Compute
              </div>
              <h1>Quietline</h1>
              <p className="hero__tagline">Private credit, settled on Flare.</p>
              <p className="hero__body">
                Borrow USD₮0 against FXRP without publishing your lender terms, debt,
                health, or liquidation calculations to the market.
              </p>
              <div className="hero__actions">
                <Link className="button button--primary button--large" to="/app">
                  Enter Quietline <ArrowRight size={18} />
                </Link>
                <a className="button button--secondary button--large" href="#privacy">
                  Read the privacy boundary
                </a>
              </div>
              <div className="hero__facts" aria-label="Protocol facts">
                <span>
                  <strong>50%</strong> initial LTV
                </span>
                <span>
                  <strong>7 / 14 / 30</strong> day terms
                </span>
                <span>
                  <strong>FTSOv2</strong> XRP/USD
                </span>
              </div>
            </div>

            <div className="hero-ledger" aria-label="Quietline product preview">
              <div className="hero-ledger__top">
                <div>
                  <span className="hero-ledger__brand">Private credit account</span>
                  <strong>FXRP / USD₮0</strong>
                </div>
                <Status tone="healthy">Confidential</Status>
              </div>
              <div className="ledger-line ledger-line--current">
                <span>Collateral</span>
                <strong>Encrypted</strong>
                <LockKeyhole size={15} />
              </div>
              <div className="ledger-line">
                <span>Debt</span>
                <strong>Encrypted</strong>
                <LockKeyhole size={15} />
              </div>
              <div className="ledger-line">
                <span>Borrower APR</span>
                <strong>Encrypted</strong>
                <LockKeyhole size={15} />
              </div>
              <div className="hero-ledger__risk">
                <div>
                  <span>Health factor</span>
                  <strong>Private</strong>
                </div>
                <div className="risk-track">
                  <span style={{ width: "71%" }} />
                  <i style={{ left: "84%" }} />
                </div>
                <div className="risk-labels">
                  <span>Healthy</span>
                  <span>Liquidation</span>
                </div>
              </div>
              <div className="hero-ledger__settlement">
                <div className="settlement-node settlement-node--done">
                  <BadgeCheck size={15} /> Wallet authorized
                </div>
                <div className="settlement-node settlement-node--active">
                  <Sparkles size={15} /> FCC computes privately
                </div>
                <div className="settlement-node">
                  <Blocks size={15} /> Vault settles publicly
                </div>
              </div>
              <div className="ledger-signature" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>
          </section>

          <section className="proof-band" aria-label="Protocol properties">
            <div>
              <ShieldCheck size={19} />
              <span>TEE-confidential credit engine</span>
            </div>
            <div>
              <Network size={19} />
              <span>Native FCC instruction flow</span>
            </div>
            <div>
              <FileCheck2 size={19} />
              <span>Root-anchored private accounting</span>
            </div>
            <div>
              <Gauge size={19} />
              <span>FTSOv2 risk observations</span>
            </div>
          </section>

          <section id="product" className="landing-section product-section">
            <div className="section-heading">
              <span>Private market, public settlement</span>
              <h2>Credit decisions happen away from the public mempool.</h2>
              <p>
                Quietline separates what the chain must enforce from what the market
                does not need to know.
              </p>
            </div>
            <div className="feature-grid">
              <article>
                <div className="feature-icon"><CircleDollarSign size={22} /></div>
                <h3>Confidential lender mandates</h3>
                <p>
                  Lenders define amount, minimum APR, term eligibility, and borrower
                  caps inside FCC. Those mandates and match details are not published
                  on-chain.
                </p>
              </article>
              <article>
                <div className="feature-icon"><Gauge size={22} /></div>
                <h3>Private risk computation</h3>
                <p>
                  Debt accrual, LTV, health, warning state, stress checks, and
                  liquidation calculations stay in the confidential ledger.
                </p>
              </article>
              <article>
                <div className="feature-icon"><Blocks size={22} /></div>
                <h3>Constrained vault settlement</h3>
                <p>
                  QuietVault only executes fresh, sequential, TEE-signed payouts and
                  withdrawals under hard token and amount caps.
                </p>
              </article>
            </div>
          </section>

          <section id="privacy" className="privacy-section">
            <div className="privacy-section__intro">
              <span className="section-kicker">No privacy theater</span>
              <h2>Some facts stay private. Some facts cannot.</h2>
              <p>
                Quietline names the boundary directly so users and judges can evaluate
                the actual system.
              </p>
            </div>
            <div className="privacy-columns">
              <article className="privacy-column privacy-column--private">
                <header>
                  <EyeOff size={22} />
                  <div>
                    <span>Confidential</span>
                    <h3>Kept inside FCC</h3>
                  </div>
                </header>
                <ul>
                  <li><ChevronRight size={15} /> Internal FXRP and USD₮0 balances</li>
                  <li><ChevronRight size={15} /> Lender mandates before and after matching</li>
                  <li><ChevronRight size={15} /> Debt, APR, health, and liquidation price</li>
                  <li><ChevronRight size={15} /> Private activity and stress results</li>
                </ul>
              </article>
              <article className="privacy-column privacy-column--public">
                <header>
                  <Eye size={22} />
                  <div>
                    <span>Public</span>
                    <h3>Visible on Coston2</h3>
                  </div>
                </header>
                <ul>
                  <li><ChevronRight size={15} /> Wallet addresses and transaction timing</li>
                  <li><ChevronRight size={15} /> Deposits, payouts, and withdrawals</li>
                  <li><ChevronRight size={15} /> State roots and settlement sequence</li>
                  <li><ChevronRight size={15} /> The TEE sees plaintext while computing</li>
                </ul>
              </article>
            </div>
          </section>

          <section id="how-it-works" className="landing-section how-section">
            <div className="section-heading">
              <span>One request, three trust zones</span>
              <h2>A credit line from wallet intent to final settlement.</h2>
            </div>
            <ol className="how-flow">
              <li>
                <div className="how-flow__number">1</div>
                <div className="how-flow__icon"><LockKeyhole size={21} /></div>
                <h3>Encrypt</h3>
                <p>Your wallet signs a typed request. The browser encrypts it to the attested FCC key.</p>
              </li>
              <li>
                <div className="how-flow__number">2</div>
                <div className="how-flow__icon"><Code2 size={21} /></div>
                <h3>Compute</h3>
                <p>The confidential engine validates policy, matches liquidity, and updates its private ledger.</p>
              </li>
              <li>
                <div className="how-flow__number">3</div>
                <div className="how-flow__icon"><Blocks size={21} /></div>
                <h3>Anchor</h3>
                <p>A signed root transition reaches QuietVault, which enforces sequence, replay, asset, and cap rules.</p>
              </li>
              <li>
                <div className="how-flow__number">4</div>
                <div className="how-flow__icon"><CircleDollarSign size={21} /></div>
                <h3>Settle</h3>
                <p>Only the required token movement becomes public. Your full credit state does not.</p>
              </li>
            </ol>
          </section>

          <section className="cta-band">
            <div>
              <span>Quietline on Coston2</span>
              <h2>Run private credit on Coston2.</h2>
              <p>Connect a funded wallet, deposit FXRP, receive a live lender quote, borrow USD₮0, stress the position, and repay.</p>
            </div>
            <Link className="button button--primary button--large" to="/app">
              Open the application <ArrowRight size={18} />
            </Link>
          </section>

          <section id="faq" className="landing-section faq-section">
            <div className="section-heading">
              <span>Questions that matter</span>
              <h2>Privacy, assets, and trust.</h2>
            </div>
            <div className="faq-list">
              {faqs.map((item) => (
                <details key={item.question}>
                  <summary>{item.question}<ChevronRight size={18} /></summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </section>
        </main>

        <footer className="landing-footer">
          <div>
            <Link className="wordmark" to="/">
              <span className="wordmark__mark" aria-hidden="true">Q</span>
              Quietline
            </Link>
            <p>Private credit, settled on Flare.</p>
          </div>
          <div>
            <span>Protocol</span>
            <a href="#privacy">Privacy boundary</a>
            <a href="#how-it-works">Architecture</a>
            <Link to="/app">Coston2 app</Link>
          </div>
          <div>
            <span>Notice</span>
            <p>Testnet software. Unaudited. No production funds.</p>
          </div>
        </footer>
      </div>
    </ToastProvider>
  );
}
