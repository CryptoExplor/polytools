import { lazy, Suspense } from "react";
import { HashRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { AppProvider } from "./lib/store";
import { Layout } from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import { accountRedirectTarget } from "./lib/navigation";

/**
 * Every route except the landing page is a separate chunk. The initial download
 * now carries the shell, the landing page, and whatever the reader opens; the
 * rest arrives on demand. `npm run check:performance` budgets the initial bytes.
 */
const Tape = lazy(() => import("./pages/Tape"));
const Book = lazy(() => import("./pages/Book"));
const Charts = lazy(() => import("./pages/Charts"));
const HeatmapPage = lazy(() =>
  import("./pages/Heatmap").then((module) => ({ default: module.HeatmapPage })),
);
const Compare = lazy(() => import("./pages/Compare"));
const Zipper = lazy(() => import("./pages/Zipper"));
const Calc = lazy(() => import("./pages/Calc"));
const Hub = lazy(() => import("./pages/Hub"));
const Portfolio = lazy(() => import("./pages/Portfolio"));
const SdkGuide = lazy(() => import("./pages/SdkGuide"));
const BrandKitPage = lazy(() =>
  import("./pages/BrandKit").then((module) => ({ default: module.BrandKitPage })),
);

function RoutePending() {
  return (
    <div className="page-stack" role="status" aria-live="polite">
      <div className="panel" style={{ padding: 24 }}>
        <span className="faint">Loading this page…</span>
      </div>
    </div>
  );
}

/**
 * HashRouter on purpose: deep links then survive every static host
 * (GitHub Pages included) with zero server-side config.
 */
function AccountRedirect({ to, scope }: { to: string; scope?: "public" }) {
  const location = useLocation();
  return <Navigate to={accountRedirectTarget(to, location.search, scope)} replace />;
}

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Suspense fallback={<RoutePending />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="book" element={<Book />} />
              <Route path="tape" element={<Tape />} />
              <Route path="charts" element={<Charts />} />
              <Route path="heatmap" element={<HeatmapPage />} />
              <Route path="compare" element={<Compare />} />
              <Route path="zipper" element={<Zipper />} />
              <Route path="calc" element={<Calc />} />
              <Route path="hub" element={<Hub />} />
              <Route path="flow" element={<AccountRedirect to="/account/transactions" scope="public" />} />
              <Route path="portfolio" element={<AccountRedirect to="/account" />} />
              <Route path="account/*" element={<Portfolio />} />
              <Route path="sdk" element={<SdkGuide />} />
              <Route path="brand-kit" element={<BrandKitPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </HashRouter>
    </AppProvider>
  );
}
