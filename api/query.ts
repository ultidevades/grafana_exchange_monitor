import { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'POST') {
        // Placeholder: return a static response
        res.status(200).json({ result: 'query endpoint placeholder' });
    } else {
        res.status(405).json({ error: 'Method not allowed' });
    }
} 