import {
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";

import { ThemeProvider, ToastProvider } from "@nuoma/ui";

import { AuthProvider } from "./auth/AuthProvider.js";
import { registerNuomaServiceWorker } from "./lib/push-subscription.js";
import { TrpcProvider } from "./lib/trpc-provider.js";
import { ShellLayout } from "./shell/ShellLayout.js";
import { LoginPage } from "./pages/LoginPage.js";

import "./styles.css";

const DashboardPage = lazy(() =>
  import("./pages/DashboardPage.js").then((module) => ({ default: module.DashboardPage })),
);
const InboxPage = lazy(() =>
  import("./pages/InboxPage.js").then((module) => ({ default: module.InboxPage })),
);
const CampaignsPage = lazy(() =>
  import("./pages/CampaignsPage.js").then((module) => ({ default: module.CampaignsPage })),
);
const AutomationsPage = lazy(() =>
  import("./pages/AutomationsPage.js").then((module) => ({ default: module.AutomationsPage })),
);
const ChatbotsPage = lazy(() =>
  import("./pages/ChatbotsPage.js").then((module) => ({ default: module.ChatbotsPage })),
);
const ContactsPage = lazy(() =>
  import("./pages/ContactsPage.js").then((module) => ({ default: module.ContactsPage })),
);
const JobsPage = lazy(() =>
  import("./pages/JobsPage.js").then((module) => ({ default: module.JobsPage })),
);
const ImplementationPage = lazy(() =>
  import("./pages/ImplementationPage.js").then((module) => ({ default: module.ImplementationPage })),
);
const EvidencePage = lazy(() =>
  import("./pages/EvidencePage.js").then((module) => ({ default: module.EvidencePage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage.js").then((module) => ({ default: module.SettingsPage })),
);
const DevComponentsPage = lazy(() =>
  import("./pages/DevComponentsPage.js").then((module) => ({ default: module.DevComponentsPage })),
);

function routePage(Page: React.LazyExoticComponent<React.ComponentType>) {
  return function RoutePage() {
    return (
      <Suspense
        fallback={
          <div className="mx-auto grid min-h-[40vh] max-w-7xl place-items-center px-6 text-sm text-fg-muted">
            Carregando tela.
          </div>
        }
      >
        <Page />
      </Suspense>
    );
  };
}

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
  component: routePage(DashboardPage),
});

const inboxRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/inbox",
  component: routePage(InboxPage),
});

const contactsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/contacts",
  component: routePage(ContactsPage),
});

const campaignsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/campaigns",
  component: routePage(CampaignsPage),
});

const automationsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/automations",
  component: routePage(AutomationsPage),
});

const chatbotsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/chatbots",
  component: routePage(ChatbotsPage),
});

const jobsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/jobs",
  component: routePage(JobsPage),
});

const implementationRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/implementation",
  component: routePage(ImplementationPage),
});

const evidenceRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/evidence",
  component: routePage(EvidencePage),
});

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/settings",
  component: routePage(SettingsPage),
});

const devComponentsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/dev/components",
  component: routePage(DevComponentsPage),
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
