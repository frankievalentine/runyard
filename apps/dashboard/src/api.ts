import type { AppType } from "@runyard/server/app";
import { hc } from "hono/client";

export const api = hc<AppType>("/").api;
