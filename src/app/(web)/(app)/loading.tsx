import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/**
 * Issue #196: the start and any signed-in screen without a closer boundary, before the shell itself has loaded. It
 * keeps the shell's gutters and its 48 px header row, so the screen does not jump when the shell arrives.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-12 max-[359px]:px-3">
      <LoadingScreen shape="cards" />
    </div>
  );
}
