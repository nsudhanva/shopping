import { initializeApp } from "firebase-admin/app";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { SarvamAIClient } from "sarvamai";

initializeApp();

const sarvamApiKey = defineSecret("SARVAM_API_KEY");
const defaultAllowedOrigins = [
  "https://shopping.sudhanva.me",
  "https://sudhanva-shopping-app.web.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

type VoiceListContext = { id: string; name: string };
type VoiceItemContext = {
  id: string;
  text: string;
  checked: boolean;
  quantity: number;
  unit: string;
};

type VoiceContext = {
  currentListId: string | null;
  currentListName: string | null;
  lists: VoiceListContext[];
  items: VoiceItemContext[];
};

type VoiceIntent = {
  type: string;
  itemId?: string;
  listId?: string;
  itemText?: string;
  listName?: string;
  newText?: string;
  newName?: string;
  quantity?: number;
  unit?: string;
  direction?: "up" | "down";
  keepItems?: boolean;
  question?: string;
  options?: string[];
  pending?: Record<string, unknown>;
  items?: Array<{
    text: string;
    quantity?: number;
    unit?: string;
  }>;
};

type ParseVoiceRequest = {
  audioBase64: string;
  mimeType: string;
  context: VoiceContext;
  pendingClarification?: Record<string, unknown> | null;
  forceBulk?: boolean;
};

type ParseVoiceResponse = {
  transcript: string;
  intent: VoiceIntent;
  responseText: string;
};

type ParsedBulkItem = {
  text: string;
  quantity?: number;
  unit?: string;
};

function getClient(): SarvamAIClient {
  const key = sarvamApiKey.value();
  if (!key) {
    throw new HttpsError("failed-precondition", "Missing SARVAM_API_KEY secret");
  }
  return new SarvamAIClient({ apiSubscriptionKey: key });
}

function getConfiguredOrigins(): Set<string> {
  const raw = (process.env.VOICE_ALLOWED_ORIGINS ?? defaultAllowedOrigins.join(",")).trim();
  if (!raw) return new Set<string>();
  return new Set(
    raw
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );
}

function assertAllowedOrigin(origin: string | undefined) {
  // Requests without Origin are typically server-to-server; allow those.
  if (!origin) return;

  const allowed = getConfiguredOrigins();
  if (allowed.size === 0) {
    throw new HttpsError("failed-precondition", "VOICE_ALLOWED_ORIGINS is not configured.");
  }
  if (!allowed.has(origin)) {
    logger.warn("Rejected callable request from disallowed origin", { origin });
    throw new HttpsError("permission-denied", "Origin not allowed.");
  }
}

function coerceString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function coerceBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function coerceNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const direct = text.trim();
  try {
    const parsed = JSON.parse(direct);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }

  const fenced = direct.match(/```json\s*([\s\S]*?)```/i) ?? direct.match(/```\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
  }

  const start = direct.indexOf("{");
  const end = direct.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(direct.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
  }

  return null;
}

function normalizeIntent(raw: unknown): VoiceIntent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { type: "unknown" };
  }

  const data = raw as Record<string, unknown>;
  const type = coerceString(data.type) ?? "unknown";
  const directionRaw = coerceString(data.direction);
  const direction = directionRaw === "up" || directionRaw === "down" ? directionRaw : undefined;

  const options = Array.isArray(data.options)
    ? data.options.filter((option): option is string => typeof option === "string" && option.trim().length > 0)
    : undefined;

  const pending =
    data.pending && typeof data.pending === "object" && !Array.isArray(data.pending)
      ? (data.pending as Record<string, unknown>)
      : undefined;
  const items = Array.isArray(data.items)
    ? data.items
        .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
        .map((entry) => ({
          text: coerceString(entry.text) ?? "",
          quantity: coerceNumber(entry.quantity),
          unit: coerceString(entry.unit),
        }))
        .filter((entry) => entry.text.length > 0)
    : undefined;

  return {
    type,
    itemId: coerceString(data.itemId),
    listId: coerceString(data.listId),
    itemText: coerceString(data.itemText),
    listName: coerceString(data.listName),
    newText: coerceString(data.newText),
    newName: coerceString(data.newName),
    quantity: coerceNumber(data.quantity),
    unit: coerceString(data.unit),
    direction,
    keepItems: coerceBoolean(data.keepItems),
    question: coerceString(data.question),
    options,
    pending,
    items,
  };
}

function normalizeUnit(unit: string | undefined): string | undefined {
  if (!unit) return undefined;
  const cleaned = unit.trim().toLowerCase();
  if (!cleaned) return undefined;
  if (["kg", "kilo", "kilos", "kilogram", "kilograms"].includes(cleaned)) return "kg";
  if (["g", "gram", "grams"].includes(cleaned)) return "g";
  if (["l", "lt", "ltr", "liter", "litre", "liters", "litres"].includes(cleaned)) return "L";
  if (["ml", "milliliter", "millilitre", "milliliters", "millilitres"].includes(cleaned)) return "ml";
  return unit.trim();
}

function parseBulkItemsHeuristically(transcript: string): ParsedBulkItem[] {
  const chunks = transcript
    .split(/,| and | & | ಹಾಗೂ | ಮತ್ತು /gi)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  if (chunks.length < 2) return [];

  const parsed = chunks
    .map((chunk): ParsedBulkItem | null => {
      const fullMatch = chunk.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?\s+(.+)$/);
      if (fullMatch) {
        const quantity = Number.parseFloat(fullMatch[1]);
        const unit = normalizeUnit(fullMatch[2]);
        const text = fullMatch[3].trim();
        if (!text) return null;
        return { text, quantity, unit };
      }

      const trailingQuantity = chunk.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/);
      if (trailingQuantity) {
        const text = trailingQuantity[1].trim();
        const quantity = Number.parseFloat(trailingQuantity[2]);
        const unit = normalizeUnit(trailingQuantity[3]);
        if (!text) return null;
        return { text, quantity, unit };
      }

      return { text: chunk };
    })
    .filter((entry): entry is ParsedBulkItem => Boolean(entry?.text));

  return parsed.length >= 2 ? parsed : [];
}

function basePrompt(forceBulk: boolean) {
  return [
    "You convert shopping app voice commands into strict JSON.",
    "Return only one JSON object with keys: type, itemId, listId, itemText, listName, newText, newName, quantity, unit, direction, keepItems, question, options, pending, items.",
    "Allowed type values: add_item, add_items_bulk, edit_item_text, set_quantity, set_unit, check_item, uncheck_item, delete_item, move_item, check_all, uncheck_all, clear_checked, clear_all, create_list, select_list, rename_list, delete_list, move_list, read_items, clarify, unknown.",
    "Use listId/itemId from provided context whenever possible. Do not invent ids.",
    "If command is ambiguous between multiple items/lists, return type=clarify with an English question and options array.",
    "English only. Keep question concise.",
    "For delete_list, set keepItems boolean if user mentioned keeping/moving items.",
    "For move actions, direction must be up or down.",
    "If pendingClarification exists, resolve it with the new transcript and return a final non-clarify action whenever possible.",
    "When user gives multiple add entries (comma-separated, and-separated, or repeated quantities), return type=add_items_bulk and put all entries in items[].",
    "Each items[] entry should include text, and quantity/unit when detectable.",
    forceBulk
      ? "forceBulk is true. Prefer add_items_bulk whenever there are 2 or more addable entries; do not collapse multiple entries into one text."
      : "If exactly one item is requested, return add_item with itemText.",
  ].join(" ");
}

export const parseVoiceCommand = onCall(
  {
    region: "us-east1",
    timeoutSeconds: 60,
    memory: "512MiB",
    cors: true,
    secrets: [sarvamApiKey],
  },
  async (request): Promise<ParseVoiceResponse> => {
    assertAllowedOrigin(request.rawRequest.headers.origin);
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in is required for voice control.");
    }

    const data = request.data as ParseVoiceRequest | undefined;
    if (!data?.audioBase64 || !data?.mimeType || !data?.context) {
      throw new HttpsError("invalid-argument", "Missing audio or context.");
    }

    const audioBuffer = Buffer.from(data.audioBase64, "base64");
    if (audioBuffer.length === 0 || audioBuffer.length > 10 * 1024 * 1024) {
      throw new HttpsError("invalid-argument", "Audio payload must be between 1 byte and 10MB.");
    }

    const client = getClient();

    const stt = await client.speechToText.transcribe({
      file: audioBuffer,
      model: "saaras:v3",
      mode: "codemix",
      language_code: "unknown",
    });

    const transcript = (stt.transcript ?? "").trim();
    if (!transcript) {
      return {
        transcript: "",
        intent: { type: "unknown" },
        responseText: "I could not hear you clearly. Please hold and speak again.",
      };
    }

    const completion = await client.chat.completions({
      temperature: 0.05,
      max_tokens: 300,
      messages: [
        { role: "system", content: basePrompt(Boolean(data.forceBulk)) },
        {
          role: "user",
          content: JSON.stringify({
            transcript,
            forceBulk: Boolean(data.forceBulk),
            context: {
              currentListId: data.context.currentListId,
              currentListName: data.context.currentListName,
              lists: data.context.lists.slice(0, 100),
              items: data.context.items.slice(0, 200),
            },
            pendingClarification: data.pendingClarification ?? null,
          }),
        },
      ],
    });

    const content = completion.choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonObject(content);
    let intent = normalizeIntent(parsed);

    if (intent.type !== "add_items_bulk") {
      const heuristicItems = parseBulkItemsHeuristically(transcript);
      if (heuristicItems.length >= 2 && (Boolean(data.forceBulk) || intent.type === "add_item")) {
        intent = {
          type: "add_items_bulk",
          items: heuristicItems,
        };
      }
    }

    let responseText = "Done.";
    if (intent.type === "clarify") {
      responseText = intent.question ?? "I found multiple matches. Which one do you mean?";
    } else if (intent.type === "unknown") {
      responseText = "I could not understand that command. Please try again.";
    }

    return {
      transcript,
      intent,
      responseText,
    };
  },
);

export const speakText = onCall(
  {
    region: "us-east1",
    timeoutSeconds: 60,
    memory: "256MiB",
    cors: true,
    secrets: [sarvamApiKey],
  },
  async (request): Promise<{ audioBase64: string; mimeType: string }> => {
    assertAllowedOrigin(request.rawRequest.headers.origin);
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in is required for TTS.");
    }

    const text = coerceString((request.data as { text?: unknown } | undefined)?.text);
    if (!text) {
      throw new HttpsError("invalid-argument", "text is required");
    }

    const client = getClient();
    const tts = await client.textToSpeech.convert({
      text: text.slice(0, 500),
      target_language_code: "en-IN",
      model: "bulbul:v3",
      speaker: "anand",
      output_audio_codec: "mp3",
      pace: 1,
      temperature: 0.5,
    });

    const audioBase64 = tts.audios?.[0];
    if (!audioBase64) {
      logger.error("TTS response missing audio", { response: tts });
      throw new HttpsError("internal", "TTS response did not contain audio.");
    }

    return {
      audioBase64,
      mimeType: "audio/mpeg",
    };
  },
);
