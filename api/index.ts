import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

let prisma: PrismaClient;

function getPrisma() {
  if (!prisma) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
  }
  return prisma;
}

const app = express();
app.use(cors());
app.use(express.json());

const router = express.Router();

router.get('/recipes', async (req, res) => {
  const rawKey = (req.headers['x-api-key'] as string) || process.env.GEMINI_API_KEY;
  if (!rawKey) return res.status(400).json({ error: 'No API Key' });
  const apiKey = rawKey.trim();

  try {
    const db = getPrisma();
    const items = await db.foodItem.findMany({ where: { isConsumed: false } });
    const inventory = items.map(i => i.name).join(', ');
    
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const prompt = `在庫（${inventory}）を使ったレシピを1つ提案してください。日本語で。`;

    const googleRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data: any = await googleRes.json();
    if (googleRes.ok) {
      const suggestion = data.candidates?.[0]?.content?.parts?.[0]?.text || 'レシピを生成できませんでした。';
      res.json({ suggestion });
    } else {
      console.error(`Gemini API Error (Status ${googleRes.status}):`, JSON.stringify(data));
      res.status(googleRes.status).json({
        error: 'Gemini API Error',
        details: data.error?.message || '不明なエラーが発生しました。',
        code: googleRes.status
      });
    }
  } catch (error: any) {
    console.error('Internal Server Error in /recipes:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// ... 他のルート（food-itemsなど）
router.get('/food-items', async (req, res) => {
  try {
    const db = getPrisma();
    const items = await db.foodItem.findMany({ orderBy: { expirationDate: 'asc' } });
    res.json(items);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/food-items', async (req, res) => {
  const { name, expirationDate, category, quantity } = req.body;
  try {
    const db = getPrisma();
    const item = await db.foodItem.create({
      data: { name, expirationDate: new Date(expirationDate), category: category || 'その他', quantity },
    });
    res.status(201).json(item);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/food-items/:id', async (req, res) => {
  const { id } = req.params;
  const { isConsumed, name, expirationDate, category, quantity } = req.body;
  try {
    const db = getPrisma();
    const data: any = {};
    if (isConsumed !== undefined) data.isConsumed = isConsumed;
    if (name !== undefined) data.name = name;
    if (expirationDate !== undefined) data.expirationDate = new Date(expirationDate);
    if (category !== undefined) data.category = category;
    if (quantity !== undefined) data.quantity = quantity;

    const item = await db.foodItem.update({ where: { id }, data });
    res.json(item);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/food-items/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = getPrisma();
    await db.foodItem.delete({ where: { id } });
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/food-items/clear/consumed', async (req, res) => {
  try {
    const db = getPrisma();
    await db.foodItem.deleteMany({ where: { isConsumed: true } });
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.use('/api', router);

export default app;
