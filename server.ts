import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { analyzeReportWithAI } from "./src/core/ai/analyzeReport";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Mirrors api/airtable/sync.ts for local development.
  app.post("/api/airtable/sync", async (req, res) => {
    const { createClient } = await import("@supabase/supabase-js");
    const { syncAirtable } = await import("./src/server/airtableSync");
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const token = process.env.AIRTABLE_TOKEN || "";
    if (!url || !key || !token) return res.status(500).json({ error: "Airtable sync is not configured" });
    const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const secretOk = !!process.env.AIRTABLE_SYNC_SECRET && req.headers["x-sync-secret"] === process.env.AIRTABLE_SYNC_SECRET;
    const { data } = bearer ? await createClient(url, key, { auth: { persistSession: false } }).auth.getUser(bearer) : { data: null as any };
    if (!secretOk && !data?.user) return res.status(401).json({ error: "Not allowed" });
    try { res.json(await syncAirtable({ airtableToken: token, supabaseUrl: url, serviceKey: key, forceFull: req.query.full === "1", fillNow: req.query.fill === "1" })); }
    catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : String(e) }); }
  });

  app.post("/api/gemini/generate", async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "Gemini API Key missing" });
      }
      
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      
      const { prompt } = req.body;
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
      });
      
      res.json({ text: response.text });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ai/analyze-report", async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server" });
    }
    const { headers, sampleRows } = req.body ?? {};
    if (!Array.isArray(headers) || headers.length === 0 || !Array.isArray(sampleRows)) {
      return res.status(400).json({ error: "Body must be { headers: string[], sampleRows: string[][] }" });
    }
    try {
      const result = await analyzeReportWithAI(headers, sampleRows, apiKey);
      res.json(result);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
