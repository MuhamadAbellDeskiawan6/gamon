export default async function handler(req, res) {
  try {
    const { message } = req.body;

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            {
              role: "system",
              content: "Kamu adalah AI teman curhat yang lembut, emosional, dan peka terhadap patah hati."
            },
            {
              role: "user",
              content: message
            }
          ]
        })
      }
    );

    const data = await response.json();

    // 🔥 DEBUG penting (biar ketahuan error asli Groq)
    console.log("GROQ RAW RESPONSE:", JSON.stringify(data));

    const reply =
      data?.choices?.[0]?.message?.content ||
      data?.error?.message ||
      "AI lagi diam... (cek API / model / key)";

    return res.status(200).json({ reply });

  } catch (err) {
    return res.status(500).json({
      reply: "Server error: " + err.message
    });
  }
}