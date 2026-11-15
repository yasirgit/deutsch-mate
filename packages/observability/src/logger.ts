import { redactForTelemetry } from "./redact.js";

/**
 * Typed logging contract shared by API, workers, and packages
 * (DM-012; ADR-018; docs/CODING_STANDARDS.md §13).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Structured context attached to a log entry. Values are redacted before
 * emission; callers must still avoid collecting secrets or learner content.
 */
export type LogValue =
  string | number | boolean | null | readonly LogValue[] | { readonly [key: string]: LogValue };

export type LogContext = Readonly<Record<string, LogValue>>;

export interface Logger {
  readonly debug: (message: string, context?: LogContext) => void;
  readonly info: (message: string, context?: LogContext) => void;
  readonly warn: (message: string, context?: LogContext) => void;
  readonly error: (message: string, context?: LogContext) => void;
  readonly child: (context: LogContext) => Logger;
}

export interface CreateLoggerOptions {
  readonly service: string;
  readonly environment: string;
  readonly level?: LogLevel;
  /** Defaults to writing one JSON object per line on stdout. */
  readonly sink?: (line: string) => void;
  readonly baseContext?: LogContext;
  /** Injectable clock for tests. */
  readonly now?: () => Date;
}

export interface StructuredLogRecord {
  readonly timestamp: string;
  readonly severity: LogLevel;
  readonly service: string;
  readonly environment: string;
  readonly message: string;
  readonly [key: string]: unknown;
}

function emit(
  options: Required<Pick<CreateLoggerOptions, "service" | "environment" | "sink" | "now">> & {
    readonly level: LogLevel;
    readonly minLevel: LogLevel;
    readonly baseContext: LogContext;
  },
  severity: LogLevel,
  message: string,
  context?: LogContext,
): void {
  if (LOG_LEVEL_RANK[severity] < LOG_LEVEL_RANK[options.minLevel]) {
    return;
  }

  const redactedContext = redactForTelemetry({
    ...options.baseContext,
    ...(context ?? {}),
  }) as Record<string, unknown>;

  const record: StructuredLogRecord = {
    timestamp: options.now().toISOString(),
    severity,
    service: options.service,
    environment: options.environment,
    message: String(redactForTelemetry(message)),
    ...redactedContext,
  };

  options.sink(JSON.stringify(record));
}

/**
 * Creates a structured JSON logger with mandatory redaction of context and
 * message fields. OpenTelemetry exporters arrive in a later task; this is the
 * safe logging baseline (ADR-018).
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const minLevel = options.level ?? "info";
  const sink =
    options.sink ??
    ((line: string) => {
      console.log(line);
    });
  const now = options.now ?? (() => new Date());
  const baseContext = options.baseContext ?? {};

  const shared = {
    service: options.service,
    environment: options.environment,
    sink,
    now,
    minLevel,
    baseContext,
    level: minLevel,
  };

  const logger: Logger = {
    debug: (message, context) => {
      emit(shared, "debug", message, context);
    },
    info: (message, context) => {
      emit(shared, "info", message, context);
    },
    warn: (message, context) => {
      emit(shared, "warn", message, context);
    },
    error: (message, context) => {
      emit(shared, "error", message, context);
    },
    child: (context) =>
      createLogger({
        service: options.service,
        environment: options.environment,
        level: minLevel,
        sink,
        now,
        baseContext: { ...baseContext, ...context },
      }),
  };

  return logger;
}
