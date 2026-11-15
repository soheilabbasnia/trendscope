import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LayoutDashboard,
  Rss,
  Newspaper,
  Settings,
  Check,
  X,
  ExternalLink,
  Search,
  Filter,
  Clock,
  RefreshCw,
  Menu,
  ChevronLeft,
  CheckCircle2,
  XCircle,
  Info,
  Lock,
  LogOut,
  AlertCircle,
  Trash2
} from 'lucide-react';

export interface StorySource {
  label: string;
  url: string;
}

export interface DashboardStory {
  id: string;
  persianTitle: string;
  englishTitle: string;
  summary: string;
  category: string;
  score: number;
  publisher: string;
  publishedAt: string;
  timestamp: number;
  dateGroup: 'today' | 'yesterday' | 'week';
  status: 'general' | 'approved' | 'rejected';
  sources: StorySource[];
}

export interface OverviewMetrics {
  totalCount: number;
  approvedCount: number;
  rejectedCount: number;
  pendingCount: number;
  lastCollectionTime?: string;
  nextRunTehran?: string;
}

export interface ReportItem {
  id: string;
  title: string;
  windowStart: string;
  windowEnd: string;
  status: string;
  stories: DashboardStory[];
}

const ALL_CATEGORIES = [
  'هوش مصنوعی',
  'سخت‌افزار و تراشه',
  'امنیت سایبری',
  'نرم‌افزار و متن‌باز',
  'زیرساخت و شبکه',
  'رایانش کوانتومی',
  'سیاست‌گذاری فناوری',
  'انرژی و سخت‌افزار',
  'عمومی'
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'general' | 'news' | 'settings'>('overview');
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('trendscope_token'));
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!token);
  const [authError, setAuthError] = useState<string | null>(null);
  const [passcode, setPasscode] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Data states
  const [stories, setStories] = useState<DashboardStory[]>([]);
  const [overview, setOverview] = useState<OverviewMetrics>({
    totalCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    pendingCount: 0,
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Settings State
  const [settings, setSettings] = useState({
    collectionInterval: '30',
    minScore: 8.5,
    enabledCategories: [...ALL_CATEGORIES],
    lastProcessingStatus: 'آماده و متصل به Cloudflare D1',
    lastRefreshMessage: null as string | null
  });

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Helper fetch with auth
  const apiFetch = useCallback(async (endpoint: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers || {});
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    headers.set('Content-Type', 'application/json');

    const res = await fetch(endpoint, { ...options, headers });
    if (res.status === 401) {
      setIsAuthenticated(false);
      localStorage.removeItem('trendscope_token');
      throw new Error('نشست شما منقضی شده است. لطفاً دوباره وارد شوید.');
    }
    return res;
  }, [token]);

  // Load live data from Cloudflare Worker
  const loadDashboardData = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      // 1. Overview
      const ovRes = await apiFetch('/api/dashboard/overview');
      if (ovRes.ok) {
        const ovData = (await ovRes.json()) as OverviewMetrics;
        setOverview(ovData);
      }

      // 2. Pending stories
      const pendingRes = await apiFetch('/api/dashboard/pending');
      const pendingData: DashboardStory[] = pendingRes.ok ? ((await pendingRes.json()) as any) : [];

      // 3. Approved stories
      const approvedRes = await apiFetch('/api/dashboard/approved');
      const approvedData: DashboardStory[] = approvedRes.ok ? ((await approvedRes.json()) as any) : [];

      // Merge unique
      const storyMap = new Map<string, DashboardStory>();
      approvedData.forEach(s => storyMap.set(s.id, s));
      pendingData.forEach(s => {
        if (!storyMap.has(s.id)) storyMap.set(s.id, s);
      });
      setStories(Array.from(storyMap.values()));

      // 4. Settings
      const setRes = await apiFetch('/api/dashboard/settings');
      if (setRes.ok) {
        const setData = (await setRes.json()) as any;
        if (setData && typeof setData === 'object') {
          setSettings(prev => ({ ...prev, ...setData }));
        }
      }
    } catch (err: any) {
      console.error('Error loading dashboard data:', err);
      if (err.message && !err.message.includes('نشست')) {
        showToast(err.message, 'error');
      }
    } finally {
      setIsLoading(false);
    }
  }, [apiFetch, token]);

  useEffect(() => {
    if (isAuthenticated && token) {
      loadDashboardData();
    }
  }, [isAuthenticated, token, loadDashboardData]);

  // Handle Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim()) return;
    setIsLoggingIn(true);
    setAuthError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: passcode.trim() }),
      });

      const data = (await res.json()) as any;
      if (res.ok && data.token) {
        localStorage.setItem('trendscope_token', data.token);
        setToken(data.token);
        setIsAuthenticated(true);
        setPasscode('');
        showToast('ورود با موفقیت انجام شد');
      } else {
        setAuthError(data.error || 'رمز عبور یا شناسه ادمین نادرست است.');
      }
    } catch (err: any) {
      setAuthError('خطا در برقراری ارتباط با سرور.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('trendscope_token');
    setToken(null);
    setIsAuthenticated(false);
    setStories([]);
    showToast('از حساب کاربری خارج شدید.');
  };

  // Single-step approval / rejection handler connected to real backend
  const handleStoryDecision = async (id: string, decision: 'approved' | 'rejected') => {
    const prevStories = [...stories];
    // Optimistic UI update
    setStories(prev =>
      prev.map(story =>
        story.id === id ? { ...story, status: decision } : story
      )
    );

    try {
      const endpoint = decision === 'approved' ? '/api/dashboard/approve' : '/api/dashboard/reject';
      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ storyId: id }),
      });
      const data = (await res.json()) as any;

      if (res.ok && data.ok) {
        showToast(data.message || (decision === 'approved' ? 'خبر تأیید و به تاپیک اخبار ارسال شد' : 'خبر رد شد'));
        // Refresh overview counts
        setOverview(prev => ({
          ...prev,
          pendingCount: Math.max(0, prev.pendingCount - 1),
          approvedCount: decision === 'approved' ? prev.approvedCount + 1 : prev.approvedCount,
          rejectedCount: decision === 'rejected' ? prev.rejectedCount + 1 : prev.rejectedCount,
        }));
      } else {
        // Rollback
        setStories(prevStories);
        showToast(data.error || data.message || 'خطا در اعمال تغییرات', 'error');
      }
    } catch (err: any) {
      setStories(prevStories);
      showToast(err.message || 'خطا در ارتباط با سرور', 'error');
    }
  };

  // Manual refresh handler
  const handleManualRefresh = async () => {
    setIsLoading(true);
    setSettings(prev => ({ ...prev, lastRefreshMessage: 'در حال جمع‌آوری و ارزیابی اخبار از فیدها...' }));

    try {
      const res = await apiFetch('/api/dashboard/refresh', { method: 'POST' });
      const data = (await res.json()) as any;
      if (res.ok && data.ok) {
        showToast(`پایش انجام شد: ${data.count || 0} خبر واجد شرایط استخراج گردید.`);
        setSettings(prev => ({
          ...prev,
          lastRefreshMessage: `پایش موفق: ${data.count || 0} خبر با امتیاز بالای ۸.۵ استخراج و ذخیره شد.`
        }));
        await loadDashboardData();
      } else {
        setSettings(prev => ({ ...prev, lastRefreshMessage: data.error || 'خطا در جمع‌آوری اخبار' }));
        showToast(data.error || 'خطا در خزش اخبار', 'error');
      }
    } catch (err: any) {
      setSettings(prev => ({ ...prev, lastRefreshMessage: err.message || 'خطای شبکه' }));
      showToast(err.message || 'خطای شبکه', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const navItems = [
    { id: 'overview' as const, label: 'پیش‌خوان', icon: LayoutDashboard, badge: 0 },
    {
      id: 'general' as const,
      label: 'خبرخوان',
      icon: Rss,
      badge: stories.filter((s) => s.status === 'general' && s.score > settings.minScore).length
    },
    {
      id: 'news' as const,
      label: 'خبرها',
      icon: Newspaper,
      badge: stories.filter((s) => s.status === 'approved').length
    },
    { id: 'settings' as const, label: 'تنظیمات', icon: Settings, badge: 0 }
  ];

  const generalStories = useMemo(
    () =>
      stories.filter(
        (s) =>
          s.status === 'general' &&
          s.score > settings.minScore &&
          (settings.enabledCategories.length === 0 || settings.enabledCategories.includes(s.category))
      ),
    [stories, settings.minScore, settings.enabledCategories]
  );

  const approvedStories = useMemo(
    () => stories.filter((s) => s.status === 'approved'),
    [stories]
  );

  const rejectedCount = useMemo(
    () => overview.rejectedCount || stories.filter((s) => s.status === 'rejected').length,
    [stories, overview.rejectedCount]
  );

  const handleNavClick = (id: typeof activeTab) => {
    setActiveTab(id);
    setMobileMenuOpen(false);
  };

  // If not logged in, render the secure single-user login screen
  if (!isAuthenticated) {
    return (
      <div dir="rtl" className="min-h-screen bg-[#080808] text-[#F5F1E8] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#111111] border border-[#D4AF37]/30 rounded-2xl p-8 shadow-2xl relative">
          <div className="flex flex-col items-center text-center mb-8">
            <div className="w-20 h-20 rounded-full border border-[#D4AF37]/40 p-1 mb-4 bg-[#080808]">
              <img
                src="/api/logo"
                alt="TrendScope Owl"
                className="w-full h-full rounded-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>
            <h1 className="text-2xl font-bold text-[#F5F1E8]">
              ورود به <span className="text-[#D4AF37]">ترنداسکوپ</span>
            </h1>
            <p className="text-xs text-[#99958C] mt-2">
              سامانه هوشمند پایش و گزینش اخبار فناوری یوتیوب
            </p>
          </div>

          {authError && (
            <div className="mb-6 p-3.5 rounded-lg bg-red-950/40 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-medium text-[#99958C] mb-2">
                شناسه ادمین تلگرام یا رمز عبور
              </label>
              <div className="relative">
                <Lock size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#99958C]" />
                <input
                  type="password"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="رمز عبور مدیریتی..."
                  required
                  className="w-full bg-[#171717] border border-[#D4AF37]/25 rounded-xl pr-10 pl-4 py-3 text-sm text-[#F5F1E8] placeholder-[#99958C] focus:outline-none focus:border-[#D4AF37]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3 px-4 rounded-xl bg-[#D4AF37] text-[#080808] font-bold text-sm hover:bg-[#e2bd44] transition-colors disabled:opacity-50"
            >
              {isLoggingIn ? 'در حال ورود...' : 'ورود به سامانه'}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-[#D4AF37]/15 text-center text-[11px] text-[#99958C]">
            سیستم امن تک‌کاربره متصل به کلاودفلر ورکر و تلگرام
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      dir="rtl"
      className="flex h-screen bg-[#080808] text-[#F5F1E8] overflow-hidden select-none sm:select-auto"
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div className={`fixed bottom-6 left-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border text-xs font-medium shadow-2xl transition-all ${
          toastMessage.type === 'error'
            ? 'bg-red-950/90 border-red-500/40 text-red-200'
            : 'bg-[#171717]/95 border-[#D4AF37]/50 text-[#F5F1E8]'
        }`}>
          {toastMessage.type === 'error' ? <AlertCircle size={16} className="text-red-400" /> : <CheckCircle2 size={16} className="text-[#D4AF37]" />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 right-0 z-40 w-68 bg-[#111111] border-l border-[#D4AF37]/20 flex flex-col transition-transform duration-300 ease-out lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Brand Header with Attached Owl Logo */}
        <div className="p-6 flex flex-col items-center border-b border-[#D4AF37]/15 relative">
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden absolute top-4 left-4 p-2 text-[#99958C] hover:text-[#F5F1E8]"
            aria-label="بستن منو"
          >
            <X size={20} />
          </button>

          <div className="relative mb-3.5 group">
            <div className="absolute inset-0 bg-[#D4AF37] rounded-full blur-md opacity-15 group-hover:opacity-30 transition-opacity duration-500" />
            <img
              src="/api/logo"
              alt="TrendScope Owl Emblem"
              className="w-20 h-20 rounded-full border border-[#D4AF37]/40 object-cover relative z-10 bg-[#080808]"
            />
          </div>

          <h1 className="text-xl font-bold tracking-wide text-[#F5F1E8]">
            ترند<span className="text-[#D4AF37]">اسکوپ</span>
          </h1>
          <span
            dir="ltr"
            className="text-[11px] text-[#99958C] tracking-[0.2em] uppercase mt-1"
          >
            TrendScope Intelligence
          </span>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 py-6 px-3.5 space-y-1.5 overflow-y-auto scrollbar-thin">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-all duration-200 ${
                  isActive
                    ? 'bg-[#171717] text-[#D4AF37] border border-[#D4AF37]/25'
                    : 'text-[#99958C] hover:bg-[#171717]/60 hover:text-[#F5F1E8] border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    size={18}
                    className={isActive ? 'text-[#D4AF37]' : 'text-[#99958C]'}
                  />
                  <span className="font-medium text-sm">{item.label}</span>
                </div>

                <div className="flex items-center gap-2">
                  {typeof item.badge === 'number' && item.badge > 0 && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-mono ${
                        isActive
                          ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30'
                          : 'bg-[#080808] text-[#99958C] border border-[#D4AF37]/10'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                  {isActive && (
                    <ChevronLeft size={15} className="text-[#D4AF37]/70" />
                  )}
                </div>
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer Status & Logout */}
        <div className="p-4 border-t border-[#D4AF37]/15 bg-[#0c0c0c] flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-[#99958C]">
              <span>نسخه:</span>
              <span className="text-[#D4AF37] font-mono">v0.2.0</span>
            </div>
            <p className="text-[10px] text-[#99958C]/70 mt-0.5">
              متصل به Cloudflare D1
            </p>
          </div>
          <button
            onClick={handleLogout}
            title="خروج از حساب"
            className="p-2 rounded-lg bg-[#171717] border border-[#D4AF37]/20 text-[#99958C] hover:text-red-400 hover:border-red-500/40 transition-colors"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#080808]">
        {/* Top Header */}
        <header className="h-18 sm:h-20 border-b border-[#D4AF37]/15 flex items-center justify-between px-4 sm:px-8 bg-[#080808] shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2.5 rounded-lg bg-[#111111] border border-[#D4AF37]/20 text-[#F5F1E8] hover:border-[#D4AF37]/50"
              aria-label="باز کردن منو"
            >
              <Menu size={20} />
            </button>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-[#F5F1E8]">
                {navItems.find((i) => i.id === activeTab)?.label}
              </h2>
              <p className="text-xs text-[#99958C] hidden sm:block mt-0.5">
                پلتفرم پایش و دسته‌بندی هوشمند اخبار فناوری
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <button
              onClick={loadDashboardData}
              disabled={isLoading}
              title="بارگذاری مجدد داده‌ها"
              className="p-2 rounded-lg bg-[#111111] border border-[#D4AF37]/20 text-[#D4AF37] hover:bg-[#171717] transition-colors disabled:opacity-50"
            >
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            </button>

            <div className="flex items-center gap-2 bg-[#111111] px-3.5 py-2 rounded-full border border-[#D4AF37]/20">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs text-[#F5F1E8] font-medium hidden sm:inline">
                ربات تلگرام و ورکر آنلاین
              </span>
            </div>
          </div>
        </header>

        {/* Scrollable Page Workspace */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-8 scrollbar-thin">
          <div className="max-w-5xl mx-auto pb-12">
            {activeTab === 'overview' && (
              <OverviewPage
                totalCount={overview.totalCount || stories.length}
                approvedCount={overview.approvedCount || approvedStories.length}
                rejectedCount={rejectedCount}
                pendingCount={overview.pendingCount || generalStories.length}
                lastCollection={overview.lastCollectionTime || 'امروز ۰۶:۳۰'}
                onNavigate={setActiveTab}
              />
            )}

            {activeTab === 'general' && (
              <GeneralFeedPage
                stories={generalStories}
                minScore={settings.minScore}
                onDecision={handleStoryDecision}
              />
            )}

            {activeTab === 'news' && (
              <ApprovedNewsPage
                stories={approvedStories}
                onRemove={(id) => handleStoryDecision(id, 'rejected')}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsPage
                settings={settings}
                setSettings={setSettings}
                onManualRefresh={handleManualRefresh}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/* ============================================================================
   1. OVERVIEW PAGE (پیش‌خوان)
   ============================================================================ */
function OverviewPage({
  totalCount,
  approvedCount,
  rejectedCount,
  pendingCount,
  lastCollection,
  onNavigate
}: {
  totalCount: number;
  approvedCount: number;
  rejectedCount: number;
  pendingCount: number;
  lastCollection?: string;
  onNavigate: (tab: any) => void;
}) {
  const metrics = [
    {
      label: 'کل اخبار ثبت‌شده در دیتابیس',
      value: totalCount,
      sub: `شامل ${pendingCount} خبر در صف بررسی`,
      icon: Rss
    },
    {
      label: 'خبرهای تأیید شده',
      value: approvedCount,
      sub: 'منتشر شده در تاپیک اخبار (News)',
      icon: CheckCircle2
    },
    {
      label: 'خبرهای رد شده',
      value: rejectedCount,
      sub: 'خارج شده از چرخه انتشار',
      icon: XCircle
    },
    {
      label: 'آخرین پایش هوشمند',
      value: lastCollection || 'امروز ۰۶:۳۰',
      sub: 'به وقت تهران (Asia/Tehran)',
      icon: Clock
    }
  ];

  return (
    <div className="space-y-6">
      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m, idx) => {
          const Icon = m.icon;
          return (
            <div
              key={idx}
              className="bg-[#171717] border border-[#D4AF37]/15 rounded-xl p-5 hover:border-[#D4AF37]/35 transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#99958C] font-medium">
                  {m.label}
                </span>
                <div className="p-2 rounded-lg bg-[#111111] border border-[#D4AF37]/20 text-[#D4AF37]">
                  <Icon size={16} />
                </div>
              </div>
              <div className="text-2xl font-bold text-[#F5F1E8] mb-1">
                {m.value}
              </div>
              <div className="text-xs text-[#99958C]">{m.sub}</div>
            </div>
          );
        })}
      </div>

      {/* Schedule & Monitoring Status */}
      <div className="bg-[#171717] border border-[#D4AF37]/15 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2.5 text-[#D4AF37] mb-2">
            <RefreshCw size={18} />
            <h3 className="font-bold text-base text-[#F5F1E8]">
              زمان‌بندی و پایش هوشمند اخبار فناوری
            </h3>
          </div>
          <p className="text-xs text-[#99958C] leading-relaxed max-w-2xl">
            خزشگر هوشمند به طور پیوسته منابع برتر فناوری را رصد کرده و فقط اخبار کاملاً مرتبط با امتیاز بالای ۸.۵ را پس از تحلیل هوش مصنوعی وارد خبرخوان می‌کند.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="bg-[#111111] border border-[#D4AF37]/15 rounded-lg px-4 py-2.5 text-center">
            <div className="text-[11px] text-[#99958C]">وضعیت پایش</div>
            <div className="text-xs font-bold text-emerald-400 mt-0.5">
              خودکار و فعال
            </div>
          </div>
          <button
            onClick={() => onNavigate('general')}
            className="px-4 py-2.5 rounded-lg bg-[#D4AF37] text-[#080808] text-xs font-bold hover:bg-[#e3c04b] transition-colors"
          >
            مشاهده صف خبرخوان ({pendingCount})
          </button>
        </div>
      </div>

      {/* System & Telegram Bot Status */}
      <div className="bg-[#171717] border border-[#D4AF37]/15 rounded-xl p-6">
        <h3 className="font-bold text-base text-[#F5F1E8] mb-4">
          وضعیت زیرساخت و سرویس‌های TrendScope
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatusPill
            title="ربات تلگرام (@NewsTrendScope_bot)"
            status="متصل و آماده"
            detail="تاپیک‌های General, News, Report فعال"
            active
          />
          <StatusPill
            title="پایگاه داده Cloudflare D1"
            status="متصل"
            detail="همگام‌سازی بلادرنگ تأیید و رد اخبار"
            active
          />
          <StatusPill
            title="هوش مصنوعی Google Gemini"
            status="فعال (3.5 Flash Lite)"
            detail="تحلیل فکت‌محور و امتیازدهی فارسی"
            active
          />
        </div>
      </div>
    </div>
  );
}

function StatusPill({
  title,
  status,
  detail,
  active
}: {
  title: string;
  status: string;
  detail: string;
  active: boolean;
}) {
  return (
    <div className="bg-[#111111] border border-[#D4AF37]/15 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[#99958C]">{title}</span>
        <span
          className={`w-2 h-2 rounded-full ${
            active ? 'bg-emerald-500' : 'bg-red-500'
          }`}
        />
      </div>
      <div className="text-sm font-bold text-[#F5F1E8] mb-1">{status}</div>
      <div className="text-xs text-[#99958C]">{detail}</div>
    </div>
  );
}

/* ============================================================================
   2. GENERAL FEED PAGE (صف بررسی — تأیید / رد)
   ============================================================================ */
function GeneralFeedPage({
  stories,
  minScore,
  onDecision
}: {
  stories: DashboardStory[];
  minScore: number;
  onDecision: (id: string, decision: 'approved' | 'rejected') => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  const categories = useMemo(() => {
    return Array.from(new Set(stories.map((s) => s.category)));
  }, [stories]);

  const filteredStories = useMemo(() => {
    return stories.filter((story) => {
      const matchesCat =
        selectedCategory === 'all' || story.category === selectedCategory;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        story.persianTitle.toLowerCase().includes(q) ||
        story.englishTitle.toLowerCase().includes(q) ||
        story.publisher.toLowerCase().includes(q);
      return matchesCat && matchesSearch;
    });
  }, [stories, selectedCategory, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Info Banner & Filter Bar */}
      <div className="bg-[#111111] border border-[#D4AF37]/15 rounded-xl p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 text-xs text-[#99958C]">
          <span className="px-2.5 py-1 rounded bg-[#171717] border border-[#D4AF37]/25 text-[#D4AF37] font-mono font-bold">
            &gt; {minScore}
          </span>
          <span>
            فقط اخبار فناوری و رایانش با امتیاز بالاتر از {minScore} نمایش داده می‌شوند.
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Search Input */}
          <div className="relative">
            <Search
              size={15}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#99958C]"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="جستجو در عنوان یا منبع..."
              className="w-full sm:w-56 bg-[#171717] border border-[#D4AF37]/20 rounded-lg pr-9 pl-3 py-2 text-xs text-[#F5F1E8] placeholder-[#99958C] focus:outline-none focus:border-[#D4AF37]"
            />
          </div>

          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-[#171717] border border-[#D4AF37]/20 rounded-lg px-3 py-2 text-xs text-[#F5F1E8] focus:outline-none focus:border-[#D4AF37]"
          >
            <option value="all">همه دسته‌بندی‌ها ({stories.length})</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Story List */}
      {filteredStories.length === 0 ? (
        <EmptyBox
          title="خبری در صف بررسی وجود ندارد"
          subtitle="تمام اخبار واجد شرایط تأیید یا رد شده‌اند. با زدن دکمه پایش در تنظیمات می‌توانید اخبار جدید را خزش نمایید."
        />
      ) : (
        <div className="space-y-4">
          {filteredStories.map((story) => (
            <StoryCard
              key={story.id}
              story={story}
              mode="general"
              onApprove={() => onDecision(story.id, 'approved')}
              onReject={() => onDecision(story.id, 'rejected')}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   3. APPROVED NEWS PAGE (خبرها — همراه با امکان حذف و مدیریت)
   ============================================================================ */
function ApprovedNewsPage({
  stories,
  onRemove
}: {
  stories: DashboardStory[];
  onRemove: (id: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');

  const processedStories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = stories.filter((story) => {
      const matchesDate =
        dateFilter === 'all' || story.dateGroup === dateFilter;
      const matchesSearch =
        !q ||
        story.persianTitle.toLowerCase().includes(q) ||
        story.englishTitle.toLowerCase().includes(q) ||
        story.category.toLowerCase().includes(q) ||
        story.publisher.toLowerCase().includes(q);
      return matchesDate && matchesSearch;
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'score') return b.score - a.score;
      if (sortBy === 'oldest') return a.timestamp - b.timestamp;
      return b.timestamp - a.timestamp;
    });
  }, [stories, searchQuery, dateFilter, sortBy]);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="bg-[#111111] border border-[#D4AF37]/15 rounded-xl p-4 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs text-[#99958C]">
          <CheckCircle2 size={16} className="text-[#D4AF37]" />
          <span>
            بایگانی خبرهای تایید شده ({stories.length} خبر)
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search
              size={15}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#99958C]"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="جستجو در خبرهای تایید شده..."
              className="w-full sm:w-56 bg-[#171717] border border-[#D4AF37]/20 rounded-lg pr-9 pl-3 py-2 text-xs text-[#F5F1E8] placeholder-[#99958C] focus:outline-none focus:border-[#D4AF37]"
            />
          </div>

          {/* Date Filter */}
          <div className="flex items-center gap-1.5 bg-[#171717] border border-[#D4AF37]/20 rounded-lg px-2.5 py-1.5">
            <Filter size={14} className="text-[#99958C]" />
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="bg-transparent text-xs text-[#F5F1E8] focus:outline-none"
            >
              <option value="all" className="bg-[#171717]">همه زمان‌ها</option>
              <option value="today" className="bg-[#171717]">امروز</option>
              <option value="yesterday" className="bg-[#171717]">دیروز</option>
              <option value="week" className="bg-[#171717]">این هفته</option>
            </select>
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-[#171717] border border-[#D4AF37]/20 rounded-lg px-3 py-2 text-xs text-[#F5F1E8] focus:outline-none focus:border-[#D4AF37]"
          >
            <option value="newest">جدیدترین</option>
            <option value="score">بالاترین امتیاز</option>
            <option value="oldest">قدیمی‌ترین</option>
          </select>
        </div>
      </div>

      {processedStories.length === 0 ? (
        <EmptyBox
          title="هیچ خبر تایید شده‌ای یافت نشد"
          subtitle="با تایید اخبار از بخش خبرخوان یا تلگرام، خبرها در این بخش قرار می‌گیرند."
        />
      ) : (
        <div className="space-y-4">
          {processedStories.map((story) => (
            <StoryCard
              key={story.id}
              story={story}
              mode="news"
              onRemove={() => onRemove(story.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   4. SETTINGS PAGE (تنظیمات)
   ============================================================================ */
function SettingsPage({
  settings,
  setSettings,
  onManualRefresh
}: {
  settings: any;
  setSettings: React.Dispatch<React.SetStateAction<any>>;
  onManualRefresh: () => void;
}) {
  const [savedAlert, setSavedAlert] = useState(false);

  const toggleCategory = (cat: string) => {
    setSettings((prev: any) => {
      const exists = prev.enabledCategories.includes(cat);
      const updated = exists
        ? prev.enabledCategories.filter((c: string) => c !== cat)
        : [...prev.enabledCategories, cat];
      return { ...prev, enabledCategories: updated };
    });
  };

  const saveSettingsToServer = async () => {
    const token = localStorage.getItem('trendscope_token');
    try {
      await fetch('/api/dashboard/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(settings),
      });
      setSavedAlert(true);
      setTimeout(() => setSavedAlert(false), 3000);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-6">
      {savedAlert && (
        <div className="p-3.5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2">
          <CheckCircle2 size={16} />
          <span>تنظیمات با موفقیت ذخیره شد.</span>
        </div>
      )}

      {/* Collection & Scoring Rules */}
      <div className="bg-[#171717] border border-[#D4AF37]/15 rounded-xl p-6 space-y-6">
        <div className="border-b border-[#D4AF37]/15 pb-4">
          <h3 className="text-base font-bold text-[#F5F1E8]">
            پیکربندی پایش و فیلتر اخبار
          </h3>
          <p className="text-xs text-[#99958C] mt-1">
            تنظیمات هسته جمع‌آوری و آستانه امتیازدهی خبرهای فناوری
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Minimum Qualifying Score */}
          <div>
            <label className="block text-xs font-medium text-[#F5F1E8] mb-2">
              حداقل امتیاز مجاز برای ورود به خبرخوان (از ۱۰)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                step="0.1"
                min="7.0"
                max="9.9"
                value={settings.minScore}
                onChange={(e) =>
                  setSettings((prev: any) => ({
                    ...prev,
                    minScore: parseFloat(e.target.value) || 8.5
                  }))
                }
                className="w-28 bg-[#111111] border border-[#D4AF37]/25 rounded-lg px-3 py-2 text-sm text-[#D4AF37] font-mono font-bold focus:outline-none focus:border-[#D4AF37]"
              />
              <span className="text-xs text-[#99958C]">
                طبق الزامات v0.1.2، تنها اخبار با امتیاز بالاتر از ۸.۵ تأیید می‌شوند.
              </span>
            </div>
          </div>
        </div>

        {/* Enabled Categories */}
        <div>
          <label className="block text-xs font-medium text-[#F5F1E8] mb-2.5">
            دسته‌بندی‌های فعال (فقط حوزه فناوری و محاسبات)
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {ALL_CATEGORIES.map((cat) => {
              const isEnabled = settings.enabledCategories.includes(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className={`p-3 rounded-lg border text-xs font-medium flex items-center justify-between transition-colors ${
                    isEnabled
                      ? 'bg-[#111111] border-[#D4AF37]/40 text-[#F5F1E8]'
                      : 'bg-[#080808] border-[#D4AF37]/10 text-[#99958C] opacity-50'
                  }`}
                >
                  <span>{cat}</span>
                  <div
                    className={`w-4 h-4 rounded flex items-center justify-center ${
                      isEnabled ? 'bg-[#D4AF37] text-[#080808]' : 'bg-[#171717]'
                    }`}
                  >
                    {isEnabled && <Check size={11} />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={saveSettingsToServer}
          className="px-5 py-2.5 rounded-lg bg-[#D4AF37] text-[#080808] text-xs font-bold hover:bg-[#e4be45] transition-colors"
        >
          ذخیره تغییرات تنظیمات
        </button>
      </div>

      {/* Manual Trigger Section */}
      <div className="bg-[#171717] border border-[#D4AF37]/15 rounded-xl p-6">
        <h3 className="text-base font-bold text-[#F5F1E8] mb-1">
          خزش و پالایش دستی اخبار
        </h3>
        <p className="text-xs text-[#99958C] mb-4">
          اجرای فوری پایپ‌لاین جمع‌آوری، فیلترینگ و تحلیل Gemini بدون صبر برای کرون‌جاب ۱۲ ساعته
        </p>

        {settings.lastRefreshMessage && (
          <div className="mb-4 p-3.5 rounded-lg bg-[#111111] border border-[#D4AF37]/20 text-xs text-[#D4AF37] leading-relaxed">
            {settings.lastRefreshMessage}
          </div>
        )}

        <button
          onClick={onManualRefresh}
          className="px-5 py-2.5 rounded-lg bg-[#171717] border border-[#D4AF37]/40 text-[#D4AF37] text-xs font-bold hover:bg-[#D4AF37] hover:text-[#080808] transition-colors flex items-center gap-2"
        >
          <RefreshCw size={14} />
          <span>اجرای فوری جمع‌آوری اخبار</span>
        </button>
      </div>
    </div>
  );
}

/* ============================================================================
   6. STORY CARD COMPONENT
   ============================================================================ */
function StoryCard({
  story,
  mode = 'readonly',
  onApprove,
  onReject,
  onRemove
}: {
  story: DashboardStory;
  mode?: 'general' | 'news' | 'readonly';
  onApprove?: () => void;
  onReject?: () => void;
  onRemove?: () => void;
}) {
  return (
    <article className="bg-[#171717] border border-[#D4AF37]/15 rounded-xl p-5 sm:p-6 hover:border-[#D4AF37]/35 transition-colors">
      {/* Top Meta Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <span className="px-2.5 py-1 rounded-md bg-[#111111] border border-[#D4AF37]/35 text-[#D4AF37] font-mono font-bold text-sm">
            {story.score ? story.score.toFixed(1) : '0.0'}
            <span className="text-[11px] text-[#99958C] font-normal"> / 10</span>
          </span>
          <span className="px-2.5 py-1 rounded-md bg-[#111111] border border-[#D4AF37]/10 text-xs text-[#99958C]">
            {story.category}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs text-[#99958C]">
          <span className="text-[#F5F1E8] font-medium">{story.publisher}</span>
          <span>•</span>
          <span>{story.publishedAt}</span>
        </div>
      </div>

      {/* Headlines & Persian Summary */}
      <div className="space-y-2.5 mb-5">
        <h3 className="text-base sm:text-lg font-bold text-[#F5F1E8] leading-relaxed font-heading">
          {story.persianTitle}
        </h3>

        {story.englishTitle && (
          <p
            dir="ltr"
            className="text-xs sm:text-sm text-[#99958C] font-mono text-left border-l-2 border-[#D4AF37]/35 pl-3 py-0.5"
          >
            {story.englishTitle}
          </p>
        )}

        <p className="text-xs sm:text-sm text-[#F5F1E8]/85 leading-7 pt-1 font-body">
          {story.summary}
        </p>
      </div>

      {/* Footer: Sources + Action Buttons */}
      <div className="pt-4 border-t border-[#D4AF37]/15 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Source Links */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[#99958C] ml-1">منابع:</span>
          {story.sources && story.sources.length > 0 ? (
            story.sources.map((src, idx) => (
              <a
                key={idx}
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111111] border border-[#D4AF37]/20 text-xs text-[#F5F1E8] hover:border-[#D4AF37] hover:text-[#D4AF37] transition-colors"
              >
                <span>{src.label || 'منبع خبر'}</span>
                <ExternalLink size={12} />
              </a>
            ))
          ) : (
            <span className="text-xs text-[#99958C]">منبع مستقیم موجود نیست</span>
          )}
        </div>

        {/* Action Buttons in General Feed */}
        {mode === 'general' && (
          <div className="flex items-center gap-2.5 self-end sm:self-auto">
            <button
              onClick={onReject}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#111111] border border-red-500/25 text-red-400 text-xs font-bold hover:bg-red-500/10 hover:border-red-500/45 transition-colors"
            >
              <X size={15} />
              <span>رد</span>
            </button>
            <button
              onClick={onApprove}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#D4AF37] text-[#080808] text-xs font-bold hover:bg-[#e5c14a] transition-colors"
            >
              <Check size={15} />
              <span>تأیید</span>
            </button>
          </div>
        )}

        {/* Delete / Remove Button in News Feed */}
        {mode === 'news' && onRemove && (
          <div className="flex items-center self-end sm:self-auto">
            <button
              onClick={onRemove}
              title="حذف از خبرهای تأییدشده"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#111111] border border-red-500/30 text-red-400 text-xs font-medium hover:bg-red-500/15 hover:border-red-500/60 transition-colors"
            >
              <Trash2 size={13} />
              <span>حذف از خبرها</span>
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function EmptyBox({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="bg-[#111111] border border-[#D4AF37]/15 rounded-xl p-12 text-center flex flex-col items-center justify-center">
      <div className="w-12 h-12 rounded-full bg-[#171717] border border-[#D4AF37]/20 flex items-center justify-center text-[#D4AF37] mb-4">
        <Info size={22} />
      </div>
      <h4 className="text-sm font-bold text-[#F5F1E8] mb-1">{title}</h4>
      <p className="text-xs text-[#99958C] max-w-sm leading-relaxed">{subtitle}</p>
    </div>
  );
}
