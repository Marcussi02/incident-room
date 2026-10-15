import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import "./index.css";
import { IncidentList } from "./pages/IncidentList";
import { IncidentRoom } from "./pages/IncidentRoom";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<IncidentList />} />
          <Route path="/incidents/:id" element={<IncidentRoom />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  </StrictMode>,
);
