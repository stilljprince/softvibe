// lib/creative-intelligence/writer/provider.ts
//
// Text-generation provider abstraction for the Narrative Writer Layer
// (RP-011C.8.5). writer.ts depends only on the CreativeTextProvider
// interface below -- it never imports OpenAI, ElevenLabs, or any other
// provider SDK directly, so the underlying generation backend can be
// swapped without touching writer.ts or its callers.
//
// createOpenAICreativeTextProvider() is a minimal, isolated implementation
// for this pass. It is intentionally separate from the module-level client
// the active production script builder uses: this one lazily constructs
// its own client inside generateText() (per this project's CLAUDE.md --
// "OpenAI must be lazily initialized inside request handlers"), and makes
// no other calls (no API route usage, no job integration, no database
// usage, no audio usage).

export type CreativeTextProviderInput = {
  systemPrompt: string;
  userPrompt: string;
};

// Any text-generation backend the Writer Layer can call. Implementations
// decide how to turn a system/user prompt pair into generated text; the
// Writer Layer only calls generateText() and never inspects how it works.
export interface CreativeTextProvider {
  generateText(input: CreativeTextProviderInput): Promise<string>;
}

export type OpenAICreativeTextProviderOptions = {
  // Defaults to OPENAI_CREATIVE_INTELLIGENCE_MODEL, falling back to the
  // same default model used elsewhere in this project's OpenAI calls.
  model?: string;
};

export function createOpenAICreativeTextProvider(
  options: OpenAICreativeTextProviderOptions = {}
): CreativeTextProvider {
  return {
    async generateText(input: CreativeTextProviderInput): Promise<string> {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("createOpenAICreativeTextProvider: OPENAI_API_KEY is not configured");
      }

      // Lazily constructed per call, not at module scope.
      const OpenAI = (await import("openai")).default;
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const model = options.model ?? process.env.OPENAI_CREATIVE_INTELLIGENCE_MODEL ?? "gpt-5.4";

      const response = await client.responses.create({
        model,
        input: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt },
        ],
      });

      const text = (response.output_text ?? "").trim();
      if (!text) {
        throw new Error("createOpenAICreativeTextProvider: provider returned empty text");
      }
      return text;
    },
  };
}
