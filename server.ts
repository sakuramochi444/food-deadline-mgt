import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// AI Recipe Suggestion
app.get('/api/recipes', async (req, res) => {
  const clientKey = req.headers['x-api-key'] as string;
  const apiKey = (clientKey || process.env.GEMINI_API_KEY || '').trim();

  if (!apiKey) {
    return res.status(400).json({ error: 'APIキーが設定されていません。' });
  }

  try {
    const items = await prisma.foodItem.findMany({ where: { isConsumed: false } });
    if (items.length === 0) return res.json({ suggestion: '在庫がありません。' });

    const inventoryList = items.map(i => `${i.name}(${i.category})`).join(', ');
    const prompt = `あなたは親切な料理アドバイザーです。現在の在庫: ${inventoryList}。これを使って簡単なレシピを提案してください。日本語で回答してください。`;

    console.log(`Backend attempting AI with Gemini 1.5 Flash via REST API (v1)`);
    
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data: any = await response.json();
    if (response.ok) {
      const suggestion = data.candidates?.[0]?.content?.parts?.[0]?.text || 'レシピを生成できませんでした。';
      return res.json({ suggestion });
    } else {
      console.error(`Gemini API Error (Status ${response.status}):`, JSON.stringify(data));
      return res.status(response.status).json(data.error || { message: '不明なエラーが発生しました。' });
    }
  } catch (error: any) {
    console.error('Backend AI Error:', error);
    res.status(500).json({ error: 'AI連携エラー', details: error.message });
  }
});

app.get('/api/food-items', async (req, res) => {
  try {
    const items = await prisma.foodItem.findMany({ orderBy: { expirationDate: 'asc' } });
    res.json(items);
  } catch (error: any) {
    console.error('DB Fetch Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/food-items', async (req, res) => {
  const { name, expirationDate, category, quantity } = req.body;
  if (!name || !expirationDate) return res.status(400).json({ error: '品名と期限は必須です。' });
  
  try {
    const date = new Date(expirationDate);
    if (isNaN(date.getTime())) throw new Error('不正な日付形式です。');

    const item = await prisma.foodItem.create({
      data: { name, expirationDate: date, category: category || 'その他', quantity },
    });
    res.status(201).json(item);
  } catch (error: any) {
    console.error('DB Create Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/food-items/:id', async (req, res) => {
  const { id } = req.params;
  const { isConsumed, name, expirationDate, category, quantity } = req.body;
  try {
    const data: any = {};
    if (isConsumed !== undefined) data.isConsumed = isConsumed;
    if (name !== undefined) data.name = name;
    if (expirationDate !== undefined) data.expirationDate = new Date(expirationDate);
    if (category !== undefined) data.category = category;
    if (quantity !== undefined) data.quantity = quantity;

    const item = await prisma.foodItem.update({ where: { id }, data });
    res.json(item);
  } catch (error: any) {
    console.error('Update Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/food-items/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.foodItem.delete({ where: { id } });
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/food-items/clear/consumed', async (req, res) => {
  try {
    await prisma.foodItem.deleteMany({ where: { isConsumed: true } });
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => console.log(`Backend server running at http://localhost:${port}`));
