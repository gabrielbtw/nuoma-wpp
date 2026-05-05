import { createTRPCReact } from "@trpc/react-query";

import type { AppRouter } from "@nuoma/api";

export const trpc = createTRPCReact<AppRouter>();
