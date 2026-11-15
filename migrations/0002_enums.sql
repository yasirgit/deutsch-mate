-- DM-021: capability-owned enums (docs/Database.md §2).

CREATE TYPE iam.account_status AS ENUM (
  'active',
  'deletion_pending',
  'deleted',
  'blocked'
);

CREATE TYPE iam.role_code AS ENUM (
  'learner',
  'content_editor',
  'content_reviewer',
  'support',
  'privacy_operator',
  'billing_operator',
  'admin'
);

CREATE TYPE iam.consent_decision AS ENUM (
  'granted',
  'withdrawn',
  'declined'
);

CREATE TYPE learner.cefr_level AS ENUM (
  'A1',
  'A2',
  'B1',
  'B2'
);

CREATE TYPE learner.goal_code AS ENUM (
  'relocation',
  'work',
  'study',
  'travel',
  'daily_life',
  'general'
);

CREATE TYPE content.release_status AS ENUM (
  'draft',
  'approved',
  'published',
  'retired'
);

CREATE TYPE content.skill_code AS ENUM (
  'reading',
  'listening',
  'writing',
  'vocabulary',
  'grammar'
);

CREATE TYPE content.activity_type AS ENUM (
  'explanation',
  'selection',
  'matching',
  'ordering',
  'cloze',
  'typed_response',
  'listening',
  'writing',
  'formative_check'
);

CREATE TYPE content.transcript_policy AS ENUM (
  'always',
  'after_first_submission',
  'after_completion',
  'never'
);

CREATE TYPE learning.session_status AS ENUM (
  'active',
  'completed',
  'abandoned'
);

CREATE TYPE learning.attempt_status AS ENUM (
  'submitted',
  'scored',
  'feedback_pending',
  'completed',
  'feedback_unavailable'
);

CREATE TYPE learning.evidence_validity AS ENUM (
  'valid',
  'invalid',
  'unverified'
);

CREATE TYPE learning.recommendation_kind AS ENUM (
  'lesson',
  'review',
  'upgrade'
);

CREATE TYPE ai.feature_code AS ENUM (
  'tutor_chat',
  'writing_correction',
  'content_validation'
);

CREATE TYPE ai.run_status AS ENUM (
  'queued',
  'running',
  'succeeded',
  'blocked',
  'failed',
  'timed_out',
  'cancelled'
);

CREATE TYPE ai.disposition AS ENUM (
  'released',
  'blocked',
  'safe_failure',
  'internal_only'
);

CREATE TYPE ai.message_role AS ENUM (
  'system',
  'user',
  'assistant',
  'tool'
);

CREATE TYPE billing.provider_code AS ENUM (
  'stripe',
  'apple',
  'google',
  'manual'
);

CREATE TYPE billing.subscription_status AS ENUM (
  'incomplete',
  'trialing',
  'active',
  'past_due',
  'paused',
  'cancelled',
  'unpaid'
);

CREATE TYPE billing.entitlement_status AS ENUM (
  'active',
  'expired',
  'revoked'
);

CREATE TYPE media.object_state AS ENUM (
  'pending_upload',
  'available',
  'quarantined',
  'deletion_pending',
  'deleted'
);

CREATE TYPE media.data_class AS ENUM (
  'lesson_audio',
  'writing_attachment',
  'ai_trace_content',
  'privacy_export',
  'audit_export'
);

CREATE TYPE privacy.request_type AS ENUM (
  'export',
  'delete'
);

CREATE TYPE privacy.request_status AS ENUM (
  'requested',
  'identity_verified',
  'processing',
  'completed',
  'partially_retained',
  'rejected',
  'cancelled',
  'failed'
);

CREATE TYPE support.case_category AS ENUM (
  'account',
  'learning',
  'privacy',
  'billing'
);

CREATE TYPE support.case_status AS ENUM (
  'open',
  'in_progress',
  'waiting_for_user',
  'resolved',
  'closed'
);

CREATE TYPE ops.delivery_status AS ENUM (
  'pending',
  'publishing',
  'published',
  'failed',
  'dead_letter'
);
