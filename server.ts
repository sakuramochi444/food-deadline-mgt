import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { createAIService } from './src/lib/ai.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// Auth Routes
app.post('/api/signup', async (req, res) => {
  const { username, password } = req.body;
  console.log('Signup request received:', { username });
  try {
    const user = await prisma.user.create({
      data: { username, password },
    });
    console.log('User created successfully:', user.id);
    res.status(201).json({ id: user.id, username: user.username });
  } catch (error: any) {
    console.error('Signup Error details:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'このユーザー名は既に使用されています。' });
    }
    res.status(500).json({ error: 'サーバー内部エラーが発生しました。', details: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await prisma.user.findUnique({
      where: { username },
    });
    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません。' });
    }
    res.json({ id: user.id, username: user.username });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/users/me', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { username, password } = req.body;
  try {
    const data: any = {};
    if (username) data.username = username;
    if (password) data.password = password;

    const user = await prisma.user.update({
      where: { id: userId },
      data,
    });
    res.json({ id: user.id, username: user.username });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'このユーザー名は既に使用されています。' });
    }
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/recipes', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const clientKey = req.headers['x-api-key'] as string;
  const apiKey = (clientKey || process.env.GEMINI_API_KEY || '').trim();

  if (!apiKey) {
    return res.status(400).json({ error: 'APIキーが設定されていません。' });
  }

  try {
    const items = await prisma.foodItem.findMany({ 
      where: { userId, isConsumed: false } 
    });
    if (items.length === 0) return res.json({ suggestion: '在庫がありません。' });

    const ai = createAIService(apiKey);
    const suggestion = await ai.generateRecipe(items.map(i => i.name));
    res.json({ suggestion });
  } catch (error: any) {
    console.error('Server Error at /api/recipes:', error);
    res.status(500).json({ 
      error: 'AI連携中にサーバーエラーが発生しました', 
      details: error.message 
    });
  }
});

app.post('/api/chat', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const clientKey = req.headers['x-api-key'] as string;
  const apiKey = (clientKey || process.env.GEMINI_API_KEY || '').trim();
  const { messages } = req.body;

  if (!apiKey) return res.status(400).json({ error: 'APIキーが必要です。' });

  try {
    const ai = createAIService(apiKey);
    const response = await ai.chat(messages);
    res.json({ response });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/food-items', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const items = await prisma.foodItem.findMany({ 
      where: { userId },
      orderBy: { expirationDate: 'asc' } 
    });
    res.json(items);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/food-items', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { name, expirationDate, category, quantity } = req.body;
  if (!name || !expirationDate) return res.status(400).json({ error: '品名と期限は必須です。' });
  
  try {
    const date = new Date(expirationDate);
    const item = await prisma.foodItem.create({
      data: { 
        name, 
        expirationDate: date, 
        category: category || 'その他', 
        quantity,
        userId
      },
    });
    res.status(201).json(item);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/food-items/:id', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;
  const { isConsumed, name, expirationDate, category, quantity } = req.body;
  try {
    // 自分のアイテムか確認
    const existing = await prisma.foodItem.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) return res.status(403).json({ error: 'Forbidden' });

    const data: any = {};
    if (isConsumed !== undefined) data.isConsumed = isConsumed;
    if (name !== undefined) data.name = name;
    if (expirationDate !== undefined) data.expirationDate = new Date(expirationDate);
    if (category !== undefined) data.category = category;
    if (quantity !== undefined) data.quantity = quantity;

    const item = await prisma.foodItem.update({ where: { id }, data });
    res.json(item);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/food-items/:id', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;
  try {
    const existing = await prisma.foodItem.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) return res.status(403).json({ error: 'Forbidden' });

    await prisma.foodItem.delete({ where: { id } });
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/food-items/clear/consumed', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    await prisma.foodItem.deleteMany({ 
      where: { userId, isConsumed: true } 
    });
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => console.log(`Backend server running at http://localhost:${port}`));
