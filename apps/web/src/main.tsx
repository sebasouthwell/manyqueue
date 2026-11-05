import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import HomePage from "./pages/HomePage";
import HostPage from "./pages/HostPage";
import TvPage from "./pages/TvPage";
import RoomPage from "./pages/RoomPage";
import RecapPage from "./pages/RecapPage";
import { SiteFooter } from "./components/SiteFooter";
import SheetDemoPage from "./pages/SheetDemoPage";
import HostDemoPage from "./pages/HostDemoPage";
import NowDemoPage from "./pages/NowDemoPage";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <div className="min-h-screen">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/host" element={<HostPage />} />
        <Route path="/tv" element={<TvPage />} />
        <Route path="/r/:code" element={<RoomPage />} />
        <Route path="/rooms/:code/recap" element={<RecapPage />} />
        <Route path="/demo/now" element={<NowDemoPage />} />
        <Route path="/demo/host" element={<HostDemoPage />} />
        <Route path="/demo/sheets" element={<SheetDemoPage />} />
      </Routes>
      </div>
      <SiteFooter />
    </BrowserRouter>
  </React.StrictMode>,
);
