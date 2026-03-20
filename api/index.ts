import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { createAIService } from '../src/lib/ai.js';

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

// Ping Route to keep database active (Supabase)
router.get('/ping', async (req, res) => {
  try {
    const db = getPrisma();
    await db.user.count();
    res.json({ status: 'ok', message: 'Database is active', timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Auth Routes
router.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  try {
    const db = getPrisma();
    const user = await db.user.create({
      data: { username, password },
    });
    res.status(201).json({ id: user.id, username: user.username });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'このユーザー名は既に使用されています。' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const db = getPrisma();
    const user = await db.user.findUnique({
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

router.patch('/users/me', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { username, password } = req.body;
  try {
    const db = getPrisma();
    const data: any = {};
    if (username) data.username = username;
    if (password) data.password = password;

    const user = await db.user.update({
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

router.get('/recipes', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const rawKey = (req.headers['x-api-key'] as string) || process.env.GEMINI_API_KEY;
  if (!rawKey) return res.status(400).json({ error: 'APIキーが設定されていません。' });
  const apiKey = rawKey.trim();

  try {
    const db = getPrisma();
    const items = await db.foodItem.findMany({ 
      where: { userId, isConsumed: false } 
    });
    
    if (items.length === 0) return res.json({ suggestion: '在庫がありません。' });

    const ai = createAIService(apiKey);
    const suggestion = await ai.generateRecipe(items.map(i => ({ name: i.name, expirationDate: i.expirationDate })));
    res.json({ suggestion });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

router.post('/chat', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const rawKey = (req.headers['x-api-key'] as string) || process.env.GEMINI_API_KEY;
  const { messages } = req.body;

  if (!rawKey) return res.status(400).json({ error: 'APIキーが必要です。' });
  const apiKey = rawKey.trim();

  try {
    const ai = createAIService(apiKey);
    const response = await ai.chat(messages);
    res.json({ response });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/food-items', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const db = getPrisma();
    const items = await db.foodItem.findMany({ 
      where: { userId },
      orderBy: { expirationDate: 'asc' } 
    });
    res.json(items);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/food-items', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { name, expirationDate, category, quantity } = req.body;
  try {
    const db = getPrisma();
    const item = await db.foodItem.create({
      data: { 
        name, 
        expirationDate: new Date(expirationDate), 
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

router.patch('/food-items/:id', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;
  const { isConsumed, name, expirationDate, category, quantity } = req.body;
  try {
    const db = getPrisma();
    // 自分のアイテムか確認
    const existing = await db.foodItem.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) return res.status(403).json({ error: 'Forbidden' });

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
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;
  try {
    const db = getPrisma();
    const existing = await db.foodItem.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) return res.status(403).json({ error: 'Forbidden' });

    await db.foodItem.delete({ where: { id } });
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/food-items/clear/consumed', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const db = getPrisma();
    await db.foodItem.deleteMany({ 
      where: { userId, isConsumed: true } 
    });
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.use('/api', router);

export default app;
