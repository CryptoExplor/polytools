import { HashRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { AppProvider } from "./lib/store";
import { Layout } from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Tape from "./pages/Tape";
import Charts from "./pages/Charts";
import { HeatmapPage } from "./pages/Heatmap";
import Compare from "./pages/Compare";
import Zipper from "./pages/Zipper";
import Calc from "./pages/Calc";
import Hub from "./pages/Hub";
import Portfolio from "./pages/Portfolio";
import SdkGuide from "./pages/SdkGuide";
import { BrandKitPage } from "./pages/BrandKit";

/**
 * HashRouter on purpose: deep links then survive every static host
 * (GitHub Pages included) with zero server-side config.
 */
function AccountRedirect({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}`} replace />;
}

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="book" element={<AccountRedirect to="/account/order-book" />} />
            <Route path="tape" element={<Tape />} />
            <Route path="charts" element={<Charts />} />
            <Route path="heatmap" element={<HeatmapPage />} />
            <Route path="compare" element={<Compare />} />
            <Route path="zipper" element={<Zipper />} />
            <Route path="calc" element={<Calc />} />
            <Route path="hub" element={<Hub />} />
            <Route path="flow" element={<AccountRedirect to="/account/transactions" />} />
            <Route path="portfolio" element={<AccountRedirect to="/account/api" />} />
            <Route path="account/*" element={<Portfolio />} />
            <Route path="sdk" element={<SdkGuide />} />
            <Route path="brand-kit" element={<BrandKitPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </AppProvider>
  );
}
