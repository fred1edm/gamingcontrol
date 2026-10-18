import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  IconDeviceGamepad2 as Gamepad2,
  IconDeviceDesktop as Monitor,
  IconLayoutGrid as LayoutGrid,
  IconHistory as History,
  IconSettings as Settings2,
  IconUsers as Users,
  IconLogout as LogOut,
  IconPlus as Plus,
  IconArrowUpRight as ArrowUpRight,
  IconClock as Clock3,
  IconChevronRight as ChevronRight,
  IconCheck as Check,
  IconShieldCheck as ShieldCheck,
  IconRefresh as RefreshCw,
  IconX as X,
  IconSearch as Search,
  IconBroadcast as Radio,
  IconAlertCircle as AlertCircle,
  IconPackage as Package,
  IconWallet as WalletCards,
  IconBell as Bell,
  IconChartBar as BarChart3,
  IconClipboardList as ClipboardList,
  IconPencil as Pencil,
  IconKey as Key,
  IconGift as Gift,
  IconTrash as Trash2,
} from "@tabler/icons-react";
import type {
  ExtraView,
  SessionView,
  StationsResponse,
  StationView,
  UserView,
  ProductView,
  LoyaltyCardView,
} from "@gaming/shared";
import {
  events,
  notificationSoundOptions,
  stationTypes,
} from "@gaming/shared";
import { io } from "socket.io-client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "./components/ui/button";
const currency = (c: number) =>
  new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" }).format(
    c / 100,
  );
const stamp = (s: string) =>
  new Date(s).toLocaleString("es-PE", {
    timeZone: "America/Lima",
    dateStyle: "short",
    timeStyle: "short",
  });
const labels: Record<string, string> = {
  AVAILABLE: "Disponible",
  IN_USE: "En uso",
  FINISHED: "Pendiente de pago",
  TIME_FINISHED: "Tiempo terminado",
  OFFLINE: "Sin conexión",
  MAINTENANCE: "Mantenimiento",
  RESERVED: "Reservada",
  ACTIVE: "En uso",
  PAUSED: "Pausada",
  SAVED: "Hora guardada",
  ENDING_SOON: "Por terminar",
};
type Page =
  | "stations"
  | "history"
  | "inventory"
  | "cash"
  | "loyalty"
  | "reports"
  | "audit"
  | "settings"
  | "users";
type ReportView = {
  period: string;
  from: string;
  to: string;
  totalCents: number;
  categories: {
    pcCents: number;
    playstationCents: number;
    extrasCents: number;
    snacksCents: number;
  };
  paymentsByMethod: { method: string; amountCents: number }[];
  sessions: { count: number; averageCents: number };
  topStation: { name: string; amountCents: number } | null;
  topProducts: { name: string; quantity: number; amountCents: number }[];
  demandByHour: { hour: number; count: number }[];
  totalsByDay: { day: string; amountCents: number }[];
  totalsByWeek: { weekStart: string; amountCents: number }[];
  shift: "all" | "morning" | "afternoon";
  promotions: {
    freeHours: number;
    snackKits: number;
    freeHourValueCents: number;
    snackKitValueCents: number;
    totalValueCents: number;
    products: { name: string; quantity: number }[];
  };
};
type AuditView = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  oldData: unknown;
  newData: unknown;
  ipAddress: string;
  createdAt: string;
  user: { name: string; email: string; role: string } | null;
};
type InventoryMovementView = {
  id: string;
  productId: string;
  type: string;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  unitCostCents: number | null;
  reason: string | null;
  createdAt: string;
  product: { name: string };
};
const desktopApiOrigin =
  typeof window !== "undefined" &&
  (window.location.protocol === "tauri:" ||
    window.location.hostname === "tauri.localhost")
    ? "http://127.0.0.1:3001"
    : "";
