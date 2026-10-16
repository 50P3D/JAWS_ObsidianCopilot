/** Tiny command line parser shared by the retrieval scripts. */

export function parseArgs(argv: string[]) {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      flags[argv[i].slice(2)] = argv[i + 1] ?? "";
      i += 1;
    } else {
      rest.push(argv[i]);
    }
  }
  return { flags, rest };
}
