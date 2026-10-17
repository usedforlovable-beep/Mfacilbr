import type {
  CamiloOffer,
  CartItem,
  CartItemInput,
  PhotoProduct,
  ProductInfo,
  PublicPrice,
  StoredScan,
  TicketData,
} from "../shared/api-types.js";

export type ScanInput =
  { kind: "ticket"; result: TicketData } | { kind: "product"; result: PhotoProduct };

export type StoreInfo = {
  source: string;
  externalId: string;
  name: string;
  city: string | null;
  countryCode: string | null;
  lat: number | null;
  lon: number | null;
};

export type PriceInput = {
  source: string;
  externalId: string;
  productCode: string;
  productName: string | null;
  storeId: string;
  price: number;
  currency: string;
  observedAt: Date;
  verification: string;
};

export type SyncResult = { records: number };
export type CartState = { items: CartItem[]; legacyImported: boolean };

export interface DataStore {
  ping(): Promise<void>;
  getCart(sessionId: string): Promise<CartState>;
  replaceCart(sessionId: string, items: CartItemInput[]): Promise<CartItem[]>;
  importLegacyCart(sessionId: string, items: CartItemInput[]): Promise<CartState>;
  createScan(sessionId: string, scan: ScanInput): Promise<StoredScan>;
  listScans(sessionId: string, limit: number): Promise<StoredScan[]>;
  getProduct(code: string): Promise<ProductInfo | null>;
  saveProduct(product: ProductInfo): Promise<void>;
  listPrices(productCode: string): Promise<PublicPrice[]>;
  startSyncRun(source: string): Promise<string>;
  upsertStore(store: StoreInfo): Promise<string>;
  upsertPrice(price: PriceInput): Promise<void>;
  finishSyncRun(
    id: string,
    status: "success" | "error",
    records: number,
    message?: string,
  ): Promise<void>;
}

export type BackendServices = {
  readTicket(image: string): Promise<TicketData>;
  recognizeProduct(image: string): Promise<PhotoProduct>;
  lookupProduct(code: string): Promise<ProductInfo | null>;
  searchCamilo(query: string): Promise<CamiloOffer[]>;
  syncOpenPrices(): Promise<SyncResult>;
};
