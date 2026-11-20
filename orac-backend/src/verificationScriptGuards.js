// Keep fixture imports and local SMTP probes explicit. These checks run before
// either script opens a database connection or sends an email.
export function requireEmptyStoreBootstrap(args, env) {
  const sourceFile = args[0];
  if (!sourceFile || sourceFile.startsWith("-") || !args.includes("--apply") || env.ORAC_ALLOW_EMPTY_STORE_BOOTSTRAP !== "true") {
    throw new Error("Empty-store bootstrap only: pass an explicit source JSON path, --apply, and ORAC_ALLOW_EMPTY_STORE_BOOTSTRAP=true. Never use this command to change an existing Admin account.");
  }
  return sourceFile;
}

export function requireLocalEmailProbe(args, env, dryRun) {
  const fixtureIndex = args.indexOf("--fixture-json");
  const quoteIndex = args.indexOf("--quote-id");
  const fixturePath = args[fixtureIndex + 1];
  const quoteId = args[quoteIndex + 1];
  if (fixtureIndex < 0 || quoteIndex < 0 || !fixturePath || fixturePath.startsWith("--") || !quoteId || quoteId.startsWith("--")) {
    throw new Error("Pass an explicit --fixture-json path and --quote-id. This script never reads the live PostgreSQL store.");
  }
  if (!dryRun && (!args.includes("--live-fixture") || !String(env.TEST_RECIPIENT || "").trim())) {
    throw new Error("Live local-fixture SMTP probe requires --live-fixture and an explicit TEST_RECIPIENT. It does not test the deployed portal or prove inbox delivery.");
  }
  return { fixturePath, quoteId };
}
