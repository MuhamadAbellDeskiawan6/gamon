export default async function handler(req, res) {
  try {
    const { message, history = [] } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ reply: "Pesan tidak valid." });
    }

    // === Deteksi kalimat berisiko (bukan buat blokir, tapi buat ubah gaya respons AI) ===
    const crisisPattern = /bunuh diri|mengakhiri hidup|ingin mati|pengen mati|mau mati|pengin mati|capek hidup|lelah hidup|nggak mau hidup|gak mau hidup|self.?harm|menyakiti diri|melukai diri|sayat|sakiti diri/i;
    const isCrisis = crisisPattern.test(message);

    // === System prompt beda tergantung situasi ===
    const systemPrompt = isCrisis
      ? "Kamu adalah AI teman curhat bernama Gamon. User barusan menunjukkan tanda putus asa berat atau menyebut keinginan menyakiti diri. " +
        "Balas dengan empati yang tulus dan personal (bukan template), akui perasaan mereka, jangan menggurui atau panik berlebihan. " +
        "Di akhir balasanmu, WAJIB sisipkan dengan natural: ajakan untuk bicara dengan orang terdekat atau profesional, dan sebutkan Layanan Sejiwa di 119 ext 8 (gratis, 24 jam). " +
        "Balas dengan bahasa Indonesia santai, hangat, 3-5 kalimat."
      : "Kamu adalah AI teman curhat bernama Gamon yang lembut, empatik, dan peka terhadap patah hati. " +
        "Dengarkan dulu, jangan buru-buru menggurui. Balas singkat (2-4 kalimat), pakai bahasa santai Indonesia.";

    // === Susun history jadi messages array (context memory) ===
    const messages = [
      { role: "system", content: systemPrompt },
      ...history.slice(-6).map(h => ({ role: h.role, content: h.content })), // batasi 6 pesan terakhir biar token hemat
      { role: "user", content: message }
    ];

    const defaultGroqModel = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
    const isDeprecatedGroqModel = (model) => {
      const normalized = (model || "").toLowerCase();
      return normalized.includes("llama") && normalized.includes("8b") && normalized.includes("instant");
    };

    const getSafeGroqModel = () => {
      const model = defaultGroqModel || "openai/gpt-oss-20b";
      return isDeprecatedGroqModel(model) ? "openai/gpt-oss-20b" : model;
    };

    const callGroq = async (model) => {
      return fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.8,
            max_tokens: 350
          })
        }
      );
    };

    let selectedModel = getSafeGroqModel();
    let response = await callGroq(selectedModel);

    if (!response.ok && selectedModel !== "openai/gpt-oss-20b") {
      selectedModel = "openai/gpt-oss-20b";
      response = await callGroq(selectedModel);
    }

    const data = await response.json();

    let reply =
      data?.choices?.[0]?.message?.content ||
      data?.error?.message ||
      "AI lagi diam... (cek API / model / key)";

    // === Jaring pengaman: kalau situasi crisis tapi AI lupa sebut hotline, tambahkan manual ===
    if (isCrisis && !reply.includes("119")) {
      reply += "\n\nOh iya, kalau kamu butuh ngobrol langsung sama orang yang bisa bantu, Layanan Sejiwa ada di 119 ext 8, gratis dan siap 24 jam. Kamu nggak sendirian. 💛";
    }

    return res.status(200).json({ reply, flagged: isCrisis });

  } catch (err) {
    return res.status(500).json({
      reply: "Server error: " + err.message
    });
  }
}