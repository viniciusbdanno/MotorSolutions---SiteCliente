import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  CheckCircle2,
  ChevronRight,
  FileText,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Thermometer,
  Users,
  X,
} from 'lucide-react';
import './styles.css';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/motors', label: 'Motores', icon: Gauge },
  { to: '/history', label: 'Historico', icon: BarChart3 },
  { to: '/alerts', label: 'Alertas', icon: Bell },
  { to: '/reports', label: 'Relatorios', icon: FileText },
  { to: '/users', label: 'Usuarios', icon: Users },
  { to: '/settings', label: 'Configuracoes', icon: Settings },
];

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

function authHeaders() {
  try {
    const stored = JSON.parse(localStorage.getItem('ms-session'));
    return stored?.accessToken ? { Authorization: `Bearer ${stored.accessToken}` } : {};
  } catch {
    return {};
  }
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  if (response.status === 401 && !path.startsWith('/auth/login')) {
    // Sessão expirada ou inválida: volta para o login.
    localStorage.removeItem('ms-session');
    window.location.assign('/login');
  }
  if (!response.ok) {
    let detail = `Falha ao carregar dados (${response.status})`;
    try {
      const body = await response.json();
      if (body.detail) detail = body.detail;
    } catch {
      // Mantém a mensagem HTTP quando a resposta não é JSON.
    }
    throw new Error(detail);
  }
  return response.json();
}

function metricValue(metrics, names, fallback = null) {
  const metric = metrics.find((item) => names.includes(item.name));
  return metric ? Number(metric.value) : fallback;
}

function mapMotor(code, latest) {
  const rpm = metricValue(latest, ['rpm', 'rotacao']);
  const vibration = metricValue(latest, ['vibracao', 'vibration_g', 'vibration']);
  const temperature = metricValue(latest, ['temperatura', 'temperature_c', 'temperature']);
  const status = vibration === null || temperature === null || rpm === null ? 'unknown' : vibration >= 1 || temperature >= 80 ? 'critical' : vibration >= 0.7 || temperature >= 70 ? 'attention' : 'ok';
  return { id: code, name: code, sector: 'Dispositivo ESP32', status, rpm, vibration, temperature };
}

function buildAlerts(motors) {
  return motors
    .filter((motor) => motor.status === 'critical' || motor.status === 'attention')
    .map((motor) => ({
      id: motor.id,
      motor: motor.id,
      title: motor.temperature >= 80 ? 'Temperatura acima do limite' : 'Vibracao acima do limite',
      severity: motor.status === 'critical' ? 'critical' : 'warning',
      time: 'Ultima leitura',
    }));
}

function useTelemetry() {
  const [motors, setMotors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const devices = await fetchJson('/devices');
      const latest = await Promise.all(devices.map(async (device) => [device, await fetchJson(`/devices/${encodeURIComponent(device)}/latest`)]));
      setMotors(latest.map(([device, metrics]) => mapMotor(device, metrics)));
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 5000);
    return () => window.clearInterval(interval);
  }, []);

  return { motors, loading, error, refresh: load };
}

function useClientes() {
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setClientes(await fetchJson('/clientes'));
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return { clientes, setClientes, loading, error, refresh: load };
}

