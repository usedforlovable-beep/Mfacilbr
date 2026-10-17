import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  History,
  Loader2,
  Moon,
  Minus,
  Plus,
  RefreshCw,
  ScanLine,
  Settings2,
  ShoppingCart,
  Sun,
  Trash2,
} from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { LabelCamera } from "@/components/LabelCamera";
import { apiRequest } from "@/lib/api-client";
import type {
  CartItem,
  CartItemInput,
  PublicPrice,
  StoredScan,
  TicketData,
} from "@/shared/api-types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mercado Fácil — Escaneie a etiqueta e some sua compra" },
      {
        name: "description",
        content:
          "Escaneie etiquetas de preço em tempo real e confira os produtos e valores da sua compra.",
      },
      { property: "og:title", content: "Mercado Fácil — Escaneie a etiqueta" },
      {
        property: "og:description",
        content: "Escaneamento automático da etiqueta e total da compra em uma só tela.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const scanDate = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
type WorkspaceView = "scan" | "history" | "settings";

const legacyCartSchema = z
  .array(
    z
      .object({
        name: z.string().trim().min(1).max(160),
        size: z.string().trim().max(30).optional(),
        price: z.number().finite().positive().max(100_000),
        qty: z.number().int().min(1).max(999),
      })
      .passthrough(),
  )
  .max(200);

function Index() {
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("scan");
  const [scanHistory, setScanHistory] = useState<StoredScan[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyLoadAttempt, setHistoryLoadAttempt] = useState(0);
  const [expandedHistoryId, setExpandedHistoryId] = useState("");
  const [priceHistory, setPriceHistory] = useState<Record<string, PublicPrice[]>>({});
  const [priceHistoryLoading, setPriceHistoryLoading] = useState("");
  const [priceHistoryError, setPriceHistoryError] = useState("");
  const [darkTheme, setDarkTheme] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem("mf-theme") === "dark",
  );
  const [serviceStatus, setServiceStatus] = useState<"loading" | "online" | "error">("loading");
  const [serviceError, setServiceError] = useState("");
  const [serviceCheckAttempt, setServiceCheckAttempt] = useState(0);
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [size, setSize] = useState("");
  const [confirmPrice, setConfirmPrice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState(1);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [index, setIndex] = useState(0);
  const [msg, setMsg] = useState("");
  const [cartError, setCartError] = useState("");
  const [legacyCartWarning, setLegacyCartWarning] = useState("");
  const [cartReady, setCartReady] = useState(false);
  const [cartLoadAttempt, setCartLoadAttempt] = useState(0);
  const [cameraOpen, setCameraOpen] = useState(false);
  const scanAbort = useRef<AbortController | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const skipInitialCartSave = useRef(true);

  useEffect(() => () => scanAbort.current?.abort(), []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkTheme);
    window.localStorage.setItem("mf-theme", darkTheme ? "dark" : "light");
  }, [darkTheme]);

  useEffect(() => {
    if (workspaceView !== "history") return;
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError("");
    void apiRequest<{ scans: StoredScan[] }>("/scans?limit=100", { signal: controller.signal })
      .then(({ scans }) => setScanHistory(scans))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setHistoryError(
            error instanceof Error ? error.message : "Não foi possível carregar o histórico.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [workspaceView, historyLoadAttempt]);

  useEffect(() => {
    if (workspaceView !== "settings") return;
    const controller = new AbortController();
    setServiceStatus("loading");
    setServiceError("");
    void apiRequest<{ status: string; database: string }>("/health", { signal: controller.signal })
      .then(() => setServiceStatus("online"))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setServiceStatus("error");
          setServiceError(
            error instanceof Error ? error.message : "Não foi possível verificar a conexão.",
          );
        }
      });
    return () => controller.abort();
  }, [workspaceView, serviceCheckAttempt]);

  const togglePriceHistory = async (scan: StoredScan) => {
    const barcode = scan.barcode;
    if (!barcode) return;
    if (expandedHistoryId === scan.id) {
      setExpandedHistoryId("");
      return;
    }
    setExpandedHistoryId(scan.id);
    setPriceHistoryError("");
    if (priceHistory[barcode]) return;

    setPriceHistoryLoading(scan.id);
    try {
      const query = new URLSearchParams({ code: barcode });
      const result = await apiRequest<{ prices: PublicPrice[] }>(`/prices?${query}`);
      setPriceHistory((history) => ({ ...history, [barcode]: result.prices }));
    } catch (error) {
      setPriceHistoryError(
        error instanceof Error ? error.message : "Não foi possível carregar os preços.",
      );
    } finally {
      setPriceHistoryLoading("");
    }
  };

  const scanFrame = useCallback(async (image: string) => {
    const controller = new AbortController();
    scanAbort.current = controller;
    setBusy(true);
    setMsg("");
    try {
      const response = await apiRequest<{ ticket: TicketData }>("/tickets/scan", {
        method: "POST",
        body: JSON.stringify({ image }),
        signal: controller.signal,
      });
      const result = response.ticket;
      if (!result?.readable) return false;

      setTicket(result);
      setName(result.product_name ?? "");
      setSize([result.size, result.unit].filter(Boolean).join(" "));
      const detectedPrice = result.promo_price ?? result.price;
      if (detectedPrice != null) setPrice(detectedPrice.toFixed(2).replace(".", ","));
      const hasMultiplePrices =
        [result.price, result.promo_price, result.member_price].filter((value) => value != null)
          .length > 1;
      setConfirmPrice(
        detectedPrice == null || result.price_uncertain || hasMultiplePrices || detectedPrice >= 50,
      );
      const missing = [
        !result.product_name && "nome do produto",
        detectedPrice == null && "preço",
      ].filter(Boolean);
      setMsg(missing.length ? `Não consegui ler: ${missing.join(" e ")}. Preencha os campos.` : "");
      setQty(1);
      setCameraOpen(false);
      return true;
    } catch (error) {
      if (controller.signal.aborted) return false;
      throw error instanceof Error
        ? error
        : new Error("Não foi possível processar a imagem da câmera.");
    } finally {
      if (scanAbort.current === controller) scanAbort.current = null;
      setBusy(false);
    }
  }, []);

  const handleCameraError = useCallback((message: string) => {
    setCameraOpen(false);
    setMsg(message);
    scanAbort.current?.abort();
  }, []);

  const toggleCamera = () => {
    if (cameraOpen) {
      scanAbort.current?.abort();
      scanAbort.current = null;
      setCameraOpen(false);
      setMsg("");
      return;
    }
    setTicket(null);
    setName("");
    setSize("");
    setPrice("");
    setConfirmPrice(false);
    setMsg("");
    setCameraOpen(true);
  };

  const value = Number(price.replace(/\./g, "").replace(",", ".")) || 0;
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const current = cart[index];

  const addToCart = () => {
    if (!value) {
      setMsg("Informe o valor do produto.");
      return;
    }
    if (confirmPrice) {
      setMsg("Confirme o valor destacado antes de adicionar.");
      return;
    }
    const label = name.trim() || "Item avulso";
    setCart((c) => {
      const n = [
        ...c,
        {
          name: label,
          ...(size.trim() ? { size: size.trim() } : {}),
          price: value,
          qty,
          id: crypto.randomUUID(),
        },
      ];
      setIndex(n.length - 1);
      return n;
    });
    setQty(1);
    setPrice("");
    setName("");
    setSize("");
    setMsg("");
    setTicket(null);
    setConfirmPrice(false);
  };
  const changeCurrent = (d: number) =>
    setCart((c) =>
      c.flatMap((i, k) => (k !== index ? [i] : i.qty + d > 0 ? [{ ...i, qty: i.qty + d }] : [])),
    );
  useEffect(() => {
    let cancelled = false;
    const loadCart = async () => {
      try {
        const saved = await apiRequest<{ items: CartItem[]; legacyImported: boolean }>("/cart");
        let items = saved.items;
        let warning = "";
        if (!saved.legacyImported) {
          const legacy = localStorage.getItem("mf-cart");
          let oldItems: CartItemInput[] = [];
          if (legacy) {
            let parsed: unknown;
            try {
              parsed = JSON.parse(legacy);
            } catch {
              warning = "O carrinho antigo não pôde ser lido e foi preservado neste navegador.";
            }
            if (!warning) {
              const parsedItems = legacyCartSchema.safeParse(parsed);
              if (parsedItems.success) {
                oldItems = parsedItems.data.map(
                  ({ name: itemName, size: itemSize, price: itemPrice, qty: itemQty }) => ({
                    name: itemName,
                    ...(itemSize !== undefined && { size: itemSize }),
                    price: itemPrice,
                    qty: itemQty,
                  }),
                );
              } else {
                warning = "O carrinho antigo tem dados inválidos e foi preservado neste navegador.";
              }
            }
          }
          const imported = await apiRequest<{ items: CartItem[]; legacyImported: boolean }>(
            "/cart/import-legacy",
            {
              method: "POST",
              body: JSON.stringify({ items: oldItems }),
            },
          );
          items = imported.items;
        }
        if (!cancelled) {
          setCart(items);
          setCartError("");
          setLegacyCartWarning(warning);
          setCartReady(true);
        }
      } catch (error) {
        if (!cancelled) {
          setCartError(
            error instanceof Error ? error.message : "Não foi possível carregar o carrinho salvo.",
          );
        }
      }
    };
    void loadCart();
    return () => {
      cancelled = true;
    };
  }, [cartLoadAttempt]);
  useEffect(() => {
    if (!cartReady) return;
    if (skipInitialCartSave.current) {
      skipInitialCartSave.current = false;
      return;
    }
    const items: CartItemInput[] = cart.map(
      ({ name: itemName, size: itemSize, price: itemPrice, qty: itemQty }) => ({
        name: itemName,
        ...(itemSize !== undefined && { size: itemSize }),
        price: itemPrice,
        qty: itemQty,
      }),
    );
    saveQueue.current = saveQueue.current
      .catch(() => undefined)
      .then(async () => {
        await apiRequest<{ items: CartItem[] }>("/cart", {
          method: "PUT",
          body: JSON.stringify({ items }),
        });
        setCartError("");
      })
      .catch((error: unknown) => {
        setCartError(
          error instanceof Error
            ? `O carrinho não foi salvo: ${error.message}`
            : "O carrinho não foi salvo.",
        );
      });
  }, [cart, cartReady]);
  useEffect(() => {
    if (index > cart.length - 1) setIndex(Math.max(0, cart.length - 1));
  }, [cart.length, index]);

  return (
    <main className="scanner-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <img src="/favicon.png" alt="Mercado Fácil" className="brand-logo" fetchPriority="high" />
          <div>
            <p className="brand-eyebrow">MERCADO FÁCIL</p>
            <h1>Uma compra mais consciente.</h1>
            <p className="brand-subtitle">Preços claros. Escolhas melhores.</p>
          </div>
        </div>
        <div className="header-summary">
          <span className="header-summary-label">TOTAL DA COMPRA</span>
          <strong>{cartReady ? brl(total) : "—"}</strong>
        </div>
      </header>

      <nav className="workspace-tabs" aria-label="Navegação principal">
        <button
          className="workspace-tab"
          data-active={workspaceView === "scan"}
          aria-current={workspaceView === "scan" ? "page" : undefined}
          onClick={() => setWorkspaceView("scan")}
        >
          <ScanLine />
          <span>Escanear</span>
        </button>
        <button
          className="workspace-tab"
          data-active={workspaceView === "history"}
          aria-current={workspaceView === "history" ? "page" : undefined}
          onClick={() => setWorkspaceView("history")}
        >
          <History />
          <span>Histórico</span>
        </button>
        <button
          className="workspace-tab"
          data-active={workspaceView === "settings"}
          aria-current={workspaceView === "settings" ? "page" : undefined}
          onClick={() => setWorkspaceView("settings")}
        >
          <Settings2 />
          <span>Ajustes</span>
        </button>
      </nav>

      {workspaceView === "scan" && (
        <section className="scanner-workspace" aria-labelledby="scan-heading">
          <div className="section-intro">
            <div>
              <p className="section-eyebrow">NO MERCADO, COM CALMA</p>
              <h2 id="scan-heading">Leia a etiqueta. Compare com confiança.</h2>
            </div>
            <span className="privacy-note">
              <CircleCheck aria-hidden="true" />
              Escaneamento iniciado por você
            </span>
          </div>
          <div className="scanner-card">
            <div className="camera-heading">
              <div>
                <span className="card-overline">LEITURA DE PREÇO</span>
                <h3>Etiqueta do produto</h3>
              </div>
              <span className="camera-state" data-active={cameraOpen}>
                <span className="state-dot" />
                {cameraOpen ? "Escaneando" : "Câmera pausada"}
              </span>
            </div>
            <section className="camera-box">
              {cameraOpen ? (
                <LabelCamera onScan={scanFrame} onError={handleCameraError} />
              ) : (
                <div className="camera-placeholder">
                  <span className="camera-placeholder-icon">
                    <Camera />
                  </span>
                  <strong>Pronto para escanear</strong>
                  <span>Enquadre a etiqueta para ler o preço em tempo real.</span>
                </div>
              )}
              {busy && (
                <div className="camera-busy" role="status">
                  <Loader2 className="spin" /> Analisando a etiqueta…
                </div>
              )}
            </section>
            <Button
              className="add-btn scan-primary"
              disabled={busy && !cameraOpen}
              onClick={toggleCamera}
              aria-pressed={cameraOpen}
            >
              <Camera />
              {cameraOpen ? "PARAR ESCANEAMENTO" : "ESCANEAR ETIQUETA"}
            </Button>
            <p className="scan-disclosure">
              {cameraOpen
                ? "Mantenha a etiqueta dentro do quadro. A leitura acontece automaticamente."
                : "A câmera só é ativada quando você inicia o escaneamento."}
            </p>

            {ticket && (
              <details className="raw-text">
                <summary>Texto lido da etiqueta</summary>
                <pre>{ticket.raw_text}</pre>
                {(ticket.promo_price != null || ticket.member_price != null) && (
                  <p>
                    {ticket.price != null && `Normal: ${brl(ticket.price)} `}
                    {ticket.promo_price != null && `· Promoção: ${brl(ticket.promo_price)} `}
                    {ticket.member_price != null && `· Clube: ${brl(ticket.member_price)}`}
                  </p>
                )}
              </details>
            )}

            <div className="product-fields">
              <label className="form-field">
                <span>Produto</span>
                <input
                  className="code-input"
                  placeholder="Nome do produto"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={160}
                />
              </label>
              <label className="form-field">
                <span>Tamanho</span>
                <input
                  className="code-input"
                  placeholder="Ex.: 500 ml"
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  maxLength={30}
                />
              </label>
            </div>

            <div className="cart-editor">
              <div className="quantity-control">
                <span className="field-label">QUANTIDADE</span>
                <div className="quantity-buttons">
                  <Button
                    variant="outline"
                    size="icon"
                    className="big-btn"
                    aria-label="Diminuir quantidade"
                    disabled={qty <= 1}
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                  >
                    <Minus />
                  </Button>
                  <strong>{qty}</strong>
                  <Button
                    variant="outline"
                    size="icon"
                    className="big-btn"
                    aria-label="Aumentar quantidade"
                    onClick={() => setQty((q) => q + 1)}
                  >
                    <Plus />
                  </Button>
                </div>
              </div>
              <label className="price-editor" data-confirm={confirmPrice}>
                <span className="field-label">PREÇO UNITÁRIO</span>
                <span className="price-field">
                  <span>R$</span>
                  <input
                    inputMode="decimal"
                    placeholder="0,00"
                    value={price}
                    onChange={(e) => {
                      setPrice(e.target.value.replace(/[^\d,.]/g, ""));
                      setConfirmPrice(false);
                    }}
                    aria-label="Valor unitário"
                  />
                </span>
              </label>
            </div>

            {confirmPrice && price && (
              <div className="confirm-price" role="status">
                <span>
                  Confira o valor lido: <strong>R$ {price}</strong>
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    setConfirmPrice(false);
                    setMsg("");
                  }}
                >
                  Confirmar valor
                </Button>
              </div>
            )}
            {msg && (
              <p className="scan-msg" role="status">
                {msg}
              </p>
            )}
            {cartError && (
              <p className="scan-msg" role="alert">
                {cartError}
              </p>
            )}
            {legacyCartWarning && (
              <p className="scan-msg" role="status">
                {legacyCartWarning}
              </p>
            )}
            {!cartReady && cartError && (
              <Button
                variant="outline"
                onClick={() => setCartLoadAttempt((attempt) => attempt + 1)}
              >
                Tentar carregar carrinho novamente
              </Button>
            )}
            <Button
              className="add-btn cart-primary"
              onClick={addToCart}
              disabled={busy || !cartReady}
            >
              <ShoppingCart />
              Adicionar ao carrinho
            </Button>

            <section className="cart-summary" aria-label="Resumo do carrinho">
              <div className="cart-summary-heading">
                <div>
                  <span className="card-overline">SUA LISTA</span>
                  <h3>
                    {!cartReady
                      ? "Carregando itens…"
                      : cart.length
                        ? `${cart.length} ${cart.length === 1 ? "produto" : "produtos"}`
                        : "Carrinho vazio"}
                  </h3>
                </div>
                <strong className="cart-total">{brl(total)}</strong>
              </div>
              <div className="cart-nav">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Item anterior"
                  disabled={index <= 0}
                  onClick={() => setIndex((i) => i - 1)}
                >
                  <ChevronLeft />
                </Button>
                <span>
                  {cartReady && cart.length ? `${index + 1} de ${cart.length}` : "Itens da compra"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Próximo item"
                  disabled={index >= cart.length - 1}
                  onClick={() => setIndex((i) => i + 1)}
                >
                  <ChevronRight />
                </Button>
              </div>
              <div className="cart-item">
                {current ? (
                  <>
                    <strong>
                      {current.name}
                      {current.size ? ` · ${current.size}` : ""}
                    </strong>
                    <span>
                      {current.qty} × {brl(current.price)} = {brl(current.qty * current.price)}
                    </span>
                  </>
                ) : (
                  <span className="muted">Seus produtos adicionados aparecerão aqui.</span>
                )}
              </div>
              <div className="cart-actions">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Aumentar item"
                  disabled={!current}
                  onClick={() => changeCurrent(1)}
                >
                  <Plus />
                </Button>
                {current && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remover item"
                    onClick={() => setCart((c) => c.filter((_, k) => k !== index))}
                  >
                    <Trash2 />
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Diminuir item"
                  disabled={!current}
                  onClick={() => changeCurrent(-1)}
                >
                  <Minus />
                </Button>
              </div>
            </section>
          </div>
        </section>
      )}

      {workspaceView === "history" && (
        <section className="content-card" aria-labelledby="history-heading">
          <div className="content-heading">
            <div>
              <p className="section-eyebrow">SEUS REGISTROS</p>
              <h2 id="history-heading">Histórico de leituras</h2>
              <p>Leituras salvas e preços públicos disponíveis para os produtos.</p>
            </div>
            <Button
              variant="outline"
              onClick={() => setHistoryLoadAttempt((attempt) => attempt + 1)}
              disabled={historyLoading}
              aria-label="Atualizar histórico"
            >
              <RefreshCw className={historyLoading ? "spin" : ""} />
              Atualizar
            </Button>
          </div>

          {historyError && (
            <div className="state-message error-message" role="alert">
              <p>{historyError}</p>
              <Button
                variant="outline"
                onClick={() => setHistoryLoadAttempt((attempt) => attempt + 1)}
              >
                Tentar novamente
              </Button>
            </div>
          )}
          {historyLoading && (
            <div className="state-message" role="status">
              <Loader2 className="spin" />
              Carregando leituras salvas…
            </div>
          )}
          {!historyLoading && !historyError && scanHistory.length === 0 && (
            <div className="empty-state">
              <span className="empty-state-icon">
                <History />
              </span>
              <h3>Nenhuma leitura salva ainda</h3>
              <p>As etiquetas lidas aparecerão aqui para você consultar depois.</p>
              <Button onClick={() => setWorkspaceView("scan")}>Começar escaneamento</Button>
            </div>
          )}
          {!historyLoading && !historyError && scanHistory.length > 0 && (
            <div className="history-list">
              {scanHistory.map((scan) => {
                const prices = scan.barcode ? priceHistory[scan.barcode] : undefined;
                return (
                  <article className="history-entry" key={scan.id}>
                    <div className="history-entry-main">
                      <span className="history-icon">
                        <ScanLine />
                      </span>
                      <div className="history-entry-copy">
                        <h3>{scan.product_name || "Produto sem identificação"}</h3>
                        <p>
                          {scan.size || scan.barcode || "Etiqueta lida"}
                          <span aria-hidden="true"> · </span>
                          {scanDate(scan.created_at)}
                        </p>
                        <span className="trust-label">
                          Leitura da etiqueta · confira o preço no local
                        </span>
                      </div>
                      <strong className="history-price">
                        {scan.promo_price != null
                          ? brl(scan.promo_price)
                          : scan.price != null
                            ? brl(scan.price)
                            : "Preço não lido"}
                      </strong>
                    </div>
                    {scan.barcode && (
                      <Button
                        className="history-price-toggle"
                        variant="ghost"
                        onClick={() => void togglePriceHistory(scan)}
                        aria-expanded={expandedHistoryId === scan.id}
                      >
                        <History />
                        {expandedHistoryId === scan.id
                          ? "Ocultar preços públicos"
                          : "Consultar preços públicos"}
                      </Button>
                    )}
                    {expandedHistoryId === scan.id && (
                      <div className="public-prices">
                        {priceHistoryLoading === scan.id && (
                          <p className="state-message" role="status">
                            <Loader2 className="spin" />
                            Consultando registros públicos…
                          </p>
                        )}
                        {priceHistoryError && (
                          <p className="inline-error" role="alert">
                            {priceHistoryError}
                          </p>
                        )}
                        {prices?.length === 0 && !priceHistoryLoading && !priceHistoryError && (
                          <p className="empty-prices">
                            Não há registros públicos de preço para este código.
                          </p>
                        )}
                        {prices?.map((publicPrice) => (
                          <div className="public-price-row" key={publicPrice.id}>
                            <div>
                              <strong>{brl(publicPrice.price)}</strong>
                              <span>
                                {publicPrice.store.name}
                                {publicPrice.store.city ? ` · ${publicPrice.store.city}` : ""}
                              </span>
                              <time dateTime={publicPrice.observed_at}>
                                {scanDate(publicPrice.observed_at)}
                              </time>
                            </div>
                            <span className="verification-label">
                              {new Date(publicPrice.observed_at).getTime() <
                              Date.now() - 30 * 24 * 60 * 60 * 1000
                                ? "Registro com mais de 30 dias · "
                                : ""}
                              {publicPrice.verification === "source_contributed"
                                ? "Contribuído · sem verificação independente"
                                : `Fonte: ${publicPrice.verification}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {workspaceView === "settings" && (
        <section className="content-card settings-card" aria-labelledby="settings-heading">
          <div className="content-heading">
            <div>
              <p className="section-eyebrow">PREFERÊNCIAS</p>
              <h2 id="settings-heading">Ajustes</h2>
              <p>Personalize a leitura e consulte a conexão da sua conta.</p>
            </div>
          </div>

          <div className="settings-row">
            <span className="settings-icon">{darkTheme ? <Moon /> : <Sun />}</span>
            <div className="settings-copy">
              <strong>Aparência</strong>
              <span>Tema {darkTheme ? "escuro" : "claro"}</span>
            </div>
            <Button
              variant="outline"
              aria-pressed={darkTheme}
              onClick={() => setDarkTheme((enabled) => !enabled)}
            >
              {darkTheme ? <Sun /> : <Moon />}
              Ativar tema {darkTheme ? "claro" : "escuro"}
            </Button>
          </div>

          <div className="settings-row">
            <span className="settings-icon">
              {serviceStatus === "online" ? <CircleCheck /> : <Clock3 />}
            </span>
            <div className="settings-copy">
              <strong>Conexão com o serviço</strong>
              <span>
                {serviceStatus === "loading"
                  ? "Verificando API e banco de dados…"
                  : serviceStatus === "online"
                    ? "API e banco de dados conectados."
                    : serviceError}
              </span>
            </div>
            <Button
              variant="outline"
              onClick={() => setServiceCheckAttempt((attempt) => attempt + 1)}
              disabled={serviceStatus === "loading"}
            >
              <RefreshCw className={serviceStatus === "loading" ? "spin" : ""} />
              Verificar
            </Button>
          </div>

          <div className="privacy-card">
            <h3>Privacidade e leitura</h3>
            <p>
              A câmera é ativada somente quando você inicia o escaneamento. As imagens enviadas para
              leitura são processadas pelo serviço configurado pelo responsável pela aplicação. Os
              produtos e preços da sua sessão são mantidos no banco de dados da aplicação.
            </p>
          </div>
        </section>
      )}

      <footer className="app-footer">
        <span>Preços lidos são informativos. Confira a etiqueta no estabelecimento.</span>
      </footer>
    </main>
  );
}
