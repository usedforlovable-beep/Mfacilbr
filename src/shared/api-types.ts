export type TicketData = {
  readable: boolean;
  product_name: string | null;
  size: string | null;
  unit: "ml" | "l" | "g" | "kg" | "un" | null;
  price: number | null;
  promo_price: number | null;
  member_price: number | null;
  code: string | null;
  raw_text: string;
  price_uncertain: boolean;
};

export type PhotoProduct = {
  recognized: boolean;
  brand: string | null;
  product_name: string | null;
  variant: string | null;
  size: string | null;
  barcode: string | null;
  visible_text: string | null;
  search_query: string | null;
  confidence: "high" | "medium" | "low";
};

export type CartItem = {
  id: string;
  name: string;
  size?: string;
  price: number;
  qty: number;
};

export type CartItemInput = Omit<CartItem, "id">;

export type ProductInfo = {
  code: string;
  name: string | null;
  brand: string | null;
  quantity: string | null;
  image_url: string | null;
  category: string | null;
};

export type StoredScan = {
  id: string;
  kind: "ticket" | "product";
  product_name: string | null;
  brand: string | null;
  variant: string | null;
  size: string | null;
  unit: string | null;
  barcode: string | null;
  price: number | null;
  promo_price: number | null;
  member_price: number | null;
  raw_text: string | null;
  price_uncertain: boolean;
  recognized: boolean;
  details: Record<string, unknown>;
  created_at: string;
};

export type CamiloOffer = {
  url: string;
  name: string;
  price: number | null;
  club_price: number | null;
  wholesale_price: number | null;
  wholesale_min_qty: number | null;
  unit: string | null;
  image_url: string | null;
  retrieved_at: string;
};

export type PublicPrice = {
  id: string;
  product_code: string;
  product_name: string | null;
  price: number;
  currency: string;
  observed_at: string;
  store: {
    name: string;
    city: string | null;
  };
  verification: string;
};
