// Vercel serverless function — AI analysis of an unknown vendor report format.
// Mirrors the /api/ai/analyze-report route in server.ts (local dev). The
// Gemini key stays server-side; the browser only ever sends headers + a
// sample of rows and receives a validated column mapping back.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { analyzeReportWithAI } from '../../src/core/ai/analyzeReport';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server' });
    return;
  }

  const { headers, sampleRows } = req.body ?? {};
  if (!Array.isArray(headers) || headers.length === 0 || !Array.isArray(sampleRows)) {
    res.status(400).json({ error: 'Body must be { headers: string[], sampleRows: string[][] }' });
    return;
  }

  try {
    const result = await analyzeReportWithAI(headers, sampleRows, apiKey);
    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}
