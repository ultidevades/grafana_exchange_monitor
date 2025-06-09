import app from '../src/index';

// Export the Express app as a serverless function
export default app;

// Add a specific handler for the /api route
export const config = {
  api: {
    bodyParser: false,
  },
}; 