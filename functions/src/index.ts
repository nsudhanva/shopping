import { initializeApp } from "firebase-admin/app";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { SarvamAIClient } from "sarvamai";

initializeApp();

const sarvamApiKey = defineSecret("SARVAM_API_KEY");
// bulbul:v3 accepts a maximum of 2500 characters in each request.
const maxTtsChars = 2500;
const defaultAllowedOrigins = [
  "https://shopping.sudhanva.me",
  "https://sudhanva-shopping-app.web.app",
  "https://sudhanva-shopping-app.firebaseapp.com",
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
  // Requests without an Origin header are usually server-to-server. Allow them.
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
          text: stripAmount(coerceString(entry.text) ?? coerceString(entry.itemText), coerceNumber(entry.quantity)) ?? "",
          quantity: coerceNumber(entry.quantity),
          unit: normalizeUnit(coerceString(entry.unit)),
        }))
        .filter((entry) => entry.text.length > 0)
    : undefined;

  return {
    type,
    itemId: coerceString(data.itemId),
    listId: coerceString(data.listId),
    itemText: stripAmount(coerceString(data.itemText), coerceNumber(data.quantity)),
    listName: coerceString(data.listName),
    newText: coerceString(data.newText),
    newName: coerceString(data.newName),
    quantity: coerceNumber(data.quantity),
    unit: normalizeUnit(coerceString(data.unit)),
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

const numberWords: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  dozen: 12,
};
const leadingAmount =
  /^(\d+(?:\.\d+)?|[a-z]+)\s*(?:kilos?|kilograms?|kgs?|grams?|g|litres?|liters?|ltrs?|l|ml|millilit(?:er|re)s?|packets?|packs?|bottles?|cans?|box(?:es)?|bunch(?:es)?|loa(?:f|ves)|pieces?|pcs|dozen)?\s+(?:of\s+)?(.+)$/i;

// The model sometimes keeps the amount in the item name ("two kilos of rice" with quantity 2 and unit kg).
// Remove the amount only if its number is the parsed quantity, so a name such as "7 Up" stays the same.
function stripAmount(text: string | undefined, quantity: number | undefined): string | undefined {
  if (!text || quantity === undefined) return text;
  const match = text.trim().match(leadingAmount);
  if (!match) return text;
  const word = match[1].toLowerCase();
  const amount = numberWords[word] ?? Number.parseFloat(word);
  return amount === quantity ? match[2].trim() : text;
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

const itemTargetingIntents = new Set([
  "edit_item_text",
  "set_quantity",
  "set_unit",
  "check_item",
  "uncheck_item",
  "delete_item",
  "move_item",
]);

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3);
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[b.length];
}

function wordsMatch(a: string, b: string): boolean {
  // A prefix match covers plurals (egg/eggs, tomato/tomatoes). Edit distance covers small recognition errors.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.startsWith(short) && long.length - short.length <= 3) return true;
  return editDistance(a, b) <= Math.floor(Math.max(a.length, b.length) / 4);
}

