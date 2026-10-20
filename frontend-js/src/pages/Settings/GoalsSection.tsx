import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  type GoalKind,
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
import { changedUpdates, GOAL_FIELDS, GoalsSchema, saveSummary } from "./goals";

const FormSchema = z.object({ drafts: GoalsSchema });

const text = (target: number | null) => target?.toString() ?? "";

const toDrafts = ({ books, pages, minutes }: GoalTargets) => ({
  books: text(books),
  pages: text(pages),
  minutes: text(minutes),
});

const write = (kind: GoalKind, target: number | null) =>
  kind === "books" ? saveAnnualGoal(target) : saveDailyGoal(kind, target);

/** The three reading targets, saved together by one Save all. */
export function GoalsSection() {
  const queryClient = useQueryClient();
  const goals = useQuery(goalsQuery);
  const saved = goals.data ?? null;
  const [outcome, setOutcome] = useState<Status | null>(null);
  const form = useForm({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      drafts: toDrafts({ books: null, pages: null, minutes: null }),
    },
    values: saved ? { drafts: toDrafts(saved) } : undefined,
    // A failed goal keeps what was typed, and its error survives the re-sync after a save.
    resetOptions: { keepDirtyValues: true, keepErrors: true },
  });
  const drafts = form.watch("drafts");
  const dirty =
    saved !== null &&
    GOAL_FIELDS.some(({ kind }) => drafts[kind].trim() !== text(saved[kind]));
  useUnsavedGuard("goals", dirty);

  const save = useMutation({
    mutationFn: async ({
      base,
      updates,
    }: {
      base: GoalTargets;
      updates: ReturnType<typeof changedUpdates>;
    }) => {
      const landed = { ...base };
      const failed: GoalKind[] = [];
      // One after another, so a failure part-way leaves the card describing what landed.
      for (const { kind, target } of updates) {
        try {
          await write(kind, target);
          landed[kind] = target;
        } catch {
          failed.push(kind);
        }
      }
      return { landed, failed };
    },
    onMutate: () => setOutcome(null),
    onSuccess: ({ landed, failed }) => {
      queryClient.setQueryData(goalsQuery.queryKey, landed);
      for (const kind of failed) {
        form.setError(`drafts.${kind}`, {
          message: "This one didn’t save. Try again.",
        });
      }
      setOutcome(
        saveSummary(
          GOAL_FIELDS.filter((f) => failed.includes(f.kind)).map(
            (f) => f.label,
          ),
        ),
      );
    },
  });

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
      <form
        id="goals-form"
        className="settings-form"
        onSubmit={form.handleSubmit(
          ({ drafts }) => {
            if (saved)
              save.mutate({
                base: saved,
                updates: changedUpdates(drafts, saved),
              });
          },
          () =>
            setOutcome({
              message: "Nothing saved yet. Check the targets marked above.",
              error: true,
            }),
        )}
      >
        {GOAL_FIELDS.map((field) => {
          const error = form.formState.errors.drafts?.[field.kind]?.message;
          return (
            <div className="settings-field" key={field.testId}>
              <label htmlFor={field.testId}>{field.label}</label>
              <input
                // Text, not number: a browser reads "24e" as "", which would clear the goal.
                type="text"
                id={field.testId}
                className={saved ? undefined : "ld-unknown"}
                data-testid={`${field.testId}-input`}
                inputMode="numeric"
                placeholder={saved ? "No target" : undefined}
                disabled={!saved || save.isPending}
                aria-invalid={error !== undefined}
                aria-describedby={
                  error
                    ? `${field.testId}-hint ${field.testId}-error`
                    : `${field.testId}-hint`
                }
                {...form.register(`drafts.${field.kind}`, {
                  onChange: () => {
                    form.clearErrors(`drafts.${field.kind}`);
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
