import OpenAI from 'openai';
import { DialogueStage } from '@prisma/client';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export interface UserFacts {
    [key: string]: any;
}

// Simple interface for Knowledge Items for context
interface KBItem {
    question: string;
    answer: string;
}

// Interface for what we expect from GPT
export interface GPTResponse {
    reply: string;
    nextStage: DialogueStage;
    newFacts: any;
}


export async function generateResponse(
    history: { sender: string, text: string }[],
    stage: DialogueStage,
    facts: UserFacts | any, // Support JSON type
    templates: Record<string, string>,
    kbItems: KBItem[] = [], // New: Pass relevant KB items
    instructions?: string,   // New: Custom User Instructions
    rules: string[] = []     // New: Persistent Rules
): Promise<{ reply: string, nextStage: DialogueStage, newFacts: any } | null> {

    // Construct System Prompt
    let systemPrompt = `You are a helpful assistant engaging in a dialogue with a user.
Your goal is to move the conversation forward based on the current stage: ${stage}.
GOAL: Qualify the user. Continue the dialogue until the user explicitly says they are INTERESTED or NOT INTERESTED.
- If INTERESTED: Offer to connect them with an operator.
- If NOT INTERESTED: politely close the conversation.

Current Facts about User: ${JSON.stringify(facts)}

Available Templates (use if appropriate):
${JSON.stringify(templates, null, 2)}
`;

    if (kbItems.length > 0) {
        systemPrompt += `\nRELEVANT KNOWLEDGE BASE (Use these to answer if applicable):\n`;
        kbItems.forEach((item, i) => {
            systemPrompt += `${i + 1}. Q: ${item.question}\n   A: ${item.answer}\n`;
        });
        systemPrompt += `\nIf the user's question matches a KB item, paraphrase the answer naturally.\n`;
    }

    if (instructions) {
        systemPrompt += `
\n*** IMPORTANT USER INSTRUCTIONS ***
${instructions}
*** END INSTRUCTIONS ***\n`;
    }

    if (rules && rules.length > 0) {
        systemPrompt += `
\n*** PERMANENT RULES (ALWAYS FOLLOW) ***
${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}
*** END RULES ***\n`;
    }

    systemPrompt += `
STAGES & GOALS:
1. DISCOVERY: Find out what the user does (Occupation) and if they need leads/clients.
2. OFFER: Explain that we provide leads/clients for their business.
3. QUALIFICATION: Ask if they are interested in testing the service.
4. CLOSED: The conversation is over.

INSTRUCTIONS:
- Keep replies short and conversational.
- Don't be pushy.
- If you don't know the answer, ask a clarifying question or suggest waiting for an operator.

INSTRUCTIONS:
- Analyze the user's last message.
- If they answered a question, extract facts (e.g. "I am a designer" -> occupation: "Designer").
- Decide the next stage (e.g. if occupation found -> OFFER).
- Generate a reply. If you use a template, strictly follow it but make it sound natural.
- If the user asks a question found in the KB, answer it.
- If you don't know, ask clarifying questions.
- **IMPORTANT**: ALWAYS reply in the same language as the user's last message. If they speak Russian, reply in Russian. If English, reply in English.

Return a JSON object with this format (no markdown):
{
  "reply": "Your response text",
  "nextStage": "The new stage",
  "newFacts": { "key": "value" }
}`;

    try {
        const messages: any[] = [
            { role: 'system', content: systemPrompt },
            ...history.map(m => ({
                role: m.sender === 'USER' ? 'user' : 'assistant',
                content: m.text
            }))
        ];

        console.log(`[GPT] Sending request to OpenAI with ${messages.length} messages...`);
        const completion = await openai.chat.completions.create({
            messages: messages,
            model: 'gpt-4o', // or gpt-3.5-turbo if 4o fails
            temperature: 0.7,
            response_format: { type: 'json_object' }
        });

        const content = completion.choices[0].message.content;
        console.log(`[GPT] Received response: ${content?.substring(0, 50)}...`);

        if (!content) return null;

        // Clean up markdown code blocks if present
        const jsonStr = content.replace(/```json\n?|```/g, '').trim();

        return JSON.parse(jsonStr);
    } catch (e: any) {
        console.error('[GPT] Error generating response:', e.message || e);
        return null; // Return null to avoid crashing listener
    }
}
