import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * AI Service for generating recipes and other food-related suggestions.
 * Defaults to Gemini Flash Latest for best compatibility and free tier support.
 */
export class AIService {
  private genAI: GoogleGenerativeAI;
  private modelName: string;

  constructor(apiKey: string, model: string = 'gemini-flash-latest') {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.modelName = model;
  }

  /**
   * Conducts an interactive chat session.
   */
  async chat(messages: { role: 'user' | 'model', parts: { text: string }[] }[]): Promise<string> {
    const history = messages.slice(0, -1);
    const lastMessage = messages[messages.length - 1].parts[0].text;

    const modelNames = [this.modelName, 'gemini-2.0-flash', 'gemini-pro-latest', 'gemini-2.5-flash-lite'];
    let lastError = null;

    for (const name of modelNames) {
      try {
        const model = this.genAI.getGenerativeModel({ model: name });
        const chatSession = model.startChat({ history });
        const result = await chatSession.sendMessage(lastMessage);
        const response = await result.response;
        return response.text() || '返答を生成できませんでした。';
      } catch (error: any) {
        lastError = error;
        console.warn(`Chat model ${name} failed:`, error.message);
        continue; 
      }
    }

    throw new Error(lastError?.message || 'AIとの対話に失敗しました。');
  }

  /**
   * Generates a recipe based on the provided inventory.
   */
  async generateRecipe(inventory: { name: string, expirationDate: Date }[]): Promise<string> {
    const now = new Date();
    
    // 期限切れを除外
    const validItems = inventory.filter(item => new Date(item.expirationDate) >= now);
    
    if (validItems.length === 0) {
      return '利用可能な期限内の食材がありません。新しい食材を追加してください。';
    }

    // 期限が近い順にソート
    const sortedItems = [...validItems].sort((a, b) => 
      new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime()
    );

    const inventoryList = sortedItems.map(item => {
      const daysLeft = Math.ceil((new Date(item.expirationDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return `${item.name}(あと${daysLeft}日)`;
    }).join(', ');

    const initialPrompt = `あなたは親切な料理アドバイザーです。
現在の在庫（期限が近い順）は【${inventoryList}】です。
期限が迫っているものを優先的に使い、簡単なレシピを1つ提案してください。
期限切れのものは含まれていません。
静かで落ち着いたトーンで、日本語で回答してください。`;

    return this.chat([{ role: 'user', parts: [{ text: initialPrompt }] }]);
  }
  }


/**
 * Factory function to create an AIService instance.
 */
export function createAIService(apiKey: string, model?: string) {
  return new AIService(apiKey, model);
}
