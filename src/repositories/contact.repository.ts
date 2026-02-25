import { Prisma } from "@prisma/client";

// ── Types ─────────────────────────────────────────────────────────────────────
// Defined locally so the file compiles before `prisma generate` has been run.
// Exported so the service can import them — single source of truth.

export type LinkPrecedence = "primary" | "secondary";

export interface Contact {
  id: number;
  email: string | null;
  phoneNumber: string | null;
  linkedId: number | null;
  linkPrecedence: LinkPrecedence;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// TxClient is Prisma's transaction client — passed in from prisma.$transaction()
export type TxClient = Prisma.TransactionClient;

export interface ContactCreateInput {
  email?: string | null;
  phoneNumber?: string | null;
  linkedId?: number | null;
  linkPrecedence: LinkPrecedence;
}

// Plain where-clause type — avoids dependency on generated Prisma.ContactWhereInput
type WhereClause = Record<string, unknown>;

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Find contacts matching either the provided email or phoneNumber.
 * Only non-null fields are included in the OR conditions.
 */
export async function findDirectMatches(
  tx: TxClient,
  email: string | null | undefined,
  phoneNumber: string | null | undefined
): Promise<Contact[]> {
  const conditions: WhereClause[] = [];
  if (email) conditions.push({ email });
  if (phoneNumber) conditions.push({ phoneNumber });
  if (conditions.length === 0) return [];

  return tx.contact.findMany({
    where: { OR: conditions, deletedAt: null },
    orderBy: { createdAt: "asc" },
  }) as Promise<Contact[]>;
}

/**
 * Fetch the full cluster: all contacts whose id or linkedId is in primaryIds.
 */
export async function fetchCluster(
  tx: TxClient,
  primaryIds: number[]
): Promise<Contact[]> {
  return tx.contact.findMany({
    where: {
      OR: [
        { id: { in: primaryIds } },
        { linkedId: { in: primaryIds } },
      ],
      deletedAt: null,
    },
    orderBy: { createdAt: "asc" },
  }) as Promise<Contact[]>;
}

/**
 * Re-fetch the final cluster by canonical primary id.
 */
export async function fetchFinalCluster(
  tx: TxClient,
  canonicalPrimaryId: number
): Promise<Contact[]> {
  return tx.contact.findMany({
    where: {
      OR: [{ id: canonicalPrimaryId }, { linkedId: canonicalPrimaryId }],
      deletedAt: null,
    },
    orderBy: { createdAt: "asc" },
  }) as Promise<Contact[]>;
}

/**
 * Demote a contact to secondary, pointing its linkedId at the canonical primary.
 */
export async function demoteToSecondary(
  tx: TxClient,
  demotedId: number,
  canonicalPrimaryId: number
): Promise<void> {
  await tx.contact.update({
    where: { id: demotedId },
    data: {
      linkPrecedence: "secondary",
      linkedId: canonicalPrimaryId,
    },
  });
}

/**
 * Re-parent all secondaries of a demoted primary to the canonical primary.
 * Must be called BEFORE demoteToSecondary to keep linkedId chains flat.
 */
export async function reparentSecondaries(
  tx: TxClient,
  demotedId: number,
  canonicalPrimaryId: number
): Promise<void> {
  await tx.contact.updateMany({
    where: { linkedId: demotedId, deletedAt: null },
    data: { linkedId: canonicalPrimaryId },
  });
}

/**
 * Create a new contact row.
 */
export async function createContact(
  tx: TxClient,
  data: ContactCreateInput
): Promise<Contact> {
  return tx.contact.create({
    data: {
      email: data.email ?? null,
      phoneNumber: data.phoneNumber ?? null,
      linkedId: data.linkedId ?? null,
      linkPrecedence: data.linkPrecedence,
    },
  }) as Promise<Contact>;
}

/**
 * Idempotency check — find an existing contact matching the exact input.
 * - Both provided → match on both email AND phoneNumber
 * - Only email    → match on email only
 * - Only phone    → match on phoneNumber only
 */
export async function findExactMatch(
  tx: TxClient,
  email: string | null | undefined,
  phoneNumber: string | null | undefined
): Promise<Contact | null> {
  const where: WhereClause = { deletedAt: null };

  if (email && phoneNumber) {
    where.email = email;
    where.phoneNumber = phoneNumber;
  } else if (email) {
    where.email = email;
  } else if (phoneNumber) {
    where.phoneNumber = phoneNumber;
  } else {
    return null;
  }

  return tx.contact.findFirst({ where }) as Promise<Contact | null>;
}