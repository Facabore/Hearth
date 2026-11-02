import { useTranslations } from "next-intl";
import { Avatar, Button, Icon } from "@/shared/ui";
import type { MemberDto } from "@/shared/ui/api/dto";

/**
 * HU-E9-05, the Main artboard's row (ruling P272): initial, name, detail, and the role, as plain text, or a button when
 * the viewer may change it. A guest has no role, so the row shows none.
 */
export function MemberRow({
  member,
  label,
  detail,
  roleText,
  onRole,
  onOptions,
}: {
  readonly member: Pick<MemberDto, "id" | "displayName">;
  readonly label: string;
  readonly detail: string;
  readonly roleText: string | null;
  readonly onRole?: (() => void) | undefined;
  /** A guest's options (HU-E9-05, ruling P163): the claim link and the removal. */
  readonly onOptions?: (() => void) | undefined;
}) {
  const t = useTranslations("members");
  return (
    <li aria-labelledby={`member-${member.id}`} className="flex min-h-row-lg items-center gap-3 py-1.5">
      <Avatar name={member.displayName} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span id={`member-${member.id}`} className="font-medium [overflow-wrap:anywhere] text-ink">
          {label}
        </span>
        <span className="text-sm text-muted">{detail}</span>
      </span>
      {roleText === null ? null : onRole ? (
        <button
          type="button"
          aria-label={t("role", { name: member.displayName, role: roleText })}
          onClick={onRole}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-line bg-surface pr-2.5 pl-3 text-sm font-medium text-ink"
        >
          {roleText}
          <Icon name="chevronDown" size={14} />
        </button>
      ) : (
        <span className="shrink-0 text-sm text-muted">{roleText}</span>
      )}
      {onOptions ? (
        <Button
          size="iconCompact"
          variant="ghost"
          aria-label={t("guestOptions", { name: label })}
          onClick={onOptions}
        >
          <Icon name="chevronRight" size={20} />
        </Button>
      ) : null}
    </li>
  );
}
