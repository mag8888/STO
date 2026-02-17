import OpenAI from 'openai';
import { Dialogue, DialogueStage, User } from '@prisma/client';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export interface GPTResponse {
    reply: string;
    nextStage: DialogueStage;
    newFacts: any;
    extractedProfile?: Partial<User>; // New: Extracted profile data
}

// Profile fields we want to collect in order
const PROFILE_FIELDS = [
    { key: 'activity', question: 'Чем занимаетесь? (какая сфера)' },
    { key: 'city', question: 'Из какого вы города?' },
    { key: 'bestClients', question: 'Расскажите о трех ваших лучших клиентах, чтобы мы смогли подобрать вам оптимальных людей.' },
    { key: 'requests', question: 'С какими задачами к вам чаще всего приходят?' },
    { key: 'hobbies', question: 'Если есть желание, расскажите о хобби (возможно подберем события по интересам).' },
    { key: 'desiredIncome', question: 'К какому доходу хочешь прийти в ближайшие 3 месяца?' },
    { key: 'currentIncome', question: 'Сколько сейчас зарабатываете в среднем? (если не готовы отвечать - напишите "не готов").' },
];

export async function generateResponse(
    history: { sender: string, text: string }[],
    stage: DialogueStage,
    user: User, // Changed: Pass full user object to check profile status
    templates: Record<string, string>,
    kbItems: { question: string, answer: string }[] = [],
    instructions?: string,
    rules: string[] = []
): Promise<GPTResponse | null> {

    // 1. Determine what we already know and what's missing
    const missingField = PROFILE_FIELDS.find(f => !user[f.key as keyof User] || user[f.key as keyof User] === '');

    let systemPrompt = `You are a professional Networking Assistant. Your goal is to get to know the user to connect them with useful people.
You speak in a lively, friendly manner, like a real human. No formal "bot" language. Short messages (1-2 sentences).

CURRENT STAGE: ${stage}
USER PROFILE:
- Name: ${user.firstName || 'Unknown'}
- City: ${user.city || 'Unknown'}
- Activity: ${user.activity || 'Unknown'}
- Best Clients: ${user.bestClients || 'Unknown'}
- Requests: ${user.requests || 'Unknown'}
- Hobbies: ${user.hobbies || 'Unknown'}
- Current Income: ${user.currentIncome || 'Unknown'}
- Desired Income: ${user.desiredIncome || 'Unknown'}

GOAL: Complete the user profile naturally.
`;

    if (missingField) {
        systemPrompt += `
Current Goal: Find out "${missingField.key}".
Strategy:
1. "Mirror" the user's previous answer (briefly confirm/praise what they just said).
2. Then ask: "${missingField.question}" (You can rephrase it slightly to fit context, but keep the meaning).
3. If the user refuses to answer (e.g. "skip"), accept it and move to the next topic.
`;
    } else {
        systemPrompt += `
Current Goal: Profile is complete! Thank the user and tell them you will look for matches.
`;
    }

    systemPrompt += `
INSTRUCTIONS:
- NO buttons. NO menus. Text only.
- Mirroring Example: "Got it, you help entrepreneurs scale. Cool. And what city are you in?"
- If the user asks a question, answer it using the KB below or common sense.
- ALWAYS extract any new profile data from the user's last message into the JSON output.

RELEVANT KNOWLEDGE BASE:
${kbItems.map(i => `Q: ${i.question}\nA: ${i.answer}`).join('\n')}

PERMANENT RULES:
${rules.join('\n')}

${instructions ? `\nCUSTOM INSTRUCTIONS:\n${instructions}` : ''}

OUTPUT FORMAT (JSON):
{
  "reply": "Your extracted reply",
  "extractedProfile": {
      "city": "Paris",
      "activity": "Marketing",
      ... (only fields found in the LAST message)
  },
  "nextStage": "${stage}",
  "newFacts": { ... }
}
`;

    try {
        const messages: any[] = [
            { role: 'system', content: systemPrompt },
            ...history.map(m => ({
                role: m.sender === 'USER' ? 'user' : 'assistant',
                content: m.text
            }))
        ];

        console.log(`[GPT] Sending request...`);
        const completion = await openai.chat.completions.create({
            messages: messages,
            model: 'gpt-4o',
            temperature: 0.7,
            response_format: { type: 'json_object' }
        });

        const content = completion.choices[0].message.content;
        if (!content) return null;

        const jsonStr = content.replace(/```json\n?|```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (e: any) {
        console.error('[GPT] Error:', e);
        return null;
    }
}
