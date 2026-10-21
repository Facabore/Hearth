"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Icon, TextField, VisuallyHidden, type TextFieldProps } from "@/shared/ui";

/** A password `TextField` with a show/hide toggle. */
export function PasswordField(props: Omit<TextFieldProps, "type" | "trailing">) {
  const t = useTranslations("auth");
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...props}
      type={visible ? "text" : "password"}
      trailing={
        <Button
          size="icon"
          variant="ghost"
          aria-pressed={visible}
          aria-controls={props.id}
          onClick={() => setVisible((v) => !v)}
        >
          <Icon name="eye" />
          <VisuallyHidden>{visible ? t("hidePassword") : t("showPassword")}</VisuallyHidden>
        </Button>
      }
    />
  );
}
