import { recordExpense } from "../modules/ledger/application/index";
export const GET = () => recordExpense({ id: "1" });
