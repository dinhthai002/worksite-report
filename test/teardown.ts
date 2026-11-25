import { currentTestDatabase, setTestDatabase } from "./test-database";

/** Jest globalTeardown: stops the container once the last project that uses it has finished. */
async function globalTeardown(): Promise<void> {
  const database = currentTestDatabase();
  if (database === undefined) {
    return;
  }
  database.users -= 1;
  if (database.users > 0) {
    return;
  }
  setTestDatabase(undefined);
  await database.container.stop();
}

export = globalTeardown;
