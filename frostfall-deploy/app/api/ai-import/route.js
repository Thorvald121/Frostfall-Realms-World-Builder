import Anthropic from "@anthropic-ai/sdk";

export async function POST(req) {
    try {
        const { model, max_tokens, categoryList, text } = await req.json();

        if (!process.env.ANTHROPIC_API_KEY) {
            return Response.json(
                { error: "Missing ANTHROPIC_API_KEY in server env" },
                { status: 500 }
            );
        }

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        const prompt =
        `You are a worldbuilding data extractor. Analyze this lore document and extract structured entries for a fantasy worldbuilding codex.\n\n` +
        `Available categories:\n${categoryList}\n\n` +
        `For each distinct entity, concept, language, creature, law, location, character, event, item, or piece of lore you can identify, create a JSON entry.\n\n` +
        `Respond ONLY with a JSON array (no markdown, no backticks, no preamble). Each entry:\n` +
        `{\n  "title": "Name of entry",\n  "category": "category_key from list above",\n  "summary": "1-2 sentence summary",\n  "fields": { matching the category template fields },\n  "body": "Detailed description with @mentions using snake_case_ids for cross-references",\n  "tags": ["tag1", "tag2"],\n  "temporal": { "type": "mortal|immortal|event|race|concept|location|organization", "active_start": year_number_or_null, "active_end": year_number_or_null, "birth_year": if_applicable, "death_year": if_applicable }\n}\n\n` +
        `Document to parse:\n\n${String(text || "").slice(0, 12000)}`;

        const msg = await anthropic.messages.create({
            model: model || "claude-sonnet-4-20250514",
            max_tokens: max_tokens || 4000,
            messages: [{ role: "user", content: prompt }],
        });

        const raw = (msg.content || [])
        .map((b) => (typeof b.text === "string" ? b.text : ""))
        .join("");

        return Response.json({ raw });
    } catch (err) {
        return Response.json(
            { error: err?.message || "AI import failed" },
            { status: 500 }
        );
    }
}
