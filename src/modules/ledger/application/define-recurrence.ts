import { ok, todayIn, type LocalDate, type Money, type PeriodPolicy, type Result } from "@/shared/kernel";
import { defineRecurrence, type RecurrenceMode } from "../domain/recurrence";
import { scheduleOf } from "../domain/recurrence-schedule";
import { positiveAmount } from "../domain/transaction";
import { authorizeWriter, inSpaceCurrency } from "./checks";
import type { RecurrenceDeps } from "./recurrence-ports";
import { checkTemplate, withContributor, type TemplateInput } from "./recurrence-template";
import { recurrenceView, type RecurrenceView } from "./recurrence-view";

export interface DefineRecurrenceInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly description: string;
  /** AUTO: what every occurrence records; CONFIRM: the estimate each pending occurrence suggests. */
  readonly amount: Money;
  readonly template: TemplateInput;
  /** Anchor days as requested: InvalidPeriodPolicy unless they make a MONTHLY or SEMI_MONTHLY policy. */
  readonly schedule: PeriodPolicy;
  readonly mode: RecurrenceMode;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate | null;
}

export type DefineRecurrence = (input: DefineRecurrenceInput) => Promise<Result<RecurrenceView>>;

/**
 * HU-E4-11 DefineRecurrence: a member who records money (money.record) defines a recurring expense, income, transfer
 * or fund contribution of the space. The template is checked as recording an occurrence would check it, for the
 * definer, on whose behalf every AUTO occurrence is recorded (ruling P21).
 */
export const createDefineRecurrence =
  (deps: RecurrenceDeps): DefineRecurrence =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeWriter(deps, input.spaceId, input.userId);
      if (!writer.ok) return writer;
      const space = writer.value;
      const amount = positiveAmount(input.amount.minor);
      if (!amount.ok) return amount;
      const currency = inSpaceCurrency(space, input.amount);
      if (!currency.ok) return currency;
      const schedule = scheduleOf(input.schedule);
      if (!schedule.ok) return schedule;
      const members = await deps.members.listCurrent(space.spaceId);
      const template = await checkTemplate(
        deps,
        { spaceId: space.spaceId, creatorUserId: input.userId },
        members,
        withContributor(input.template, space.memberId),
        input.amount,
      );
      if (!template.ok) return template;
      const recurrence = defineRecurrence({
        id: deps.ids.next<"Recurrence">(),
        spaceId: space.spaceId,
        description: input.description,
        amount: amount.value,
        currency: space.currency,
        template: template.value,
        schedule: schedule.value,
        mode: input.mode,
        startDate: input.startDate,
        endDate: input.endDate,
        createdBy: input.userId,
        now: deps.clock.now(),
        today: todayIn(deps.clock, deps.timeZone),
      });
      if (!recurrence.ok) return recurrence;
      await deps.recurrences.add(recurrence.value);
      return ok(recurrenceView(recurrence.value, null));
    });
