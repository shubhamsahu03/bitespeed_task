/**
 * Integration tests for POST /identify
 *
 * Requires a live PostgreSQL database (Neon or local).
 * Set DATABASE_URL and DIRECT_URL in your .env before running:
 *   npm test
 *
 * Each test cleans the Contact table in beforeEach so scenarios are independent.
 * Tests run serially (--runInBand) to avoid cross-test DB conflicts.
 */

import request from "supertest";
import app from "../app";
import { prisma } from "../lib/prisma";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function cleanDb(): Promise<void> {
  await prisma.contact.deleteMany();
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE "Contact_id_seq" RESTART WITH 1`);
}

async function post(body: Record<string, unknown>) {
  return request(app)
    .post("/identify")
    .send(body)
    .set("Content-Type", "application/json");
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(async () => {
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
});

// =============================================================================
// SCENARIO 1 — New user creation
// =============================================================================

describe("Scenario 1 — New user creation", () => {
  it("creates a primary contact with both fields and returns it", async () => {
    const res = await post({ email: "doc@future.com", phoneNumber: "999999" });

    expect(res.status).toBe(200);
    expect(res.body.contact).toMatchObject({
      primaryContactId: expect.any(Number),
      emails: ["doc@future.com"],
      phoneNumbers: ["999999"],
      secondaryContactIds: [],
    });
  });

  it("creates a primary when only email is provided", async () => {
    const res = await post({ email: "solo@test.com" });
    expect(res.status).toBe(200);
    expect(res.body.contact.emails).toEqual(["solo@test.com"]);
    expect(res.body.contact.phoneNumbers).toEqual([]);
    expect(res.body.contact.secondaryContactIds).toEqual([]);
  });

  it("creates a primary when only phoneNumber is provided", async () => {
    const res = await post({ phoneNumber: "111222333" });
    expect(res.status).toBe(200);
    expect(res.body.contact.emails).toEqual([]);
    expect(res.body.contact.phoneNumbers).toEqual(["111222333"]);
  });

  it("primaryContactId is never present in secondaryContactIds", async () => {
    const res = await post({ email: "doc@future.com", phoneNumber: "999999" });
    const { primaryContactId, secondaryContactIds } = res.body.contact;
    expect(secondaryContactIds).not.toContain(primaryContactId);
  });

  it("null email is excluded from emails array", async () => {
    const res = await post({ phoneNumber: "555000" });
    expect(res.body.contact.emails).toEqual([]);
  });

  it("null phoneNumber is excluded from phoneNumbers array", async () => {
    const res = await post({ email: "noPhone@test.com" });
    expect(res.body.contact.phoneNumbers).toEqual([]);
  });
});

// =============================================================================
// SCENARIO 2 — Add new email to existing phone
// =============================================================================

describe("Scenario 2 — Add new email to existing phone", () => {
  it("creates secondary when new email shares existing phone", async () => {
    await post({ email: "lorraine@hillvalley.edu", phoneNumber: "123456" });
    const res = await post({ email: "mcfly@hillvalley.edu", phoneNumber: "123456" });

    expect(res.status).toBe(200);
    const { contact } = res.body;
    expect(contact.primaryContactId).toBe(1);
    expect(contact.emails).toEqual(["lorraine@hillvalley.edu", "mcfly@hillvalley.edu"]);
    expect(contact.phoneNumbers).toEqual(["123456"]);
    expect(contact.secondaryContactIds).toHaveLength(1);
  });

  it("primary email is always first in emails array", async () => {
    await post({ email: "first@test.com", phoneNumber: "100" });
    await post({ email: "second@test.com", phoneNumber: "100" });
    await post({ email: "third@test.com", phoneNumber: "100" });

    const res = await post({ email: "first@test.com" });
    expect(res.body.contact.emails[0]).toBe("first@test.com");
  });
});

// =============================================================================
// SCENARIO 3 — Add new phone to existing email
// =============================================================================

describe("Scenario 3 — Add new phone to existing email", () => {
  it("creates secondary when new phone shares existing email", async () => {
    await post({ email: "lorraine@hillvalley.edu", phoneNumber: "123456" });
    const res = await post({ email: "lorraine@hillvalley.edu", phoneNumber: "999999" });

    expect(res.status).toBe(200);
    const { contact } = res.body;
    expect(contact.primaryContactId).toBe(1);
    expect(contact.emails).toEqual(["lorraine@hillvalley.edu"]);
    expect(contact.phoneNumbers).toEqual(["123456", "999999"]);
    expect(contact.secondaryContactIds).toHaveLength(1);
  });

  it("primary phone is always first in phoneNumbers array", async () => {
    await post({ email: "a@test.com", phoneNumber: "111" });
    await post({ email: "a@test.com", phoneNumber: "222" });
    await post({ email: "a@test.com", phoneNumber: "333" });

    const res = await post({ email: "a@test.com" });
    expect(res.body.contact.phoneNumbers[0]).toBe("111");
  });
});

// =============================================================================
// SCENARIO 4 — Two independent primaries merging
// =============================================================================

describe("Scenario 4 — Two independent primaries merge", () => {
  it(
    "demotes the newer primary when bridging request arrives",
    async () => {
      await post({ email: "george@hillvalley.edu", phoneNumber: "919191" }); // id=1 older
      await post({ email: "biffsucks@hillvalley.edu", phoneNumber: "717171" }); // id=2 newer

      const res = await post({
        email: "george@hillvalley.edu",
        phoneNumber: "717171",
      });

      expect(res.status).toBe(200);
      const { contact } = res.body;
      expect(contact.primaryContactId).toBe(1);
      expect(contact.emails[0]).toBe("george@hillvalley.edu");
      expect(contact.emails).toContain("biffsucks@hillvalley.edu");
      expect(contact.phoneNumbers).toContain("919191");
      expect(contact.phoneNumbers).toContain("717171");
      expect(contact.secondaryContactIds).toContain(2);
    },
    20000
  );

  it(
    "older primary stays canonical regardless of request order",
    async () => {
      await post({ email: "older@test.com", phoneNumber: "301001" }); // id=1
      await post({ email: "newer@test.com", phoneNumber: "302002" }); // id=2

      // Bridge via newer's email and older's phone — older must still win
      const res = await post({ email: "newer@test.com", phoneNumber: "301001" });

      expect(res.body.contact.primaryContactId).toBe(1);
      expect(res.body.contact.emails[0]).toBe("older@test.com");
      expect(res.body.contact.secondaryContactIds).toContain(2);
    },
    20000
  );

  it(
    "merging preserves all existing secondaries from both clusters",
    async () => {
      // Cluster A: primary + 1 secondary
      await post({ email: "pa@test.com", phoneNumber: "401001" }); // id=1 primary
      await post({ email: "sa@test.com", phoneNumber: "401001" }); // id=2 secondary under 1

      // Cluster B: primary + 1 secondary
      await post({ email: "pb@test.com", phoneNumber: "402002" }); // id=3 primary
      await post({ email: "sb@test.com", phoneNumber: "402002" }); // id=4 secondary under 3

      // Bridge the two clusters
      const res = await post({ email: "pa@test.com", phoneNumber: "402002" });

      expect(res.status).toBe(200);
      const { contact } = res.body;
      expect(contact.primaryContactId).toBe(1);
      // All 4 original contacts must be in the merged cluster
      expect(contact.emails).toContain("pa@test.com");
      expect(contact.emails).toContain("sa@test.com");
      expect(contact.emails).toContain("pb@test.com");
      expect(contact.emails).toContain("sb@test.com");
      // secondaries: id=2, id=3 (demoted), id=4, plus new bridging contact
      expect(contact.secondaryContactIds).toContain(2);
      expect(contact.secondaryContactIds).toContain(3);
      expect(contact.secondaryContactIds).toContain(4);
    },
    25000
  );

  it(
    "three independent primaries all merge into oldest",
    async () => {
      await post({ email: "p1@test.com", phoneNumber: "501001" }); // id=1 oldest
      await post({ email: "p2@test.com", phoneNumber: "502002" }); // id=2
      await post({ email: "p3@test.com", phoneNumber: "503003" }); // id=3 newest

      // Bridge 1+2
      await post({ email: "p1@test.com", phoneNumber: "502002" });
      // Bridge 2+3 (now 2 is already secondary under 1)
      const res = await post({ email: "p2@test.com", phoneNumber: "503003" });

      expect(res.status).toBe(200);
      expect(res.body.contact.primaryContactId).toBe(1);
      expect(res.body.contact.emails).toContain("p1@test.com");
      expect(res.body.contact.emails).toContain("p2@test.com");
      expect(res.body.contact.emails).toContain("p3@test.com");
    },
    25000
  );
});

// =============================================================================
// SCENARIO 5 — Transitive linking
// =============================================================================

describe("Scenario 5 — Transitive linking (A→B, B→C → unified)", () => {
  it(
    "flattens a transitive chain into one cluster",
    async () => {
      await post({ email: "a@test.com", phoneNumber: "111" }); // id=1
      await post({ email: "b@test.com", phoneNumber: "111" }); // id=2 — links to A via phone
      await post({ email: "c@test.com", phoneNumber: "222" }); // id=3 — independent

      // Bridge B+C
      const res = await post({ email: "b@test.com", phoneNumber: "222" });

      expect(res.status).toBe(200);
      const { contact } = res.body;
      expect(contact.primaryContactId).toBe(1);
      expect(contact.emails).toContain("a@test.com");
      expect(contact.emails).toContain("b@test.com");
      expect(contact.emails).toContain("c@test.com");
      expect(contact.secondaryContactIds.length).toBeGreaterThanOrEqual(2);
    },
    25000
  );

  it(
    "all secondaries directly reference canonical primary after chain merge",
    async () => {
      await post({ email: "x@test.com", phoneNumber: "601001" }); // id=1
      await post({ email: "y@test.com", phoneNumber: "601001" }); // id=2 secondary under 1
      await post({ email: "z@test.com", phoneNumber: "602002" }); // id=3 independent

      await post({ email: "y@test.com", phoneNumber: "602002" }); // bridge 2+3

      // Verify DB — no contact should have linkedId pointing to a secondary
      const secondaries = await prisma.contact.findMany({
        where: { linkPrecedence: "secondary" },
      });
      const primaryIds = await prisma.contact.findMany({
        where: { linkPrecedence: "primary" },
        select: { id: true },
      });
      const primaryIdSet = new Set(primaryIds.map((p:any) => p.id));

      for (const s of secondaries) {
        expect(s.linkedId).not.toBeNull();
        expect(primaryIdSet.has(s.linkedId!)).toBe(true);
      }
    },
    25000
  );
});

// =============================================================================
// SCENARIO 6 — Idempotency
// =============================================================================

describe("Scenario 6 — Idempotency", () => {
  it(
    "identical requests do not create duplicate rows",
    async () => {
      const body = { email: "idem@test.com", phoneNumber: "444555" };
      const res1 = await post(body);
      const res2 = await post(body);
      const res3 = await post(body);

      expect(res1.status).toBe(200);
      expect(res2.body).toEqual(res1.body);
      expect(res3.body).toEqual(res1.body);

      const count = await prisma.contact.count();
      expect(count).toBe(1);
    },
    20000
  );

  it(
    "idempotent on secondary creation too",
    async () => {
      await post({ email: "primary@test.com", phoneNumber: "100" });

      const body = { email: "secondary@test.com", phoneNumber: "100" };
      const res1 = await post(body);
      const res2 = await post(body);

      expect(res1.status).toBe(200);
      expect(res2.body).toEqual(res1.body);

      const count = await prisma.contact.count();
      expect(count).toBe(2);
    },
    20000
  );

  it(
    "sending only email of existing contact returns correct cluster",
    async () => {
      await post({ email: "lorraine@hillvalley.edu", phoneNumber: "123456" });
      await post({ email: "mcfly@hillvalley.edu", phoneNumber: "123456" });

      // Lookup by email only — must return same merged cluster
      const res = await post({ email: "lorraine@hillvalley.edu" });
      expect(res.status).toBe(200);
      expect(res.body.contact.primaryContactId).toBe(1);
      expect(res.body.contact.secondaryContactIds).toHaveLength(1);
    },
    20000
  );

  it(
    "sending only phone of existing contact returns correct cluster",
    async () => {
      await post({ email: "lorraine@hillvalley.edu", phoneNumber: "123456" });
      await post({ email: "mcfly@hillvalley.edu", phoneNumber: "123456" });

      // Lookup by phone only — must return same merged cluster
      const res = await post({ phoneNumber: "123456" });
      expect(res.status).toBe(200);
      expect(res.body.contact.primaryContactId).toBe(1);
      expect(res.body.contact.secondaryContactIds).toHaveLength(1);
    },
    20000
  );
});

// =============================================================================
// SCENARIO 7 — Input matches an existing secondary directly
// =============================================================================

describe("Scenario 7 — Request matches a secondary contact", () => {
  it(
    "returns canonical primary even when input matches a secondary",
    async () => {
      await post({ email: "primary@test.com", phoneNumber: "501001" }); // id=1 primary
      await post({ email: "secondary@test.com", phoneNumber: "501001" }); // id=2 secondary

      // Request using the secondary's own details
      const res = await post({ email: "secondary@test.com", phoneNumber: "501001" });

      expect(res.status).toBe(200);
      // Must still return the primary, not the secondary
      expect(res.body.contact.primaryContactId).toBe(1);
      expect(res.body.contact.secondaryContactIds).toContain(2);
    },
    20000
  );

  it(
    "returns correct cluster when matching only secondary's email",
    async () => {
      await post({ email: "primary@test.com", phoneNumber: "501001" });
      await post({ email: "secondary@test.com", phoneNumber: "501001" });

      const res = await post({ email: "secondary@test.com" });

      expect(res.status).toBe(200);
      expect(res.body.contact.primaryContactId).toBe(1);
    },
    20000
  );
});

// =============================================================================
// SCENARIO 8 — Response structure invariants
// =============================================================================

describe("Scenario 8 — Response structure invariants", () => {
  it("response always has all four required fields", async () => {
    const res = await post({ email: "check@test.com" });
    const { contact } = res.body;

    expect(contact).toHaveProperty("primaryContactId");
    expect(contact).toHaveProperty("emails");
    expect(contact).toHaveProperty("phoneNumbers");
    expect(contact).toHaveProperty("secondaryContactIds");
  });

  it("emails array contains no duplicates", async () => {
    await post({ email: "dup@test.com", phoneNumber: "701001" });
    await post({ email: "dup@test.com", phoneNumber: "702002" }); // same email

    const res = await post({ email: "dup@test.com" });
    const { emails } = res.body.contact;
    const unique = [...new Set(emails)];
    expect(emails).toEqual(unique);
  });

  it("phoneNumbers array contains no duplicates", async () => {
    await post({ email: "e1@test.com", phoneNumber: "800800" });
    await post({ email: "e2@test.com", phoneNumber: "800800" }); // same phone

    const res = await post({ phoneNumber: "800800" });
    const { phoneNumbers } = res.body.contact;
    const unique = [...new Set(phoneNumbers)];
    expect(phoneNumbers).toEqual(unique);
  });

  it("primaryContactId is never in secondaryContactIds", async () => {
    await post({ email: "pa@test.com", phoneNumber: "401001" });
    await post({ email: "sa1@test.com", phoneNumber: "401001" });
    await post({ email: "sa2@test.com", phoneNumber: "401001" });

    const res = await post({ email: "pa@test.com" });
    const { primaryContactId, secondaryContactIds } = res.body.contact;
    expect(secondaryContactIds).not.toContain(primaryContactId);
  });

  it("secondaryContactIds are sorted ascending", async () => {
    await post({ email: "base@test.com", phoneNumber: "402002" });
    await post({ email: "s1@test.com", phoneNumber: "402002" });
    await post({ email: "s2@test.com", phoneNumber: "402002" });
    await post({ email: "s3@test.com", phoneNumber: "402002" });

    const res = await post({ email: "base@test.com" });
    const ids = res.body.contact.secondaryContactIds as number[];
    const sorted = [...ids].sort((a, b) => a - b);
    expect(ids).toEqual(sorted);
  });
});

// =============================================================================
// SCENARIO 9 — Input trimming
// =============================================================================

describe("Scenario 9 — Input whitespace trimming", () => {
  it("trims leading and trailing whitespace from email", async () => {
    const res = await post({ email: "  trim@test.com  " });
    expect(res.status).toBe(200);
    expect(res.body.contact.emails).toEqual(["trim@test.com"]);
  });

  it("trims leading and trailing whitespace from phoneNumber", async () => {
    const res = await post({ phoneNumber: "  123456  " });
    expect(res.status).toBe(200);
    expect(res.body.contact.phoneNumbers).toEqual(["123456"]);
  });
});

// =============================================================================
// VALIDATION
// =============================================================================

describe("Validation", () => {
  it("returns 400 when both fields are missing", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when both fields are null", async () => {
    const res = await post({ email: null, phoneNumber: null });
    expect(res.status).toBe(400);
  });

  it("returns 400 when both fields are empty strings", async () => {
    const res = await post({ email: "", phoneNumber: "" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid email format", async () => {
    const res = await post({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe("email");
  });

  it("returns 400 for invalid phone format", async () => {
    const res = await post({ phoneNumber: "abc!@#$%^&" });
    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe("phoneNumber");
  });

  it("returns 400 for email that is just whitespace", async () => {
    const res = await post({ email: "   " });
    expect(res.status).toBe(400);
  });

  it("returns 200 for valid phone-only request", async () => {
    const res = await post({ email: null, phoneNumber: "123456" });
    expect(res.status).toBe(200);
  });

  it("returns 200 for valid email-only request", async () => {
    const res = await post({ email: "valid@test.com", phoneNumber: null });
    expect(res.status).toBe(200);
  });

  it("response always has HTTP 200 for valid requests", async () => {
    const res = await post({ email: "always200@test.com" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("contact");
  });
});