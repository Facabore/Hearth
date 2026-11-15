import { ensurer, type Load } from "../load";
import { myReferralsQuery } from "./queries";

/** D27: the person's link, points and referrals, before Invitar a Hearth paints. */
export const loadReferrals = (load: Load) => ensurer(load)(myReferralsQuery(load.apis.api));
