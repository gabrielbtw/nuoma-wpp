/**
 * @nuoma/api root router. This file is the public type entry consumed by `apps/web`
 * via `import type { AppRouter } from "@nuoma/api"`. Cookie surface lives behind
 * helper functions in `./trpc/cookies.ts` so this barrel stays portable.
 */
import { router } from "./trpc/init.js";
import { attendantsRouter } from "./trpc/routers/attendants.js";
import { authRouter } from "./trpc/routers/auth.js";
import { automationsRouter } from "./trpc/routers/automations.js";
import { campaignsRouter } from "./trpc/routers/campaigns.js";
import { chatbotsRouter } from "./trpc/routers/chatbots.js";
import { contactsRouter } from "./trpc/routers/contacts.js";
import { conversationsRouter } from "./trpc/routers/conversations.js";
import { embedRouter } from "./trpc/routers/embed.js";
import { evidenceRouter } from "./trpc/routers/evidence.js";
import { implementationRouter } from "./trpc/routers/implementation.js";
import { jobsRouter } from "./trpc/routers/jobs.js";
import { mediaRouter } from "./trpc/routers/media.js";
import { messagesRouter } from "./trpc/routers/messages.js";
import { pushRouter } from "./trpc/routers/push.js";
import { quickRepliesRouter } from "./trpc/routers/quick-replies.js";
import { remindersRouter } from "./trpc/routers/reminders.js";
import { streamingRouter } from "./trpc/routers/streaming.js";
import { systemRouter } from "./trpc/routers/system.js";
import { tagsRouter } from "./trpc/routers/tags.js";
import { usersRouter } from "./trpc/routers/users.js";

export const appRouter = router({
  attendants: attendantsRouter,
  auth: authRouter,
  automations: automationsRouter,
  campaigns: campaignsRouter,
  chatbots: chatbotsRouter,
  contacts: contactsRouter,
  conversations: conversationsRouter,
  embed: embedRouter,
  evidence: evidenceRouter,
  implementation: implementationRouter,
  jobs: jobsRouter,
  media: mediaRouter,
  messages: messagesRouter,
  push: pushRouter,
  quickReplies: quickRepliesRouter,
  reminders: remindersRouter,
  streaming: streamingRouter,
  system: systemRouter,
  tags: tagsRouter,
  users: usersRouter,
});

export type AppRouter = typeof appRouter;
