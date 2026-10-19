import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  type GoalTargets,
  goalsQuery,
  saveAnnualGoal,
  saveDailyGoal,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import {
  type Status,
  StatusLine,
  useUnsavedGuard,
} from "../../components/SettingsShell/SettingsShell";
import {
  changedUpdates,
  GOAL_FIELDS,
  GOAL_INDEXES,
  type GoalIndex,
  GoalsSchema,
  saveSummary,
} from "./goals";

const FormSchema = z.object({ drafts: GoalsSchema });
type Drafts = z.input<typeof FormSchema>;

const NAMES = ["drafts.0", "drafts.1", "drafts.2"] as const;

const toDrafts = (targets: GoalTargets): Drafts["drafts"] => [
  targets[0]?.toString() ?? "",
  targets[1]?.toString() ?? "",
  targets[2]?.toString() ?? "",
];

const write = (index: GoalIndex, target: number | null) => {
  const { kind } = GOAL_FIELDS[index];
  return kind === "books"
    ? saveAnnualGoal(target)
    : saveDailyGoal(kind, target);
};

/** The three reading targets, saved together by one Save all. */
export function GoalsSection() {
  const queryClient = useQueryClient();
  const goals = useQuery(goalsQuery);
  const saved = goals.data ?? null;
  const [outcome, setOutcome] = useState<Status | null>(null);
  const form = useForm({
    resolver: zodResolver(FormSchema),
    defaultValues: { drafts: toDrafts([null, null, null]) },
    values: saved ? { drafts: toDrafts(saved) } : undefined,
    // A failed goal keeps what was typed, and its error survives the re-sync after a save.
    resetOptions: { keepDirtyValues: true, keepErrors: true },
  });
  const parsed = GoalsSchema.safeParse(form.watch("drafts"));
  const dirty =
    saved !== null &&
    (!parsed.success || changedUpdates(parsed.data, saved).length > 0);
  useUnsavedGuard("goals", dirty);

  const save = useMutation({
    mutationFn: async (updates: ReturnType<typeof changedUpdates>) => {
      const landed: GoalTargets = [...(saved ?? [null, null, null])];
      const failed: GoalIndex[] = [];
      // One after another, so a failure part-way leaves the card describing what landed.
      for (const { index, target } of updates) {
        try {
          await write(index, target);
          landed[index] = target;
        } catch {
          failed.push(index);
        }
      }
      return { landed, failed };
    },
    onMutate: () => setOutcome(null),
    onSuccess: ({ landed, failed }) => {
      queryClient.setQueryData(goalsQuery.queryKey, landed);
      for (const index of failed) {
        form.setError(NAMES[index], {
          message: "This one didn’t save. Try again.",
        });
      }
      setOutcome(saveSummary(failed.map((index) => GOAL_FIELDS[index].label)));
    },
  });

  const known = saved !== null;
  let shown = outcome;
  if (goals.isPending) {
    shown = { message: "Reading your goals", error: false };
  } else if (goals.isError) {
    shown = {
      message: "Couldn’t load your goals. Reload to try again.",
      error: true,
    };
  }

  return (
    <section className="card" data-testid="account-goals-card">
      <h3>Reading goals</h3>
      <p className="subtitle">
        Leave a field empty for no goal. Clearing one keeps the progress you
        have already made toward it.
      </p>
      {/* noValidate: the browser would silently refuse an over-max value, and the field's error names its bound. */}
      <form
        id="goals-form"
        className="settings-form"
        noValidate
        onSubmit={form.handleSubmit(
          ({ drafts }) => {
            if (saved) save.mutate(changedUpdates(drafts, saved));
          },
          () =>
            setOutcome({
              message: "Nothing saved yet. Check the targets marked above.",
              error: true,
            }),
        )}
      >
        {GOAL_INDEXES.map((index) => {
          const field = GOAL_FIELDS[index];
          const error = form.formState.errors.drafts?.[index]?.message;
          return (
            <div className="settings-field" key={field.testId}>
              <label htmlFor={field.testId}>{field.label}</label>
              <input
                // Text, not number: a browser reads "24e" as "", which would clear the goal.
                type="text"
                id={field.testId}
                className={known ? undefined : "ld-unknown"}
                data-testid={`${field.testId}-input`}
                inputMode="numeric"
                placeholder={known ? "No target" : undefined}
                disabled={!known || save.isPending}
                aria-invalid={error !== undefined}
                aria-describedby={
                  error
                    ? `${field.testId}-hint ${field.testId}-error`
                    : `${field.testId}-hint`
                }
                {...form.register(NAMES[index], {
                  onChange: () => {
                    form.clearErrors(NAMES[index]);
                    setOutcome(null);
                  },
                })}
              />
              <p className="settings-hint" id={`${field.testId}-hint`}>
                {field.hint}
              </p>
              {error && (
                <p
                  className="settings-field-error"
                  id={`${field.testId}-error`}
                  data-testid={`${field.testId}-error`}
                >
                  {error}
                </p>
              )}
            </div>
          );
        })}
        <div className="settings-actions">
          <StatusLine
            testId="goals-status"
            status={shown}
            pending={goals.isPending}
            action
          />
          <Button
            type="submit"
            variant="primary"
            disabled={save.isPending || !dirty}
            aria-busy={save.isPending}
            data-testid="goals-save"
          >
            <BusyLabel
              busy={save.isPending}
              label="Save all"
              busyLabel="Saving…"
            />
          </Button>
        </div>
      </form>
    </section>
  );
}