function duration(s: SessionView, now: number) {
  const storedSeconds =
    s.status === "PAUSED"
      ? s.pausedRemainingSeconds
      : s.status === "SAVED"
        ? s.savedRemainingSeconds
        : null;
  if (storedSeconds != null) {
    return [
      Math.floor(storedSeconds / 3600),
      Math.floor(storedSeconds / 60) % 60,
      storedSeconds % 60,
    ]
      .map((n) => String(n).padStart(2, "0"))
      .join(":");
  }
  const ms =
    s.mode === "OPEN"
      ? Math.max(
          0,
          (s.finishedAt ? Date.parse(s.finishedAt) : now) -
            Date.parse(s.startedAt),
        )
      : Math.max(0, Date.parse(s.endsAt!) - now);
  const seconds = Math.floor(ms / 1000);
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
export function App() {
  const [token, setToken] = useState(() => {
    const saved = localStorage.getItem("gaming-token");
    if (saved) return saved;
    const legacy = sessionStorage.getItem("gaming-token");
    if (legacy) {
      localStorage.setItem("gaming-token", legacy);
      sessionStorage.removeItem("gaming-token");
    }
    return legacy ?? "";
  });
  const [user, setUser] = useState<UserView | null>(null),
    [page, setPage] = useState<Page>("stations");
  const [stations, setStations] = useState<StationView[]>([]),
    [extras, setExtras] = useState<ExtraView[]>([]),
    [history, setHistory] = useState<
      (SessionView & { station: { name: string } })[]
    >([]),
    [users, setUsers] = useState<UserView[]>([]);
  const [savedSessions, setSavedSessions] = useState<
    (SessionView & { station: { name: string; type: string } })[]
  >([]);
  const [products, setProducts] = useState<ProductView[]>([]);
  const [loyaltyCards, setLoyaltyCards] = useState<LoyaltyCardView[]>([]);
  const [loyaltySearch, setLoyaltySearch] = useState("");
  const [inventoryMovements, setInventoryMovements] = useState<
    InventoryMovementView[]
  >([]);
  const [reportPeriod, setReportPeriod] = useState<
    "daily" | "weekly" | "monthly"
  >("daily");
  const [reportDate, setReportDate] = useState(() =>
    new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [reportShift, setReportShift] = useState<
    "all" | "morning" | "afternoon"
  >("all");
  const [report, setReport] = useState<ReportView | null>(null);
  const [auditRows, setAuditRows] = useState<AuditView[]>([]);
  const [auditAction, setAuditAction] = useState("");
  const [settings, setSettings] = useState({
    first: 10,
    second: 5,
    sound: "fahhhhh",
  });
  const [notifications, setNotifications] = useState<
    { id: string; title: string; message: string; createdAt: string }[]
  >([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [cash, setCash] = useState<{
    register: {
      id: string;
      openingAmount: number;
      expectedAmount: number;
      status: string;
    } | null;
  }>({ register: null });
  const [selected, setSelected] = useState<string | null>(null),
    [filter, setFilter] = useState("ALL"),
    [search, setSearch] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [now, setNow] = useState(Date.now()),
    [minutes, setMinutes] = useState(60),
    [customMinutes, setCustomMinutes] = useState(""),
    [withExtra, setWithExtra] = useState(false),
    [extraQuantity, setExtraQuantity] = useState(1),
    [chosenExtra, setChosenExtra] = useState("");
  const [confirmFinish, setConfirmFinish] = useState(false),
    [createStation, setCreateStation] = useState(false);
  const [moveStationId, setMoveStationId] = useState("");
  const [cancelSessionId, setCancelSessionId] = useState<string | null>(null),
    [cancelReason, setCancelReason] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "station" | "product";
    id: string;
    name: string;
  } | null>(null);
  const [editUser, setEditUser] = useState<UserView | null>(null);
  const [resetUser, setResetUser] = useState<UserView | null>(null);
  const [editProduct, setEditProduct] = useState<ProductView | null>(null);
  const [editLoyaltyCard, setEditLoyaltyCard] =
    useState<LoyaltyCardView | null>(null);
  const [deleteLoyaltyCard, setDeleteLoyaltyCard] =
    useState<LoyaltyCardView | null>(null);
  const [chosenProduct, setChosenProduct] = useState("");
  const [chosenLoyaltyCard, setChosenLoyaltyCard] = useState("");
  const [chosenLoyaltyStation, setChosenLoyaltyStation] = useState("");
  const [chosenLoyaltySoda, setChosenLoyaltySoda] = useState("");
  const [chosenLoyaltySnack, setChosenLoyaltySnack] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const clock = useRef({ server: Date.now(), local: performance.now() });
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const notificationAudio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    notificationAudio.current = null;
  }, [settings.sound]);
  const playNotificationSound = useCallback(() => {
    const sound =
      notificationSoundOptions.find((item) => item.value === settings.sound)
        ?.file ?? notificationSoundOptions[0].file;
    const audio = notificationAudio.current ?? new Audio(sound);
    notificationAudio.current = audio;
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // El navegador puede bloquear audio hasta una interacción del usuario.
    });
  }, [settings.sound]);
  const logout = useCallback(() => {
    localStorage.removeItem("gaming-token");
    setToken("");
    setUser(null);
    setStations([]);
    setSelected(null);
    setConnected(false);
    setRealtimeConnected(false);
    setNotifications([]);
    setSavedSessions([]);
  }, []);
  const api = useCallback(
    async <T,>(path: string, body?: unknown, method = "POST"): Promise<T> => {
      const signature = `${method}:${path}:${JSON.stringify(body)}`;
      if (body !== undefined && pending.current?.signature !== signature)
        pending.current = { signature, key: crypto.randomUUID() };
      const response = await fetch(`${desktopApiOrigin}/api${path}`, {
        method: body === undefined ? "GET" : method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined
            ? { "Idempotency-Key": pending.current!.key }
            : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await response.json()) as T & { message?: string };
      if (body !== undefined && response.status < 500) pending.current = null;
      if (!response.ok) {
        if (response.status === 401 && path !== "/auth/login") logout();
        const serverMessage = data.message ?? "";
        const message = serverMessage.startsWith("Route ")
          ? "El servidor necesita reiniciarse para aplicar la versión actual"
          : serverMessage || "No se pudo completar la operación";
        throw new Error(message);
      }
      return data;
    },
    [token, logout],
  );
  const refresh = useCallback(async () => {
    const [
      data,
      list,
      productList,
      cashList,
      movementList,
      saved,
      cards,
      sound,
    ] =
      await Promise.all([
        api<StationsResponse>("/stations"),
        api<ExtraView[]>("/extras"),
        api<ProductView[]>("/products"),
        api<typeof cash>("/cash/current"),
        api<InventoryMovementView[]>("/inventory"),
        api<(SessionView & { station: { name: string; type: string } })[]>(
          "/sessions/saved",
        ),
        api<LoyaltyCardView[]>("/loyalty/cards"),
        api<{ sound: string }>("/settings/notification-sound"),
      ]);
    clock.current = {
      server: Date.parse(data.serverTime),
      local: performance.now(),
    };
    setNow(clock.current.server);
    setStations(data.stations);
    setExtras(list);
    setProducts(productList);
    setCash(cashList);
    setInventoryMovements(movementList);
    setSavedSessions(saved);
    setLoyaltyCards(cards);
    setSettings((current) => ({ ...current, sound: sound.sound }));
    setConnected(true);
  }, [api]);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    void api<UserView>("/auth/me")
      .then((u) => {
        if (alive) setUser(u);
      })
      .catch((e) => {
        if (alive) setError(String(e.message));
      });
    const load = () => {
      void refresh().catch(() => {
        if (alive) setConnected(false);
      });
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [token, api, refresh]);
  useEffect(() => {
    if (!token) return;
    const socket = io(desktopApiOrigin || undefined, {
      path: "/socket.io",
      auth: { token },
      transports: ["websocket", "polling"],
    });
    const reloadEvents = [
      events.stationUpdated,
      events.sessionStarted,
      events.sessionUpdated,
      events.sessionExtended,
      events.sessionEndingSoon,
      events.sessionFinished,
      events.saleCreated,
      events.inventoryUpdated,
      events.loyaltyUpdated,
      events.cashUpdated,
      events.settingsUpdated,
    ];
    const reload = () => void refresh().catch(() => setConnected(false));
    reloadEvents.forEach((name) => socket.on(name, reload));
    socket.on("connect", () => setRealtimeConnected(true));
    socket.on("disconnect", () => setRealtimeConnected(false));
    socket.on(events.notificationNew, (notification) => {
      const item = notification as {
        id?: string;
        title?: string;
        message?: string;
        createdAt?: string;
      };
      const next = {
        id: item.id ?? crypto.randomUUID(),
        title: item.title ?? "Aviso",
        message: item.message ?? "Hay una actualización en el sistema.",
        createdAt: item.createdAt ?? new Date().toISOString(),
      };
      setNotifications((current) =>
        [next, ...current.filter((n) => n.id !== next.id)].slice(0, 20),
      );
      setNotice(next.message);
      playNotificationSound();
    });
    return () => {
      reloadEvents.forEach((name) => socket.off(name, reload));
      socket.close();
      setRealtimeConnected(false);
    };
  }, [token, refresh, playNotificationSound]);
  useEffect(() => {
    const timer = setInterval(
      () =>
        setNow(clock.current.server + performance.now() - clock.current.local),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!token) return;
    if (page === "history")
      void api<typeof history>("/sessions")
        .then(setHistory)
        .catch((e) => setError(e.message));
    if (page === "users")
      void api<UserView[]>("/users")
        .then(setUsers)
        .catch((e) => setError(e.message));
    if (page === "inventory")
      void Promise.all([
        api<ProductView[]>("/products"),
        api<InventoryMovementView[]>("/inventory"),
      ])
        .then(([nextProducts, nextMovements]) => {
          setProducts(nextProducts);
          setInventoryMovements(nextMovements);
        })
        .catch((e) => setError(e.message));
    if (page === "settings")
      void api<Record<string, number | string>>("/settings")
        .then((value) =>
          setSettings({
            first: Number(value.ALERT_FIRST_MINUTES ?? 10),
            second: Number(value.ALERT_SECOND_MINUTES ?? 5),
            sound: String(value.NOTIFICATION_SOUND ?? "fahhhhh"),
          }),
        )
        .catch((e) => setError(e.message));
    if (page === "reports") {
      const params = new URLSearchParams({ date: reportDate, shift: reportShift });
      void api<ReportView>(`/reports/${reportPeriod}?${params.toString()}`)
        .then(setReport)
        .catch((e) => setError(e.message));
    }
    if (page === "audit") {
      const query = auditAction
        ? `?action=${encodeURIComponent(auditAction)}`
        : "";
      void api<AuditView[]>(`/audit${query}`)
        .then(setAuditRows)
        .catch((e) => setError(e.message));
    }
  }, [page, token, api, reportPeriod, reportDate, reportShift, auditAction]);
  useEffect(() => {
    if (user?.role !== "ADMIN" && page === "reports") setPage("stations");
  }, [page, user]);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Error de conexión. Puedes reintentar la operación.",
      );
    } finally {
      setBusy(false);
    }
  }
  const station = stations.find((s) => s.id === selected),
    session = station?.session;
  const available = stations.filter((s) => s.status === "AVAILABLE").length,
    availableStations = stations.filter((s) => s.status === "AVAILABLE"),
    occupied = stations.filter(
      (s) => s.session && !s.session.finishedAt,
    ).length,
    finished = stations.filter((s) => s.status === "FINISHED").length;
  const moveStations = session
    ? stations.filter(
        (candidate) =>
          candidate.id !== station?.id &&
          candidate.type === station.type &&
          candidate.status === "AVAILABLE",
      )
    : [];
  const openStation = (id: string) => {
    setSelected(id);
    setConfirmFinish(false);
    setMinutes(60);
    setWithExtra(false);
    setChosenProduct("");
    setMoveStationId("");
  };
  const endingSoon = stations.filter((s) => {
    if (
      !s.session ||
      s.session.finishedAt ||
      s.session.status === "PAUSED" ||
      !s.session.endsAt
    )
      return false;
    const remaining = Date.parse(s.session.endsAt) - now;
    return remaining > 0 && remaining <= settings.first * 60_000;
  });
  const chosen = extras.find((e) => e.id === chosenExtra) ?? extras[0];
  const selectedExtra = extras.find((e) => e.id === chosenExtra);
  const currentExtraQuantity =
    session?.extras.find((e) => e.name === selectedExtra?.name)?.quantity ?? 0;
  const maxExtraQuantity = Math.max(1, 4 - currentExtraQuantity);
  if (!token)
    return (
      <div className="login">
        <div className="login-story">
          <img
            className="cabina-logo"
            src="/gorilaz-logo.png"
            alt="Gorilaz Gamer"
          />
          <div className="brand">
            gaming<span>control</span>
          </div>
          <h1 className="login-title">
            Tu espacio de juego,
            <br />
            <em>bajo control.</em>
          </h1>
          <p className="login-description">
            Administra tus estaciones, sesiones y operación desde un solo panel.
          </p>
          <div className="login-badges">
            <span>
              <Monitor size={18} /> PCs
            </span>
            <span>
              <Gamepad2 size={18} /> Consolas
            </span>
            <span>
              <ShieldCheck size={18} /> Panel seguro
            </span>
          </div>
        </div>
        <form
          className="login-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            void api<{ token: string; user: UserView }>("/auth/login", {
              email: f.get("email"),
              password: f.get("password"),
            })
              .then((r) => {
                localStorage.setItem("gaming-token", r.token);
                setToken(r.token);
                setUser(r.user);
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <span className="eyebrow">PANEL DE ADMINISTRACIÓN</span>
          <h2>Bienvenido de nuevo</h2>
          <p>Inicia sesión para abrir tu centro de control.</p>
          <label>
            Correo electrónico
            <input
              name="email"
              type="email"
              autoComplete="username"
              placeholder="tu-correo@ejemplo.com"
              required
            />
          </label>
          <label>
            Contraseña
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Tu contraseña"
              required
            />
          </label>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <Button disabled={busy} type="submit">
            {busy ? "Conectando…" : "Entrar al panel"}
            <ArrowUpRight size={18} />
          </Button>
        </form>
        {busy && (
          <div className="busy-overlay" role="status" aria-live="polite">
            <div className="busy-card">
              <RefreshCw className="busy-icon" size={20} />
              <span>Validando acceso…</span>
            </div>
          </div>
        )}
      </div>
    );
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <img src="/gorilaz-logo.png" alt="" />
          </span>
          <div>
            gaming<span>control</span>
          </div>
        </div>
        <span className="nav-caption">ESPACIO DE TRABAJO</span>
        <nav>
          {(
            [
              ["stations", LayoutGrid, "Estaciones"],
              ["history", History, "Historial"],
              ["inventory", Package, "Inventario"],
              ["cash", WalletCards, "Caja"],
              ["loyalty", Gift, "Tarjetas"],
              ...(user?.role === "ADMIN"
                ? [["reports", BarChart3, "Reportes"]]
                : []),
              ...(user?.role === "ADMIN"
                ? [
                    ["settings", Settings2, "Configuración"],
                    ["users", Users, "Trabajadores"],
                    ["audit", ClipboardList, "Auditoría"],
                  ]
                : []),
            ] as const
          ).map(([key, Icon, label]) => (
            <button
              key={String(key)}
              title={String(label)}
              aria-label={String(label)}
              aria-current={page === key ? "page" : undefined}
              className={page === key ? "active" : ""}
              onClick={() => {
                setPage(key as Page);
                setSelected(null);
              }}
            >
              <Icon size={19} />
              {String(label)}
              {page === key && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="account">
          <span className="avatar">{user?.name.slice(0, 1) ?? "G"}</span>
          <div>
            <strong>{user?.name ?? "Cargando…"}</strong>
            <small>
              {user?.role === "ADMIN" ? "Administrador" : "Trabajador"}
            </small>
          </div>
          <button
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
            onClick={logout}
          >
            <LogOut size={18} />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>
      <main>
        <header>
          <span>
            Tu negocio <ChevronRight size={14} />{" "}
            <strong>
              {
                {
                  stations: "Estaciones",
                  inventory: "Inventario",
                  cash: "Caja",
                  loyalty: "Tarjetas",
                  reports: "Reportes",
                  history: "Historial",
                  settings: "Configuración",
                  users: "Trabajadores",
                  audit: "Auditoría",
                }[page]
              }
            </strong>
          </span>
          <div>
            <span className={`connection ${connected ? "online" : ""}`}>
              <i />
              {connected
                ? "Servidor conectado"
                : "Sin conexión · datos no actualizados"}
            </span>
            <span className={`connection ${realtimeConnected ? "online" : ""}`}>
              <i />
              {realtimeConnected ? "Tiempo real activo" : "Tiempo real…"}
            </span>
            <button
              className="notification-button"
              aria-label="Notificaciones"
              onClick={() => setNotificationsOpen((open) => !open)}
            >
              <Bell size={18} />
              {notifications.length > 0 && <b>{notifications.length}</b>}
            </button>
            <span className="date">
              {new Date(now).toLocaleDateString("es-PE", {
                timeZone: "America/Lima",
                day: "numeric",
                month: "short",
              })}
            </span>
          </div>
        </header>
        {notificationsOpen && (
          <div className="notification-panel" role="status">
            <div className="notification-panel-head">
              <strong>Notificaciones</strong>
              <button onClick={() => setNotifications([])}>Limpiar</button>
            </div>
            {notifications.length ? (
              notifications.map((item) => (
                <div className="notification-item" key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.message}</span>
                  <small>{stamp(item.createdAt)}</small>
                </div>
              ))
            ) : (
              <div className="notification-empty">No hay avisos nuevos.</div>
            )}
          </div>
        )}
        <section className="content">
          {page === "stations" && user?.role === "ADMIN" && (
            <div className="page-heading">
              <Button onClick={() => setCreateStation(true)}>
                <Plus size={18} />
                Nueva estación
              </Button>
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              <AlertCircle size={18} />
              {error}
              <button aria-label="Cerrar error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              <Check size={18} />
              {notice}
            </div>
          )}
          {page === "stations" && (
            <>
              <div className="stats">
                {[
                  [
                    stations.length,
                    "Estaciones totales",
                    LayoutGrid,
                    "neutral",
                  ],
                  [occupied, "Sesiones en curso", Gamepad2, "blue"],
                  [available, "Listas para iniciar", Check, "green"],
                  [finished, "Pendientes de pago", Clock3, "amber"],
                ].map(([value, label, Icon, color]) => {
                  const Glyph = Icon as typeof LayoutGrid;
                  return (
                    <div className="stat" key={String(label)}>
                      <span className={`stat-icon ${color}`}>
                        <Glyph size={21} />
                      </span>
                      <div>
                        <strong>{String(value).padStart(2, "0")}</strong>
                        <span>{String(label)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {endingSoon.length > 0 && (
                <div className="ending-soon-panel">
                  <div>
                    <span className="eyebrow">POR TERMINAR</span>
                    <p>Sesiones dentro del umbral de aviso</p>
                  </div>
                  <div className="ending-soon-list">
                    {endingSoon.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setSelected(item.id)}
                      >
                        <strong>{item.name}</strong>
                        <span>{duration(item.session!, now)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {savedSessions.length > 0 && (
                <div className="saved-sessions-panel">
                  <div>
                    <span className="eyebrow">HORAS GUARDADAS</span>
                    <p>Sesiones pausadas o pagadas listas para reanudar</p>
                  </div>
                  <div className="saved-sessions-list">
                    {savedSessions.map((saved) => (
                      <div className="saved-session" key={saved.id}>
                        <div>
                          <strong>
                            {saved.savedName || "Cliente sin nombre"}
                          </strong>
                          <span>
                            {saved.station.name} · {saved.station.type} ·{" "}
                            {duration(saved, now)}
                          </span>
                          {saved.savedCode && (
                            <small>
                              Código de validación: {saved.savedCode}
                            </small>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          disabled={busy || !connected}
                          onClick={() =>
                            void run(async () => {
                              await api(`/sessions/${saved.id}/resume`, {});
                              setNotice(
                                "Sesión reanudada en una estación disponible.",
                              );
                            })
                          }
                        >
                          Reanudar
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="toolbar">
                <div className="tabs">
                  {[
                    ["ALL", "Todas"],
                    ["PC", "PCs"],
                    ["CONSOLE", "Consolas"],
                  ].map(([key, label]) => (
                    <button
                      className={filter === key ? "selected" : ""}
                      key={key}
                      onClick={() => setFilter(key!)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="search">
                  <Search size={16} />
                  <input
                    aria-label="Buscar estación"
                    placeholder="Buscar estación…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Button
                  variant="ghost"
                  aria-label="Actualizar estaciones"
                  onClick={() => void run(async () => {})}
                >
                  <RefreshCw size={17} />
                </Button>
              </div>
              <div className="station-grid">
                {stations
                  .filter(
                    (s) =>
                      (filter === "ALL" ||
                        (filter === "PC"
                          ? s.type === "PC"
                          : s.type !== "PC")) &&
                      s.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((s) => (
                    <article
                      className={`station-card ${endingSoon.some((item) => item.id === s.id) ? "ending_soon" : s.status.toLowerCase()} ${selected === s.id ? "picked" : ""}`}
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openStation(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openStation(s.id);
                        }
                      }}
                    >
                      <div className="card-top">
                        <span className="device-icon">
                          {s.type === "PC" ? <Monitor /> : <Gamepad2 />}
                        </span>
                        <span
                          className={`status status-${endingSoon.some((item) => item.id === s.id) ? "ending_soon" : s.status.toLowerCase()}`}
                        >
                          <i />
                          {endingSoon.some((item) => item.id === s.id)
                            ? "Por terminar"
                            : (labels[s.status] ?? s.status)}
                        </span>
                        {user?.role === "ADMIN" && !s.session && (
                          <button
                            type="button"
                            className="station-delete"
                            aria-label={`Eliminar ${s.name}`}
                            title="Eliminar estación"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget({
                                type: "station",
                                id: s.id,
                                name: s.name,
                              });
                            }}
                          >
                            <X size={15} />
                          </button>
                        )}
                      </div>
                      <h2>{s.name}</h2>
                      <span className="type">
                        {s.type.replace("_", " ")} <span>·</span>{" "}
                        {currency(s.hourlyCents)} / hora
                      </span>
                      <div className="card-time">
                        {s.session ? (
                          <>
                            <Clock3 size={17} />
                            <strong>
                              {s.session.finishedAt
                                ? "Finalizada"
                                : duration(s.session, now)}
                            </strong>
                          </>
                        ) : (
                          <span>La próxima partida empieza aquí</span>
                        )}
                      </div>
                      <div className="card-bottom">
                        <span>
                          {s.session
                            ? "Consumo actual"
                            : "Disponible para iniciar"}
                        </span>
                        <strong>
                          {s.session ? (
                            currency(s.session.totalAmount)
                          ) : (
                            <ArrowUpRight size={19} />
                          )}
                        </strong>
                      </div>
                    </article>
                  ))}
              </div>
              {stations.length === 0 && (
                <div className="empty">
                  {connected
                    ? "Crea tu primera estación para comenzar."
                    : "Conectando con el servidor…"}
                </div>
              )}
              <p className="footnote">
                <Radio size={14} /> Sesiones guardadas en el servidor · tiempo
                real y respaldo cada 5 segundos · Zona America/Lima
              </p>
            </>
          )}
          {page === "history" && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Estación</th>
                    <th>Inicio</th>
                    <th>Modo</th>
                    <th>Extensiones</th>
                    <th>Estado</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => {
                        setSelected(s.stationId);
                        setPage("stations");
                      }}
                    >
                      <td>{s.station.name}</td>
                      <td>{stamp(s.startedAt)}</td>
                      <td>
                        {s.mode === "OPEN" ? "Libre" : `${s.baseMinutes} min`}
                      </td>
                      <td>
                        {s.extensions
                          .map((e) => `+${e.minutesAdded} min`)
                          .join(", ") || "—"}
                      </td>
                      <td>
                        {s.status === "CANCELLED" ? (
                          <>
                            <strong>Cancelada · Sin cobro</strong>
                            {s.cancelReason && (
                              <small className="history-reason">
                                Motivo: {s.cancelReason}
                              </small>
                            )}
                          </>
                        ) : s.finishedAt ? (
                          "Pendiente de pago"
                        ) : (
                          (labels[s.status] ?? s.status)
                        )}
                      </td>
                      <td>{currency(s.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!history.length && (
                <div className="empty">
                  Todavía no hay sesiones registradas.
                </div>
              )}
              <p className="footnote">
                Últimas 50 sesiones. Los importes de tiempo libre se actualizan
                al consultar.
              </p>
            </div>
          )}
          {page === "reports" && (
            <div className="reports-page">
              <div className="report-toolbar">
                <div className="tabs">
                  {(["daily", "weekly", "monthly"] as const).map((period) => (
                    <button
                      className={reportPeriod === period ? "selected" : ""}
                      key={period}
                      onClick={() => setReportPeriod(period)}
                    >
                      {period === "daily"
                        ? "Hoy"
                        : period === "weekly"
                          ? "Esta semana"
                          : "Este mes"}
                    </button>
                  ))}
                </div>
                <div className="report-filters">
                  <label>
                    Periodo de referencia
                    <input
                      type="date"
                      value={reportDate}
                      onChange={(event) => setReportDate(event.target.value)}
                    />
                  </label>
                  <label>
                    Turno
                    <select
                      value={reportShift}
                      onChange={(event) =>
                        setReportShift(
                          event.target.value as
                            | "all"
                            | "morning"
                            | "afternoon",
                        )
                      }
                    >
                      <option value="all">Todos los turnos</option>
                      <option value="morning">Mañana · 10:00–15:00</option>
                      <option value="afternoon">Tarde · 15:00–22:00</option>
                    </select>
                  </label>
                </div>
                {report && (
                  <small>
                    {stamp(report.from)} — {stamp(report.to)}
                  </small>
                )}
              </div>
              {!report ? (
                <div className="empty">Cargando reporte…</div>
              ) : (
                <>
                  <div className="report-stats">
                    <div className="stat">
                      <span className="stat-icon green">
                        <WalletCards size={21} />
                      </span>
                      <div>
                        <strong>{currency(report.totalCents)}</strong>
                        <span>Ingresos cobrados</span>
                      </div>
                    </div>
                    <div className="stat">
                      <span className="stat-icon blue">
                        <Gamepad2 size={21} />
                      </span>
                      <div>
                        <strong>{report.sessions.count}</strong>
                        <span>Sesiones cobradas</span>
                      </div>
                    </div>
                    <div className="stat">
                      <span className="stat-icon amber">
                        <ArrowUpRight size={21} />
                      </span>
                      <div>
                        <strong>
                          {currency(report.sessions.averageCents)}
                        </strong>
                        <span>Promedio por sesión</span>
                      </div>
                    </div>
                    <div className="stat">
                      <span className="stat-icon neutral">
                        <Radio size={21} />
                      </span>
                      <div>
                        <strong>{report.topStation?.name ?? "—"}</strong>
                        <span>Estación líder</span>
                      </div>
                    </div>
                  </div>
                  <div className="report-grid">
                    <div className="panel chart-panel">
                      <h2>
                        {reportPeriod === "daily"
                          ? "Ingresos del día"
                          : reportPeriod === "weekly"
                            ? "Ingresos por día"
                            : "Ingresos por semana"}
                      </h2>
                      <p>
                        {reportPeriod === "daily"
                          ? "Cobros registrados en la fecha seleccionada."
                          : reportPeriod === "weekly"
                            ? "Comparación de lunes a domingo."
                            : "Comparación de las semanas del mes seleccionado."}
                      </p>
                      <ResponsiveContainer width="100%" height={240}>
                        <BarChart
                          data={
                            reportPeriod === "monthly"
                              ? report.totalsByWeek.map((row) => ({
                                  label: `Sem. ${new Date(`${row.weekStart}T12:00:00Z`).toLocaleDateString("es-PE", { day: "2-digit", month: "short", timeZone: "America/Lima" })}`,
                                  amount: row.amountCents,
                                }))
                              : report.totalsByDay.map((row) => ({
                                  label: new Date(`${row.day}T12:00:00Z`).toLocaleDateString("es-PE", { weekday: reportPeriod === "weekly" ? "short" : undefined, day: "2-digit", month: "short", timeZone: "America/Lima" }),
                                  amount: row.amountCents,
                                }))
                          }
                        >
                          <CartesianGrid stroke="#2c3537" vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={{ fill: "#8a999a", fontSize: 10 }}
                          />
                          <YAxis
                            tick={{ fill: "#8a999a", fontSize: 10 }}
                            tickFormatter={(value) =>
                              `S/${(value / 100).toFixed(0)}`
                            }
                          />
                          <Tooltip
                            formatter={(value) => currency(Number(value))}
                          />
                          <Bar
                            dataKey="amount"
                            name="Ingresos"
                            fill="#91edbb"
                            radius={[5, 5, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="panel chart-panel">
                      <h2>Ingresos por categoría</h2>
                      <p>Tiempo, mandos y productos cobrados.</p>
                      <ResponsiveContainer width="100%" height={240}>
                        <BarChart
                          data={[
                            { name: "PC", amount: report.categories.pcCents },
                            {
                              name: "PlayStation",
                              amount: report.categories.playstationCents,
                            },
                            {
                              name: "Mandos",
                              amount: report.categories.extrasCents,
                            },
                            {
                              name: "Snacks",
                              amount: report.categories.snacksCents,
                            },
                          ]}
                        >
                          <CartesianGrid stroke="#2c3537" vertical={false} />
                          <XAxis
                            dataKey="name"
                            tick={{ fill: "#8a999a", fontSize: 10 }}
                          />
                          <YAxis
                            tick={{ fill: "#8a999a", fontSize: 10 }}
                            tickFormatter={(value) =>
                              `S/${(value / 100).toFixed(0)}`
                            }
                          />
                          <Tooltip
                            formatter={(value) => currency(Number(value))}
                          />
                          <Bar
                            dataKey="amount"
                            fill="#91edbb"
                            radius={[5, 5, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="panel chart-panel">
                      <h2>Demanda por hora</h2>
                      <p>Sesiones iniciadas según la hora local.</p>
                      <ResponsiveContainer width="100%" height={240}>
                        <BarChart
                          data={report.demandByHour.map((row) => ({
                            ...row,
                            label: `${String(row.hour).padStart(2, "0")}:00`,
                          }))}
                        >
                          <CartesianGrid stroke="#2c3537" vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={{ fill: "#8a999a", fontSize: 10 }}
                          />
                          <YAxis
                            allowDecimals={false}
                            tick={{ fill: "#8a999a", fontSize: 10 }}
                          />
                          <Tooltip />
                          <Bar
                            dataKey="count"
                            name="Sesiones"
                            fill="#8fc3fa"
                            radius={[5, 5, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="panel promotions-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Promociones entregadas</h2>
                        <p>No se mezclan con los ingresos cobrados.</p>
                      </div>
                      <Gift size={21} />
                    </div>
                    <div className="setting-row">
                      <label>
                        Horas gratis
                        <small>{currency(report.promotions.freeHourValueCents)} de valor promocional</small>
                      </label>
                      <strong>{report.promotions.freeHours}</strong>
                    </div>
                    <div className="setting-row">
                      <label>
                        Kits de snacks
                        <small>{currency(report.promotions.snackKitValueCents)} de costo promocional</small>
                      </label>
                      <strong>{report.promotions.snackKits}</strong>
                    </div>
                    <div className="setting-row">
                      <label>Total entregado en promociones</label>
                      <strong>{currency(report.promotions.totalValueCents)}</strong>
                    </div>
                    {report.promotions.products.length > 0 && (
                      <div className="promotion-products">
                        <small>Productos entregados</small>
                        {report.promotions.products.map((product) => (
                          <span key={product.name}>{product.name} × {product.quantity}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="report-grid report-lists">
                    <div className="panel">
                      <h2>Productos más vendidos</h2>
                      {report.topProducts.length ? (
                        report.topProducts.map((item) => (
                          <div className="setting-row" key={item.name}>
                            <label>
                              {item.name}
                              <small>{item.quantity} unidades</small>
                            </label>
                            <strong>{currency(item.amountCents)}</strong>
                          </div>
                        ))
                      ) : (
                        <div className="empty">
                          Sin ventas de productos en este periodo.
                        </div>
                      )}
                    </div>
                    <div className="panel">
                      <h2>Métodos de pago</h2>
                      {report.paymentsByMethod.length ? (
                        report.paymentsByMethod.map((item) => (
                          <div className="setting-row" key={item.method}>
                            <label>{item.method}</label>
                            <strong>{currency(item.amountCents)}</strong>
                          </div>
                        ))
                      ) : (
                        <div className="empty">Sin cobros en este periodo.</div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          {page === "inventory" && (
            <div className="inventory-page">
              <div className="panel">
                <h2>Productos y stock</h2>
                <p>
                  Cada salida se registra como movimiento y conserva el precio
                  histórico de la venta.
                </p>
                <div className="inventory-list">
                  {products.map((product) => (
                    <div className="setting-row" key={product.id}>
                      <label>
                        {product.name}
                        <small>
                          {product.category === "BEVERAGE" ? "Bebida" : "Snack"} · {product.stockCurrent} disponibles · mínimo{" "}
                          {product.stockMinimum}
                        </small>
                      </label>
                      <strong>{currency(product.salePriceCents)}</strong>
                      {user?.role === "ADMIN" && (
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label={`Editar precio de ${product.name}`}
                          onClick={() => setEditProduct(product)}
                        >
                          <Pencil size={16} />
                        </Button>
                      )}
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          void run(async () => {
                            await api(`/products/${product.id}/stock`, {
                              type: "PURCHASE",
                              quantity: Number(f.get("quantity")),
                              unitCostCents: product.costCents ?? undefined,
                            });
                            const [nextProducts, nextMovements] =
                              await Promise.all([
                                api<ProductView[]>("/products"),
                                api<InventoryMovementView[]>("/inventory"),
                              ]);
                            setProducts(nextProducts);
                            setInventoryMovements(nextMovements);
                            setNotice(
                              `Stock actualizado para ${product.name}.`,
                            );
                          });
                        }}
                      >
                        <input
                          name="quantity"
                          type="number"
                          min="1"
                          defaultValue="1"
                          aria-label={`Cantidad ${product.name}`}
                        />
                        <Button variant="outline">+ stock</Button>
                      </form>
                      {user?.role === "ADMIN" && (
                        <Button
                          variant="destructive"
                          type="button"
                          onClick={() =>
                            setDeleteTarget({
                              type: "product",
                              id: product.id,
                              name: product.name,
                            })
                          }
                        >
                          Eliminar
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                {!products.length && (
                  <div className="empty">Aún no hay productos.</div>
                )}
              </div>
              {user?.role === "ADMIN" && (
                <form
                  className="panel"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(async () => {
                      await api("/products", {
                        name: f.get("name"),
                        category: f.get("category"),
                        stockMinimum: Number(f.get("minimum")),
                        salePriceCents: parseCents(String(f.get("price"))),
                        costCents: f.get("cost")
                          ? parseCents(String(f.get("cost")))
                          : null,
                        active: true,
                      });
                      e.currentTarget.reset();
                      setNotice("Producto creado.");
                    });
                  }}
                >
                  <h2>Nuevo producto</h2>
                  <p>
                    El stock inicial se agrega después como movimiento de
                    compra.
                  </p>
                  <label>
                    Nombre
                    <input
                      name="name"
                      required
                      maxLength={120}
                      placeholder="Bebida"
                    />
                  </label>
                  <label>
                    Tipo de producto
                    <select name="category" defaultValue="SNACK">
                      <option value="BEVERAGE">Bebida</option>
                      <option value="SNACK">Snack</option>
                    </select>
                  </label>
                  <label>
                    Precio de venta (S/)
                    <input
                      name="price"
                      required
                      pattern="\d+(\.\d{1,2})?"
                      placeholder="3.00"
                    />
                  </label>
                  <label>
                    Costo (S/) opcional
                    <input
                      name="cost"
                      pattern="\d+(\.\d{1,2})?"
                      placeholder="1.50"
                    />
                  </label>
                  <label>
                    Stock mínimo
                    <input
                      name="minimum"
                      type="number"
                      min="0"
                      defaultValue="0"
                    />
                  </label>
                  <Button disabled={busy}>Crear producto</Button>
                </form>
              )}
              <div className="panel inventory-history">
                <div className="inventory-history-head">
                  <div>
                    <h2>Movimientos recientes</h2>
                    <p>
                      Registro de entradas, salidas y ajustes del inventario.
                    </p>
                  </div>
                  <span className="status">
                    {inventoryMovements.length} registros
                  </span>
                </div>
                {inventoryMovements.length ? (
                  <div className="table-wrap inventory-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Producto</th>
                          <th>Movimiento</th>
                          <th>Cantidad</th>
                          <th>Stock</th>
                          <th>Costo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inventoryMovements.map((movement) => (
                          <tr key={movement.id}>
                            <td>{stamp(movement.createdAt)}</td>
                            <td>{movement.product.name}</td>
                            <td>
                              {movement.type === "PURCHASE"
                                ? "Entrada"
                                : movement.type === "SALE"
                                  ? "Venta"
                                  : movement.type === "RETURN"
                                    ? "Devolución"
                                    : movement.type === "LOSS"
                                      ? "Pérdida"
                                      : "Ajuste"}
                            </td>
                            <td
                              className={
                                movement.quantity > 0
                                  ? "inventory-increase"
                                  : "inventory-decrease"
                              }
                            >
                              {movement.quantity > 0 ? "+" : ""}
                              {movement.quantity}
                            </td>
                            <td>
                              {movement.stockBefore} → {movement.stockAfter}
                            </td>
                            <td>
                              {movement.unitCostCents === null
                                ? "—"
                                : currency(movement.unitCostCents)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty">
                    Aún no hay movimientos registrados.
                  </div>
                )}
              </div>
            </div>
          )}
          {page === "loyalty" && (
            <div className="loyalty-page">
              <form
                className="panel loyalty-create-panel"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const data = new FormData(form);
                  void run(async () => {
                    await api("/loyalty/cards", {
                      customerName: data.get("customerName"),
                    });
                    form.reset();
                    setNotice("Tarjeta creada.");
                  });
                }}
              >
                <div className="panel-heading">
                  <div>
                    <h2>Nueva tarjeta</h2>
                    <p>Registra al cliente y empieza sus 12 sellos.</p>
                  </div>
                  <Gift size={22} />
                </div>
                <label>
                  Nombre del cliente
                  <input
                    name="customerName"
                    required
                    minLength={2}
                    maxLength={80}
                    placeholder="Nombre y apellido"
                  />
                </label>
                <Button disabled={busy}>Crear tarjeta</Button>
              </form>
              <div className="panel">
                <div className="panel-heading loyalty-toolbar">
                  <div>
                    <h2>Tarjetas activas</h2>
                    <p>
                      Los primeros 6 sellos habilitan una hora gratis; los
                      siguientes 6 habilitan un kit de snacks.
                    </p>
                  </div>
                  <label className="search loyalty-search">
                    <Search size={16} />
                    <input
                      value={loyaltySearch}
                      onChange={(e) => setLoyaltySearch(e.target.value)}
                      placeholder="Buscar cliente"
                      aria-label="Buscar tarjeta por cliente"
                    />
                  </label>
                </div>
                <div className="loyalty-list">
                  {loyaltyCards
                    .filter((card) =>
                      card.customerName
                        .toLocaleLowerCase()
                        .includes(loyaltySearch.toLocaleLowerCase()),
                    )
                    .map((card) => (
                      <article className="loyalty-card" key={card.id}>
                        <div className="loyalty-card-head">
                          <div>
                            <strong>{card.customerName}</strong>
                            <small>
                              {card.stampCount} de 12 sellos · actualizada{" "}
                              {stamp(card.updatedAt)}
                            </small>
                          </div>
                          <span className="status">
                            {card.snackKitAvailable
                              ? "Kit disponible"
                              : card.freeHourAvailable
                                ? "Hora gratis disponible"
                                : "En progreso"}
                          </span>
                          <div className="loyalty-card-tools">
                            <Button
                              type="button"
                              variant="ghost"
                              aria-label={`Editar nombre de ${card.customerName}`}
                              onClick={() => setEditLoyaltyCard(card)}
                            >
                              <Pencil size={16} />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              aria-label={`Eliminar tarjeta de ${card.customerName}`}
                              onClick={() => setDeleteLoyaltyCard(card)}
                            >
                              <Trash2 size={16} />
                            </Button>
                          </div>
                        </div>
                        <div className="stamp-track" aria-label={`${card.stampCount} de 12 sellos`}>
                          <div className="stamp-row">
                            {Array.from({ length: 6 }, (_, index) => (
                              <span
                                className={`stamp-dot ${card.stampCount >= index + 1 ? "filled" : ""}`}
                                key={`first-${index}`}
                              >
                                {index + 1}
                              </span>
                            ))}
                          </div>
                          <div className="stamp-row">
                            {Array.from({ length: 6 }, (_, index) => (
                              <span
                                className={`stamp-dot ${card.stampCount >= index + 7 ? "filled" : ""}`}
                                key={`second-${index}`}
                              >
                                {index + 7}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="loyalty-actions">
                          <Button
                            type="button"
                            variant="outline"
                            disabled={busy || card.freeHourAvailable || card.snackKitAvailable}
                            onClick={() =>
                              void run(async () => {
                                await api(`/loyalty/cards/${card.id}/stamps`, { quantity: 1 });
                                setNotice(`Sello agregado para ${card.customerName}.`);
                              })
                            }
                          >
                            <Plus size={16} /> +1 sello
                          </Button>
                          {card.freeHourAvailable && (
                            <>
                              <select
                                value={chosenLoyaltyStation}
                                onChange={(e) => setChosenLoyaltyStation(e.target.value)}
                                aria-label={`Estación para la hora gratis de ${card.customerName}`}
                              >
                                <option value="">Estación libre…</option>
                                {availableStations.map((availableStation) => (
                                  <option key={availableStation.id} value={availableStation.id}>
                                    {availableStation.name} · {availableStation.type}
                                  </option>
                                ))}
                              </select>
                              <Button
                                type="button"
                                disabled={busy || !chosenLoyaltyStation}
                                onClick={() =>
                                  void run(async () => {
                                    await api(`/loyalty/cards/${card.id}/redeem`, {
                                      rewardType: "FREE_HOUR",
                                      stationId: chosenLoyaltyStation,
                                    });
                                    const selectedStation = availableStations.find((item) => item.id === chosenLoyaltyStation);
                                    setNotice(`Hora gratis iniciada en ${selectedStation?.name ?? "la estación seleccionada"} por 60 minutos.`);
                                    setChosenLoyaltyStation("");
                                  })
                                }
                              >
                                Canjear hora gratis
                              </Button>
                            </>
                          )}
                          {card.snackKitAvailable && (
                            <>
                              <select
                                value={chosenLoyaltySoda}
                                onChange={(e) => setChosenLoyaltySoda(e.target.value)}
                                aria-label={`Bebida del kit de ${card.customerName}`}
                              >
                                <option value="">Elegir bebida…</option>
                                {products
                                  .filter((product) => product.category === "BEVERAGE" && product.stockCurrent > 0)
                                  .map((product) => (
                                    <option key={product.id} value={product.id}>
                                      {product.name} · {product.stockCurrent} disponibles
                                    </option>
                                  ))}
                              </select>
                              <select
                                value={chosenLoyaltySnack}
                                onChange={(e) => setChosenLoyaltySnack(e.target.value)}
                                aria-label={`Snack del kit de ${card.customerName}`}
                              >
                                <option value="">Elegir snack…</option>
                                {products
                                  .filter((product) => product.category === "SNACK" && product.stockCurrent > 0)
                                  .map((product) => (
                                    <option key={product.id} value={product.id}>
                                      {product.name} · {product.stockCurrent} disponibles
                                    </option>
                                  ))}
                              </select>
                              <Button
                                type="button"
                                disabled={busy || !chosenLoyaltySoda || !chosenLoyaltySnack || chosenLoyaltySoda === chosenLoyaltySnack}
                                onClick={() =>
                                  void run(async () => {
                                    await api(`/loyalty/cards/${card.id}/redeem`, {
                                      rewardType: "SNACK_KIT",
                                      sodaProductId: chosenLoyaltySoda,
                                      snackProductId: chosenLoyaltySnack,
                                    });
                                    const soda = products.find((product) => product.id === chosenLoyaltySoda);
                                    const snack = products.find((product) => product.id === chosenLoyaltySnack);
                                    setNotice(`Kit canjeado: ${soda?.name ?? "bebida"} y ${snack?.name ?? "snack"}.`);
                                    setChosenLoyaltySoda("");
                                    setChosenLoyaltySnack("");
                                  })
                                }
                              >
                                Canjear kit
                              </Button>
                            </>
                          )}
                        </div>
                        {card.redemptions.length > 0 && (
                          <small className="loyalty-history">
                            Último canje: {card.redemptions[0]?.rewardType === "FREE_HOUR" ? "hora gratis" : `kit: ${card.redemptions[0]?.sodaProductName ?? "bebida"} + ${card.redemptions[0]?.snackProductName ?? "snack"}`} · {stamp(card.redemptions[0]?.createdAt ?? card.updatedAt)}
                          </small>
                        )}
                      </article>
                    ))}
                </div>
                {!loyaltyCards.length && (
                  <div className="empty">Aún no hay tarjetas registradas.</div>
                )}
              </div>
            </div>
          )}
          {page === "cash" && (
            <div className="settings-grid">
              <div className="panel">
                <h2>Caja del turno</h2>
                {!cash.register ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void run(async () => {
                        await api("/cash/open", {
                          openingAmount: parseCents(String(f.get("opening"))),
                        });
                        setNotice("Caja abierta correctamente.");
                      });
                    }}
                  >
                    <p>Indica el efectivo disponible al comenzar.</p>
                    <label>
                      Monto de apertura (S/)
                      <input
                        name="opening"
                        required
                        pattern="\d+(\.\d{1,2})?"
                        placeholder="0.00"
                      />
                    </label>
                    <Button disabled={busy}>Abrir caja</Button>
                  </form>
                ) : (
                  <div>
                    <div className="receipt">
                      <div>
                        <span>Apertura</span>
                        <strong>{currency(cash.register.openingAmount)}</strong>
                      </div>
                      <div>
                        <span>Efectivo esperado</span>
                        <strong>
                          {currency(cash.register.expectedAmount)}
                        </strong>
                      </div>
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void run(async () => {
                          await api("/cash/close", {
                            closingAmount: parseCents(String(f.get("closing"))),
                          });
                          setNotice("Caja cerrada y diferencia registrada.");
                        });
                      }}
                    >
                      <label>
                        Efectivo contado al cierre (S/)
                        <input
                          name="closing"
                          required
                          pattern="\d+(\.\d{1,2})?"
                          placeholder="0.00"
                        />
                      </label>
                      <Button variant="outline" disabled={busy}>
                        Cerrar caja
                      </Button>
                    </form>
                  </div>
                )}
              </div>
              {cash.register && (
                <form
                  className="panel"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(async () => {
                      await api("/cash/movements", {
                        type: f.get("type"),
                        amount: parseCents(String(f.get("amount"))),
                        reason: f.get("reason"),
                      });
                      setNotice("Movimiento de caja registrado.");
                      e.currentTarget.reset();
                    });
                  }}
                >
                  <h2>Movimiento manual</h2>
                  <p>Registra ingresos, retiros o ajustes con motivo.</p>
                  <label>
                    Tipo
                    <select name="type">
                      <option value="INCOME">Ingreso</option>
                      <option value="WITHDRAWAL">Retiro</option>
                      <option value="ADJUSTMENT">Ajuste</option>
                    </select>
                  </label>
                  <label>
                    Monto (S/)
                    <input name="amount" required pattern="\d+(\.\d{1,2})?" />
                  </label>
                  <label>
                    Motivo
                    <input
                      name="reason"
                      required
                      minLength={2}
                      maxLength={240}
                    />
                  </label>
                  <Button disabled={busy}>Registrar movimiento</Button>
                </form>
              )}
            </div>
          )}
          {page === "settings" && (
            <div className="settings-grid">
              <div className="panel">
                <h2>Tarifas por estación</h2>
                <p>Importes en soles por hora.</p>
                {stations.map((s) => (
                  <form
                    className="setting-row"
                    key={s.id}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void run(async () => {
                        await api(`/stations/${s.id}/rates`, {
                          hourlyCents: parseCents(String(f.get("price"))),
                        });
                        setNotice(
                          "Tarifa actualizada. Las sesiones existentes conservan su precio.",
                        );
                      });
                    }}
                  >
                    <label>
                      {s.name}
                      <small>{s.type}</small>
                    </label>
                    <input
                      name="price"
                      aria-label={`Tarifa ${s.name}`}
                      inputMode="decimal"
                      defaultValue={(s.hourlyCents / 100).toFixed(2)}
                      required
                      pattern="\d+(\.\d{1,2})?"
                    />
                    <Button disabled={busy} variant="outline" type="submit">
                      Guardar
                    </Button>
                  </form>
                ))}
              </div>
              <div className="panel">
                <h2>Extras por sesión</h2>
                <p>Se cobran una sola vez, aunque agregues tiempo.</p>
                {extras.map((e) => (
                  <form
                    className="setting-row"
                    key={e.id}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const f = new FormData(event.currentTarget);
                      void run(async () => {
                        await api(
                          `/extras/${e.id}`,
                          {
                            name: e.name,
                            priceCents: parseCents(String(f.get("price"))),
                            active: true,
                          },
                          "PATCH",
                        );
                        setNotice("Precio del extra actualizado.");
                      });
                    }}
                  >
                    <label>
                      {e.name}
                      <small>Una vez por sesión</small>
                    </label>
                    <input
                      name="price"
                      aria-label={`Precio ${e.name}`}
                      defaultValue={(e.priceCents / 100).toFixed(2)}
                      required
                      pattern="\d+(\.\d{1,2})?"
                    />
                    <Button variant="outline" disabled={busy}>
                      Guardar
                    </Button>
                  </form>
                ))}
                <div className="info">
                  <ShieldCheck size={20} />
                  <p>
                    Los cambios quedan registrados en la auditoría. Los consumos
                    anteriores mantienen el precio original.
                  </p>
                </div>
              </div>
              <form
                className="panel"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await api(
                      "/settings",
                      {
                        key: "ALERT_FIRST_MINUTES",
                        value: settings.first,
                      },
                      "PUT",
                    );
                    await api(
                      "/settings",
                      {
                        key: "ALERT_SECOND_MINUTES",
                        value: settings.second,
                      },
                      "PUT",
                    );
                    await api(
                      "/settings",
                      {
                        key: "NOTIFICATION_SOUND",
                        value: settings.sound,
                      },
                      "PUT",
                    );
                    setNotice("Avisos y sonido actualizados.");
                  });
                }}
              >
                <h2>Avisos de tiempo</h2>
                <p>El sistema avisa y emite un sonido antes del vencimiento.</p>
                <label>
                  Primer aviso (minutos)
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={settings.first}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        first: Number(e.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Segundo aviso (minutos)
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={settings.second}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        second: Number(e.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Sonido de notificación
                  <select
                    value={settings.sound}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, sound: e.target.value }))
                    }
                  >
                    {notificationSoundOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="settings-actions">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={playNotificationSound}
                    disabled={busy}
                  >
                    Probar sonido
                  </Button>
                  <Button disabled={busy}>Guardar avisos</Button>
                </div>
              </form>
            </div>
          )}
          {page === "audit" && (
            <div className="audit-page">
              <div className="audit-toolbar">
                <div className="search">
                  <Search size={16} />
                  <input
                    aria-label="Filtrar acciones"
                    placeholder="Filtrar acción…"
                    value={auditAction}
                    onChange={(e) => setAuditAction(e.target.value)}
                  />
                </div>
                <small>{auditRows.length} registros recientes</small>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Usuario</th>
                      <th>Acción</th>
                      <th>Entidad</th>
                      <th>IP</th>
                      <th>Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditRows.map((row) => (
                      <tr key={row.id}>
                        <td>{stamp(row.createdAt)}</td>
                        <td>{row.user?.name ?? "Usuario eliminado"}</td>
                        <td>
                          <strong>{row.action}</strong>
                        </td>
                        <td>{row.entityType}</td>
                        <td>{row.ipAddress}</td>
                        <td>
                          <details>
                            <summary>Ver cambios</summary>
                            <pre>
                              {JSON.stringify(
                                { antes: row.oldData, después: row.newData },
                                null,
                                2,
                              )}
                            </pre>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!auditRows.length && (
                  <div className="empty">No hay acciones para este filtro.</div>
                )}
              </div>
            </div>
          )}
          {page === "users" && (
            <div className="settings-grid">
              <div className="panel">
                <h2>Trabajadores</h2>
                {users.map((u) => (
                  <div className="user-row" key={u.id}>
                    <span className="avatar">{u.name[0]}</span>
                    <div>
                      <strong>{u.name}</strong>
                      <small>{u.email}</small>
                    </div>
                    <span className="type">
                      {u.role === "ADMIN" ? "Administrador" : "Trabajador"}
                    </span>
                    <div className="user-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={`Editar ${u.name}`}
                        onClick={() => setEditUser(u)}
                      >
                        <Pencil size={16} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={`Restablecer contraseña de ${u.name}`}
                        onClick={() => setResetUser(u)}
                      >
                        <Key size={16} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <form
                className="panel"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget,
                    f = new FormData(form);
                  void run(async () => {
                    await api("/users", {
                      name: f.get("name"),
                      email: f.get("email"),
                      password: f.get("password"),
                      role: f.get("role"),
                    });
                    setUsers(await api("/users"));
                    form.reset();
                    setNotice("Trabajador creado.");
                  });
                }}
              >
                <h2>Nuevo acceso</h2>
                <label>
                  Nombre
                  <input name="name" required minLength={2} />
                </label>
                <label>
                  Correo
                  <input name="email" type="email" required />
                </label>
                <label>
                  Contraseña
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    required
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  Rol
                  <select name="role">
                    <option value="EMPLOYEE">Trabajador</option>
                    <option value="ADMIN">Administrador</option>
                  </select>
                </label>
                <Button disabled={busy}>Crear trabajador</Button>
              </form>
            </div>
          )}
        </section>
      </main>
      {station && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <section
            className={`drawer ${session ? "drawer-session" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={station.name}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-head">
              <span className="eyebrow">DETALLE DE ESTACIÓN</span>
              <Button
                variant="ghost"
                aria-label="Cerrar detalle"
                onClick={() => setSelected(null)}
              >
                <X size={20} />
              </Button>
            </div>
            <div className="drawer-title">
              <span className="device-icon">
                {station.type === "PC" ? <Monitor /> : <Gamepad2 />}
              </span>
              <div>
                <h2>{station.name}</h2>
                <p>
                  {station.type} · {currency(station.hourlyCents)} / hora
                </p>
              </div>
            </div>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            {!session ? (
              <>
                <span className="status status-available">
                  <i />
                  Disponible
                </span>
                {loyaltyCards.some((card) => card.freeHourAvailable) && (
                  <div className="station-loyalty-redeem">
                    <h3>Hora gratis de tarjeta</h3>
                    <p>Elige la tarjeta y comienza 60 minutos sin cobro en esta estación.</p>
                    <div className="loyalty-actions">
                      <select
                        value={chosenLoyaltyCard}
                        onChange={(e) => setChosenLoyaltyCard(e.target.value)}
                        aria-label="Tarjeta con hora gratis"
                      >
                        <option value="">Seleccionar tarjeta…</option>
                        {loyaltyCards
                          .filter((card) => card.freeHourAvailable)
                          .map((card) => (
                            <option key={card.id} value={card.id}>
                              {card.customerName}
                            </option>
                          ))}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy || !connected || !chosenLoyaltyCard}
                        onClick={() =>
                          void run(async () => {
                            await api(`/loyalty/cards/${chosenLoyaltyCard}/redeem`, {
                              rewardType: "FREE_HOUR",
                              stationId: station.id,
                            });
                            setNotice(`Hora gratis iniciada en ${station.name} por 60 minutos.`);
                            setChosenLoyaltyCard("");
                          })
                        }
                      >
                        Canjear aquí
                      </Button>
                    </div>
                  </div>
                )}
                <h3>¿Cuánto tiempo?</h3>
                <div className="duration-options">
                  {[
                    [30, "30 min"],
                    [60, "1 hora"],
                    [120, "2 horas"],
                    [0, "Libre"],
                  ].map(([value, label]) => (
                    <Button
                      key={value}
                      variant={minutes === value ? "default" : "outline"}
                      onClick={() => {
                        setMinutes(Number(value));
                        setCustomMinutes("");
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <label className="custom-duration">
                  Duración personalizada (minutos)
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    inputMode="numeric"
                    placeholder="Ej. 15"
                    value={customMinutes}
                    onChange={(e) => {
                      const value = e.target.value;
                      setCustomMinutes(value);
                      const parsed = Number(value);
                      if (
                        Number.isInteger(parsed) &&
                        parsed >= 1 &&
                        parsed <= 1440
                      )
                        setMinutes(parsed);
                    }}
                  />
                  <small>Se cobra por bloques de 15 minutos.</small>
                </label>
                {station.type !== "PC" && (
                  <>
                    <h3>Extras</h3>
                    {chosen && (
                      <>
                        <label className="extra-check">
                          <input
                            type="checkbox"
                            checked={withExtra}
                            onChange={(e) => setWithExtra(e.target.checked)}
                          />
                          <span>
                            {chosen.name}
                            <small>Se cobra una sola vez por sesión</small>
                          </span>
                          <strong>{currency(chosen.priceCents)}</strong>
                        </label>
                        {withExtra && (
                          <label>
                            Cantidad
                            <select
                              value={extraQuantity}
                              onChange={(e) =>
                                setExtraQuantity(Number(e.target.value))
                              }
                            >
                              {[1, 2, 3, 4].map((n) => (
                                <option key={n}>{n}</option>
                              ))}
                            </select>
                          </label>
                        )}
                      </>
                    )}
                  </>
                )}
                <div className="info">
                  <Clock3 size={20} />
                  <p>
                    {minutes
                      ? "La duración se cobra por bloques de 15 minutos."
                      : "Tiempo libre: cada hora conserva su tarifa y los primeros 10 minutos siguientes no agregan un bloque."}
                  </p>
                </div>
                <Button
                  className="w-full"
                  disabled={busy || !connected}
                  onClick={() =>
                    void run(async () => {
                      await api("/sessions", {
                        stationId: station.id,
                        mode: minutes ? "FIXED" : "OPEN",
                        ...(minutes ? { minutes } : {}),
                        ...(withExtra && chosen
                          ? { extraId: chosen.id, extraQuantity }
                          : {}),
                      });
                      setNotice("Sesión iniciada.");
                    })
                  }
                >
                  Iniciar sesión <ArrowUpRight size={18} />
                </Button>
              </>
            ) : (
              <>
                <div className="session-summary">
                  <div
                    className={`session-clock ${station.status === "FINISHED" ? "expired" : ""}`}
                  >
                    <span>
                      {session.finishedAt
                        ? "SESIÓN FINALIZADA"
                        : session.mode === "OPEN"
                          ? "TIEMPO TRANSCURRIDO"
                          : "TIEMPO RESTANTE"}
                    </span>
                    <strong>
                      {session.finishedAt
                        ? "Pendiente"
                        : duration(session, now)}
                    </strong>
                    <small>Inicio · {stamp(session.startedAt)}</small>
                  </div>
                  <h3>Consumo de la sesión</h3>
                  <div className="receipt">
                    <div>
                      <span>
                        {station.type} ·{" "}
                        {session.mode === "OPEN"
                          ? "Tiempo libre"
                          : `${session.baseMinutes} min`}
                      </span>
                      <strong>{currency(session.baseAmount)}</strong>
                    </div>
                    {session.extras.map((e) => (
                      <div key={e.id}>
                        <span>
                          {e.name} × {e.quantity}
                          <small>Una vez por sesión</small>
                        </span>
                        <strong>{currency(e.total)}</strong>
                      </div>
                    ))}
                    {session.sales
                      .flatMap((sale) => sale.items)
                      .map((item) => (
                        <div key={item.id}>
                          <span>
                            {item.productName} × {item.quantity}
                            <small>Producto</small>
                          </span>
                          <strong>{currency(item.subtotalCents)}</strong>
                        </div>
                      ))}
                    {session.extensions.map((e) => (
                      <div key={e.id}>
                        <span>Extensión · {e.minutesAdded} min</span>
                        <strong>{currency(e.amount)}</strong>
                      </div>
                    ))}
                    <div className="receipt-total">
                      <span>Total actual</span>
                      <strong>{currency(session.totalAmount)}</strong>
                    </div>
                  </div>
                </div>
                <div className="session-actions">
                  {!session.finishedAt && session.status !== "PAUSED" ? (
                    <>
                      {session.mode === "FIXED" &&
                        !session.payments?.length && (
                          <>
                            <h3>Agregar tiempo</h3>
                            <div className="duration-options">
                              {[15, 30, 60, 120].map((n) => (
                                <Button
                                  variant="outline"
                                  key={n}
                                  disabled={busy || !connected}
                                  onClick={() =>
                                    void run(async () => {
                                      await api(
                                        `/sessions/${session.id}/extend`,
                                        {
                                          minutes: n,
                                        },
                                      );
                                      setNotice(
                                        "Tiempo agregado. Los extras no se vuelven a cobrar.",
                                      );
                                    })
                                  }
                                >
                                  +{n < 60 ? `${n} min` : `${n / 60} h`}
                                </Button>
                              ))}
                            </div>
                          </>
                        )}
                      <div className="session-control-actions">
                        <Button
                          variant="outline"
                          disabled={busy || !connected}
                          onClick={() =>
                            void run(async () => {
                              await api(`/sessions/${session.id}/pause`, {});
                              setNotice(
                                "Sesión pausada; el tiempo quedó detenido y la estación sigue operativa.",
                              );
                            })
                          }
                        >
                          Pausar sesión
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy || !connected}
                          onClick={() => {
                            setCancelSessionId(session.id);
                            setCancelReason("");
                          }}
                        >
                          Cancelar sesión
                        </Button>
                      </div>
                      {moveStations.length > 0 && (
                        <div className="move-station">
                          <label>
                            Mover a otra estación
                            <select
                              value={moveStationId}
                              onChange={(e) => setMoveStationId(e.target.value)}
                            >
                              <option value="">Seleccionar estación</option>
                              {moveStations.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.name}
                                </option>
                              ))}
                            </select>
                            <small>
                              Conserva el tiempo, bebidas/snacks y mandos adicionales.
                            </small>
                          </label>
                          <Button
                            variant="outline"
                            disabled={busy || !connected || !moveStationId}
                            onClick={() =>
                              void run(async () => {
                                const target = moveStations.find(
                                  (candidate) => candidate.id === moveStationId,
                                );
                                await api("/sessions/" + session.id + "/move", {
                                  stationId: moveStationId,
                                });
                                setNotice(
                                  "Sesión movida a " +
                                    (target?.name ?? "la nueva estación") +
                                    ". Se conservaron el tiempo y los consumos.",
                                );
                                setSelected(moveStationId);
                                setMoveStationId("");
                              })
                            }
                          >
                            Mover sesión
                          </Button>
                        </div>
                      )}
                      {session.mode === "FIXED" &&
                        !session.payments?.length && (
                          <div className="prepay-box">
                            <label>
                              Cobrar al iniciar (opcional)
                              <select
                                value={paymentMethod}
                                onChange={(e) =>
                                  setPaymentMethod(e.target.value)
                                }
                              >
                                <option value="CASH">Efectivo</option>
                                <option value="YAPE">Yape</option>
                                <option value="PLIN">Plin</option>
                                <option value="CARD">Tarjeta</option>
                                <option value="TRANSFER">Transferencia</option>
                                <option value="OTHER">Otro</option>
                              </select>
                            </label>
                            <Button
                              variant="outline"
                              disabled={busy || !connected || !cash.register}
                              onClick={() =>
                                void run(async () => {
                                  await api(`/sessions/${session.id}/prepay`, {
                                    method: paymentMethod,
                                  });
                                  setNotice(
                                    "Pago anticipado registrado. Puedes guardar la hora cuando el cliente se retire.",
                                  );
                                })
                              }
                            >
                              Cobrar ahora · {currency(session.totalAmount)}
                            </Button>
                          </div>
                        )}
                      {session.mode === "FIXED" &&
                        !!session.payments?.length && (
                          <Button
                            variant="outline"
                            disabled={busy || !connected}
                            onClick={() =>
                              void run(async () => {
                                const saved = await api<SessionView>(
                                  `/sessions/${session.id}/save`,
                                  {},
                                );
                                setNotice(
                                  `Hora guardada. Código de validación: ${saved.savedCode ?? "—"}`,
                                );
                                setSelected(null);
                              })
                            }
                          >
                            Guardar hora restante
                          </Button>
                        )}
                      {!session.payments?.length &&
                        station.type !== "PC" &&
                        extras.some((e) => {
                          const current = session.extras.find(
                            (x) => x.name === e.name,
                          );
                          return !current || current.quantity < 4;
                        }) && (
                          <div className="add-extra">
                            <label>
                              Agregar extra
                              <select
                                value={chosenExtra}
                                onChange={(e) => {
                                  setChosenExtra(e.target.value);
                                  setExtraQuantity(1);
                                }}
                              >
                                <option value="">Seleccionar</option>
                                {extras.map((e) => (
                                  <option
                                    key={e.id}
                                    value={e.id}
                                    disabled={
                                      (session.extras.find(
                                        (x) => x.name === e.name,
                                      )?.quantity ?? 0) >= 4
                                    }
                                  >
                                    {e.name} · {currency(e.priceCents)}
                                    {session.extras.some(
                                      (x) => x.name === e.name,
                                    )
                                      ? ` · actual ${session.extras.find((x) => x.name === e.name)?.quantity ?? 0}`
                                      : ""}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Cantidad
                              <select
                                value={extraQuantity}
                                onChange={(e) =>
                                  setExtraQuantity(Number(e.target.value))
                                }
                                disabled={!chosenExtra}
                              >
                                {[1, 2, 3, 4]
                                  .filter((n) => n <= maxExtraQuantity)
                                  .map((n) => (
                                  <option key={n} value={n}>
                                    {n} {n === 1 ? "mando" : "mandos"}
                                  </option>
                                  ))}
                              </select>
                            </label>
                            <Button
                              variant="outline"
                              disabled={!chosenExtra || busy || !connected}
                              onClick={() =>
                                void run(async () => {
                                  await api(`/sessions/${session.id}/extras`, {
                                    extraId: chosenExtra,
                                    quantity: extraQuantity,
                                  });
                                  setNotice(
                                    `${extraQuantity} ${extraQuantity === 1 ? "mando agregado" : "mandos agregados"} a la sesión.`,
                                  );
                                  setChosenExtra("");
                                  setExtraQuantity(1);
                                })
                              }
                            >
                              <Plus size={18} />
                            </Button>
                          </div>
                        )}
                      {confirmFinish ? (
                        <div className="confirm">
                          <p>
                            Se detendrá la sesión y quedará pendiente de pago.
                            No podrás agregar más tiempo.
                          </p>
                          <Button
                            variant="destructive"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await api(`/sessions/${session.id}/finish`, {});
                                setConfirmFinish(false);
                                setNotice(
                                  "Sesión finalizada y conservada en el historial. Pendiente de pago.",
                                );
                              })
                            }
                          >
                            Confirmar finalización
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => setConfirmFinish(false)}
                          >
                            Volver
                          </Button>
                        </div>
                      ) : (
                        <Button
                          className="w-full mt-6"
                          variant="destructive"
                          disabled={busy || !connected}
                          onClick={() => setConfirmFinish(true)}
                        >
                          Finalizar sesión
                        </Button>
                      )}
                    </>
                  ) : session.status === "PAUSED" ? (
                    <>
                      <div className="info">
                        <Clock3 size={22} />
                        <p>
                          <strong>Sesión pausada</strong>
                          <br />
                          El tiempo está detenido. La estación sigue disponible
                          para esta sesión.
                        </p>
                      </div>
                      <Button
                        className="w-full"
                        disabled={busy || !connected}
                        onClick={() =>
                          void run(async () => {
                            await api(`/sessions/${session.id}/resume`, {});
                            setNotice("Sesión reanudada.");
                          })
                        }
                      >
                        Reanudar sesión
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy || !connected}
                        onClick={() => {
                          setCancelSessionId(session.id);
                          setCancelReason("");
                        }}
                      >
                        Cancelar sesión
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="info">
                        <ShieldCheck size={22} />
                        <p>
                          <strong>Pendiente de pago</strong>
                          <br />
                          El historial está guardado. Registra el pago para
                          liberar la estación.
                        </p>
                      </div>
                      <label>
                        Método de pago
                        <select
                          value={paymentMethod}
                          onChange={(e) => setPaymentMethod(e.target.value)}
                        >
                          <option value="CASH">Efectivo</option>
                          <option value="YAPE">Yape</option>
                          <option value="PLIN">Plin</option>
                          <option value="CARD">Tarjeta</option>
                          <option value="TRANSFER">Transferencia</option>
                          <option value="OTHER">Otro</option>
                        </select>
                      </label>
                      <Button
                        className="w-full mt-4"
                        disabled={busy || !connected || !cash.register}
                        onClick={() =>
                          void run(async () => {
                            await api(`/sessions/${session.id}/pay`, {
                              method: paymentMethod,
                            });
                            setNotice("Pago registrado y estación liberada.");
                            setSelected(null);
                          })
                        }
                      >
                        Registrar pago · {currency(session.totalAmount)}
                      </Button>
                    </>
                  )}
                  {!session.finishedAt &&
                    session.status !== "PAUSED" &&
                    !session.payments?.length &&
                    products.length > 0 && (
                      <div className="add-extra product-add">
                        <label>
                          Agregar producto
                          <select
                            value={chosenProduct}
                            onChange={(e) => setChosenProduct(e.target.value)}
                          >
                            <option value="">Seleccionar</option>
                            {products.map((p) => (
                              <option
                                key={p.id}
                                value={p.id}
                                disabled={p.stockCurrent <= 0}
                              >
                                {p.name} · {currency(p.salePriceCents)} ·{" "}
                                {p.stockCurrent > 0
                                  ? `stock ${p.stockCurrent}`
                                  : "sin stock"}
                              </option>
                            ))}
                          </select>
                        </label>
                        <Button
                          variant="outline"
                          disabled={
                            !chosenProduct ||
                            products.find((p) => p.id === chosenProduct)
                              ?.stockCurrent === 0 ||
                            busy ||
                            !connected
                          }
                          onClick={() =>
                            void run(async () => {
                              await api(`/sessions/${session.id}/products`, {
                                items: [
                                  { productId: chosenProduct, quantity: 1 },
                                ],
                              });
                              setChosenProduct("");
                              setNotice(
                                "Producto agregado y stock descontado.",
                              );
                            })
                          }
                        >
                          <Plus size={18} />
                        </Button>
                      </div>
                    )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {cancelSessionId && (
        <div
          className="drawer-backdrop"
          onClick={() => setCancelSessionId(null)}
        >
          <form
            className="modal confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-session-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const reason = cancelReason.trim();
              if (reason.length < 3) return;
              void run(async () => {
                await api(`/sessions/${cancelSessionId}/cancel`, { reason });
                setNotice("Sesión cancelada sin cobro. El motivo quedó registrado.");
                setCancelSessionId(null);
                setCancelReason("");
                setSelected(null);
              });
            }}
          >
            <div className="drawer-head">
              <span className="eyebrow">CANCELAR SESIÓN</span>
              <Button
                type="button"
                variant="ghost"
                aria-label="Cerrar"
                onClick={() => setCancelSessionId(null)}
              >
                <X />
              </Button>
            </div>
            <h2 id="cancel-session-title">¿Por qué se cancela?</h2>
            <p>
              La sesión se cerrará sin cobro y quedará visible en Historial con
              este motivo.
            </p>
            <label>
              Motivo de cancelación
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                minLength={3}
                maxLength={240}
                rows={3}
                placeholder="Ej.: se eligió la estación equivocada"
                autoFocus
                required
              />
            </label>
            <div className="confirm-actions">
              <Button
                type="submit"
                variant="destructive"
                disabled={busy || !connected || cancelReason.trim().length < 3}
              >
                Confirmar cancelación
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCancelSessionId(null)}
              >
                Volver
              </Button>
            </div>
          </form>
        </div>
      )}
      {createStation && (
        <div className="drawer-backdrop">
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Nueva estación"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                await api("/stations", {
                  name: f.get("name"),
                  type: f.get("type"),
                  hourlyCents: parseCents(String(f.get("price"))),
                });
                setCreateStation(false);
                setNotice("Estación creada.");
              });
            }}
          >
            <div className="drawer-head">
              <h2>Nueva estación</h2>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateStation(false)}
                aria-label="Cerrar"
              >
                <X />
              </Button>
            </div>
            {error && <div className="error">{error}</div>}
            <label>
              Nombre
              <input
                name="name"
                required
                maxLength={60}
                placeholder="PLAY 04"
                autoFocus
              />
            </label>
            <label>
              Tipo
              <select name="type">
                {stationTypes.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Tarifa por hora (S/)
              <input
                name="price"
                required
                inputMode="decimal"
                pattern="\d+(\.\d{1,2})?"
                placeholder="8.00"
              />
            </label>
            <Button disabled={busy}>Crear estación</Button>
          </form>
        </div>
      )}
      {deleteTarget && (
        <div className="drawer-backdrop" onClick={() => setDeleteTarget(null)}>
          <div
            className="modal confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-head">
              <span className="eyebrow">CONFIRMAR ELIMINACIÓN</span>
              <Button
                type="button"
                variant="ghost"
                aria-label="Cerrar"
                onClick={() => setDeleteTarget(null)}
              >
                <X />
              </Button>
            </div>
            <h2 id="delete-title">
              ¿Eliminar{" "}
              {deleteTarget.type === "station" ? "estación" : "producto"}?
            </h2>
            <p>
              <strong>{deleteTarget.name}</strong> dejará de aparecer en la
              operación diaria. Su historial se conservará.
            </p>
            <div className="confirm-actions">
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const path =
                      deleteTarget.type === "station"
                        ? `/stations/${deleteTarget.id}`
                        : `/products/${deleteTarget.id}`;
                    await api(path, {}, "DELETE");
                    if (deleteTarget.type === "station")
                      setStations((current) =>
                        current.filter((item) => item.id !== deleteTarget.id),
                      );
                    else
                      setProducts((current) =>
                        current.filter((item) => item.id !== deleteTarget.id),
                      );
                    setNotice(`${deleteTarget.name} fue eliminado.`);
                    setDeleteTarget(null);
                  })
                }
              >
                Eliminar
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteTarget(null)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
      {editUser && (
        <div className="drawer-backdrop" onClick={() => setEditUser(null)}>
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Editar ${editUser.name}`}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                await api(
                  `/users/${editUser.id}`,
                  {
                    name: f.get("name"),
                    email: f.get("email"),
                    role: f.get("role"),
                  },
                  "PATCH",
                );
                setUsers(await api("/users"));
                setEditUser(null);
                setNotice("Trabajador actualizado.");
              });
            }}
          >
            <div className="drawer-head">
              <h2>Editar trabajador</h2>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditUser(null)}
                aria-label="Cerrar"
              >
                <X />
              </Button>
            </div>
            <label>
              Nombre
              <input
                name="name"
                defaultValue={editUser.name}
                required
                minLength={2}
              />
            </label>
            <label>
              Correo
              <input
                name="email"
                type="email"
                defaultValue={editUser.email}
                required
              />
            </label>
            <label>
              Rol
              <select name="role" defaultValue={editUser.role}>
                <option value="EMPLOYEE">Trabajador</option>
                <option value="ADMIN">Administrador</option>
              </select>
            </label>
            <div className="confirm-actions">
              <Button disabled={busy}>Guardar cambios</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditUser(null)}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </div>
      )}
      {resetUser && (
        <div className="drawer-backdrop" onClick={() => setResetUser(null)}>
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Restablecer contraseña de ${resetUser.name}`}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const password = String(f.get("password"));
              const confirmation = String(f.get("confirmation"));
              if (password !== confirmation) {
                setError("Las contraseñas no coinciden");
                return;
              }
              void run(async () => {
                await api(
                  `/users/${resetUser.id}/password`,
                  { password },
                  "PUT",
                );
                setResetUser(null);
                setNotice("Contraseña restablecida.");
              });
            }}
          >
            <div className="drawer-head">
              <h2>Nueva contraseña</h2>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setResetUser(null)}
                aria-label="Cerrar"
              >
                <X />
              </Button>
            </div>
            <p>
              Define una nueva contraseña para <strong>{resetUser.name}</strong>
              .
            </p>
            <label>
              Nueva contraseña
              <input
                name="password"
                type="password"
                minLength={12}
                required
                autoComplete="new-password"
              />
            </label>
            <label>
              Repetir contraseña
              <input
                name="confirmation"
                type="password"
                minLength={12}
                required
                autoComplete="new-password"
              />
            </label>
            <div className="confirm-actions">
              <Button disabled={busy}>Restablecer</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setResetUser(null)}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </div>
      )}
      {editLoyaltyCard && (
        <div
          className="drawer-backdrop"
          onClick={() => setEditLoyaltyCard(null)}
        >
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Editar ${editLoyaltyCard.customerName}`}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void run(async () => {
                await api(
                  `/loyalty/cards/${editLoyaltyCard.id}`,
                  { customerName: form.get("customerName") },
                  "PATCH",
                );
                setEditLoyaltyCard(null);
                setNotice("Nombre de tarjeta actualizado.");
              });
            }}
          >
            <div className="drawer-head">
              <h2>Editar tarjeta</h2>
              <Button
                type="button"
                variant="ghost"
                aria-label="Cerrar"
                onClick={() => setEditLoyaltyCard(null)}
              >
                <X />
              </Button>
            </div>
            <p className="modal-help">
              Actualiza el nombre sin modificar sellos, premios ni canjes.
            </p>
            <label>
              Nombre del cliente
              <input
                name="customerName"
                defaultValue={editLoyaltyCard.customerName}
                minLength={2}
                maxLength={80}
                autoFocus
                required
              />
            </label>
            <div className="confirm-actions">
              <Button disabled={busy}>Guardar cambios</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditLoyaltyCard(null)}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </div>
      )}
      {deleteLoyaltyCard && (
        <div
          className="drawer-backdrop"
          onClick={() => setDeleteLoyaltyCard(null)}
        >
          <div
            className="modal confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-loyalty-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-head">
              <span className="eyebrow">ELIMINAR TARJETA</span>
              <Button
                type="button"
                variant="ghost"
                aria-label="Cerrar"
                onClick={() => setDeleteLoyaltyCard(null)}
              >
                <X />
              </Button>
            </div>
            <h2 id="delete-loyalty-title">¿Eliminar tarjeta?</h2>
            <p>
              <strong>{deleteLoyaltyCard.customerName}</strong> dejará de
              aparecer en Tarjetas. Sus sellos, premios y canjes históricos se
              conservarán.
            </p>
            <div className="confirm-actions">
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api(
                      `/loyalty/cards/${deleteLoyaltyCard.id}`,
                      {},
                      "DELETE",
                    );
                    setDeleteLoyaltyCard(null);
                    setNotice("Tarjeta eliminada; su historial se conservó.");
                  })
                }
              >
                Eliminar tarjeta
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteLoyaltyCard(null)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
      {editProduct && (
        <div className="drawer-backdrop" onClick={() => setEditProduct(null)}>
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Editar ${editProduct.name}`}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                await api(
                  `/products/${editProduct.id}`,
                  {
                    name: editProduct.name,
                    category: f.get("category"),
                    salePriceCents: parseCents(String(f.get("price"))),
                    costCents: f.get("cost")
                      ? parseCents(String(f.get("cost")))
                      : null,
                    stockMinimum: Number(f.get("minimum")),
                    active: true,
                  },
                  "PATCH",
                );
                setProducts(await api<ProductView[]>("/products"));
                setEditProduct(null);
                setNotice(`${editProduct.name} actualizado.`);
              });
            }}
          >
            <div className="drawer-head">
              <h2>Editar producto</h2>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditProduct(null)}
                aria-label="Cerrar"
              >
                <X />
              </Button>
            </div>
            <p>Actualiza precios sin modificar las existencias actuales.</p>
            <label>
              Producto
              <input value={editProduct.name} disabled readOnly />
            </label>
            <label>
              Tipo de producto
              <select name="category" defaultValue={editProduct.category}>
                <option value="BEVERAGE">Bebida</option>
                <option value="SNACK">Snack</option>
              </select>
            </label>
            <label>
              Precio de venta (S/)
              <input
                name="price"
                required
                pattern="\d+(\.\d{1,2})?"
                defaultValue={(editProduct.salePriceCents / 100).toFixed(2)}
              />
            </label>
            <label>
              Costo (S/) opcional
              <input
                name="cost"
                pattern="\d+(\.\d{1,2})?"
                defaultValue={
                  editProduct.costCents === null
                    ? ""
                    : (editProduct.costCents / 100).toFixed(2)
                }
              />
            </label>
            <label>
              Stock mínimo
              <input
                name="minimum"
                type="number"
                min="0"
                defaultValue={editProduct.stockMinimum}
              />
            </label>
            <div className="confirm-actions">
              <Button disabled={busy}>Guardar cambios</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditProduct(null)}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </div>
      )}
      {busy && (
        <div className="busy-overlay" role="status" aria-live="polite">
          <div className="busy-card">
            <RefreshCw className="busy-icon" size={20} />
            <span>Procesando operación…</span>
          </div>
        </div>
      )}
    </div>
  );
}
function parseCents(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error("Escribe un precio válido con máximo dos decimales");
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
