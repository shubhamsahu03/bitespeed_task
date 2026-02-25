import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  Contact,
  TxClient,
  findDirectMatches,
  fetchCluster,
  fetchFinalCluster,
  demoteToSecondary,
  reparentSecondaries,
  createContact,
  findExactMatch,
} from "../repositories/contact.repository";

export interface IdentifyInput {
  email?: string | null;
  phoneNumber?: string | null;
}

export interface IdentifyResponse {
  contact: {
    primaryContactId: number;
    emails: string[];
    phoneNumbers: string[];
    secondaryContactIds: number[];
  };
}

// ── Response formatter ────────────────────────────────────────────────────────

function formatResponse(cluster: Contact[]): IdentifyResponse {
  const primary = cluster.find((c) => c.linkPrecedence === "primary");
  if (!primary) throw new Error("Invariant violated: no primary in cluster");

  const secondaries = cluster
    .filter((c) => c.linkPrecedence === "secondary")
    .sort((a, b) => a.id - b.id);

  const emailsSeen = new Set<string>();
  const emails: string[] = [];
  const addEmail = (e: string | null) => {
    if (e && !emailsSeen.has(e)) { emailsSeen.add(e); emails.push(e); }
  };
  addEmail(primary.email);
  secondaries.forEach((c) => addEmail(c.email));

  const phonesSeen = new Set<string>();
  const phoneNumbers: string[] = [];
  const addPhone = (p: string | null) => {
    if (p && !phonesSeen.has(p)) { phonesSeen.add(p); phoneNumbers.push(p); }
  };
  addPhone(primary.phoneNumber);
  secondaries.forEach((c) => addPhone(c.phoneNumber));

  return {
    contact: {
      primaryContactId: primary.id,
      emails,
      phoneNumbers,
      secondaryContactIds: secondaries.map((c) => c.id),
    },
  };
}

// ── Core identity resolution ──────────────────────────────────────────────────

export async function identify(input: IdentifyInput): Promise<IdentifyResponse> {
  const { email, phoneNumber } = input;

  // Validation guard (belt-and-suspenders; controller also validates)
  if (!email && !phoneNumber) {
    throw Object.assign(
      new Error("At least one of email or phoneNumber must be provided"),
      { statusCode: 400 }
    );
  }

  return prisma.$transaction(async (tx: TxClient) => {
    // ── Step 2: Find direct matches ──────────────────────────────────────────
    const directMatches = await findDirectMatches(tx, email, phoneNumber);

    // ── Step 3: No matches → create new primary ──────────────────────────────
    if (directMatches.length === 0) {
      const newContact = await createContact(tx, {
        email,
        phoneNumber,
        linkedId: null,
        linkPrecedence: "primary",
      });
      return formatResponse([newContact]);
    }

    // ── Step 4A: Collect all primary IDs referenced by matches ───────────────
    const primaryIdSet = new Set<number>();
    for (const c of directMatches) {
      if (c.linkPrecedence === "primary") {
        primaryIdSet.add(c.id);
      } else if (c.linkedId !== null) {
        primaryIdSet.add(c.linkedId);
      }
    }

    // ── Step 4B: Fetch full cluster ──────────────────────────────────────────
    const cluster = await fetchCluster(tx, [...primaryIdSet]);

    // ── Step 4C: Canonical primary = oldest createdAt among primaries ─────────
    const primariesInCluster = cluster
      .filter((c) => c.linkPrecedence === "primary")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const canonicalPrimary = primariesInCluster[0];

    // ── Step 4D: Demote extra primaries ──────────────────────────────────────
    for (const demoted of primariesInCluster.slice(1)) {
      // Re-parent their children first to keep linkedId flat
      await reparentSecondaries(tx, demoted.id, canonicalPrimary.id);
      await demoteToSecondary(tx, demoted.id, canonicalPrimary.id);
    }

    // ── Step 4E: Idempotency — exact input already exists? ───────────────────
    const exactMatch = await findExactMatch(tx, email, phoneNumber);
    if (exactMatch) {
      const finalCluster = await fetchFinalCluster(tx, canonicalPrimary.id);
      return formatResponse(finalCluster);
    }

    // ── Step 4F: New information → create secondary ──────────────────────────
    await createContact(tx, {
      email,
      phoneNumber,
      linkedId: canonicalPrimary.id,
      linkPrecedence: "secondary",
    });

    // ── Step 4G: Re-fetch final cluster ──────────────────────────────────────
    const finalCluster = await fetchFinalCluster(tx, canonicalPrimary.id);
    return formatResponse(finalCluster);
  });
}