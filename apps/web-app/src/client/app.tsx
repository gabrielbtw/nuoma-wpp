import type { ReactNode } from "react";
import { Suspense, lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/shell";
import { ToastContainer } from "./components/ui/toast";

const DashboardPage = lazy(() => import("./pages/dashboard").then((module) => ({ default: module.DashboardPage })));
const InboxPage = lazy(() => import("./pages/inbox").then((module) => ({ default: module.InboxPage })));
const ContactsPage = lazy(() => import("./pages/contacts").then((module) => ({ default: module.ContactsPage })));
const ContactDetailPage = lazy(() => import("./pages/contact-detail").then((module) => ({ default: module.ContactDetailPage })));
const ContactTabLabPage = lazy(() => import("./pages/contact-tab-lab").then((module) => ({ default: module.ContactTabLabPage })));
const AutomationsPage = lazy(() => import("./pages/automations").then((module) => ({ default: module.AutomationsPage })));
const CampaignsPage = lazy(() => import("./pages/campaigns").then((module) => ({ default: module.CampaignsPage })));
const TrendsPage = lazy(() => import("./pages/trends").then((module) => ({ default: module.TrendsPage })));
const ImportsPage = lazy(() => import("./pages/imports").then((module) => ({ default: module.ImportsPage })));
const SystemHealthPage = lazy(() => import("./pages/system-health").then((module) => ({ default: module.SystemHealthPage })));
const LogsPage = lazy(() => import("./pages/logs").then((module) => ({ default: module.LogsPage })));
const SettingsPage = lazy(() => import("./pages/settings").then((module) => ({ default: module.SettingsPage })));
const ChatbotPage = lazy(() => import("./pages/chatbot").then((module) => ({ default: module.ChatbotPage })));

function RouteFallback() {
  return (
    <div className="space-y-4">
      <div className="h-4 w-28 rounded-full bg-white/8" />
      <div className="h-10 w-72 rounded-full bg-white/6" />
      <div className="grid gap-4 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-48 rounded-[1.5rem] border border-white/8 bg-white/[0.03]" />
        ))}
      </div>
    </div>
  );
}

function suspensePage(node: ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>;
}

export function App() {
  return (
    <>
    <ToastContainer />
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={suspensePage(<DashboardPage />)} />
        <Route path="/inbox" element={suspensePage(<InboxPage />)} />
        <Route path="/contacts" element={suspensePage(<ContactsPage />)} />
        <Route path="/contacts/:id" element={suspensePage(<ContactDetailPage />)} />
        <Route path="/contacts/lab/client-tab" element={suspensePage(<ContactTabLabPage />)} />
        <Route path="/automations" element={suspensePage(<AutomationsPage />)} />
        <Route path="/campaigns" element={suspensePage(<CampaignsPage />)} />
        <Route path="/chatbot" element={suspensePage(<ChatbotPage />)} />
        <Route path="/trends" element={suspensePage(<TrendsPage />)} />
        <Route path="/imports" element={suspensePage(<ImportsPage />)} />
        <Route path="/health" element={suspensePage(<SystemHealthPage />)} />
        <Route path="/logs" element={suspensePage(<LogsPage />)} />
        <Route path="/settings" element={suspensePage(<SettingsPage />)} />
      </Route>
    </Routes>
    </>
  );
}
