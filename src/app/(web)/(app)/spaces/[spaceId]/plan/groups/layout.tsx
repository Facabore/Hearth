import { documentFirst } from "@/shared/ui/api/route-screen";
import Page from "./page";

/** Issue #196: on a document request the screen renders here, before the route's loading boundary starts the stream. */
export default documentFirst(Page);
