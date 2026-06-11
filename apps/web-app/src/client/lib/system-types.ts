export type SystemEventRecord = {
  id: string;
  level: string;
  message: string;
  created_at: string;
};

export type RecentJobRecord = {
  id: string;
  type: string;
  status: string;
  updated_at: string;
};

export type LogsResponse = {
  events: SystemEventRecord[];
  jobs: RecentJobRecord[];
};

export type DashboardCounts = {
  contacts?: number;
  tags?: number;
  conversations?: number;
  unreadConversations?: number;
  activeAutomations?: number;
  campaignsRunning?: number;
  pendingJobs?: number;
};

export type DashboardConversationRecord = {
  id: string;
  contact_name: string | null;
  title: string | null;
  unread_count: number;
  last_message_preview: string | null;
};

export type DashboardFailureRecord = {
  id: string;
  type: string;
  error: string;
  updatedAt: string;
};

export type DashboardFailures = {
  recentFailedJobs?: number;
  totalFailedRecipients?: number;
  failedJobs?: DashboardFailureRecord[];
};

export type DashboardSummaryResponse = {
  counts?: DashboardCounts;
  recentConversations?: DashboardConversationRecord[];
  recentEvents?: SystemEventRecord[];
  failures?: DashboardFailures;
};

export type ChannelAccountHealth = {
  status?: string;
  type?: string;
  [key: string]: unknown;
};

export type RuntimeProcessState = {
  status?: string;
  authStatus?: string;
  sessionPhone?: string | null;
  phoneNumber?: string | null;
  phone?: string | null;
  profileName?: string | null;
  sessionName?: string | null;
  live?: boolean;
  memoryMb?: number;
  lastFailureSummary?: string | null;
  lastErrorType?: string | null;
  lastFailureAt?: string | null;
  consecutiveFailures?: number;
  authenticated?: boolean;
  username?: string | null;
  [key: string]: unknown;
};

export type WorkerStateRecord<T extends Record<string, unknown> = RuntimeProcessState> = {
  value?: T | null;
  [key: string]: unknown;
};

export type ChannelHealthRecord = {
  label: string;
  mode?: string;
  sessionIdentifier?: string | null;
  account?: ChannelAccountHealth | null;
  worker?: RuntimeProcessState | null;
  mappedConversations?: number;
  mappedContactChannels?: number;
};

export type HealthResponse = {
  overallStatus?: string;
  databasePath?: string;
  worker?: WorkerStateRecord | null;
  scheduler?: WorkerStateRecord | null;
  channels?: Record<string, ChannelHealthRecord>;
  metrics?: {
    activeCampaigns?: number;
    activeAutomations?: number;
    waitingConversations?: number;
    pendingFollowUps?: number;
  };
};

export type InstagramSessionResponse = {
  status?: string;
  authenticated?: boolean;
  username?: string | null;
  accountUsername?: string | null;
  [key: string]: unknown;
};
