import { HashRouter, Route, Routes, Navigate } from "react-router-dom";
import { AppProvider } from "./lib/store";
import { Layout } from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Book from "./pages/Book";
import Tape from "./pages/Tape";
import Charts from "./pages/Charts";
import Compare from "./pages/Compare";
import Zipper from "./pages/Zipper";
import Calc from "./pages/Calc";
import Hub from "./pages/Hub";
import Flow from "./pages/Flow";
import Portfolio from "./pages/Portfolio";

/**
 * HashRouter on purpose: deep links then survive every static host
 * (GitHub Pages included) with zero server-side config.
 */
export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="book" element={<Book />} />
            <Route path="tape" element={<Tape />} />
            <Route path="charts" element={<Charts />} />
            <Route path="compare" element={<Compare />} />
            <Route path="zipper" element={<Zipper />} />
            <Route path="calc" element={<Calc />} />
            <Route path="hub" element={<Hub />} />
            <Route path="flow" element={<Flow />} />
            <Route path="portfolio" element={<Portfolio />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </AppProvider>
  );
}
