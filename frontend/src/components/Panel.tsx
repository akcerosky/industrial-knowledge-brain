import { PropsWithChildren } from "react";

type PanelProps = PropsWithChildren<{
  title: string;
  eyebrow?: string;
}>;

export function Panel({ title, eyebrow, children }: PanelProps) {
  return (
    <section className="rounded-[1.75rem] border border-steel/10 bg-white/80 p-5 shadow-[0_12px_48px_rgba(15,23,32,0.06)] backdrop-blur">
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-signal">{eyebrow}</p>
      ) : null}
      <h2 className="mt-2 text-xl font-bold text-ink">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

