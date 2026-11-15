/**
 * Disposable published-curriculum cache (Database.md §9).
 *
 * Key pattern: `dm:{env}:content:release:{releaseId}` — Redis when available,
 * otherwise an in-process TTL map. Cache miss always reloads from PostgreSQL;
 * Redis loss never loses authority.
 */

import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const ENVELOPE_VERSION = 1 as const;

interface CacheEnvelope {
  readonly v: typeof ENVELOPE_VERSION;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly payload: unknown;
}

@Injectable()
export class CurriculumCache implements OnModuleDestroy {
  private readonly logger = new Logger(CurriculumCache.name);
  private readonly memory = new Map<string, { expiresAtMs: number; payload: unknown }>();
  private redis: Redis | null = null;

  constructor() {
    const url = process.env["REDIS_URL"];
    if (typeof url === "string" && url.length > 0) {
      try {
        this.redis = new Redis(url, {
          maxRetriesPerRequest: 1,
          enableReadyCheck: false,
          lazyConnect: true,
        });
        void this.redis.connect().catch((err: unknown) => {
          this.logger.warn(
            `Redis curriculum cache unavailable; using memory only (${String(err)})`,
          );
          void this.redis?.quit().catch(() => undefined);
          this.redis = null;
        });
      } catch {
        this.redis = null;
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => undefined);
      this.redis = null;
    }
    this.memory.clear();
  }

  releaseKey(releaseId: string): string {
    const env = process.env["NODE_ENV"] === "production" ? "prod" : "dev";
    return `dm:${env}:content:release:${releaseId}`;
  }

  async getJson<T>(key: string): Promise<T | null> {
    const fromMemory = this.memoryGet<T>(key);
    if (fromMemory !== null) {
      return fromMemory;
    }
    if (!this.redis) {
      return null;
    }
    try {
      const raw = await this.redis.get(key);
      if (raw === null) {
        return null;
      }
      const envelope = JSON.parse(raw) as CacheEnvelope;
      if (envelope.v !== ENVELOPE_VERSION) {
        return null;
      }
      if (Date.parse(envelope.expiresAt) <= Date.now()) {
        return null;
      }
      this.memorySet(key, envelope.payload, Date.parse(envelope.expiresAt));
      return envelope.payload as T;
    } catch {
      return null;
    }
  }

  async setJson(key: string, payload: unknown, ttlSeconds = CACHE_TTL_SECONDS): Promise<void> {
    const now = Date.now();
    const expiresAtMs = now + ttlSeconds * 1000;
    this.memorySet(key, payload, expiresAtMs);
    if (!this.redis) {
      return;
    }
    const envelope: CacheEnvelope = {
      v: ENVELOPE_VERSION,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      payload,
    };
    try {
      await this.redis.set(key, JSON.stringify(envelope), "EX", ttlSeconds);
    } catch {
      // Disposable acceleration only.
    }
  }

  private memoryGet<T>(key: string): T | null {
    const entry = this.memory.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAtMs <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return entry.payload as T;
  }

  private memorySet(key: string, payload: unknown, expiresAtMs: number): void {
    this.memory.set(key, { expiresAtMs, payload });
  }
}
