import OpenAI from 'openai';
import { Dialogue, DialogueStage, User } from '@prisma/client';

// Remove top-level initialization
// const openai = new OpenAI({ ... });

export interface GPTResponse {
    reply: string;
    nextStage: DialogueStage;
    newFacts: any;
    extractedProfile?: Partial<User>; // New: Extracted profile data
}

// Profile fields we want to collect in order
const PROFILE_FIELDS = [
    { key: 'businessCard', question: 'Возможно, у вас есть ваше описание в формате визитки? (так мы лучше подберем собеседников)' },
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

    // 1. Determine State
    // Only START profiling if we are in QUALIFICATION stage
    let missingField: any = null;
    if (stage === 'QUALIFICATION') {
        missingField = PROFILE_FIELDS.find(f => !user[f.key as keyof User] || user[f.key as keyof User] === '');
    }

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

GOAL BY STAGE:
1. DISCOVERY / OFFER: 
   - Briefly explain value: "We do online networking and can connect you with the right people daily."
   - Ask what their current requests/goals are to gauge interest.
   - IF they say they are interested / "Yes" / "What next?", CHANGE stage to "QUALIFICATION".

2. QUALIFICATION (Profiling):
   - We need to fill the missing profile fields.
   - CURRENT MISSING FIELD: ${missingField ? `"${missingField.key}"` : "NONE (Profile Complete)"}
`;

    if (stage === 'QUALIFICATION' && missingField) {
        systemPrompt += `
STRATEGY for QUALIFICATION:
1. "Mirror" the user's previous answer (briefly confirm/praise).
2. Ask: "${missingField.question}" (Adapt naturally).
3. If they accept networking, START by asking for the Business Card (if missing).
`;
    } else if (stage === 'QUALIFICATION' && !missingField) {
        systemPrompt += `
STRATEGY: Profile is complete! Thank user and tell them you are looking for matches.
`;
    }

    systemPrompt += `
INSTRUCTIONS:
- NO buttons. NO menus. Text only.
- Mirroring Example: "Got it, you help entrepreneurs scale. Cool. And what city are you in?"
- If the user asks a question, answer it using the KB below or common sense.
- ALWAYS extract any new profile data from the user's last message into the JSON output.
- **IMPORTANT**: If the user provides a "Business Card" or long bio, try to EXTRACT as many fields as possible (City, Activity, Income, etc.) from it immediately.

CRITICAL RULES:
- **CHECK HISTORY**: Read the conversation history carefully.
- **NO REPETITION**: Do NOT repeat questions you have already asked in the history.
- **CONTEXT**: Build upon the user's last answer.

RELEVANT KNOWLEDGE BASE:
${kbItems.map(i => `Q: ${i.question}\nA: ${i.answer}`).join('\n')}

PERMANENT RULES:
${rules.join('\n')}

${instructions ? `\nCUSTOM INSTRUCTIONS (HIGHEST PRIORITY):\n${instructions}` : ''}

OUTPUT FORMAT(JSON):
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
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.error('[GPT] OPENAI_API_KEY is missing in environment variables!');
            return null;
        }

        const openai = new OpenAI({ apiKey });

        const messages: any[] = [
            { role: 'system', content: systemPrompt },
            ...history.map(m => ({
                role: m.sender === 'USER' ? 'user' : 'assistant',
                content: m.text
            }))
        ];

        console.log(`[GPT] Sending request to OpenAI (Model: gpt-4o)...`);
        // console.log(`[GPT] System Prompt:`, systemPrompt); // Too verbose?
        const completion = await openai.chat.completions.create({
            messages: messages as any,
            model: 'gpt-4o',
            temperature: 0.7,
            response_format: { type: 'json_object' }
        });

        const content = completion.choices[0].message.content;
        console.log(`[GPT] Received response:`, content?.substring(0, 100) + '...');

        if (!content) {
            console.error('[GPT] Response content is empty!');
            return null;
        }

        const jsonStr = content.replace(/```json\n ?| ```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (e: any) {
        console.error('[GPT] Error generating response:', e);
        return null;
    }
}
// ... (Existing generateResponse)

export async function analyzeText(
    text: string,
    userContext: string,
    kbContext: string = '',
    examples: { positive: string[], negative: string[] } = { positive: [], negative: [] }
): Promise<{ profile: any, draft: string } | null> {
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return null;

        const openai = new OpenAI({ apiKey });

        const examplesPrompt = `
        USER PREFERENCES (LEARNING EXAMPLES):
        
        👍 RELEVANT (User LIKES these):
        ${examples.positive.map(e => `- "${e.substring(0, 100)}..."`).join('\n')}
        
        👎 IRRELEVANT (User DISLIKES these, DO NOT engage):
        ${examples.negative.map(e => `- "${e.substring(0, 100)}..."`).join('\n')}
        `;

        const systemPrompt = `
        You are an expert Networker and CRM Analyst.
        Your goal is to analyze a message from a Telegram chat and draft a high-quality, human-like reply.

        CONTEXT:
        ${userContext}

        KNOWLEDGE BASE (Use this to answer questions or describe services):
        ${kbContext}
        
        ${examples.positive.length > 0 || examples.negative.length > 0 ? examplesPrompt : ''}

        TASK:
        1. **Detect Language**: Determine if the user's message is in Russian or English. **You MUST reply in the SAME language.**
        2. **Analyze Intent**:
           - Is the user asking for help ("Need", "Looking for")? -> Offer help using KB.
           - Is the user offering something ("I am a dev")? -> Ask relevant qualifying questions.
           - **FILTERING**: If the message looks like the "IRRELEVANT" examples above (e.g. spam, crypto, irrelevant ads), return a generic "Dismiss" signal or just empty draft/profile.
           - **PRIORITY**: If the message matches "RELEVANT" patterns, prioritize a good draft.

        TASK:
        1. **Detect Language**: Determine if the user's message is in Russian or English. **You MUST reply in the SAME language.**
        2. **Analyze Intent**:
           - Is the user asking for help ("Need", "Looking for")? -> Offer help using KB.
           - Is the user offering something ("I am a dev")? -> Ask relevant qualifying questions.
        3. **Draft a Message**:
           - **NO "Let's connect"**. No spammy intros.
           - Be casual, specific, and brief (1-2 sentences).
           - Refer to specific details using the user's text (e.g., "Saw you're looking for a designer...").
           - If KB has a relevant answer/offer, use it naturally.

        OUTPUT JSON:
        {
          "profile": { 
              "city": "...", 
              "activity": "...", 
              "requests": "...", 
              "businessCard": "..." 
          },
          "draft": "Your drafted message here..."
        }
        `;

        const completion = await openai.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: text }
            ],
            model: 'gpt-4o',
            temperature: 0.7,
            response_format: { type: 'json_object' }
        });

        const content = completion.choices[0].message.content;
        if (!content) return null;

        const jsonStr = content.replace(/```json\n ?| ```/g, '').trim();
        return JSON.parse(jsonStr);

    } catch (e) {
        console.error('[GPT] Analysis failed:', e);
        return null; // Fallback to null (or we could return a safe default)
    }
}
