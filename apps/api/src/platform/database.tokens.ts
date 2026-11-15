import type { Kysely } from "kysely";

import type { Database } from "@deutsch-mate/database";

export const KYSELY = Symbol("DM_KYSELY");

export type KyselyToken = Kysely<Database>;
