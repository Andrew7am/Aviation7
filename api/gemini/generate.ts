// Vercel serverless function — deployed equivalent of the /api/gemini/generate
// route in server.ts (which only runs locally via `npm run dev` / `npm start`).
// Vercel auto-detects any file under /api as a serverless function; this one
// keeps the exact same request/response shape so the frontend fetch call
// doesn't need to change between local dev and production.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Gemini API Key missing' });
    return;
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const { prompt } = req.body ?? {};
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
    });

    res.status(200).json({ text: response.text });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}
