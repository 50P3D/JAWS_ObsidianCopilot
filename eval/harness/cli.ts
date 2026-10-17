/**
 * Tiny command line parser for the eval scripts.
 *
 * `--name value` sets a string flag. A flag with no value (`--final`) or followed by
 * another flag is treated as a boolean and stored as "true".
 */

export interface Args {
  flags: Record<string, string>;
  rest: string[];
}

export function parseArgs(argv: string[]): Args {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[a.slice(2)] = "true";
      } else {
        flags[a.slice(2)] = next;
        i += 1;
      }
    } else {
      rest.push(a);
    }
  }
  return { flags, rest };
}

export function flagNumber(flags: Record<string, string>, name: string, fallback: number): number {
  const raw = flags[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number, got "${raw}"`);
  return n;
}

export function flagBool(flags: Record<string, string>, name: string): boolean {
  return flags[name] === "true";
}
