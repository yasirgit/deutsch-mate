/**
 * Optional Product API database binding.
 * Uses inline DATABASE_URL in development/test; production Secrets Manager
 * resolution lands with infrastructure work.
 */

import { Global, Module, type DynamicModule, type OnModuleDestroy } from "@nestjs/common";
import { createKysely, createPgPool, type Database } from "@deutsch-mate/database";
import type { Kysely } from "kysely";

import { KYSELY } from "./database.tokens.js";

export interface DatabaseModuleOptions {
  readonly connectionString: string;
}

class DatabaseLifecycle implements OnModuleDestroy {
  constructor(private readonly db: Kysely<Database>) {}

  async onModuleDestroy(): Promise<void> {
    // Kysely.destroy() ends the underlying pool.
    await this.db.destroy();
  }
}

@Global()
@Module({})
export class DatabaseModule {
  static register(options: DatabaseModuleOptions): DynamicModule {
    const pool = createPgPool({
      connectionString: options.connectionString,
      max: 10,
    });
    const db = createKysely({ pool });
    const lifecycle = new DatabaseLifecycle(db);

    return {
      module: DatabaseModule,
      providers: [
        { provide: KYSELY, useValue: db },
        { provide: DatabaseLifecycle, useValue: lifecycle },
      ],
      exports: [KYSELY],
    };
  }

  /** No-op registration when DATABASE_URL is absent (live-only health). */
  static registerOptional(): DynamicModule {
    const connectionString = process.env["DATABASE_URL"];
    if (typeof connectionString === "string" && connectionString.length > 0) {
      return DatabaseModule.register({ connectionString });
    }
    return {
      module: DatabaseModule,
      providers: [{ provide: KYSELY, useValue: null }],
      exports: [KYSELY],
    };
  }
}
