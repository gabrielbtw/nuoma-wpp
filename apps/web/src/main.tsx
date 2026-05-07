import {
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";

import { ThemeProvider, ToastProvider } from "@nuoma/ui";

import { AuthProvider } from "./auth/AuthProvider.js";
import { registerNuomaServiceWorker } from "./lib/push-subscription.js";
import { TrpcProvider } from "./lib/trpc-provider.js";
import { ShellLayout } from "./shell/ShellLayout.js";
import { LoginPage } from "./pages/LoginPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { InboxPage } from "./pages/InboxPage.js";
import { CampaignsPage } from "./pages/CampaignsPage.js";
import { AutomationsPage } from "./pages/AutomationsPage.js";
import { ChatbotsPage } from "./pages/ChatbotsPage.js";
import { ContactsPage } from "./pages/ContactsPage.js";
import { JobsPage } from "./pages/JobsPage.js";
import { ImplementationPage } from "./pages/ImplementationPage.js";
import { EvidencePage } from "./pages/EvidencePage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { DevComponentsPage } from "./pages/DevComponentsPage.js";

import "./styles.css";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void registerNuomaServiceWorker().catch(() => undefined);
  });
}

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: ShellLayout,
});

const dashboardRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  component: DashboardPage,
});

const inboxRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/inbox",
  component: InboxPage,
});

const contactsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/contacts",
  component: ContactsPage,
});

const campaignsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/campaigns",
  component: CampaignsPage,
});

const automationsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/automations",
  component: AutomationsPage,
});

const chatbotsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/chatbots",
  component: ChatbotsPage,
});

const jobsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/jobs",
  component: JobsPage,
});

const implementationRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/implementation",
  component: ImplementationPage,
});

const evidenceRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/evidence",
  component: EvidencePage,
});

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/settings",
  component: SettingsPage,
});

const devComponentsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/dev/components",
  component: DevComponentsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  shellRoute.addChildren([
    dashboardRoute,
    inboxRoute,
    contactsRoute,
    campaignsRoute,
    automationsRoute,
    chatbotsRoute,
    jobsRoute,
    implementationRoute,
    evidenceRoute,
    settingsRoute,
    devComponentsRoute,
  ]),
]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <TrpcProvider>
        <AuthProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </AuthProvider>
      </TrpcProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
