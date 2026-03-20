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

import ReactMarkdown from 'react-markdown';

interface FoodItem {
  id: string;
  name: string;
  expirationDate: string;
  category: string;
  quantity?: string;
  isConsumed: boolean;
}

interface AppSettings {
  notificationDays: number;
  displayDensity: 'comfortable' | 'compact';
  themeColor: 'green' | 'orange' | 'blue' | 'berry';
  hideConsumed: boolean;
}

interface User {
  id: string;
  username: string;
}

const CATEGORIES = ['野菜・果物', '肉・魚', '卵・乳製品', '冷凍食品', '調味料', '飲料', '防災備蓄', 'その他'];
const CATEGORY_ICONS: Record<string, string> = {
  '野菜・果物': '🍎',
  '肉・魚': '🥩',
  '卵・乳製品': '🥛',
  '冷凍食品': '❄️',
  '調味料': '🧂',
  '飲料': '☕',
  '防災備蓄': '🎒',
  'その他': '📦'
};

type SortOption = 'expirationDate' | 'name' | 'category' | 'createdAt' | 'manual';
type TabType = 'list' | 'ai';

interface ChatMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

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
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('user_info');
    return saved ? JSON.parse(saved) : null;
  });
  
  const [items, setItems] = useState<FoodItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_api_key') || '');
  
  // Settings State
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('app_settings');
    return saved ? JSON.parse(saved) : {
      notificationDays: 3,
      displayDensity: 'comfortable',
      themeColor: 'green',
      hideConsumed: false,
    };
  });

  const [showSettings, setShowSettings] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('list');
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

  const isFormValid = formData.name.trim() !== '' && formData.expirationDate !== '';

  useEffect(() => {
    localStorage.setItem('app_settings', JSON.stringify(settings));
    document.documentElement.setAttribute('data-theme', settings.themeColor);
    document.documentElement.setAttribute('data-density', settings.displayDensity);
  }, [settings]);

  useEffect(() => {
    if (user) {
      localStorage.setItem('user_info', JSON.stringify(user));
      fetchItems();
    } else {
      localStorage.removeItem('user_info');
      setItems([]);
    }
  }, [user]);

  const apiFetch = async (url: string, options: any = {}) => {
    const headers = {
      ...options.headers,
      'Content-Type': 'application/json',
      'x-user-id': user?.id || '',
    };
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      setUser(null);
      throw new Error('Unauthorized');
    }
    return response;
  };

  const updateSettings = (updates: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...updates }));
  };

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
    if (!user) return;
    setLoading(true);
    try {
      const response = await apiFetch('/api/food-items');
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setItems(data);
    } catch (error) {
      console.error('Failed to fetch items:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;
    try {
      const response = await apiFetch('/api/food-items', {
        method: 'POST',
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
      const response = await apiFetch(`/api/food-items/${id}`, {
        method: 'PATCH',
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
      await apiFetch(`/api/food-items/${id}`, { method: 'DELETE' });
      fetchItems();
    } catch (error) {
      console.error('Failed to delete item:', error);
    }
  };

  const clearConsumed = async () => {
    if (!confirm('消費済みの項目をすべて削除しますか？')) return;
    try {
      await apiFetch('/api/food-items/clear/consumed', { method: 'DELETE' });
      fetchItems();
    } catch (error) {
      console.error('Failed to clear consumed items:', error);
    }
  };

  const handleLogout = () => {
    if (confirm('ログアウトしますか？')) {
      setUser(null);
      setShowSettings(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    const username = (target.elements.namedItem('username') as HTMLInputElement).value;
    const password = (target.elements.namedItem('password') as HTMLInputElement).value;

    try {
      const response = await apiFetch('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ username, password: password || undefined }),
      });
      const data = await response.json();
      if (response.ok) {
        setUser(data);
        alert('ユーザー情報を更新しました。');
      } else {
        alert(data.error || '更新に失敗しました。');
      }
    } catch (error) {
      alert('エラーが発生しました。');
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
      if (settings.hideConsumed && item.isConsumed) return false;
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
  }, [items, filterCategory, searchQuery, sortBy, sortOrder, settings.hideConsumed]);

  const getStatus = (dateStr: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expDate = new Date(dateStr);
    expDate.setHours(0, 0, 0, 0);
    const diff = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return { label: '期限切れ', class: 'expired' };
    if (diff <= settings.notificationDays) return { label: `あと ${diff} 日`, class: 'soon' };
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

  const handleSendMessage = async (text?: string) => {
    const input = text || chatInput;
    if (!input && messages.length > 0) return;
    
    setAiLoading(true);
    let currentMessages = [...messages];
    
    // 1. Prepare initial hidden prompt if history is empty
    if (currentMessages.length === 0) {
      const now = new Date();
      const validItems = items
        .filter(i => !i.isConsumed && new Date(i.expirationDate) >= now)
        .sort((a, b) => new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime());

      if (validItems.length === 0) {
        setMessages([{ role: 'model', parts: [{ text: '利用可能な期限内の食材がありません。新しい食材を追加してください。' }] }]);
        setAiLoading(false);
        return;
      }

      const inventoryList = validItems.map(item => {
        const daysLeft = Math.ceil((new Date(item.expirationDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return `${item.name}(あと${daysLeft}日)`;
      }).join(', ');

      currentMessages.push({
        role: 'user',
        parts: [{ text: `あなたは親切な料理アドバイザーです。
現在の在庫（期限が近い順）は【${inventoryList}】です。
期限が迫っているものを優先的に使い、簡単なレシピを1つ提案してください。
期限切れのものは含まれていません。
静かで落ち着いたトーンで、日本語で回答してください。` }]
      });
    } else if (input) {
      // 2. Add user follow-up message
      currentMessages.push({
        role: 'user',
        parts: [{ text: input }]
      });
      setChatInput('');
    }

    // Update UI state with user's part immediately
    setMessages([...currentMessages]);

    try {
      const response = await apiFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: currentMessages }),
        headers: { 'x-api-key': apiKey }
      });
      
      const data = await response.json();
      if (response.ok) {
        setMessages(prev => [...prev, { role: 'model', parts: [{ text: data.response }] }]);
      } else {
        setMessages(prev => [...prev, { role: 'model', parts: [{ text: `【AIエラー】${data.error || '不明なエラー'}` }] }]);
      }
    } catch (error) {
      setMessages(prev => [...prev, { role: 'model', parts: [{ text: '【AIエラー】サーバーとの通信に失敗しました。' }] }]);
    } finally {
      setAiLoading(false);
    }
  };

  if (!user) {
    return <AuthView onLogin={setUser} />;
  }

  return (
    <div className="container">
      <header>
        <div className="header-top">
          <div className="user-badge" onClick={() => setShowAccountModal(true)} style={{ cursor: 'pointer' }}>
            <span className="user-icon">👤</span> {user.username}
          </div>
          <div className="header-actions">
            <button className="icon-btn" title="ガイド" onClick={() => setShowGuide(!showGuide)}>❓</button>
            <button className="icon-btn" title="設定" onClick={() => setShowSettings(!showSettings)}>⚙️</button>
          </div>
        </div>
        <div className="logo-container">
          <img src="/ver2.png" alt="StoCle Logo" className="app-logo" />
        </div>
        <h1>StoCle</h1>
        <p className="subtitle">貯める、回す、使う</p>
      </header>

      {showGuide && (
        <div className="modal-overlay" onClick={() => setShowGuide(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="guide-header">
              <h3><span>📖</span>StoCleの使い方</h3>
              <button onClick={() => setShowGuide(false)} className="close-icon-btn">✕</button>
            </div>
            
            <div className="modal-body">
              <div className="guide-steps">
                <div className="guide-step">
                  <div className="step-number">✨</div>
                  <div className="step-text">
                    <h4>在庫を追加する</h4>
                    <p>上のフォームから品名と期限を入力して追加。カテゴリを選ぶとアイコンが自動で設定されます。</p>
                  </div>
                </div>
                <div className="guide-step">
                  <div className="step-number">⏰</div>
                  <div className="step-text">
                    <h4>期限を賢く管理</h4>
                    <p>期限が近いものはオレンジ、切れたものは赤。毎日チェックしてフードロスをゼロに！</p>
                  </div>
                </div>
                <div className="guide-step">
                  <div className="step-number">🔃</div>
                  <div className="step-text">
                    <h4>自由に並び替え</h4>
                    <p>カードを長押ししてドラッグ！自分だけの使いやすい順番にいつでも整理できます。</p>
                  </div>
                </div>
                <div className="guide-step">
                  <div className="step-number">🤖</div>
                  <div className="step-text">
                    <h4>AIに相談する</h4>
                    <p>
                      「AIレシピ提案」タブでは、今の在庫から作れるメニューをAIが提案してくれます。<br />
                      <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', fontWeight: 800 }}>
                        Gemini APIキーを取得 ↗
                      </a>
                    </p>
                  </div>
                </div>
              </div>

              <div className="guide-tip">
                <span className="guide-tip-icon">💡</span>
                <div>
                  <h5>プロのヒント</h5>
                  <p>設定から「消費済をリストから隠す」をオンにすると、今あるものだけに集中できますよ。</p>
                </div>
              </div>

              <button onClick={() => setShowGuide(false)} className="add-btn" style={{ width: '100%', marginTop: '2.5rem' }}>はじめる！</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="settings-header">
              <h3><span>⚙️</span>アプリ設定</h3>
              <button onClick={() => setShowSettings(false)} className="close-icon-btn">✕</button>
            </div>
            
            <div className="modal-body">
              <div className="settings-groups">
                <div className="settings-group">
                  <span className="settings-group-title"><span>🎨</span>見た目と表示</span>
                  <div className="field-row">
                    <div className="field-label-desc">
                      <span>テーマカラー</span>
                      <span>全体のメインカラー</span>
                    </div>
                    <div className="theme-options">
                      {(['green', 'orange', 'blue', 'berry'] as const).map(color => (
                        <button 
                          key={color} 
                          className={`theme-btn ${color} ${settings.themeColor === color ? 'active' : ''}`}
                          onClick={() => updateSettings({ themeColor: color })}
                          title={color}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="field-row">
                    <div className="field-label-desc">
                      <span>表示密度</span>
                      <span>カードの大きさを調整</span>
                    </div>
                    <div className="toggle-group">
                      <button 
                        className={settings.displayDensity === 'comfortable' ? 'active' : ''}
                        onClick={() => updateSettings({ displayDensity: 'comfortable' })}
                      >
                        ゆったり
                      </button>
                      <button 
                        className={settings.displayDensity === 'compact' ? 'active' : ''}
                        onClick={() => updateSettings({ displayDensity: 'compact' })}
                      >
                        コンパクト
                      </button>
                    </div>
                  </div>

                  <div className="field-row">
                    <div className="field-label-desc">
                      <span>消費済を非表示</span>
                      <span>在庫リストをスッキリさせる</span>
                    </div>
                    <label className="switch">
                      <input 
                        type="checkbox" 
                        checked={settings.hideConsumed}
                        onChange={(e) => updateSettings({ hideConsumed: e.target.checked })}
                      />
                      <span className="slider round"></span>
                    </label>
                  </div>
                </div>

                <div className="settings-group">
                  <span className="settings-group-title"><span>🔔</span>通知と期限</span>
                  <div className="field-row">
                    <div className="field-label-desc">
                      <span>警告のタイミング</span>
                      <span>何日前に期限マークを出すか</span>
                    </div>
                    <div className="input-with-unit">
                      <input 
                        type="number" 
                        min="1" max="30"
                        value={settings.notificationDays}
                        onChange={(e) => updateSettings({ notificationDays: parseInt(e.target.value) || 1 })}
                      />
                      <span style={{ fontSize: '0.8rem', fontWeight: 800 }}>日前</span>
                    </div>
                  </div>
                </div>

                <div className="settings-group">
                  <span className="settings-group-title"><span>🤖</span>AI連携</span>
                  <div className="field">
                    <label style={{ fontSize: '0.85rem', fontWeight: '800', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', color: 'var(--text-primary)' }}>
                      Gemini API Key
                      <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', fontSize: '0.75rem' }}>
                        キーを取得 ↗
                      </a>
                    </label>
                    <div className="api-key-group">
                      <input 
                        type="password" 
                        placeholder="AIza..." 
                        value={apiKey}
                        onChange={(e) => saveApiKey(e.target.value)}
                      />
                      <button 
                        className="clear-all-btn" 
                        onClick={() => saveApiKey('')}
                      >
                        削除
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {showAccountModal && (
        <div className="modal-overlay" onClick={() => setShowAccountModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="settings-header">
              <h3><span>👤</span>アカウント設定</h3>
              <button onClick={() => setShowAccountModal(false)} className="close-icon-btn">✕</button>
            </div>
            
            <div className="modal-body">
              <div className="settings-groups">
                <div className="settings-group">
                  <span className="settings-group-title"><span>🪪</span>現在のユーザー</span>
                  <div style={{ padding: '1rem', background: 'white', borderRadius: '12px', textAlign: 'center', marginBottom: '1rem' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>👤</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{user.username}</div>
                  </div>
                </div>

                <div className="settings-group">
                  <span className="settings-group-title"><span>📝</span>プロフィールの更新</span>
                  <form onSubmit={handleUpdateProfile} className="profile-form">
                    <input type="text" name="username" defaultValue={user.username} placeholder="新しいユーザー名" required />
                    <input type="password" name="password" placeholder="新しいパスワード（空欄で維持）" />
                    <button type="submit" className="save-profile-btn" style={{ marginTop: '0.5rem' }}>変更を保存</button>
                  </form>
                </div>

                <div className="settings-group" style={{ background: '#fff1f2', border: '1px solid #fecdd3' }}>
                  <span className="settings-group-title" style={{ color: '#e11d48' }}><span>🚪</span>アカウントの切り替え</span>
                  <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '1rem' }}>
                    別のアカウントでログインする場合や、ログアウトする場合はこちら。
                  </p>
                  <button 
                    className="logout-btn" 
                    onClick={() => { setShowAccountModal(false); handleLogout(); }}
                  >
                    ログアウトして切り替え
                  </button>
                </div>
              </div>
            </div>
          </div>
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
                <option key={cat} value={cat}>{CATEGORY_ICONS[cat]} {cat}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="数量"
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
            />
            <button type="submit" className="add-btn" disabled={!isFormValid}>在庫に追加</button>
          </div>
        </form>
      </section>

      <nav className="tab-nav">
        <button 
          className={`tab-btn ${activeTab === 'list' ? 'active' : ''}`} 
          onClick={() => setActiveTab('list')}
        >
          在庫リスト
        </button>
        <button 
          className={`tab-btn ${activeTab === 'ai' ? 'active' : ''}`} 
          onClick={() => setActiveTab('ai')}
        >
          AIレシピ提案
        </button>
      </nav>

      {activeTab === 'list' ? (
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
              <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="filter-select">
                <option value="すべて">すべてのカテゴリ</option>
                {CATEGORIES.map(cat => <option key={cat} value={cat}>{CATEGORY_ICONS[cat]} {cat}</option>)}
              </select>
            </div>
            <div className="sort-controls">
              <button 
                className={`sort-btn ${sortBy === 'expirationDate' ? 'active' : ''}`}
                onClick={() => { setSortBy('expirationDate'); setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'); }}
              >
                期限順 {sortBy === 'expirationDate' && (sortOrder === 'asc' ? '↑' : '↓')}
              </button>
              <button 
                className={`sort-btn ${sortBy === 'manual' ? 'active' : ''}`}
                onClick={() => setSortBy('manual')}
              >
                ドラッグ
              </button>
              {!settings.hideConsumed && <button className="clear-all-btn" onClick={clearConsumed}>消費済みを削除</button>}
            </div>
          </div>

          <div className="list-header">
            <h2>在庫一覧 ({filteredAndSortedItems.length}個)</h2>
          </div>

          {loading ? <p className="loading">読み込み中...</p> : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={filteredAndSortedItems.map(i => i.id)} strategy={rectSortingStrategy}>
                <div className={`items-grid density-${settings.displayDensity}`}>
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
                                  <div className="item-header-row">
                                    <span className={`category-tag category-${item.category}`}>
                                      {CATEGORY_ICONS[item.category]} {item.category}
                                    </span>
                                    {!item.isConsumed && <span className={`status-label ${status.class}`}>{status.label}</span>}
                                  </div>
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
                                  <span className="date-label">{new Date(item.expirationDate).toLocaleDateString()} まで</span>
                                </div>
                              </div>
                              <div className="item-actions">
                                <button onClick={(e) => { e.stopPropagation(); updateItem(item.id, { isConsumed: !item.isConsumed }); }} className="check-btn">
                                  {item.isConsumed ? '↩ 戻す' : '✓ 消費'}
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
      ) : (
        <section className="ai-section">
          <div className="card ai-card">
            <div className="ai-header">
              <span className="ai-icon">🤖</span>
              <h3>AIキッチン・チャット</h3>
              <p className="ai-intro">
                在庫にある食材を使って、AIと対話しながらメニューを決められます。
              </p>
            </div>
            
            <div className="chat-window">
              {messages.length === 0 ? (
                <div className="chat-empty">
                  <p>「レシピを提案してもらう」ボタンを押して、料理のアイデアを聞いてみましょう。</p>
                  <button 
                    className="ai-gen-btn" 
                    onClick={() => handleSendMessage()} 
                    disabled={aiLoading}
                  >
                    {aiLoading ? '考え中...' : 'レシピを提案してもらう'}
                  </button>
                </div>
              ) : (
                <div className="messages-list">
                  {messages.slice(1).map((msg, i) => (
                    <div key={i} className={`chat-bubble ${msg.role === 'user' ? 'user' : 'ai'}`}>
                      <div className="bubble-content markdown-body">
                        <ReactMarkdown>{msg.parts[0].text}</ReactMarkdown>
                      </div>
                    </div>
                  ))}
                  {aiLoading && (
                    <div className="chat-bubble ai loading">
                      <div className="typing-indicator">
                        <span></span><span></span><span></span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {messages.length > 0 && (
              <form className="chat-input-area" onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}>
                <input 
                  type="text" 
                  placeholder="「もっと辛くして」「魚料理がいい」など..." 
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={aiLoading}
                />
                <button type="submit" disabled={aiLoading || !chatInput.trim()}>送信</button>
                <button type="button" className="reset-chat-btn" onClick={() => setMessages([])}>クリア</button>
              </form>
            )}
            
            {!apiKey && (
              <p className="api-hint">
                ※ 設定画面からGemini APIキーを登録すると利用できます。
                <br />
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', fontWeight: 800 }}>
                  Gemini APIキーを取得 ↗
                </a>
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function AuthView({ onLogin }: { onLogin: (user: User) => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = isLogin ? '/api/login' : '/api/signup';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (res.ok) {
        onLogin(data);
      } else {
        setError(data.error || 'エラーが発生しました。');
      }
    } catch (err) {
      setError('サーバーとの通信に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card card">
        <header>
          <div className="logo-container">
          <img src="/ver2.png" alt="StoCle Logo" className="app-logo" />
        </div>
        <h1>StoCle</h1>
          <p className="subtitle">貯める、回す、使う</p>
        </header>

        <h2>{isLogin ? 'ログイン' : '新規登録'}</h2>
        
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>ユーザー名</label>
            <input 
              type="text" 
              value={username} 
              onChange={e => setUsername(e.target.value)} 
              required 
              placeholder="ユーザー名を入力"
            />
          </div>
          <div className="field">
            <label>パスワード</label>
            <input 
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              required 
              placeholder="パスワードを入力"
            />
          </div>
          
          {error && <p className="auth-error">{error}</p>}
          
          <button type="submit" className="add-btn auth-submit" disabled={loading}>
            {loading ? '処理中...' : (isLogin ? 'ログイン' : '登録する')}
          </button>
        </form>

        <div className="auth-footer">
          <button onClick={() => { setIsLogin(!isLogin); setError(''); }} className="toggle-auth-btn">
            {isLogin ? '新しくアカウントを作る' : 'ログイン画面に戻る'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
