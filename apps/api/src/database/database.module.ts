import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@stayx/database';

export const DRIZZLE = Symbol('DRIZZLE');
const PG_CLIENT = Symbol('PG_CLIENT');

export type Db = PostgresJsDatabase<typeof schema>;

const DEFAULT_DATABASE_URL = 'postgres://stayx:stayx@localhost:5433/stayx_pos';

@Global()
@Module({
  providers: [
    {
      provide: PG_CLIENT,
      useFactory: () => postgres(process.env['DATABASE_URL'] ?? DEFAULT_DATABASE_URL),
    },
    {
      provide: DRIZZLE,
      inject: [PG_CLIENT],
      useFactory: (client: postgres.Sql): Db => drizzle(client, { schema }),
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_CLIENT) private readonly client: postgres.Sql) {}

  async onApplicationShutdown() {
    await this.client.end({ timeout: 5 });
  }
}
