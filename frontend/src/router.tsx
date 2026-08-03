import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "./components/AppShell";

const LandingPage = lazy(() =>
  import("./pages/LandingPage").then((module) => ({ default: module.LandingPage })),
);
const OverviewPage = lazy(() =>
  import("./pages/OverviewPage").then((module) => ({ default: module.OverviewPage })),
);
const BorrowPage = lazy(() =>
  import("./pages/BorrowPage").then((module) => ({ default: module.BorrowPage })),
);
const EarnPage = lazy(() =>
  import("./pages/EarnPage").then((module) => ({ default: module.EarnPage })),
);
const ActivityPage = lazy(() =>
  import("./pages/ActivityPage").then((module) => ({ default: module.ActivityPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);
const PositionPage = lazy(() =>
  import("./pages/PositionPage").then((module) => ({ default: module.PositionPage })),
);

function deferred(node: ReactNode) {
  return (
    <Suspense fallback={<div className="route-skeleton" aria-label="Loading page" />}>
      {node}
    </Suspense>
  );
}

export const router = createBrowserRouter([
  { path: "/", element: deferred(<LandingPage />) },
  {
    path: "/app",
    element: <AppShell />,
    children: [
      { index: true, element: deferred(<OverviewPage />) },
      { path: "borrow", element: deferred(<BorrowPage />) },
      { path: "earn", element: deferred(<EarnPage />) },
      { path: "activity", element: deferred(<ActivityPage />) },
      { path: "settings", element: deferred(<SettingsPage />) },
      { path: "position", element: deferred(<PositionPage />) },
    ],
  },
]);
