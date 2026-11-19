/**
 * P344 (board 1): "Editar pago" loads on its own, only when someone edits a payment, so the edit route of every other
 * movement carries none of it (ADR 0004, owner 2026-11-19). It reaches the module through its public screens.
 */
export { EditPaymentForm } from "@/modules/ledger/ui/screens";
