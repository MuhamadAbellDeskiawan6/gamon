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
