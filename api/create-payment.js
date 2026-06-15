import crypto from "crypto";

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            message: "Method Not Allowed"
        });
    }

   const clientId = "BRN-0245-1781503260311";
const secretKey = "SK-iqZcijyclbfh2VKd3VQQ";

    try {
        const { amount, orderId } = req.body;

       const timestamp = new Date().toISOString().split('.')[0] + "Z";

       const requestBody = {
    order: {
        amount: amount,
        invoice_number: orderId,
        return_url: "https://gamon-fawn.vercel.app/photobox.html"
    },
    payment: {
        payment_due_date: 60
    },
    callback_url: "https://gamon.vercel.app/photobox.html"
};

        const jsonBody = JSON.stringify(requestBody);

        console.log("BODY:", jsonBody);

        // Digest
        const digest = crypto
            .createHash("sha256")
            .update(jsonBody)
            .digest("base64");

        // Signature String
        const signatureComponent =
            `Client-Id:${clientId}\n` +
            `Request-Id:${orderId}\n` +
            `Request-Timestamp:${timestamp}\n` +
          `Request-Target:/checkout/v1/payment\n` +
            `Digest:${digest}`;

        // Signature
        const signature = crypto
            .createHmac("sha256", secretKey)
            .update(signatureComponent)
            .digest("base64");

        console.log("=== DOKU DEBUG ===");
        console.log("CLIENT ID:", clientId);
        console.log("REQUEST ID:", orderId);
        console.log("TIMESTAMP:", timestamp);
        console.log("DIGEST:", digest);
        console.log("SIGNATURE:", signature);

        const response = await fetch(
            "https://api-sandbox.doku.com/checkout/v1/payment",
            {
                method: "POST",
               // Tambahkan Request-Target ke dalam headers fetch:
headers: {
    "Client-Id": clientId,
    "Request-Id": orderId,
    "Request-Timestamp": timestamp,
    "Request-Target": "/checkout/v1/payment", // TAMBAHKAN BARIS INI
    "Digest": digest,
    "Signature": `HMACSHA256=${signature}`,
    "Content-Type": "application/json"
},
                body: jsonBody
            }
        );

        console.log("BODY:", jsonBody);
console.log("STATUS:", response.status);
console.log("HEADERS:", Object.fromEntries(response.headers.entries()));
const rawText = await response.text();

console.log("RESPONSE TEXT:", rawText);

let data;
try {
    data = JSON.parse(rawText);
} catch {
    data = { raw: rawText };
}

console.log("STATUS:", response.status);
console.log("DOKU RESPONSE:", JSON.stringify(data, null, 2));

        console.log("=== DOKU RESPONSE ===");
        console.log(JSON.stringify(data, null, 2));

        return res.status(response.status).json(data);

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            error: error.message
        });
    }
}
