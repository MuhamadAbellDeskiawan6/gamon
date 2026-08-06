import { getAdminAuth } from './firebase-admin.js';

const OWNER_EMAIL = 'muhamadabelldeskiawan@gmail.com';

function parseCookieHeader(cookieHeader) {
    const result = {};
    if (!cookieHeader || typeof cookieHeader !== 'string') {
        return result;
    }

    cookieHeader.split(';').forEach((item) => {
        const [rawKey, ...rest] = item.split('=');
        const key = (rawKey || '').trim();
        if (!key) return;
        const value = rest.join('=').trim();
        result[key] = decodeURIComponent(value || '');
    });

    return result;
}

export function readSessionCookie(req) {
    const cookieHeader = req?.headers?.cookie || '';
    const cookies = parseCookieHeader(cookieHeader);
    return cookies.admin_session || null;
}

export async function verifyAdminSession(req) {
    const sessionCookie = readSessionCookie(req);

    if (!sessionCookie) {
        return {
            ok: false,
            status: 401,
            body: { success: false, message: 'Unauthorized: Silakan login terlebih dahulu.' }
        };
    }

    try {
        const decodedClaims = await getAdminAuth().verifySessionCookie(sessionCookie, true);
        if (decodedClaims.email !== OWNER_EMAIL) {
            return {
                ok: false,
                status: 403,
                body: { success: false, message: 'Forbidden: Anda bukan pemilik sistem.' }
            };
        }

        return { ok: true, claims: decodedClaims };
    } catch (error) {
        return {
            ok: false,
            status: 401,
            body: { success: false, message: 'Sesi habis atau tidak valid.', error: error.message }
        };
    }
}