// The code cannot compare speech in a different script (for example, Kannada) word by word, so it trusts the model.
function isOtherScript(transcript: string): boolean {
  return /[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u.test(transcript);
}

function transcriptMentions(transcript: string, itemText: string): boolean {
  if (isOtherScript(transcript)) return true;
  const itemWords = significantWords(itemText);
  if (itemWords.length === 0) return true;
  const spoken = significantWords(transcript);
  return itemWords.some((itemWord) => spoken.some((word) => wordsMatch(itemWord, word)));
}

function itemsMentioned(transcript: string, context: VoiceContext): VoiceItemContext[] {
  return context.items.filter((entry) => transcriptMentions(transcript, entry.text));
}

// When the user answers "which item?" with an item name, apply the original action to that item without the model.
// "The bread" names an item. "Check off the milk" is a new command.
const commandVerb =
  /\b(add|buy|put|delete|remove|check|tick|cross|uncheck|untick|mark|set|change|edit|rename|move|clear|create|make|select|open|switch|read)\b/i;

function resolveItemClarification(
  pending: Record<string, unknown> | null | undefined,
  transcript: string,
  context: VoiceContext,
): VoiceIntent | null {
  const original = normalizeIntent(pending?.originalIntent);
  if (!itemTargetingIntents.has(original.type)) return null;
  // Send a reply that contains a command to the model. The model also gets the pending question.
  if (commandVerb.test(transcript)) return null;
  const mentioned = itemsMentioned(transcript, context);
  return mentioned.length === 1 ? { ...original, itemId: mentioned[0].id } : null;
}

// The model sometimes maps an item that is not on the list to a different item ("delete the apples" ->
// Bread). Change the intent to the item that the user named, or ask. Do not act on the wrong item.
function guardItemIntent(intent: VoiceIntent, transcript: string, context: VoiceContext): VoiceIntent {
  if (!itemTargetingIntents.has(intent.type) || !intent.itemId) return intent;
  const item = context.items.find((entry) => entry.id === intent.itemId);
  if (item && transcriptMentions(transcript, item.text)) return intent;
  // If the transcript names exactly one item, use that item.
  const mentioned = itemsMentioned(transcript, context);
  if (mentioned.length === 1) return { ...intent, itemId: mentioned[0].id };
  logger.info("Voice intent item not mentioned in transcript", { transcript, type: intent.type, item: item?.text });
  return askWhichItem({ ...intent, itemId: undefined }, transcript, context);
}

// Asks which item `intent` is for. resolveItemClarification resolves the answer.
function askWhichItem(intent: VoiceIntent, transcript: string, context: VoiceContext): VoiceIntent {
  const question = "I couldn't find that item on this list. Which item did you mean?";
  const options = context.items.slice(0, 5).map((entry) => entry.text);
  return {
    type: "clarify",
    question,
    options,
    pending: { originalTranscript: transcript, originalIntent: intent, question, options },
  };
}

// Bulk actions change all items (or the full list), so the user must ask for them clearly. If not, a
// transcript that lost the item name ("check off the ...") could check all items.
const bulkIntentWords: Record<string, RegExp> = {
  check_all: /\b(all|every|everything|whole)\b/i,
  uncheck_all: /\b(all|every|everything|whole)\b/i,
  clear_all: /\b(all|every|everything|whole|empty)\b/i,
  clear_checked: /\b(checked|ticked|done|completed|bought|crossed)\b/i,
  delete_list: /\blist\b/i,
};

// The single-item action to ask about when the user did not clearly ask for a bulk action.
const singleItemIntent: Record<string, string> = {
  check_all: "check_item",
  uncheck_all: "uncheck_item",
  clear_all: "delete_item",
  clear_checked: "delete_item",
};

function guardBulkIntent(intent: VoiceIntent, transcript: string, context: VoiceContext): VoiceIntent {
  const required = bulkIntentWords[intent.type];
  if (!required || isOtherScript(transcript) || required.test(transcript)) return intent;
  logger.info("Bulk voice intent not explicitly requested", { transcript, type: intent.type });
  const single = singleItemIntent[intent.type];
  return single ? askWhichItem({ type: single }, transcript, context) : { type: "unknown" };
}

function basePrompt(forceBulk: boolean) {
  return [
    "You convert shopping app voice commands into strict JSON.",
    "Return only one JSON object with keys: type, itemId, listId, itemText, listName, newText, newName, quantity, unit, direction, keepItems, question, options, pending, items.",
    "Allowed type values: add_item, add_items_bulk, edit_item_text, set_quantity, set_unit, check_item, uncheck_item, delete_item, move_item, check_all, uncheck_all, clear_checked, clear_all, create_list, select_list, rename_list, delete_list, move_list, read_items, clarify, unknown.",
    "Use listId/itemId from provided context whenever possible. Do not invent ids.",
    "Only pick an itemId when the transcript names that item (allowing for small mishearings or translations, e.g. ಹಾಲು = milk). Never map an item to an unrelated one (e.g. 'bananas' is not 'Bread'); if no item matches, return type=clarify with a question saying it is not on the list and the closest items as options.",
    "If command is ambiguous between multiple items/lists, return type=clarify with an English question and options array.",
    "English only. Keep question concise.",
    "For delete_list, set keepItems boolean if user mentioned keeping/moving items.",
    "For move actions, direction must be up or down.",
    "Checking an item means marking it as bought: check, check off, tick, tick off, cross off, got, mark done all mean check_item (or check_all).",
    "uncheck_item / uncheck_all are only for explicit reversal: uncheck, untick, unmark, mark as not done, still need.",
    "If pendingClarification exists, the new transcript answers its question: resolve it and return a final non-clarify action whenever possible. If pendingClarification.originalIntent is present, return that same type with the item the user just named.",
    "When user gives multiple add entries (comma-separated, and-separated, or repeated quantities), return type=add_items_bulk and put all entries in items[].",
    "Each items[] entry should include text, and quantity/unit when detectable.",
    forceBulk
      ? "forceBulk is true. Prefer add_items_bulk whenever there are 2 or more addable entries; do not collapse multiple entries into one text."
      : "If exactly one item is requested, return add_item with itemText.",
  ].join(" ");
}

// These limits are the same as the client and the Firestore rules. The function truncates larger values.
const maxContextLists = 100;
const maxContextItems = 200;
const maxPendingChars = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function sanitizeContext(value: unknown): VoiceContext | null {
  if (!isRecord(value) || !Array.isArray(value.lists) || !Array.isArray(value.items)) return null;
  return {
    currentListId: typeof value.currentListId === "string" ? value.currentListId.slice(0, 128) : null,
    currentListName: typeof value.currentListName === "string" ? value.currentListName.slice(0, 60) : null,
    lists: value.lists
      .slice(0, maxContextLists)
      .filter(isRecord)
      .map((list) => ({ id: boundedString(list.id, 128), name: boundedString(list.name, 60) })),
    items: value.items
      .slice(0, maxContextItems)
      .filter(isRecord)
      .map((item) => ({
        id: boundedString(item.id, 128),
        text: boundedString(item.text, 120),
        checked: item.checked === true,
        quantity: typeof item.quantity === "number" && Number.isFinite(item.quantity) ? item.quantity : 1,
        unit: boundedString(item.unit, 16),
      })),
  };
}

// The pending clarification goes through the client. Discard it if it is too large, because a client changed it.
function sanitizePending(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return JSON.stringify(value).length <= maxPendingChars ? value : null;
}

// The formats that MediaRecorder makes: WebM or Ogg Opus (Chrome, Firefox) and MP4/AAC (Safari).
const audioExtensions: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

function parseAudioType(mimeType: string): { mime: string; extension: string } | null {
  const mime = mimeType.split(";")[0].trim().toLowerCase();
  const extension = audioExtensions[mime];
  return extension ? { mime, extension } : null;
}

const sarvamCallOptions = {
  region: "us-east1",
  timeoutSeconds: 60,
  cors: true,
  // Each call uses Sarvam credits. Limit how far a traffic burst can scale.
  maxInstances: 5,
  secrets: [sarvamApiKey],
};

export const parseVoiceCommand = onCall(
  {
    ...sarvamCallOptions,
    memory: "512MiB",
  },
  async (request): Promise<ParseVoiceResponse> => {
    assertAllowedOrigin(request.rawRequest.headers.origin);
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in is required for voice control.");
    }

    // The client supplies all values below. Validate and limit them before any paid API call.
    const data = request.data as Partial<Record<keyof ParseVoiceRequest, unknown>> | undefined;
    const context = sanitizeContext(data?.context);
    if (typeof data?.audioBase64 !== "string" || !data.audioBase64 || !context) {
      throw new HttpsError("invalid-argument", "Missing audio or context.");
    }
    const pendingClarification = sanitizePending(data.pendingClarification);
    const forceBulk = data.forceBulk === true;

    const audioType = typeof data.mimeType === "string" ? parseAudioType(data.mimeType) : null;
    if (!audioType) {
      throw new HttpsError("invalid-argument", "Unsupported audio format.");
    }

    const audioBuffer = Buffer.from(data.audioBase64, "base64");
    if (audioBuffer.length === 0 || audioBuffer.length > 10 * 1024 * 1024) {
      throw new HttpsError("invalid-argument", "Audio payload must be between 1 byte and 10MB.");
    }

    const client = getClient();

    const unheard: ParseVoiceResponse = {
      transcript: "",
      intent: { type: "unknown" },
      responseText: "I could not hear you clearly. Please try again.",
    };

    let transcript: string;
    try {
      const stt = await client.speechToText.transcribe({
        // Give a name and a type, so Sarvam does not have to find the format from the bytes.
        file: { data: audioBuffer, filename: `command.${audioType.extension}`, contentType: audioType.mime },
        model: "saaras:v4",
        mode: "codemix",
        language_code: "unknown",
      });
      transcript = (stt.transcript ?? "").trim();
    } catch (error) {
      // Sarvam returns 400 "Failed to read the file" for very short or silent recordings.
      if ((error as { statusCode?: number }).statusCode === 400) {
        logger.warn("Speech-to-text rejected the audio", { bytes: audioBuffer.length, mimeType: data.mimeType, error });
        return unheard;
      }
      throw error;
    }

    if (!transcript) {
      return unheard;
    }

    const resolved = resolveItemClarification(pendingClarification, transcript, context);
    if (resolved) {
      return { transcript, intent: resolved, responseText: "Done." };
    }

    const completion = await client.chat.completions({
      model: "sarvam-105b",
      temperature: 0.05,
      max_tokens: 300,
      // sarvam-105b reasons by default and can use all of the token budget before it writes JSON.
      reasoning_effort: null as unknown as undefined,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: basePrompt(forceBulk) },
        {
          role: "user",
          content: JSON.stringify({
            transcript,
            forceBulk,
            context: {
              currentListId: context.currentListId,
              currentListName: context.currentListName,
              lists: context.lists,
              items: context.items,
            },
            pendingClarification,
          }),
        },
      ],
    });

    const content = completion.choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonObject(content);
    let intent = normalizeIntent(parsed);

    if (intent.type !== "add_items_bulk") {
      const heuristicItems = parseBulkItemsHeuristically(transcript);
      if (heuristicItems.length >= 2 && (forceBulk || intent.type === "add_item")) {
        intent = {
          type: "add_items_bulk",
          items: heuristicItems,
        };
      }
    }

    intent = guardBulkIntent(guardItemIntent(intent, transcript, context), transcript, context);

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
    ...sarvamCallOptions,
    memory: "256MiB",
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
      text: text.slice(0, maxTtsChars),
      language_code: "en-IN",
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
