import {
  Activity,
  BadgeDollarSign,
  BookOpen,
  ChevronDown,
  Copy,
  ExternalLink,
  Gauge,
  HandCoins,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAccount, useDisconnect } from "wagmi";
import { COSTON2 } from "@quietline/protocol";
import { getHealth, getMarket } from "../lib/api";
import { useQuietline } from "../store/useQuietline";
import { IconButton, Status, ToastProvider, useToast } from "./ui";

const nav = [
  { to: "/app", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/app/borrow", label: "Borrow", icon: HandCoins },
  { to: "/app/earn", label: "Earn", icon: BadgeDollarSign },
  { to: "/app/activity", label: "Activity", icon: Activity },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

export function AppShell() {
  return (
    <ToastProvider>
      <AppShellInner />
    </ToastProvider>
  );
}

function AppShellInner() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const hasHydrated = useQuietline((state) => state.hasHydrated);
  const address = useQuietline((state) => state.address);
  const sessionExpiresAt = useQuietline((state) => state.sessionExpiresAt);
  const position = useQuietline((state) => state.position);
  const privateUpdatedAt = useQuietline((state) => state.privateUpdatedAt);
  const notifications = useQuietline((state) => state.notifications);
  const lock = useQuietline((state) => state.lock);
  const disconnect = useQuietline((state) => state.disconnect);
  const marketPriceE6 = useQuietline((state) => state.marketPriceE6);
  const marketUpdatedAt = useQuietline((state) => state.marketUpdatedAt);
  const marketStatus = useQuietline((state) => state.marketStatus);
  const hydrateMarket = useQuietline((state) => state.hydrateMarket);
  const markMarketUnavailable = useQuietline((state) => state.markMarketUnavailable);
  const serviceHealth = useQuietline((state) => state.serviceHealth);
  const hydrateHealth = useQuietline((state) => state.hydrateHealth);
  const navigate = useNavigate();
  const walletAccount = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { push } = useToast();
  const notified = useRef(new Set<string>());
  useEffect(() => {
    let active = true;
    const refreshMarket = async () => {
      const [market, health] = await Promise.allSettled([
        getMarket(),
        getHealth(),
      ]);
      if (!active) return;
      if (market.status === "fulfilled") {
        hydrateMarket(market.value);
      } else {
        markMarketUnavailable();
      }
      if (health.status === "fulfilled") {
        hydrateHealth(health.value);
      } else {
        hydrateHealth({
          status: "degraded",
          services: {
            api: "unavailable",
            database: "unavailable",
            fcc: "unavailable",
          },
          timestamp: new Date().toISOString(),
        });
      }
    };
    void refreshMarket();
    const timer = window.setInterval(() => void refreshMarket(), 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [hydrateHealth, hydrateMarket, markMarketUnavailable]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyWidth = document.body.style.width;
    const previousRootOverflow = document.documentElement.style.overflow;
    const scrollPosition = window.scrollY;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        document.querySelector<HTMLElement>(".mobile-menu-button"),
        ...Array.from(
          document.querySelectorAll<HTMLElement>(
            '#quietline-secondary-menu a[href], #quietline-secondary-menu button:not([disabled]), #quietline-secondary-menu [tabindex]:not([tabindex="-1"])',
          ),
        ),
      ].filter((element): element is HTMLElement => element !== null);
      if (!focusable.length) return;
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? current <= 0 ? focusable.length - 1 : current - 1
        : current < 0 || current === focusable.length - 1 ? 0 : current + 1;
      event.preventDefault();
      focusable[next]?.focus();
    };
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollPosition}px`;
    document.body.style.width = "100%";
    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.width = previousBodyWidth;
      document.documentElement.style.overflow = previousRootOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      window.scrollTo(0, scrollPosition);
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (!sessionExpiresAt) return;
    const remaining = sessionExpiresAt - Date.now();
    if (remaining <= 0) {
      lock();
      return;
    }
    const timer = window.setTimeout(() => {
      lock();
      push({
        tone: "info",
        title: "Private session locked",
        body: "The signed relayer session expired and decrypted account data was cleared.",
      });
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [lock, push, sessionExpiresAt]);

  useEffect(() => {
    if (!hasHydrated || !address) return;
    if (
      walletAccount.status === "connecting" ||
      walletAccount.status === "reconnecting"
    ) {
      return;
    }
    if (!walletAccount.isConnected || !walletAccount.address) {
      const timer = window.setTimeout(() => {
        const current = useQuietline.getState();
        if (current.address === address) disconnect();
      }, 2_000);
      return () => window.clearTimeout(timer);
    }
    if (walletAccount.address.toLowerCase() !== address.toLowerCase()) {
      disconnect();
      push({
        tone: "warning",
        title: "Wallet account changed",
        body: "Open a new private session for the selected account.",
      });
    }
  }, [
    address,
    disconnect,
    hasHydrated,
    push,
    walletAccount.address,
    walletAccount.isConnected,
    walletAccount.status,
  ]);

  useEffect(() => {
    if (!position || !privateUpdatedAt) return;
    if (
      notifications.health &&
      ["restricted", "warning", "liquidatable"].includes(position.status)
    ) {
      const key = `${position.id}:health:${position.status}`;
      if (!notified.current.has(key)) {
        notified.current.add(key);
        push({
          tone: position.status === "liquidatable" ? "error" : "warning",
          title:
            position.status === "liquidatable"
              ? "Position is liquidatable"
              : "Private health warning",
          body: "This status was decrypted from the latest FCC account refresh.",
        });
      }
    }
  }, [notifications.health, position, privateUpdatedAt, push]);

  useEffect(() => {
    if (!position) return;
    const checkMaturity = () => {
      const seconds = position.maturesAt - Math.floor(Date.now() / 1000);
      const thresholds = [
        { enabled: notifications.maturity24h, seconds: 86_400, label: "24 hours" },
        { enabled: notifications.maturity1h, seconds: 3_600, label: "1 hour" },
      ];
      for (const threshold of thresholds) {
        const key = `${position.id}:maturity:${threshold.seconds}`;
        if (
          threshold.enabled &&
          seconds > 0 &&
          seconds <= threshold.seconds &&
          !notified.current.has(key)
        ) {
          notified.current.add(key);
          push({
            tone: "warning",
            title: `Position matures within ${threshold.label}`,
            body: "Repay the private credit line before the grace period ends.",
          });
        }
      }
    };
    checkMaturity();
    const timer = window.setInterval(checkMaturity, 60_000);
    return () => window.clearInterval(timer);
  }, [notifications.maturity1h, notifications.maturity24h, position, push]);

  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not connected";
  const marketPrice = marketPriceE6
    ? `$${(marketPriceE6 / 1_000_000).toFixed(4)}`
    : marketStatus === "unavailable"
      ? "Unavailable"
      : "Loading";
  const marketAge = marketUpdatedAt
    ? `${Math.max(0, Math.floor(Date.now() / 1000 - marketUpdatedAt))}s`
    : "--";
  if (!hasHydrated) {
    return <div className="route-skeleton" aria-label="Restoring wallet session" />;
  }
  return (
    <div className="app-frame">
      <header className="app-header">
        <div className="app-header__left">
          <NavLink className="wordmark" to="/">
            <span className="wordmark__mark" aria-hidden="true">
              Q
            </span>
            Quietline
          </NavLink>
          <span className="network-badge">Coston2</span>
        </div>
        <nav className="desktop-nav" aria-label="Quietline application">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} {...(item.end ? { end: true } : {})}>
                <Icon aria-hidden="true" size={16} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="app-header__signals">
          <Status tone={serviceHealth?.services.fcc === "ok" ? "healthy" : serviceHealth ? "warning" : "neutral"}>
            <span className="status-dot" aria-hidden="true" />
            FCC {serviceHealth?.services.fcc === "ok" ? "Online" : serviceHealth ? "Unavailable" : "Checking"}
          </Status>
          <div className="price-ticker">
            <span>XRP/USD</span>
            <strong>{marketPrice}</strong>
            <small>{marketAge}</small>
          </div>
          <div className="wallet-control">
            <button
              className="wallet-button"
              onClick={() => setWalletOpen((value) => !value)}
              aria-expanded={walletOpen}
            >
              <span className="wallet-avatar" aria-hidden="true" />
              {shortAddress}
              <ChevronDown aria-hidden="true" size={15} />
            </button>
            {walletOpen ? (
              <div className="wallet-menu">
                <div className="wallet-menu__address">
                  <span>{address ?? "No wallet session"}</span>
                  {address ? (
                    <div>
                      <IconButton
                        icon={Copy}
                        label="Copy wallet address"
                        onClick={() => {
                          void navigator.clipboard.writeText(address);
                          push({ tone: "success", title: "Address copied" });
                        }}
                      />
                      <IconButton
                        icon={ExternalLink}
                        label="Open wallet in explorer"
                        onClick={() =>
                          window.open(`${COSTON2.explorerUrl}/address/${address}`, "_blank")
                        }
                      />
                    </div>
                  ) : null}
                </div>
                <button onClick={() => {
                  lock();
                  setWalletOpen(false);
                }}>
                  <LockKeyhole size={16} /> Lock private data
                </button>
                <button
                  onClick={() => void (async () => {
                    await disconnectAsync();
                    disconnect();
                    navigate("/app");
                    setWalletOpen(false);
                  })()}
                >
                  <X size={16} /> Disconnect
                </button>
              </div>
            ) : null}
          </div>
          <IconButton
            className="mobile-menu-button"
            icon={mobileOpen ? X : Menu}
            label={mobileOpen ? "Close protocol menu" : "Open protocol menu"}
            aria-controls="quietline-secondary-menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((value) => !value)}
          />
        </div>
      </header>

      {mobileOpen ? (
        <div
          className="sidebar-scrim"
          role="presentation"
          onMouseDown={() => setMobileOpen(false)}
        />
      ) : null}

      <aside id="quietline-secondary-menu" className={`secondary-menu ${mobileOpen ? "secondary-menu--open" : ""}`}>
        <div className="secondary-menu__heading">
          <span>Protocol</span>
          <strong>Quietline on Coston2</strong>
        </div>
        <nav aria-label="Protocol resources">
          <a href="/#privacy">
            <ShieldCheck size={16} /> Privacy model
          </a>
          <a href={COSTON2.explorerUrl} target="_blank" rel="noreferrer">
            <Gauge size={16} /> Coston2 deployment
          </a>
          <a href="/#how-it-works">
            <BookOpen size={16} /> How it works
          </a>
        </nav>
        <span className="secondary-menu__version">v0.1.0 / Coston2 testnet</span>
      </aside>

      <main id="main-content" className="app-main" aria-hidden={mobileOpen || undefined}>
        <Outlet />
      </main>

      <nav
        className="mobile-nav"
        aria-label="Mobile application navigation"
        aria-hidden={mobileOpen || undefined}
      >
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.to} to={item.to} {...(item.end ? { end: true } : {})}>
              <Icon aria-hidden="true" size={19} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
