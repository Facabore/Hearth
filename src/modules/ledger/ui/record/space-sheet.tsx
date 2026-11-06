import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Sheet } from "@/shared/ui";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { handOver, type RecordCarry } from "./record-carry";

/**
 * Ruling P305: the spaces the person records in, the current one marked. Choosing another hands it what was typed and
 * replaces the form's address with that space's form, keeping the kind and where the form was opened from, so Volver
 * and the save still land there. The move is a replace, so it does not ask (#215); leaving the new form still does,
 * since what it received counts as typed. It loads apart from the form, on the first tap (ADR 0004).
 */
export function SpaceSheet({
  open,
  spaces,
  currentId,
  carry,
  returnTo,
  onClose,
}: {
  readonly open: boolean;
  readonly spaces: readonly Pick<SpaceDto, "id" | "name">[];
  readonly currentId: string;
  readonly carry: RecordCarry;
  readonly returnTo: string | null;
  readonly onClose: () => void;
}) {
  const t = useTranslations("ledger.form");
  const router = useRouter();
  const choose = (spaceId: string) => {
    handOver(spaceId, carry);
    const search = new URLSearchParams();
    if (carry.kind !== "EXPENSE") search.set("type", carry.kind.toLowerCase());
    if (returnTo) search.set("returnTo", returnTo);
    router.replace(`/spaces/${spaceId}/new${search.size > 0 ? `?${search}` : ""}`);
  };
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()} title={t("spaceTitle")}>
      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {spaces.map((space) => {
          const current = space.id === currentId;
          return (
            <li key={space.id}>
              <button
                type="button"
                aria-current={current ? "true" : undefined}
                onClick={() => (current ? onClose() : choose(space.id))}
                className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left text-ink"
              >
                <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{space.name}</span>
                {current ? <Icon name="check" size={20} /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
