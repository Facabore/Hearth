import { createRouteFactory } from "@/shared/http";
import { getContainer } from "./container";

/** Route handlers bound to the process container. */
export const defineRoute = createRouteFactory(getContainer);
