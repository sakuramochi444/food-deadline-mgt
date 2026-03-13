import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import inquirer from 'inquirer';
import { Command } from 'commander';

// --- Prisma Setup ---
let prisma: PrismaClient;

function getPrisma() {
  if (!prisma) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
  }
  return prisma;
}

// --- Data Operations (Refactored Logic) ---

async function listItems() {
  const db = getPrisma();
  const items = await db.foodItem.findMany({
    orderBy: { expirationDate: 'asc' },
  });

  if (items.length === 0) {
    console.log('\n在庫はありません。');
    return;
  }

  const tableData = items.map((item) => ({
    ID: item.id.substring(0, 8),
    品名: item.name,
    期限: new Date(item.expirationDate).toLocaleDateString('ja-JP'),
    カテゴリ: item.category,
    数量: item.quantity || '-',
    状態: item.isConsumed ? '消費済み' : '在庫',
  }));

  console.log('\n--- 在庫一覧 ---');
  console.table(tableData);
}

async function addItem() {
  const answers = await inquirer.prompt([
    { type: 'input', name: 'name', message: '品名を入力してください:' },
    { 
      type: 'input', 
      name: 'expirationDate', 
      message: '期限を入力してください (YYYY-MM-DD):',
      validate: (input) => !isNaN(Date.parse(input)) || '正しい日付を入力してください。'
    },
    { 
      type: 'list', 
      name: 'category', 
      message: 'カテゴリを選択してください:',
      choices: ['野菜・果物', '肉・魚', '卵・乳製品', '冷凍食品', '調味料', '飲料', 'その他']
    },
    { type: 'input', name: 'quantity', message: '数量を入力してください (任意):' },
  ]);

  const db = getPrisma();
  await db.foodItem.create({
    data: {
      name: answers.name,
      expirationDate: new Date(answers.expirationDate),
      category: answers.category,
      quantity: answers.quantity,
    },
  });
  console.log('\n✅ アイテムを追加しました。');
}

async function consumeItem() {
  const db = getPrisma();
  const items = await db.foodItem.findMany({ where: { isConsumed: false } });
  
  if (items.length === 0) {
    console.log('\n消費できる在庫がありません。');
    return;
  }

  const { id } = await inquirer.prompt([
    {
      type: 'list',
      name: 'id',
      message: '消費するアイテムを選択してください:',
      choices: items.map(item => ({
        name: `${item.name} (${new Date(item.expirationDate).toLocaleDateString()})`,
        value: item.id
      }))
    }
  ]);

  await db.foodItem.update({
    where: { id },
    data: { isConsumed: true }
  });
  console.log('\n✅ アイテムを消費済みにしました。');
}

async function deleteItem() {
  const db = getPrisma();
  const items = await db.foodItem.findMany();

  const { id } = await inquirer.prompt([
    {
      type: 'list',
      name: 'id',
      message: '削除するアイテムを選択してください:',
      choices: items.map(item => ({
        name: `${item.name} [${item.id.substring(0,8)}]`,
        value: item.id
      }))
    }
  ]);

  const { confirm } = await inquirer.prompt([
    { type: 'confirm', name: 'confirm', message: '本当に削除しますか？', default: false }
  ]);

  if (confirm) {
    await db.foodItem.delete({ where: { id } });
    console.log('\n🗑️ アイテムを削除しました。');
  }
}

async function getAIRecipe() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    console.log('\n❌ エラー: GEMINI_API_KEY が環境変数に設定されていません。');
    return;
  }

  const db = getPrisma();
  const items = await db.foodItem.findMany({ where: { isConsumed: false } });

  if (items.length === 0) {
    console.log('\n在庫がないためレシピを提案できません。');
    return;
  }

  console.log('\n🤖 AIがレシピを考えています (Gemini 1.5 Flash v1)...');
  
  const inventory = items.map(i => i.name).join(', ');
  const prompt = `あなたは親切な料理アドバイザーです。現在の在庫: ${inventory}。これを使って簡単なレシピを1つ提案してください。静かで落ち着いたトーンで、日本語で回答してください。`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    const suggestion = data.candidates?.[0]?.content?.parts?.[0]?.text || 'レシピを生成できませんでした。';

    console.log('\n--- AIのおすすめレシピ ---');
    console.log(suggestion);
  } catch (error: any) {
    console.error('\n❌ AI連携エラー:', error.message);
  }
}

// --- Main Menu Loop ---

async function mainMenu() {
  while (true) {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: '操作を選択してください:',
        choices: [
          { name: '在庫を表示', value: 'list' },
          { name: 'アイテムを追加', value: 'add' },
          { name: 'アイテムを消費', value: 'consume' },
          { name: 'アイテムを削除', value: 'delete' },
          { name: 'AIレシピ提案を聞く', value: 'ai' },
          { name: '終了', value: 'exit' },
        ],
      },
    ]);

    switch (action) {
      case 'list': await listItems(); break;
      case 'add': await addItem(); break;
      case 'consume': await consumeItem(); break;
      case 'delete': await deleteItem(); break;
      case 'ai': await getAIRecipe(); break;
      case 'exit': 
        console.log('\nツールを終了します。お疲れ様でした。');
        process.exit(0);
    }
    console.log('\n--------------------------');
  }
}

// --- CLI Commander Setup ---

const program = new Command();

program
  .name('food-deadline-cli')
  .description('賞味期限管理コマンドラインツール')
  .version('1.0.0')
  .action(() => {
    console.log('--- 賞味期限管理ツール (CLI版) ---');
    mainMenu();
  });

program.parse();
