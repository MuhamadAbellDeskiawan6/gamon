import crypto from "crypto";
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

function getDb() {
    if (!getApps().length) {
        let serviceAccount;
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            let envVal = process.env.FIREBASE_SERVICE_ACCOUNT;
            if (envVal.startsWith('"') && envVal.endsWith('"')) {
                envVal = envVal.slice(1, -1);
            }
            serviceAccount = JSON.parse(envVal);
        } else {
            try {
                const keyPath = path.resolve(process.cwd(), 'server', 'serviceAccountKey.json');
                if (fs.existsSync(keyPath)) {
                    serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
                }
            } catch (e) {
                console.error("Gagal membaca file serviceAccountKey.json lokal:", e.message);
            }
        }
        if (!serviceAccount) {
            throw new Error("Kredensial Firebase tidak ditemukan!");
        }
        initializeApp({ credential: cert(serviceAccount) });
    }
    return getFirestore();
}

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, message: "Method Not Allowed" });
    }

    const clientId = "BRN-0226-1781255193170";
    const secretKey = "SK-NgMsKzkHcLlY95v7wsju";

    try {
        const { amount, orderId, cafeName, voucherName, customerName, customerPhone } = req.body;
        
        if (!orderId || !amount || !customerPhone) {
            return res.status(400).json({ success: false, message: "Data order atau nomor HP tidak lengkap!" });
        }

        const db = getDb();

        // 1. PENCEGAHAN PEMBELIAN GANDA (Anti-Spam Berdasarkan Nomor HP)
        const existingQuery = await db.collection('cafe_vouchers')
            .where('customerPhone', '==', customerPhone.trim())
            .where('status', '==', 'PAID')
            .get();

        if (!existingQuery.empty) {
            const existingData = existingQuery.docs[0].data();
            // Jika nomor HP sudah punya voucher aktif, langsung kembalikan URL suksesnya
            return res.status(200).json({
                response: {
                    payment: {
                        url: `/cafe-success.html?orderId=${existingData.orderId}`
                    }
                }
            });
        }

        // Deteksi Base URL secara otomatis (Lokal vs Vercel Production)
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const protocol = host && host.includes('localhost') ? 'http' : 'https';
        const baseUrl = host ? `${protocol}://${host}` : 'http://localhost:3000';

        const timestamp = new Date().toISOString().split('.')[0] + "Z";
        const redeemCode = 'CAFE-' + Math.random().toString(36).substring(2, 8).toUpperCase();

        const requestBody = {
            order: {
                amount: Number(amount),
                invoice_number: orderId,
                callback_url: `${baseUrl}/cafe-success.html?orderId=${orderId}`
            },
            payment: {
                payment_due_date: 60,
                return_url: `${baseUrl}/cafe-success.html?orderId=${orderId}`,
                payment_method_types: ["QRIS", "VIRTUAL_ACCOUNT", "E_WALLET"]
            },
            additional_info: {
                override_notification_url: `${baseUrl}/api/cafe-notify`,
                cafeName: cafeName || "Kafe Partner",
                voucherName: voucherName || "Voucher Promo Rp 5K",
                redeemCode: redeemCode,
                customerName: customerName || "Pelanggan",
                customerPhone: customerPhone
            }
        };

        const jsonBody = JSON.stringify(requestBody);
        const digest = crypto.createHash("sha256").update(jsonBody).digest("base64");

        const signatureComponent =
            `Client-Id:${clientId}\n` +
            `Request-Id:${orderId}\n` +
            `Request-Timestamp:${timestamp}\n` +
            `Request-Target:/checkout/v1/payment\n` +
            `Digest:${digest}`;

        const signature = crypto.createHmac("sha256", secretKey).update(signatureComponent).digest("base64");

        const dukuResponse = await fetch("https://api.doku.com/checkout/v1/payment", {
            method: "POST",
            headers: {
                "Client-Id": clientId,
                "Request-Id": orderId,
                "Request-Timestamp": timestamp,
                "Request-Target": "/checkout/v1/payment",
                "Digest": digest,
                "Signature": `HMACSHA256=${signature}`,
                "Content-Type": "application/json"
            },
            body: jsonBody
        });

        const rawText = await dukuResponse.text();
        let data;
        try {
            data = JSON.parse(rawText);
        } catch {
            data = { raw: rawText };
        }

        if (dukuResponse.status === 200 && data.response?.payment?.url) {
            try {
                await db.collection('cafe_vouchers').doc(orderId).set({
                    orderId,
                    redeemCode,
                    amount: Number(amount),
                    cafeName: cafeName || "Kafe Partner",
                    voucherName: voucherName || "Voucher Promo Rp 5K",
                    customerName: customerName || "Pelanggan",
                    customerPhone: customerPhone || "-",
                    status: "PENDING",
                    createdAt: new Date(),
                    paymentUrl: data.response.payment.url
                });
            } catch (dbErr) {
                console.error("Gagal simpan ke Firestore:", dbErr.message);
            }
        }

        return res.status(dukuResponse.status).json(data);

    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}