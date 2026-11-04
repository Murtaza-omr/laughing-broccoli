import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new Anthropic(); // يقرأ ANTHROPIC_API_KEY من متغيرات البيئة
const MODELS = {
  quick: process.env.MODEL_QUICK || "claude-haiku-5-5",
  complex: process.env.MODEL_COMPLEX || "claude-sonnet-5-5",
};
const LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 20);
const hits = new Map();

const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || true }));
app.use(express.json({ limit: "200kb" }));

function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > LIMIT_PER_MIN;
}
setInterval(() => hits.clear(), 10 * 60_000).unref();

function valid(msgs) {
  if (!Array.isArray(msgs) || !msgs.length || msgs.length > 30) return false;
  let total = 0;
  for (const m of msgs) {
    if (!m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string") return false;
    total += m.content.length;
  }
  return total <= 80_000 && msgs[msgs.length - 1].role === "user";
}

app.post("/api/chat", async (req, res) => {
  if (limited(req.ip)) return res.status(429).json({ error: "rate_limited" });
  const { messages, tier } = req.body || {};
  if (!valid(messages)) return res.status(400).json({ error: "bad_request" });

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  try {
    const stream = client.messages.stream({
      model: MODELS[tier] || MODELS.complex,
      max_tokens: 8000,
      messages: messages.map(({ role, content }) => ({ role, content })),
    });
    req.on("close", () => stream.abort());
    stream.on("text", (t) => res.write(t));
    await stream.finalMessage();
    res.end();
  } catch (e) {
    console.error("chat error:", e?.message || e);
    if (!res.headersSent) res.status(500).json({ error: "server_error" });
    else res.end();
  }
});

app.use(express.static(path.join(__dirname, "..", "docs")));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`SABOONA AI → http://localhost:${port}`));
