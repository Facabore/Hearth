"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { browserApi, type Api } from "@/shared/ui/api/client";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import type { SignUpMode } from "@/shared/ui/api/dto";
import { SignInForm } from "./sign-in-form";

/** HU-E9-01: signs in against /api/v1 from the browser and returns to `next` (already made safe by the page). */
export function SignInFormContainer({
  next,
  expired = false,
  signUp = "open",
  api: injected,
}: {
  readonly next: string;
  readonly expired?: boolean;
  readonly signUp?: SignUpMode;
  readonly api?: Api;
}) {
  const router = useRouter();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const submit = async (body: { email: string; password: string }) => {
    setPending(true);
    setProblem(null);
    try {
      const { error, response } = await api.POST("/api/v1/auth/sign-in", { body });
      if (response.ok) {
        router.replace(next);
        router.refresh();
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  return (
    <SignInForm
      next={next}
      expired={expired}
      signUp={signUp}
      onSubmit={(body) => void submit(body)}
      pending={pending}
      problem={problem}
      problemField={null}
    />
  );
}
