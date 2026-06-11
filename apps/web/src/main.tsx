import {
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import {
  lazy,
  StrictMode,
  Suspense,
  useEffect,
  type ComponentType,
  type LazyExoticComponent,
} from "react";
import ReactDOM from "react-dom/client";

import { ThemeProvider, ToastProvider } from "@nuoma/ui";

import { AuthProvider } from "./auth/AuthProvider.js";
import { useAuth } from "./auth/auth-context.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { registerNuomaServiceWorker } from "./lib/push-subscription.js";
import { TrpcProvider } from "./lib/trpc-provider.js";
import { LoginPage } from "./pages/LoginPage.js";
import { ShellLayout } from "./shell/ShellLayout.js";
import type { ShellRouteAccess } from "./shell/nav-registry.js";

import "./styles.css";

type LazyPage = LazyExoticComponent<ComponentType>;

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
const OperationsPage = lazy(() =>
  import("./pages/OperationsPage.js").then((module) => ({ default: module.OperationsPage })),
);
const ImplementationPage = lazy(() =>
  import("./pages/ImplementationPage.js").then((module) => ({
    default: module.ImplementationPage,
  })),
);
const EvidencePage = lazy(() =>
  import("./pages/EvidencePage.js").then((module) => ({ default: module.EvidencePage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage.js").then((module) => ({ default: module.SettingsPage })),
);
const DevComponentsPage = import.meta.env.DEV
  ? lazy(() =>
      import("./pages/DevComponentsPage.js").then((module) => ({
        default: module.DevComponentsPage,
      })),
    )
  : null;

function RouteLoading() {
  return (
    <div className="nw-shell-route-loading mx-auto grid min-h-[40vh] max-w-7xl place-items-center px-6 text-sm text-ink-base">
      Carregando tela.
    </div>
  );
}

function LazyRoutePage({ Page, label }: { Page: LazyPage; label: string }) {
  const router = useRouterState();

  return (
    <ErrorBoundary scope={label} resetKey={`${label}:${router.location.pathname}`}>
      <Suspense fallback={<RouteLoading />}>
        <Page />
      </Suspense>
    </ErrorBoundary>
  );
}

function routePage(Page: LazyPage, label: string, access: ShellRouteAccess = "operator") {
  return function RoutePage() {
    return <GuardedRoutePage Page={Page} label={label} access={access} />;
  };
}

function GuardedRoutePage({
  Page,
  label,
  access,
}: {
  Page: LazyPage;
  label: string;
  access: ShellRouteAccess;
}) {
  const auth = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (access === "admin" && auth.user?.role !== "admin") {
      void navigate({ to: "/inbox", replace: true });
    }
    if (access === "dev" && !import.meta.env.DEV) {
      void navigate({ to: "/inbox", replace: true });
    }
  }, [access, auth.user?.role, navigate]);

  if (access === "admin" && auth.user?.role !== "admin") return <RouteLoading />;
  if (access === "dev" && !import.meta.env.DEV) return <RouteLoading />;
  return <LazyRoutePage Page={Page} label={label} />;
}

function HomeRoute() {
  const auth = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (auth.user?.role !== "admin") {
      void navigate({ to: "/inbox", replace: true });
    }
  }, [auth.user?.role, navigate]);

  if (auth.user?.role === "admin") {
    return <LazyRoutePage Page={DashboardPage} label="Painel" />;
  }

  return <RouteLoading />;
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
  component: HomeRoute,
});

const inboxRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/inbox",
  component: routePage(InboxPage, "Inbox"),
});

const contactsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/contacts",
  component: routePage(ContactsPage, "Contatos"),
});

const campaignsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/campaigns",
  component: routePage(CampaignsPage, "Campanhas"),
});

const automationsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/automations",
  component: routePage(AutomationsPage, "Automações"),
});

const chatbotsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/chatbots",
  component: routePage(ChatbotsPage, "Chatbots"),
});

const jobsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/jobs",
  component: routePage(JobsPage, "Fila de envio", "admin"),
});

const operationsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/operations",
  component: routePage(OperationsPage, "Operações", "admin"),
});

const implementationRoute = import.meta.env.DEV
  ? createRoute({
      getParentRoute: () => shellRoute,
      path: "/implementation",
      component: routePage(ImplementationPage, "Implementação", "dev"),
    })
  : null;

const evidenceRoute = import.meta.env.DEV
  ? createRoute({
      getParentRoute: () => shellRoute,
      path: "/evidence",
      component: routePage(EvidencePage, "Evidências", "dev"),
    })
  : null;

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/settings",
  component: routePage(SettingsPage, "Configurações", "admin"),
});

const devComponentsRoute = DevComponentsPage
  ? createRoute({
      getParentRoute: () => shellRoute,
      path: "/dev/components",
      component: routePage(DevComponentsPage, "Componentes", "dev"),
    })
  : null;

const shellChildren = [
  dashboardRoute,
  inboxRoute,
  contactsRoute,
  campaignsRoute,
  automationsRoute,
  chatbotsRoute,
  operationsRoute,
  jobsRoute,
  settingsRoute,
  ...(implementationRoute ? [implementationRoute] : []),
  ...(evidenceRoute ? [evidenceRoute] : []),
  ...(devComponentsRoute ? [devComponentsRoute] : []),
];

const routeTree = rootRoute.addChildren([loginRoute, shellRoute.addChildren(shellChildren)]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary scope="Aplicação">
      <ThemeProvider>
        <TrpcProvider>
          <AuthProvider>
            <ToastProvider>
              <RouterProvider router={router} />
            </ToastProvider>
          </AuthProvider>
        </TrpcProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
