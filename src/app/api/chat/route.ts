import { NextRequest } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let assistantId: string | null = null;

async function getOrCreateAssistant() {
  if (assistantId) {
    return assistantId;
  }

  const assistant = await openai.beta.assistants.create({
    name: "FinAss",
    instructions:
      "You are a fun and comical financial assistant. You are polite and cheerful and you help the user to navigate through their daily life's financial needs. Analyze what the user says, as well as their financial documents if they upload any and give them helpful suggestions to help them understand and improve their situations. If the user is asking something unrelated to finance, you should politely tell them that you are not able to help with that.",
    model: "gpt-4o-mini",
    tools: [{ type: "file_search" }],
  });

  assistantId = assistant.id;
  return assistantId;
}

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const { messages, threadId, fileIds } = await req.json();

  const assistantId = await getOrCreateAssistant();

  let thread;

  if (threadId) {
    thread = await openai.beta.threads.retrieve(threadId);
  } else {
    thread = await openai.beta.threads.create();
  }

  await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: messages[messages.length - 1].content,
    attachments: fileIds.map((fileId: string) => ({
      file_id: fileId,
      tools: [{ type: "file_search" }],
    })),
  });

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  openai.beta.threads.runs
    .stream(thread.id, {
      assistant_id: assistantId,
    })
    .on("textDelta", async (delta) => {
      await writer.write(new TextEncoder().encode(delta.value || ""));
    })
    .on("end", async () => {
      await writer.close();
    })
    .on("error", async (error) => {
      console.error("Stream error:", error);
      await writer.write(
        new TextEncoder().encode("\nError occurred during streaming")
      );
      await writer.close();
    });

  return new Response(stream.readable, {
    headers: { "Content-Type": "text/event-stream", "X-Thread-Id": thread.id },
  });
}
