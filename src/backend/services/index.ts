import type { AppConfig } from "../config.js";
import type { BackendServices, DataStore } from "../store.js";
import { createCamiloCatalogService, lookupOpenFoodFacts } from "./catalog.service.js";
import { createOpenAiService } from "./openai.service.js";
import { createOpenPricesSync } from "./open-prices.service.js";

export function createBackendServices(config: AppConfig, store: DataStore): BackendServices {
  const openAi = createOpenAiService(config);

  return {
    ...openAi,
    lookupProduct: lookupOpenFoodFacts,
    searchCamilo: createCamiloCatalogService(config),
    syncOpenPrices: createOpenPricesSync(store),
  };
}
