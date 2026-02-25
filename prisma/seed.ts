import { PrismaClient, LinkPrecedence } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Clean slate
  await prisma.contact.deleteMany();

  // Reset sequence (PostgreSQL)
  await prisma.$executeRawUnsafe(
    `ALTER SEQUENCE "Contact_id_seq" RESTART WITH 1`
  );

  // Scenario 1: Primary with email + phone, plus one secondary linked to it
  const primary1 = await prisma.contact.create({
    data: {
      email: "lorraine@hillvalley.edu",
      phoneNumber: "123456",
      linkedId: null,
      linkPrecedence: LinkPrecedence.primary,
      createdAt: new Date("2023-04-01T00:00:00.374Z"),
    },
  });

  await prisma.contact.create({
    data: {
      email: "mcfly@hillvalley.edu",
      phoneNumber: "123456",
      linkedId: primary1.id,
      linkPrecedence: LinkPrecedence.secondary,
      createdAt: new Date("2023-04-20T05:30:00.110Z"),
    },
  });

  // Scenario 2: Two independent primaries (for merge testing)
  await prisma.contact.create({
    data: {
      email: "george@hillvalley.edu",
      phoneNumber: "919191",
      linkedId: null,
      linkPrecedence: LinkPrecedence.primary,
      createdAt: new Date("2023-04-11T00:00:00.374Z"),
    },
  });

  await prisma.contact.create({
    data: {
      email: "biffsucks@hillvalley.edu",
      phoneNumber: "717171",
      linkedId: null,
      linkPrecedence: LinkPrecedence.primary,
      createdAt: new Date("2023-04-21T05:30:00.110Z"),
    },
  });

  console.log("✅ Seed complete:");
  console.log("  - Contact 1 (primary): lorraine@hillvalley.edu / 123456");
  console.log("  - Contact 2 (secondary → 1): mcfly@hillvalley.edu / 123456");
  console.log("  - Contact 3 (primary): george@hillvalley.edu / 919191");
  console.log("  - Contact 4 (primary): biffsucks@hillvalley.edu / 717171");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
