import prisma from './src/db';

async function main() {
    const users = await prisma.user.findMany({
        include: {
            dialogues: {
                include: {
                    messages: true
                }
            }
        }
    });
    console.log(JSON.stringify(users, null, 2));
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
