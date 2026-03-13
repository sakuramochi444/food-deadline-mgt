import { useState, useEffect, useMemo } from 'react';
import './App.css';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface FoodItem {
  id: string;
  name: string;
  expirationDate: string;
  category: string;
  quantity?: string;
  isConsumed: boolean;
}

const CATEGORIES = ['野菜・果物', '肉・魚', '卵・乳製品', '冷凍食品', '調味料', '飲料', '防災備蓄', 'その他'];
type SortOption = 'expirationDate' | 'name' | 'category' | 'createdAt' | 'manual';

function SortableItem(props: { id: string; children: React.ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 1,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {props.children}
    </div>
  );
}

function App() {
  const [items, setItems] = useState<FoodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [recipeSuggestion, setRecipeSuggestion] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_api_key') || '');
  const [showSettings, setShowSettings] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    expirationDate: '',
    category: 'その他',
    quantity: '',
  });

  const [filterCategory, setFilterCategory] = useState('すべて');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('expirationDate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<Partial<FoodItem>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const saveApiKey = (key: string) => {
    const cleanKey = key.trim().replace(/[\x00-\x1F\x7F-\x9F\s]/g, '');
    setApiKey(cleanKey);
    if (cleanKey) {
      localStorage.setItem('gemini_api_key', cleanKey);
    } else {
      localStorage.removeItem('gemini_api_key');
    }
  };

  const fetchItems = async () => {
    try {
      const response = await fetch('/api/food-items');
      if (!response.ok) throw new Error('Database connection failed');
      const data = await response.json();
      setItems(data);
    } catch (error) {
      console.error('Failed to fetch items:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.expirationDate) return;
    try {
      const response = await fetch('/api/food-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        setFormData({ name: '', expirationDate: '', category: 'その他', quantity: '' });
        fetchItems();
      }
    } catch (error) {
      console.error('Failed to add item:', error);
    }
  };

  const updateItem = async (id: string, data: Partial<FoodItem>) => {
    try {
      const response = await fetch(`/api/food-items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (response.ok) {
        fetchItems();
        if (editingId === id) setEditingId(null);
      }
    } catch (error) {
      console.error('Failed to update item:', error);
    }
  };

  const deleteItem = async (id: string) => {
    if (!confirm('この項目を削除しますか？')) return;
    try {
      await fetch(`/api/food-items/${id}`, { method: 'DELETE' });
      fetchItems();
    } catch (error) {
      console.error('Failed to delete item:', error);
    }
  };

  const clearConsumed = async () => {
    if (!confirm('消費済みの項目をすべて削除しますか？')) return;
    try {
      await fetch('/api/food-items/clear/consumed', { method: 'DELETE' });
      fetchItems();
    } catch (error) {
      console.error('Failed to clear consumed items:', error);
    }
  };

  const startEditing = (item: FoodItem) => {
    setEditingId(item.id);
    setEditFormData({
      name: item.name,
      expirationDate: item.expirationDate.split('T')[0],
      category: item.category,
      quantity: item.quantity,
    });
  };

  const adjustQuantity = (item: FoodItem, delta: number) => {
    const currentQty = item.quantity || '0';
    const match = currentQty.match(/^(\d+)(.*)$/);
    if (match) {
      const num = parseInt(match[1]);
      const unit = match[2];
      const nextNum = Math.max(0, num + delta);
      updateItem(item.id, { quantity: `${nextNum}${unit}` });
    } else if (!isNaN(Number(currentQty))) {
      const nextNum = Math.max(0, Number(currentQty) + delta);
      updateItem(item.id, { quantity: String(nextNum) });
    }
  };

  const filteredAndSortedItems = useMemo(() => {
    const base = items.filter((item) => {
      const matchesCategory = filterCategory === 'すべて' || item.category === filterCategory;
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });

    if (sortBy === 'manual') return base;

    return [...base].sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'expirationDate') {
        comparison = new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime();
      } else if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name, 'ja');
      } else if (sortBy === 'category') {
        comparison = a.category.localeCompare(b.category, 'ja');
      } else {
        comparison = a.id.localeCompare(b.id);
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [items, filterCategory, searchQuery, sortBy, sortOrder]);

  const getStatus = (dateStr: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expDate = new Date(dateStr);
    expDate.setHours(0, 0, 0, 0);
    const diff = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return { label: '期限切れ', class: 'expired' };
    if (diff <= 3) return { label: `あと ${diff} 日`, class: 'soon' };
    return { label: `あと ${diff} 日`, class: 'safe' };
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setSortBy('manual');
      setItems((currentItems) => {
        const oldIndex = currentItems.findIndex((i) => i.id === active.id);
        const newIndex = currentItems.findIndex((i) => i.id === over.id);
        return arrayMove(currentItems, oldIndex, newIndex);
      });
    }
  };

  const fetchRecipes = async () => {
    setAiLoading(true);
    setRecipeSuggestion('AIがレシピを考えています...');
    const inventory = items.filter(i => !i.isConsumed).map(i => i.name).join(', ');
    const promptText = `あなたは親切な料理アドバイザーです。現在の在庫: ${inventory}。これを使って簡単なレシピを1つ提案してください。日本語で回答してください。`;

    const tryFetch = async (url: string, options: any) => {
      const res = await fetch(url, options);
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { success: true, text: data.candidates?.[0]?.content?.parts?.[0]?.text || data.suggestion };
      return { 
        success: false, 
        status: res.status, 
        message: data.error?.message || data.details || res.statusText 
      };
    };

    // 1. Direct Browser Call
    if (apiKey && apiKey.length > 20) {
      const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const result = await tryFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
      });
      if (result.success) {
        setRecipeSuggestion(result.text);
        setAiLoading(false);
        return;
      } else if (result.status !== 400) { // API Key 無効以外のエラーならフォールバックせず報告
        setRecipeSuggestion(`【AIエラー】${result.status}: ${result.message}\n(ブラウザから直接リクエスト中に発生)`);
        setAiLoading(false);
        return;
      }
    }

    // 2. Backend Fallback
    const result = await tryFetch('/api/recipes', { 
      headers: { 'x-api-key': apiKey } 
    });
    if (result.success) {
      setRecipeSuggestion(result.text);
    } else {
      setRecipeSuggestion(`【AIエラー】${result.status}: ${result.message}\nAPIキーが正しく設定されているか確認してください。`);
    }
    setAiLoading(false);
  };

  return (
    <div className="container">
      <header>
        <div className="header-top">
          <div className="header-spacer"></div>
          <h1>ストックル</h1>
          <div className="header-actions">
            <button className="icon-btn" title="ガイド" onClick={() => setShowGuide(!showGuide)}>❓</button>
            <button className="icon-btn" title="設定" onClick={() => setShowSettings(!showSettings)}>⚙️</button>
          </div>
        </div>
        <p className="subtitle">貯める、回す、使う</p>
      </header>

      {showGuide && (
        <div className="guide-panel card">
          <h3>ストックルの使い方</h3>
          <ul>
            <li><strong>追加:</strong> 上のフォームから食材を登録。</li>
            <li><strong>並べ替え:</strong> カードを自由にドラッグして自分好みの順序に。</li>
            <li><strong>管理:</strong> 期限が近いものはオレンジや赤で表示されます。</li>
            <li><strong>AI:</strong> APIキーを設定すると、在庫からレシピを提案します。</li>
          </ul>
          <button onClick={() => setShowGuide(false)} className="close-btn">閉じる</button>
        </div>
      )}

      {showSettings && (
        <div className="settings-panel card">
          <h3>設定</h3>
          <div className="field">
            <label>Gemini API Key</label>
            <input 
              type="password" 
              placeholder="ここにキーを入力（AIza...）" 
              value={apiKey}
              onChange={(e) => saveApiKey(e.target.value)}
            />
          </div>
          <button className="clear-key-btn" onClick={() => saveApiKey('')}>キーを削除</button>
        </div>
      )}

      <section className="form-section card">
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <input
              type="text"
              placeholder="品名 (例: 牛乳)"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
            <input
              type="date"
              value={formData.expirationDate}
              onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
              required
            />
          </div>
          <div className="input-group">
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="数量"
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
            />
            <button type="submit" className="add-btn">在庫に追加</button>
          </div>
        </form>
      </section>

      <section className="list-section">
        <div className="list-controls card">
          <div className="filter-search">
            <input 
              type="text" 
              placeholder="検索..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              <option value="すべて">すべてのカテゴリ</option>
              {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>
          <div className="sort-controls">
            <button 
              className={`sort-btn ${sortBy === 'expirationDate' ? 'active' : ''}`}
              onClick={() => { setSortBy('expirationDate'); setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'); }}
            >
              期限順
            </button>
            <button 
              className={`sort-btn ${sortBy === 'manual' ? 'active' : ''}`}
              onClick={() => setSortBy('manual')}
            >
              自由
            </button>
            <button className="clear-all-btn" onClick={clearConsumed}>消費済を削除</button>
          </div>
        </div>

        <div className="list-header">
          <h2>在庫一覧 ({filteredAndSortedItems.length}個)</h2>
        </div>

        {loading ? <p className="loading">読み込み中...</p> : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={filteredAndSortedItems.map(i => i.id)} strategy={rectSortingStrategy}>
              <div className="items-grid">
                {filteredAndSortedItems.map((item) => {
                  const status = getStatus(item.expirationDate);
                  const isEditing = editingId === item.id;
                  return (
                    <SortableItem key={item.id} id={item.id}>
                      <div className={`item-card card ${item.isConsumed ? 'consumed' : ''} status-${status.class}`}>
                        {isEditing ? (
                          <div className="edit-form" onClick={(e) => e.stopPropagation()}>
                            <div className="input-group">
                              <input type="text" value={editFormData.name} onChange={e => setEditFormData({...editFormData, name: e.target.value})} />
                              <input type="date" value={editFormData.expirationDate} onChange={e => setEditFormData({...editFormData, expirationDate: e.target.value})} />
                            </div>
                            <div className="input-group">
                              <select value={editFormData.category} onChange={e => setEditFormData({...editFormData, category: e.target.value})}>
                                {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                              </select>
                              <input type="text" value={editFormData.quantity} onChange={e => setEditFormData({...editFormData, quantity: e.target.value})} />
                            </div>
                            <div className="edit-actions">
                              <button onClick={() => updateItem(item.id, editFormData)} className="save-btn">保存</button>
                              <button onClick={() => setEditingId(null)} className="cancel-btn">戻る</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="item-main">
                              <div className="item-info">
                                <span className={`category-tag category-${item.category}`}>{item.category}</span>
                                <h3>{item.name}</h3>
                                <div className="qty-control">
                                  <span className="quantity-display">数量: {item.quantity || '-'}</span>
                                  {!item.isConsumed && (
                                    <div className="qty-btns">
                                      <button onClick={(e) => { e.stopPropagation(); adjustQuantity(item, -1); }}>-</button>
                                      <button onClick={(e) => { e.stopPropagation(); adjustQuantity(item, 1); }}>+</button>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="item-status">
                                <span className={`status-label ${status.class}`}>{item.isConsumed ? '消費済' : status.label}</span>
                                <span className="date-label">{new Date(item.expirationDate).toLocaleDateString()}</span>
                              </div>
                            </div>
                            <div className="item-actions">
                              <button onClick={(e) => { e.stopPropagation(); updateItem(item.id, { isConsumed: !item.isConsumed }); }} className="check-btn">
                                {item.isConsumed ? '取り消し' : '消費'}
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); startEditing(item); }} className="edit-btn">編集</button>
                              <button onClick={(e) => { e.stopPropagation(); deleteItem(item.id); }} className="delete-btn">削除</button>
                            </div>
                          </>
                        )}
                      </div>
                    </SortableItem>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </section>

      <section className="ai-section">
        <div className="card ai-card">
          <div className="ai-header">
            <h3>AI おすすめレシピ</h3>
            <button className="ai-btn" onClick={fetchRecipes} disabled={aiLoading || items.length === 0}>
              {aiLoading ? '提案中...' : 'レシピを提案'}
            </button>
          </div>
          {recipeSuggestion && <div className="ai-content"><p style={{ whiteSpace: 'pre-wrap' }}>{recipeSuggestion}</p></div>}
        </div>
      </section>
    </div>
  );
}

export default App;
