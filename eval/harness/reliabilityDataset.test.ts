import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  parseRevisionDataset,
  REVISION_KEYS,
  serialiseRevisionItems,
  type RevisionItem,
} from "./reliabilityDataset";

const nonBlank = fc.string({ minLength: 1, unit: "binary" }).filter((s) => s.trim() !== "");

const itemArb: fc.Arbitrary<RevisionItem> = fc.record({
  id: fc.string({ minLength: 1, unit: "binary" }),
  rev_id: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  page_title: nonBlank,
  timestamp: fc
    .date({ min: new Date("2001-01-15T00:00:00Z"), max: new Date("2030-12-31T23:59:59Z"), noInvalidDate: true })
    .map((d) => d.toISOString()),
  reverted: fc.boolean(),
  split: fc.constantFrom("dev" as const, "test" as const),
}, { noNullPrototype: true }); // parsed items are plain objects, and deepEqual compares prototypes

// Feature: reliability-scorer, Property 15: Revision dataset round trip
// **Validates: Requirements 9.6, 9.7**
test("Property 15: serialise then parse gives the same items", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(itemArb, { selector: (item) => item.id, maxLength: 30 }),
      fc.string({ unit: "binary" }),
      (items, header) => {
        const text = serialiseRevisionItems(items, header);
        assert.deepEqual(parseRevisionDataset(text), items);
      },
    ),
    { numRuns: 100 },
  );
});

const GOOD = {
  id: "rev-1",
  rev_id: 1,
  page_title: "Treaty of Versailles",
  timestamp: "2024-05-01T12:00:00Z",
  reverted: false,
  split: "dev",
};

/** A file with a header comment, one good row on line 2, and the bad row on line 3. */
function fileWith(badLine: string): string {
  return ["// seed 201", JSON.stringify(GOOD), badLine].join("\n");
}

const row = (overrides: Record<string, unknown>) => JSON.stringify({ ...GOOD, id: "rev-2", rev_id: 2, ...overrides });

const errorCases: Array<[string, string, RegExp]> = [
  ["invalid JSON", "{not json", /^data\.jsonl:3: not valid JSON/],
  ["missing id", JSON.stringify({ ...GOOD, id: undefined }), /^data\.jsonl:3: missing "id"/],
  ["duplicate id", JSON.stringify({ ...GOOD, rev_id: 2 }), /^data\.jsonl:3: duplicate id "rev-1"/],
  ["non-numeric rev_id", row({ rev_id: "2" }), /^data\.jsonl:3: "rev_id" must be a positive integer/],
  ["non-boolean reverted", row({ reverted: "true" }), /^data\.jsonl:3: "reverted" must be true or false/],
  ["bad split", row({ split: "train" }), /^data\.jsonl:3: "split" must be dev or test/],
];

for (const [name, line, message] of errorCases) {
  test(`parseRevisionDataset rejects ${name} with a line number`, () => {
    assert.throws(() => parseRevisionDataset(fileWith(line), "data.jsonl"), { message });
  });
}

test("a pool row with a user field is written and parsed with only the fixed keys", () => {
  const poolRow = { ...GOOD, user: "Example user", userid: 42 } as RevisionItem;
  const text = serialiseRevisionItems([poolRow], "seed 201");
  assert.ok(!text.includes("Example user"));
  const dataLine = text.split("\n").find((l) => l.startsWith("{"));
  assert.ok(dataLine);
  assert.deepEqual(Object.keys(JSON.parse(dataLine)), [...REVISION_KEYS]);

  const parsed = parseRevisionDataset(JSON.stringify(poolRow));
  assert.deepEqual(Object.keys(parsed[0]), [...REVISION_KEYS]);
  assert.deepEqual(parsed, [GOOD]);
});
