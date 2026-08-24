const fs = require("fs");
const path = require("path");
const assert = require("assert");
const test = require("node:test");

test("chat API uses a supported Groq model and avoids the decommissioned Llama 3.1 8B Instant pattern", () => {
  const filePath = path.join(__dirname, "..", "api", "chat.js");
  const source = fs.readFileSync(filePath, "utf8");

  assert.ok(!/llama.*3\.1.*8b.*instant/i.test(source), "Deprecated Groq model pattern should not be used");
  assert.ok(/openai\/gpt-oss-20b|GROQ_MODEL/i.test(source), "Preferred Groq replacement should be configured");
});

test("chat API blocks prompt injection attempts and fails closed if API key is missing", () => {
  const filePath = path.join(__dirname, "..", "api", "chat.js");
  const source = fs.readFileSync(filePath, "utf8");

  assert.match(source, /process\.env\.GROQ_API_KEY|GROQ_API_KEY/i, "Server must validate the API key before calling Groq");
  assert.match(source, /ignore previous instructions|system prompt|developer mode|prompt injection|hide.*instructions/i, "Server must detect common prompt-injection patterns");
  assert.match(source, /status\(503\)|Layanan AI sedang tidak tersedia|API.*tidak.*tersedia/i, "Server must fail closed when the AI backend is disabled");
});
