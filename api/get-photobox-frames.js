import { getAdminDb } from './lib/firebase-admin.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    try {
        const snapshot = await getAdminDb()
            .collection('photobox_frames')
            .orderBy('createdAt', 'desc')
            .get();

        const frames = snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .filter((frame) => frame.isActive)
            .map((frame) => ({
                id: frame.id,
                name: frame.name || 'Frame',
                previewImage: frame.previewImage,
                frameImage: frame.frameImage,
                createdAt: frame.createdAt || 0
            }));

        return res.status(200).json({ success: true, data: frames });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}