function App() {
  const [session, setSession] = useState(() => {
    try {
      const stored = localStorage.getItem('ms-session');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (session && (!session.accessToken || session.authVersion !== 2)) {
      localStorage.removeItem('ms-session');
      setSession(null);
    }
  }, [session]);

  const handleLogin = (user) => {
    const cliente = user.cliente;
    const payload = {
      id: cliente.id_cliente,
      name: cliente.nome,
      email: cliente.email,
      role: ['ceo', 'admin', 'gestor'].includes(cliente.cargo.toLowerCase()) ? 'admin' : 'operator',
      company: cliente.empresa,
      cargo: cliente.cargo,
      emailAlertsEnabled: cliente.email_alerts_enabled,
      accessToken: user.access_token,
      authVersion: 2,
    };
    localStorage.setItem('ms-session', JSON.stringify(payload));
    setSession(payload);
  };

  const handleLogout = () => {
    localStorage.removeItem('ms-session');
    setSession(null);
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
        <Route path="/" element={<Navigate to={session ? '/dashboard' : '/login'} replace />} />

        <Route element={<ProtectedLayout session={session} onLogout={handleLogout} />}>
          <Route path="/dashboard" element={<DashboardPage session={session} />} />
          <Route path="/motors" element={<MotorsPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/users" element={<UsersPage session={session} />} />
          <Route path="/settings" element={<SettingsPage session={session} onSessionUpdate={setSession} />} />
        </Route>

        <Route path="*" element={<Navigate to={session ? '/dashboard' : '/login'} replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function ProtectedLayout({ session, onLogout }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!session) {
      navigate('/login', { replace: true });
    }
  }, [session, navigate]);

  const currentLabel = navItems.find((item) => item.to === location.pathname)?.label || 'Dashboard';

  return (
    <div className="app-shell">
      <aside className={`sidebar ${drawerOpen ? 'open' : ''}`}>
        <div className="brand-row">
          <img className="brand-logo" src="/imagem/Logo.png" alt="MotorSolutions" />
          <button className="icon-button desktop-hidden" onClick={() => setDrawerOpen(false)} aria-label="Fechar menu">
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/dashboard'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setDrawerOpen(false)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="profile-box">
            <div className="avatar">{(session?.name || 'Cliente').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</div>
            <div>
              <strong>{session?.name || 'Marina Costa'}</strong>
              <small>{session?.company || 'Alfa Industrial'}</small>
            </div>
          </div>

          <button className="logout-button" onClick={onLogout}>
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      {drawerOpen && <button className="drawer-overlay" onClick={() => setDrawerOpen(false)} aria-label="Fechar menu" />}

      <div className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-only" onClick={() => setDrawerOpen(true)} aria-label="Abrir menu">
              <Menu size={20} />
            </button>
            <div className="topbar-breadcrumb">
              <span>MotorSolutions</span>
              <ChevronRight size={14} />
              <strong>{currentLabel}</strong>
            </div>
          </div>

          <div className="topbar-actions">
            <div className="live-indicator">
              <span className="live-dot" />
              Sistema ao vivo
            </div>
            <button className="icon-button" aria-label="Notificacoes" onClick={() => navigate('/alerts')}>
              <Bell size={18} />
            </button>
            <div className="top-avatar">{(session?.name || 'Cliente').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</div>
          </div>
        </header>

        <main className="content-area">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function LoginPage({ onLogin }) {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const session = await fetchJson('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha: password }),
      });
      onLogin(session);
      navigate('/dashboard');
    } catch (requestError) {
      setError('E-mail ou senha incorretos.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-art">
        <img className="login-black-logo" src="/imagem/Logo%20Preta.png" alt="MotorSolutions" />
        <div className="login-copy">
          <p className="eyebrow tiny">INTELIGENCIA OPERACIONAL</p>
          <h1>O pulso da sua operacao, em tempo real.</h1>
          <p>Antecipe falhas. Mantenha cada motor no ritmo certo.</p>
        </div>
      </div>

      <div className="login-panel">
        <div className="login-card">
          <p className="eyebrow tiny dark">PORTAL DO CLIENTE</p>
          <h2>Bem-vindo de volta</h2>
          <p className="login-subtitle">Entre para acompanhar sua operacao.</p>

          <form onSubmit={handleSubmit} className="login-form">
            <label>
              E-mail corporativo
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>

            <label>
              Senha
              <div className="password-field">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button type="button" className="password-toggle" onClick={() => setShowPassword((prev) => !prev)}>{showPassword ? 'Ocultar' : 'Mostrar'}</button>
              </div>
            </label>

            <div className="login-inline">
              <label className="checkbox-wrap"><input type="checkbox" defaultChecked /><span>Lembrar de mim</span></label>
              <button type="button" className="link-btn" onClick={() => setError('Solicite a redefinicao de senha ao administrador da conta.')}>Esqueci minha senha</button>
            </div>

            {error && <p className="form-error">{error}</p>}

            <button type="submit" className="primary-btn" disabled={loading}>
              {loading ? 'Validando...' : 'Acessar portal'}
              <ChevronRight size={16} />
            </button>
          </form>

          <div className="security-pill">
            <ShieldCheck size={15} />
            Ambiente seguro e monitorado
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardPage({ session }) {
  const navigate = useNavigate();
  const { motors, loading, error, refresh } = useTelemetry();
  const total = motors.length;
  const critical = motors.filter((motor) => motor.status === 'critical').length;
  const attention = motors.filter((motor) => motor.status !== 'ok').length;
  const healthy = motors.filter((motor) => motor.status === 'ok').length;
  const recentAlerts = buildAlerts(motors);

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow small">MONITORAMENTO DOS SENSORES ESP32</p>
          <h1>Bom dia, {session?.name || 'Cliente'}</h1>
          <p className="page-subtitle">Aqui esta o pulso da sua operacao.</p>
        </div>
        <button className="secondary-btn" onClick={() => navigate('/reports')}><FileText size={16} />Gerar relatorio</button>
      </div>

      <div className="status-bubble">
        <div className="status-copy"><span className="live-dot" />{motors.length ? 'Monitoramento em tempo real' : 'Aguardando conexão com o ESP32'}</div>
        <span>{motors.length ? 'Ultima sincronizacao: agora' : 'Sem leituras recebidas'}</span>
      </div>

      <div className="metric-grid">
        <MetricCard icon={Gauge} label="Motores monitorados" value={total || 'Sem informações'} meta={total ? 'Dados recebidos' : 'Aguardando sensores'} tone="blue" />
        <MetricCard icon={AlertTriangle} label="Precisam de atencao" value={attention} meta={`${critical} critico(s)`} tone="amber" />
        <MetricCard icon={CheckCircle2} label="Operando normalmente" value={healthy} meta={total ? `${Math.round((healthy / total) * 100)}% da operacao` : 'Sem leituras'} tone="green" />
      </div>

      <div className="section-head">
        <div>
          <h2>Saude da frota</h2>
          <p>Visao rapida dos motores mais relevantes.</p>
        </div>
        <button className="link-btn" onClick={() => navigate('/motors')}>Ver todos <ChevronRight size={14} /></button>
      </div>

      {error ? <div className="empty-state"><h3>Falha ao carregar telemetria</h3><p>{error}</p><button className="secondary-btn small-btn" onClick={refresh}>Tentar novamente</button></div> : null}
      {loading && !motors.length ? <div className="empty-state"><h3>Carregando leituras dos sensores...</h3></div> : null}
      {!loading && !error && !motors.length ? <div className="empty-state"><h3>Nenhum sensor cadastrado</h3><p>Quando o ESP32 enviar a primeira leitura, o motor aparecerá aqui.</p></div> : null}
      <div className="cards-grid dashboard-cards">
        {motors.slice(0, 3).map((motor) => <MotorCard key={motor.id} motor={motor} />)}
      </div>

      <div className="lower-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Performance media</h3>
              <small>Vibracao · ultimas 24 horas</small>
            </div>
            <select defaultValue="24h">
              <option value="24h">Ultimas 24h</option>
              <option value="7d">Ultimos 7 dias</option>
              <option value="30d">Ultimos 30 dias</option>
            </select>
          </div>
          <div className="sparkline-box"><span>{motors.length ? 'Dados reais disponíveis no Histórico' : 'Sem informações'}</span></div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Alertas recentes</h3>
              <small>Eventos que pedem atencao</small>
            </div>
            <button className="icon-button small-button" aria-label="Ver alertas" onClick={() => navigate('/alerts')}><ChevronRight size={16} /></button>
          </div>

          <div className="alert-list">
            {recentAlerts.length ? recentAlerts.map((alert) => (
              <div className="alert-item" key={alert.id}>
                <span className={`alert-dot ${alert.severity}`} />
                <div>
                  <strong>{alert.title}</strong>
                  <small>{alert.motor}</small>
                </div>
                <time>{alert.time}</time>
              </div>
            )) : <div className="empty-state compact-empty"><p>Sem informações de alertas.</p></div>}
          </div>
        </div>
      </div>
    </>
  );
}

function MetricCard({ icon: Icon, label, value, meta, tone }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone}`}><Icon size={20} /></div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{meta}</small>
      </div>
    </div>
  );
}

function MotorCard({ motor }) {
  const statusLabel = motor.status === 'ok' ? 'Normal' : motor.status === 'attention' ? 'Atencao' : motor.status === 'critical' ? 'Critico' : 'Sem leitura';
  return (
    <div className="motor-card">
      <div className="motor-topline">
        <span className="motor-badge">{motor.id}</span>
        <span className={`status-pill ${motor.status}`}>{statusLabel}</span>
      </div>
      <h3>{motor.name}</h3>
      <p>{motor.sector}</p>
      <div className="motor-metrics">
        <div><Gauge size={14} /><strong>{motor.rpm ?? 'Sem informações'}</strong><small>RPM</small></div>
        <div><Thermometer size={14} /><strong>{motor.temperature === null ? 'Sem informações' : `${motor.temperature}°`}</strong><small>Temp</small></div>
        <div><Activity size={14} /><strong>{motor.vibration === null ? 'Sem informações' : motor.vibration.toFixed(2)}</strong><small>g</small></div>
      </div>
    </div>
  );
}

function MotorsPage() {
  const { motors, loading, error } = useTelemetry();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [manualMotors, setManualMotors] = useState(() => {
    try {
      const stored = localStorage.getItem('ms-manual-motors');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    document.body.classList.toggle('modal-open', showAddForm);
    return () => document.body.classList.remove('modal-open');
  }, [showAddForm]);
  const [form, setForm] = useState({
    name: '',
    id: '',
    sector: '',
    vibrationMin: '',
    vibrationMax: '',
    rpmMin: '',
    rpmMax: '',
    temperatureMin: '',
    temperatureMax: '',
  });

  const allMotors = useMemo(() => [...motors, ...manualMotors], [motors, manualMotors]);

  const filtered = useMemo(() => {
    return allMotors.filter((motor) => {
      const matchesQuery = `${motor.name} ${motor.id} ${motor.sector}`.toLowerCase().includes(query.toLowerCase());
      const matchesStatus = status === 'all' || motor.status === status;
      return matchesQuery && matchesStatus;
    });
  }, [allMotors, query, status]);

  useEffect(() => {
    localStorage.setItem('ms-manual-motors', JSON.stringify(manualMotors));
  }, [manualMotors]);

  useEffect(() => {
    if (!filtered.some((motor) => motor.id === selectedId)) {
      setSelectedId((filtered[0] || allMotors[0])?.id || '');
    }
  }, [filtered, allMotors, selectedId]);

  const activeMotor = filtered.find((motor) => motor.id === selectedId) || filtered[0] || allMotors[0];

  const handleFieldChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSaveManualMotor = (event) => {
    event.preventDefault();

    const normalizedName = form.name.trim() || 'Motor manual';
    const normalizedId = (form.id || `M-${Date.now().toString().slice(-4)}`).trim();
    const normalizedSector = form.sector.trim() || 'Setor nao informado';

    const newMotor = {
      id: normalizedId,
      name: normalizedName,
      sector: normalizedSector,
      status: 'attention',
      rpm: Number(form.rpmMin) || 0,
      vibration: Number(form.vibrationMin) || 0,
      temperature: Number(form.temperatureMin) || 0,
      manual: true,
      limits: {
        vibrationMin: Number(form.vibrationMin) || 0,
        vibrationMax: Number(form.vibrationMax) || 0,
        rpmMin: Number(form.rpmMin) || 0,
        rpmMax: Number(form.rpmMax) || 0,
        temperatureMin: Number(form.temperatureMin) || 0,
        temperatureMax: Number(form.temperatureMax) || 0,
      },
    };

    setManualMotors((current) => [newMotor, ...current]);
    setSelectedId(newMotor.id);
    setForm({
      name: '',
      id: '',
      sector: '',
      vibrationMin: '',
      vibrationMax: '',
      rpmMin: '',
      rpmMax: '',
      temperatureMin: '',
      temperatureMax: '',
    });
    setShowAddForm(false);
  };

  const exportMotors = () => {
    if (!allMotors.length) return;
    const rows = allMotors.map((motor) => [motor.id, motor.rpm ?? '', motor.vibration ?? '', motor.temperature ?? '']);
    const csv = ['motor_id,rpm,vibration_g,temperature_c', ...rows.map((row) => row.join(','))].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = 'motores.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <>
      <div className="page-header compact">
        <div>
          <p className="eyebrow small">ATIVOS MONITORADOS</p>
          <h1>Seus motores</h1>
          <p className="page-subtitle">Acompanhe o estado de cada ativo em sua operacao.</p>
        </div>
        <div className="header-actions">
          <button type="button" className="secondary-btn small-btn" onClick={() => setShowAddForm(true)}>Adicionar motor manual</button>
          <button className="primary-btn small-btn" onClick={exportMotors}><FileText size={15} />Exportar</button>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar motor, codigo ou setor" />
        </div>

        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">Todos os status</option>
          <option value="ok">Normal</option>
          <option value="attention">Atencao</option>
          <option value="critical">Critico</option>
        </select>
      </div>

      {error && <div className="empty-state compact-empty"><h3>Falha ao carregar telemetria</h3><p>{error}</p></div>}
      {loading && !allMotors.length && <div className="empty-state compact-empty"><h3>Carregando leituras dos sensores...</h3></div>}

      {showAddForm && (
        <div className="modal-backdrop" onClick={() => setShowAddForm(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow small">NOVO MOTOR</p>
                <h3>Adicionar motor manual</h3>
              </div>
              <button type="button" className="icon-button small-button" onClick={() => setShowAddForm(false)} aria-label="Fechar">
                <X size={16} />
              </button>
            </div>

            <form className="manual-form" onSubmit={handleSaveManualMotor}>
              <div className="modal-form-grid">
                <label>
                  Nome do motor
                  <input name="name" value={form.name} onChange={handleFieldChange} placeholder="Ex.: Motor de resfriamento" required />
                </label>
                <label>
                  Codigo
                  <input name="id" value={form.id} onChange={handleFieldChange} placeholder="Ex.: MX-440" />
                </label>
                <label className="full-width">
                  Setor
                  <input name="sector" value={form.sector} onChange={handleFieldChange} placeholder="Ex.: Linha de embalagem" required />
                </label>
              </div>

              <div className="limit-section">
                <h4>Limites de vibracao</h4>
                <div className="limit-grid">
                  <label>
                    Minima
                    <input name="vibrationMin" type="number" step="0.01" min="0" value={form.vibrationMin} onChange={handleFieldChange} required />
                  </label>
                  <label>
                    Maxima
                    <input name="vibrationMax" type="number" step="0.01" min="0" value={form.vibrationMax} onChange={handleFieldChange} required />
                  </label>
                </div>
              </div>

              <div className="limit-section">
                <h4>Limites de RPM</h4>
                <div className="limit-grid">
                  <label>
                    Minimo
                    <input name="rpmMin" type="number" min="0" value={form.rpmMin} onChange={handleFieldChange} required />
                  </label>
                  <label>
                    Maximo
                    <input name="rpmMax" type="number" min="0" value={form.rpmMax} onChange={handleFieldChange} required />
                  </label>
                </div>
              </div>

              <div className="limit-section">
                <h4>Limites de temperatura</h4>
                <div className="limit-grid">
                  <label>
                    Minima
                    <input name="temperatureMin" type="number" min="0" value={form.temperatureMin} onChange={handleFieldChange} required />
                  </label>
                  <label>
                    Maxima
                    <input name="temperatureMax" type="number" min="0" value={form.temperatureMax} onChange={handleFieldChange} required />
                  </label>
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="secondary-btn small-btn" onClick={() => setShowAddForm(false)}>Cancelar</button>
                <button type="submit" className="primary-btn small-btn">Salvar motor</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="motors-layout">
        <div className="cards-grid motor-grid">
          {filtered.length === 0 ? (
            <div className="empty-state compact-empty">
              <h3>Nenhum motor encontrado</h3>
              <p>Experimente outro termo de busca ou adicione um motor manualmente.</p>
            </div>
          ) : (
            filtered.map((motor) => (
              <button
                key={motor.id}
                type="button"
                className={`motor-card ${activeMotor?.id === motor.id ? 'selected' : ''}`}
                onClick={() => setSelectedId(motor.id)}
              >
                <div className="motor-topline">
                  <span className="motor-badge">{motor.id}</span>
                  <span className={`status-pill ${motor.status}`}>{motor.status === 'ok' ? 'Normal' : motor.status === 'attention' ? 'Atencao' : motor.status === 'critical' ? 'Critico' : 'Sem leitura'}</span>
                </div>
                <h3>{motor.name}</h3>
                <p>{motor.sector}</p>
                <div className="motor-metrics">
                  <div><Gauge size={14} /><strong>{motor.rpm}</strong><small>RPM</small></div>
                  <div><Thermometer size={14} /><strong>{motor.temperature}°</strong><small>Temp</small></div>
                  <div><Activity size={14} /><strong>{motor.vibration.toFixed(2)}</strong><small>g</small></div>
                </div>
              </button>
            ))
          )}
        </div>

        {activeMotor && (
          <div className="detail-panel">
            <div className="detail-header">
              <div>
                <p className="eyebrow small">MOTOR EM FOCO</p>
                <h2>{activeMotor.name}</h2>
              </div>
              <span className={`status-pill ${activeMotor.status}`}>{activeMotor.status === 'ok' ? 'Normal' : activeMotor.status === 'attention' ? 'Atencao' : activeMotor.status === 'critical' ? 'Critico' : 'Sem leitura'}</span>
            </div>

            <div className="detail-stats">
              <div><label>RPM</label><strong>{activeMotor.rpm ?? 'Sem informações'}</strong></div>
              <div><label>Vibracao</label><strong>{activeMotor.vibration === null ? 'Sem informações' : `${activeMotor.vibration.toFixed(2)} g`}</strong></div>
              <div><label>Temperatura</label><strong>{activeMotor.temperature === null ? 'Sem informações' : `${activeMotor.temperature}°C`}</strong></div>
            </div>

            {activeMotor.manual && activeMotor.limits && (
              <div className="manual-limits-box">
                <h3>Limites configurados</h3>
                <div className="manual-limits-grid">
                  <div><span>Vibracao min/max</span><strong>{activeMotor.limits.vibrationMin} / {activeMotor.limits.vibrationMax} g</strong></div>
                  <div><span>RPM min/max</span><strong>{activeMotor.limits.rpmMin} / {activeMotor.limits.rpmMax}</strong></div>
                  <div><span>Temp min/max</span><strong>{activeMotor.limits.temperatureMin} / {activeMotor.limits.temperatureMax}°C</strong></div>
                </div>
              </div>
            )}

            <div className="mini-chart">
              <span>Sem informações históricas</span>
            </div>

            <div className="timeline-box">
              <h3>Ultimos alertas</h3>
              <p>Sem informações de alertas.</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function HistoryPage() {
  const [range, setRange] = useState('30d');
  const [hovered, setHovered] = useState(null);
  const { motors } = useTelemetry();
  const [device, setDevice] = useState('');
  const [events, setEvents] = useState([]);

  useEffect(() => {
    if (!device && motors[0]) setDevice(motors[0].id);
  }, [motors, device]);

  useEffect(() => {
    if (!device) return;
    // A API agrupa as leituras (1/s) em intervalos para o gráfico caber no período escolhido.
    const days = Number.parseInt(range, 10);
    const bucketMinutes = days <= 7 ? 10 : days <= 30 ? 60 : 180;
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    fetchJson(`/devices/${encodeURIComponent(device)}/telemetry?bucket_minutes=${bucketMinutes}&start=${encodeURIComponent(start)}&limit=5000`)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [device, range]);

  const selected = useMemo(() => {
    const cutoff = Date.now() - Number.parseInt(range, 10) * 24 * 60 * 60 * 1000;
    const points = events.filter((event) => new Date(event.captured_at).getTime() >= cutoff).reverse();
    const values = (names) => points.map((event) => metricValue(event.metrics, names));
    return {
      labels: points.map((event) => new Date(event.captured_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })),
      vibration: values(['vibracao', 'vibration_g', 'vibration']),
      rpm: values(['rpm', 'rotacao']),
      temperature: values(['temperatura', 'temperature_c', 'temperature']),
    };
  }, [events, range]);

  const renderChart = (title, values, unit, colorClass, legend) => {
    const width = 540;
    const height = 210;
    const padding = 18;
    const chartValues = values.length ? values : [0];
    const chartLabels = selected.labels.length ? selected.labels : ['-'];
    const min = Math.min(...chartValues);
    const max = Math.max(...chartValues);
    const spread = max - min || 1;

    const points = chartValues.map((value, index) => {
      const x = padding + (index / Math.max(values.length - 1, 1)) * (width - padding * 2);
      const y = height - padding - ((value - min) / spread) * (height - padding * 2);
      return { x, y, value, label: chartLabels[index] };
    });

    const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
    const areaPath = `${path} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;
    const currentHover = hovered?.key === title ? hovered : null;
    const displayStep = range === '7d' ? 1 : range === '30d' ? 3 : 9;
    const visibleLabelIndexes = chartLabels.map((_, index) => index).filter((index) => index % displayStep === 0 || index === chartLabels.length - 1);

    return (
      <div className="panel history-chart-card" key={title}>
        <div className="panel-header chart-header">
          <div>
            <h3>{title}</h3>
            <small>{range === '7d' ? '7 dias' : range === '30d' ? '30 dias' : '90 dias'}</small>
          </div>
          <span className={`metric-badge ${colorClass}`}>{legend}</span>
        </div>

        <div className="chart-shell">
          <div className="chart-scale">
            <span>{max}{unit}</span>
            <span>{Math.round((max + min) / 2)}{unit}</span>
            <span>{min}{unit}</span>
          </div>

          <div className="chart-body">
            {!values.length ? <span>Sem informações históricas</span> : <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="metric-chart-svg">
              <defs>
                <linearGradient id={`fill-${title}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              <path d={areaPath} className={`area-fill ${colorClass}`} />
              <path d={path} className={colorClass} />

              {points.map((point, index) => (
                <g key={`${title}-${point.label}`}>
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={currentHover?.index === index ? 5.5 : 3.5}
                    className={colorClass}
                    onMouseEnter={() => setHovered({ key: title, index })}
                    onMouseLeave={() => setHovered(null)}
                  />

                  {currentHover?.index === index && (
                    <g transform={`translate(${point.x}, ${point.y - 18})`}>
                      <rect x={-44} y={-34} width={88} height={28} rx={8} className="chart-tooltip" />
                      <text x="0" y={-14} textAnchor="middle" className="chart-tooltip-text">
                        {point.label} · {point.value}{unit}
                      </text>
                    </g>
                  )}
                </g>
              ))}

              {visibleLabelIndexes.map((index) => {
                const point = points[index];
                return (
                  <text
                    key={`${title}-axis-${point.label}`}
                    x={point.x}
                    y={height - 4}
                    textAnchor="middle"
                    className="chart-x-label"
                    fontSize={range === '90d' ? 7 : range === '30d' ? 8 : 9}
                  >
                    {point.label}
                  </text>
                );
              })}
            </svg>}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="page-header compact">
        <div>
          <p className="eyebrow small">HISTORICO</p>
          <h1>Desempenho e tendencias</h1>
          <p className="page-subtitle">Analise de vibracao, temperatura e rotacao ao longo do tempo.</p>
        </div>

        <div className="history-controls">
          <select value={device} onChange={(event) => setDevice(event.target.value)} disabled={!motors.length}>
            {!motors.length && <option value="">Nenhum sensor</option>}
            {motors.map((motor) => <option key={motor.id} value={motor.id}>{motor.id}</option>)}
          </select>
          <select value={range} onChange={(event) => setRange(event.target.value)}>
            <option value="7d">Ultimos 7 dias</option>
            <option value="30d">Ultimos 30 dias</option>
            <option value="90d">Ultimos 90 dias</option>
          </select>
        </div>
      </div>

      <div className="history-panel-grid">
        {renderChart('Vibracao', selected.vibration, ' g', 'line-blue', 'Vibracao')}
        {renderChart('RPM', selected.rpm, '', 'line-cyan', 'RPM')}
        {renderChart('Temperatura', selected.temperature, '°C', 'line-amber', 'Temp')}
      </div>

      <div className="stats-vertical history-summary-grid">
        <div className="mini-stat-box"><span>RPM media</span><strong>{selected.rpm.length ? Math.round(selected.rpm.reduce((sum, value) => sum + value, 0) / selected.rpm.length).toLocaleString('pt-BR') : '-'}</strong><small>Dados reais do sensor</small></div>
        <div className="mini-stat-box"><span>Temperatura</span><strong>{selected.temperature.length ? `${selected.temperature[selected.temperature.length - 1]}°C` : '-'}</strong><small>Ultima leitura recebida</small></div>
        <div className="mini-stat-box"><span>Vibracao</span><strong>{selected.vibration.length ? `${selected.vibration[selected.vibration.length - 1].toFixed(2)} g` : '-'}</strong><small>Ultima leitura recebida</small></div>
      </div>
    </>
  );
}

function AlertsPage() {
  const { motors, loading, error } = useTelemetry();
  const [readAlerts, setReadAlerts] = useState([]);
  const currentAlerts = buildAlerts(motors).filter((alert) => !readAlerts.includes(alert.id));

  return (
    <>
      <div className="page-header compact">
        <div>
          <p className="eyebrow small">ALERTAS</p>
          <h1>Eventos e anomalias</h1>
          <p className="page-subtitle">Lista cronologica de anomalias por motor e severidade.</p>
        </div>
      </div>

      <div className="alert-table">
        <div className="alert-row header-row">
          <span>Motor</span>
          <span>Tipo</span>
          <span>Severidade</span>
          <span>Horario</span>
          <span>Status</span>
        </div>

        {currentAlerts.map((alert) => (
          <div className="alert-row" key={alert.id}>
            <span>{alert.motor}</span>
            <span>{alert.title}</span>
            <span><b className={`severity ${alert.severity}`}>{alert.severity === 'critical' ? 'Critica' : alert.severity === 'warning' ? 'Atencao' : 'Normal'}</b></span>
            <span>{alert.time}</span>
            <span><button className="mini-action" onClick={() => setReadAlerts((current) => [...current, alert.id])}>Marcar como lido</button></span>
          </div>
        ))}
        {!loading && !error && !currentAlerts.length && <div className="empty-state compact-empty"><p>Sem informações de alertas.</p></div>}
        {loading && <div className="empty-state compact-empty"><p>Carregando informações...</p></div>}
        {error && <div className="empty-state compact-empty"><p>Não foi possível carregar os alertas.</p></div>}
      </div>
    </>
  );
}

function ReportsPage() {
  const { motors } = useTelemetry();
  const [motorId, setMotorId] = useState('all');
  const [period, setPeriod] = useState('24h');
  const [events, setEvents] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (motorId === 'all' && motors[0]) setMotorId(motors[0].id);
  }, [motors, motorId]);

  useEffect(() => {
    if (!motorId || motorId === 'all') {
      setEvents([]);
      return;
    }
    fetchJson(`/devices/${encodeURIComponent(motorId)}/telemetry?limit=5000`)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [motorId]);

  const reportEvents = useMemo(() => {
    const cutoff = Date.now() - Number.parseInt(period, 10) * 60 * 60 * 1000;
    return events.filter((event) => new Date(event.captured_at).getTime() >= cutoff);
  }, [events, period]);

  const exportCsv = () => {
    const rows = reportEvents.map((event) => {
      const metrics = Object.fromEntries(event.metrics.map((item) => [item.name, item.value]));
      return [event.captured_at, metrics.rpm ?? '', metrics.vibration_g ?? '', metrics.temperature_c ?? ''];
    });
    if (!rows.length) {
      setMessage('Sem informações para exportar.');
      return;
    }
    const csv = ['timestamp,rpm,vibration_g,temperature_c', ...rows.map((row) => row.join(','))].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `motor-${motorId}-telemetria.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    setMessage('Arquivo CSV exportado.');
  };

  return (
    <>
      <div className="page-header compact">
        <div>
          <p className="eyebrow small">RELATORIOS</p>
          <h1>Exportacao e historico</h1>
          <p className="page-subtitle">Selecione motor e intervalo para gerar relatorios gerenciaveis.</p>
        </div>
      </div>

      <div className="reports-grid">
        <div className="panel report-panel">
          <h3>Gerar relatorio</h3>
          <div className="report-form">
            <select value={motorId} onChange={(event) => setMotorId(event.target.value)}>
              <option value="all">Todos os motores</option>
              {motors.map((motor) => <option key={motor.id} value={motor.id}>{motor.id}</option>)}
            </select>
            <select value={period} onChange={(event) => setPeriod(event.target.value)}>
              <option value="24h">Ultimas 24h</option>
              <option value="7d">Ultimos 7 dias</option>
              <option value="30d">Ultimos 30 dias</option>
            </select>
          </div>
          <div className="export-actions">
            <button className="primary-btn small-btn" onClick={() => window.print()}>Exportar PDF</button>
            <button className="secondary-btn small-btn" onClick={exportCsv}>Exportar Excel</button>
          </div>
          {message && <p className="form-success">{message}</p>}
        </div>

        <div className="panel report-list-panel">
          <h3>Historico</h3>
          <div className="empty-state compact-empty"><p>Os relatórios gerados aparecerão aqui.</p></div>
        </div>
      </div>
    </>
  );
}

function UsersPage({ session }) {
  const { clientes, loading, error, refresh } = useClientes();
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({ nome: '', email: '', telefone: '', empresa: '', cargo: '', senha: '' });

  if (session?.role !== 'admin') {
    return (
      <div className="empty-state">
        <ShieldCheck size={36} />
        <h2>Sem permissao</h2>
        <p>Voce nao possui acesso para gerenciar usuarios da empresa.</p>
      </div>
    );
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError('');
    try {
      const response = await fetchJson('/clientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setForm({ nome: '', email: '', telefone: '', empresa: '', cargo: '', senha: '' });
      setShowForm(false);
      setClientes((current) => [response, ...current]);
    } catch (requestError) {
      setFormError(requestError.message);
    }
  };

  return (
    <>
      <div className="page-header compact">
        <div>
          <p className="eyebrow small">USUARIOS</p>
          <h1>Gestao de acessos</h1>
          <p className="page-subtitle">Lista de usuarios da empresa com papeis e permissoes.</p>
        </div>
        <button className="primary-btn small-btn" onClick={() => setShowForm(true)}>Adicionar cliente</button>
      </div>

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div><p className="eyebrow small">NOVO CLIENTE</p><h3>Cadastrar cliente</h3></div>
              <button type="button" className="icon-button small-button" onClick={() => setShowForm(false)} aria-label="Fechar"><X size={16} /></button>
            </div>
            <form className="manual-form" onSubmit={handleSubmit}>
              <div className="modal-form-grid">
                <label>Nome completo<input value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} required /></label>
                <label>E-mail<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>
                <label>Telefone<input value={form.telefone} onChange={(event) => setForm({ ...form, telefone: event.target.value })} required /></label>
                <label>Empresa<input value={form.empresa} onChange={(event) => setForm({ ...form, empresa: event.target.value })} required /></label>
                <label>Cargo<input value={form.cargo} onChange={(event) => setForm({ ...form, cargo: event.target.value })} required /></label>
                <label>Senha<input type="password" minLength="8" value={form.senha} onChange={(event) => setForm({ ...form, senha: event.target.value })} required /></label>
              </div>
              <small>A senha deve ter maiúscula, minúscula, número e caractere especial.</small>
              {formError && <p className="form-error">{formError}</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-btn small-btn" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="primary-btn small-btn">Salvar cliente</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="user-table">
        {loading && <div className="empty-state compact-empty"><p>Carregando clientes...</p></div>}
        {error && <div className="empty-state compact-empty"><p>{error}</p><button className="secondary-btn small-btn" onClick={refresh}>Tentar novamente</button></div>}
        {!loading && !error && !clientes.length && <div className="empty-state compact-empty"><p>Sem clientes cadastrados.</p></div>}
        {!loading && !error && clientes.map((cliente) => (
          <div className="user-row" key={cliente.id_cliente}>
            <div className="user-cell">
              <div className="avatar small">{cliente.nome.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</div>
              <div>
                <strong>{cliente.nome}</strong>
                <small>{cliente.email} · {cliente.empresa}</small>
              </div>
            </div>
            <span>{cliente.cargo}</span>
            <span>{cliente.telefone}</span>
            <span>Ativo</span>
          </div>
        ))}
      </div>
    </>
  );
}

function SettingsPage({ session, onSessionUpdate }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    nome: session?.name || '',
    empresa: session?.company || '',
    email: session?.email || '',
    telefone: localStorage.getItem('ms-phone') || '',
    email_alerts_enabled: session?.emailAlertsEnabled ?? true,
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const saveSettings = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const updated = await fetchJson(`/clientes/${session.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify(form),
      });
      const nextSession = { ...session, name: updated.nome, email: updated.email, company: updated.empresa, emailAlertsEnabled: updated.email_alerts_enabled };
      localStorage.setItem('ms-session', JSON.stringify(nextSession));
      onSessionUpdate(nextSession);
      setSaved(true);
    } catch (requestError) {
      setSaved(false);
      setError(requestError.message);
      if (requestError.message.includes('Sessão')) {
        localStorage.removeItem('ms-session');
        onSessionUpdate(null);
        navigate('/login', { replace: true });
      }
    }
  };

  return (
    <>
      <div className="page-header compact">
        <div>
          <p className="eyebrow small">CONFIGURACOES</p>
          <h1>Conta e preferencias</h1>
          <p className="page-subtitle">Dados da conta, empresa e notificacoes.</p>
        </div>
      </div>

      <div className="settings-grid">
        <div className="panel settings-panel">
          <h3>Dados da conta</h3>
          <form className="settings-form" onSubmit={saveSettings}>
            <label>
              Nome completo
              <input value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} required />
            </label>
            <label>
              Nome da empresa
              <input value={form.empresa} onChange={(event) => setForm({ ...form, empresa: event.target.value })} />
            </label>
            <label>
              E-mail corporativo
              <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </label>
            <label>
              Telefone
              <input value={form.telefone} onChange={(event) => setForm({ ...form, telefone: event.target.value })} />
            </label>
            <button type="submit" className="primary-btn small-btn">Salvar configuracoes</button>
            {saved && <p className="form-success">Configurações salvas.</p>}
            {error && <p className="form-error">Não foi possível salvar as configurações.</p>}
          </form>
        </div>

        <div className="panel settings-panel">
          <h3>Notificacoes</h3>
          <div className="option-list">
            <label className="checkbox-wrap"><input type="checkbox" checked={form.email_alerts_enabled} onChange={(event) => setForm({ ...form, email_alerts_enabled: event.target.checked })} /><span>Alertas por e-mail</span></label>
            <small>Você receberá um e-mail quando temperatura ou vibração ultrapassarem os limites.</small>
          </div>
        </div>
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

export default App;
