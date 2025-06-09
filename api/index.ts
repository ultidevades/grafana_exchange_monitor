import { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'GET') {
        res.status(200).json({
            status: 'ok',
            endpoints: {
                search: '/api/search',
                query: '/api/query',
                annotations: '/api/annotations',
                health: '/api/health'
            }
        });
    } else {
        res.status(405).json({ error: 'Method not allowed' });
    }
}

// Add a specific handler for the /api route
export const config = {
  api: {
    bodyParser: false,
  },
}; 