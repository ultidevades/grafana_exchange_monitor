import { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'POST') {
        // Placeholder: return an empty array
        res.status(200).json([]);
    } else {
        res.status(405).json({ error: 'Method not allowed' });
    }
} 