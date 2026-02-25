const REQUIRED_ENV_VARS = ["DATABASE_URL"] as const;

export function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}\n` +
        `Check your .env file or deployment environment.`
    );
  }

  // Sanity-check DATABASE_URL format
  const dbUrl = process.env.DATABASE_URL!;
  if (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://")) {
    throw new Error(
      `DATABASE_URL must be a valid PostgreSQL connection string (got: ${dbUrl.slice(0, 20)}...)`
    );
  }
}