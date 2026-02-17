import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Migrating ALL dialogues to SCOUT...');

    const result = await prisma.dialogue.updateMany({
        // We'll update everything that's currently INBOUND/DIRECT.
        // If they already scout, they stay scout.
        where: {
            source: 'INBOUND'
        },
        data: {
            source: 'SCOUT'
        }
    });

    console.log(`Migration complete. Updated ${result.count} dialogues to SCOUT.`);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
