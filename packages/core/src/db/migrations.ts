export const migrations = [
  {
    id: "0001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS _migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL UNIQUE,
        cpf TEXT,
        email TEXT,
        instagram TEXT,
        procedure_status TEXT NOT NULL DEFAULT 'unknown',
        last_attendant TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'novo',
        last_interaction_at TEXT,
        last_outgoing_at TEXT,
        last_incoming_at TEXT,
        last_automation_at TEXT,
        last_procedure_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '#3ddc97',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contact_tags (
        contact_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (contact_id, tag_id),
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        contact_id TEXT,
        wa_chat_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        unread_count INTEGER NOT NULL DEFAULT 0,
        last_message_preview TEXT NOT NULL DEFAULT '',
        last_message_at TEXT,
        last_message_direction TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        assigned_to TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS media_assets (
        id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL UNIQUE,
        original_name TEXT NOT NULL,
        safe_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        category TEXT NOT NULL,
        linked_campaign_id TEXT,
        linked_automation_id TEXT,
        storage_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        contact_id TEXT,
        direction TEXT NOT NULL,
        content_type TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        media_asset_id TEXT,
        external_id TEXT,
        status TEXT NOT NULL DEFAULT 'sent',
        sent_at TEXT,
        meta_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
        FOREIGN KEY (media_asset_id) REFERENCES media_assets(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS automations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        description TEXT NOT NULL DEFAULT '',
        required_tags_json TEXT NOT NULL DEFAULT '[]',
        excluded_tags_json TEXT NOT NULL DEFAULT '["nao_insistir"]',
        required_status TEXT,
        procedure_only INTEGER NOT NULL DEFAULT 0,
        require_last_outgoing INTEGER NOT NULL DEFAULT 0,
        require_no_reply INTEGER NOT NULL DEFAULT 0,
        time_window_hours INTEGER NOT NULL DEFAULT 24,
        minimum_interval_hours INTEGER NOT NULL DEFAULT 72,
        random_delay_min_seconds INTEGER NOT NULL DEFAULT 10,
        random_delay_max_seconds INTEGER NOT NULL DEFAULT 45,
        send_window_start TEXT NOT NULL DEFAULT '08:00',
        send_window_end TEXT NOT NULL DEFAULT '20:00',
        template_key TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS automation_actions (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        media_asset_id TEXT,
        wait_seconds INTEGER,
        tag_name TEXT,
        reminder_text TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE,
        FOREIGN KEY (media_asset_id) REFERENCES media_assets(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS automation_contact_state (
        automation_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        last_sent_at TEXT,
        last_job_id TEXT,
        last_triggered_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (automation_id, contact_id),
        FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS automation_runs (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        conversation_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        action_index INTEGER NOT NULL DEFAULT 0,
        next_run_at TEXT NOT NULL,
        last_error TEXT,
        triggered_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        csv_path TEXT,
        send_window_start TEXT NOT NULL DEFAULT '08:00',
        send_window_end TEXT NOT NULL DEFAULT '20:00',
        rate_limit_count INTEGER NOT NULL DEFAULT 30,
        rate_limit_window_minutes INTEGER NOT NULL DEFAULT 60,
        random_delay_min_seconds INTEGER NOT NULL DEFAULT 15,
        random_delay_max_seconds INTEGER NOT NULL DEFAULT 60,
        total_recipients INTEGER NOT NULL DEFAULT 0,
        processed_recipients INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS campaign_steps (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        media_asset_id TEXT,
        wait_minutes INTEGER,
        caption TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
        FOREIGN KEY (media_asset_id) REFERENCES media_assets(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS campaign_recipients (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        contact_id TEXT,
        phone TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        extra_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        step_index INTEGER NOT NULL DEFAULT 0,
        next_run_at TEXT NOT NULL,
        last_attempt_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        contact_id TEXT,
        conversation_id TEXT,
        automation_id TEXT,
        title TEXT NOT NULL,
        due_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
        FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        dedupe_key TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        scheduled_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        locked_at TEXT,
        locked_by TEXT,
        error_message TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS system_logs (
        id TEXT PRIMARY KEY,
        process_name TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        meta_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS worker_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
      CREATE INDEX IF NOT EXISTS idx_contacts_last_interaction ON contacts(last_interaction_at);
      CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
      CREATE INDEX IF NOT EXISTS idx_contact_tags_contact ON contact_tags(contact_id);
      CREATE INDEX IF NOT EXISTS idx_contact_tags_tag ON contact_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON conversations(last_message_at);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_automations_enabled ON automations(enabled, category);
      CREATE INDEX IF NOT EXISTS idx_automation_runs_due ON automation_runs(status, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
      CREATE INDEX IF NOT EXISTS idx_campaign_recipients_due ON campaign_recipients(status, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(status, scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_dedupe ON jobs(dedupe_key, status);
      CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, due_at);
      CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_worker_state_updated_at ON worker_state(updated_at DESC);
    `
  },
  {
    id: "0002_contact_history_and_tag_metadata",
    sql: `
      ALTER TABLE tags RENAME TO tags_legacy;

      CREATE TABLE tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '#3ddc97',
        type TEXT NOT NULL DEFAULT 'manual',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO tags (id, name, normalized_name, color, type, active, created_at, updated_at)
      SELECT
        (
          SELECT legacy.id
          FROM tags_legacy legacy
          WHERE lower(trim(legacy.name)) = lower(trim(base.name))
          ORDER BY datetime(legacy.created_at) ASC, legacy.id ASC
          LIMIT 1
        ) AS id,
        (
          SELECT trim(legacy.name)
          FROM tags_legacy legacy
          WHERE lower(trim(legacy.name)) = lower(trim(base.name))
          ORDER BY datetime(legacy.updated_at) DESC, datetime(legacy.created_at) ASC, legacy.id ASC
          LIMIT 1
        ) AS name,
        lower(trim(base.name)) AS normalized_name,
        COALESCE(
          (
            SELECT legacy.color
            FROM tags_legacy legacy
            WHERE lower(trim(legacy.name)) = lower(trim(base.name))
            ORDER BY datetime(legacy.updated_at) DESC, datetime(legacy.created_at) ASC, legacy.id ASC
            LIMIT 1
          ),
          '#3ddc97'
        ) AS color,
        CASE
          WHEN lower(trim(base.name)) = 'whatsapp' THEN 'canal'
          ELSE 'manual'
        END AS type,
        1 AS active,
        MIN(base.created_at) AS created_at,
        MAX(base.updated_at) AS updated_at
      FROM tags_legacy base
      WHERE trim(base.name) <> ''
      GROUP BY lower(trim(base.name));

      CREATE TABLE contact_tags_new (
        contact_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (contact_id, tag_id),
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      );

      INSERT OR IGNORE INTO contact_tags_new (contact_id, tag_id, created_at)
      SELECT
        ct.contact_id,
        t.id,
        MIN(ct.created_at) AS created_at
      FROM contact_tags ct
      INNER JOIN tags_legacy legacy ON legacy.id = ct.tag_id
      INNER JOIN tags t ON t.normalized_name = lower(trim(legacy.name))
      GROUP BY ct.contact_id, t.id;

      DROP TABLE contact_tags;
      ALTER TABLE contact_tags_new RENAME TO contact_tags;
      DROP TABLE tags_legacy;

      CREATE TABLE IF NOT EXISTS contact_history (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        field_key TEXT NOT NULL,
        field_label TEXT NOT NULL,
        previous_value TEXT,
        next_value TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_normalized_name ON tags(normalized_name);
      CREATE INDEX IF NOT EXISTS idx_contact_tags_contact ON contact_tags(contact_id);
      CREATE INDEX IF NOT EXISTS idx_contact_tags_tag ON contact_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_contact_history_contact_created ON contact_history(contact_id, created_at DESC);
    `
  },
  {
    id: "0003_omnichannel_foundation",
    sql: `
      CREATE TABLE IF NOT EXISTS channel_accounts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'local',
        account_key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'planned',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT OR IGNORE INTO channel_accounts (
        id, type, provider, account_key, display_name, status, metadata_json, created_at, updated_at
      ) VALUES
        (
          'channel-account:whatsapp-local',
          'whatsapp',
          'local-browser',
          'whatsapp-local',
          'WhatsApp Local',
          'connected',
          '{"workerKey":"wa-worker"}',
          datetime('now'),
          datetime('now')
        ),
        (
          'channel-account:instagram-assisted',
          'instagram',
          'assisted-browser',
          'instagram-assisted',
          'Instagram Assistido',
          'assisted',
          '{"mode":"assisted"}',
          datetime('now'),
          datetime('now')
        );

      CREATE TABLE IF NOT EXISTS contact_channels (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        type TEXT NOT NULL,
        external_id TEXT,
        display_value TEXT NOT NULL,
        normalized_value TEXT,
        is_primary INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      );

      INSERT OR IGNORE INTO contact_channels (
        id, contact_id, type, external_id, display_value, normalized_value, is_primary, is_active, metadata_json, created_at, updated_at
      )
      SELECT
        'contact-channel:' || id || ':whatsapp',
        id,
        'whatsapp',
        NULL,
        trim(phone),
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(trim(phone), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''),
        1,
        1,
        '{}',
        created_at,
        updated_at
      FROM contacts
      WHERE phone IS NOT NULL AND trim(phone) <> '';

      INSERT OR IGNORE INTO contact_channels (
        id, contact_id, type, external_id, display_value, normalized_value, is_primary, is_active, metadata_json, created_at, updated_at
      )
      SELECT
        'contact-channel:' || id || ':instagram',
        id,
        'instagram',
        lower(ltrim(trim(instagram), '@')),
        CASE
          WHEN trim(instagram) LIKE '@%' THEN trim(instagram)
          ELSE '@' || trim(instagram)
        END,
        lower(ltrim(trim(instagram), '@')),
        1,
        1,
        '{}',
        created_at,
        updated_at
      FROM contacts
      WHERE instagram IS NOT NULL AND trim(instagram) <> '';

      ALTER TABLE conversations ADD COLUMN channel TEXT NOT NULL DEFAULT 'whatsapp';
      ALTER TABLE conversations ADD COLUMN channel_account_id TEXT;
      ALTER TABLE conversations ADD COLUMN external_thread_id TEXT;
      ALTER TABLE conversations ADD COLUMN inbox_category TEXT NOT NULL DEFAULT 'primary';
      ALTER TABLE conversations ADD COLUMN internal_status TEXT NOT NULL DEFAULT 'open';
      ALTER TABLE conversations ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

      UPDATE conversations
      SET
        channel = COALESCE(NULLIF(channel, ''), 'whatsapp'),
        channel_account_id = COALESCE(channel_account_id, 'channel-account:whatsapp-local'),
        external_thread_id = COALESCE(NULLIF(external_thread_id, ''), wa_chat_id),
        internal_status = COALESCE(NULLIF(internal_status, ''), status),
        metadata_json = COALESCE(NULLIF(metadata_json, ''), '{}');

      ALTER TABLE messages ADD COLUMN channel TEXT NOT NULL DEFAULT 'whatsapp';
      ALTER TABLE messages ADD COLUMN channel_account_id TEXT;

      UPDATE messages
      SET
        channel = COALESCE(NULLIF(channel, ''), (SELECT channel FROM conversations WHERE conversations.id = messages.conversation_id), 'whatsapp'),
        channel_account_id = COALESCE(
          channel_account_id,
          (SELECT channel_account_id FROM conversations WHERE conversations.id = messages.conversation_id),
          'channel-account:whatsapp-local'
        );

      ALTER TABLE campaigns ADD COLUMN eligible_channels_json TEXT NOT NULL DEFAULT '["whatsapp"]';
      ALTER TABLE campaign_steps ADD COLUMN channel_scope TEXT NOT NULL DEFAULT 'any';

      CREATE TABLE IF NOT EXISTS campaign_executions (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        contact_id TEXT,
        conversation_id TEXT,
        legacy_recipient_id TEXT,
        channel TEXT NOT NULL DEFAULT 'whatsapp',
        target_display_value TEXT NOT NULL,
        target_normalized_value TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        step_index INTEGER NOT NULL DEFAULT 0,
        next_run_at TEXT,
        last_attempt_at TEXT,
        last_error TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
      );

      INSERT OR IGNORE INTO campaign_executions (
        id, campaign_id, contact_id, conversation_id, legacy_recipient_id, channel, target_display_value, target_normalized_value,
        status, step_index, next_run_at, last_attempt_at, last_error, metadata_json, created_at, updated_at
      )
      SELECT
        'campaign-execution:' || id,
        campaign_id,
        contact_id,
        NULL,
        id,
        'whatsapp',
        phone,
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(trim(phone), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''),
        status,
        step_index,
        next_run_at,
        last_attempt_at,
        last_error,
        extra_json,
        created_at,
        updated_at
      FROM campaign_recipients;

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        channel TEXT,
        contact_id TEXT,
        conversation_id TEXT,
        message_id TEXT,
        campaign_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_accounts_type_key ON channel_accounts(type, account_key);
      CREATE INDEX IF NOT EXISTS idx_contact_channels_contact ON contact_channels(contact_id);
      CREATE INDEX IF NOT EXISTS idx_contact_channels_type_value ON contact_channels(type, normalized_value);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_channel_thread ON conversations(channel, external_thread_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_channel_account ON conversations(channel_account_id);
      CREATE INDEX IF NOT EXISTS idx_messages_channel_conversation ON messages(channel, conversation_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_campaign_executions_due ON campaign_executions(status, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_contact ON audit_logs(contact_id, created_at DESC);
    `
  },
  {
    id: "0004_contact_phone_nullable_for_omnichannel",
    transaction: false,
    sql: `
      PRAGMA foreign_keys = OFF;

      DROP TABLE IF EXISTS contacts_next;
      DROP INDEX IF EXISTS idx_contacts_phone_unique;
      DROP INDEX IF EXISTS idx_contacts_instagram_lookup;

      CREATE TABLE IF NOT EXISTS contacts_next (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        cpf TEXT,
        email TEXT,
        instagram TEXT,
        procedure_status TEXT NOT NULL DEFAULT 'unknown',
        last_attendant TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'novo',
        last_interaction_at TEXT,
        last_outgoing_at TEXT,
        last_incoming_at TEXT,
        last_automation_at TEXT,
        last_procedure_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      INSERT INTO contacts_next (
        id, name, phone, cpf, email, instagram, procedure_status, last_attendant, notes,
        status, last_interaction_at, last_outgoing_at, last_incoming_at, last_automation_at, last_procedure_at,
        created_at, updated_at, deleted_at
      )
      SELECT
        id, name, NULLIF(phone, ''), cpf, email, instagram, procedure_status, last_attendant, notes,
        status, last_interaction_at, last_outgoing_at, last_incoming_at, last_automation_at, last_procedure_at,
        created_at, updated_at, deleted_at
      FROM contacts;

      DROP TABLE contacts;
      ALTER TABLE contacts_next RENAME TO contacts;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_phone_unique
        ON contacts(phone)
        WHERE phone IS NOT NULL AND trim(phone) <> '';

      CREATE INDEX IF NOT EXISTS idx_contacts_instagram_lookup
        ON contacts(instagram);

      PRAGMA foreign_keys = ON;
    `
  },
  {
    id: "0005_campaign_recipients_omnichannel",
    sql: `
      ALTER TABLE campaign_recipients ADD COLUMN channel TEXT NOT NULL DEFAULT 'whatsapp';
      ALTER TABLE campaign_recipients ADD COLUMN instagram TEXT;
      ALTER TABLE campaign_recipients ADD COLUMN target_display_value TEXT;
      ALTER TABLE campaign_recipients ADD COLUMN target_normalized_value TEXT;
      ALTER TABLE campaign_recipients ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';

      UPDATE campaign_recipients
      SET
        channel = COALESCE(NULLIF(channel, ''), 'whatsapp'),
        target_display_value = COALESCE(NULLIF(target_display_value, ''), phone),
        target_normalized_value = COALESCE(NULLIF(target_normalized_value, ''), phone),
        tags_json = COALESCE(NULLIF(tags_json, ''), '[]');

      CREATE INDEX IF NOT EXISTS idx_campaign_recipients_channel_due
        ON campaign_recipients(channel, status, next_run_at);
    `
  },
  {
    id: "0006_contact_instagram_relationship_signals",
    sql: `
      ALTER TABLE contacts ADD COLUMN instagram_follows_me INTEGER;
      ALTER TABLE contacts ADD COLUMN instagram_followed_by_me INTEGER;
      ALTER TABLE contacts ADD COLUMN instagram_incoming_messages_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE contacts ADD COLUMN instagram_sent_more_than_three_messages INTEGER NOT NULL DEFAULT 0;
    `
  },
  {
    id: "0007_data_lake",
    sql: `
      CREATE TABLE IF NOT EXISTS data_lake_sources (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        label TEXT NOT NULL,
        root_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        last_scan_at TEXT,
        config_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS data_lake_assets (
        id TEXT PRIMARY KEY,
        source_id TEXT,
        origin_key TEXT NOT NULL UNIQUE,
        source_type TEXT NOT NULL,
        asset_kind TEXT NOT NULL,
        channel TEXT,
        external_id TEXT,
        contact_id TEXT,
        title TEXT NOT NULL DEFAULT '',
        text_content TEXT NOT NULL DEFAULT '',
        transcript_text TEXT,
        summary_text TEXT,
        mime_type TEXT,
        size_bytes INTEGER,
        sha256 TEXT,
        original_path TEXT,
        storage_path TEXT,
        enrichment_status TEXT NOT NULL DEFAULT 'ready',
        enrichment_model TEXT,
        enrichment_error TEXT,
        captured_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (source_id) REFERENCES data_lake_sources(id) ON DELETE SET NULL,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS data_lake_reports (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'ready',
        source_scope TEXT NOT NULL DEFAULT 'default',
        summary_text TEXT NOT NULL DEFAULT '',
        top_keywords_json TEXT NOT NULL DEFAULT '[]',
        top_bigrams_json TEXT NOT NULL DEFAULT '[]',
        top_senders_json TEXT NOT NULL DEFAULT '[]',
        top_threads_json TEXT NOT NULL DEFAULT '[]',
        intent_signals_json TEXT NOT NULL DEFAULT '[]',
        timeline_json TEXT NOT NULL DEFAULT '[]',
        totals_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_data_lake_sources_type ON data_lake_sources(source_type, status);
      CREATE INDEX IF NOT EXISTS idx_data_lake_assets_kind ON data_lake_assets(asset_kind, captured_at DESC);
      CREATE INDEX IF NOT EXISTS idx_data_lake_assets_source ON data_lake_assets(source_type, enrichment_status);
      CREATE INDEX IF NOT EXISTS idx_data_lake_assets_contact ON data_lake_assets(contact_id, captured_at DESC);
      CREATE INDEX IF NOT EXISTS idx_data_lake_reports_created_at ON data_lake_reports(created_at DESC);
    `
  },
  {
    id: "0008_templates_conditions_evergreen",
    sql: `
      -- Message templates (reusable across campaigns, automations, chatbot)
      CREATE TABLE IF NOT EXISTS message_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'text',
        body TEXT NOT NULL DEFAULT '',
        media_path TEXT,
        category TEXT NOT NULL DEFAULT 'general',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_message_templates_category ON message_templates(category);

      -- Campaign step conditions
      ALTER TABLE campaign_steps ADD COLUMN template_id TEXT REFERENCES message_templates(id) ON DELETE SET NULL;
      ALTER TABLE campaign_steps ADD COLUMN condition_type TEXT;
      ALTER TABLE campaign_steps ADD COLUMN condition_value TEXT;
      ALTER TABLE campaign_steps ADD COLUMN condition_action TEXT;
      ALTER TABLE campaign_steps ADD COLUMN condition_jump_to INTEGER;

      -- Evergreen campaign fields
      ALTER TABLE campaigns ADD COLUMN is_evergreen INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE campaigns ADD COLUMN evergreen_criteria_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE campaigns ADD COLUMN evergreen_last_evaluated_at TEXT;
    `
  },
  {
    id: "0009_events_chatbot_dashboard",
    sql: `
      -- Event-based automation triggers
      ALTER TABLE automations ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'tag';
      ALTER TABLE automations ADD COLUMN trigger_event TEXT;
      ALTER TABLE automations ADD COLUMN trigger_conditions_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE automations ADD COLUMN custom_category TEXT;

      -- Chatbot entity
      CREATE TABLE IF NOT EXISTS chatbots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        channel_scope TEXT NOT NULL DEFAULT 'any',
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS chatbot_rules (
        id TEXT PRIMARY KEY,
        chatbot_id TEXT NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
        priority INTEGER NOT NULL DEFAULT 0,
        match_type TEXT NOT NULL DEFAULT 'contains',
        keyword_pattern TEXT NOT NULL DEFAULT '',
        response_type TEXT NOT NULL DEFAULT 'text',
        response_body TEXT NOT NULL DEFAULT '',
        response_media_path TEXT,
        apply_tag TEXT,
        change_status TEXT,
        flag_for_human INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_chatbot_rules_chatbot ON chatbot_rules(chatbot_id, priority);

      -- Chatbot fallback config
      ALTER TABLE chatbots ADD COLUMN fallback_action TEXT NOT NULL DEFAULT 'silence_and_flag';
      ALTER TABLE chatbots ADD COLUMN fallback_tag TEXT NOT NULL DEFAULT 'chatbot_nao_entendeu';
    `
  },
  {
    id: "0010_performance_indices",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_jobs_type_status_scheduled
        ON jobs(type, status, scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_status_step
        ON campaign_recipients(campaign_id, status, step_index);
      CREATE INDEX IF NOT EXISTS idx_contacts_status_last_interaction
        ON contacts(status, last_interaction_at);
    `
  }
] as const;
