import { useTranslations } from "next-intl";
import { Avatar, Badge, Button, Icon } from "@/shared/ui";
import type { MemberDto } from "@/shared/ui/api/dto";

/** HU-E9-05, the Main artboard's row: initial, name, detail, and the role (a button when the viewer may change it). */
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
  readonly roleText: string;
  readonly onRole?: () => void;
  /** A guest's options (HU-E9-05, ruling P163): the claim link and the removal. */
  readonly onOptions?: () => void;
}) {
  const t = useTranslations("members");
  return (
    <li aria-labelledby={`member-${member.id}`} className="flex min-h-16 items-center gap-3 py-2">
      <Avatar name={member.displayName} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span id={`member-${member.id}`} className="truncate font-medium text-ink">
          {label}
        </span>
        <span className="text-sm text-muted">{detail}</span>
      </span>
      {onRole ? (
        <button
          type="button"
          aria-label={t("role", { name: member.displayName, role: roleText })}
          onClick={onRole}
          className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-surface pr-2.5 pl-3 text-sm font-medium text-ink"
        >
          {roleText}
          <Icon name="chevronDown" size={14} />
        </button>
      ) : (
        <Badge>{roleText}</Badge>
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
