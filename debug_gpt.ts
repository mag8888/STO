import { PrismaClient } from '@prisma/client';
import { generateResponse } from './src/gpt';

const prisma = new PrismaClient();

async function main() {
    const username = 'roman_arctur';
    console.log(`Searching for user @${username}...`);

    const user = await prisma.user.findFirst({
        where: {
            OR: [
                { username: username },
                { telegramId: username }
            ]
        }
    });

    if (!user) {
        console.log('User not found!');
        return;
    }
    console.log('User found:', { id: user.id, firstName: user.firstName, stage: user.status });

    const dialogue = await prisma.dialogue.findFirst({
        where: { userId: user.id, status: 'ACTIVE' },
        include: { messages: { orderBy: { id: 'desc' }, take: 5 } }
    });

    if (!dialogue) {
        console.log('No active dialogue found.');
        return;
    }

    console.log('Dialogue Stage:', dialogue.stage);

    const history = dialogue.messages.slice().reverse().map(m => ({
        sender: m.sender,
        text: m.text
    }));

    console.log('History:', history);

    console.log('Generating response...');
    try {
        const result = await generateResponse(
            history,
            dialogue.stage,
            user,
            {},
            [],
            undefined,
            []
        );
        console.log('GPT Result:', JSON.stringify(result, null, 2));
    } catch (e) {
        console.error('Error generating response:', e);
    }
}

main().finally(() => prisma.$disconnect());
