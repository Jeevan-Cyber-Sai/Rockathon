import { AnimatePresence, LayoutGroup } from "framer-motion";
import { Routes, Route, useLocation } from "react-router-dom";
import TopBar from "./components/TopBar";
import Brief from "./routes/Brief";
import Compare from "./routes/Compare";
import Ledger from "./routes/Ledger";

export default function App() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-base">
      <TopBar />
      {/* One LayoutGroup spanning every route so a layoutId (the brief
          bar) can be matched and morphed across a route change, not just
          within a single page. */}
      <LayoutGroup id="shopyx-shell">
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<Brief />} />
            <Route path="/compare/:runId" element={<Compare />} />
            <Route path="/ledger" element={<Ledger />} />
          </Routes>
        </AnimatePresence>
      </LayoutGroup>
    </div>
  );
}
