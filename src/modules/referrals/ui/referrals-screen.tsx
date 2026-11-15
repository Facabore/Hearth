"use client";

import { useTranslations } from "next-intl";
import { useRef } from "react";
import { Avatar, Button, ScreenHeader, VisuallyHidden } from "@/shared/ui";
import { formatCount } from "@/shared/ui/format/count";
import { formatDayMonth } from "@/shared/ui/format/day-month";
import type { DateFormat, NumberFormat } from "@/shared/ui/format/formatters";
import { useToast } from "@/shared/ui/molecules/toast";
import type { MyReferralsDto } from "./dto";

type Item = MyReferralsDto["items"][number];

interface ScreenFormats {
  readonly numberFormat: NumberFormat;
  readonly dateFormat: DateFormat;
}

/**
 * "Se unió el 12 nov": the day and the short month in the person's date format (D23), the month's name in their
 * language; the day of `joinedOn` is already theirs (the API counts it in their zone).
 */
function JoinedOn({ date, formats }: { readonly date: string; readonly formats: ScreenFormats }) {
  const t = useTranslations();
  const month = t(`common.monthShort.${Number(date.slice(5, 7)) as 1}`);
  return <>{t("referrals.joinedOn", { date: formatDayMonth(date, month, formats) })}</>;
}

function Row({ item, formats }: { readonly item: Item; readonly formats: ScreenFormats }) {
  const t = useTranslations("referrals");
  return (
    <li className="flex min-h-row-lg items-center gap-3 py-2">
      <Avatar name={item.firstName} size={36} />
      <span className="flex min-w-0 flex-1 flex-col [overflow-wrap:anywhere]">
        <span className="text-[15px] font-medium text-ink">{item.firstName}</span>
        <span className="text-[13px] text-muted">
          {item.counts ? <JoinedOn date={item.joinedOn} formats={formats} /> : t("unconfirmed")}
        </span>
      </span>
      {item.counts ? (
        <span className="shrink-0 font-semibold text-accent">
          <span aria-hidden="true">+1</span>
          <VisuallyHidden>{t("plusOne")}</VisuallyHidden>
        </span>
      ) : null}
    </li>
  );
}

/**
 * D27, board "2 · Invitar a Hearth": the person's points, their link to copy or share, and the people who joined with
 * it. A referral earns its "+1" once the person confirmed their email; until then it says so. Sharing uses the
 * browser's own sheet when there is one, and copies the link otherwise; when the clipboard refuses, the link is
 * selected so the person copies it by hand.
 */
export function ReferralsScreen({
  backHref,
  referrals,
  formats,
}: {
  readonly backHref: string;
  readonly referrals: MyReferralsDto;
  readonly formats: ScreenFormats;
}) {
  const t = useTranslations("referrals");
  const toast = useToast();
  const field = useRef<HTMLInputElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(referrals.link);
      toast.show({ message: t("copied") });
    } catch {
      field.current?.select();
      toast.show({ message: t("copyFailed"), tone: "alert" });
    }
  };
  const share = async () => {
    if (typeof navigator.share !== "function") return copy();
    try {
      await navigator.share({ title: t("title"), text: t("shareText"), url: referrals.link });
    } catch (error) {
      // The person closed the sheet: nothing to say. Any other refusal falls back to copying.
      if (!(error instanceof DOMException && error.name === "AbortError")) await copy();
    }
  };
  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-4 py-3">
      <ScreenHeader backHref={backHref} title={t("title")} />
      <div className="flex flex-col gap-1">
        <h2 className="text-sm text-muted">{t("points")}</h2>
        <p className="text-[34px] leading-tight font-semibold text-ink tabular-nums">
          {formatCount(referrals.points, formats)}
        </p>
      </div>
      <p className="text-[15px] text-ink">{t("intro")}</p>
      <div className="flex min-h-14 items-center gap-2 rounded-[14px] border border-line bg-field py-1 pr-1 pl-3">
        <input
          ref={field}
          readOnly
          value={referrals.link}
          aria-label={t("link")}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 truncate bg-transparent text-[15px] text-ink outline-none"
        />
        <button
          type="button"
          onClick={() => void copy()}
          className="motion-press min-h-11 shrink-0 rounded-[10px] bg-accent-soft px-4 text-sm font-semibold text-accent"
        >
          {t("copy")}
        </button>
      </div>
      <Button size="lg" onClick={() => void share()}>
        {t("share")}
      </Button>
      <section aria-labelledby="referrals-joined" className="flex flex-col gap-1">
        <h2 id="referrals-joined" className="text-sm font-semibold text-muted">
          {t("joined")}
        </h2>
        {referrals.items.length === 0 ? (
          <p className="rounded-2xl bg-track p-3 text-sm text-ink">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {referrals.items.map((item, index) => (
              // A referral has no id on the wire (D27 shows no id); the list's order is stable for one answer.
              <Row key={`${index}-${item.firstName}`} item={item} formats={formats} />
            ))}
          </ul>
        )}
      </section>
      <p className="text-sm text-muted">{t("footer")}</p>
    </div>
  );
}
