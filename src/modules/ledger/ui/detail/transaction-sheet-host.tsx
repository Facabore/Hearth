"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { TransactionSheet as Panel } from "./transaction-sheet";

// Ruling P189: the sheet's code, and the Radix dialog under it, load only when a row was opened (P134).
const TransactionSheet = dynamic(
  () => import("./transaction-sheet").then((module) => module.TransactionSheet),
  {
    ssr: false,
  },
);

export function TransactionSheetHost(props: ComponentProps<typeof Panel>) {
  return <TransactionSheet {...props} />;
}
